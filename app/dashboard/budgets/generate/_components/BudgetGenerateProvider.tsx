import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { normalizeSector } from "@/lib/sector-config";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { saveDocumentVersion, getNextVersion } from "@/lib/document-versions";
import { logActivity } from "@/lib/activity-log";
import {
  type BudgetScope,
  type EnginePartida,
  type EngineMaterial,
  type RealisticTimeline,
  type BudgetClientView,
  type BudgetInternalView,
  buildScopeQuantities,
  normalizeBudgetItemsToScope,
  calculateItemCostBreakdown,
  buildScopeMaterials,
  adjustToMarket,
  getMarketRange,
  estimateRealisticTimeline,
  buildClientView,
  buildInternalView,
} from "@/lib/budget-engine";
import {
  resolveMarketPrices,
  type PriceRequest,
  type QualityTier,
  type ResolvedPrice,
} from "@/lib/price-resolver";
import {
  applyProviderToAIMaterials,
  type ProviderAdjustmentMeta,
} from "@/lib/provider-materials";
import type {
  BudgetItemV2,
  BudgetEconomics,
  BudgetTimeline as BudgetTimelineV2,
  ValidationReport,
  ProjectAnalysis,
  BudgetScopeV2,
  BudgetPreferences,
} from "@/lib/types/budget-v2";

export interface Partida {
  id: string;
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  chapter?: string;
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
  /** True when the selected provider does not carry this material */
  missing_in_selected_provider?: boolean;
  /** Human-readable reason when material falls back to base price */
  provider_fallback_reason?: string;
  /** Metadata about provider price adjustment */
  provider_adjustment?: ProviderAdjustmentMeta;
}

