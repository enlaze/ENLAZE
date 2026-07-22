"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";

const INPUT =
  "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500";

const LBL = "block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1.5";

const PRODUCT_TYPES = [
  { value: "material", label: "Material" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "maquinaria", label: "Maquinaria" },
  { value: "transporte", label: "Transporte" },
  { value: "residuos", label: "Residuos" },
  { value: "subcontrata", label: "Subcontrata" },
  { value: "epi", label: "EPI / Seguridad" },
  { value: "herramienta", label: "Herramienta" },
];

const CATEGORIES: Record<string, { value: string; label: string }[]> = {
  material: [
    { value: "albanileria", label: "Albanileria" },
    { value: "estructura", label: "Estructura" },
    { value: "cubiertas", label: "Cubiertas" },
    { value: "aislamiento", label: "Aislamiento" },
    { value: "revestimientos", label: "Revestimientos" },
    { value: "tabiqueria_seca", label: "Tabiqueria seca" },
    { value: "fontaneria", label: "Fontaneria" },
    { value: "electricidad", label: "Electricidad" },
    { value: "carpinteria", label: "Carpinteria" },
    { value: "pintura", label: "Pintura" },
    { value: "climatizacion", label: "Climatizacion" },
  ],
  mano_obra: [
    { value: "albanileria", label: "Albanileria" },
    { value: "estructura", label: "Estructura" },
    { value: "fontaneria", label: "Fontaneria" },
    { value: "electricidad", label: "Electricidad" },
    { value: "pintura", label: "Pintura" },
    { value: "revestimientos", label: "Revestimientos" },
    { value: "carpinteria", label: "Carpinteria" },
    { value: "climatizacion", label: "Climatizacion" },
    { value: "tabiqueria_seca", label: "Tabiqueria seca" },
    { value: "direccion", label: "Direccion de obra" },
    { value: "seguridad", label: "Seguridad/PRL" },
  ],
  maquinaria: [
    { value: "movimiento_tierras", label: "Movimiento de tierras" },
    { value: "compactacion", label: "Compactacion" },
    { value: "elevacion", label: "Elevacion" },
    { value: "hormigon", label: "Hormigon" },
    { value: "andamios", label: "Andamios" },
    { value: "demolicion", label: "Demolicion" },
    { value: "energia", label: "Energia" },
  ],
  transporte: [
    { value: "camiones", label: "Camiones" },
    { value: "grua", label: "Grua" },
    { value: "furgonetas", label: "Furgonetas" },
    { value: "hormigon", label: "Hormigon" },
    { value: "aridos", label: "Aridos" },
  ],
  residuos: [
    { value: "contenedores", label: "Contenedores" },
    { value: "sacos", label: "Sacos" },
    { value: "canon_vertedero", label: "Canon vertedero" },
    { value: "selectiva", label: "Recogida selectiva" },
    { value: "peligrosos", label: "Peligrosos" },
  ],
  subcontrata: [
    { value: "albanileria", label: "Albanileria" },
    { value: "revestimientos", label: "Revestimientos" },
    { value: "pintura", label: "Pintura" },
    { value: "electricidad", label: "Electricidad" },
    { value: "fontaneria", label: "Fontaneria" },
    { value: "carpinteria", label: "Carpinteria" },
    { value: "climatizacion", label: "Climatizacion" },
    { value: "demoliciones", label: "Demoliciones" },
    { value: "movimiento_tierras", label: "Movimiento tierras" },
    { value: "tabiqueria_seca", label: "Tabiqueria seca" },
  ],
  epi: [
    { value: "proteccion_cabeza", label: "Proteccion cabeza" },
    { value: "proteccion_ocular", label: "Proteccion ocular" },
    { value: "proteccion_manos", label: "Proteccion manos" },
    { value: "calzado", label: "Calzado" },
    { value: "ropa", label: "Ropa" },
    { value: "anticaidas", label: "Anticaidas" },
    { value: "proteccion_colectiva", label: "Proteccion colectiva" },
  ],
  herramienta: [
    { value: "discos", label: "Discos" },
    { value: "brocas", label: "Brocas" },
    { value: "medicion", label: "Medicion" },
    { value: "albanileria", label: "Albanileria" },
    { value: "sellado", label: "Sellado" },
  ],
};

const UNITS = ["ud", "m2", "ml", "m3", "kg", "t", "h", "dia", "mes", "viaje", "par", "m2/mes"];

