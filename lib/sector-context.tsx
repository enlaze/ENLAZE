"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { createClient } from "@/lib/supabase-browser";
import { normalizeSectorId } from "@/lib/sectors";
import { normalizeSector } from "@/lib/sector-config";

/**
 * Maps a granular subsector id (profiles.business_sector) to the coarse key
 * used by the `sector_config` table (construccion / servicios / comercio / instalaciones).
 * profiles.business_sector is the source of truth; this is only for terminology/UI lookup.
 */
function granularToCoarseConfigKey(granular: string): string {
  switch (granular) {
    case "construccion":
      return "construccion";
    case "comercio":
      return "comercio";
    default:
      return "servicios";
  }
}

/* ── Types ────────────────────────────────────────────────────────── */

export interface SidebarModule {
  key: string;
  label: string;
  icon: string;
  visible: boolean;
  href: string;
}

export interface ServiceType {
  value: string;
  label: string;
}

export interface BudgetCategory {
  value: string;
  label: string;
}

export interface DefaultPrice {
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  price: number;
}

export interface SectorConfig {
  id: string;
  sector_key: string;
  sector_label: string;
  description: string;
  sidebar_modules: SidebarModule[];
  labels: Record<string, string>;
  form_fields: Record<string, Record<string, boolean>>;
  dropdown_options: Record<string, string[]>;
  default_iva_percent: number;
  default_irpf_percent: number;
  is_active: boolean;
  service_types: ServiceType[];
  budget_categories: BudgetCategory[];
  subcategories: Record<string, string[]>;
  agent_prompt: string;
  default_prices: DefaultPrice[];
}

interface SectorContextValue {
  config: SectorConfig | null;
  sectorKey: string;
  loading: boolean;
  /** Get a label by key with fallback */
  label: (key: string) => string;
  /** Get dropdown options by key */
  options: (key: string) => string[];
  /** Check if a form field is visible */
  fieldVisible: (entity: string, field: string) => boolean;
  /** Get visible sidebar modules */
  visibleModules: () => SidebarModule[];
  /**
   * Hrefs que el usuario ha ocultado a mano en Ajustes → Personalización.
   * Se aplica ENCIMA del filtrado por sector y solo afecta al menú lateral:
   * las rutas siguen accesibles por URL directa.
   */
  hiddenModules: string[];
  /** Persiste la lista de hrefs ocultos en profiles.hidden_modules. Lanza si falla. */
  setHiddenModules: (hrefs: string[]) => Promise<void>;
  /** Get service types for budgets */
  serviceTypes: () => ServiceType[];
  /** Get budget categories */
  budgetCategories: () => BudgetCategory[];
  /** Get subcategories for a given category */
  subcategories: (category: string) => string[];
  /** Get the agent prompt for AI generation */
  agentPrompt: () => string;
  /** Get default prices for the sector */
  defaultPrices: () => DefaultPrice[];
  /** Reload config (e.g. after sector change) */
  reload: () => Promise<void>;
}

/* ── Fallback labels (construcción defaults) ───────────────────── */

const fallbackLabels: Record<string, string> = {
  project: "Obra",
  projects: "Obras",
  supplier: "Proveedor",
  suppliers: "Proveedores",
  order: "Pedido",
  orders: "Pedidos",
  delivery_note: "Albarán",
  delivery_notes: "Albaranes",
  budget: "Presupuesto",
  budgets: "Presupuestos",
  client: "Cliente",
  clients: "Clientes",
  margin: "Margen",
  margins: "Márgenes",
};

/* ── Context ──────────────────────────────────────────────────────── */

const SectorContext = createContext<SectorContextValue>({
  config: null,
  sectorKey: "construccion",
  loading: true,
  label: (k) => fallbackLabels[k] || k,
  options: () => [],
  fieldVisible: () => true,
  visibleModules: () => [],
  hiddenModules: [],
  setHiddenModules: async () => {},
  serviceTypes: () => [],
  budgetCategories: () => [],
  subcategories: () => [],
  agentPrompt: () => "",
  defaultPrices: () => [],
  reload: async () => {},
});

export function useSector() {
  return useContext(SectorContext);
}

/* ── Provider ─────────────────────────────────────────────────────── */

