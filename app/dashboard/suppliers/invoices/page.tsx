/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { FormField, Input, Select, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import {
  getReceivedInvoices,
  createReceivedInvoice,
  getExpenseSummary,
  receivedInvoiceStatusLabels,
  paymentMethodLabels,
  type ReceivedInvoice,
  type Supplier,
  type ExpenseSummary,
} from "@/lib/suppliers";

const emptyForm = {
  invoice_number: "",
  supplier_id: "",
  supplier_name: "",
  supplier_nif: "",
  issue_date: new Date().toISOString().split("T")[0],
  due_date: "",
  subtotal: "",
  iva_percent: "21",
  irpf_percent: "0",
  payment_method: "transferencia",
  notes: "",
};

export default function ReceivedInvoicesPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const supplierFilter = searchParams.get("supplier") || "";

  const [invoices, setInvoices] = useState<ReceivedInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function doLoad() {
      const [invoiceResult, summaryResult, suppliersResult] = await Promise.all([
        getReceivedInvoices(supabase, {
          status: statusFilter,
          supplier_id: supplierFilter || undefined,
          search: search || undefined,
          limit: 50,
        }),
        getExpenseSummary(supabase),
        supabase.from("suppliers").select("id, name, nif").eq("status", "active").order("name"),
      ]);

      setInvoices(invoiceResult.data); // eslint-disable-line react-hooks/set-state-in-effect
      setTotal(invoiceResult.count); // eslint-disable-line react-hooks/set-state-in-effect
      setSummary(summaryResult); // eslint-disable-line react-hooks/set-state-in-effect
      setSuppliers((suppliersResult.data || []) as Supplier[]); // eslint-disable-line react-hooks/set-state-in-effect
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
    }
    doLoad();
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [invoiceResult, summaryResult, suppliersResult] = await Promise.all([
      getReceivedInvoices(supabase, {
        status: statusFilter,
        supplier_id: supplierFilter || undefined,
        search: search || undefined,
        limit: 50,
      }),
      getExpenseSummary(supabase),
      supabase.from("suppliers").select("id, name, nif").eq("status", "active").order("name"),
    ]);

    setInvoices(invoiceResult.data);
    setTotal(invoiceResult.count);
    setSummary(summaryResult);
    setSuppliers((suppliersResult.data || []) as Supplier[]);
    setLoading(false);
  }

  function handleSupplierSelect(supplierId: string) {
    const s = suppliers.find((x) => x.id === supplierId);
    if (s) {
      setForm({ ...form, supplier_id: supplierId, supplier_name: s.name, supplier_nif: s.nif || "" });
    } else {
      setForm({ ...form, supplier_id: "", supplier_name: "", supplier_nif: "" });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const subtotal = parseFloat(form.subtotal) || 0;
    const ivaPct = parseFloat(form.iva_percent) || 0;
    const irpfPct = parseFloat(form.irpf_percent) || 0;
    const ivaAmount = subtotal * (ivaPct / 100);
    const irpfAmount = subtotal * (irpfPct / 100);
    const total = subtotal + ivaAmount - irpfAmount;

    const { error } = await createReceivedInvoice(supabase, {
      invoice_number: form.invoice_number,
      supplier_id: form.supplier_id || null,
      supplier_name: form.supplier_name,
      supplier_nif: form.supplier_nif || null,
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      subtotal,
      iva_percent: ivaPct,
      iva_amount: ivaAmount,
      irpf_percent: irpfPct,
      irpf_amount: irpfAmount,
      total,
      payment_method: form.payment_method || null,
      notes: form.notes || null,
    });

    if (!error) {
      setForm(emptyForm);
      setShowForm(false);
      load();
    } else {
      alert("Error al registrar la factura");
    }
    setSaving(false);
  }

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("es-ES") : "—";

  if (loading) return <Loading />;

  const computedSubtotal = parseFloat(form.subtotal) || 0;
  const computedIva = computedSubtotal * ((parseFloat(form.iva_percent) || 0) / 100);
  const computedIrpf = computedSubtotal * ((parseFloat(form.irpf_percent) || 0) / 100);
  const computedTotal = computedSubtotal + computedIva - computedIrpf;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Facturas recibidas"
        count={total}
        countLabel={`factura${total !== 1 ? "s" : ""}`}
        actions={
          <Button onClick={() => { setShowForm(true); setForm(emptyForm); }}>
            + Registrar factura
          </Button>
        }
      />

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Pendiente de pago" value={fmtMoney(summary.total_pending)} accent="yellow" />
          <StatCard label="Pagado este mes" value={fmtMoney(summary.total_paid_month)} accent="green" />
          <StatCard label="Vencido" value={fmtMoney(summary.total_overdue)} accent={summary.total_overdue > 0 ? "red" : "green"} />
          <StatCard label="Proveedores activos" value={summary.suppliers_active} accent="blue" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <SearchInput
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Buscar por nº factura, proveedor..."
          className="w-64"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="all">Todos los estados</option>
          {Object.entries(receivedInvoiceStatusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
      </div>

      {/* New invoice form */}
      {showForm && (
        <Card className="mb-6">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Registrar factura recibida</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Nº de factura" required>
                <Input
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  required
                  placeholder="F-2024/001"
                />
              </FormField>
              <FormField label="Proveedor">
                <Select
                  value={form.supplier_id}
                  onChange={(e) => handleSupplierSelect(e.target.value)}
                >
                  <option value="">— Seleccionar proveedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Nombre proveedor" required>
                <Input
                  value={form.supplier_name}
                  onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                  required
                  placeholder="Nombre del proveedor"
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <FormField label="NIF proveedor">
                <Input
                  value={form.supplier_nif}
                  onChange={(e) => setForm({ ...form, supplier_nif: e.target.value })}
                  placeholder="B12345678"
                />
              </FormField>
              <FormField label="Fecha emisión" required>
                <Input
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                  required
                />
              </FormField>
              <FormField label="Fecha vencimiento">
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </FormField>
              <FormField label="Forma de pago">
                <Select
                  value={form.payment_method}
                  onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                >
                  {Object.entries(paymentMethodLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <FormField label="Base imponible (€)" required>
                <Input
                  type="number"
                  step="0.01"
                  value={form.subtotal}
                  onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                  required
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="IVA (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.iva_percent}
                  onChange={(e) => setForm({ ...form, iva_percent: e.target.value })}
                />
              </FormField>
              <FormField label="IRPF (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.irpf_percent}
                  onChange={(e) => setForm({ ...form, irpf_percent: e.target.value })}
                />
              </FormField>
              <div className="bg-navy-50/60 dark:bg-zinc-900/50 rounded-xl p-3 flex flex-col justify-center">
                <p className="text-xs text-navy-500 dark:text-zinc-400">IVA: {fmtMoney(computedIva)}</p>
                <p className="text-xs text-navy-500 dark:text-zinc-400">IRPF: -{fmtMoney(computedIrpf)}</p>
                <p className="text-sm font-bold text-navy-900 dark:text-white">Total: {fmtMoney(computedTotal)}</p>
              </div>
            </div>

            <FormField label="Notas">
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Concepto, referencia..."
              />
            </FormField>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : "Registrar factura"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <EmptyState
          title="Sin facturas recibidas"
          description="Registra tu primera factura de proveedor para controlar gastos y vencimientos."
          action={<Button onClick={() => setShowForm(true)}>+ Registrar factura</Button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50/60 dark:bg-zinc-900/50">
                  <th className="text-left text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-4 py-2.5">Nº Factura</th>
                  <th className="text-left text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2.5">Proveedor</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2.5">Fecha</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2.5">Vencimiento</th>
                  <th className="text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2.5">Total</th>
                  <th className="text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-3 py-2.5">Pagado</th>
                  <th className="text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase px-4 py-2.5">Estado</th>
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
                      <td className="px-3 py-2.5">
                        <p className="text-sm text-navy-900 dark:text-white">{inv.supplier_name}</p>
                        {inv.supplier_nif && <p className="text-xs text-navy-500 dark:text-zinc-400">{inv.supplier_nif}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm text-navy-600">{fmtDate(inv.issue_date)}</td>
                      <td className="px-3 py-2.5 text-center text-sm">
                        <span className={isOverdue ? "text-red-600 font-medium" : "text-navy-600"}>
                          {fmtDate(inv.due_date)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-navy-900">{fmtMoney(inv.total)}</td>
                      <td className="px-3 py-2.5 text-right text-sm text-navy-600">{fmtMoney(inv.amount_paid)}</td>
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
        </Card>
      )}
    </div>
  );
}
