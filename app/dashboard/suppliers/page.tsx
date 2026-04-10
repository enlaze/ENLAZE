"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSector } from "@/lib/sector-context";

interface Supplier {
  id: string;
  user_id: string;
  name: string;
  nif: string;
  email: string;
  phone: string;
  address: string;
  contact_person: string;
  trade: string;
  specialty: string;
  type: string;
  hourly_rate: number;
  notes: string;
  status: string;
  rating: number;
  created_at: string;
}

/* Default trade options (used as fallback when sector config not loaded) */
const defaultTradeOptions = [
  "Albañilería","Fontanería","Electricidad","Pintura","Carpintería",
  "Climatización","Cerrajería","Cristalería","Impermeabilización",
  "Demolición","Estructuras","Escayola / Pladur","Solados y alicatados",
  "Material de construcción","Ferretería","Contenedores / residuos",
  "Transporte","Maquinaria","Seguridad y PRL","General",
];

const typeOptions = [
  { value: "proveedor", label: "Proveedor" },
  { value: "subcontrata", label: "Subcontrata" },
];

const emptyForm = {
  name: "", nif: "", email: "", phone: "", address: "",
  contact_person: "", trade: "general", specialty: "",
  type: "proveedor", hourly_rate: 0, notes: "", status: "active",
  rating: 0,
};