export function SectorProvider({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const [config, setConfig] = useState<SectorConfig | null>(null);
  const [sectorKey, setSectorKey] = useState("construccion");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [hiddenModules, setHiddenModulesState] = useState<string[]>([]);

  const loadConfig = async () => {
    setLoading(true);

    // 1. Única fuente de verdad: profiles.business_sector (granular).
    //    Fallback a fiscal_settings.sector_key sólo si el granular está vacío.
    const { data: { user } } = await supabase.auth.getUser();
    let granular = "construccion";

    setUserId(user?.id ?? null);

    if (user) {
      // `hidden_modules` es la preferencia personal de menú (Ajustes →
      // Personalización). Si la columna aún no existe en el proyecto (migración
      // 20260818 sin aplicar) la query falla entera, así que reintentamos sin
      // ella: la detección de sector nunca debe depender de esa preferencia.
      let profile: { business_sector?: string | null; hidden_modules?: string[] | null } | null = null;
      const full = await supabase
        .from("profiles")
        .select("business_sector, hidden_modules")
        .eq("id", user.id)
        .maybeSingle();

      if (full.error) {
        const { data } = await supabase
          .from("profiles")
          .select("business_sector")
          .eq("id", user.id)
          .maybeSingle();
        profile = data;
      } else {
        profile = full.data;
      }

      setHiddenModulesState(Array.isArray(profile?.hidden_modules) ? profile.hidden_modules : []);

      if (profile?.business_sector) {
        granular = normalizeSectorId(profile.business_sector);
      } else {
        const { data: fiscal } = await supabase
          .from("fiscal_settings")
          .select("sector_key")
          .eq("user_id", user.id)
          .maybeSingle();
        if (fiscal?.sector_key) granular = fiscal.sector_key;
      }
    } else {
      setHiddenModulesState([]);
    }

    setSectorKey(granular);

    // 2. sector_config sólo conoce las 4 claves coarse — mapeamos sólo para
    //    cargar terminología/módulos. El sectorKey expuesto sigue siendo el granular.
    const coarse = granularToCoarseConfigKey(granular);
    const { data } = await supabase
      .from("sector_config")
      .select("*")
      .eq("sector_key", coarse)
      .maybeSingle();

    if (data) {
      setConfig(data as SectorConfig);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = (key: string): string => {
    if (config?.labels?.[key]) return config.labels[key];
    return fallbackLabels[key] || key;
  };

  const options = (key: string): string[] => {
    return config?.dropdown_options?.[key] || [];
  };

  const fieldVisible = (entity: string, field: string): boolean => {
    if (!config?.form_fields?.[entity]) return true; // show by default
    const entityFields = config.form_fields[entity];
    if (entityFields[field] === undefined) return true; // not configured = visible
    return entityFields[field];
  };

  const visibleModules = (): SidebarModule[] => {
    if (!config?.sidebar_modules) return [];
    const modules = config.sidebar_modules.filter((m) => m.visible);
    // Budgets are construction-only for now (reversible product gate). Hide the
    // budgets entry for comercio_local even if the DB config still lists it, so
    // the runtime nav stays coherent regardless of the sector_config row.
    if (normalizeSector(sectorKey) !== "construccion") {
      return modules.filter(
        (m) => m.href !== "/dashboard/budgets" && m.key !== "budgets",
      );
    }
    return modules;
  };

  /**
   * Guarda las secciones ocultas del usuario. Actualiza el estado local antes
   * de escribir (el sidebar reacciona al instante) y revierte si Supabase falla.
   */
  const setHiddenModules = async (hrefs: string[]): Promise<void> => {
    const next = Array.from(new Set(hrefs));
    const previous = hiddenModules;
    setHiddenModulesState(next);

    if (!userId) return;

    const { error } = await supabase
      .from("profiles")
      .update({ hidden_modules: next, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      setHiddenModulesState(previous);
      throw new Error(error.message);
    }
  };

  const serviceTypes = (): ServiceType[] => {
    return config?.service_types || [];
  };

  const budgetCategories = (): BudgetCategory[] => {
    return config?.budget_categories || [];
  };

  const getSubcategories = (category: string): string[] => {
    return config?.subcategories?.[category] || [];
  };

  const agentPrompt = (): string => {
    return config?.agent_prompt || "";
  };

  const defaultPrices = (): DefaultPrice[] => {
    return config?.default_prices || [];
  };

  return (
    <SectorContext.Provider
      value={{
        config,
        sectorKey,
        loading,
        label,
        options,
        fieldVisible,
        visibleModules,
        hiddenModules,
        setHiddenModules,
        serviceTypes,
        budgetCategories,
        subcategories: getSubcategories,
        agentPrompt,
        defaultPrices,
        reload: loadConfig,
      }}
    >
      {children}
    </SectorContext.Provider>
  );
}
