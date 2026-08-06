 
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { Camera, Loader2 } from "lucide-react";
import { prepareInvoiceImage } from "@/lib/invoice-image-client";
import {
  getReceivedInvoices,
  createReceivedInvoice,
  updateReceivedInvoice,
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
  document_url: "",
};

export default function ReceivedInvoicesPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const toast = useToast();
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
  const [scanning, setScanning] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState("");

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

      setInvoices(invoiceResult.data);  
      setTotal(invoiceResult.count);  
      setSummary(summaryResult);  
      setSuppliers((suppliersResult.data || []) as Supplier[]);  
      setLoading(false);  
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

  const isOcrDraftUrl = (value: string) =>
    value.startsWith("storage://received-invoice-documents/") &&
    value.includes("/drafts/");

  async function deleteOcrDraft(draftUrl: string) {
    const response = await fetch("/api/invoices/ocr", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_url: draftUrl }),
    });
    if (response.ok) return;

    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "No se pudo eliminar el borrador OCR");
  }

  async function promoteOcrDraft(draftUrl: string, invoiceId: string) {
    const response = await fetch("/api/invoices/ocr", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_url: draftUrl, invoice_id: invoiceId }),
    });
    if (response.ok) return;

    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.error || "No se pudo conservar el documento de la factura"
    );
  }

  async function handleNewInvoice() {
    if (pendingInvoiceId) {
      toast.error("La factura ya está registrada", {
        description: "Reintenta primero la conservación de su documento.",
      });
      return;
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await deleteOcrDraft(form.document_url);
      } catch (error) {
        toast.error("No se pudo descartar el borrador", {
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        });
        return;
      }
    }

    setForm(emptyForm);
    setShowForm(true);
  }

  async function handleCancelForm() {
    if (pendingInvoiceId) {
      toast.error("La factura ya está registrada", {
        description: "Reintenta primero la conservación de su documento.",
      });
      return;
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await deleteOcrDraft(form.document_url);
      } catch (error) {
        toast.error("No se pudo descartar el borrador", {
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        });
        return;
      }
    }

    setForm(emptyForm);
    setShowForm(false);
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingInvoiceId) {
      toast.error("Reintenta primero la conservación de la factura registrada");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona una foto JPG, PNG o WEBP");
      return;
    }

    setScanning(true);
    try {
      const optimizedFile = await prepareInvoiceImage(file);
      const body = new FormData();
      body.append("file", optimizedFile);
      body.append("mode", "extract");

      const response = await fetch("/api/invoices/ocr", {
        method: "POST",
        body,
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json()
        : { error: `El servidor devolvió un error ${response.status}` };

      if (!response.ok || !result.success || !result.ocr_data) {
        throw new Error(result.error || "No se pudo analizar la factura");
      }

      const newDraftUrl = String(result.image_url || "");
      const previousDraftUrl = isOcrDraftUrl(form.document_url)
        ? form.document_url
        : "";
      if (previousDraftUrl && previousDraftUrl !== newDraftUrl) {
        try {
          await deleteOcrDraft(previousDraftUrl);
        } catch (cleanupError) {
          // Keep the previous form usable. The newly uploaded draft is not
          // exposed to the UI unless the replacement can be completed.
          await deleteOcrDraft(newDraftUrl).catch(() => {});
          throw cleanupError;
        }
      }

      const data = result.ocr_data as Record<string, unknown>;
      const supplierName = String(data.supplier_name || "");
      const supplierNif = String(data.supplier_nif || "");
      const normalizedNif = supplierNif.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const normalizedName = supplierName.trim().toLocaleLowerCase("es");
      const matchingSupplier = suppliers.find((supplier) => {
        const candidateNif = (supplier.nif || "")
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase();
        return (
          (normalizedNif && candidateNif === normalizedNif) ||
          (normalizedName &&
            supplier.name.trim().toLocaleLowerCase("es") === normalizedName)
        );
      });
      const paymentMethod = String(data.payment_method || "").toLowerCase();

      setForm({
        invoice_number: String(data.invoice_number || ""),
        supplier_id: matchingSupplier?.id || "",
        supplier_name: matchingSupplier?.name || supplierName,
        supplier_nif: matchingSupplier?.nif || supplierNif,
        issue_date:
          String(data.invoice_date || "") ||
          new Date().toISOString().split("T")[0],
        due_date: String(data.due_date || ""),
        subtotal: String(Number(data.base_amount || 0) || ""),
        iva_percent: String(Number(data.iva_percentage ?? 21)),
        irpf_percent: String(Number(data.irpf_percentage ?? 0)),
        payment_method: paymentMethodLabels[paymentMethod]
          ? paymentMethod
          : "transferencia",
        notes: String(data.notes || ""),
        document_url: newDraftUrl,
      });
      setShowForm(true);
      toast.success("Factura analizada", {
        description: "Revisa los datos antes de registrarla.",
      });
    } catch (error) {
      toast.error("No se pudo analizar la factura", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
      });
    } finally {
      setScanning(false);
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

    let invoiceId = pendingInvoiceId;

    if (!invoiceId) {
      const { data, error } = await createReceivedInvoice(supabase, {
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
        document_url: form.document_url || null,
      });

      if (error || !data) {
        toast.error("Error al registrar la factura");
        setSaving(false);
        return;
      }
      invoiceId = data.id;
      if (isOcrDraftUrl(form.document_url)) {
        setPendingInvoiceId(invoiceId);
      }
    } else {
      // A previous submit already created the invoice and only failed while
      // retrying OCR promotion below. Persist any corrections made to the
      // form in the meantime, or they are silently discarded once this
      // retry succeeds and the form closes.
      const { error } = await updateReceivedInvoice(supabase, invoiceId, {
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

      if (error) {
        toast.error("No se pudieron guardar las correcciones", {
          description: "Reintenta antes de conservar el documento.",
        });
        setSaving(false);
        return;
      }
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await promoteOcrDraft(form.document_url, invoiceId);
      } catch (error) {
        toast.error("Factura registrada; documento pendiente", {
          description:
            (error instanceof Error ? error.message : "Error de conservación") +
            ". Pulsa de nuevo para reintentar sin crear otra factura.",
        });
        setSaving(false);
        return;
      }
    }

    setPendingInvoiceId("");
    toast.success("Factura registrada");
    setForm(emptyForm);
    setShowForm(false);
    await load();
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
        description="Sube fotos de facturas y la IA extrae los datos automáticamente"
        count={total}
        countLabel={`factura${total !== 1 ? "s" : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition ${scanning ? "pointer-events-none cursor-not-allowed bg-navy-100 text-navy-400 dark:text-zinc-500" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {scanning ? "Analizando factura..." : "Escanear factura"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={handleScan}
                disabled={scanning}
                className="hidden"
              />
            </label>
            <Button onClick={handleNewInvoice}>
              + Nueva factura
            </Button>
          </div>
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
                {saving
                  ? "Guardando..."
                  : pendingInvoiceId
                    ? "Reintentar conservación"
                    : "Registrar factura"}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancelForm}>
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
          action={
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700">
              <Camera className="h-4 w-4" />
              Escanear factura
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={handleScan}
                disabled={scanning}
                className="hidden"
              />
            </label>
          }
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
