"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const categories = [
  { value: "material", label: "Material" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "otros", label: "Otros" },
];

const units = ["ud", "m2", "ml", "h", "kg", "global", "m3", "l"];

const subcategories: Record<string, string[]> = {
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

  const [items, setItems] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("material");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState("ud");
  const [unitPrice, setUnitPrice] = useState(0);

  useEffect(() => { loadItems(); }, []);

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

    const payload = { name, description, category, subcategory, unit, unit_price: unitPrice };

    if (editingId) {
      await supabase.from("price_items").update(payload).eq("id", editingId);
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

  async function importDefaults() {
    if (!confirm("¿Importar precios por defecto del sector? Se añadirán a tu banco de precios actual.")) return;

    const defaults = [
      { name: "Azulejo porcelánico 30x60", category: "material", subcategory: "Albañilería", unit: "m2", unit_price: 18.50 },
      { name: "Azulejo cerámico básico", category: "material", subcategory: "Albañilería", unit: "m2", unit_price: 12.00 },
      { name: "Cemento cola flexible", category: "material", subcategory: "Albañilería", unit: "kg", unit_price: 0.45 },
      { name: "Lechada junta color", category: "material", subcategory: "Albañilería", unit: "kg", unit_price: 2.80 },
      { name: "Plato de ducha resina 80x120", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 185.00 },
      { name: "Mampara ducha fija 80cm", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 220.00 },
      { name: "Grifo monomando ducha termostático", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 145.00 },
      { name: "Inodoro suspendido completo", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 280.00 },
      { name: "Mueble lavabo 80cm + espejo", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 320.00 },
      { name: "Tubo PVC evacuación 110mm", category: "material", subcategory: "Fontanería", unit: "ml", unit_price: 8.50 },
      { name: "Tubo multicapa agua 20mm", category: "material", subcategory: "Fontanería", unit: "ml", unit_price: 4.20 },
      { name: "Llave de paso 1/2\"", category: "material", subcategory: "Fontanería", unit: "ud", unit_price: 12.00 },
      { name: "Cable eléctrico 2.5mm", category: "material", subcategory: "Electricidad", unit: "ml", unit_price: 1.20 },
      { name: "Mecanismo enchufe Schuko", category: "material", subcategory: "Electricidad", unit: "ud", unit_price: 8.50 },
      { name: "Punto de luz LED empotrable", category: "material", subcategory: "Electricidad", unit: "ud", unit_price: 15.00 },
      { name: "Diferencial 40A/30mA", category: "material", subcategory: "Electricidad", unit: "ud", unit_price: 45.00 },
      { name: "Pintura plástica blanca mate", category: "material", subcategory: "Pintura", unit: "l", unit_price: 4.50 },
      { name: "Impermeabilizante líquido", category: "material", subcategory: "Albañilería", unit: "kg", unit_price: 8.90 },
      { name: "Saco mortero M-5", category: "material", subcategory: "Albañilería", unit: "kg", unit_price: 0.12 },
      { name: "Oficial 1ª albañilería", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", unit_price: 25.00 },
      { name: "Oficial 1ª fontanería", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", unit_price: 28.00 },
      { name: "Oficial 1ª electricidad", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", unit_price: 27.00 },
      { name: "Oficial 1ª pintura", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", unit_price: 23.00 },
      { name: "Peón especializado", category: "mano_obra", subcategory: "Peón", unit: "h", unit_price: 18.00 },
      { name: "Peón ordinario", category: "mano_obra", subcategory: "Peón", unit: "h", unit_price: 15.00 },
      { name: "Contenedor escombros 3m3", category: "otros", subcategory: "Gestión residuos", unit: "ud", unit_price: 120.00 },
      { name: "Transporte materiales", category: "otros", subcategory: "Transporte", unit: "ud", unit_price: 60.00 },
      { name: "Alquiler andamio día", category: "otros", subcategory: "Alquiler maquinaria", unit: "ud", unit_price: 35.00 },
    ];

    for (const item of defaults) {
      await supabase.from("price_items").insert({
        ...item,
        description: "",
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

  const materialCount = items.filter((i) => i.category === "material").length;
  const laborCount = items.filter((i) => i.category === "mano_obra").length;
  const otherCount = items.filter((i) => i.category === "otros").length;

  const catLabel: Record<string, string> = { material: "Material", mano_obra: "Mano de obra", otros: "Otros" };
  const unitLabel: Record<string, string> = { ud: "ud", m2: "m²", ml: "ml", h: "h", kg: "kg", global: "global", m3: "m³", l: "l" };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Banco de precios</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">Configura tus precios base para materiales, mano de obra y otros gastos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={importDefaults} className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] rounded-lg text-sm font-medium hover:bg-[var(--color-navy-600)] transition">
            📥 Importar por defecto
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
            + Nuevo precio
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{materialCount}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Materiales</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{laborCount}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Mano de obra</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-400">{otherCount}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Otros</p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input type="text" placeholder="Buscar por nombre o subcategoría..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
          <option value="all">Todas las categorías</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Form */}
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
                {(subcategories[category] || []).map((s) => <option key={s} value={s}>{s}</option>)}
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

      {/* Items Table */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-[var(--color-navy-400)]">No hay precios configurados.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Pulsa "Importar por defecto" para cargar precios del sector o añade los tuyos manualmente.</p>
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
