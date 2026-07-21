export type BusinessSector = "construccion" | "comercio_local";

export type SectorConfig = {
  sector: BusinessSector;
  displayName: string;
  aiPreset: "construction" | "retail";
  priceLabel: string;
  budgetLabel: string;
  visibleModules: string[];
};

export function normalizeSector(value?: string | null): BusinessSector {
  const v = (value || "").toLowerCase().trim();
  // Construction sector is the only one with the construccion price bank
  if (v === "construccion") return "construccion";
  // Anything else falls under comercio_local for price-bank / module-layout purposes.
  // The granular subsector (hosteleria, estetica, salud, etc.) still drives the
  // agent persona via lib/agent-prompts.ts; this only governs the budget engine.
  return "comercio_local";
}

export function getSectorConfig(value?: string | null): SectorConfig {
  const sector = normalizeSector(value);

  if (sector === "comercio_local") {
    return {
      sector,
      displayName: "Comercio local",
      aiPreset: "retail",
      priceLabel: "Catálogo / Tarifas",
      budgetLabel: "Propuestas",
      // NOTE: "budgets" is intentionally omitted here. Budgets are a
      // construction-native concept; for comercio_local the module is gated off
      // (reversible product decision — may be re-added during validation).
      visibleModules: [
        "dashboard",
        "clients",
        "prices",
        "suppliers",
        "emails",
        "messages",
        "calendar",
        "facturas",
        "issued-invoices",
        "payments",
        "agent",
        "settings",
      ],
    };
  }

  return {
    sector,
    displayName: "Construcción",
    aiPreset: "construction",
    priceLabel: "Rastreador de precios",
    budgetLabel: "Presupuestos",
    visibleModules: [
      "dashboard",
      "clients",
      "budgets",
      "prices",
      "projects",
      "suppliers",
      "orders",
      "delivery-notes",
      "facturas",
      "issued-invoices",
      "payments",
      "margins",
      "calendar",
      "compliance",
      "audit-log",
      "agent",
      "settings",
    ],
  };
}


