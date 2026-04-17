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
  if (value === "comercio_local" || value === "comercio" || value === "retail") {
    return "comercio_local";
  }
  return "construccion";
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
      visibleModules: [
        "dashboard",
        "clients",
        "budgets",
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
    priceLabel: "Banco de precios",
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


