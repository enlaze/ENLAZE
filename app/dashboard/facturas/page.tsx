"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { FormField, Input, Select, SearchInput } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

interface Invoice {
  id: string;
  client_id?: string | null;
  supplier_name: string;
  supplier_nif: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  base_amount: number;
  iva_percentage: number;
  iva_amount: number;
  irpf_percentage: number;
  irpf_amount: number;
  total_amount: number;
  category: string;
  payment_status: string;
  payment_method: string;
  image_url: string;
  ocr_confidence: number;
  manually_verified: boolean;
  quarter: string;
  fiscal_year: number;
  notes: string;
  created_at: string;
}

interface ClientOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; client_id: string | null; }

const categoryLabels: Record<string, string> = {
  material: "Material", servicio: "Servicio", suministro: "Suministro",
  alquiler: "Alquiler", subcontrata: "Subcontrata", profesional: "Profesional",
  transporte: "Transporte", seguro: "Seguro", general: "General",
};

const statusConfig: Record<string, { label: string; variant: "yellow" | "green" | "red" | "gray" }> = {
  pending: { label: "Pendiente", variant: "yellow" },
  paid: { label: "Pagada", variant: "green" },
  overdue: { label: "Vencida", variant: "red" },
  cancelled: { label: "Anulada", variant: "gray" },
};

const emptyForm = {
  supplier_name: "", supplier_nif: "", invoice_number: "",
  invoice_date: "", due_date: "", base_amount: 0,
  iva_percentage: 21, iva_amount: 0, irpf_percentage: 0,
  irpf_amount: 0, total_amount: 0, category: "general",
  payment_status: "pending", payment_method: "", notes: "",
};

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }

