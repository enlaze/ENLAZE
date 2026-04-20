"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSector } from "@/lib/sector-context";
import { getSectorConfig, normalizeSector } from "@/lib/sector-config";
import { getSectorPriceConfig, getSectorAliases } from "@/lib/price-defaults";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import PageHeader from "@/components/ui/page-header";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";
import Badge from "@/components/ui/badge";
import type { PriceListItem } from "@/lib/types/price";
import { PRICE_LIST_COLUMNS, SOURCE_TYPE_LABELS } from "@/lib/types/price";

/* ─── Helpers ──────────────────────────────────────────────────────── */

const fmt = (v: number | null | undefined) =>
  v != null ? v.toFixed(2) + " \u20AC" : "\u2014";

const fmtPct = (v: number | null | undefined) =>
  v != null ? v.toFixed(1) + " %" : "\u2014";

const sourceVariant = (s?: string | null) => {
  if (s === "manual") return "green" as const;
  if (s === "n8n_sync") return "blue" as const;
  if (s === "import_csv") return "purple" as const;
  if (s === "default") return "gray" as const;
  return "gray" as const;
};

const catVariant = (c: string) => {
  if (c === "producto" || c === "material") return "blue" as const;
  if (c === "servicio" || c === "mano_obra") return "orange" as const;
  if (c === "logistica" || c === "maquinaria") return "purple" as const;
  if (c === "packaging" || c === "marketing") return "green" as const;
  return "gray" as const;
};

const INPUT_CLS =
  "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500";

const LABEL_CLS = "block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1.5";

/* ═══════════════════════════════════════════════════════════════════ */

