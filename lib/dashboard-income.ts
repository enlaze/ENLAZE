/**
 * Ingresos del Centro de control, con la misma regla que «Cobrado» en
 * Facturación (components/facturacion/BillingSummary.tsx): suma el total de
 * las facturas emitidas cobradas del todo (payment_status = "paid") y deja
 * fuera las anuladas. Los cobros parciales no cuentan, igual que allí.
 *
 * Lo cobrado cae en el mes del cobro (payment_date); si una factura antigua
 * no lo tiene, en el de su emisión. Lo facturado cae en el mes de emisión
 * (issue_date; invoice_date solo como respaldo, la app no lo rellena).
 * Así la suma de todos los meses es exactamente el «Cobrado» de Facturación.
 */

export interface IncomeInvoice {
  status: string | null;
  payment_status: string | null;
  total: number | string | null;
  issue_date?: string | null;
  invoice_date?: string | null;
  payment_date?: string | null;
}

export interface MonthRef {
  month: number; // 0-11
  year: number;
}

function inMonth(dateStr: string | null | undefined, { month, year }: MonthRef): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

function isLive(inv: IncomeInvoice): boolean {
  return inv.status !== "cancelled";
}

export function isCollected(inv: IncomeInvoice): boolean {
  return isLive(inv) && inv.payment_status === "paid";
}

function issuedOn(inv: IncomeInvoice): string | null {
  return inv.issue_date || inv.invoice_date || null;
}

function collectedOn(inv: IncomeInvoice): string | null {
  return inv.payment_date || issuedOn(inv);
}

/** Cobrado en un mes concreto. */
export function collectedInMonth(invoices: IncomeInvoice[], ref: MonthRef): number {
  return invoices
    .filter((inv) => isCollected(inv) && inMonth(collectedOn(inv), ref))
    .reduce((s, inv) => s + Number(inv.total || 0), 0);
}

/** Facturado (emitido, no anulado) en un mes concreto. */
export function invoicedInMonth(invoices: IncomeInvoice[], ref: MonthRef): number {
  return invoices
    .filter((inv) => isLive(inv) && inMonth(issuedOn(inv), ref))
    .reduce((s, inv) => s + Number(inv.total || 0), 0);
}