export default function FacturasPage() {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterQuarter, setFilterQuarter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      await loadClients();
      await loadInvoices();
    }
    init();
  }, []);

  useEffect(() => {
    if (selectedClientId && selectedProjectId && !projects.some((p) => p.id === selectedProjectId && p.client_id === selectedClientId)) {
      setSelectedProjectId("");
    }
  }, [selectedClientId, selectedProjectId, projects]);

  async function loadClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    setClients(data || []);
  }

  async function loadProjects() {
    const { data } = await supabase.from("projects").select("id, name, client_id").order("name");
    setProjects(data || []);
  }

  async function loadInvoices() {
    const { data } = await supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm); setEditingId(null); setShowForm(false); setSelectedClientId("");
  }

  function updateField(field: string, value: string | number) {
    const updated = { ...form, [field]: value };
    if (["base_amount", "iva_percentage", "irpf_percentage"].includes(field)) {
      const base = field === "base_amount" ? parseFloat(String(value)) || 0 : parseFloat(String(updated.base_amount)) || 0;
      const ivaPct = field === "iva_percentage" ? parseFloat(String(value)) || 0 : parseFloat(String(updated.iva_percentage)) || 0;
      const irpfPct = field === "irpf_percentage" ? parseFloat(String(value)) || 0 : parseFloat(String(updated.irpf_percentage)) || 0;
      updated.iva_amount = parseFloat((base * ivaPct / 100).toFixed(2));
      updated.irpf_amount = parseFloat((base * irpfPct / 100).toFixed(2));
      updated.total_amount = parseFloat((base + updated.iva_amount - updated.irpf_amount).toFixed(2));
    }
    setForm(updated);
  }

  function startEdit(inv: Invoice) {
    setSelectedClientId(inv.client_id || "");
    setForm({
      supplier_name: inv.supplier_name, supplier_nif: inv.supplier_nif,
      invoice_number: inv.invoice_number, invoice_date: inv.invoice_date || "",
      due_date: inv.due_date || "", base_amount: Number(inv.base_amount),
      iva_percentage: Number(inv.iva_percentage), iva_amount: Number(inv.iva_amount),
      irpf_percentage: Number(inv.irpf_percentage), irpf_amount: Number(inv.irpf_amount),
      total_amount: Number(inv.total_amount), category: inv.category,
      payment_status: inv.payment_status, payment_method: inv.payment_method,
      notes: inv.notes,
    });
    setEditingId(inv.id); setShowForm(true); setSelectedInvoice(null);
  }

  async function handleSave() {
    if (!form.supplier_name) { toast.error("El proveedor es obligatorio."); return; }
    if (!userId) return;

    const invoiceDate = form.invoice_date ? new Date(form.invoice_date) : new Date();
    const month = invoiceDate.getMonth() + 1;
    const quarter = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";

    const payload = {
      ...form, client_id: selectedClientId || null, project_id: selectedProjectId || null,
      base_amount: form.base_amount || 0, iva_amount: form.iva_amount || 0,
      irpf_amount: form.irpf_amount || 0, total_amount: form.total_amount || 0,
      invoice_date: form.invoice_date || null, due_date: form.due_date || null,
      quarter, fiscal_year: invoiceDate.getFullYear(), manually_verified: true,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await supabase.from("invoices").update(payload).eq("id", editingId);
    } else {
      await supabase.from("invoices").insert({ ...payload, user_id: userId });
    }
    resetForm(); loadInvoices();
  }

  async function compressImageForUpload(file: File): Promise<File> {
    if (file.size <= 1_500_000 && file.type === "image/jpeg") return file;
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("No se pudo cargar la imagen"));
        image.src = objectUrl;
      });
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la imagen");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const toBlob = (quality: number) => new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, "image/jpeg", quality); });
      let blob = await toBlob(0.72);
      if (!blob) throw new Error("No se pudo comprimir la imagen");
      if (blob.size > 2_500_000) blob = await toBlob(0.6);
      if (!blob) throw new Error("No se pudo comprimir la imagen");
      const baseName = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    } finally { URL.revokeObjectURL(objectUrl); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Por favor sube una imagen (JPG, PNG, WEBP). Los PDF no están soportados aún.");
      e.target.value = ""; return;
    }
    setUploading(true); setUploadProgress("Preparando imagen...");
    try {
      const optimizedFile = await compressImageForUpload(file);
      setUploadProgress("Analizando factura con IA...");
      const formData = new FormData();
      formData.append("file", optimizedFile);
      formData.append("userId", userId);
      formData.append("clientId", selectedClientId);
      const res = await fetch("/api/invoices/ocr", { method: "POST", body: formData });
      const result = await res.json();
      if (result.success) {
        setUploadProgress("Factura procesada correctamente");
        await loadInvoices();
        setTimeout(() => { setUploading(false); setUploadProgress(""); }, 2000);
      } else {
        setUploadProgress("Error: " + (result.error || result.details || "No se pudo procesar"));
        setTimeout(() => { setUploading(false); setUploadProgress(""); }, 5000);
      }
    } catch (err: unknown) {
      setUploadProgress("Error: " + (err instanceof Error ? err.message : "Error desconocido"));
      setTimeout(() => { setUploading(false); setUploadProgress(""); }, 5000);
    }
    e.target.value = "";
  }

  async function deleteInvoice(id: string) {
    const ok = await confirm({
      title: "Eliminar factura",
      description: "¿Eliminar esta factura?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("invoices").delete().eq("id", id);
      if (selectedInvoice?.id === id) setSelectedInvoice(null);
      await loadInvoices();
      toast.success("Factura eliminada");
    } catch (error) {
      toast.error("Error al eliminar la factura");
    }
  }

  async function markAsPaid(id: string) {
    await supabase.from("invoices").update({ payment_status: "paid", updated_at: new Date().toISOString() }).eq("id", id);
    loadInvoices();
  }

  const visibleProjects = selectedClientId ? projects.filter((p) => p.client_id === selectedClientId) : projects;

  const filtered = invoices.filter((inv) => {
    const matchSearch = inv.supplier_name.toLowerCase().includes(search.toLowerCase()) || (inv.invoice_number || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || inv.payment_status === filterStatus;
    const matchQuarter = filterQuarter === "all" || `${inv.fiscal_year}-${inv.quarter}` === filterQuarter;
    const matchClient = !selectedClientId || inv.client_id === selectedClientId;
    return matchSearch && matchStatus && matchQuarter && matchClient;
  });

  const totalBase = filtered.reduce((s, i) => s + Number(i.base_amount), 0);
  const totalIVA = filtered.reduce((s, i) => s + Number(i.iva_amount), 0);
  const totalIRPF = filtered.reduce((s, i) => s + Number(i.irpf_amount), 0);
  const totalAmount = filtered.reduce((s, i) => s + Number(i.total_amount), 0);
  const pendingCount = invoices.filter(i => i.payment_status === "pending").length;
  const overdueCount = invoices.filter(i => i.payment_status === "overdue").length;
  const quarters = [...new Set(invoices.map(i => `${i.fiscal_year}-${i.quarter}`))].sort().reverse();

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Facturas recibidas"
        description="Sube fotos de facturas y la IA extrae los datos automáticamente"
        actions={
          <div className="flex gap-2 flex-wrap">
            <label className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium cursor-pointer transition ${uploading ? "bg-navy-100 text-navy-400 dark:text-zinc-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              {uploading ? uploadProgress : "Escanear factura"}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleUpload} disabled={uploading} className="hidden" />
            </label>
            <Button onClick={() => { resetForm(); setShowForm(true); setSelectedInvoice(null); }}>+ Nueva factura</Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Facturas" value={filtered.length} accent="blue" />
        <StatCard label="Total" value={eur(totalAmount)} accent="green" />
        <StatCard label="Pendientes" value={pendingCount} accent="yellow" />
        <StatCard label="Vencidas" value={overdueCount} accent="red" />
      </div>

      {/* Resumen fiscal */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><p className="text-xs font-medium text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Base imponible</p><p className="text-lg font-bold text-navy-900 dark:text-white mt-1">{eur(totalBase)}</p></div>
          <div><p className="text-xs font-medium text-navy-500 dark:text-zinc-500 uppercase tracking-wider">IVA soportado</p><p className="text-lg font-bold text-blue-600 mt-1">{eur(totalIVA)}</p></div>
          <div><p className="text-xs font-medium text-navy-500 dark:text-zinc-500 uppercase tracking-wider">IRPF retenido</p><p className="text-lg font-bold text-orange-600 mt-1">{eur(totalIRPF)}</p></div>
          <div><p className="text-xs font-medium text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Total facturas</p><p className="text-lg font-bold text-brand-green mt-1">{eur(totalAmount)}</p></div>
        </div>
      </Card>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por proveedor o n.º factura..." className="flex-1" />
        <Select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-auto">
          <option value="">Todos los clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="all">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="paid">Pagada</option>
          <option value="overdue">Vencida</option>
        </Select>
        <Select value={filterQuarter} onChange={(e) => setFilterQuarter(e.target.value)} className="w-auto">
          <option value="all">Todos los trimestres</option>
          {quarters.map(q => <option key={q} value={q}>{q}</option>)}
        </Select>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="mb-6">
          <h3 className="text-base font-semibold text-navy-900 dark:text-white mb-5">{editingId ? "Editar factura" : "Nueva factura manual"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
            <FormField label="Proveedor" required>
              <Input type="text" value={form.supplier_name} onChange={(e) => updateField("supplier_name", e.target.value)} placeholder="Nombre del proveedor" />
            </FormField>
            <FormField label="NIF/CIF">
              <Input type="text" value={form.supplier_nif} onChange={(e) => updateField("supplier_nif", e.target.value)} placeholder="B12345678" />
            </FormField>
            <FormField label="N.º Factura">
              <Input type="text" value={form.invoice_number} onChange={(e) => updateField("invoice_number", e.target.value)} placeholder="FAC-2024-001" />
            </FormField>
            <FormField label="Fecha factura">
              <Input type="date" value={form.invoice_date} onChange={(e) => updateField("invoice_date", e.target.value)} />
            </FormField>
            <FormField label="Vencimiento">
              <Input type="date" value={form.due_date} onChange={(e) => updateField("due_date", e.target.value)} />
            </FormField>
            <FormField label="Categoría">
              <Select value={form.category} onChange={(e) => updateField("category", e.target.value)}>
                {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </FormField>
            <FormField label="Base imponible" required>
              <Input type="number" step="0.01" value={form.base_amount} onChange={(e) => updateField("base_amount", e.target.value)} />
            </FormField>
            <FormField label="IVA %">
              <Select value={form.iva_percentage} onChange={(e) => updateField("iva_percentage", e.target.value)}>
                <option value="0">0% (Exento)</option>
                <option value="4">4% (Superreducido)</option>
                <option value="10">10% (Reducido)</option>
                <option value="21">21% (General)</option>
              </Select>
            </FormField>
            <FormField label="IRPF %">
              <Select value={form.irpf_percentage} onChange={(e) => updateField("irpf_percentage", e.target.value)}>
                <option value="0">0% (Sin retención)</option>
                <option value="7">7%</option>
                <option value="15">15%</option>
                <option value="19">19%</option>
              </Select>
            </FormField>
            <div className="rounded-xl bg-navy-50 dark:bg-zinc-900/80 border border-navy-100 dark:border-zinc-800 p-4">
              <p className="text-xs text-navy-500 dark:text-zinc-500">IVA: <span className="font-semibold text-blue-600">{form.iva_amount.toFixed(2)} EUR</span></p>
              <p className="text-xs text-navy-500 dark:text-zinc-500">IRPF: <span className="font-semibold text-orange-600">-{form.irpf_amount.toFixed(2)} EUR</span></p>
              <p className="text-sm font-bold text-brand-green mt-1">Total: {form.total_amount.toFixed(2)} EUR</p>
            </div>
            <FormField label="Estado">
              <Select value={form.payment_status} onChange={(e) => updateField("payment_status", e.target.value)}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagada</option>
                <option value="overdue">Vencida</option>
                <option value="cancelled">Anulada</option>
              </Select>
            </FormField>
            <FormField label="Método de pago">
              <Select value={form.payment_method} onChange={(e) => updateField("payment_method", e.target.value)}>
                <option value="">Sin especificar</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="efectivo">Efectivo</option>
                <option value="domiciliacion">Domiciliación</option>
              </Select>
            </FormField>
            <FormField label="Notas" className="md:col-span-3">
              <Input type="text" value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Observaciones..." />
            </FormField>
          </div>
          <div className="flex gap-3 mt-5 justify-end">
            <Button variant="secondary" onClick={resetForm}>Cancelar</Button>
            <Button onClick={handleSave}>{editingId ? "Guardar cambios" : "Registrar factura"}</Button>
          </div>
        </Card>
      )}

      {/* Detail */}
      {selectedInvoice && !showForm && (
        <Card className="mb-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">Detalle factura</h3>
            <div className="flex gap-3">
              <button onClick={() => startEdit(selectedInvoice)} className="text-xs text-brand-green hover:underline font-medium">Editar</button>
              <button onClick={() => setSelectedInvoice(null)} className="text-xs text-navy-500 dark:text-zinc-500 hover:underline">Cerrar</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">Proveedor</p><p className="text-navy-900 font-medium">{selectedInvoice.supplier_name}</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">NIF</p><p className="text-navy-900">{selectedInvoice.supplier_nif || "—"}</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">N.º Factura</p><p className="text-navy-900">{selectedInvoice.invoice_number || "—"}</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">Fecha</p><p className="text-navy-900">{selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString("es-ES") : "—"}</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">Base</p><p className="text-navy-900">{Number(selectedInvoice.base_amount).toFixed(2)} EUR</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">IVA ({selectedInvoice.iva_percentage}%)</p><p className="text-blue-600">{Number(selectedInvoice.iva_amount).toFixed(2)} EUR</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">IRPF ({selectedInvoice.irpf_percentage}%)</p><p className="text-orange-600">{Number(selectedInvoice.irpf_amount).toFixed(2)} EUR</p></div>
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">Total</p><p className="text-brand-green font-bold">{Number(selectedInvoice.total_amount).toFixed(2)} EUR</p></div>
            {selectedInvoice.ocr_confidence > 0 && (
              <div><p className="text-xs text-navy-500 dark:text-zinc-500">Confianza OCR</p><p className="text-navy-900">{(Number(selectedInvoice.ocr_confidence) * 100).toFixed(0)}%{selectedInvoice.manually_verified ? " (verificada)" : ""}</p></div>
            )}
            <div><p className="text-xs text-navy-500 dark:text-zinc-500">Trimestre</p><p className="text-navy-900">{selectedInvoice.fiscal_year} {selectedInvoice.quarter}</p></div>
          </div>
        </Card>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Sin facturas todavía"
          description='Sube una foto con "Escanear factura" o añade una manualmente'
        />
      ) : (
        <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/60">
                  <th className="text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-3">Proveedor</th>
                  <th className="text-center text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3 hidden md:table-cell">N.º</th>
                  <th className="text-center text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3 hidden md:table-cell">Fecha</th>
                  <th className="text-center text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3 hidden lg:table-cell">Categ.</th>
                  <th className="text-right text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3 hidden lg:table-cell">Base</th>
                  <th className="text-right text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-3">Total</th>
                  <th className="text-center text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Estado</th>
                  <th className="text-right text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const st = statusConfig[inv.payment_status] || { label: inv.payment_status, variant: "gray" as const };
                  return (
                    <tr key={inv.id} className="border-b border-navy-50 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer" onClick={() => { setSelectedInvoice(inv); setShowForm(false); }}>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-navy-900 dark:text-white">{inv.supplier_name || "Sin proveedor"}</p>
                        {inv.supplier_nif && <p className="text-xs text-navy-500 dark:text-zinc-500">{inv.supplier_nif}</p>}
                      </td>
                      <td className="px-3 py-3.5 text-center text-xs text-navy-600 dark:text-zinc-400 hidden md:table-cell">{inv.invoice_number || "—"}</td>
                      <td className="px-3 py-3.5 text-center text-xs text-navy-600 dark:text-zinc-400 hidden md:table-cell">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("es-ES") : "—"}</td>
                      <td className="px-3 py-3.5 text-center hidden lg:table-cell"><Badge variant="blue">{categoryLabels[inv.category] || inv.category}</Badge></td>
                      <td className="px-3 py-3.5 text-right text-navy-600 dark:text-zinc-400 hidden lg:table-cell">{Number(inv.base_amount).toFixed(2)} EUR</td>
                      <td className="px-5 py-3.5 text-right font-medium text-navy-900 dark:text-white">{Number(inv.total_amount).toFixed(2)} EUR</td>
                      <td className="px-3 py-3.5 text-center"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => startEdit(inv)} className="text-xs text-brand-green hover:underline font-medium mr-2">Editar</button>
                        {inv.payment_status === "pending" && <button onClick={() => markAsPaid(inv.id)} className="text-xs text-blue-600 hover:underline font-medium mr-2">Pagada</button>}
                        <button onClick={() => deleteInvoice(inv.id)} className="text-xs text-red-600 hover:underline font-medium">Eliminar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
