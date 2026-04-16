/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { recordFiscalEvent, getFiscalTimeline } from "@/lib/fiscal-events";
import type { FiscalEventType } from "@/lib/fiscal-events";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notifications";
import { registerPayment, getInvoicePayments, paymentMethodLabels, type Payment } from "@/lib/payments";

/* ═══════════════ Types ═══════════════ */

interface IssuedInvoice {
  id: string; user_id: string; client_id: string | null; project_id: string | null; budget_id: string | null;
  series: string; number: number; invoice_number: string;
  issuer_name: string; issuer_nif: string; issuer_address: string;
  client_name: string; client_nif: string; client_address: string; client_email: string;
  issue_date: string; due_date: string | null; operation_date: string | null;
  subtotal: number; iva_percent: number; iva_amount: number;
  irpf_percent: number; irpf_amount: number; total: number;
  status: string; payment_status: string; payment_date: string | null; payment_method: string;
  amount_paid: number;
  verifactu_hash: string; verifactu_prev_hash: string; verifactu_qr_data: string; verifactu_registered: boolean;
  facturae_xml: string; notes: string;
}

interface InvoiceLine {
  id: string; invoice_id: string; description: string; unit: string;
  quantity: number; unit_price: number; discount_percent: number; total: number; sort_order: number;
}

/* ═══════════════ Labels ═══════════════ */

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-zinc-900/30 text-zinc-300 dark:bg-zinc-900/50 dark:text-zinc-400" },
  issued: { label: "Emitida", color: "bg-blue-900/30 text-blue-300" },
  sent: { label: "Enviada", color: "bg-purple-900/30 text-purple-300" },
  paid: { label: "Cobrada", color: "bg-green-900/30 text-green-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
  cancelled: { label: "Anulada", color: "bg-zinc-900/30 text-zinc-400 dark:bg-zinc-900/50 dark:text-zinc-500" },
  rectified: { label: "Rectificada", color: "bg-orange-900/30 text-orange-300" },
};

const unitOptions = ["ud", "m", "m²", "m³", "kg", "l", "h", "ml", "global"];

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

/* ═══════════════ Facturae XML Generator ═══════════════ */

