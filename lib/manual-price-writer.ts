import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBudgetItemUnit } from "./budget-units";

type PriceClient = Pick<SupabaseClient, "from">;
interface ManualPriceWrite {
  userId: string;
  sector: string;
  values: Record<string, unknown>;
  editingId?: string | null;
  collectionBudgetId?: string;
}

// An idempotent identity for collection, not a name matcher. Reuse decisions
// remain exclusively in matchManualPrice (b1).
async function collectionId(userId: string, sector: string, name: string, unit: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify([userId, sector, name, unit]))));
  digest[6] = (digest[6] & 15) | 128; // UUIDv8, opaque deterministic identity
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest.slice(0, 16)].map(n => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Shared by Precios and budget collection. Uses the authenticated client and
 * the existing price_items bank; never a service client or another store. */
export async function saveManualPrice(client: PriceClient, input: ManualPriceWrite) {
  const name = String(input.values.name || "").trim();
  const unit = input.collectionBudgetId
    ? normalizeBudgetItemUnit(input.values.unit)
    : String(input.values.unit || "ud");
  const price = Number(input.values.unit_price);
  if (!name || !Number.isFinite(price) || price <= 0) throw new Error("Introduce un nombre y un precio mayor que cero.");
  let editingId = input.editingId;
  if (input.collectionBudgetId && !editingId) {
    const { data, error } = await client.from("price_items").select("id")
      .eq("user_id", input.userId).eq("sector", input.sector)
      .eq("name", name).eq("unit", unit).eq("is_manual_override", true)
      .order("id").limit(1);
    if (error) throw error;
    editingId = data?.[0]?.id;
  }
  const payload = {
    ...input.values, name, unit, unit_price: price,
    source_type: input.values.source_type ?? "manual",
    confidence_score: input.values.confidence_score ?? 1.0,
    ...(input.collectionBudgetId ? {
      id: editingId || await collectionId(input.userId, input.sector, name, unit),
      collection_budget_id: input.collectionBudgetId,
      is_manual_override: true, is_active: true,
    } : {}),
  };
  const row = { ...payload, user_id: input.userId, sector: input.sector };
  const query = editingId
    ? client.from("price_items").update(payload).eq("id", editingId)
      .eq("user_id", input.userId).eq("sector", input.sector)
    : input.collectionBudgetId
      ? client.from("price_items").upsert(row, { onConflict: "id" })
      : client.from("price_items").insert(row);
  const result = await query.select("id,name,unit,unit_price").single();
  if (result.error) throw result.error;
  if (!result.data?.id) throw new Error("No se ha podido confirmar el precio guardado.");
  return result.data as { id: string; name: string; unit: string; unit_price: number };
}
