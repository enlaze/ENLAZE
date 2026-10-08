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

/** Una línea del desglose por tipos: base, tipo aplicado y cuota repercutida. */
export type VatBreakdownLine = { base: number; rate: number; quota: number };

/**
 * El desglose llega de una columna jsonb, así que no viene tipado.
 *
 * Solo sobreviven las líneas con los tres importes numéricos: media línea
 * acabaría sumando mal en el resumen fiscal, y ahí es mejor no mostrar nada que
 * mostrar una cifra inventada.
 */
export function parseVatBreakdown(value: unknown): VatBreakdownLine[] {
  if (!Array.isArray(value)) return [];
  const lines: VatBreakdownLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const line = raw as Record<string, unknown>;
    const base = Number(line.base);
    const rate = Number(line.rate);
    const quota = Number(line.quota);
    if (!Number.isFinite(base) || !Number.isFinite(rate) || !Number.isFinite(quota)) continue;
    lines.push({ base, rate, quota });
  }
  return lines;
}

/** Suma en céntimos: es la que tiene que cuadrar con subtotal e iva_amount. */
export function vatBreakdownTotals(lines: VatBreakdownLine[]) {
  const cents = (n: number) => Math.round(Number(n || 0) * 100);
  return {
    base: lines.reduce((sum, line) => sum + cents(line.base), 0) / 100,
    quota: lines.reduce((sum, line) => sum + cents(line.quota), 0) / 100,
  };
}

/** Número que puso la migración a la factura heredada que no traía ninguno. */
const PLACEHOLDER_NUMBER = /^SIN-NUMERO-/;

type ComplianceInput = Pick<
  ReceivedInvoiceRow,
  "invoice_number" | "supplier_name" | "supplier_nif" | "subtotal" | "iva_percent" | "iva_amount"
> &
  Partial<Pick<ReceivedInvoiceRow, "supplier_address" | "description" | "vat_breakdown">>;

/**
 * Datos que le faltan a la factura para que el IVA soportado sea deducible.
 *
 * Es el contenido obligatorio de la factura completa (art. 6 del RD 1619/2012,
 * recogido en el manual de IVA de la AEAT), limitado a lo que este registro
 * guarda: lo que pone o no pone el papel del proveedor no se puede adivinar
 * desde aquí, pero sí se puede avisar de lo que no se ha anotado.
 *
 * Devuelve avisos, no errores: una factura incompleta se guarda igual y se
 * marca, porque el arreglo está en pedirle al proveedor una factura correcta.
 */
export function receivedInvoiceComplianceIssues(invoice: ComplianceInput): string[] {
  const issues: string[] = [];
  const blank = (value: string | null | undefined) => !value || !value.trim();

  if (blank(invoice.invoice_number) || PLACEHOLDER_NUMBER.test(invoice.invoice_number)) {
    issues.push("Falta el número de factura");
  }
  if (blank(invoice.supplier_name)) issues.push("Falta el nombre o razón social del proveedor");
  if (blank(invoice.supplier_nif)) issues.push("Falta el NIF del proveedor");
  if (blank(invoice.supplier_address)) issues.push("Falta el domicilio fiscal del proveedor");
  if (blank(invoice.description)) issues.push("Falta la descripción de la operación");
  if (!(Number(invoice.subtotal) > 0)) issues.push("Falta la base imponible");

  const breakdown = parseVatBreakdown(invoice.vat_breakdown);
  if (breakdown.length === 0 && invoice.iva_percent === null) {
    issues.push("Falta el tipo de IVA aplicado");
  }
  // Un tipo distinto de cero sin cuota consignada: la factura no sirve para
  // deducir ese IVA, aunque el total cuadre.
  if (
    breakdown.length === 0 &&
    Number(invoice.iva_percent) > 0 &&
    !(Number(invoice.iva_amount) > 0)
  ) {
    issues.push("Falta la cuota de IVA");
  }

  return issues;
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
  const decimal = (n: number | null) => Number(n || 0).toFixed(2).replace(".", ",");
  const date = (value: string | null | undefined) =>
    text(value ? value.split("-").reverse().join("/") : "");
  // Las columnas legales van al final a propósito: las trece primeras son las
  // que se miran a diario y no cambian de sitio al añadir esto.
  const header = [
    "Nº factura", "Proveedor", "NIF", "Fecha", "Obra", "Categoría", "Base", "%IVA", "IVA",
    "%IRPF", "IRPF", "Total", "Estado",
    "Serie", "Fecha operación", "Domicilio proveedor", "Descripción", "Desglose IVA",
    "Datos que faltan",
  ];
  const rows = invoices.map((invoice) => [
    text(invoice.invoice_number), text(invoice.supplier_name), text(invoice.supplier_nif),
    text(invoice.issue_date.split("-").reverse().join("/")), text(invoice.projects?.name),
    text(expenseCategoryLabels[invoice.category] || invoice.category),
    decimal(invoice.subtotal),
    // Con varios tipos no hay un «%IVA» único que escribir: la columna queda
    // vacía y el detalle sale en «Desglose IVA», en vez de fingir un 0,00.
    parseVatBreakdown(invoice.vat_breakdown).length > 0 ? "" : decimal(invoice.iva_percent),
    decimal(invoice.iva_amount),
    decimal(invoice.irpf_percent), decimal(invoice.irpf_amount), decimal(invoice.total),
    text(receivedInvoiceStatusLabels[invoice.status]?.label || invoice.status),
    text(invoice.invoice_series), date(invoice.operation_date), text(invoice.supplier_address),
    text(invoice.description),
    text(
      parseVatBreakdown(invoice.vat_breakdown)
        .map((line) => `${decimal(line.base)} al ${decimal(line.rate)}% = ${decimal(line.quota)}`)
        .join(" | "),
    ),
    text(receivedInvoiceComplianceIssues(invoice).join(". ")),
  ].join(";"));
  return "\uFEFF" + [header.map(text).join(";"), ...rows].join("\r\n") + "\r\n";
}

/** Payments follow actual amounts, including partial payments, not workflow labels. */
export function receivedInvoiceCostTotals(invoices: { total: number; amount_paid: number | null }[]) {
  const totalCents = invoices.reduce((sum, i) => sum + Math.round(Number(i.total || 0) * 100), 0);
  const paidCents = invoices.reduce((sum, i) => sum + Math.round(Number(i.amount_paid || 0) * 100), 0);
  return { total: totalCents / 100, paid: paidCents / 100, pending: (totalCents - paidCents) / 100 };
}

/** Preserve the accounting screen/report contract while reading the single source. */
export function toFiscalReceivedInvoice(invoice: ReceivedInvoiceRow) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    supplier_name: invoice.supplier_name,
    supplier_nif: invoice.supplier_nif || "",
    invoice_date: invoice.issue_date,
    base_amount: Number(invoice.subtotal || 0),
    iva_percentage: Number(invoice.iva_percent || 0),
    iva_amount: Number(invoice.iva_amount || 0),
    irpf_percentage: Number(invoice.irpf_percent || 0),
    irpf_amount: Number(invoice.irpf_amount || 0),
    total_amount: Number(invoice.total || 0),
    category: invoice.category,
    payment_status: invoice.status,
  };
}