export default function PricesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { sectorKey, budgetCategories, subcategories: getSectorSubcats, options, defaultPrices } = useSector();
  const confirm = useConfirm();
  const toast = useToast();

  const [items, setItems] = useState<PriceListItem[]>([]);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const normalizedSector = normalizeSector(sectorKey);
  const sectorConfig = getSectorConfig(normalizedSector);
  const isRetail = sectorConfig.sector === "comercio_local";

  // Sector-aware fallbacks
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

  const catLabel: Record<string, string> = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.value, c.label])),
    [categories]
  );

  /* ─── Form state ─────────────────────────────────────────────────── */
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0]?.value || "producto");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState("ud");
  const [unitPrice, setUnitPrice] = useState(0);
  // Retail-only form fields
  const [brand, setBrand] = useState("");
  const [format, setFormat] = useState("");
  const [family, setFamily] = useState("");
  const [purchasePrice, setPurchasePrice] = useState<number | "">("");
  const [salePrice, setSalePrice] = useState<number | "">("");
  const [vatRate, setVatRate] = useState<number>(21);
  const [supplierName, setSupplierName] = useState("");
  const [businessSubsector, setBusinessSubsector] = useState("");
  const [isManualOverride, setIsManualOverride] = useState(false);

  /* ─── Computed KPIs ──────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const total = items.length;
    const manual = items.filter((i) => i.source_type === "manual" || !i.source_type).length;
    const synced = items.filter((i) => i.source_type === "n8n_sync").length;
    const avgMargin = isRetail
      ? items.reduce((sum, i) => sum + (i.gross_margin_pct ?? 0), 0) / (total || 1)
      : 0;
    return { total, manual, synced, avgMargin };
  }, [items, isRetail]);

  /* ─── Load context & items ───────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          setContextLoaded(true);
          return;
        }
        setUserId(user.id);
        // Profile load kept for future use
        await supabase.from("profiles").select("business_sector").eq("id", user.id).single();
      } catch (err) {
        console.error("[prices] loadContext error:", err);
      } finally {
        if (!cancelled) setContextLoaded(true);
      }
    };
    loadContext();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadItems() {
    if (!userId) return;
    setLoadingItems(true);
    try {
      const { data } = await supabase
        .from("price_items")
        .select(PRICE_LIST_COLUMNS)
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector)
        .order("category")
        .order("subcategory")
        .order("name")
        .limit(1000);
      setItems((data as PriceListItem[]) || []);
    } catch (err) {
      console.error("[prices] loadItems error:", err);
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sectorConfig.sector]);

  /* ─── Form handlers ──────────────────────────────────────────────── */
  function resetForm() {
    setName("");
    setDescription("");
    setCategory(categories[0]?.value || "producto");
    setSubcategory("");
    setUnit(units[0] || "ud");
    setUnitPrice(0);
    setBrand("");
    setFormat("");
    setFamily("");
    setPurchasePrice("");
    setSalePrice("");
    setVatRate(21);
    setSupplierName("");
    setBusinessSubsector("");
    setIsManualOverride(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(item: PriceListItem) {
    setName(item.name);
    setDescription(item.description);
    setCategory(item.category);
    setSubcategory(item.subcategory);
    setUnit(item.unit);
    setUnitPrice(item.unit_price);
    setBrand(item.brand ?? "");
    setFormat(item.format ?? "");
    setFamily(item.family ?? "");
    setPurchasePrice(item.purchase_price ?? "");
    setSalePrice(item.recommended_sale_price ?? "");
    setVatRate(item.vat_rate ?? 21);
    setSupplierName(item.supplier_name ?? "");
    setBusinessSubsector(item.business_subsector ?? "");
    setIsManualOverride(true); // editing = manual
    setEditingId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!userId) return;
    if (!name || unitPrice <= 0) {
      toast.error("Completa nombre y precio válido.");
      return;
    }

    // Auto-compute margin if both prices present
    const pp = typeof purchasePrice === "number" ? purchasePrice : undefined;
    const sp = typeof salePrice === "number" ? salePrice : undefined;
    let margin: number | undefined;
    if (pp != null && sp != null && sp > 0) {
      margin = ((sp - pp) / sp) * 100;
    }

    const base: Record<string, unknown> = {
      name,
      description,
      category,
      subcategory,
      unit,
      unit_price: unitPrice,
    };

    // Retail fields (always sent — DB ignores nulls for construction)
    if (isRetail) {
      Object.assign(base, {
        brand: brand || null,
        format: format || null,
        family: family || null,
        purchase_price: pp ?? null,
        recommended_sale_price: sp ?? null,
        vat_rate: vatRate,
        gross_margin_pct: margin ?? null,
        supplier_name: supplierName || null,
        business_subsector: businessSubsector || null,
        is_manual_override: isManualOverride,
        source_type: "manual",
        confidence_score: 1.0,
      });
    }

    if (editingId) {
      await supabase
        .from("price_items")
        .update(base)
        .eq("id", editingId)
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector);
    } else {
      await supabase.from("price_items").insert({
        ...base,
        user_id: userId,
        sector: sectorConfig.sector,
        source_type: base.source_type ?? "manual",
        confidence_score: base.confidence_score ?? 1.0,
      });
    }
    resetForm();
    loadItems();
    toast.success(editingId ? "Precio actualizado" : "Precio creado");
  }

  async function handleDelete(id: string) {
    if (!userId) return;
    const ok = await confirm({
      title: "Eliminar precio",
      description: "¿Eliminar este precio? Esta acción no se puede deshacer.",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("price_items").delete().eq("id", id).eq("user_id", userId).eq("sector", sectorConfig.sector);
      await loadItems();
      toast.success("Precio eliminado");
    } catch {
      toast.error("Error al eliminar el precio");
    }
  }

  async function handleToggleManual(item: PriceListItem) {
    if (!userId) return;
    const newVal = !(item.source_type === "manual");
    await supabase
      .from("price_items")
      .update({
        is_manual_override: newVal,
        source_type: newVal ? "manual" : item.source_type,
      })
      .eq("id", item.id)
      .eq("user_id", userId);
    await loadItems();
    toast.success(newVal ? "Marcado como manual (no se sobrescribirá en sync)" : "Desbloqueado para sync automático");
  }

  /* ─── Sync from market (n8n) ─────────────────────────────────────── */
  async function syncFromMarket() {
    if (!userId) {
      toast.error("Error: no se pudo obtener tu usuario. Recarga la página.");
      return;
    }
    const ok = await confirm({
      title: "Importar precios actualizados",
      description: "¿Importar precios actualizados del mercado (n8n)? Se añadirán los nuevos y se actualizarán los existentes. Los precios marcados como manuales no se sobrescribirán.",
      variant: "default",
      confirmLabel: "Importar",
    });
    if (!ok) return;
    setSyncing(true);

    try {
      const sectorAliases = getSectorAliases(sectorConfig.sector);
      const { data: marketPrices } = await supabase
        .from("sector_data")
        .select("*")
        .eq("data_type", "price")
        .in("sector", sectorAliases)
        .order("last_updated", { ascending: false });

      if (!marketPrices || marketPrices.length === 0) {
        toast.error("No hay precios de mercado disponibles. Ejecuta el workflow de n8n o usa 'Importar por defecto'.");
        setSyncing(false);
        return;
      }

      const { data: currentItems } = await supabase
        .from("price_items")
        .select("name")
        .eq("user_id", userId)
        .eq("sector", sectorConfig.sector);
      const existingNames = new Set((currentItems || []).map((i) => i.name.toLowerCase()));

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
              description: `Precio de mercado \u00B7 ${mp.source || "n8n"} \u00B7 ${new Date(mp.last_updated).toLocaleDateString("es-ES")}`,
              source_type: "n8n_sync",
              confidence_score: 0.7,
              captured_at: new Date().toISOString(),
            })
            .ilike("name", itemName)
            .eq("user_id", userId)
            .eq("sector", sectorConfig.sector)
            .eq("is_manual_override", false);
          updated++;
        } else {
          const { error } = await supabase.from("price_items").insert({
            user_id: userId,
            sector: sectorConfig.sector,
            name: itemName,
            description: `Precio de mercado \u00B7 ${mp.source || "n8n"} \u00B7 ${new Date(mp.last_updated).toLocaleDateString("es-ES")}`,
            category: mp.category || categories[0]?.value || "producto",
            subcategory: subcat,
            unit: mp.unit || "ud",
            unit_price: priceValue,
            source_type: "n8n_sync",
            source_url: mp.source || null,
            confidence_score: 0.7,
            captured_at: new Date().toISOString(),
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

  /* ─── Import defaults ────────────────────────────────────────────── */
  async function importDefaults() {
    if (!userId) {
      toast.error("Error: no se pudo obtener tu usuario. Recarga la página.");
      return;
    }
    const ok = await confirm({
      title: "Importar precios del sector",
      description: "¿Importar precios por defecto del sector? Se añadirán a tu banco de precios actual.",
      variant: "default",
      confirmLabel: "Importar",
    });
    if (!ok) return;

    const sectorDefaults = priceConfig.defaults.map((d) => ({
      ...d,
    }));

    if (sectorDefaults.length === 0) {
      toast.error("No hay precios por defecto configurados para tu sector");
      return;
    }

    try {
      for (const item of sectorDefaults) {
        const row: Record<string, unknown> = {
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          unit: item.unit,
          unit_price: item.price,
          description: "",
          user_id: userId,
          sector: sectorConfig.sector,
          source_type: "default",
          confidence_score: 0.3,
        };
        if ("purchase_price" in item && item.purchase_price != null) row.purchase_price = item.purchase_price;
        if ("brand" in item && item.brand) row.brand = item.brand;
        if ("format" in item && item.format) row.format = item.format;
        if ("vat_rate" in item && item.vat_rate != null) row.vat_rate = item.vat_rate;
        if ("gross_margin_pct" in item && item.gross_margin_pct != null) row.gross_margin_pct = item.gross_margin_pct;
        if ("business_subsector" in item && item.business_subsector) row.business_subsector = item.business_subsector;
        if ("family" in item && item.family) row.family = item.family;
        if ("supplier_name" in item && item.supplier_name) row.supplier_name = item.supplier_name;
        if (row.purchase_price) row.recommended_sale_price = item.price;
        await supabase.from("price_items").insert(row);
      }
      await loadItems();
      toast.success(`Precios del sector importados (${sectorDefaults.length})`);
    } catch {
      toast.error("Error al importar precios del sector");
    }
  }

  /* ─── DataTable columns (sector-aware) ───────────────────────────── */
  const columns = useMemo((): Column<PriceListItem>[] => {
    const base: Column<PriceListItem>[] = [
      {
        key: "name",
        header: "Producto",
        sortable: true,
        render: (row) => (
          <div>
            <p className="font-medium text-navy-900 dark:text-zinc-100">{row.name}</p>
            {row.description && <p className="text-xs text-navy-400 dark:text-zinc-500 mt-0.5 line-clamp-1">{row.description}</p>}
          </div>
        ),
        exportValue: (row) => row.name,
        width: "min-w-[200px]",
      },
    ];

    if (isRetail) {
      base.push(
        {
          key: "brand",
          header: "Marca",
          sortable: true,
          hidden: "hidden lg:table-cell",
          render: (row) => <span className="text-sm text-navy-700 dark:text-zinc-300">{row.brand || "\u2014"}</span>,
          exportValue: (row) => row.brand ?? "",
        },
        {
          key: "format",
          header: "Formato",
          hidden: "hidden xl:table-cell",
          render: (row) => <span className="text-xs text-navy-500 dark:text-zinc-400">{row.format || "\u2014"}</span>,
          exportValue: (row) => row.format ?? "",
        },
        {
          key: "family",
          header: "Familia",
          sortable: true,
          hidden: "hidden xl:table-cell",
          render: (row) => <span className="text-sm text-navy-600 dark:text-zinc-400">{row.family || "\u2014"}</span>,
          exportValue: (row) => row.family ?? "",
        }
      );
    }

    base.push({
      key: "category",
      header: "Categoría",
      sortable: true,
      align: "center",
      render: (row) => <Badge variant={catVariant(row.category)}>{catLabel[row.category] || row.category}</Badge>,
      exportValue: (row) => catLabel[row.category] || row.category,
    });

    base.push({
      key: "subcategory",
      header: "Subcategoría",
      sortable: true,
      hidden: "hidden md:table-cell",
      render: (row) => <span className="text-xs text-navy-500 dark:text-zinc-400">{row.subcategory || "\u2014"}</span>,
      exportValue: (row) => row.subcategory,
    });

    if (isRetail) {
      base.push({
        key: "supplier_name",
        header: "Proveedor",
        sortable: true,
        hidden: "hidden lg:table-cell",
        render: (row) => <span className="text-sm text-navy-600 dark:text-zinc-400">{row.supplier_name || "\u2014"}</span>,
        exportValue: (row) => row.supplier_name ?? "",
      });
    }

    if (isRetail) {
      base.push(
        {
          key: "purchase_price",
          header: "Coste",
          sortable: true,
          align: "right",
          render: (row) => <span className="text-sm tabular-nums text-navy-700 dark:text-zinc-300">{fmt(row.purchase_price)}</span>,
          exportValue: (row) => row.purchase_price ?? "",
          sortFn: (a, b) => (a.purchase_price ?? 0) - (b.purchase_price ?? 0),
        },
        {
          key: "recommended_sale_price",
          header: "PVP",
          sortable: true,
          align: "right",
          render: (row) => <span className="text-sm tabular-nums font-semibold text-navy-900 dark:text-zinc-100">{fmt(row.recommended_sale_price)}</span>,
          exportValue: (row) => row.recommended_sale_price ?? "",
          sortFn: (a, b) => (a.recommended_sale_price ?? 0) - (b.recommended_sale_price ?? 0),
        },
        {
          key: "gross_margin_pct",
          header: "Margen",
          sortable: true,
          align: "right",
          render: (row) => {
            const m = row.gross_margin_pct;
            const color = m == null ? "" : m >= 50 ? "text-emerald-600 dark:text-emerald-400" : m >= 25 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
            return <span className={`text-sm tabular-nums font-medium ${color}`}>{fmtPct(m)}</span>;
          },
          exportValue: (row) => row.gross_margin_pct ?? "",
          sortFn: (a, b) => (a.gross_margin_pct ?? 0) - (b.gross_margin_pct ?? 0),
        },
        {
          key: "vat_rate",
          header: "IVA",
          align: "center",
          hidden: "hidden xl:table-cell",
          render: (row) => <span className="text-xs text-navy-500 dark:text-zinc-500">{row.vat_rate != null ? row.vat_rate + "%" : "\u2014"}</span>,
          exportValue: (row) => row.vat_rate ?? "",
        }
      );
    }

    // Unit price always visible (for construction it's the main price)
    base.push({
      key: "unit_price",
      header: isRetail ? "P. Unit." : "Precio",
      sortable: true,
      align: "right",
      render: (row) => (
        <span className={`text-sm tabular-nums font-semibold ${isRetail ? "text-navy-600 dark:text-zinc-400" : "text-navy-900 dark:text-zinc-100"}`}>
          {fmt(row.unit_price)}
        </span>
      ),
      exportValue: (row) => row.unit_price,
      sortFn: (a, b) => a.unit_price - b.unit_price,
      defaultHidden: isRetail,
    });

    if (isRetail) {
      base.push({
        key: "source_type",
        header: "Fuente",
        align: "center",
        hidden: "hidden lg:table-cell",
        render: (row) => (
          <Badge variant={sourceVariant(row.source_type)}>
            {SOURCE_TYPE_LABELS[row.source_type ?? ""] || row.source_type || "Manual"}
          </Badge>
        ),
        exportValue: (row) => SOURCE_TYPE_LABELS[row.source_type ?? ""] || "Manual",
      });

      base.push({
        key: "is_active",
        header: "Estado",
        align: "center",
        hidden: "hidden xl:table-cell",
        render: (row) => (
          <Badge variant={row.is_active !== false ? "green" : "red"}>
            {row.is_active !== false ? "Activo" : "Inactivo"}
          </Badge>
        ),
        exportValue: (row) => (row.is_active !== false ? "Activo" : "Inactivo"),
      });
    }

    // Actions column
    base.push({
      key: "actions",
      header: "",
      align: "right",
      alwaysVisible: true,
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {isRetail && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleManual(row);
              }}
              title={row.source_type === "manual" ? "Desbloquear para sync" : "Marcar como manual"}
              className={`p-1.5 rounded-lg text-xs transition ${
                row.source_type === "manual"
                  ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                  : "text-navy-400 hover:bg-navy-50 dark:text-zinc-500 dark:hover:bg-zinc-800"
              }`}
            >
              {row.source_type === "manual" ? "\uD83D\uDD12" : "\uD83D\uDD13"}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              startEdit(row);
            }}
            className="p-1.5 rounded-lg text-xs text-brand-green hover:bg-brand-green/10 transition"
          >
            Editar
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row.id);
            }}
            className="p-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
          >
            Eliminar
          </button>
        </div>
      ),
    });

    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRetail, catLabel]);

  /* ─── DataTable filters (sector-aware) ───────────────────────────── */
  const filters = useMemo((): FilterDef<PriceListItem>[] => {
    const f: FilterDef<PriceListItem>[] = [];

    // Category filter (both sectors)
    f.push({
      key: "category",
      label: "Categoría",
      options: categories.map((c) => ({ label: c.label, value: c.value })),
      matches: (row, val) => row.category === val,
    });

    if (isRetail) {
      // Family filter
      const families = [...new Set(items.map((i) => i.family).filter(Boolean))] as string[];
      if (families.length > 0) {
        f.push({
          key: "family",
          label: "Familia",
          options: families.sort().map((fam) => ({ label: fam, value: fam })),
          matches: (row, val) => row.family === val,
        });
      }

      // Supplier filter
      const suppliers = [...new Set(items.map((i) => i.supplier_name).filter(Boolean))] as string[];
      if (suppliers.length > 0) {
        f.push({
          key: "supplier",
          label: "Proveedor",
          options: suppliers.sort().map((s) => ({ label: s, value: s })),
          matches: (row, val) => row.supplier_name === val,
        });
      }

      // Subsector filter
      const subsectors = [...new Set(items.map((i) => i.business_subsector).filter(Boolean))] as string[];
      if (subsectors.length > 0) {
        f.push({
          key: "subsector",
          label: "Subsector",
          options: subsectors.sort().map((s) => ({ label: s, value: s })),
          matches: (row, val) => row.business_subsector === val,
        });
      }

      // Source type filter
      f.push({
        key: "source_type",
        label: "Fuente",
        options: [
          { label: "Manual", value: "manual" },
          { label: "n8n Sync", value: "n8n_sync" },
          { label: "CSV Import", value: "import_csv" },
          { label: "Por defecto", value: "default" },
        ],
        matches: (row, val) => (row.source_type ?? "manual") === val,
      });

      // Active filter
      f.push({
        key: "is_active",
        label: "Estado",
        options: [
          { label: "Activos", value: "true" },
          { label: "Inactivos", value: "false" },
        ],
        matches: (row, val) => String(row.is_active !== false) === val,
      });
    }

    return f;
  }, [isRetail, categories, items]);

  /* ─── Loading state ──────────────────────────────────────────────── */
  if (!contextLoaded || loadingItems) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-green" />
      </div>
    );
  }

  /* ─── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={sectorConfig.priceLabel}
        description={
          isRetail
            ? "Banco de precios retail: gestiona coste, venta, márgenes y proveedores de tu negocio"
            : "Configura tus precios base para materiales, mano de obra y otros gastos"
        }
        count={kpis.total}
        countLabel="precios"
        actions={
          <>
            <button
              onClick={syncFromMarket}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              {syncing ? "Sincronizando..." : "Sync mercado"}
            </button>
            <button
              onClick={importDefaults}
              className="inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition"
            >
              Importar defecto
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-green/20 hover:bg-brand-green-dark transition"
            >
              + Nuevo precio
            </button>
          </>
        }
      />

      {/* ─── KPI cards ────────────────────────────────────────────── */}
      <div className={`grid ${isRetail ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"} gap-4 mb-6`}>
        <div className="rounded-2xl border border-navy-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-brand-green mt-1">{kpis.total}</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Manuales</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{kpis.manual}</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Sincronizados</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{kpis.synced}</p>
        </div>
        {isRetail && (
          <div className="rounded-2xl border border-navy-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Margen medio</p>
            <p className={`text-2xl font-bold mt-1 ${kpis.avgMargin >= 40 ? "text-emerald-600 dark:text-emerald-400" : kpis.avgMargin >= 20 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
              {kpis.avgMargin.toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      {/* ─── Form panel ───────────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-2xl border border-navy-100 bg-white p-6 mb-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-5">
            {editingId ? "Editar precio" : "Nuevo precio"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Row 1: Name + Unit price */}
            <div className={isRetail ? "lg:col-span-2" : "md:col-span-2"}>
              <label className={LABEL_CLS}>Nombre *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={priceConfig.placeholder} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>{isRetail ? "PVP (sin IVA) *" : "Precio unitario *"}</label>
              <input type="number" min="0" step="0.01" value={unitPrice || ""} onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)} className={INPUT_CLS} />
            </div>

            {/* Retail-only: Coste + Margen auto */}
            {isRetail && (
              <div>
                <label className={LABEL_CLS}>Precio coste</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value ? parseFloat(e.target.value) : "")}
                  placeholder="0.00"
                  className={INPUT_CLS}
                />
              </div>
            )}

            {/* Category + Subcategory + Unit */}
            <div>
              <label className={LABEL_CLS}>Categoría</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSubcategory("");
                }}
                className={INPUT_CLS}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Subcategoría</label>
              <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={INPUT_CLS}>
                <option value="">Seleccionar...</option>
                {getSubcats(category).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Unidad</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT_CLS}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {/* Retail-only: brand, format, family, supplier, VAT, subsector */}
            {isRetail && (
              <>
                <div>
                  <label className={LABEL_CLS}>Marca</label>
                  <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ej: Nike, Hacendado..." className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Formato</label>
                  <input type="text" value={format} onChange={(e) => setFormat(e.target.value)} placeholder="Ej: 500g, Talla M, Pack 6" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Familia</label>
                  <input type="text" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Ej: Camisetas, Aceites" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Proveedor</label>
                  <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Nombre proveedor" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>IVA %</label>
                  <select value={vatRate} onChange={(e) => setVatRate(parseFloat(e.target.value))} className={INPUT_CLS}>
                    <option value={21}>21% (General)</option>
                    <option value={10}>10% (Reducido)</option>
                    <option value={4}>4% (Superreducido)</option>
                    <option value={0}>0% (Exento)</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Subsector</label>
                  <input type="text" value={businessSubsector} onChange={(e) => setBusinessSubsector(e.target.value)} placeholder="Ej: moda, alimentación" className={INPUT_CLS} />
                </div>
              </>
            )}

            {/* Description - full width */}
            <div className="md:col-span-3 lg:col-span-4">
              <label className={LABEL_CLS}>Descripción (opcional)</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalles adicionales..." className={INPUT_CLS} />
            </div>

            {/* Manual override toggle (retail only) */}
            {isRetail && (
              <div className="md:col-span-3 lg:col-span-4 flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isManualOverride}
                    onChange={(e) => setIsManualOverride(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-navy-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-green" />
                </label>
                <span className="text-sm text-navy-600 dark:text-zinc-400">
                  Precio manual (no se sobrescribirá en sincronizaciones automáticas)
                </span>
              </div>
            )}
          </div>

          {/* Margin preview */}
          {isRetail && typeof purchasePrice === "number" && unitPrice > 0 && (
            <div className="mt-4 p-3 rounded-xl bg-navy-50/60 dark:bg-zinc-800/50 border border-navy-100 dark:border-zinc-700">
              <span className="text-xs text-navy-500 dark:text-zinc-400">Margen bruto calculado: </span>
              <span className="text-sm font-semibold text-navy-900 dark:text-zinc-100">
                {(((unitPrice - purchasePrice) / unitPrice) * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-navy-400 dark:text-zinc-500 ml-2">
                ({(unitPrice - purchasePrice).toFixed(2)} \u20AC/ud)
              </span>
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              onClick={handleSave}
              className="inline-flex items-center rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-green/20 hover:bg-brand-green-dark transition"
            >
              {editingId ? "Guardar cambios" : "Añadir precio"}
            </button>
            <button
              onClick={resetForm}
              className="inline-flex items-center rounded-xl border border-navy-200 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ─── DataTable ────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        searchable
        searchPlaceholder={isRetail ? "Buscar producto, marca, proveedor..." : "Buscar por nombre..."}
        searchFields={(row) => [
          row.name,
          row.brand,
          row.supplier_name,
          row.family,
          row.subcategory,
          row.business_subsector,
          row.description,
        ]}
        filters={filters}
        initialSort={{ key: "name", dir: "asc" }}
        pageSize={50}
        pageSizeOptions={[25, 50, 100]}
        exportable
        exportFileName={`precios-${sectorConfig.sector}`}
        toggleableColumns={isRetail}
        emptyMessage="No hay precios configurados. Usa 'Sync mercado' o 'Importar defecto' para empezar."
      />
    </div>
  );
}
