"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSector } from "@/lib/sector-context";

/* Fallback constants (only used if sector config hasn't loaded) */
const fallbackCategories = [
  { value: "material", label: "Material" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "otros", label: "Otros" },
];

const fallbackUnits = ["ud", "m2", "ml", "h", "kg", "global", "m3", "l"];

const fallbackSubcategories: Record<string, string[]> = {
  material: ["Fontanería", "Electricidad", "Albañilería", "Pintura", "Carpintería", "Climatización", "Cristalería", "Cerrajería", "Otros"],
  mano_obra: ["Oficial 1ª", "Oficial 2ª", "Peón", "Especialista", "Subcontrata", "Otros"],
  otros: ["Transporte", "Alquiler maquinaria", "Gestión residuos", "Permisos", "Otros"],
};

interface PriceItem {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  unit: string;
  unit_price: number;
}

export default function PricesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { budgetCategories, subcategories: getSectorSubcats, options, defaultPrices, label } = useSector();

  // Dynamic categories, subcategories and units from sector config
  const sectorCats = budgetCategories();
  const categories = sectorCats.length > 0 ? sectorCats : fallbackCategories;
  const sectorUnits = options("units");
  const units = sectorUnits.length > 0 ? sectorUnits : fallbackUnits;

  // Dynamic subcategories: try sector config, fallback to hardcoded
  function getSubcats(cat: string): string[] {
    const fromSector = getSectorSubcats(cat);
    if (fromSector.length > 0) return fromSector;
    return fallbackSubcategories[cat] || [];
  }

  const [items, setItems] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0]?.value || "material");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState("ud");
  const [unitPrice, setUnitPrice] = useState(0);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      loadItems();
    }
    init();
  }, []);

  async function loadItems() {
    const { data } = await supabase
      .from("price_items")
      .select("*")
      .order("category")
      .order("subcategory")
      .order("name");
    setItems(data || []);
    setLoading(false);
  }

  function resetForm() {
    setName(""); setDescription(""); setCategory("material");
    setSubcategory(""); setUnit("ud"); setUnitPrice(0);
    setEditingId(null); setShowForm(false);
  }

  function startEdit(item: PriceItem) {
    setName(item.name); setDescription(item.description);
    setCategory(item.category); setSubcategory(item.subcategory);
    setUnit(item.unit); setUnitPrice(item.unit_price);
    setEditingId(item.id); setShowForm(true);
  }

  async function handleSave() {
    if (!name || unitPrice <= 0) { alert("Completa nombre y precio válido."); return; }
    const payload = { name, description, category, subcategory, unit, unit_price: unitPrice, user_id: userId };
    if (editingId) {
      await supabase.from("price_items").update({ name, description, category, subcategory, unit, unit_price: unitPrice }).eq("id", editingId);
    } else {
      await supabase.from("price_items").insert(payload);
    }
    resetForm();
    loadItems();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este precio?")) return;
    await supabase.from("price_items").delete().eq("id", id);
    loadItems();
  }

  // Importar precios REALES desde sector_data (datos de n8n)
  async function syncFromMarket() {
    if (!userId) { alert("Error: no se pudo obtener tu usuario. Recarga la página."); return; }
    if (!confirm("¿Importar precios actualizados del mercado (n8n)? Se añadirán los nuevos y se actualizarán los existentes.")) return;
    setSyncing(true);

    try {
      const { data: marketPrices } = await supabase
        .from("sector_data")
        .select("*")
        .eq("data_type", "price")
        .order("last_updated", { ascending: false });

      if (!marketPrices || marketPrices.length === 0) {
        alert("No hay precios de mercado disponibles todavía. Ejecuta el workflow de n8n primero.");
        setSyncing(false);
        return;
      }

      const { data: currentItems } = await supabase
        .from("price_items")
        .select("name");
      const existingNames = new Set((currentItems || []).map(i => i.name.toLowerCase()));

      let added = 0;
      let updated = 0;

      for (const mp of marketPrices) {
        const itemName = mp.title || "";
        if (!itemName) continue;

        let subcat = mp.subcategory || "Otros";
        if (subcat === "Fontaneria") subcat = "Fontanería";
        if (subcat === "Albanileria") subcat = "Albañilería";

        const priceValue = parseFloat(mp.value) || 0;
        if (priceValue <= 0) continue;

        if (existingNames.has(itemName.toLowerCase())) {
          await supabase
            .from("price_items")
            .update({
              unit_price: priceValue,
              description: `Precio de mercado · ${mp.source || "n8n"} · ${new Date(mp.last_updated).toLocaleDateString("es-ES")}`,
            })
            .ilike("name", itemName);
          updated++;
        } else {
          const { error } = await supabase.from("price_items").insert({
            user_id: userId,
            name: itemName,
            description: `Precio de mercado · ${mp.source || "n8n"} · ${new Date(mp.last_updated).toLocaleDateString("es-ES")}`,
            category: mp.category || "material",
            subcategory: subcat,
            unit: mp.unit || "ud",
            unit_price: priceValue,
          });
          if (error) console.error("Error insertando:", itemName, error);
          else added++;
        }
      }

      setLastSync(new Date().toLocaleTimeString("es-ES"));
      alert(`Sincronización completada: ${added} nuevos, ${updated} actualizados.`);
    } catch (err) {
      console.error("Error sincronizando:", err);
      alert("Error al sincronizar. Revisa la consola.");
    }

    setSyncing(false);
    loadItems();
  }

  async function importDefaults() {
    if (!userId) { alert("Error: no se pudo obtener tu usuario. Recarga la página."); return; }
    if (!confirm("¿Importar precios por defecto del sector? Se añadirán a tu banco de precios actual.")) return;

    const sectorDefaults = defaultPrices();

    if (sectorDefaults.length === 0) {
      alert("No hay precios por defecto configurados para tu sector.");
      return;
    }

    for (const item of sectorDefaults) {
      await supabase.from("price_items").insert({
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        unit: item.unit,
        unit_price: item.price,
        description: "",
        user_id: userId,
      });
    }
    loadItems();
  }

  const filtered = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.subcategory.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "all" || item.category === filterCat;
    return matchSearch && matchCat;
  });

  // Build category label map dynamically
  const catLabel: Record<string, string> = Object.fromEntries(categories.map(c => [c.value, c.label]));
  const unitLabel: Record<string, string> = { ud: "ud", m2: "m²", ml: "ml", h: "h", kg: "kg", global: "global", m3: "m³", l: "l", "m²": "m²", "m³": "m³", mes: "mes", sesión: "sesión", palet: "palet", caja: "caja", pack: "pack", proyecto: "proyecto" };

  // KPIs: show first 3 categories dynamically
  const kpiCats = categories.slice(0, 3);
  const kpiColors = ["text-blue-400", "text-orange-400", "text-gray-400"];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Banco de precios</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">
            Configura tus precios base para materiales, mano de obra y otros gastos
            {lastSync && <span className="ml-2 text-[var(--color-brand-green)]">· Sincronizado: {lastSync}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={syncFromMarket} disabled={syncing} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {syncing ? "⏳ Sincronizando..." : "🔄 Sync mercado (n8n)"}
          </button>
          <button onClick={importDefaults} className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] rounded-lg text-sm font-medium hover:bg-[var(--color-navy-600)] transition">
            📥 Importar por defecto
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
            + Nuevo precio
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-${Math.min(kpiCats.length, 4)} gap-4 mb-6`}>
        {kpiCats.map((cat, i) => (
          <div key={cat.value} className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${kpiColors[i] || "text-gray-400"}`}>{items.filter(it => it.category === cat.value).length}</p>
            <p className="text-xs text-[var(--color-navy-400)]">{cat.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input type="text" placeholder="Buscar por nombre o subcategoría..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
          <option value="all">Todas las categorías</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
            {editingId ? "Editar precio" : "Nuevo precio"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nombre *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Azulejo porcelánico 30x60" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Precio unitario *</label>
              <input type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Categoría</label>
              <select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Subcategoría</label>
              <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                <option value="">Seleccionar...</option>
                {getSubcats(category).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Unidad</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Descripción (opcional)</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalles adicionales..." className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleSave} className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              {editingId ? "Guardar cambios" : "Añadir precio"}
            </button>
            <button onClick={resetForm} className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm hover:bg-[var(--color-navy-600)] transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-[var(--color-navy-400)]">No hay precios configurados.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Pulsa "Sync mercado" para importar precios reales de n8n o "Importar por defecto" para cargar precios base.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-navy-700)]">
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Nombre</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Categoría</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Subcategoría</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Unidad</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Precio</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-[var(--color-navy-100)]">{item.name}</p>
                      {item.description && <p className="text-xs text-[var(--color-navy-400)]">{item.description}</p>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        item.category === "material" ? "bg-blue-900/30 text-blue-300" :
                        item.category === "mano_obra" ? "bg-orange-900/30 text-orange-300" :
                        "bg-gray-700 text-gray-300"
                      }`}>{catLabel[item.category]}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{item.subcategory || "—"}</td>
                    <td className="px-3 py-3 text-center text-sm text-[var(--color-navy-200)]">{unitLabel[item.unit] || item.unit}</td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{item.unit_price.toFixed(2)} €</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => startEdit(item)} className="text-xs text-[var(--color-brand-green)] hover:underline mr-3">Editar</button>
                      <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
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