function generateFacturaeXML(inv: IssuedInvoice, lines: InvoiceLine[]): string {
  const xmlLines = lines.map((l) => `
        <InvoiceLine>
          <ItemDescription>${escXml(l.description)}</ItemDescription>
          <Quantity>${l.quantity}</Quantity>
          <UnitOfMeasure>${l.unit === "ud" ? "01" : "33"}</UnitOfMeasure>
          <UnitPriceWithoutTax>${Number(l.unit_price).toFixed(2)}</UnitPriceWithoutTax>
          <TotalCost>${Number(l.total).toFixed(2)}</TotalCost>
          <DiscountRate>${Number(l.discount_percent).toFixed(2)}</DiscountRate>
          <GrossAmount>${Number(l.total).toFixed(2)}</GrossAmount>
        </InvoiceLine>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Facturae xmlns="http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml">
  <FileHeader>
    <SchemaVersion>3.2.2</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
  </FileHeader>
  <Parties>
    <SellerParty>
      <TaxIdentification>
        <PersonTypeCode>J</PersonTypeCode>
        <ResidenceTypeCode>R</ResidenceTypeCode>
        <TaxIdentificationNumber>${escXml(inv.issuer_nif)}</TaxIdentificationNumber>
      </TaxIdentification>
      <LegalEntity>
        <CorporateName>${escXml(inv.issuer_name)}</CorporateName>
        <AddressInSpain>
          <Address>${escXml(inv.issuer_address)}</Address>
          <PostCode>00000</PostCode>
          <Town>-</Town>
          <Province>-</Province>
          <CountryCode>ESP</CountryCode>
        </AddressInSpain>
      </LegalEntity>
    </SellerParty>
    <BuyerParty>
      <TaxIdentification>
        <PersonTypeCode>${inv.client_nif && inv.client_nif.length > 0 && inv.client_nif[0].match(/[A-H,J,N,P-S,U,V,W]/) ? "J" : "F"}</PersonTypeCode>
        <ResidenceTypeCode>R</ResidenceTypeCode>
        <TaxIdentificationNumber>${escXml(inv.client_nif || "")}</TaxIdentificationNumber>
      </TaxIdentification>
      <LegalEntity>
        <CorporateName>${escXml(inv.client_name)}</CorporateName>
        <AddressInSpain>
          <Address>${escXml(inv.client_address || "-")}</Address>
          <PostCode>00000</PostCode>
          <Town>-</Town>
          <Province>-</Province>
          <CountryCode>ESP</CountryCode>
        </AddressInSpain>
      </LegalEntity>
    </BuyerParty>
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>${escXml(inv.invoice_number)}</InvoiceNumber>
        <InvoiceSeriesCode>${escXml(inv.series)}</InvoiceSeriesCode>
        <InvoiceDocumentType>FC</InvoiceDocumentType>
        <InvoiceClass>OO</InvoiceClass>
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>${inv.issue_date}</IssueDate>
        <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
        <TaxCurrencyCode>EUR</TaxCurrencyCode>
        <LanguageName>es</LanguageName>
      </InvoiceIssueData>
      <TaxesOutputs>
        <Tax>
          <TaxTypeCode>01</TaxTypeCode>
          <TaxRate>${Number(inv.iva_percent).toFixed(2)}</TaxRate>
          <TaxableBase><TotalAmount>${Number(inv.subtotal).toFixed(2)}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${Number(inv.iva_amount).toFixed(2)}</TotalAmount></TaxAmount>
        </Tax>
      </TaxesOutputs>${Number(inv.irpf_percent) > 0 ? `
      <TaxesWithheld>
        <Tax>
          <TaxTypeCode>04</TaxTypeCode>
          <TaxRate>${Number(inv.irpf_percent).toFixed(2)}</TaxRate>
          <TaxableBase><TotalAmount>${Number(inv.subtotal).toFixed(2)}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${Number(inv.irpf_amount).toFixed(2)}</TotalAmount></TaxAmount>
        </Tax>
      </TaxesWithheld>` : ""}
      <InvoiceTotals>
        <TotalGrossAmount>${Number(inv.subtotal).toFixed(2)}</TotalGrossAmount>
        <TotalGrossAmountBeforeTaxes>${Number(inv.subtotal).toFixed(2)}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${Number(inv.iva_amount).toFixed(2)}</TotalTaxOutputs>
        <TotalTaxesWithheld>${Number(inv.irpf_amount).toFixed(2)}</TotalTaxesWithheld>
        <InvoiceTotal>${Number(inv.total).toFixed(2)}</InvoiceTotal>
        <TotalExecutableAmount>${Number(inv.total).toFixed(2)}</TotalExecutableAmount>
      </InvoiceTotals>
      <Items>${xmlLines}
      </Items>
    </Invoice>
  </Invoices>
</Facturae>`;
}

function escXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ═══════════════ Page ═══════════════ */

export default function IssuedInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const [invoice, setInvoice] = useState<IssuedInvoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(true);

  const [showLineForm, setShowLineForm] = useState(false);
  const [lineForm, setLineForm] = useState({ description: "", unit: "ud", quantity: 1, unit_price: 0, discount_percent: 0 });
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [fiscalTimeline, setFiscalTimeline] = useState<{ id: string; event_type: string; event_data: Record<string, unknown>; created_at: string; label: string; icon: string }[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<Payment[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [registeringPayment, setRegisteringPayment] = useState(false);

  async function loadInvoice() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: inv, error } = await supabase.from("issued_invoices").select("*").eq("id", invoiceId).single();
    if (error || !inv) { router.push("/dashboard/issued-invoices"); return; }
    setInvoice(inv);

    const { data: linesData } = await supabase.from("issued_invoice_lines").select("*").eq("invoice_id", invoiceId).order("sort_order");
    setLines((linesData as InvoiceLine[]) || []);

    // Load fiscal timeline + payments
    const [timeline, payments] = await Promise.all([
      getFiscalTimeline(supabase, invoiceId),
      getInvoicePayments(supabase, invoiceId),
    ]);
    setFiscalTimeline(timeline);
    setInvoicePayments(payments);

    setLoading(false);
  }

  /* ── Recalc totals ── */

  async function recalcTotals(newLines: InvoiceLine[]) {
    if (!invoice) return;
    const subtotal = newLines.reduce((s, l) => s + Number(l.total || 0), 0);
    const iva_amount = subtotal * (Number(invoice.iva_percent) / 100);
    const irpf_amount = subtotal * (Number(invoice.irpf_percent) / 100);
    const total = subtotal + iva_amount - irpf_amount;

    // Recalc Verifactu hash
    const hashInput = `${invoice.invoice_number}|${invoice.issuer_nif}|${total.toFixed(2)}|${invoice.issue_date}|${invoice.verifactu_prev_hash}`;
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const qrData = `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${invoice.issuer_nif}&numserie=${invoice.invoice_number}&fecha=${invoice.issue_date}&importe=${total.toFixed(2)}`;

    await supabase.from("issued_invoices").update({
      subtotal, iva_amount, irpf_amount, total,
      verifactu_hash: hash, verifactu_qr_data: qrData,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);

    setInvoice({ ...invoice, subtotal, iva_amount, irpf_amount, total, verifactu_hash: hash, verifactu_qr_data: qrData });
  }

  /* ── CRUD Lines ── */

  async function handleSaveLine() {
    if (!invoice) return;
    if (!lineForm.description.trim()) { alert("La descripción es obligatoria."); return; }
    setSavingLine(true);

    const gross = lineForm.quantity * lineForm.unit_price;
    const lineTotal = gross * (1 - lineForm.discount_percent / 100);

    if (editingLineId) {
      await supabase.from("issued_invoice_lines").update({
        description: lineForm.description.trim(), unit: lineForm.unit,
        quantity: lineForm.quantity, unit_price: lineForm.unit_price,
        discount_percent: lineForm.discount_percent, total: lineTotal,
      }).eq("id", editingLineId);
    } else {
      await supabase.from("issued_invoice_lines").insert({
        invoice_id: invoice.id, description: lineForm.description.trim(), unit: lineForm.unit,
        quantity: lineForm.quantity, unit_price: lineForm.unit_price,
        discount_percent: lineForm.discount_percent, total: lineTotal,
        sort_order: lines.length,
      });
    }

    const { data } = await supabase.from("issued_invoice_lines").select("*").eq("invoice_id", invoice.id).order("sort_order");
    const newLines = (data as InvoiceLine[]) || [];
    setLines(newLines);
    await recalcTotals(newLines);

    setLineForm({ description: "", unit: "ud", quantity: 1, unit_price: 0, discount_percent: 0 });
    setEditingLineId(null);
    setShowLineForm(false);
    setSavingLine(false);
  }

  function startEditLine(l: InvoiceLine) {
    setLineForm({ description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, discount_percent: l.discount_percent });
    setEditingLineId(l.id);
    setShowLineForm(true);
  }

  async function handleDeleteLine(id: string) {
    if (!confirm("¿Eliminar esta línea?")) return;
    await supabase.from("issued_invoice_lines").delete().eq("id", id);
    const newLines = lines.filter((l) => l.id !== id);
    setLines(newLines);
    await recalcTotals(newLines);
  }

  /* ── Status / actions ── */

  async function handleStatusChange(newStatus: string) {
    if (!invoice) return;
    setSavingStatus(true);
    const updates: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "paid") {
      updates.payment_status = "paid";
      updates.payment_date = new Date().toISOString().split("T")[0];
    }
    if (newStatus === "cancelled") {
      updates.cancelled_at = new Date().toISOString();
    }
    await supabase.from("issued_invoices").update(updates).eq("id", invoice.id);
    setInvoice({ ...invoice, ...updates } as IssuedInvoice);

    // Record fiscal event (fire-and-forget)
    const eventMap: Record<string, FiscalEventType> = {
      issued: "issued", sent: "sent", paid: "paid",
      cancelled: "cancelled", rectified: "corrected",
    };
    const eventType = eventMap[newStatus];
    if (eventType) {
      recordFiscalEvent(supabase, {
        invoice_id: invoice.id,
        event_type: eventType,
        event_data: { previous_status: invoice.status, new_status: newStatus },
      });
      // Refresh timeline
      getFiscalTimeline(supabase, invoice.id).then(setFiscalTimeline);
    }

    logActivity(supabase, {
      action: "issued_invoice.status_changed",
      entity_type: "issued_invoice",
      entity_id: invoice.id,
      metadata: { from: invoice.status, to: newStatus, invoice_number: invoice.invoice_number },
    });

    // Fire-and-forget notification
    const invoiceNotifMap: Record<string, { type: "invoice_paid" | "invoice_due" | "compliance_alert"; title: string; severity: "success" | "warning" | "error" | "info" }> = {
      paid: { type: "invoice_paid", title: `Factura ${invoice.invoice_number} marcada como pagada`, severity: "success" },
      sent: { type: "invoice_due", title: `Factura ${invoice.invoice_number} enviada al cliente`, severity: "info" },
      cancelled: { type: "compliance_alert", title: `Factura ${invoice.invoice_number} anulada`, severity: "error" },
      rectified: { type: "compliance_alert", title: `Factura ${invoice.invoice_number} rectificada`, severity: "warning" },
    };
    if (invoiceNotifMap[newStatus]) {
      notify(supabase, {
        ...invoiceNotifMap[newStatus],
        entity_type: "issued_invoice",
        entity_id: invoice.id,
        action_url: `/dashboard/issued-invoices/${invoice.id}`,
      });
    }

    setSavingStatus(false);
  }

  async function handleRegisterPayment() {
    if (!invoice || !paymentAmount) return;
    setRegisteringPayment(true);
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Introduce un importe válido");
      setRegisteringPayment(false);
      return;
    }

    const result = await registerPayment(supabase, {
      invoice_id: invoice.id,
      amount,
      payment_date: new Date().toISOString().split("T")[0],
      payment_method: paymentMethod,
      reference: paymentRef || undefined,
    });

    if (result.success) {
      // Refresh invoice and payments
      const newPaid = Number(invoice.amount_paid || 0) + amount;
      const newStatus = newPaid >= Number(invoice.total) ? "paid" : "partial";
      setInvoice({ ...invoice, amount_paid: newPaid, payment_status: newStatus } as IssuedInvoice);
      const updatedPayments = await getInvoicePayments(supabase, invoice.id);
      setInvoicePayments(updatedPayments);
      setShowPaymentForm(false);
      setPaymentAmount("");
      setPaymentRef("");
    } else {
      alert(result.error || "Error al registrar el cobro");
    }
    setRegisteringPayment(false);
  }

  async function handleDownloadXML() {
    if (!invoice) return;
    const xml = generateFacturaeXML(invoice, lines);
    // Save XML to DB
    await supabase.from("issued_invoices").update({
      facturae_xml: xml,
      xml_version: "3.2.2",
    }).eq("id", invoice.id);

    // Record fiscal events (fire-and-forget)
    recordFiscalEvent(supabase, {
      invoice_id: invoice.id,
      event_type: "xml_generated",
      event_data: { facturae_version: "3.2.2", lines_count: lines.length },
    });
    if (invoice.verifactu_hash) {
      recordFiscalEvent(supabase, {
        invoice_id: invoice.id,
        event_type: "hash_generated",
        event_data: { hash: invoice.verifactu_hash, prev_hash: invoice.verifactu_prev_hash },
      });
    }
    getFiscalTimeline(supabase, invoice.id).then(setFiscalTimeline);

    // Download
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${invoice.invoice_number.replace(/\//g, "-")}.xml`;
    a.click(); URL.revokeObjectURL(url);
  }

  function handlePrintPDF() {
    window.print();
  }

  useEffect(() => { loadInvoice(); }, []);

  /* ── Render ── */

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;
  }
  if (!invoice) return null;

  const st = statusMap[invoice.status] || { label: invoice.status, color: "bg-zinc-900/30 text-zinc-300 dark:bg-zinc-900/50 dark:text-zinc-400" };
  const gross = lineForm.quantity * lineForm.unit_price;
  const linePreview = gross * (1 - lineForm.discount_percent / 100);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <Link href="/dashboard/issued-invoices" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block print:hidden">← Volver a facturas emitidas</Link>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)] font-mono">{invoice.invoice_number}</h1>
          <p className="text-sm text-[var(--color-navy-400)]">Emitida: {fmtDate(invoice.issue_date)}{invoice.due_date ? ` · Vto: ${fmtDate(invoice.due_date)}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${st.color}`}>{st.label}</span>
          <select value={invoice.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={savingStatus}
            className="bg-[var(--color-navy-700)] text-[var(--color-navy-200)] rounded-lg px-3 py-1.5 text-sm border border-[var(--color-navy-600)]">
            {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {/* Issuer / Client cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2 uppercase">Emisor</p>
          <p className="text-sm font-medium text-[var(--color-navy-100)]">{invoice.issuer_name}</p>
          <p className="text-xs text-[var(--color-navy-500)]">NIF: {invoice.issuer_nif}</p>
          <p className="text-xs text-[var(--color-navy-500)]">{invoice.issuer_address}</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2 uppercase">Cliente</p>
          <p className="text-sm font-medium text-[var(--color-navy-100)]">{invoice.client_name}</p>
          {invoice.client_nif && <p className="text-xs text-[var(--color-navy-500)]">NIF: {invoice.client_nif}</p>}
          {invoice.client_address && <p className="text-xs text-[var(--color-navy-500)]">{invoice.client_address}</p>}
          {invoice.client_email && <p className="text-xs text-[var(--color-navy-500)]">{invoice.client_email}</p>}
        </div>
      </div>

      {/* Lines */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Líneas ({lines.length})</h3>
          {invoice.status === "draft" && (
            <button onClick={() => { setLineForm({ description: "", unit: "ud", quantity: 1, unit_price: 0, discount_percent: 0 }); setEditingLineId(null); setShowLineForm(!showLineForm); }}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Añadir línea
            </button>
          )}
        </div>

        {showLineForm && (
          <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)] print:hidden">
            <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
              <div className="md:col-span-3">
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Descripción *</label>
                <input type="text" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} className={inputCls} placeholder="Concepto" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Ud.</label>
                <select value={lineForm.unit} onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })} className={inputCls}>
                  {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cantidad</label>
                <input type="number" step="0.001" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Precio ud.</label>
                <input type="number" step="0.01" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Dto. %</label>
                <input type="number" step="0.01" value={lineForm.discount_percent} onChange={(e) => setLineForm({ ...lineForm, discount_percent: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[var(--color-navy-400)]">Total línea: <strong className="text-[var(--color-navy-100)]">{eur(linePreview)}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => { setShowLineForm(false); setEditingLineId(null); }} className="px-4 py-2 text-sm text-[var(--color-navy-400)]">Cancelar</button>
                <button onClick={handleSaveLine} disabled={savingLine}
                  className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                  {savingLine ? "..." : editingLineId ? "Guardar" : "Añadir"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          {lines.length === 0 ? (
            <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">Añade líneas a esta factura.</p></div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-navy-700)]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Concepto</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase">Ud.</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Cant.</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Precio</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Dto.</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase print:hidden">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-4 py-3 text-[var(--color-navy-500)]">{idx + 1}</td>
                      <td className="px-4 py-3 text-[var(--color-navy-100)]">{l.description}</td>
                      <td className="px-4 py-3 text-center text-[var(--color-navy-400)]">{l.unit}</td>
                      <td className="px-4 py-3 text-right text-[var(--color-navy-300)]">{Number(l.quantity).toLocaleString("es-ES")}</td>
                      <td className="px-4 py-3 text-right text-[var(--color-navy-300)]">{eur(l.unit_price)}</td>
                      <td className="px-4 py-3 text-right text-[var(--color-navy-400)]">{l.discount_percent > 0 ? `${l.discount_percent}%` : "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(l.total)}</td>
                      <td className="px-4 py-3 text-right print:hidden">
                        {invoice.status === "draft" && (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => startEditLine(l)} className="text-xs text-[var(--color-brand-green)] hover:underline">Editar</button>
                            <button onClick={() => handleDeleteLine(l.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totals */}
              <div className="border-t border-[var(--color-navy-700)] p-4">
                <div className="flex justify-end">
                  <div className="text-right text-sm space-y-1 min-w-[250px]">
                    <div className="flex justify-between"><span className="text-[var(--color-navy-400)]">Subtotal</span><span className="text-[var(--color-navy-100)]">{eur(invoice.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-navy-400)]">IVA ({invoice.iva_percent}%)</span><span className="text-[var(--color-navy-100)]">{eur(invoice.iva_amount)}</span></div>
                    {Number(invoice.irpf_percent) > 0 && (
                      <div className="flex justify-between"><span className="text-red-400">IRPF (-{invoice.irpf_percent}%)</span><span className="text-red-400">-{eur(invoice.irpf_amount)}</span></div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-[var(--color-navy-700)]">
                      <span className="text-[var(--color-navy-200)] font-bold text-base">TOTAL</span>
                      <span className="text-[var(--color-brand-green)] font-bold text-base">{eur(invoice.total)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Verifactu info */}
      {invoice.verifactu_registered && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-emerald-500/20">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Verifactu</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-[var(--color-navy-400)] mb-1">Hash SHA-256</p>
              <p className="text-xs text-[var(--color-navy-300)] font-mono break-all bg-[var(--color-navy-700)] rounded p-2">{invoice.verifactu_hash || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-navy-400)] mb-1">Hash anterior</p>
              <p className="text-xs text-[var(--color-navy-500)] font-mono break-all bg-[var(--color-navy-700)] rounded p-2">{invoice.verifactu_prev_hash || "0"}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-[var(--color-navy-400)] mb-1">URL verificación QR</p>
              <p className="text-xs text-[var(--color-navy-300)] font-mono break-all bg-[var(--color-navy-700)] rounded p-2">{invoice.verifactu_qr_data || "—"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Fiscal Traceability Timeline */}
      {fiscalTimeline.length > 0 && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Trazabilidad fiscal</h3>
          <div className="space-y-0">
            {fiscalTimeline.map((ev, idx) => {
              const isLast = idx === fiscalTimeline.length - 1;
              return (
                <div key={ev.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-navy-700)] flex items-center justify-center text-sm flex-shrink-0">
                      {ev.icon}
                    </div>
                    {!isLast && <div className="w-0.5 flex-1 min-h-[16px] bg-[var(--color-navy-700)]" />}
                  </div>
                  <div className="pb-4 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-navy-100)]">{ev.label}</p>
                    <p className="text-xs text-[var(--color-navy-500)]">
                      {new Date(ev.created_at).toLocaleDateString("es-ES", {
                        day: "2-digit", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                    {ev.event_data && Object.keys(ev.event_data).length > 0 && ev.event_type === "hash_generated" && (
                      <p className="text-xs text-[var(--color-navy-600)] font-mono mt-0.5 truncate max-w-md">
                        {(ev.event_data as Record<string, string>).hash?.substring(0, 32)}...
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Section */}
      {invoice.payment_status !== "paid" && invoice.status !== "cancelled" && invoice.status !== "draft" && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Cobros</h3>
            <button
              onClick={() => setShowPaymentForm(!showPaymentForm)}
              className="px-3 py-1.5 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-xs font-semibold hover:opacity-90 transition"
            >
              {showPaymentForm ? "Cancelar" : "+ Registrar cobro"}
            </button>
          </div>

          {/* Payment progress */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--color-navy-400)]">Cobrado</span>
              <span className="text-[var(--color-navy-300)] tabular-nums">
                €{Number(invoice.amount_paid || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} / €{Number(invoice.total).toLocaleString("es-ES", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--color-navy-700)]">
              <div
                className="h-2 rounded-full bg-[var(--color-brand-green)] transition-all"
                style={{ width: `${Math.min(100, Math.round((Number(invoice.amount_paid || 0) / Number(invoice.total)) * 100))}%` }}
              />
            </div>
          </div>

          {/* Payment form */}
          {showPaymentForm && (
            <div className="bg-[var(--color-navy-750)] rounded-lg p-4 mb-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-navy-400)] block mb-1">Importe (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={String(Number(invoice.total) - Number(invoice.amount_paid || 0))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-navy-700)] border border-[var(--color-navy-600)] text-[var(--color-navy-100)] text-sm focus:outline-none focus:border-[var(--color-brand-green)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-navy-400)] block mb-1">Método</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-navy-700)] border border-[var(--color-navy-600)] text-[var(--color-navy-100)] text-sm focus:outline-none focus:border-[var(--color-brand-green)]"
                  >
                    {Object.entries(paymentMethodLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--color-navy-400)] block mb-1">Referencia</label>
                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="Ej: TRF-2026-001"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-navy-700)] border border-[var(--color-navy-600)] text-[var(--color-navy-100)] text-sm focus:outline-none focus:border-[var(--color-brand-green)]"
                  />
                </div>
              </div>
              <button
                onClick={handleRegisterPayment}
                disabled={registeringPayment || !paymentAmount}
                className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {registeringPayment ? "Registrando..." : "Confirmar cobro"}
              </button>
            </div>
          )}

          {/* Payment history */}
          {invoicePayments.length > 0 && (
            <div className="space-y-2">
              {invoicePayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-[var(--color-navy-700)] last:border-0">
                  <div>
                    <p className="text-sm text-[var(--color-navy-200)]">
                      {paymentMethodLabels[p.payment_method] || p.payment_method}
                      {p.reference && <span className="ml-2 text-[var(--color-navy-500)] font-mono text-xs">{p.reference}</span>}
                    </p>
                    <p className="text-xs text-[var(--color-navy-500)]">
                      {new Date(p.payment_date).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-brand-green)]">
                    +€{Number(p.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 print:hidden">
        <button onClick={handleDownloadXML}
          className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] border border-[var(--color-navy-600)] rounded-lg text-sm font-medium hover:bg-[var(--color-navy-600)] transition">
          Descargar Facturae XML
        </button>
        <button onClick={handlePrintPDF}
          className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] border border-[var(--color-navy-600)] rounded-lg text-sm font-medium hover:bg-[var(--color-navy-600)] transition">
          Imprimir / PDF
        </button>
        {invoice.status === "draft" && lines.length > 0 && (
          <button onClick={() => handleStatusChange("issued")}
            className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
            Emitir factura
          </button>
        )}
      </div>

      {invoice.notes && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 mt-6">
          <p className="text-xs text-[var(--color-navy-400)] mb-1">Notas</p>
          <p className="text-sm text-[var(--color-navy-300)]">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
