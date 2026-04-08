"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Invoice {
  id: string;
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

interface ClientOption {
  id: string;
  name: string;
}


const categoryLabels: Record<string, string> = {
  material: "Material", servicio: "Servicio", suministro: "Suministro",
  alquiler: "Alquiler", subcontrata: "Subcontrata", profesional: "Profesional",
  transporte: "Transporte", seguro: "Seguro", general: "General",
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  paid: { label: "Pagada", color: "bg-green-900/30 text-green-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
  cancelled: { label: "Anulada", color: "bg-gray-700 text-gray-400" },
};

const emptyForm = {
  supplier_name: "", supplier_nif: "", invoice_number: "",
  invoice_date: "", due_date: "", base_amount: 0,
  iva_percentage: 21, iva_amount: 0, irpf_percentage: 0,
  irpf_amount: 0, total_amount: 0, category: "general",
  payment_status: "pending", payment_method: "", notes: "",
};

export default function FacturasPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
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
      loadInvoices();
    }
    init();
  }, []);

  async function loadClients() {
    if (!userId) return;
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", userId)
      .order("name");
    setClients(data || []);
  }

  async function loadInvoices() {
    const { data } = await supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function updateField(field: string, value: any) {
    const updated = { ...form, [field]: value };
    // Auto-calcular IVA e IRPF
    if (["base_amount", "iva_percentage", "irpf_percentage"].includes(field)) {
      const base = field === "base_amount" ? parseFloat(value) || 0 : parseFloat(String(updated.base_amount)) || 0;
      const ivaPct = field === "iva_percentage" ? parseFloat(value) || 0 : parseFloat(String(updated.iva_percentage)) || 0;
      const irpfPct = field === "irpf_percentage" ? parseFloat(value) || 0 : parseFloat(String(updated.irpf_percentage)) || 0;
      updated.iva_amount = parseFloat((base * ivaPct / 100).toFixed(2));
      updated.irpf_amount = parseFloat((base * irpfPct / 100).toFixed(2));
      updated.total_amount = parseFloat((base + updated.iva_amount - updated.irpf_amount).toFixed(2));
    }
    setForm(updated);
  }

  function startEdit(inv: Invoice) {
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
    setEditingId(inv.id);
    setShowForm(true);
    setSelectedInvoice(null);
  }

  async function handleSave() {
    if (!form.supplier_name) { alert("El proveedor es obligatorio."); return; }
    if (!userId) return;

    const invoiceDate = form.invoice_date ? new Date(form.invoice_date) : new Date();
    const month = invoiceDate.getMonth() + 1;
    const quarter = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";

    const payload = {
      ...form,
      client_id: selectedClientId || null,
      base_amount: form.base_amount || 0,
      iva_amount: form.iva_amount || 0,
      irpf_amount: form.irpf_amount || 0,
      total_amount: form.total_amount || 0,
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
      quarter,
      fiscal_year: invoiceDate.getFullYear(),
      manually_verified: true,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await supabase.from("invoices").update(payload).eq("id", editingId);
    } else {
      await supabase.from("invoices").insert({ ...payload, user_id: userId });
    }
    resetForm();
    loadInvoices();
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
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la imagen");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const toBlob = (quality: number) =>
        new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", quality);
        });

      let blob = await toBlob(0.72);
      if (!blob) throw new Error("No se pudo comprimir la imagen");

      if (blob.size > 2_500_000) {
        blob = await toBlob(0.6);
      }

      if (!blob) throw new Error("No se pudo comprimir la imagen");

      const baseName = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    if (!selectedClientId) {
      alert("Selecciona primero el cliente al que pertenece la factura.");
      e.target.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Por favor sube una imagen (JPG, PNG, WEBP). Los PDF no están soportados aún.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setUploadProgress("Preparando imagen...");

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
    } catch (err: any) {
      setUploadProgress("Error: " + err.message);
      setTimeout(() => { setUploading(false); setUploadProgress(""); }, 5000);
    }

    e.target.value = "";
  }

  async function deleteInvoice(id: string) {
    if (!confirm("¿Eliminar esta factura?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    if (selectedInvoice?.id === id) setSelectedInvoice(null);
    loadInvoices();
  }

  async function markAsPaid(id: string) {
    await supabase.from("invoices").update({ payment_status: "paid", updated_at: new Date().toISOString() }).eq("id", id);
    loadInvoices();
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch = inv.supplier_name.toLowerCase().includes(search.toLowerCase()) ||
      (inv.invoice_number || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || inv.payment_status === filterStatus;
    const matchQuarter = filterQuarter === "all" || `${inv.fiscal_year}-${inv.quarter}` === filterQuarter;
    return matchSearch && matchStatus && matchQuarter;
  });

  const totalBase = filtered.reduce((s, i) => s + Number(i.base_amount), 0);
  const totalIVA = filtered.reduce((s, i) => s + Number(i.iva_amount), 0);
  const totalIRPF = filtered.reduce((s, i) => s + Number(i.irpf_amount), 0);
  const totalAmount = filtered.reduce((s, i) => s + Number(i.total_amount), 0);
  const pendingCount = invoices.filter(i => i.payment_status === "pending").length;
  const overdueCount = invoices.filter(i => i.payment_status === "overdue").length;
  const quarters = [...new Set(invoices.map(i => `${i.fiscal_year}-${i.quarter}`))].sort().reverse();

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Facturas</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">Sube fotos de facturas y la IA extrae los datos automáticamente</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--color-navy-800)] text-[var(--color-navy-50)] border border-[var(--color-navy-700)]"
          >
            <option value="">Seleccionar cliente...</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition ${uploading ? "bg-gray-600 text-gray-300 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-500"}`}>
            {uploading ? uploadProgress : "📷 Escanear factura"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleUpload} disabled={uploading} className="hidden" />
          </label>
          <button onClick={() => { resetForm(); setShowForm(true); setSelectedInvoice(null); }} className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
            + Nueva factura
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{filtered.length}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Facturas</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-brand-green)]">{totalAmount.toFixed(2)}€</p>
          <p className="text-xs text-[var(--color-navy-400)]">Total</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-yellow-400">{pendingCount}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Pendientes</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{overdueCount}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Vencidas</p>
        </div>
      </div>

      {/* Resumen fiscal */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><p className="text-xs text-[var(--color-navy-400)]">Base imponible</p><p className="text-lg font-semibold text-[var(--color-navy-100)]">{totalBase.toFixed(2)}€</p></div>
        <div><p className="text-xs text-[var(--color-navy-400)]">IVA soportado</p><p className="text-lg font-semibold text-blue-300">{totalIVA.toFixed(2)}€</p></div>
        <div><p className="text-xs text-[var(--color-navy-400)]">IRPF retenido</p><p className="text-lg font-semibold text-orange-300">{totalIRPF.toFixed(2)}€</p></div>
        <div><p className="text-xs text-[var(--color-navy-400)]">Total facturas</p><p className="text-lg font-semibold text-[var(--color-brand-green)]">{totalAmount.toFixed(2)}€</p></div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input type="text" placeholder="Buscar por proveedor o nº factura..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] text-sm">
          <option value="all">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="paid">Pagada</option>
          <option value="overdue">Vencida</option>
        </select>
        <select value={filterQuarter} onChange={(e) => setFilterQuarter(e.target.value)} className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] text-sm">
          <option value="all">Todos los trimestres</option>
          {quarters.map(q => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>

      {/* Manual Form */}
      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
            {editingId ? "Editar factura" : "Nueva factura manual"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Proveedor *</label>
              <input type="text" value={form.supplier_name} onChange={(e) => updateField("supplier_name", e.target.value)} placeholder="Nombre del proveedor" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">NIF/CIF</label>
              <input type="text" value={form.supplier_nif} onChange={(e) => updateField("supplier_nif", e.target.value)} placeholder="B12345678" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nº Factura</label>
              <input type="text" value={form.invoice_number} onChange={(e) => updateField("invoice_number", e.target.value)} placeholder="FAC-2024-001" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha factura</label>
              <input type="date" value={form.invoice_date} onChange={(e) => updateField("invoice_date", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Vencimiento</label>
              <input type="date" value={form.due_date} onChange={(e) => updateField("due_date", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Categoría</label>
              <select value={form.category} onChange={(e) => updateField("category", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Base imponible *</label>
              <input type="number" step="0.01" value={form.base_amount} onChange={(e) => updateField("base_amount", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">IVA %</label>
              <select value={form.iva_percentage} onChange={(e) => updateField("iva_percentage", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                <option value="0">0% (Exento)</option>
                <option value="4">4% (Superreducido)</option>
                <option value="10">10% (Reducido)</option>
                <option value="21">21% (General)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">IRPF %</label>
              <select value={form.irpf_percentage} onChange={(e) => updateField("irpf_percentage", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                <option value="0">0% (Sin retención)</option>
                <option value="7">7%</option>
                <option value="15">15%</option>
                <option value="19">19%</option>
              </select>
            </div>
            <div className="bg-[var(--color-navy-700)] rounded-lg p-3">
              <p className="text-xs text-[var(--color-navy-400)]">IVA: <span className="text-blue-300">{form.iva_amount.toFixed(2)}€</span></p>
              <p className="text-xs text-[var(--color-navy-400)]">IRPF: <span className="text-orange-300">-{form.irpf_amount.toFixed(2)}€</span></p>
              <p className="text-sm font-bold text-[var(--color-brand-green)] mt-1">Total: {form.total_amount.toFixed(2)}€</p>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Estado</label>
              <select value={form.payment_status} onChange={(e) => updateField("payment_status", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                <option value="pending">Pendiente</option>
                <option value="paid">Pagada</option>
                <option value="overdue">Vencida</option>
                <option value="cancelled">Anulada</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Método de pago</label>
              <select value={form.payment_method} onChange={(e) => updateField("payment_method", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                <option value="">Sin especificar</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="efectivo">Efectivo</option>
                <option value="domiciliacion">Domiciliación</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Observaciones..." className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleSave} className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              {editingId ? "Guardar cambios" : "Registrar factura"}
            </button>
            <button onClick={resetForm} className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm hover:bg-[var(--color-navy-600)] transition">Cancelar</button>
          </div>
        </div>
      )}

      {/* Detail */}
      {selectedInvoice && !showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Detalle factura</h3>
            <div className="flex gap-3">
              <button onClick={() => startEdit(selectedInvoice)} className="text-xs text-blue-400 hover:underline">Editar</button>
              <button onClick={() => setSelectedInvoice(null)} className="text-xs text-[var(--color-navy-400)] hover:underline">Cerrar</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-[var(--color-navy-400)]">Proveedor</p><p className="text-[var(--color-navy-100)] font-medium">{selectedInvoice.supplier_name}</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">NIF</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.supplier_nif || "—"}</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">Nº Factura</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.invoice_number || "—"}</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">Fecha</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString("es-ES") : "—"}</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">Base</p><p className="text-[var(--color-navy-100)]">{Number(selectedInvoice.base_amount).toFixed(2)}€</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">IVA ({selectedInvoice.iva_percentage}%)</p><p className="text-blue-300">{Number(selectedInvoice.iva_amount).toFixed(2)}€</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">IRPF ({selectedInvoice.irpf_percentage}%)</p><p className="text-orange-300">{Number(selectedInvoice.irpf_amount).toFixed(2)}€</p></div>
            <div><p className="text-xs text-[var(--color-navy-400)]">Total</p><p className="text-[var(--color-brand-green)] font-bold">{Number(selectedInvoice.total_amount).toFixed(2)}€</p></div>
            {selectedInvoice.ocr_confidence > 0 && (
              <div><p className="text-xs text-[var(--color-navy-400)]">Confianza OCR</p><p className="text-[var(--color-navy-100)]">{(Number(selectedInvoice.ocr_confidence) * 100).toFixed(0)}%{selectedInvoice.manually_verified ? " ✓" : ""}</p></div>
            )}
            <div><p className="text-xs text-[var(--color-navy-400)]">Trimestre</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.fiscal_year} {selectedInvoice.quarter}</p></div>
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-4xl mb-3">🧾</p>
          <p className="text-[var(--color-navy-400)]">No hay facturas todavía.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Sube una foto con "Escanear factura" o añade una manualmente con "+ Nueva factura".</p>
        </div>
      ) : (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-navy-700)]">
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase px-5 py-3">Proveedor</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Nº</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Fecha</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Categ.</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Base</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">IVA</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-5 py-3">Total</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition cursor-pointer" onClick={() => { setSelectedInvoice(inv); setShowForm(false); }}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-[var(--color-navy-100)]">{inv.supplier_name || "Sin proveedor"}</p>
                      {inv.supplier_nif && <p className="text-xs text-[var(--color-navy-400)]">{inv.supplier_nif}</p>}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{inv.invoice_number || "—"}</td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("es-ES") : "—"}</td>
                    <td className="px-3 py-3 text-center"><span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-300">{categoryLabels[inv.category] || inv.category}</span></td>
                    <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-200)]">{Number(inv.base_amount).toFixed(2)}€</td>
                    <td className="px-3 py-3 text-right text-sm text-blue-300">{Number(inv.iva_amount).toFixed(2)}€</td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{Number(inv.total_amount).toFixed(2)}€</td>
                    <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-1 rounded-full ${statusLabels[inv.payment_status]?.color}`}>{statusLabels[inv.payment_status]?.label}</span></td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => startEdit(inv)} className="text-xs text-blue-400 hover:underline mr-2">Editar</button>
                      {inv.payment_status === "pending" && <button onClick={() => markAsPaid(inv.id)} className="text-xs text-[var(--color-brand-green)] hover:underline mr-2">Pagada</button>}
                      <button onClick={() => deleteInvoice(inv.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
