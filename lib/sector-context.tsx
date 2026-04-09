"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { createClient } from "@/lib/supabase-browser";

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

  const loadConfig = async () => {
    setLoading(true);

    // 1. Get user's selected sector from fiscal_settings
    const { data: { user } } = await supabase.auth.getUser();
    let key = "construccion";

    if (user) {
      const { data: fiscal } = await supabase
        .from("fiscal_settings")
        .select("sector_key")
        .eq("user_id", user.id)
        .single();
      if (fiscal?.sector_key) key = fiscal.sector_key;
    }

    setSectorKey(key);

    // 2. Load the sector config
    const { data } = await supabase
      .from("sector_config")
      .select("*")
      .eq("sector_key", key)
      .single();

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
    return config.sidebar_modules.filter((m) => m.visible);
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