/** @deprecated Use normalizeBudgetItemsToScope from budget-engine instead */
const getDetailedConstructionFallback = (areaM2: number, marginMultiplier: number): Partida[] => {
  const p = (concept: string, description: string, quantity: number, unit: string, unit_price: number, category: string, id: string): Partida => ({
    id, concept, description, quantity, unit, category, unit_price,
    subtotal_cost: quantity * unit_price,
    unit_price_client: unit_price * marginMultiplier,
    subtotal_client: quantity * unit_price * marginMultiplier,
    status: "incluida"
  });

  const a = Math.max(areaM2 || 80, 30); // @deprecated — use budget-engine instead

  return [
    p("Protección de zonas comunes y ascensor", "Forrado de ascensor, pasillos y elementos comunes con cartón ondulado y plástico.", 1, "PA", 150, "otros", "fb-1"),
    p("Demolición de tabiquería", "Derribo manual de tabiquería interior no portante.", Math.round(a * 0.4), "m2", 12, "mano_obra", "fb-2"),
    p("Demolición de pavimentos", "Levantado de pavimentos existentes y rodapiés.", a, "m2", 9, "mano_obra", "fb-3"),
    p("Demolición de alicatados (Baños y Cocina)", "Picado de azulejos en zonas húmedas.", Math.round(a * 0.4), "m2", 11, "mano_obra", "fb-4"),
    p("Desmontaje de sanitarios y muebles", "Retirada de sanitarios, grifería y muebles de cocina.", 1, "PA", 250, "mano_obra", "fb-5"),
    p("Desmontaje de carpintería interior", "Retirada de puertas y premarcos.", Math.max(Math.round(a / 12), 2), "ud", 25, "mano_obra", "fb-6"),
    p("Gestión de residuos y contenedores", "Alquiler de contenedores, tasas de vertedero y transporte.", Math.max(Math.round(a / 20), 1), "ud", 250, "otros", "fb-7"),

    p("Formación de tabiquería (Pladur/Ladrillo)", "Suministro e instalación de nueva tabiquería interior.", Math.round(a * 0.5), "m2", 38, "mano_obra", "fb-8"),
    p("Falsos techos continuos", "Formación de falso techo de placa de yeso laminado.", a, "m2", 28, "mano_obra", "fb-9"),
    p("Ayudas de albañilería", "Apertura y tapado de regatas para instalaciones.", 1, "PA", 800, "mano_obra", "fb-10"),

    p("Instalación de fontanería (Baño 1)", "Red de agua fría, caliente y desagües para 1 baño completo.", 1, "PA", 950, "mano_obra", "fb-11"),
    p("Instalación de fontanería (Cocina)", "Red de fontanería y desagües para cocina.", 1, "PA", 650, "mano_obra", "fb-12"),
    p("Instalación de climatización", "Preinstalación y conductos para aire acondicionado.", 1, "PA", 1200, "mano_obra", "fb-13"),

    p("Cuadro eléctrico y derivaciones", "Suministro e instalación de cuadro general de mando y protección.", 1, "ud", 450, "mano_obra", "fb-14"),
    p("Puntos de luz y enchufes", "Cableado y cajas para puntos de luz y tomas de corriente.", Math.round(a * 0.8), "ud", 35, "mano_obra", "fb-15"),
    p("Suministro y colocación de mecanismos", "Mecanismos eléctricos estándar.", Math.round(a * 0.8), "ud", 20, "mano_obra", "fb-16"),

    p("Alicatado de baños y cocina", "Colocación de revestimiento cerámico en paredes.", Math.round(a * 0.4), "m2", 35, "mano_obra", "fb-17"),
    p("Solado general de vivienda", "Colocación de pavimento (laminado o cerámico).", a, "m2", 25, "mano_obra", "fb-18"),
    p("Rodapié", "Suministro y colocación de rodapié a juego.", Math.round(a * 0.8), "ml", 8, "mano_obra", "fb-19"),

    p("Preparación de paredes (Alisado)", "Raspado de gotelé y lucido de paredes con masilla.", Math.round(a * 2.5), "m2", 14, "mano_obra", "fb-20"),
    p("Pintura plástica lisa", "Aplicación de dos manos de pintura plástica lavable.", Math.round(a * 3.5), "m2", 6, "mano_obra", "fb-21"),

    p("Carpintería interior (Puertas de paso)", "Suministro y colocación de puertas de paso lacadas.", Math.max(Math.round(a / 12), 2), "ud", 350, "mano_obra", "fb-22"),
    p("Puerta de entrada", "Suministro y colocación de puerta de seguridad.", 1, "ud", 850, "mano_obra", "fb-23"),
    p("Carpintería exterior (Ventanas)", "Suministro y colocación de ventanas PVC/Aluminio RPT.", Math.max(Math.round(a / 15), 2), "ud", 450, "mano_obra", "fb-24"),

    p("Suministro y montaje de sanitarios", "Inodoros, lavabos y platos de ducha.", 1, "PA", 850, "mano_obra", "fb-25"),
    p("Suministro y montaje de grifería", "Grifería de lavabos, ducha y cocina.", 1, "PA", 450, "mano_obra", "fb-26"),

    p("Mobiliario de cocina", "Muebles altos y bajos de cocina (estimación base).", 1, "PA", 3500, "mano_obra", "fb-27"),
    p("Encimera de cocina", "Suministro e instalación de encimera tipo cuarzo/porcelánico.", 1, "PA", 1200, "mano_obra", "fb-28"),

    p("Limpieza final de obra", "Limpieza profesional exhaustiva.", 1, "PA", 350, "mano_obra", "fb-29"),
    p("Seguridad y Salud", "Medios auxiliares y EPIs.", 1, "PA", 300, "otros", "fb-30"),
  ];
};

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
  { id: "leroy-merlin", name: "Leroy Merlin", description: "Gran superficie de bricolaje y construcción", estimatedPrice: 0, deliveryTime: "24-48h", stockLevel: "Alto", rating: 4.8, isRecommended: true, materialsCount: 0, isRealData: false },
  { id: "obramat", name: "Obramat", description: "Almacén profesional de materiales", estimatedPrice: 0, deliveryTime: "48-72h", stockLevel: "Medio", rating: 4.5, isRecommended: false, materialsCount: 0, isRealData: false },
  { id: "saltoki", name: "Saltoki", description: "Distribuidor profesional de fontanería y electricidad", estimatedPrice: 0, deliveryTime: "24-72h", stockLevel: "Alto", rating: 4.6, isRecommended: false, materialsCount: 0, isRealData: false },
  { id: "referencia-mercado", name: "Referencia mercado", description: "Precios de referencia del mercado español", estimatedPrice: 0, deliveryTime: "Variable", stockLevel: "A consultar", rating: 4.0, isRecommended: false, materialsCount: 0, isRealData: false },
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
  /** Immutable snapshot of AI/engine materials before provider enrichment */
  baseAIMaterials: Material[];
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
  /** When true, the scope/description changed since last AI analysis */
  analysisDirty: boolean;
  /** Budget is below market floor — blocks finalize and client PDF */
  isUndervalued: boolean;
  /** Market adjustment message (green/amber) */
  marketAdjustMessage: string;
  /** Realistic timeline from engine */
  realisticTimeline: RealisticTimeline | null;
  /** Client view for PDF (chapters, no escandallo) */
  clientView: BudgetClientView | null;
  /** Internal view for PDF (full escandallo) */
  internalView: BudgetInternalView | null;
  /** V2 pipeline results */
  v2Analysis: ProjectAnalysis | null;
  v2Economics: BudgetEconomics | null;
  v2Timeline: BudgetTimelineV2 | null;
  v2Validation: ValidationReport | null;
  v2Items: BudgetItemV2[] | null;
  /** Saving states */
  isSavingDraft: boolean;
  isFinalizing: boolean;
  saveError: string | null;
  finalizeError: string | null;
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
  saveDraft: (manual?: boolean) => Promise<string | null>;
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
    baseAIMaterials: [],
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
    analysisDirty: false,
    isUndervalued: false,
    marketAdjustMessage: "",
    realisticTimeline: null,
    clientView: null,
    internalView: null,
    v2Analysis: null,
    v2Economics: null,
    v2Timeline: null,
    v2Validation: null,
    v2Items: null,
    isSavingDraft: false,
    isFinalizing: false,
    saveError: null,
    finalizeError: null,
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

        // allFetchedMaterials es el snapshot base inmutable.
        // Siempre se clona para evitar que mutaciones en `materials`
        // contaminen el array de referencia.
        setState(prev => ({
          ...prev,
          providerOptions: newProviderOptions,
          selectedProviderId: activeId,
          allFetchedMaterials: realMaterials.map(m => ({ ...m })),
          materials: visibleMaterials.map(m => ({ ...m })),
          isRealDataMode: true
        }));

      } catch (err) {
        console.error("[BudgetGenerateProvider] Error fetching real prices:", err);
      }
    };

    fetchRealData();
    return () => { mounted = false; };
  }, [state.sector]);

  // El filtrado por proveedor ya no se hace en useEffect, sino dentro de
  // setSelectedProvider para evitar race conditions y recalcular siempre
  // desde snapshot base (allFetchedMaterials). Esto garantiza reversibilidad
  // A → B → A sin perder ni duplicar materiales.

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

  const SCOPE_FIELDS = new Set(["description", "serviceType", "startDate"]);

  const updateState = (updates: Partial<BudgetState>) => {
    const scopeChanged = Object.keys(updates).some(k => SCOPE_FIELDS.has(k));
    setState(prev => ({
      ...prev,
      ...updates,
      ...(scopeChanged && prev.lastAnalysisHash ? { analysisDirty: true } : {}),
    }));
  };

  const updateSectorData = (key: string, value: any) => {
    setState(prev => ({
      ...prev,
      sectorData: { ...prev.sectorData, [key]: value },
      ...(prev.lastAnalysisHash ? { analysisDirty: true } : {}),
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

  /**
   * Selecciona un proveedor y recalcula los materiales visibles.
   *
   * Modo IA/motor (materialsFromAI=true):
   *   Enriquece/reprecia desde baseAIMaterials usando applyProviderToAIMaterials.
   *   Mantiene TODOS los materiales, marca los que faltan en el proveedor.
   *   Garantiza reversibilidad A → B → A.
   *
   * Modo real-data (materialsFromAI=false):
   *   Filtra desde allFetchedMaterials por provider_id === id.
   */
  const setSelectedProvider = (id: string) => {
    setState(prev => {
      // Caso 1: modo IA/motor — enriquecer, no filtrar
      if (prev.materialsFromAI && prev.baseAIMaterials.length > 0) {
        // Buscar el nombre del proveedor para metadata
        const provOption = prev.providerOptions.find(p => p.id === id);
        const provName = provOption?.name || id;

        const enriched = applyProviderToAIMaterials(
          prev.baseAIMaterials as any,
          prev.allFetchedMaterials as any,
          id,
          provName
        );

        return {
          ...prev,
          selectedProviderId: id,
          materials: enriched as Material[],
        };
      }

      // Caso 2: sin materiales reales cargados
      if (prev.allFetchedMaterials.length === 0) {
        return { ...prev, selectedProviderId: id };
      }

      // Caso 3: real-data — filtrar desde snapshot base (deep clone)
      const filtered = prev.allFetchedMaterials
        .filter(m => m.provider_id === id)
        .map(m => ({ ...m }));

      return {
        ...prev,
        selectedProviderId: id,
        materials: filtered,
      };
    });
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
  const saveDraft = async (manual = false): Promise<string | null> => {
    // Don't autosave if there's no meaningful data yet
    if (!manual && !state.title && !state.description && state.partidas.length <= 2) {
      return null;
    }

    if (manual) {
      setState(prev => ({ ...prev, isSavingDraft: true, saveError: null }));
    }

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (manual) {
          setState(prev => ({ ...prev, isSavingDraft: false, saveError: "No hay usuario autenticado" }));
          toast.error("No hay usuario autenticado");
        }
        return null;
      }

      // Build snapshot — exclude circular/transient fields
      const snapshot = {
        ...state,
        isSavingDraft: false,
        isFinalizing: false,
        saveError: null,
        finalizeError: null,
      };

      let draftId = state.draftId;

      if (!draftId) {
        // Generate budget_number: PRE-{year}-{random5}
        const year = new Date().getFullYear();
        const randArray = new Uint32Array(1);
        crypto.getRandomValues(randArray);
        const rand = 10000 + (randArray[0] % 90000);
        const budgetNumber = `PRE-${year}-${rand}`;

        // Insert new draft
        const { data, error } = await supabase.from("budgets").insert({
          user_id: user.id,
          budget_number: budgetNumber,
          status: "borrador",
          title: state.title || "Borrador de Presupuesto (Wizard)",
          client_id: state.clientId || null,
          project_id: state.projectId || null,
          service_type: state.serviceType || state.sector || "general",
          subtotal: state.totals.clientPrice,
          iva_percent: state.ivaPercent,
          iva_amount: state.totals.clientPrice * (state.ivaPercent / 100),
          total: state.totals.clientPrice * (1 + state.ivaPercent / 100),
          wizard_state: snapshot
        }).select("id").single();

        if (error) throw error;
        draftId = data.id;
        setState(prev => ({
          ...prev,
          draftId,
          isSavingDraft: false,
          saveError: null,
          lastSavedAt: new Date().toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })
        }));
      } else {
        // Update existing draft
        const { error } = await supabase.from("budgets").update({
          title: state.title || "Borrador de Presupuesto (Wizard)",
          client_id: state.clientId || null,
          project_id: state.projectId || null,
          service_type: state.serviceType || state.sector || "general",
          subtotal: state.totals.clientPrice,
          iva_amount: state.totals.clientPrice * (state.ivaPercent / 100),
          total: state.totals.clientPrice * (1 + state.ivaPercent / 100),
          wizard_state: snapshot,
          updated_at: new Date().toISOString()
        }).eq("id", draftId);

        if (error) throw error;

        setState(prev => ({
          ...prev,
          isSavingDraft: false,
          saveError: null,
          lastSavedAt: new Date().toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })
        }));
      }

      if (manual) {
        toast.success("Borrador guardado correctamente");
      }
      return draftId;
    } catch (err: any) {
      const errorMsg = err?.message || "Error desconocido al guardar";
      console.error("Error saving draft:", err);
      setState(prev => ({ ...prev, isSavingDraft: false, saveError: errorMsg }));
      if (manual) toast.error("Error al guardar: " + errorMsg);
      return null;
    }
  };

  const finalizeBudget = async (): Promise<string | null> => {
    // Block finalization if budget is undervalued
    if (state.isUndervalued) {
      toast.error("No se puede finalizar: el presupuesto esta por debajo del minimo realista de mercado. Ajusta las partidas o genera de nuevo con IA.");
      return null;
    }
    setState(prev => ({ ...prev, isFinalizing: true, finalizeError: null }));
    try {
      const currentDraftId = await saveDraft(false); // Asegurarse de que tenemos el ID y el ultimo estado

      const supabase = createClient();
      const budgetId = currentDraftId || state.draftId;
      if (!budgetId) throw new Error("No hay borrador para finalizar. Guarda un borrador primero.");

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

      setState(prev => ({ ...prev, isFinalizing: false, finalizeError: null }));
      toast.success("Presupuesto finalizado correctamente");
      return budgetId;

    } catch (err: any) {
      const errorMsg = err?.message || "Error desconocido al finalizar";
      console.error("Error finalizing budget:", err);
      setState(prev => ({ ...prev, isFinalizing: false, finalizeError: errorMsg }));
      toast.error("Error al finalizar: " + errorMsg);
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

    // Include scope data in hash so changes to estancias/calidad/superficie trigger re-analysis
    const scopeStr = JSON.stringify({
      s: state.sectorData.estancias,
      a: state.sectorData.actuaciones,
      c: state.sectorData.calidad,
      m2: state.sectorData.superficie_m2,
      nb: state.sectorData.num_banos,
      ck: state.sectorData.incluye_cocina,
      cv: state.sectorData.incluye_ventanas,
      cc: state.sectorData.incluye_climatizacion,
    });
    const currentHash = `${state.sector}-${state.serviceType}-${state.description}-${scopeStr}`.trim();
    if (!forceRegenerate && state.lastAnalysisHash === currentHash && !state.analysisError) {
      return true;
    }

    // When forcing regeneration, clear the materialsFromAI guard so the new results apply
    setState(prev => ({
      ...prev,
      isAnalyzing: true,
      analysisError: null,
      analysisDirty: false,
      ...(forceRegenerate ? { materialsFromAI: false } : {}),
    }));

    try {
      const isConstruction = state.sector === "construccion" || !state.sector;
      const marginMultiplier = 1 + (state.marginPercent / 100);

      // ─── V2 PIPELINE (construction) ───
      if (isConstruction) {
        const v2Scope: BudgetScopeV2 = {
          project_type: (state.serviceType as any) || "reforma_integral",
          work_category: "residencial",
          location: state.sectorData.ubicacion || "",
          surface_m2: state.sectorData.superficie_m2 || 80,
          num_bathrooms: state.sectorData.num_banos || 1,
          num_rooms: (state.sectorData.estancias || []).length || 3,
          includes_kitchen: state.sectorData.incluye_cocina ?? true,
          includes_windows: state.sectorData.incluye_ventanas ?? false,
          includes_hvac: state.sectorData.incluye_climatizacion ?? false,
          current_state: "necesita_reforma",
          quality: (state.sectorData.calidad as any) || "media",
          rooms: state.sectorData.estancias || [],
          works_requested: state.sectorData.actuaciones || [],
          start_date: state.startDate,
          deadline_date: state.endDate,
          description: state.description,
          client: null,
        };
        const v2Prefs: BudgetPreferences = {
          quality: (state.sectorData.calidad as any) || "media",
          margin_percent: state.marginPercent,
          indirect_costs_percent: 6,
          tax_percent: state.ivaPercent,
          workers_count: null,
          include_alternatives: false,
        };

        const res = await fetch("/api/budgets/generate-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: v2Scope, preferences: v2Prefs }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Error en pipeline v2");
        }

        const v2Data = await res.json();
        const v2Items: BudgetItemV2[] = v2Data.items || [];
        const v2Analysis: ProjectAnalysis | null = v2Data.analysis || null;
        const v2Economics: BudgetEconomics | null = v2Data.economics || null;
        const v2Timeline: BudgetTimelineV2 | null = v2Data.timeline || null;
        const v2Validation: ValidationReport | null = v2Data.validation || null;

        // Map BudgetItemV2[] to Partida[]
        const v2Partidas: Partida[] = v2Items.map((item, idx) => ({
          id: item.id || `v2-p-${idx}`,
          concept: item.name,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          category: item.chapter || "mano_obra",
          chapter: item.chapter,
          unit_price: item.unit_cost,
          subtotal_cost: item.subtotal_cost,
          unit_price_client: item.unit_price_sale,
          subtotal_client: item.subtotal_sale,
          status: item.priority === "opcional" ? "opcional" as const
            : item.confidence_score < 0.5 ? "estimada" as const
            : "incluida" as const,
        }));

        // Map item materials to Material[]
        const v2Materials: Material[] = [];
        v2Items.forEach((item, itemIdx) => {
          (item.materials || []).forEach((mat, matIdx) => {
            v2Materials.push({
              id: `v2-m-${itemIdx}-${matIdx}`,
              name: mat.name,
              quantity: mat.quantity,
              unit: mat.unit,
              unit_price: mat.unit_price,
              subtotal: mat.subtotal,
              included: true,
              provider_id: (mat.supplier || "referencia-mercado").toLowerCase().replace(/[^a-z0-9]/g, "-"),
              isRealData: mat.source !== "estimated",
              sourceType: mat.source || "estimated",
            });
          });
        });

        // Build provider options from materials
        const v2ProvMap = new Map<string, { name: string; count: number; total: number; isReal: boolean; sourceType: string }>();
        v2Materials.forEach(m => {
          const pid = m.provider_id || "referencia-mercado";
          const existing = v2ProvMap.get(pid) || { name: pid, count: 0, total: 0, isReal: m.isRealData || false, sourceType: m.sourceType || "estimated" };
          existing.count += 1;
          existing.total += m.subtotal;
          v2ProvMap.set(pid, existing);
        });
        const provNameMap: Record<string, string> = {
          "leroy-merlin": "Leroy Merlin", "obramat": "Obramat", "saltoki": "Saltoki",
          "referencia-mercado": "Referencia mercado", "banco-enlaze-base": "Banco ENLAZE base",
        };
        let v2Providers: ProviderOption[] = Array.from(v2ProvMap.entries()).map(([id, info]) => ({
          id,
          name: provNameMap[id] || info.name,
          description: info.isReal ? "Proveedor sugerido" : "Referencia de mercado",
          estimatedPrice: Math.round(info.total * 100) / 100,
          deliveryTime: "Consultar",
          stockLevel: "A consultar" as const,
          rating: 4.5,
          isRecommended: false,
          materialsCount: info.count,
          isRealData: info.isReal,
          sourceType: info.sourceType,
        }));
        v2Providers.sort((a, b) => (b.materialsCount || 0) - (a.materialsCount || 0));
        if (v2Providers.length > 0) v2Providers[0].isRecommended = true;

        // Build timeline info for aiInsights
        const timelinePhases = v2Timeline?.phases?.map(ph => ({
          title: ph.name,
          duration_days: ph.duration_days,
          description: `Dia ${ph.start_day} a ${ph.end_day}`,
        })) || v2Analysis?.phases?.map(ph => ({
          title: ph.name,
          duration_days: ph.estimated_days,
          description: ph.trades.join(", "),
        })) || [];
        const totalDays = timelinePhases.reduce((s, p) => s + (p.duration_days || 0), 0);

        // Build end date from timeline
        let calculatedEndDate: string | null = null;
        if (state.startDate && totalDays > 0) {
          const start = new Date(state.startDate);
          if (!isNaN(start.getTime())) {
            let addedDays = 0;
            const endDate = new Date(start);
            while (addedDays < totalDays) {
              endDate.setDate(endDate.getDate() + 1);
              const dow = endDate.getDay();
              if (dow !== 0 && dow !== 6) addedDays++;
            }
            calculatedEndDate = endDate.toISOString().split("T")[0];
          }
        }

        // Build engine views for PDFs
        const detectedArea = v2Scope.surface_m2;
        const engineScope: BudgetScope = {
          superficie_m2: detectedArea,
          num_banos: v2Scope.num_bathrooms,
          incluye_cocina: v2Scope.includes_kitchen,
          incluye_ventanas: v2Scope.includes_windows,
          incluye_climatizacion: v2Scope.includes_hvac,
          estancias: v2Scope.rooms,
          actuaciones: v2Scope.works_requested,
          calidad: v2Scope.quality,
          ubicacion: v2Scope.location,
        };
        const viewItems: EnginePartida[] = v2Partidas.map(p => ({
          ...p,
          chapter: p.chapter || "",
          status: (p.status || "incluida") as "incluida" | "estimada" | "opcional",
        }));
        const viewMaterials: EngineMaterial[] = v2Materials.length > 0
          ? v2Materials.map(m => ({
              id: m.id, name: m.name, quantity: m.quantity, unit: m.unit,
              unit_price: m.unit_price, subtotal: m.subtotal, included: m.included,
              provider_id: m.provider_id || "referencia-mercado",
              linked_chapter: "", isRealData: m.isRealData || false,
              sourceType: m.sourceType || "estimated",
            }))
          : buildScopeMaterials(engineScope).map(em => ({ ...em }));
        const engineMats = buildScopeMaterials(engineScope);
        const linkedMaterials = viewMaterials.map((m, idx) => ({
          ...m,
          linked_chapter: engineMats[idx]?.linked_chapter || "",
        }));
        const computedClientView = buildClientView(engineScope, viewItems, state.ivaPercent);
        const computedInternalView = buildInternalView(engineScope, viewItems, linkedMaterials, state.ivaPercent);

        // Map market range
        const range = getMarketRange(engineScope, state.serviceType || state.description || "");
        const isUndervalued = v2Economics?.undervaluation_check?.is_undervalued || false;
        const marketAdjustMessage = isUndervalued
          ? (v2Economics?.undervaluation_check?.warnings?.map(w => w.detail).join("; ") || "Presupuesto posiblemente infravalorado")
          : "";

        // Realistic timeline from engine (for compatibility)
        const engineTimeline = estimateRealisticTimeline(engineScope, viewItems);

        setState(prev => ({
          ...prev,
          isAnalyzing: false,
          lastAnalysisHash: currentHash,
          materialsFromAI: v2Materials.length > 0,
          partidas: v2Partidas.length > 0 ? v2Partidas : prev.partidas,
          materials: v2Materials.length > 0 ? v2Materials : prev.materials,
          baseAIMaterials: v2Materials.length > 0 ? v2Materials.map(m => ({ ...m })) : prev.baseAIMaterials,
          providerOptions: v2Providers.length > 0 ? v2Providers : prev.providerOptions,
          selectedProviderId: v2Providers.length > 0 ? v2Providers[0].id : prev.selectedProviderId,
          endDate: calculatedEndDate || v2Timeline?.end_date_estimated || prev.endDate,
          isUndervalued,
          marketAdjustMessage,
          realisticTimeline: engineTimeline,
          clientView: computedClientView,
          internalView: computedInternalView,
          v2Analysis: v2Analysis,
          v2Economics: v2Economics,
          v2Timeline: v2Timeline,
          v2Validation: v2Validation,
          v2Items: v2Items,
          aiInsights: {
            summary: v2Analysis?.project_summary
              ? `${v2Analysis.project_summary.project_type} - ${v2Analysis.project_summary.complexity} complejidad, ${v2Analysis.project_summary.surface_m2}m2`
              : v2Data.summary?.toString() || "",
            confidence_score: v2Data.summary?.avg_confidence ?? 0.75,
            regulatory_notes: v2Analysis?.permits_needed?.map((p: string) => ({ title: p, description: p })) || [],
            calendar_phases: timelinePhases,
            missing_questions: v2Analysis?.missing_information || [],
            estimated_timeline: totalDays > 0 ? {
              total_duration_days: totalDays,
              total_duration_weeks: Math.ceil(totalDays / 5),
              confidence: 0.8,
              notes: v2Timeline
                ? `Ejecucion ${v2Timeline.estimated_duration.weeks_min}-${v2Timeline.estimated_duration.weeks_max} semanas`
                : `Estimacion ${totalDays} dias laborables`,
            } : undefined,
            price_warnings: v2Validation?.warnings?.map(w => w.message) || [],
            pricing_confidence: v2Data.summary?.avg_confidence
              ? Math.round(v2Data.summary.avg_confidence * 100)
              : 75,
            estimated_price_range: { min: range.min, max: range.max },
            detected_area_m2: detectedArea,
            data_sources: {
              price_items_count: v2Data.summary?.price_sources?.user_catalog || 0,
              n8n_items_count: v2Data.summary?.price_sources?.n8n_market || 0,
              default_items_count: v2Data.summary?.price_sources?.estimated || 0,
              sector_price_count: v2Data.summary?.price_sources?.technical_bank || 0,
              sector_regulation_count: v2Analysis?.permits_needed?.length || 0,
              real_suppliers: [],
              using_fallback: false,
              fallback_reason: "",
            },
          },
        }));
        return true;
      }

      // ─── LEGACY PATH (non-construction sectors) ───
      const res = await fetch("/api/agent/budget-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: state.sector,
          description: state.description,
          service_type: state.serviceType,
          scope: {
            ubicacion: state.sectorData.ubicacion || "",
            estancias: state.sectorData.estancias || [],
            actuaciones: state.sectorData.actuaciones || [],
            calidad: state.sectorData.calidad || "media",
            superficie_m2: state.sectorData.superficie_m2 || null,
            num_banos: state.sectorData.num_banos || 1,
            incluye_cocina: state.sectorData.incluye_cocina ?? true,
            incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
            incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
          },
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al analizar la peticion");
      }

      const data = await res.json();

      // Map suggested_items to Partidas
      let newPartidas: Partida[] = (data.suggested_items || []).map((item: any, idx: number) => {
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

      // ─── ENGINE-BASED NORMALIZATION (idempotent) ───
      const detectedArea = state.sectorData.superficie_m2 || data.detected_scope?.area_m2 || null;
      const serviceType = (state.serviceType || state.description || "").toLowerCase();
      let priceWarnings: string[] = data.price_warnings || [];
      let pricingConfidence = data.pricing_confidence || data.confidence_score || 75;
      let priceRange = data.estimated_price_range || null;
      let isUndervalued = false;
      let marketAdjustMessage = "";

      // Build scope from user data (user scope always takes priority)
      const engineScope: BudgetScope = {
        superficie_m2: detectedArea || 80,
        num_banos: state.sectorData.num_banos || 1,
        incluye_cocina: state.sectorData.incluye_cocina ?? true,
        incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
        incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
        estancias: state.sectorData.estancias || [],
        actuaciones: state.sectorData.actuaciones || [],
        calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
        ubicacion: state.sectorData.ubicacion || "",
      };

      let finalPartidas: Partida[] = newPartidas;
      let finalMaterials: Material[] = newMaterials;

      if (state.sector === "construccion" && detectedArea && detectedArea > 0) {
        // A) Convert AI partidas to EnginePartida, normalize quantities + add missing chapters
        const engineItems: EnginePartida[] = newPartidas.map(p => ({
          ...p,
          chapter: (p as any).chapter || "",
          status: (p.status || "incluida") as "incluida" | "estimada" | "opcional",
        }));

        const normalized = normalizeBudgetItemsToScope(engineScope, engineItems, marginMultiplier);

        // B) Apply cost breakdown and fix categories
        const withCosts = normalized.map(item =>
          calculateItemCostBreakdown(item, engineScope, state.marginPercent)
        );

        // C) Build scope-driven materials (replaces AI materials or fallback)
        const engineMats = buildScopeMaterials(engineScope);

        // D) Market adjustment (idempotent)
        const adjustResult = adjustToMarket(
          engineScope, withCosts, engineMats, serviceType, marginMultiplier
        );

        isUndervalued = adjustResult.isUndervalued;
        marketAdjustMessage = adjustResult.message;

        if (adjustResult.adjusted) {
          priceWarnings.push(adjustResult.message);
          pricingConfidence = Math.min(pricingConfidence, 65);
        }

        // Convert back to Partida format
        finalPartidas = adjustResult.items.map(ep => ({
          id: ep.id,
          concept: ep.concept,
          description: ep.description,
          quantity: ep.quantity,
          unit: ep.unit,
          category: ep.category,
          chapter: ep.chapter,
          unit_price: ep.unit_price,
          subtotal_cost: ep.subtotal_cost,
          unit_price_client: ep.unit_price_client,
          subtotal_client: ep.subtotal_client,
          status: ep.status,
        }));

        // Convert engine materials to Material format
        finalMaterials = adjustResult.materials.map(em => ({
          id: em.id,
          name: em.name,
          quantity: em.quantity,
          unit: em.unit,
          unit_price: em.unit_price,
          subtotal: em.subtotal,
          included: em.included,
          provider_id: em.provider_id,
          isRealData: em.isRealData,
          sourceType: em.sourceType,
        }));

        // Market range
        const range = getMarketRange(engineScope, serviceType);
        priceRange = priceRange || { min: range.min, max: range.max };
      }

      // --- Fallback partidas for construction if AI returned too few ---
      if (state.sector === "construccion" && finalPartidas.length < 5) {
        // Use engine to build from scratch based on scope
        const fallbackScope: BudgetScope = {
          superficie_m2: detectedArea || 80,
          num_banos: state.sectorData.num_banos || 1,
          incluye_cocina: state.sectorData.incluye_cocina ?? true,
          incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
          incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
          estancias: state.sectorData.estancias || [],
          actuaciones: state.sectorData.actuaciones || [],
          calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
          ubicacion: state.sectorData.ubicacion || "",
        };
        const built = normalizeBudgetItemsToScope(fallbackScope, [], marginMultiplier);
        finalPartidas = built.map(ep => ({
          id: ep.id, concept: ep.concept, description: ep.description,
          quantity: ep.quantity, unit: ep.unit, category: ep.category,
          chapter: ep.chapter,
          unit_price: ep.unit_price, subtotal_cost: ep.subtotal_cost,
          unit_price_client: ep.unit_price_client, subtotal_client: ep.subtotal_client,
          status: ep.status,
        }));
        finalMaterials = buildScopeMaterials(fallbackScope).map(em => ({
          id: em.id, name: em.name, quantity: em.quantity, unit: em.unit,
          unit_price: em.unit_price, subtotal: em.subtotal, included: em.included,
          provider_id: em.provider_id, isRealData: em.isRealData, sourceType: em.sourceType,
        }));
      }

      // --- Fallback materials if still empty ---
      if (finalMaterials.length === 0 && state.sector === "construccion") {
        const matScope: BudgetScope = {
          superficie_m2: detectedArea || 80,
          num_banos: state.sectorData.num_banos || 1,
          incluye_cocina: state.sectorData.incluye_cocina ?? true,
          incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
          incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
          estancias: [], actuaciones: [],
          calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
          ubicacion: "",
        };
        finalMaterials = buildScopeMaterials(matScope).map(em => ({
          id: em.id, name: em.name, quantity: em.quantity, unit: em.unit,
          unit_price: em.unit_price, subtotal: em.subtotal, included: em.included,
          provider_id: em.provider_id, isRealData: em.isRealData, sourceType: em.sourceType,
        }));
      }

      // --- Timeline via engine ---
      const engineTimelineScope: BudgetScope = {
        superficie_m2: detectedArea || 80,
        num_banos: state.sectorData.num_banos || 1,
        incluye_cocina: state.sectorData.incluye_cocina ?? true,
        incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
        incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
        estancias: state.sectorData.estancias || [],
        actuaciones: state.sectorData.actuaciones || [],
        calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
        ubicacion: state.sectorData.ubicacion || "",
      };
      const engineTimeline = state.sector === "construccion"
        ? estimateRealisticTimeline(engineTimelineScope, finalPartidas.map(p => ({
            ...p, chapter: p.chapter || "", status: (p.status || "incluida") as "incluida" | "estimada" | "opcional",
          })))
        : null;

      const calendarPhases = engineTimeline
        ? engineTimeline.phase_breakdown.map(ph => ({
            title: ph.title,
            duration_days: Math.round((ph.duration_days_min + ph.duration_days_max) / 2),
            description: ph.description,
          }))
        : data.calendar_phases || [];
      const totalDays = calendarPhases.reduce((s: number, p: any) => s + (p.duration_days || 0), 0);
      const estimatedTimeline = engineTimeline ? {
        total_duration_days: totalDays,
        total_duration_weeks: engineTimeline.execution_weeks_min,
        confidence: 0.8,
        notes: `Ejecucion ${engineTimeline.execution_weeks_min}-${engineTimeline.execution_weeks_max} semanas. Plazo total ${engineTimeline.total_weeks_min}-${engineTimeline.total_weeks_max} semanas.`,
      } : data.estimated_timeline || (totalDays > 0 ? {
        total_duration_days: totalDays,
        total_duration_weeks: Math.ceil(totalDays / 5),
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

      // Build providers from final materials
      const finalProvMap = new Map<string, { name: string; count: number; total: number; isReal: boolean; sourceType: string }>();
      finalMaterials.forEach(m => {
        const pid = m.provider_id || "referencia-mercado";
        const existing = finalProvMap.get(pid) || { name: pid, count: 0, total: 0, isReal: m.isRealData || false, sourceType: m.sourceType || "market_reference" };
        existing.count += 1;
        existing.total += m.subtotal;
        finalProvMap.set(pid, existing);
      });
      let finalProviders: ProviderOption[] = [];
      if (finalProvMap.size > 0) {
        const provNameMap: Record<string, string> = {
          "leroy-merlin": "Leroy Merlin",
          "obramat": "Obramat",
          "saltoki": "Saltoki",
          "referencia-mercado": "Referencia mercado",
        };
        finalProviders = Array.from(finalProvMap.entries()).map(([id, info]) => ({
          id,
          name: provNameMap[id] || info.name,
          description: info.isReal ? "Proveedor sugerido por IA" : "Referencia de mercado",
          estimatedPrice: Math.round(info.total * 100) / 100,
          deliveryTime: "Consultar",
          stockLevel: "A consultar" as const,
          rating: 4.5,
          isRecommended: false,
          materialsCount: info.count,
          isRealData: info.isReal,
          sourceType: info.sourceType,
        }));
        finalProviders.sort((a, b) => (b.materialsCount || 0) - (a.materialsCount || 0));
        if (finalProviders.length > 0) finalProviders[0].isRecommended = true;
      }

      // ─── Build dual views for PDFs ───
      let computedClientView: BudgetClientView | null = null;
      let computedInternalView: BudgetInternalView | null = null;

      if (state.sector === "construccion" && finalPartidas.length > 0) {
        const viewScope: BudgetScope = {
          superficie_m2: detectedArea || 80,
          num_banos: state.sectorData.num_banos || 1,
          incluye_cocina: state.sectorData.incluye_cocina ?? true,
          incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
          incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
          estancias: state.sectorData.estancias || [],
          actuaciones: state.sectorData.actuaciones || [],
          calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
          ubicacion: state.sectorData.ubicacion || "",
        };

        // Convert partidas to EnginePartida for view builders
        const viewItems: EnginePartida[] = finalPartidas.map(p => ({
          ...p,
          chapter: p.chapter || "",
          status: (p.status || "incluida") as "incluida" | "estimada" | "opcional",
        }));
        const viewMaterials: EngineMaterial[] = finalMaterials.map(m => ({
          id: m.id,
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          unit_price: m.unit_price,
          subtotal: m.subtotal,
          included: m.included,
          provider_id: m.provider_id || "referencia-mercado",
          linked_chapter: "", // Will be matched by engine
          isRealData: m.isRealData || false,
          sourceType: m.sourceType || "market_reference",
        }));

        // Rebuild linked_chapter from MATERIAL_SPECS matching
        const engineMats = buildScopeMaterials(viewScope);
        const linkedMaterials = viewMaterials.map((m, idx) => ({
          ...m,
          linked_chapter: engineMats[idx]?.linked_chapter || "",
        }));

        computedClientView = buildClientView(viewScope, viewItems, state.ivaPercent);
        computedInternalView = buildInternalView(viewScope, viewItems, linkedMaterials, state.ivaPercent);

        // ─── Trigger server-side market price resolution (async, non-blocking) ───
        // Runs in background; updates materials with real prices if found.
        // Does NOT block the UI — initial render uses engine estimates.
        const qualityTier: QualityTier = (viewScope.calidad as QualityTier) || "media";
        const location = viewScope.ubicacion || "";
        const priceRequests: PriceRequest[] = linkedMaterials
          .filter(m => m.included)
          .map(m => ({
            materialName: m.name,
            category: m.linked_chapter || "material",
            unit: m.unit,
            quantity: m.quantity,
            qualityTier,
            location,
          }));

        if (priceRequests.length > 0) {
          // Fire-and-forget: resolve market prices in background
          resolveMarketPrices({ materials: priceRequests, location })
            .then(result => {
              if (!result.ok || result.resolved.length === 0) return;
              // Update materials with resolved prices (only if better source)
              setState(prev => {
                const updatedMaterials = prev.materials.map(m => {
                  const rp = result.resolved.find(r =>
                    m.name.toLowerCase().includes(r.normalizedName) ||
                    r.normalizedName.includes(
                      m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                    )
                  );
                  if (rp && rp.selectedPrice > 0 && rp.sourceType !== "estimated") {
                    return {
                      ...m,
                      unit_price: rp.selectedPrice,
                      subtotal: rp.selectedPrice * m.quantity,
                      sourceType: rp.sourceType,
                      isRealData: true,
                    };
                  }
                  return m;
                });
                return { ...prev, materials: updatedMaterials };
              });
            })
            .catch(err => {
              console.warn("[BudgetProvider] Background price resolution failed:", err);
              // Non-fatal — keep engine estimates
            });
        }
      }

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        lastAnalysisHash: currentHash,
        materialsFromAI: finalMaterials.length > 0,
        partidas: finalPartidas.length > 0 ? finalPartidas : prev.partidas,
        materials: finalMaterials.length > 0 ? finalMaterials : prev.materials,
        // Snapshot base inmutable de materiales IA/motor para enriquecimiento por proveedor
        baseAIMaterials: finalMaterials.length > 0 ? finalMaterials.map(m => ({ ...m })) : prev.baseAIMaterials,
        providerOptions: finalProviders.length > 0 ? finalProviders : prev.providerOptions,
        selectedProviderId: finalProviders.length > 0 ? finalProviders[0].id : prev.selectedProviderId,
        endDate: calculatedEndDate || prev.endDate,
        isUndervalued,
        marketAdjustMessage,
        realisticTimeline: engineTimeline,
        clientView: computedClientView,
        internalView: computedInternalView,
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

        // If AI failed or returned nothing, and we're in construction, inject engine fallback
        if (!success && (state.sector === "construccion" || !state.sector)) {
          const isReforma = state.serviceType?.toLowerCase().includes("reforma") || !state.serviceType;
          if (isReforma) {
            toast.info("Aviso", {
              description: "Usando motor de presupuestos local porque el análisis IA no ha respondido."
            });
            const fbScope: BudgetScope = {
              superficie_m2: state.sectorData.superficie_m2 || 80,
              num_banos: state.sectorData.num_banos || 1,
              incluye_cocina: state.sectorData.incluye_cocina ?? true,
              incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
              incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
              estancias: state.sectorData.estancias || [],
              actuaciones: state.sectorData.actuaciones || [],
              calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
              ubicacion: state.sectorData.ubicacion || "",
            };
            const mm = 1 + (state.marginPercent / 100);
            const builtItems = normalizeBudgetItemsToScope(fbScope, [], mm);
            const builtMats = buildScopeMaterials(fbScope);
            const fallbackMaterialsList = builtMats.map(em => ({
              id: em.id, name: em.name, quantity: em.quantity, unit: em.unit,
              unit_price: em.unit_price, subtotal: em.subtotal, included: em.included,
              provider_id: em.provider_id, isRealData: em.isRealData, sourceType: em.sourceType,
            }));
            setState(prev => ({
              ...prev,
              currentStep: prev.currentStep + 1,
              validationError: null,
              partidas: builtItems.map(ep => ({
                id: ep.id, concept: ep.concept, description: ep.description,
                quantity: ep.quantity, unit: ep.unit, category: ep.category, chapter: ep.chapter,
                unit_price: ep.unit_price, subtotal_cost: ep.subtotal_cost,
                unit_price_client: ep.unit_price_client, subtotal_client: ep.subtotal_client,
                status: ep.status,
              })),
              materials: fallbackMaterialsList,
              // Snapshot base inmutable para enriquecimiento por proveedor
              baseAIMaterials: fallbackMaterialsList.map(m => ({ ...m })),
              materialsFromAI: true,
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
                  description: "Usando motor de presupuestos local porque el análisis IA no ha respondido."
                });
                const gScope: BudgetScope = {
                  superficie_m2: state.sectorData.superficie_m2 || 80,
                  num_banos: state.sectorData.num_banos || 1,
                  incluye_cocina: state.sectorData.incluye_cocina ?? true,
                  incluye_ventanas: state.sectorData.incluye_ventanas ?? false,
                  incluye_climatizacion: state.sectorData.incluye_climatizacion ?? false,
                  estancias: state.sectorData.estancias || [],
                  actuaciones: state.sectorData.actuaciones || [],
                  calidad: (state.sectorData.calidad as "basica" | "media" | "alta") || "media",
                  ubicacion: state.sectorData.ubicacion || "",
                };
                const gMM = 1 + (state.marginPercent / 100);
                const gItems = normalizeBudgetItemsToScope(gScope, [], gMM);
                setState(prev => ({
                  ...prev,
                  partidas: gItems.map(ep => ({
                    id: ep.id, concept: ep.concept, description: ep.description,
                    quantity: ep.quantity, unit: ep.unit, category: ep.category, chapter: ep.chapter,
                    unit_price: ep.unit_price, subtotal_cost: ep.subtotal_cost,
                    unit_price_client: ep.unit_price_client, subtotal_client: ep.subtotal_client,
                    status: ep.status,
                  })),
                }));
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
