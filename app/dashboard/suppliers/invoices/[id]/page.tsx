"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import Loading from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import {
  getReceivedInvoice,
  updateReceivedInvoice,
  registerSupplierPayment,
  getSupplierPayments,
  receivedInvoiceStatusLabels,
  paymentMethodLabels,
  type ReceivedInvoice,
  type SupplierPayment,
} from "@/lib/suppliers";

export default function ReceivedInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();

  const [invoice, setInvoice] = useState<ReceivedInvoice | null>(null);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transferencia");
  const [paymentRef, setPaymentRef] = useState("");
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    async function doLoad() {
      const { data: inv } = await getReceivedInvoice(supabase, id);
      if (!inv) { router.push("/dashboard/suppliers/invoices"); return; }
      setInvoice(inv);  

      const pays = await getSupplierPayments(supabase, id);
      setPayments(pays);  
      setLoading(false);  
    }
    doLoad();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStatusChange(newStatus: string) {
    if (!invoice) return;
    const { data } = await updateReceivedInvoice(supabase, id, { status: newStatus });
    if (data) setInvoice(data);
  }

  async function handleRegisterPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      toast.error("Introduce un importe válido");
      return;
    }

    setRegistering(true);
    const result = await registerSupplierPayment(supabase, {
      received_invoice_id: invoice.id,
      supplier_id: invoice.supplier_id || "",
      amount,
      payment_method: paymentMethod,
      reference: paymentRef || undefined,
    });

    if (result.success) {
      const newPaid = Number(invoice.amount_paid || 0) + amount;
      const newStatus = newPaid >= Number(invoice.total) ? "paid" : "partial";
      setInvoice({ ...invoice, amount_paid: newPaid, payment_status: newStatus, status: newStatus } as ReceivedInvoice);
      const updatedPayments = await getSupplierPayments(supabase, invoice.id);
      setPayments(updatedPayments);
      setShowPaymentForm(false);
      setPaymentAmount("");
      setPaymentRef("");
      toast.success("Pago registrado");
    } else {
      toast.error("Error al registrar el pago", {
        description: result.error || undefined,
      });
    }
    setRegistering(false);
  }

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("es-ES") : "—";

  if (loading) return <Loading />;
  if (!invoice) return null;

  const remaining = Number(invoice.total) - Number(invoice.amount_paid || 0);
  const paidPct = Number(invoice.total) > 0
    ? Math.round((Number(invoice.amount_paid || 0) / Number(invoice.total)) * 100)
    : 0;
  const isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date() && invoice.payment_status !== "paid";
  const st = receivedInvoiceStatusLabels[invoice.status] || { label: invoice.status, color: "" };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={`Factura ${invoice.invoice_number}`}
        description={`${invoice.supplier_name}${invoice.supplier_nif ? ` · ${invoice.supplier_nif}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href="/dashboard/suppliers/invoices">
              <Button variant="secondary">← Facturas</Button>
            </Link>
            {invoice.supplier_id && (
              <Link href={`/dashboard/suppliers/${invoice.supplier_id}`}>
                <Button variant="secondary">Ver proveedor</Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Status + overdue alert */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className={`inline-block text-sm px-3 py-1 rounded-full ${st.color}`}>
          {st.label}
        </span>
        {isOverdue && (
          <span className="text-sm text-red-600 font-medium bg-red-50 px-3 py-1 rounded-full">
            Vencida desde {fmtDate(invoice.due_date)}
          </span>
        )}
        {invoice.payment_status !== "paid" && (
          <div className="flex gap-2 ml-auto">
            {invoice.status === "pending" && (
              <Button size="sm" onClick={() => handleStatusChange("approved")}>Aprobar</Button>
            )}
            {invoice.status === "pending" && (
              <Button size="sm" variant="secondary" onClick={() => handleStatusChange("rejected")}>Rechazar</Button>
            )}
          </div>
        )}
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Desglose económico</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-navy-500">Base imponible</span>
              <span className="text-navy-900">{fmtMoney(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-navy-500">IVA ({invoice.iva_percent}%)</span>
              <span className="text-navy-900">{fmtMoney(invoice.iva_amount)}</span>
            </div>
            {Number(invoice.irpf_percent) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-navy-500">IRPF ({invoice.irpf_percent}%)</span>
                <span className="text-red-600">-{fmtMoney(invoice.irpf_amount)}</span>
              </div>
            )}
            <div className="border-t border-navy-100 dark:border-zinc-800 pt-2 flex justify-between">
              <span className="font-semibold text-navy-900 dark:text-white">Total</span>
              <span className="font-bold text-navy-900 text-lg">{fmtMoney(invoice.total)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Datos de la factura</h3>
          <div className="space-y-2">
            <InfoRow label="Fecha emisión">{fmtDate(invoice.issue_date)}</InfoRow>
            <InfoRow label="Fecha recepción">{fmtDate(invoice.reception_date)}</InfoRow>
            <InfoRow label="Vencimiento">
              <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                {fmtDate(invoice.due_date)}
              </span>
            </InfoRow>
            <InfoRow label="Forma de pago">{paymentMethodLabels[invoice.payment_method || ""] || invoice.payment_method || "—"}</InfoRow>
            {invoice.notes && <InfoRow label="Notas">{invoice.notes}</InfoRow>}
          </div>
        </Card>
      </div>

      {/* Payment progress */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">Control de pagos</h3>
          {invoice.payment_status !== "paid" && (
            <Button size="sm" onClick={() => { setShowPaymentForm(true); setPaymentAmount(String(remaining.toFixed(2))); }}>
              + Registrar pago
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-navy-600">
            Pagado: {fmtMoney(Number(invoice.amount_paid || 0))} de {fmtMoney(invoice.total)}
          </span>
          <span className="text-sm font-semibold">{paidPct}%</span>
        </div>
        <div className="w-full h-3 bg-navy-100 dark:bg-zinc-900 rounded-full overflow-hidden mb-4">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(paidPct, 100)}%`,
              backgroundColor: paidPct >= 100 ? "#00c896" : paidPct >= 50 ? "#3b82f6" : "#f59e0b",
            }}
          />
        </div>

        {remaining > 0 && (
          <p className="text-sm text-orange-600 font-medium">
            Pendiente de pago: {fmtMoney(remaining)}
          </p>
        )}

        {/* Payment form */}
        {showPaymentForm && (
          <form onSubmit={handleRegisterPayment} className="mt-4 p-4 bg-navy-50/60 dark:bg-zinc-900/50 rounded-xl space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FormField label="Importe (€)" required>
                <Input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Método">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {Object.entries(paymentMethodLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Referencia">
                <Input
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="Nº transferencia..."
                />
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={registering}>
                {registering ? "Registrando..." : "Confirmar pago"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowPaymentForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {/* Payment history */}
        {payments.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-navy-600 dark:text-zinc-300 uppercase mb-2">Historial de pagos</h4>
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-white dark:bg-zinc-900 rounded-lg border border-navy-100 dark:border-zinc-800">
                  <div>
                    <span className="text-sm font-medium text-navy-900 dark:text-white">{fmtMoney(p.amount)}</span>
                    <span className="text-xs text-navy-500 dark:text-zinc-400 ml-2">{paymentMethodLabels[p.payment_method] || p.payment_method}</span>
                    {p.reference && <span className="text-xs text-navy-400 dark:text-zinc-500 ml-2">Ref: {p.reference}</span>}
                  </div>
                  <span className="text-xs text-navy-500">{fmtDate(p.payment_date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between">
      <span className="text-sm text-navy-500">{label}</span>
      <span className="text-sm text-navy-900 text-right max-w-[60%]">{children}</span>
    </div>
  );
}
