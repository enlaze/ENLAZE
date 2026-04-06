"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Invoice {
  id: string;
  supplier_name: string;
  supplier_nif: string;
  invoice_number: string;
  invoice_date: string;
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

export default function FacturasPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterQuarter, setFilterQuarter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<Invoice>>({});

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      loadInvoices();
    }
    init();
  }, []);

  async function loadInvoices() {
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .order("invoice_date", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setUploading(true);
    setUploadProgress("Subiendo imagen...");

    try {
      setUploadProgress("Analizando factura con IA...");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);

      const res = await fetch("/api/invoices/ocr", { method: "POST", body: formData });
      const result = await res.json();

      if (result.success) {
        setUploadProgress("Factura procesada correctamente");
        await loadInvoices();
        setTimeout(() => { setUploading(false); setUploadProgress(""); }, 2000);
      } else {
        setUploadProgress("Error: " + (result.error || "No se pudo procesar"));
        setTimeout(() => { setUploading(false); setUploadProgress(""); }, 4000);
      }
    } catch (err: any) {
      setUploadProgress("Error de conexión: " + err.message);
      setTimeout(() => { setUploading(false); setUploadProgress(""); }, 4000);
    }

    e.target.value = "";
  }

  async function updateInvoice() {
    if (!selectedInvoice) return;
    await supabase.from("invoices").update({
      ...editData,
      manually_verified: true,
      updated_at: new Date().toISOString(),
    }).eq("id", selectedInvoice.id);
    setEditMode(false);
    setSelectedInvoice(null);
    loadInvoices();
  }

  async function deleteInvoice(id: string) {
    if (!confirm("¿Eliminar esta factura?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    loadInvoices();
  }

  async function markAsPaid(id: string) {
    await supabase.from("invoices").update({ payment_status: "paid", updated_at: new Date().toISOString() }).eq("id", id);
    loadInvoices();
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch = inv.supplier_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoice_number.toLowerCase().includes(search.toLowerCase());
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Facturas</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">Sube fotos de facturas y la IA extrae los datos automáticamente</p>
        </div>
        <div className="flex gap-2">
          <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition ${uploading ? "bg-gray-600 text-gray-300 cursor-not-allowed" : "bg-[var(--color-brand-green)] text-[var(--color-navy-900)] hover:opacity-90"}`}>
            {uploading ? uploadProgress : "📷 Subir factura"}
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} className="hidden" />
          </label>
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

      {/* Detail modal */}
      {selectedInvoice && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">
              {editMode ? "Editar factura" : "Detalle factura"}
            </h3>
            <div className="flex gap-2">
              {!editMode && (
                <button onClick={() => { setEditMode(true); setEditData(selectedInvoice); }} className="text-xs text-blue-400 hover:underline">Editar</button>
              )}
              <button onClick={() => { setSelectedInvoice(null); setEditMode(false); }} className="text-xs text-[var(--color-navy-400)] hover:underline">Cerrar</button>
            </div>
          </div>
          {editMode ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Proveedor</label>
                <input type="text" value={editData.supplier_name || ""} onChange={(e) => setEditData({ ...editData, supplier_name: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">NIF</label>
                <input type="text" value={editData.supplier_nif || ""} onChange={(e) => setEditData({ ...editData, supplier_nif: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nº Factura</label>
                <input type="text" value={editData.invoice_number || ""} onChange={(e) => setEditData({ ...editData, invoice_number: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Base imponible</label>
                <input type="number" step="0.01" value={editData.base_amount || 0} onChange={(e) => setEditData({ ...editData, base_amount: parseFloat(e.target.value) })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">IVA %</label>
                <input type="number" step="0.01" value={editData.iva_percentage || 21} onChange={(e) => setEditData({ ...editData, iva_percentage: parseFloat(e.target.value) })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Total</label>
                <input type="number" step="0.01" value={editData.total_amount || 0} onChange={(e) => setEditData({ ...editData, total_amount: parseFloat(e.target.value) })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Estado</label>
                <select value={editData.payment_status || "pending"} onChange={(e) => setEditData({ ...editData, payment_status: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm">
                  <option value="pending">Pendiente</option>
                  <option value="paid">Pagada</option>
                  <option value="overdue">Vencida</option>
                  <option value="cancelled">Anulada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Categoría</label>
                <select value={editData.category || "general"} onChange={(e) => setEditData({ ...editData, category: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm">
                  {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
                <input type="text" value={editData.notes || ""} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] text-sm" />
              </div>
              <div className="md:col-span-3 flex gap-3 mt-2">
                <button onClick={updateInvoice} className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium">Guardar cambios</button>
                <button onClick={() => setEditMode(false)} className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-[var(--color-navy-400)]">Proveedor</p><p className="text-[var(--color-navy-100)] font-medium">{selectedInvoice.supplier_name}</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">NIF</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.supplier_nif || "—"}</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Nº Factura</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.invoice_number || "—"}</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Fecha</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.invoice_date || "—"}</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Base</p><p className="text-[var(--color-navy-100)]">{Number(selectedInvoice.base_amount).toFixed(2)}€</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">IVA ({selectedInvoice.iva_percentage}%)</p><p className="text-blue-300">{Number(selectedInvoice.iva_amount).toFixed(2)}€</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">IRPF ({selectedInvoice.irpf_percentage}%)</p><p className="text-orange-300">{Number(selectedInvoice.irpf_amount).toFixed(2)}€</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Total</p><p className="text-[var(--color-brand-green)] font-bold">{Number(selectedInvoice.total_amount).toFixed(2)}€</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Confianza OCR</p><p className="text-[var(--color-navy-100)]">{(selectedInvoice.ocr_confidence * 100).toFixed(0)}%{selectedInvoice.manually_verified ? " ✓ Verificada" : ""}</p></div>
              <div><p className="text-xs text-[var(--color-navy-400)]">Trimestre</p><p className="text-[var(--color-navy-100)]">{selectedInvoice.fiscal_year} {selectedInvoice.quarter}</p></div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-4xl mb-3">📷</p>
          <p className="text-[var(--color-navy-400)]">No hay facturas todavía.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Sube una foto de factura y la IA extraerá los datos automáticamente.</p>
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
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Categoría</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Base</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">IVA</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-5 py-3">Total</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-[var(--color-navy-100)]">{inv.supplier_name || "Sin proveedor"}</p>
                      <p className="text-xs text-[var(--color-navy-400)]">{inv.supplier_nif}</p>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{inv.invoice_number || "—"}</td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("es-ES") : "—"}</td>
                    <td className="px-3 py-3 text-center"><span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-300">{categoryLabels[inv.category] || inv.category}</span></td>
                    <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-200)]">{Number(inv.base_amount).toFixed(2)}€</td>
                    <td className="px-3 py-3 text-right text-sm text-blue-300">{Number(inv.iva_amount).toFixed(2)}€</td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{Number(inv.total_amount).toFixed(2)}€</td>
                    <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-1 rounded-full ${statusLabels[inv.payment_status]?.color}`}>{statusLabels[inv.payment_status]?.label}</span></td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {inv.payment_status === "pending" && (
                        <button onClick={() => markAsPaid(inv.id)} className="text-xs text-[var(--color-brand-green)] hover:underline mr-2">Pagada</button>
                      )}
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
