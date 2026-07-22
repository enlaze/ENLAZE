"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

/* ─── Types ─── */

interface InvoiceRow {
  number: string;
  supplier?: string;
  client?: string;
  nif: string;
  date: string;
  base: number;
  iva_pct: number;
  iva: number;
  irpf_pct: number;
  irpf: number;
  total: number;
  status: string;
}

interface Totals {
  count: number;
  base: number;
  iva: number;
  irpf: number;
  total: number;
}

interface PdfData {
  companyName: string;
  companyNif: string;
  periodLabel: string;
  type: string;
  received: InvoiceRow[];
  issued: InvoiceRow[];
  totals: {
    received: Totals;
    issued: Totals;
  };
}

/* ─── Helpers ─── */

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDate(d: string) {
  if (!d) return "";
  try {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  } catch {
    return d;
  }
}

const STATUS_LABELS: Record<string, string> = {
  paid: "Pagada",
  pending: "Pendiente",
  overdue: "Vencida",
  cancelled: "Anulada",
};

/* ─── Print Report Component ─── */

function PrintReport() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<PdfData | null>(null);
  const [error, setError] = useState("");
  const [printed, setPrinted] = useState(false);

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("type", searchParams.get("type") || "all");
    params.set("period", searchParams.get("period") || "year");
    params.set("year", searchParams.get("year") || new Date().getFullYear().toString());
    const month = searchParams.get("month");
    const quarter = searchParams.get("quarter");
    if (month) params.set("month", month);
    if (quarter) params.set("quarter", quarter);

    try {
      const res = await fetch(`/api/contabilidad/pdf?${params}`);
      if (!res.ok) throw new Error("Error al obtener datos");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }, [searchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-print once data is loaded
  useEffect(() => {
    if (data && !printed) {
      setPrinted(true);
      setTimeout(() => window.print(), 500);
    }
  }, [data, printed]);

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>
        <p style={{ color: "#dc2626", fontSize: 18 }}>Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>
        <p style={{ fontSize: 18, color: "#3b5068" }}>Generando informe...</p>
      </div>
    );
  }

  const resultadoIva = data.totals.issued.iva - data.totals.received.iva;
  const resultadoNeto = data.totals.issued.total - data.totals.received.total;
  const now = new Date();
  const generatedDate = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 12mm 15mm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f2744; background: #fff; }
        .container { max-width: 210mm; margin: 0 auto; padding: 10mm; }

        /* Header */
        .header { background: #0f2744; border-radius: 6px; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .header-left { display: flex; align-items: center; gap: 20px; }
        .logo { color: #00c896; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
        .header-title { color: #fff; }
        .header-title h1 { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
        .header-title p { font-size: 12px; opacity: 0.85; }
        .header-right { text-align: right; color: #fff; }
        .header-right p { font-size: 11px; opacity: 0.85; }
        .generated { font-size: 9px; color: #8899a8; text-align: right; margin-bottom: 14px; }

        /* KPI Cards */
        .kpis { display: flex; gap: 10px; margin-bottom: 16px; }
        .kpi { flex: 1; background: #f4f7fa; border-radius: 6px; padding: 12px 14px; }
        .kpi-label { font-size: 9px; color: #8899a8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .kpi-value { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
        .kpi-sub { font-size: 9px; color: #8899a8; }
        .kpi-red .kpi-value { color: #dc2626; }
        .kpi-green .kpi-value { color: #16a34a; }
        .kpi-brand .kpi-value { color: #00c896; }

        /* Tables */
        .section-title { font-size: 12px; font-weight: 700; margin-bottom: 6px; padding-left: 2px; }
        .section-title.red { color: #dc2626; }
        .section-title.green { color: #16a34a; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; }
        thead th { background: #0f2744; color: #fff; padding: 6px 8px; font-weight: 600; font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
        thead th:first-child { border-radius: 4px 0 0 0; }
        thead th:last-child { border-radius: 0 4px 0 0; }
        tbody tr:nth-child(even) { background: #f4f7fa; }
        tbody td { padding: 5px 8px; color: #3b5068; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .totals-row { background: #0f2744 !important; color: #fff !important; font-weight: 700; }
        .totals-row td { color: #fff !important; padding: 7px 8px; }

        /* Fiscal Summary */
        .fiscal { display: flex; gap: 12px; margin-top: 16px; }
        .fiscal-box { flex: 1; background: #f4f7fa; border-radius: 6px; padding: 14px 16px; }
        .fiscal-title { font-size: 11px; font-weight: 700; color: #0f2744; margin-bottom: 8px; border-bottom: 2px solid #00c896; padding-bottom: 4px; }
        .fiscal-row { display: flex; justify-content: space-between; font-size: 10px; color: #3b5068; margin-bottom: 4px; }
        .fiscal-result { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid #d1d9e0; }
        .fiscal-result.positive { color: #dc2626; }
        .fiscal-result.negative { color: #16a34a; }

        /* Footer */
        .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e8eef4; display: flex; justify-content: space-between; font-size: 8px; color: #8899a8; }

        /* Print button */
        .print-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #0f2744; padding: 12px 24px; display: flex; justify-content: center; gap: 12px; z-index: 1000; }
        .print-bar button { padding: 8px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
        .btn-print { background: #00c896; color: #fff; }
        .btn-print:hover { background: #00b085; }
        .btn-close { background: #3b5068; color: #fff; }
        .btn-close:hover { background: #4a6078; }
      `}</style>

      {/* Print action bar (hidden when printing) */}
      <div className="print-bar no-print">
        <button className="btn-print" onClick={() => window.print()}>
          Imprimir / Guardar como PDF
        </button>
        <button className="btn-close" onClick={() => window.close()}>
          Cerrar
        </button>
      </div>

      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="header-left">
            <span className="logo">Enlaze</span>
            <div className="header-title">
              <h1>Informe Contable</h1>
              <p>Periodo: {data.periodLabel}</p>
            </div>
          </div>
          <div className="header-right">
            <p>{data.companyName}</p>
            {data.companyNif && <p>NIF: {data.companyNif}</p>}
          </div>
        </div>
        <p className="generated">Generado: {generatedDate}</p>

        {/* KPI Cards */}
        <div className="kpis">
          <div className="kpi kpi-red">
            <div className="kpi-label">Facturas recibidas</div>
            <div className="kpi-value">{eur(data.totals.received.total)}</div>
            <div className="kpi-sub">{data.totals.received.count} facturas</div>
          </div>
          <div className="kpi kpi-green">
            <div className="kpi-label">Facturas emitidas</div>
            <div className="kpi-value">{eur(data.totals.issued.total)}</div>
            <div className="kpi-sub">{data.totals.issued.count} facturas</div>
          </div>
          <div className="kpi kpi-brand">
            <div className="kpi-label">Resultado IVA</div>
            <div className="kpi-value">{eur(resultadoIva)}</div>
            <div className="kpi-sub">IVA repercutido - IVA soportado</div>
          </div>
        </div>

        {/* Received Invoices Table */}
        {data.received.length > 0 && (
          <>
            <p className="section-title red">Facturas recibidas ({data.received.length})</p>
            <table>
              <thead>
                <tr>
                  <th>N. Factura</th>
                  <th>Proveedor</th>
                  <th>NIF</th>
                  <th className="text-center">Fecha</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">IVA</th>
                  <th className="text-right">IRPF</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.received.map((inv, i) => (
                  <tr key={i}>
                    <td>{inv.number}</td>
                    <td>{(inv.supplier || "").substring(0, 24)}</td>
                    <td>{inv.nif}</td>
                    <td className="text-center">{fmtDate(inv.date)}</td>
                    <td className="text-right">{eur(inv.base)}</td>
                    <td className="text-right">{eur(inv.iva)}</td>
                    <td className="text-right">{eur(inv.irpf)}</td>
                    <td className="text-right">{eur(inv.total)}</td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan={4}>Total recibidas</td>
                  <td className="text-right">{eur(data.totals.received.base)}</td>
                  <td className="text-right">{eur(data.totals.received.iva)}</td>
                  <td className="text-right">{eur(data.totals.received.irpf)}</td>
                  <td className="text-right">{eur(data.totals.received.total)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* Issued Invoices Table */}
        {data.issued.length > 0 && (
          <>
            <p className="section-title green" style={{ marginTop: 12 }}>
              Facturas emitidas ({data.issued.length})
            </p>
            <table>
              <thead>
                <tr>
                  <th>N. Factura</th>
                  <th>Cliente</th>
                  <th>NIF</th>
                  <th className="text-center">Fecha</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">IVA</th>
                  <th className="text-right">IRPF</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.issued.map((inv, i) => (
                  <tr key={i}>
                    <td>{inv.number}</td>
                    <td>{(inv.client || "").substring(0, 24)}</td>
                    <td>{inv.nif}</td>
                    <td className="text-center">{fmtDate(inv.date)}</td>
                    <td className="text-right">{eur(inv.base)}</td>
                    <td className="text-right">{eur(inv.iva)}</td>
                    <td className="text-right">{eur(inv.irpf)}</td>
                    <td className="text-right">{eur(inv.total)}</td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan={4}>Total emitidas</td>
                  <td className="text-right">{eur(data.totals.issued.base)}</td>
                  <td className="text-right">{eur(data.totals.issued.iva)}</td>
                  <td className="text-right">{eur(data.totals.issued.irpf)}</td>
                  <td className="text-right">{eur(data.totals.issued.total)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* Fiscal Summary */}
        <div className="fiscal">
          <div className="fiscal-box">
            <div className="fiscal-title">IVA</div>
            <div className="fiscal-row">
              <span>IVA repercutido (emitidas)</span>
              <span>{eur(data.totals.issued.iva)}</span>
            </div>
            <div className="fiscal-row">
              <span>IVA soportado (recibidas)</span>
              <span>{eur(data.totals.received.iva)}</span>
            </div>
            <div className={`fiscal-result ${resultadoIva > 0 ? "positive" : "negative"}`}>
              <span>Resultado</span>
              <span>
                {eur(resultadoIva)} {resultadoIva > 0 ? "(a ingresar)" : "(a compensar)"}
              </span>
            </div>
          </div>

          <div className="fiscal-box">
            <div className="fiscal-title">IRPF / Retenciones</div>
            <div className="fiscal-row">
              <span>Retenciones recibidas</span>
              <span>{eur(data.totals.received.irpf)}</span>
            </div>
            <div className="fiscal-row">
              <span>Retenciones emitidas</span>
              <span>{eur(data.totals.issued.irpf)}</span>
            </div>
            <div className="fiscal-result">
              <span>Total retenciones</span>
              <span>{eur(data.totals.received.irpf - data.totals.issued.irpf)}</span>
            </div>
          </div>
        </div>

        {/* Resultado Neto */}
        <div className="kpis" style={{ marginTop: 16 }}>
          <div className="kpi" style={{ background: "#0f2744", textAlign: "center" }}>
            <div className="kpi-label" style={{ color: "#8899a8" }}>Resultado neto del periodo</div>
            <div
              className="kpi-value"
              style={{ color: resultadoNeto >= 0 ? "#00c896" : "#dc2626", fontSize: 22 }}
            >
              {eur(resultadoNeto)}
            </div>
            <div className="kpi-sub" style={{ color: "#8899a8" }}>
              Ingresos - Gastos
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <span>Documento generado por Enlace · enlaze.es</span>
          <span>Periodo: {data.periodLabel}</span>
        </div>
      </div>
    </>
  );
}

/* ─── Page with Suspense boundary ─── */

export default function ContabilidadPrintPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>
          <p style={{ fontSize: 18, color: "#3b5068" }}>Cargando...</p>
        </div>
      }
    >
      <PrintReport />
    </Suspense>
  );
}
