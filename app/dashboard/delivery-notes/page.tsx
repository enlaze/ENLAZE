"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ═══════════════ Types ═══════════════ */

interface DeliveryNote {
  id: string;
  project_id: string | null;
  supplier_id: string | null;
  order_id: string | null;
  invoice_id: string | null;
  note_number: string;
  status: string;
  reception_date: string;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes: string;
  created_at: string;
}

interface Supplier { id: string; name: string; }
interface Project { id: string; name: string; }
interface OrderMin { id: string; title: string; order_number: string; }

/* ═══════════════ Labels ═══════════════ */

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  received: { label: "Recibido", color: "bg-blue-900/30 text-blue-300" },
  verified: { label: "Verificado", color: "bg-green-900/30 text-green-300" },
  disputed: { label: "Incidencia", color: "bg-red-900/30 text-red-300" },
};

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

/* ═══════════════ Page ═══════════════ */

export default function DeliveryNotesPage() {
  const router = useRouter();
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const [userId, setUserId] = useState<string | null>(null);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [orders, setOrders] = useState<OrderMin[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    note_number: "", supplier_id: "", project_id: "", order_id: "",
    reception_date: new Date().toISOString().split("T")[0], notes: "",
  });

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [notesRes, suppliersRes, projectsRes, ordersRes] = await Promise.all([
      supabase.from("delivery_notes").select("*").eq("user_id", user.id).order("reception_date", { ascending: false }),
      supabase.from("suppliers").select("id, name").eq("status", "active").order("name"),
      supabase.from("projects").select("id, name").order("name"),
      supabase.from("orders").select("id, title, order_number").eq("user_id", user.id).order("order_date", { ascending: false }),
    ]);

    setNotes((notesRes.data as DeliveryNote[]) || []);
    setSuppliers((suppliersRes.data as Supplier[]) || []);
    setProjects((projectsRes.data as Project[]) || []);
    setOrders((ordersRes.data as OrderMin[]) || []);
    setLoading(false);
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    const { error } = await supabase.from("delivery_notes").insert({
      user_id: userId,
      note_number: form.note_number.trim(),
      supplier_id: form.supplier_id || null,
      project_id: form.project_id || null,
      order_id: form.order_id || null,
      reception_date: form.reception_date,
      notes: form.notes,
      status: "pending",
    });

    if (error) alert("Error: " + error.message);
    else {
      setForm({ note_number: "", supplier_id: "", project_id: "", order_id: "", reception_date: new Date().toISOString().split("T")[0], notes: "" });
      setShowForm(false);
      const { data } = await supabase.from("delivery_notes").select("*").eq("user_id", userId).order("reception_date", { ascending: false });
      setNotes((data as DeliveryNote[]) || []);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este albarán y todas sus líneas?")) return;
    await supabase.from("delivery_notes").delete().eq("id", id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  const filtered = notes.filter((n) => {
    if (filterStatus !== "all" && n.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!n.note_number.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name || "—";
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name || "—";
  const orderLabel = (id: string | null) => {
    const o = orders.find((o) => o.id === id);
    return o ? (o.order_number || o.title) : "—";
  };

  // KPIs
  const totalAlbaranes = notes.length;
  const pendientes = notes.filter((n) => n.status === "pending" || n.status === "received").length;
  const conIncidencia = notes.filter((n) => n.status === "disputed").length;
  const totalImporte = notes.reduce((s, n) => s + Number(n.total || 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Albaranes</h1>
          <p className="text-sm text-[var(--color-navy-400)]">Recepción de material y servicios</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-5 py-2.5 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-xl font-semibold text-sm hover:opacity-90 transition">
          + Nuevo albarán
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-blue-400">{totalAlbaranes}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Total albaranes</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-yellow-400">{pendientes}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Pendientes/Recibidos</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-red-400">{conIncidencia}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Con incidencia</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-emerald-400">{eur(totalImporte)}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Importe total</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">Nuevo albarán</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nº Albarán</label>
              <input type="text" value={form.note_number} onChange={(e) => setForm({ ...form, note_number: e.target.value })} className={inputCls} placeholder="ALB-001" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Proveedor</label>
              <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Obra</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Pedido vinculado</label>
              <select value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} className={inputCls}>
                <option value="">Ninguno</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number || o.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha recepción</label>
              <input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Observaciones" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[var(--color-navy-400)] hover:text-[var(--color-navy-200)] transition">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {saving ? "Guardando..." : "Crear albarán"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Buscar por nº albarán..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-100)] rounded-lg px-4 py-2 text-sm border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none w-64" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-100)] rounded-lg px-3 py-2 text-sm border border-[var(--color-navy-700)]">
          <option value="all">Todos los estados</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay albaranes{search || filterStatus !== "all" ? " con esos filtros" : ""}.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-navy-700)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Nº Albarán</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Proveedor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Obra</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Pedido</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Fecha</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Estado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => {
                const st = statusMap[n.status] || { label: n.status, color: "bg-gray-700 text-gray-300" };
                return (
                  <tr key={n.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/delivery-notes/${n.id}`} className="text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] font-medium font-mono transition">
                        {n.note_number || "Sin nº"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-navy-400)]">{supplierName(n.supplier_id)}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-400)]">{projectName(n.project_id)}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-400)]">{orderLabel(n.order_id)}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(n.reception_date)}</td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(n.total)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/delivery-notes/${n.id}`} className="text-xs text-[var(--color-brand-green)] hover:underline">Detalle</Link>
                        <button onClick={() => handleDelete(n.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
