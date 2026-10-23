import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUnit } from "./price-resolver";

export interface ReceivedInvoiceLineInput {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
}

/** Unknown is not a unit of measure. Never default an OCR line to ud. */
export function invoiceLinesFromOcr(items: unknown): ReceivedInvoiceLineInput[] {
  if (!Array.isArray(items)) return [];
  const number = (value: unknown) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value)) ? Number(value) : null;
  return items.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      description: typeof row.description === "string" ? row.description.trim() : "",
      quantity: number(row.quantity),
      unit: typeof row.unit === "string" && row.unit.trim() ? normalizeUnit(row.unit) : null,
      unit_price: number(row.unit_price),
      amount: number(row.subtotal),
    };
  });
}

/** Confirmation, not extraction: same RPC on a retry, with stable line identities. */
export async function saveReceivedInvoiceLines(db: SupabaseClient, invoiceId: string,
  lines: ReceivedInvoiceLineInput[]) {
  const { error } = await db.rpc("save_received_invoice_lines", { p_invoice_id: invoiceId, p_lines: lines });
  if (error) throw error;
}

/** Authenticated client only. Explicit owner filter supplements, never replaces, RLS.
 * Keyset pages avoid PostgREST's 1000-row ceiling and timestamp URL encoding. */
export async function loadReceivedInvoicePrices(db: SupabaseClient, userId: string) {
  const rows: import("./price-resolver-v2").InvoicePriceRow[] = [];
  let after = "";
  while (true) {
    let query = db.from("received_invoice_lines")
      .select("id,description,unit,effective_unit_price,received_invoices!inner(issue_date,supplier_name,deleted_at,status)")
      .eq("user_id", userId).is("received_invoices.deleted_at", null)
      .neq("received_invoices.status", "rejected").gt("effective_unit_price", 0)
      .order("id").limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`Invoice price query failed: ${error.message}`);
    for (const line of data || []) {
      const parent = (Array.isArray(line.received_invoices) ? line.received_invoices[0] : line.received_invoices) as
        { issue_date: string; supplier_name: string } | null;
      if (!parent || !line.unit) continue;
      rows.push({ id: String(line.id), name: line.description, unit: line.unit,
        unit_price: Number(line.effective_unit_price), supplier_name: parent.supplier_name,
        invoice_date: parent.issue_date });
    }
    if (!data?.length || data.length < 500) break;
    after = String(data.at(-1)!.id);
  }
  return rows;
}

/** The unchanged engine knows historical_approved. At its boundary only, treat
 * invoice evidence as historical too, then restore the precise source. The
 * persisted price_source_type and source UUID never change. */
export function invoiceEvidenceForEngine<T extends { price_source_type?: string | null; price_source?: string }>(item: T): T {
  return item.price_source_type === "received_invoice" ? { ...item, price_source: "historical_approved" } : item;
}
export function invoiceEvidenceFromEngine<T extends { price_source_type?: string | null; price_source?: string }>(item: T): T {
  return item.price_source_type === "received_invoice" ? { ...item, price_source: "received_invoice" } : item;
}
