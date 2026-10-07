import { receivedInvoiceStatusLabels, type ReceivedInvoiceRow } from "./suppliers";

export const expenseCategoryLabels: Record<string, string> = {
  material: "Material", servicio: "Servicio", suministro: "Suministro",
  alquiler: "Alquiler", subcontrata: "Subcontrata", profesional: "Profesional",
  transporte: "Transporte", seguro: "Seguro", general: "General",
};

export const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
export const QUARTERS = ["1T", "2T", "3T", "4T"];
export type FiscalPeriod = "year" | "quarter" | "month";

/** Inclusive ISO date bounds; fiscal periods are never stored on an invoice. */
export function receivedInvoiceDateRange(period: FiscalPeriod, year: number, month: number, quarter: number) {
  const first = period === "month" ? month : period === "quarter" ? (quarter - 1) * 3 + 1 : 1;
  const last = period === "month" ? month : period === "quarter" ? quarter * 3 : 12;
  const day = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return {
    issue_date_from: `${year}-${String(first).padStart(2, "0")}-01`,
    issue_date_to: `${year}-${String(last).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function receivedInvoiceFiscalTotals(invoices: Pick<ReceivedInvoiceRow, "subtotal" | "iva_amount" | "irpf_amount" | "total">[]) {
  const sum = (field: "subtotal" | "iva_amount" | "irpf_amount" | "total") =>
    invoices.reduce((total, invoice) => total + Math.round(Number(invoice[field] || 0) * 100), 0) / 100;
  return { subtotal: sum("subtotal"), iva: sum("iva_amount"), irpf: sum("irpf_amount"), total: sum("total") };
}

export function receivedInvoicesCsv(invoices: ReceivedInvoiceRow[]) {
  const text = (value: string | null | undefined) => {
    const raw = value || "";
    // A quoted CSV field can still be interpreted as an Excel formula.
    const safe = /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const decimal = (n: number) => Number(n || 0).toFixed(2).replace(".", ",");
  const header = ["Nº factura", "Proveedor", "NIF", "Fecha", "Obra", "Categoría", "Base", "%IVA", "IVA", "%IRPF", "IRPF", "Total", "Estado"];
  const rows = invoices.map((invoice) => [
    text(invoice.invoice_number), text(invoice.supplier_name), text(invoice.supplier_nif),
    text(invoice.issue_date.split("-").reverse().join("/")), text(invoice.projects?.name),
    text(expenseCategoryLabels[invoice.category] || invoice.category),
    decimal(invoice.subtotal), decimal(invoice.iva_percent), decimal(invoice.iva_amount),
    decimal(invoice.irpf_percent), decimal(invoice.irpf_amount), decimal(invoice.total),
    text(receivedInvoiceStatusLabels[invoice.status]?.label || invoice.status),
  ].join(";"));
  return "\uFEFF" + [header.map(text).join(";"), ...rows].join("\r\n") + "\r\n";
}

/** Payments follow actual amounts, including partial payments, not workflow labels. */
export function receivedInvoiceCostTotals(invoices: { total: number; amount_paid: number | null }[]) {
  const totalCents = invoices.reduce((sum, i) => sum + Math.round(Number(i.total || 0) * 100), 0);
  const paidCents = invoices.reduce((sum, i) => sum + Math.round(Number(i.amount_paid || 0) * 100), 0);
  return { total: totalCents / 100, paid: paidCents / 100, pending: (totalCents - paidCents) / 100 };
}
