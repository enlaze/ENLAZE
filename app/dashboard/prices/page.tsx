/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSector } from "@/lib/sector-context";
import { getSectorConfig } from "@/lib/sector-config";
import { getSectorPriceConfig, getSectorAliases } from "@/lib/price-defaults";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";

interface PriceItem {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  unit: string;
  unit_price: number;
}

const categoryBadgeVariant = (cat: string): "blue" | "orange" | "purple" | "green" | "gray" => {
  if (cat === "material" || cat === "producto") return "blue";
  if (cat === "mano_obra" || cat === "servicio") return "orange";
  if (cat === "logistica" || cat === "maquinaria") return "purple";
  if (cat === "packaging" || cat === "marketing") return "green";
  return "gray";
};

export default function PricesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { budgetCategories, subcategories: getSectorSubcats, options, defaultPrices } = useSector();
  const confirm = useConfirm();
  const toast = useToast();

  const [items, setItems] = useState<PriceItem[]>([]);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sectorConfig, setSectorConfig] = useState(getSectorConfig("construccion"));

  // Sector-aware fallbacks from lib/price-defaults.ts
  const priceConfig = getSectorPriceConfig(sectorConfig.sector);
  const sectorCats = budgetCategories();
  const categories = sectorCats.length > 0 ? sectorCats : priceConfig.categories;
  const sectorUnits = options("units");
  const units = sectorUnits.length > 0 ? sectorUnits : priceConfig.units;

  function getSubcats(cat: string): string[] {
    const fromSector = getSectorSubcats(cat);
    if (fromSector.length > 0) return fromSector;
    return priceConfig.subcategories[cat] || [];
  }

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0]?.value || "producto");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState("ud");
  const [unitPrice, setUnitPrice] = useState(0);

  // 1. Load user context (auth + sector)
  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) {
          setContextLoaded(true);
          return;
        }
        setUserId(user.id);

        const { data: profile } = await supabase
          .from("profiles")
          .select("business_sector")
          .eq("id", user.id)
          .single();

        if (!cancelled) {
          setSectorConfig(getSectorConfig(profile?.business_sector));
        }
      } catch (err) {
        console.error("[prices] loadContext error:", err);
      } finally {
        if (!cancelled) setContextLoaded(true);
      }
    };
    loadContext();
    return () => { cancelled = true; };
  }, []);

  // 2. Load items only when userId + sector are ready
  async function loadItems() {
    if (!userId) return;
    setLoadingItems(true);
    try {
      const { data } = await supabase
        .from("price_items")
        .select("id, name, description, category, subcategory, unit, unit_price")
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector)
        .order("category")
        .order("subcategory")
        .order("name")
        .limit(500);

      setItems(data || []);
    } catch (err) {
      console.error("[prices] loadItems error:", err);
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    loadItems();
  }, [userId, sectorConfig.sector]);

  function resetForm() {
    setName(""); setDescription(""); setCategory(categories[0]?.value || "producto");
    setSubcategory(""); setUnit(units[0] || "ud"); setUnitPrice(0);
    setEditingId(null); setShowForm(false);
  }

  function startEdit(item: PriceItem) {
    setName(item.name); setDescription(item.description);
    setCategory(item.category); setSubcategory(item.subcategory);
    setUnit(item.unit); setUnitPrice(item.unit_price);
    setEditingId(item.id); setShowForm(true);
  }

  async function handleSave() {
    if (!userId) return;
    if (!name || unitPrice <= 0) { toast.error("Completa nombre y precio válido."); return; }
    const payload = {
      name,
      description,
      category,
      subcategory,
      unit,
      unit_price: unitPrice,
      user_id: userId,
      sector: sectorConfig.sector,
    };
    if (editingId) {
      await supabase
        .from("price_items")
        .update({
          name,
          description,
          category,
          subcategory,
          unit,
          unit_price: unitPrice,
        })
        .eq("id", editingId)
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector);
      toast.success("Precio actualizado");
    } else {
      await supabase.from("price_items").insert(payload);
      toast.success("Precio añadido");
    }
    resetForm();
    loadItems();
  }

  async function handleDelete(id: string) {
    if (!userId) return;
    const ok = await confirm({
      title: "Eliminar precio",
      description: "¿Eliminar este precio?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase
        .from("price_items")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector);

      await loadItems();
      toast.success("Precio eliminado");
    } catch (error) {
      toast.error("Error al eliminar el precio");
    }
  }

  // Importar precios REALES desde sector_data (datos de n8n)
  async function syncFromMarket() {
    if (!userId) { toast.error("No se pudo obtener tu usuario. Recarga la página."); return; }
    const ok = await confirm({
      title: "Importar precios actualizados",
      description: "¿Importar precios actualizados del mercado (n8n)? Se añadirán los nuevos y se actualizarán los existentes.",
      variant: "default",
      confirmLabel: "Importar",
    });
    if (!ok) return;
    setSyncing(true);

    try {
      // Filter by sector aliases to match both "comercio" and "comercio_local" etc.
      const sectorAliases = getSectorAliases(sectorConfig.sector);
      const { data: marketPrices } = await supabase
        .from("sector_data")
        .select("*")
        .eq("data_type", "price")
        .in("sector", sectorAliases)
        .order("last_updated", { ascending: false });

      if (!marketPrices || marketPrices.length === 0) {
        toast.error("No hay precios de mercado disponibles para tu sector. Ejecuta el workflow de n8n o usa 'Importar por defecto'.");
        setSyncing(false);
        return;
      }

      const { data: currentItems } = await supabase
        .from("price_items")
        .select("name")
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector);
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
            .ilike("name", itemName)
            .eq("user_id", userId)
            .eq("sector", sectorConfig.sector);
          updated++;
        } else {
          const { error } = await supabase.from("price_items").insert({
            user_id: userId,
            sector: sectorConfig.sector,
            name: itemName,
            description: `Precio de mercado · ${mp.source || "n8n"} · ${new Date(mp.last_updated).toLocaleDateString("es-ES")}`,
            category: mp.category || categories[0]?.value || "producto",
            subcategory: subcat,
            unit: mp.unit || "ud",
            unit_price: priceValue,
          });
          if (error) console.error("Error insertando:", itemName, error);
          else added++;
        }
      }

      toast.success(`Precios importados: ${added} nuevos, ${updated} actualizados.`);
    } catch (err) {
      console.error("Error sincronizando:", err);
      toast.error("Error al sincronizar precios");
    }

    setSyncing(false);
    loadItems();
  }

  async function importDefaults() {
    if (!userId) { toast.error("No se pudo obtener tu usuario. Recarga la página."); return; }
    const ok = await confirm({
      title: "Importar precios del sector",
      description: "¿Importar precios por defecto del sector? Se añadirán a tu banco de precios actual.",
      variant: "default",
      confirmLabel: "Importar",
    });
    if (!ok) return;

    // Try DB defaults first, then hardcoded fallback from price-defaults.ts
    let sectorDefaults = defaultPrices();
    if (sectorDefaults.length === 0) {
      sectorDefaults = priceConfig.defaults.map(d => ({
        name: d.name,
        category: d.category,
        subcategory: d.subcategory,
        unit: d.unit,
        price: d.price,
      }));
    }

    if (sectorDefaults.length === 0) {
      toast.error("No hay precios por defecto configurados para tu sector");
      return;
    }

    try {
      for (const item of sectorDefaults) {
        await supabase.from("price_items").insert({
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          unit: item.unit,
          unit_price: item.price,
          description: "",
          user_id: userId,
          sector: sectorConfig.sector,
        });
      }
      await loadItems();
      toast.success(`Precios del sector importados (${sectorDefaults.length})`);
    } catch (error) {
      toast.error("Error al importar precios del sector");
    }
  }

  // Build category label map dynamically
  const catLabel: Record<string, string> = Object.fromEntries(categories.map(c => [c.value, c.label]));
  const unitLabel: Record<string, string> = {
    ud: "ud", m2: "m²", ml: "ml", h: "h", kg: "kg", global: "global",
    m3: "m³", l: "l", "m²": "m²", "m³": "m³",
    mes: "mes", sesión: "sesión", palet: "palet", caja: "caja", pack: "pack", proyecto: "proyecto",
  };

  // KPIs: show first 3 categories dynamically
  const kpiCats = categories.slice(0, 3);
  const kpiAccents: Array<"blue" | "yellow" | "default"> = ["blue", "yellow", "default"];

  if (!contextLoaded || loadingItems) return <Loading />;

  const columns: Column<PriceItem>[] = [
    {
      key: "name",
      header: "Nombre",
      sortable: true,
      alwaysVisible: true,
      exportValue: (it) => it.name,
      render: (it) => (
        <div>
          <p className="text-sm font-medium text-navy-900 dark:text-white">{it.name}</p>
          {it.description && (
            <p className="mt-0.5 text-xs text-navy-500 dark:text-zinc-500">{it.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Categoría",
      sortable: true,
      exportValue: (it) => catLabel[it.category] || it.category,
      render: (it) => (
        <Badge variant={categoryBadgeVariant(it.category)}>
          {catLabel[it.category] || it.category}
        </Badge>
      ),
    },
    {
      key: "subcategory",
      header: "Subcategoría",
      sortable: true,
      hidden: "hidden md:table-cell",
      exportValue: (it) => it.subcategory || "",
      render: (it) => (
        <span className="text-xs text-navy-600 dark:text-zinc-400">
          {it.subcategory || "—"}
        </span>
      ),
    },
    {
      key: "unit",
      header: "Unidad",
      hidden: "hidden lg:table-cell",
      exportValue: (it) => unitLabel[it.unit] || it.unit,
      render: (it) => (
        <span className="text-sm text-navy-700 dark:text-zinc-300">
          {unitLabel[it.unit] || it.unit}
        </span>
      ),
    },
    {
      key: "unit_price",
      header: "Precio",
      align: "right",
      sortable: true,
      exportValue: (it) => Number(it.unit_price || 0),
      render: (it) => (
        <span className="text-sm font-semibold text-navy-900 dark:text-white tabular-nums">
          {Number(it.unit_price || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Acciones",
      align: "right",
      alwaysVisible: true,
      render: (it) => (
        <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => startEdit(it)}
            className="text-xs font-medium text-brand-green hover:underline"
          >
            Editar
          </button>
          <button
            onClick={() => handleDelete(it.id)}
            className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  const filters: FilterDef<PriceItem>[] = [
    {
      key: "category",
      label: "Categoría",
      options: categories.map((c) => ({ label: c.label, value: c.value })),
      matches: (it, v) => it.category === v,
    },
  ];

  return (
    <>
      <PageHeader
        title={sectorConfig.priceLabel}
        description={
          sectorConfig.sector === "comercio_local"
            ? "Configura tus tarifas, productos y precios base de tu negocio"
            : "Configura tus precios base para materiales, mano de obra y otros gastos"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={syncFromMarket} disabled={syncing} variant="secondary">
              {syncing ? "Sincronizando…" : "Sync mercado (n8n)"}
            </Button>
            <Button onClick={importDefaults} variant="secondary">
              Importar por defecto
            </Button>
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              + Nuevo precio
            </Button>
          </div>
        }
      />

      {kpiCats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {kpiCats.map((cat, i) => (
            <StatCard
              key={cat.value}
              label={cat.label}
              value={items.filter((it) => it.category === cat.value).length}
              accent={kpiAccents[i] || "default"}
            />
          ))}
        </div>
      )}

      {showForm && (
        <Card className="mb-6">
          <h3 className="mb-4 text-base font-semibold text-navy-900 dark:text-white">
            {editingId ? "Editar precio" : "Nuevo precio"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
            <FormField label="Nombre" required className="md:col-span-2">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={priceConfig.placeholder}
              />
            </FormField>

            <FormField label="Precio unitario" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
              />
            </FormField>

            <FormField label="Categoría">
              <Select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Subcategoría">
              <Select
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {getSubcats(category).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Unidad">
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {units.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Descripción (opcional)" className="md:col-span-3">
              <Input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalles adicionales..."
              />
            </FormField>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={resetForm}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>
              {editingId ? "Guardar cambios" : "Añadir precio"}
            </Button>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Sin precios todavía"
          description='Pulsa "Sync mercado" para importar precios reales de n8n o "Importar por defecto" para cargar precios base.'
        />
      ) : (
        <DataTable<PriceItem>
          columns={columns}
          data={items}
          rowKey={(it) => it.id}
          searchable
          searchPlaceholder="Buscar por nombre o subcategoría..."
          searchFields={(it) => [it.name, it.subcategory, it.description]}
          filters={filters}
          initialSort={{ key: "name", dir: "asc" }}
          pageSize={25}
          exportable
          exportFileName="banco-precios"
          toggleableColumns
          emptyMessage="Sin resultados. Prueba con otro término."
        />
      )}
    </>
  );
}