export default function AddProviderPricePanel({ onAdded, sector = "construccion" }: { onAdded?: () => void; sector?: string }) {
  const supabase = createClient();
  const toast = useToast();

  const [mode, setMode] = useState<"product" | "provider">("product");
  const [saving, setSaving] = useState(false);

  // Provider fields
  const [provName, setProvName] = useState("");
  const [provLegalName, setProvLegalName] = useState("");
  const [provNif, setProvNif] = useState("");
  const [provWebsite, setProvWebsite] = useState("");
  const [provProvince, setProvProvince] = useState("");
  const [provPhone, setProvPhone] = useState("");

  // Product fields
  const [productType, setProductType] = useState("material");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("ud");
  const [price, setPrice] = useState<number | "">("");
  const [brand, setBrand] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [loadedProviders, setLoadedProviders] = useState(false);

  async function loadProviders() {
    if (loadedProviders) return;
    const { data } = await supabase
      .from("pb_providers")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    setProviders(data || []);
    setLoadedProviders(true);
  }

  async function saveProvider() {
    if (!provName.trim()) {
      toast.error("El nombre del proveedor es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("pb_providers").insert({
        name: provName.trim(),
        legal_name: provLegalName.trim() || provName.trim(),
        nif: provNif.trim() || null,
        website: provWebsite.trim() || null,
        province: provProvince.trim() || null,
        country: "ES",
        is_active: true,
      });
      if (error) throw error;
      toast.success(`Proveedor "${provName}" creado correctamente`);
      setProvName("");
      setProvLegalName("");
      setProvNif("");
      setProvWebsite("");
      setProvProvince("");
      setProvPhone("");
      setLoadedProviders(false);
      onAdded?.();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar proveedor");
    } finally {
      setSaving(false);
    }
  }

  async function saveProduct() {
    if (!name.trim() || !price) {
      toast.error("Nombre y precio son obligatorios");
      return;
    }
    setSaving(true);
    try {
      // If no provider selected, use "Referencia mercado ES"
      let finalProviderId = providerId;
      if (!finalProviderId) {
        const { data } = await supabase
          .from("pb_providers")
          .select("id")
          .eq("name", "Referencia mercado ES")
          .is("company_id", null)
          .limit(1);
        if (data && data.length > 0) {
          finalProviderId = data[0].id;
        }
      }

      if (!finalProviderId) {
        toast.error("No se encontro un proveedor base. Crea uno primero.");
        setSaving(false);
        return;
      }

      const { error } = await supabase.from("pb_products").insert({
        provider_id: finalProviderId,
        commercial_name: name.trim(),
        description: description.trim(),
        sale_unit: unit,
        unit_price: Number(price),
        brand: brand.trim() || null,
        product_type: productType,
        category,
        subcategory,
        sector,
        region: "ES",
        is_active: true,
        is_available: true,
        checked_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success(`Producto "${name}" anadido correctamente`);
      setName("");
      setDescription("");
      setPrice("");
      setBrand("");
      onAdded?.();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar producto");
    } finally {
      setSaving(false);
    }
  }

  const cats = CATEGORIES[productType] || [];

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("product")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            mode === "product"
              ? "bg-brand-green text-white"
              : "bg-navy-100 text-navy-600 hover:bg-navy-200 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          Anadir producto/precio
        </button>
        <button
          onClick={() => setMode("provider")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            mode === "provider"
              ? "bg-brand-green text-white"
              : "bg-navy-100 text-navy-600 hover:bg-navy-200 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          Anadir proveedor
        </button>
      </div>

      {mode === "provider" ? (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-navy-100 dark:border-zinc-800 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-navy-900 dark:text-white">Nuevo proveedor</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={LBL}>Nombre comercial *</label>
              <input className={INPUT} value={provName} onChange={(e) => setProvName(e.target.value)} placeholder="Ej: Materiales Lopez" />
            </div>
            <div>
              <label className={LBL}>Razon social</label>
              <input className={INPUT} value={provLegalName} onChange={(e) => setProvLegalName(e.target.value)} placeholder="Ej: Materiales Lopez S.L." />
            </div>
            <div>
              <label className={LBL}>NIF/CIF</label>
              <input className={INPUT} value={provNif} onChange={(e) => setProvNif(e.target.value)} placeholder="B12345678" />
            </div>
            <div>
              <label className={LBL}>Web</label>
              <input className={INPUT} value={provWebsite} onChange={(e) => setProvWebsite(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className={LBL}>Provincia</label>
              <input className={INPUT} value={provProvince} onChange={(e) => setProvProvince(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label className={LBL}>Telefono</label>
              <input className={INPUT} value={provPhone} onChange={(e) => setProvPhone(e.target.value)} placeholder="612 345 678" />
            </div>
          </div>
          <button
            onClick={saveProvider}
            disabled={saving}
            className="mt-2 px-6 py-2.5 bg-brand-green text-white font-semibold rounded-xl hover:bg-brand-green/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Guardando..." : "Guardar proveedor"}
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-navy-100 dark:border-zinc-800 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-navy-900 dark:text-white">Nuevo producto / precio</h3>

          {/* Tipo + Categoria */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={LBL}>Tipo *</label>
              <select
                className={INPUT}
                value={productType}
                onChange={(e) => {
                  setProductType(e.target.value);
                  setCategory("");
                  setSubcategory("");
                }}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LBL}>Categoria</label>
              <select className={INPUT} value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}>
                <option value="">— Seleccionar —</option>
                {cats.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LBL}>Subcategoria</label>
              <input className={INPUT} value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          {/* Nombre + Descripcion */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={LBL}>Nombre del producto *</label>
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cemento gris CEM II saco 25 kg" />
            </div>
            <div>
              <label className={LBL}>Descripcion</label>
              <input className={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripcion opcional" />
            </div>
          </div>

          {/* Precio + Unidad + Marca */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className={LBL}>Precio sin IVA *</label>
              <input
                className={INPUT}
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : "")}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className={LBL}>Unidad</label>
              <select className={INPUT} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LBL}>Marca</label>
              <input className={INPUT} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label className={LBL}>Proveedor</label>
              <select
                className={INPUT}
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                onFocus={loadProviders}
              >
                <option value="">Referencia mercado</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={saveProduct}
            disabled={saving}
            className="mt-2 px-6 py-2.5 bg-brand-green text-white font-semibold rounded-xl hover:bg-brand-green/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Guardando..." : "Guardar producto"}
          </button>
        </div>
      )}
    </div>
  );
}