export default function SuppliersPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { label, options } = useSector();

  const [userId, setUserId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filterTrade, setFilterTrade] = useState("all");
  const [filterType, setFilterType] = useState("all");

  // Dynamic trade/specialty options from sector config
  const sectorTrades = options("trades");
  const sectorSpecialties = options("specialties");
  const sectorCategories = options("categories");
  const dynamicOptions = sectorTrades.length > 0 ? sectorTrades : sectorSpecialties.length > 0 ? sectorSpecialties : sectorCategories.length > 0 ? sectorCategories : defaultTradeOptions;
  const tradeOptions = dynamicOptions.map(t => ({ value: t.toLowerCase().replace(/[\s/]+/g, "_"), label: t }));
  const tradeMap = Object.fromEntries(tradeOptions.map(t => [t.value, t.label]));

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers(data || []);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      await loadSuppliers();
      setLoading(false);
    }
    init();
  }, []);

  function resetForm() {
    setForm(emptyForm); setEditingId(null); setShowForm(false);
  }

  function startEdit(s: Supplier) {
    setForm({
      name: s.name, nif: s.nif || "", email: s.email || "", phone: s.phone || "",
      address: s.address || "", contact_person: s.contact_person || "",
      trade: s.trade || "general", specialty: s.specialty || "",
      type: s.type || "proveedor", hourly_rate: Number(s.hourly_rate || 0),
      notes: s.notes || "", status: s.status || "active", rating: s.rating || 0,
    });
    setEditingId(s.id); setShowForm(true);
  }

  async function handleSave() {
    if (!userId) return;
    if (!form.name.trim()) { alert("El nombre es obligatorio."); return; }

    const payload = {
      user_id: userId, name: form.name.trim(), nif: form.nif, email: form.email,
      phone: form.phone, address: form.address, contact_person: form.contact_person,
      trade: form.trade, specialty: form.specialty, type: form.type,
      hourly_rate: form.hourly_rate, notes: form.notes, status: form.status,
      rating: form.rating, updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await supabase.from("suppliers").update(payload).eq("id", editingId);
    } else {
      await supabase.from("suppliers").insert(payload);
    }
    resetForm(); await loadSuppliers();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este proveedor/subcontrata?")) return;
    await supabase.from("suppliers").delete().eq("id", id);
    await loadSuppliers();
  }

  const filtered = useMemo(() => {
    return suppliers.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.nif || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.contact_person || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.specialty || "").toLowerCase().includes(search.toLowerCase());
      const matchTrade = filterTrade === "all" || s.trade === filterTrade;
      const matchType = filterType === "all" || s.type === filterType;
      return matchSearch && matchTrade && matchType;
    });
  }, [suppliers, search, filterTrade, filterType]);

  const totalProveedores = suppliers.filter((s) => s.type === "proveedor").length;
  const totalSubcontratas = suppliers.filter((s) => s.type === "subcontrata").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">{label("suppliers")}</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">Gestiona tu red de proveedores, subcontratas y oficios</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
          + Nuevo proveedor
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{suppliers.length}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Total</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-brand-green)]">{totalProveedores}</p>
          <p className="text-xs text-[var(--color-navy-400)]">{label("suppliers")}</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{totalSubcontratas}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Subcontratas</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input type="text" placeholder="Buscar por nombre, NIF, contacto, especialidad..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
          <option value="all">Todos los tipos</option>
          {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filterTrade} onChange={(e) => setFilterTrade(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
          <option value="all">Todos los oficios</option>
          {tradeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
            {editingId ? "Editar proveedor" : "Nuevo proveedor / subcontrata"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nombre / Razón social *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Ej: Fontanería García S.L." />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Tipo</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
                {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">NIF / CIF</label>
              <input type="text" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} className={inputCls} placeholder="B12345678" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Persona de contacto</label>
              <input type="text" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className={inputCls} placeholder="Nombre del contacto" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Teléfono</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="600 000 000" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="email@empresa.com" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Oficio</label>
              <select value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} className={inputCls}>
                {tradeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Precio/hora (€)</label>
              <input type="number" min="0" step="0.5" value={form.hourly_rate || ""} onChange={(e) => setForm({ ...form, hourly_rate: parseFloat(e.target.value) || 0 })} className={inputCls} placeholder="0.00" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Dirección</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} placeholder="Dirección completa" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Especialidad</label>
              <input type="text" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className={inputCls} placeholder="Ej: Reformas de baño, Instalación solar..." />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Valoración (1-5)</label>
              <input type="number" min="0" max="5" value={form.rating || ""} onChange={(e) => setForm({ ...form, rating: parseInt(e.target.value) || 0 })} className={inputCls} placeholder="0" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} min-h-[80px]`} placeholder="Observaciones, condiciones, plazos..." />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleSave}
              className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              {editingId ? "Guardar cambios" : "Crear proveedor"}
            </button>
            <button onClick={resetForm}
              className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm hover:bg-[var(--color-navy-600)] transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-[var(--color-navy-400)]">No hay proveedores creados todavía.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Pulsa &quot;Nuevo proveedor&quot; para empezar.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-navy-700)]">
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Nombre</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Tipo</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Oficio</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Contacto</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">€/h</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Valoración</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-[var(--color-navy-100)]">{s.name}</p>
                      {s.nif && <p className="text-xs text-[var(--color-navy-400)]">{s.nif}</p>}
                      {s.specialty && <p className="text-xs text-[var(--color-navy-500)]">{s.specialty}</p>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        s.type === "subcontrata" ? "bg-orange-900/30 text-orange-300" : "bg-blue-900/30 text-blue-300"
                      }`}>
                        {s.type === "subcontrata" ? "Subcontrata" : "Proveedor"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{tradeMap[s.trade] || s.trade}</td>
                    <td className="px-3 py-3">
                      {s.contact_person && <p className="text-sm text-[var(--color-navy-200)]">{s.contact_person}</p>}
                      {s.phone && <p className="text-xs text-[var(--color-navy-400)]">{s.phone}</p>}
                      {s.email && <p className="text-xs text-[var(--color-navy-400)]">{s.email}</p>}
                    </td>
                    <td className="px-3 py-3 text-center text-sm text-[var(--color-navy-200)]">
                      {Number(s.hourly_rate || 0) > 0 ? `${Number(s.hourly_rate).toFixed(0)}€` : "—"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {s.rating > 0 ? (
                        <span className="text-sm text-yellow-400">{"★".repeat(s.rating)}{"☆".repeat(5 - s.rating)}</span>
                      ) : (
                        <span className="text-xs text-[var(--color-navy-500)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => startEdit(s)} className="text-xs text-[var(--color-brand-green)] hover:underline mr-3">Editar</button>
                      <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
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
