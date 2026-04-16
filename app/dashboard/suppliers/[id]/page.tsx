/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import Loading from "@/components/ui/loading";
import {
  type Supplier,
  type ReceivedInvoice,
  supplierStatusLabels,
  receivedInvoiceStatusLabels,
  paymentMethodLabels,
} from "@/lib/suppliers";

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [invoices, setInvoices] = useState<ReceivedInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from("suppliers").select("*").eq("id", id).single();
      if (!s) { router.push("/dashboard/suppliers"); return; }
      setSupplier(s as Supplier);

      const { data: inv } = await supabase
        .from("received_invoices")
        .select("*")
        .eq("supplier_id", id)
        .order("issue_date", { ascending: false })
        .limit(20);
      setInvoices((inv || []) as ReceivedInvoice[]);
      setLoading(false);
    }
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("es-ES") : "—";

  if (loading) return <Loading />;
  if (!supplier) return null;

  const pending = Number(supplier.total_invoiced || 0) - Number(supplier.total_paid || 0);
  const paidPct = Number(supplier.total_invoiced) > 0
    ? Math.round((Number(supplier.total_paid) / Number(supplier.total_invoiced)) * 100)
    : 0;

  const statusBadge = supplierStatusLabels[supplier.status] || { label: supplier.status, color: "bg-zinc-800 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-400" };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={supplier.name}
        description={[supplier.nif, supplier.city].filter(Boolean).join(" · ") || "Proveedor"}
        actions={
          <div className="flex gap-2">
            <Link href="/dashboard/suppliers">
              <Button variant="secondary">← Volver</Button>
            </Link>
            <Link href={`/dashboard/suppliers/invoices/new?supplier=${id}`}>
              <Button>+ Nueva factura recibida</Button>
            </Link>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total facturado" value={fmtMoney(Number(supplier.total_invoiced))} accent="blue" />
        <StatCard label="Total pagado" value={fmtMoney(Number(supplier.total_paid))} accent="green" />
        <StatCard label="Pendiente de pago" value={fmtMoney(pending)} accent={pending > 0 ? "yellow" : "green"} />
        <StatCard label="Facturas" value={invoices.length} accent="blue" />
      </div>

      {/* Progress bar */}
      {Number(supplier.total_invoiced) > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-navy-600 dark:text-zinc-400">Progreso de pago</span>
            <span className="text-sm font-semibold text-navy-900 dark:text-white">{paidPct}%</span>
          </div>
          <div className="w-full h-3 bg-navy-100 dark:bg-zinc-900 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(paidPct, 100)}%`,
                backgroundColor: paidPct >= 100 ? "#00c896" : paidPct >= 50 ? "#3b82f6" : "#f59e0b",
              }}
            />
          </div>
        </Card>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Datos generales</h3>
          <div className="space-y-3">
            <InfoRow label="Estado">
              <Badge variant={supplier.status === "active" ? "green" : supplier.status === "blocked" ? "red" : "gray"}>
                {statusBadge.label}
              </Badge>
            </InfoRow>
            {supplier.trade_name && <InfoRow label="Nombre comercial">{supplier.trade_name}</InfoRow>}
            {supplier.nif && <InfoRow label="NIF / CIF">{supplier.nif}</InfoRow>}
            {supplier.contact_person && <InfoRow label="Persona de contacto">{supplier.contact_person}</InfoRow>}
            {supplier.email && <InfoRow label="Email">{supplier.email}</InfoRow>}
            {supplier.phone && <InfoRow label="Teléfono">{supplier.phone}</InfoRow>}
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Condiciones de pago</h3>
          <div className="space-y-3">
            <InfoRow label="Forma de pago">{paymentMethodLabels[supplier.payment_method] || supplier.payment_method}</InfoRow>
            <InfoRow label="Plazo">{supplier.payment_terms_days} días</InfoRow>
            {supplier.iban && <InfoRow label="IBAN">{supplier.iban}</InfoRow>}
            {supplier.address && <InfoRow label="Dirección">{supplier.address}</InfoRow>}
            {(supplier.city || supplier.postal_code || supplier.province) && (
              <InfoRow label="Localidad">
                {[supplier.postal_code, supplier.city, supplier.province].filter(Boolean).join(", ")}
              </InfoRow>
            )}
          </div>
        </Card>
      </div>

      {supplier.notes && (
        <Card className="mb-6">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-2">Notas</h3>
          <p className="text-sm text-navy-700 whitespace-pre-wrap">{supplier.notes}</p>
        </Card>
      )}

      {/* Received invoices */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">Facturas recibidas</h3>
          <Link href={`/dashboard/suppliers/invoices?supplier=${id}`}>
            <span className="text-xs text-brand-green hover:underline cursor-pointer">Ver todas →</span>
          </Link>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-navy-500 dark:text-zinc-400 py-4 text-center">Sin facturas registradas de este proveedor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50/60 dark:bg-zinc-900/50">
                  <th className="text-left text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-4 py-2">Nº Factura</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2">Fecha</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2">Vencimiento</th>
                  <th className="text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2">Total</th>
                  <th className="text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2">Pagado</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const st = receivedInvoiceStatusLabels[inv.status] || { label: inv.status, color: "" };
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.payment_status !== "paid";
                  return (
                    <tr key={inv.id} className="border-b border-navy-100 dark:border-zinc-800 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition">
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/suppliers/invoices/${inv.id}`} className="text-sm font-medium text-brand-green hover:underline">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm text-navy-600 dark:text-zinc-400">{fmtDate(inv.issue_date)}</td>
                      <td className="px-3 py-2.5 text-center text-sm">
                        <span className={isOverdue ? "text-red-600 font-medium" : "text-navy-600 dark:text-zinc-400"}>
                          {fmtDate(inv.due_date)}
                          {isOverdue && " ⚠"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-navy-900 dark:text-white">{fmtMoney(inv.total)}</td>
                      <td className="px-3 py-2.5 text-right text-sm text-navy-600 dark:text-zinc-400">{fmtMoney(inv.amount_paid)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
