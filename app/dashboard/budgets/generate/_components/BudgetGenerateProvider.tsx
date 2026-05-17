import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { normalizeSector } from "@/lib/sector-config";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { saveDocumentVersion, getNextVersion } from "@/lib/document-versions";
import { logActivity } from "@/lib/activity-log";

export interface Partida {
  id: string;
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  unit_price: number;
  subtotal_cost: number;
  unit_price_client: number;
  subtotal_client: number;
  status?: "incluida" | "estimada" | "opcional";
}

export interface ProviderOption {
  id: string;
  name: string;
  description: string;
  estimatedPrice: number;
  deliveryTime: string;
  stockLevel: "Alto" | "Medio" | "Bajo" | "A consultar";
  rating: number;
  isRecommended?: boolean;
  materialsCount?: number;
  isRealData?: boolean;
  sourceType?: string;
}

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  included: boolean;
  provider_id?: string;
  isRealData?: boolean;
  sourceType?: string;
}

const CONSTRUCTION_FALLBACK_PARTIDAS: Partida[] = [
  { id: "p1", concept: "Demoliciones y retirada de escombros", description: "Demolición de elementos existentes y gestión de residuos.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1500, subtotal_cost: 1500, unit_price_client: 1800, subtotal_client: 1800, status: "incluida" },
  { id: "p2", concept: "Albañilería y tabiquería", description: "Ayudas de albañilería, apertura de regatas y formación de tabiquería.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 2200, subtotal_cost: 2200, unit_price_client: 2640, subtotal_client: 2640, status: "incluida" },
  { id: "p3", concept: "Fontanería", description: "Instalación completa de fontanería y saneamiento.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1800, subtotal_cost: 1800, unit_price_client: 2160, subtotal_client: 2160, status: "incluida" },
  { id: "p4", concept: "Electricidad", description: "Instalación eléctrica completa, mecanismos y cuadro.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 2500, subtotal_cost: 2500, unit_price_client: 3000, subtotal_client: 3000, status: "incluida" },
  { id: "p5", concept: "Revestimientos y alicatados", description: "Alicatado de paramentos verticales.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1900, subtotal_cost: 1900, unit_price_client: 2280, subtotal_client: 2280, status: "incluida" },
  { id: "p6", concept: "Solados y pavimentos", description: "Suministro y colocación de pavimento.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 2100, subtotal_cost: 2100, unit_price_client: 2520, subtotal_client: 2520, status: "incluida" },
  { id: "p7", concept: "Pintura", description: "Preparación de paredes y pintura plástica.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1600, subtotal_cost: 1600, unit_price_client: 1920, subtotal_client: 1920, status: "incluida" },
  { id: "p8", concept: "Carpintería interior", description: "Suministro y colocación de puertas.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1800, subtotal_cost: 1800, unit_price_client: 2160, subtotal_client: 2160, status: "incluida" },
  { id: "p9", concept: "Carpintería exterior", description: "Suministro y colocación de ventanas.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 3200, subtotal_cost: 3200, unit_price_client: 3840, subtotal_client: 3840, status: "incluida" },
  { id: "p10", concept: "Sanitarios y grifería", description: "Suministro y colocación de sanitarios.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 1200, subtotal_cost: 1200, unit_price_client: 1440, subtotal_client: 1440, status: "incluida" },
  { id: "p11", concept: "Cocina y equipamiento", description: "Montaje de muebles de cocina y electrodomésticos.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 2800, subtotal_cost: 2800, unit_price_client: 3360, subtotal_client: 3360, status: "incluida" },
  { id: "p12", concept: "Iluminación", description: "Suministro e instalación de luminarias.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 800, subtotal_cost: 800, unit_price_client: 960, subtotal_client: 960, status: "incluida" },
  { id: "p13", concept: "Limpieza final", description: "Limpieza fin de obra.", quantity: 1, unit: "PA", category: "mano_obra", unit_price: 350, subtotal_cost: 350, unit_price_client: 420, subtotal_client: 420, status: "incluida" },
  { id: "p14", concept: "Gestión de residuos", description: "Tasas y gestión de residuos en vertedero.", quantity: 1, unit: "PA", category: "otros", unit_price: 250, subtotal_cost: 250, unit_price_client: 300, subtotal_client: 300, status: "incluida" },
  { id: "p15", concept: "Seguridad y medios auxiliares", description: "Andamios, EPIs y medidas de seguridad.", quantity: 1, unit: "PA", category: "otros", unit_price: 400, subtotal_cost: 400, unit_price_client: 480, subtotal_client: 480, status: "incluida" }
];

const CONSTRUCTION_FALLBACK_MATERIALS: Material[] = [
  { id: "fm1", name: "Mortero de cemento M-7.5 (saco 25kg)", quantity: 20, unit: "sacos", unit_price: 3.50, subtotal: 70, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm2", name: "Ladrillo hueco doble 24x11.5x7cm", quantity: 200, unit: "ud", unit_price: 0.35, subtotal: 70, included: true, provider_id: "obramat", isRealData: false },
  { id: "fm3", name: "Placa de yeso laminado 13mm (Pladur N)", quantity: 30, unit: "ud", unit_price: 5.80, subtotal: 174, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm4", name: "Tuberia multicapa 16mm (rollo 100m)", quantity: 2, unit: "rollos", unit_price: 65.0, subtotal: 130, included: true, provider_id: "saltoki", isRealData: false },
  { id: "fm5", name: "Tuberia PVC evacuacion 110mm (3m)", quantity: 6, unit: "ud", unit_price: 8.50, subtotal: 51, included: true, provider_id: "saltoki", isRealData: false },
  { id: "fm6", name: "Cable H07V-K 2.5mm2 (rollo 100m)", quantity: 3, unit: "rollos", unit_price: 32.0, subtotal: 96, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm7", name: "Mecanismos electricos (kit basico: enchufes+interruptores)", quantity: 1, unit: "kit", unit_price: 180.0, subtotal: 180, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm8", name: "Cuadro electrico + protecciones (magnetotermicos+diferencial)", quantity: 1, unit: "ud", unit_price: 220.0, subtotal: 220, included: true, provider_id: "saltoki", isRealData: false },
  { id: "fm9", name: "Azulejo porcelanico 60x60cm (blanco mate)", quantity: 30, unit: "m2", unit_price: 18.50, subtotal: 555, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm10", name: "Cemento cola porcelanico flexible (saco 25kg)", quantity: 8, unit: "sacos", unit_price: 12.0, subtotal: 96, included: true, provider_id: "obramat", isRealData: false },
  { id: "fm11", name: "Pintura plastica blanca mate (cubo 15L)", quantity: 4, unit: "cubos", unit_price: 35.0, subtotal: 140, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm12", name: "Imprimacion fijadora (cubo 15L)", quantity: 2, unit: "cubos", unit_price: 28.0, subtotal: 56, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm13", name: "Inodoro compacto salida dual", quantity: 1, unit: "ud", unit_price: 145.0, subtotal: 145, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm14", name: "Lavabo sobre encimera + monomando", quantity: 1, unit: "ud", unit_price: 120.0, subtotal: 120, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm15", name: "Plato de ducha resina antideslizante 120x70cm", quantity: 1, unit: "ud", unit_price: 185.0, subtotal: 185, included: true, provider_id: "obramat", isRealData: false },
  { id: "fm16", name: "Mampara de ducha frontal 120cm", quantity: 1, unit: "ud", unit_price: 210.0, subtotal: 210, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm17", name: "Puerta interior ciega lacada blanca", quantity: 5, unit: "ud", unit_price: 145.0, subtotal: 725, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm18", name: "Lamina impermeabilizante para zonas humedas (rollo 20m2)", quantity: 2, unit: "rollos", unit_price: 42.0, subtotal: 84, included: true, provider_id: "obramat", isRealData: false },
  { id: "fm19", name: "Silicona neutra sanitaria (cartucho 300ml)", quantity: 6, unit: "ud", unit_price: 5.50, subtotal: 33, included: true, provider_id: "leroy-merlin", isRealData: false },
  { id: "fm20", name: "Contenedor de escombros 6m3 (alquiler+transporte+vertedero)", quantity: 2, unit: "ud", unit_price: 280.0, subtotal: 560, included: true, provider_id: "referencia-mercado", isRealData: false },
];

const FALLBACK_PROVIDERS: ProviderOption[] = [
  { id: "leroy-merlin", name: "Leroy Merlin", description: "Gran superficie de bricolaje y construccion", estimatedPrice: 0, deliveryTime: "24-48h", stockLevel: "Alto", rating: 4.8, isRecommended: true, materialsCount: 0, isRealData: false },
  { id: "obramat", name: "Obramat", description: "Almacen profesional de materiales", estimatedPrice: 0, deliveryTime: "48-72h", stockLevel: "Medio", rating: 4.5, isRecommended: false, materialsCount: 0, isRealData: false },
  { id: "saltoki", name: "Saltoki", description: "Distribuidor profesional de fontaneria y electricidad", estimatedPrice: 0, deliveryTime: "24-72h", stockLevel: "Alto", rating: 4.6, isRecommended: false, materialsCount: 0, isRealData: false },
  { id: "referencia-mercado", name: "Referencia mercado", description: "Precios de referencia del mercado espanol", estimatedPrice: 0, deliveryTime: "Variable", stockLevel: "A consultar", rating: 4.0, isRecommended: false, materialsCount: 0, isRealData: false },
];

export interface BudgetState {
  draftId: string | null;
  lastSavedAt: string | null;
  currentStep: number;
  sector: string;
  // Common Data
  title: string;
  clientId: string;
  projectId: string;
  serviceType: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
  ivaPercent: number;
  marginPercent: number;

  validationError: string | null;

  // Dynamic Sector Data
  sectorData: Record<string, any>;
  // Partidas
  partidas: Partida[];
  // Provider Data
  selectedProviderId: string | null;
  providerOptions: ProviderOption[];
  materials: Material[]; // Active visible materials
  allFetchedMaterials: Material[]; // Internal cache for real data
  useSuggestedMaterials: boolean;
  isRealDataMode: boolean;
  // Totals
  totals: {
    directCost: number;
    materialsCost: number;
    clientPrice: number;
    profit: number;
  };
  // AI Analysis
  isAnalyzing: boolean;
  analysisError: string | null;
  lastAnalysisHash: string | null;
  aiInsights: {
    summary?: string;
    confidence_score?: number;
    regulatory_notes?: any[];
    calendar_phases?: any[];
    missing_questions?: string[];
    estimated_timeline?: {
      total_duration_days?: number;
      total_duration_weeks?: number;
      confidence?: number;
      notes?: string;
    };
    price_warnings?: string[];
    pricing_confidence?: number;
    estimated_price_range?: { min: number; max: number };
    detected_area_m2?: number | null;
    data_sources?: {
      price_items_count: number;
      n8n_items_count: number;
      default_items_count: number;
      sector_price_count: number;
      sector_regulation_count: number;
      real_suppliers: string[];
      using_fallback: boolean;
      fallback_reason: string;
    };
  } | null;
  /** When true, materials came from AI and should NOT be overwritten by the provider useEffect */
  materialsFromAI: boolean;
}

interface BudgetContextProps {
  state: BudgetState;
  updateState: (updates: Partial<BudgetState>) => void;
  updateSectorData: (key: string, value: any) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  addPartida: (partida: Partial<Partida>) => void;
  updatePartida: (id: string, updates: Partial<Partida>) => void;
  removePartida: (id: string) => void;
  setSelectedProvider: (id: string) => void;
  updateMaterial: (id: string, updates: Partial<Material>) => void;
  setUseSuggestedMaterials: (val: boolean) => void;
  saveDraft: (manual?: boolean) => Promise<void>;
  loadDraft: (statePayload: BudgetState) => void;
  finalizeBudget: () => Promise<string | null>;
  analyzeWithAI: (force?: boolean) => Promise<boolean>;
}

const BudgetContext = createContext<BudgetContextProps | undefined>(undefined);

export function BudgetGenerateProvider({
  children,
  initialSector = "construccion"
}: {
  children: ReactNode;
  initialSector?: string;
}) {
  const toast = useToast();
  const [state, setState] = useState<BudgetState>({
    draftId: null,
    lastSavedAt: null,
    currentStep: 0,
    sector: normalizeSector(initialSector),
    title: "",
    clientId: "",
    projectId: "",
    serviceType: "",
    startDate: null,
    endDate: null,
    description: "",
    ivaPercent: 21,
    marginPercent: 20,
    validationError: null,

    sectorData: {},
    partidas: [
      {
        id: "example-1",
        concept: "Demolición y desescombro",
        description: "Demolición de tabiquería interior, levantado de suelos y retirada a vertedero autorizado.",
        quantity: 1,
        unit: "global",
        category: "mano_obra",
        unit_price: 1200,
        subtotal_cost: 1200,
        unit_price_client: 1440,
        subtotal_client: 1440,
        status: "incluida"
      },
      {
        id: "example-2",
        concept: "Alicatado de baño principal",
        description: "Suministro y colocación de azulejo porcelánico 60x60cm, material de agarre y lechada.",
        quantity: 24,
        unit: "m2",
        category: "material",
        unit_price: 35,
        subtotal_cost: 840,
        unit_price_client: 42,
        subtotal_client: 1008,
        status: "incluida"
      }
    ],
    selectedProviderId: null,
    providerOptions: [],
    materials: [],
    allFetchedMaterials: [],
    useSuggestedMaterials: true,
    isRealDataMode: false,
    totals: {
      directCost: 0,
      materialsCost: 0,
      clientPrice: 0,
      profit: 0,
    },
    isAnalyzing: false,
    analysisError: null,
    lastAnalysisHash: null,
    aiInsights: null,
    materialsFromAI: false,
  });

  // HYDRATE WITH REAL DATA (Fase 4.1)
  useEffect(() => {
    let mounted = true;
    const fetchRealData = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const activeSector = state.sector || "construccion";

        const { data, error } = await supabase
          .from("price_items")
          .select("*")
          .eq("user_id", user.id)
          .eq("sector", activeSector)
          .eq("category", "material")
          .eq("is_active", true)
          .limit(100);

        if (error || !data || data.length === 0) return; // Fallback to mock

        if (!mounted) return;

        // Normalization logic for providers
        function normalizeSupplierName(item: any): string {
          const rawSource = [item.supplier_name, item.source_url, item.description, item.name, item.category, item.source, item.provider, item.metadata?.source].join(" ").toLowerCase();

          if (activeSector === "construccion") {
            if (rawSource.includes("leroy")) return "Leroy Merlin";
            if (rawSource.includes("obramat") || rawSource.includes("bricomart")) return "OBRAMAT";
            if (rawSource.includes("saltoki")) return "Saltoki";
            if (rawSource.includes("cype")) return "CYPE / Banco de precios";
            if (rawSource.includes("referencia-mercado") || rawSource.includes("referencia")) return "Referencia mercado";
            if (item.source_type === "default") return "Banco ENLAZE base";
          }

          const rawName = item.supplier_name || item.source || item.provider || item.provider_name || item.supplier || (item.metadata?.source);
          if (!rawName || typeof rawName !== 'string' || rawName.trim() === "") return "Proveedor Genérico";
          return rawName.trim();
        }

        // Initialize providers map from real data only
        const providersMap = new Map<string, ProviderOption>();

        const realMaterials: Material[] = [];

        data.forEach(item => {
          const normName = normalizeSupplierName(item);
          const provId = normName === "Proveedor Genérico" ? "generic" : normName === "Referencia mercado" ? "market" : normName.toLowerCase().replace(/[^a-z0-9]/g, '-');

          let itemSourceType = item.source_type;
          if (!itemSourceType) {
            if (normName === "Banco ENLAZE base") itemSourceType = "default";
            else if (normName === "Referencia mercado") itemSourceType = "market_reference";
            else if (normName === "Leroy Merlin" || normName === "OBRAMAT") itemSourceType = "n8n_sync";
            else itemSourceType = "unknown";
          }

          if (!providersMap.has(provId)) {
            providersMap.set(provId, {
              id: provId,
              name: normName,
              description: normName === "Proveedor Genérico" ? "Materiales sin asignar" : "Catálogo propio / Importado",
              estimatedPrice: 0,
              deliveryTime: "Consultar",
              stockLevel: "A consultar",
              rating: 4.5,
              isRecommended: false,
              materialsCount: 0,
              isRealData: true,
              sourceType: itemSourceType
            });
          }

          realMaterials.push({
            id: item.id,
            name: item.name,
            quantity: 1, // Default quantity for suggested basket
            unit: item.unit || "ud",
            unit_price: item.unit_price || 0,
            subtotal: item.unit_price || 0,
            included: true,
            provider_id: provId,
            isRealData: true,
            sourceType: itemSourceType
          });

          // Update counts and estimated basket price for this provider
          const p = providersMap.get(provId)!;
          p.materialsCount! += 1;
          p.estimatedPrice += (item.unit_price || 0); // initial 1 ud estimation
        });

        const newProviderOptions = Array.from(providersMap.values());
        if (newProviderOptions.length === 0) return;

        // Recommender logic: if there is a n8n provider, recommend it. Else fallback to base if there are no n8n.
        const n8nProv = newProviderOptions.find(p => p.sourceType === "n8n_sync");
        if (n8nProv) n8nProv.isRecommended = true;
        else if (newProviderOptions.length > 0) newProviderOptions[0].isRecommended = true;

        // Sort: Recommended first, then by materials count
        newProviderOptions.sort((a, b) => {
          if (a.isRecommended && !b.isRecommended) return -1;
          if (!a.isRecommended && b.isRecommended) return 1;
          return (b.materialsCount || 0) - (a.materialsCount || 0);
        });

        const activeId = newProviderOptions[0].id;
        const visibleMaterials = realMaterials.filter(m => m.provider_id === activeId);

        setState(prev => ({
          ...prev,
          providerOptions: newProviderOptions,
          selectedProviderId: activeId,
          allFetchedMaterials: realMaterials,
          materials: visibleMaterials,
          isRealDataMode: true
        }));

      } catch (err) {
        console.error("[BudgetGenerateProvider] Error fetching real prices:", err);
      }
    };

    fetchRealData();
    return () => { mounted = false; };
  }, [state.sector]);

  // Update visible materials when provider changes
  useEffect(() => {
    if (!state.selectedProviderId) return;
    // NEVER overwrite AI-generated materials with provider filtering
    if (state.materialsFromAI) return;

    if (state.isRealDataMode && state.allFetchedMaterials.length > 0) {
      const newVisible = state.allFetchedMaterials.filter(m => m.provider_id === state.selectedProviderId);
      // Only update if provider actually changed
      if (state.materials.length === 0 || state.materials[0]?.provider_id !== state.selectedProviderId) {
        setState(prev => ({ ...prev, materials: newVisible }));
      }
    }
    // No more mock logic — materials come from AI or fallback
  }, [state.selectedProviderId, state.isRealDataMode, state.allFetchedMaterials]);

  // Calculate totals whenever partidas, materials or margin change
  useEffect(() => {
    let directCost = 0;
    let clientPrice = 0;
    let materialsCost = 0;

    state.partidas.forEach(p => {
      if (p.status !== "opcional") {
        directCost += p.subtotal_cost;
        clientPrice += p.subtotal_client;
      }
    });

    state.materials.forEach(m => {
      if (m.included) {
        materialsCost += m.subtotal;
      }
    });

    // In a real scenario, materials cost might be already included in directCost,
    // but for this wizard demo, we will add them up to show the impact.
    directCost += materialsCost;
    const marginMultiplier = 1 + (state.marginPercent / 100);
    // Add margin over materials too
    clientPrice += (materialsCost * marginMultiplier);

    const profit = clientPrice - directCost;

    setState(prev => ({
      ...prev,
      totals: { directCost, materialsCost, clientPrice, profit }
    }));
  }, [state.partidas, state.materials, state.marginPercent]);

  const updateState = (updates: Partial<BudgetState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  const updateSectorData = (key: string, value: any) => {
    setState(prev => ({
      ...prev,
      sectorData: { ...prev.sectorData, [key]: value }
    }));
  };

  const addPartida = (partida: Partial<Partida>) => {
    const newPartida: Partida = {
      id: Math.random().toString(36).substr(2, 9),
      concept: partida.concept || "Nueva partida",
      description: partida.description || "",
      quantity: partida.quantity || 1,
      unit: partida.unit || "ud",
      category: partida.category || "otros",
      unit_price: partida.unit_price || 0,
      subtotal_cost: 0,
      unit_price_client: 0,
      subtotal_client: 0,
      status: partida.status || "incluida",
      ...partida
    };

    // Calculate subtotals based on margin
    const marginMultiplier = 1 + (state.marginPercent / 100);
    newPartida.subtotal_cost = newPartida.quantity * newPartida.unit_price;
    newPartida.unit_price_client = newPartida.unit_price * marginMultiplier;
    newPartida.subtotal_client = newPartida.quantity * newPartida.unit_price_client;

    setState(prev => ({ ...prev, partidas: [...prev.partidas, newPartida] }));
  };

  const updatePartida = (id: string, updates: Partial<Partida>) => {
    setState(prev => {
      const marginMultiplier = 1 + (prev.marginPercent / 100);
      const newPartidas = prev.partidas.map(p => {
        if (p.id !== id) return p;
        const updated = { ...p, ...updates };
        // Recalculate
        updated.subtotal_cost = updated.quantity * updated.unit_price;
        updated.unit_price_client = updated.unit_price * marginMultiplier;
        updated.subtotal_client = updated.quantity * updated.unit_price_client;
        return updated;
      });
      return { ...prev, partidas: newPartidas };
    });
  };

  const removePartida = (id: string) => {
    setState(prev => ({ ...prev, partidas: prev.partidas.filter(p => p.id !== id) }));
  };

  const setSelectedProvider = (id: string) => {
    setState(prev => ({ ...prev, selectedProviderId: id }));
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    setState(prev => ({
      ...prev,
      materials: prev.materials.map(m => {
        if (m.id !== id) return m;
        const updated = { ...m, ...updates };
        updated.subtotal = updated.quantity * updated.unit_price;
        return updated;
      })
    }));
  };

  const setUseSuggestedMaterials = (val: boolean) => {
    setState(prev => ({ ...prev, useSuggestedMaterials: val }));
  };

  /* ─── Persistencia y Borradores ─── */
  const saveDraft = async (manual = false) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const snapshot = { ...state };
      let draftId = state.draftId;

      if (!draftId) {
        // Insert new draft
        const { data, error } = await supabase.from("budgets").insert({
          user_id: user.id,
          status: "borrador",
          title: state.title || "Borrador de Presupuesto (Wizard)",
          client_id: state.clientId || null,
          project_id: state.projectId || null,
          service_type: state.serviceType || state.sector || "general",
          subtotal: state.totals.directCost,
          iva_percent: state.ivaPercent,
          iva_amount: state.totals.directCost * (state.ivaPercent / 100),
          total: state.totals.directCost * (1 + state.ivaPercent / 100),
          wizard_state: snapshot
        }).select("id").single();

        if (error) throw error;
        draftId = data.id;
        setState(prev => ({
          ...prev,
          draftId,
          lastSavedAt: new Date().toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })
        }));
      } else {
        // Update existing draft
        const { error } = await supabase.from("budgets").update({
          title: state.title || "Borrador de Presupuesto (Wizard)",
          client_id: state.clientId || null,
          project_id: state.projectId || null,
          service_type: state.serviceType || state.sector || "general",
          subtotal: state.totals.directCost,
          iva_amount: state.totals.directCost * (state.ivaPercent / 100),
          total: state.totals.directCost * (1 + state.ivaPercent / 100),
          wizard_state: snapshot,
          updated_at: new Date().toISOString()
        }).eq("id", draftId);

        if (error) throw error;

        setState(prev => ({
          ...prev,
          lastSavedAt: new Date().toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })
        }));
      }

      if (manual) {
        toast.success("Borrador guardado correctamente");
      }
    } catch (err) {
      console.error("Error saving draft:", err);
      if (manual) toast.error("Error al guardar el borrador");
    }
  };

  const finalizeBudget = async (): Promise<string | null> => {
    try {
      await saveDraft(false); // Asegurarse de que tenemos el ID y el último estado

      const supabase = createClient();
      const budgetId = state.draftId;
      if (!budgetId) throw new Error("No hay borrador para finalizar");

      // 1. Obtener la siguiente versión (si ya existía y lo abrieron, o si es la 1)
      const nextVer = await getNextVersion(supabase, "budget", budgetId);

      // 2. Limpiar items antiguos si hubiera (por si era un presupuesto que se volvió a abrir)
      await supabase.from("budget_items").delete().eq("budget_id", budgetId);

      // 3. Insertar las partidas reales + materiales
      const marginMultiplier = 1 + (state.marginPercent / 100);

      const partidasToInsert = state.partidas.filter(p => p.status !== "opcional").map(p => ({
        budget_id: budgetId,
        concept: p.concept,
        description: p.description,
        quantity: p.quantity,
        unit: p.unit,
        category: p.category,
        unit_price: p.unit_price_client,
        subtotal: p.subtotal_client
      }));

      const materialsToInsert = state.materials.filter(m => m.included).map(m => ({
        budget_id: budgetId,
        concept: m.name,
        description: "Material sugerido",
        quantity: m.quantity,
        unit: m.unit,
        category: "material",
        unit_price: m.unit_price * marginMultiplier,
        subtotal: m.subtotal * marginMultiplier
      }));

      const itemsToInsert = [...partidasToInsert, ...materialsToInsert];

      if (itemsToInsert.length > 0) {
        const { error: itemsErr } = await supabase.from("budget_items").insert(itemsToInsert);
        if (itemsErr) throw itemsErr;
      }

      // 4. Actualizar el estado a pendiente y la versión
      const { error: upErr } = await supabase.from("budgets").update({
        status: "pendiente",
        version: nextVer,
        title: state.title || "Borrador de Presupuesto (Wizard)",
        client_id: state.clientId || null,
        project_id: state.projectId || null,
        service_type: state.serviceType || state.sector || "general",
        updated_at: new Date().toISOString()
      }).eq("id", budgetId);
      if (upErr) throw upErr;

      // 5. Guardar Snapshot de Version y Activity Log
      const { data: finalBudget } = await supabase.from("budgets").select("*").eq("id", budgetId).single();

      saveDocumentVersion(supabase, {
        entity_type: "budget",
        entity_id: budgetId,
        version: nextVer,
        snapshot: finalBudget as unknown as Record<string, unknown>,
        change_summary: `Versión ${nextVer} generada desde el Asistente.`
      });

      logActivity(supabase, {
        action: `budget.status_changed`,
        entity_type: "budget",
        entity_id: budgetId,
        metadata: { from: "borrador", to: "pendiente" },
      });

      toast.success("Presupuesto finalizado correctamente");
      return budgetId;

    } catch (err) {
      console.error("Error finalizing budget:", err);
      toast.error("Error al finalizar el presupuesto");
      return null;
    }
  };

  const loadDraft = (savedState: BudgetState) => {
    setState(savedState);
  };

  // Debounced Autosave (1.5s)
  const isFirstRender = useRef(true);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (saveTimeout.current) clearTimeout(saveTimeout.current);

    saveTimeout.current = setTimeout(() => {
      // Solo hacer autosave silencioso si ya hay un draftId (fue creado manualmente antes o en un paso previo)
      // Opcional: Descomentar para forzar creación en la primera pulsación.
      // if (state.draftId) {
      saveDraft(false);
      // }
    }, 1500);

    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [state]);

  const validateStep = (stepIndex: number): boolean => {
    if (stepIndex === 0) {
      if (!state.title) {
        setState(prev => ({ ...prev, validationError: "Falta el título del presupuesto." }));
        return false;
      }
      if (!state.clientId) {
        setState(prev => ({ ...prev, validationError: "Debes seleccionar un cliente." }));
        return false;
      }
      if (!state.projectId) {
        setState(prev => ({ ...prev, validationError: "Selecciona una obra/proyecto o crea una nueva para continuar." }));
        return false;
      }
    }
    setState(prev => ({ ...prev, validationError: null }));
    return true;
  };

  const analyzeWithAI = async (forceRegenerate = false): Promise<boolean> => {
    if (!state.description || state.description.trim().length < 5) return true;

    const currentHash = `${state.sector}-${state.serviceType}-${state.description}`.trim();
    if (!forceRegenerate && state.lastAnalysisHash === currentHash && !state.analysisError) {
      return true;
    }

    // When forcing regeneration, clear the materialsFromAI guard so the new results apply
    setState(prev => ({
      ...prev,
      isAnalyzing: true,
      analysisError: null,
      ...(forceRegenerate ? { materialsFromAI: false } : {}),
    }));

    try {
      const res = await fetch("/api/agent/budget-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: state.sector,
          description: state.description,
          service_type: state.serviceType,
          current_partidas: state.partidas.map(p => ({ concept: p.concept, subtotal: p.subtotal_cost })),
          current_materials: state.materials.map(m => ({ name: m.name, subtotal: m.subtotal }))
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al analizar la petición");
      }

      const data = await res.json();
      const marginMultiplier = 1 + (state.marginPercent / 100);

      // Map suggested_items to Partidas
      const newPartidas: Partida[] = (data.suggested_items || []).map((item: any, idx: number) => {
        const cost = item.unit_cost || item.unit_price || 0;
        const qty = item.quantity || 1;
        return {
          id: `ai-p-${idx}`,
          concept: item.concept || item.title || "Partida",
          description: item.description || "",
          quantity: qty,
          unit: item.unit || "ud",
          category: item.category || "mano_obra",
          unit_price: cost,
          subtotal_cost: qty * cost,
          unit_price_client: cost * marginMultiplier,
          subtotal_client: qty * cost * marginMultiplier,
          status: "incluida" as const,
        };
      });

      // Map materials AND build provider options from them
      const provMap = new Map<string, { name: string; count: number; total: number; isReal: boolean; sourceType: string }>();
      const newMaterials: Material[] = (data.suggested_materials || []).map((item: any, idx: number) => {
        const rawSupplier = item.supplier_name || "Referencia mercado";
        const provId = rawSupplier.toLowerCase().replace(/[^a-z0-9]/g, '-') || "generic";
        const cost = item.unit_cost || item.unit_price || 0;
        const qty = item.quantity || 1;
        const isReal = item.source !== "fallback";

        let sourceType = item.source_type;
        if (!sourceType) {
          if (rawSupplier === "Banco ENLAZE base") sourceType = "default";
          else if (rawSupplier === "Referencia mercado") sourceType = "market_reference";
          else if (rawSupplier === "Leroy Merlin" || rawSupplier === "OBRAMAT") sourceType = "n8n_sync";
          else sourceType = "unknown";
        }

        // Aggregate provider stats
        const existing = provMap.get(provId) || { name: rawSupplier, count: 0, total: 0, isReal, sourceType };
        existing.count += 1;
        existing.total += qty * cost;
        provMap.set(provId, existing);

        return {
          id: `ai-m-${idx}`,
          name: item.concept || item.title || "Material",
          quantity: qty,
          unit: item.unit || "ud",
          unit_price: cost,
          subtotal: qty * cost,
          included: true,
          provider_id: provId,
          isRealData: isReal,
          sourceType,
        };
      });

      // Build provider options from AI materials
      let newProviders: ProviderOption[] = [];
      if (provMap.size > 0) {
        newProviders = Array.from(provMap.entries()).map(([id, info], idx) => ({
          id,
          name: info.name,
          description: info.isReal ? "Proveedor sugerido por IA" : "Referencia de mercado / estimado",
          estimatedPrice: info.total,
          deliveryTime: "Consultar",
          stockLevel: "A consultar" as const,
          rating: 4.5,
          isRecommended: false,
          materialsCount: info.count,
          isRealData: info.isReal,
          sourceType: info.sourceType,
        }));

        // Recommender logic: if there is a n8n provider, recommend it. Else fallback to base if there are no n8n.
        const n8nProv = newProviders.find(p => p.sourceType === "n8n_sync");
        if (n8nProv) n8nProv.isRecommended = true;
        else if (newProviders.length > 0) newProviders[0].isRecommended = true;
      }

      // --- Pricing sanity check for construction ---
      const detectedArea = data.detected_scope?.area_m2 || null;
      const totalPartidasCost = newPartidas.reduce((s, p) => s + p.subtotal_cost, 0);
      const totalMaterialsCost = newMaterials.reduce((s, m) => s + m.subtotal, 0);
      const totalCostNoIva = (totalPartidasCost + totalMaterialsCost) * marginMultiplier;

      let priceWarnings: string[] = data.price_warnings || [];
      let pricingConfidence = data.pricing_confidence || data.confidence_score || 75;
      let priceRange = data.estimated_price_range || null;

      if (state.sector === "construccion" && detectedArea && detectedArea > 0) {
        const pricePerM2 = totalCostNoIva / detectedArea;
        const serviceType = (state.serviceType || state.description || "").toLowerCase();

        let minExpected = 400; // €/m² default
        let maxExpected = 900;

        if (serviceType.includes("integral") || serviceType.includes("completa")) {
          minExpected = 500; maxExpected = 1200;
        } else if (serviceType.includes("baño") || serviceType.includes("cocina")) {
          minExpected = 600; maxExpected = 1500;
        } else if (serviceType.includes("parcial") || serviceType.includes("pintura")) {
          minExpected = 100; maxExpected = 400;
        }

        if (pricePerM2 < minExpected) {
          priceWarnings.push(
            `Presupuesto posiblemente infravalorado: ${pricePerM2.toFixed(0)} €/m² vs rango habitual ${minExpected}-${maxExpected} €/m². Revisa instalaciones, baños, cocina, carpinterías, calidades, licencias y gestión de residuos.`
          );
          pricingConfidence = Math.min(pricingConfidence, 50);
        } else if (pricePerM2 > maxExpected) {
          priceWarnings.push(
            `Presupuesto posiblemente sobrevalorado: ${pricePerM2.toFixed(0)} €/m² vs rango habitual ${minExpected}-${maxExpected} €/m².`
          );
          pricingConfidence = Math.min(pricingConfidence, 65);
        }

        if (!priceRange) {
          priceRange = {
            min: Math.round(detectedArea * minExpected),
            max: Math.round(detectedArea * maxExpected),
          };
        }
      }

      // --- Fallback materials for construction if AI returned empty ---
      let finalMaterials = newMaterials;
      let finalProviders = newProviders;
      if (finalMaterials.length === 0 && state.sector === "construccion") {
        finalMaterials = CONSTRUCTION_FALLBACK_MATERIALS;
        // Build providers from fallback materials
        const fbProvMap = new Map<string, { name: string; count: number; total: number }>();
        finalMaterials.forEach(m => {
          const pid = m.provider_id || "referencia-mercado";
          const existing = fbProvMap.get(pid) || { name: pid, count: 0, total: 0 };
          existing.count += 1;
          existing.total += m.subtotal;
          fbProvMap.set(pid, existing);
        });
        finalProviders = FALLBACK_PROVIDERS.map(fp => ({
          ...fp,
          materialsCount: fbProvMap.get(fp.id)?.count || 0,
          estimatedPrice: fbProvMap.get(fp.id)?.total || 0,
        })).filter(fp => (fp.materialsCount || 0) > 0);
        // Mark first as recommended
        if (finalProviders.length > 0) {
          finalProviders.sort((a, b) => (b.materialsCount || 0) - (a.materialsCount || 0));
          finalProviders[0].isRecommended = true;
        }
      }

      // --- Fallback partidas for construction if AI returned too few ---
      let finalPartidas = newPartidas;
      if (finalPartidas.length < 5 && state.sector === "construccion") {
        finalPartidas = CONSTRUCTION_FALLBACK_PARTIDAS;
      }

      // --- Timeline ---
      const calendarPhases = data.calendar_phases || [];
      const totalDays = calendarPhases.reduce((s: number, p: any) => s + (p.duration_days || 0), 0);
      const estimatedTimeline = data.estimated_timeline || (totalDays > 0 ? {
        total_duration_days: totalDays,
        total_duration_weeks: Math.ceil(totalDays / 5), // working weeks
        confidence: 0.7,
        notes: "Estimacion orientativa segun alcance declarado.",
      } : undefined);

      // --- Calculate end date from startDate + total_duration_days ---
      let calculatedEndDate: string | null = null;
      const durationDays = estimatedTimeline?.total_duration_days || totalDays;
      if (state.startDate && durationDays > 0) {
        const start = new Date(state.startDate);
        if (!isNaN(start.getTime())) {
          // Add working days (skip weekends)
          let addedDays = 0;
          const endDate = new Date(start);
          while (addedDays < durationDays) {
            endDate.setDate(endDate.getDate() + 1);
            const dow = endDate.getDay();
            if (dow !== 0 && dow !== 6) addedDays++;
          }
          calculatedEndDate = endDate.toISOString().split("T")[0];
        }
      }

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        lastAnalysisHash: currentHash,
        materialsFromAI: finalMaterials.length > 0,
        partidas: finalPartidas.length > 0 ? finalPartidas : prev.partidas,
        materials: finalMaterials.length > 0 ? finalMaterials : prev.materials,
        providerOptions: finalProviders.length > 0 ? finalProviders : prev.providerOptions,
        selectedProviderId: finalProviders.length > 0 ? finalProviders[0].id : prev.selectedProviderId,
        endDate: calculatedEndDate || prev.endDate,
        aiInsights: {
          summary: data.summary,
          confidence_score: data.confidence_score,
          regulatory_notes: data.regulatory_notes || [],
          calendar_phases: calendarPhases,
          missing_questions: data.missing_questions || [],
          estimated_timeline: estimatedTimeline,
          price_warnings: priceWarnings,
          pricing_confidence: pricingConfidence,
          estimated_price_range: priceRange,
          detected_area_m2: detectedArea,
          data_sources: data.data_sources,
        },
      }));
      return true;

    } catch (error: any) {
      console.error("AI Analysis failed:", error);
      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        analysisError: error.message
      }));
      return false;
    }
  };

  const nextStep = async () => {
    if (!validateStep(state.currentStep)) return;

    // AI Analysis when moving from step 0 to step 1
    if (state.currentStep === 0) {
      const isDefaultPartidas = state.partidas.length === 0 || (state.partidas.length === 2 && state.partidas[0].id === "example-1");

      // Only run analysis if we have default partidas
      if (isDefaultPartidas) {
        const success = await analyzeWithAI();

        // If AI failed or returned nothing, and we're in construction, inject fallback
        if (!success && (state.sector === "construccion" || !state.sector)) {
          const isReforma = state.serviceType?.toLowerCase().includes("reforma") || !state.serviceType;
          if (isReforma) {
            toast.info("Aviso", {
              description: "Usando plantilla local V1 porque el análisis IA no ha respondido."
            });
            setState(prev => ({
              ...prev,
              currentStep: prev.currentStep + 1,
              validationError: null,
              partidas: CONSTRUCTION_FALLBACK_PARTIDAS
            }));
            saveDraft(false);
            return;
          }
        }
      }
    }

    setState(prev => ({ ...prev, currentStep: prev.currentStep + 1, validationError: null }));
    saveDraft(false); // Force save on step change
  };
  const prevStep = () => setState(prev => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1), validationError: null }));
  const goToStep = async (step: number) => {
    if (step > state.currentStep) {
      for (let i = state.currentStep; i < step; i++) {
        if (!validateStep(i)) return;
      }

      if (state.currentStep === 0 && step > 0) {
         const isDefaultPartidas = state.partidas.length === 0 || (state.partidas.length === 2 && state.partidas[0].id === "example-1");
         if (isDefaultPartidas) {
           const success = await analyzeWithAI();
           if (!success && (state.sector === "construccion" || !state.sector)) {
              const isReforma = state.serviceType?.toLowerCase().includes("reforma") || !state.serviceType;
              if (isReforma) {
                toast.info("Aviso", {
                  description: "Usando plantilla local V1 porque el análisis IA no ha respondido."
                });
                setState(prev => ({ ...prev, partidas: CONSTRUCTION_FALLBACK_PARTIDAS }));
              }
           }
         }
      }
    }
    setState(prev => ({ ...prev, currentStep: step, validationError: null }));
    saveDraft(false);
  };

  return (
    <BudgetContext.Provider value={{
      state, updateState, updateSectorData, nextStep, prevStep, goToStep,
      addPartida, updatePartida, removePartida,
      setSelectedProvider, updateMaterial, setUseSuggestedMaterials,
      saveDraft, loadDraft, finalizeBudget, analyzeWithAI
    }}>
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudgetGenerate() {
  const context = useContext(BudgetContext);
  if (!context) {
    throw new Error("useBudgetGenerate must be used within a BudgetGenerateProvider");
  }
  return context;
}
