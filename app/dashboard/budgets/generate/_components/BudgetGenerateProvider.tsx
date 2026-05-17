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
    selectedProviderId: "leroy",
    providerOptions: [
      { id: "leroy", name: "Leroy Merlin", description: "Materiales de construcción y reforma", estimatedPrice: 1250, deliveryTime: "24-48h", stockLevel: "Alto", rating: 4.8, isRecommended: true, isRealData: false, materialsCount: 5 },
      { id: "obramat", name: "Obramat", description: "Almacén profesional", estimatedPrice: 1180, deliveryTime: "48-72h", stockLevel: "Medio", rating: 4.5, isRealData: false, materialsCount: 5 },
      { id: "local", name: "Proveedor Local", description: "Distribuidores de zona", estimatedPrice: 1320, deliveryTime: "A consultar", stockLevel: "A consultar", rating: 4.0, isRealData: false, materialsCount: 5 },
    ],
    materials: [
      { id: "m1", name: "Azulejo porcelánico 60x60cm", quantity: 26, unit: "m2", unit_price: 18.5, subtotal: 481, included: true, provider_id: "leroy", isRealData: false },
      { id: "m2", name: "Cemento cola porcelánico", quantity: 5, unit: "sacos", unit_price: 12.0, subtotal: 60, included: true, provider_id: "leroy", isRealData: false },
      { id: "m3", name: "Pintura plástica blanca mate", quantity: 2, unit: "cubos 15L", unit_price: 35.0, subtotal: 70, included: true, provider_id: "leroy", isRealData: false },
      { id: "m4", name: "Cableado eléctrico libre halógenos", quantity: 1, unit: "rollo 100m", unit_price: 45.0, subtotal: 45, included: true, provider_id: "leroy", isRealData: false },
      { id: "m5", name: "Plato de ducha resina 120x70", quantity: 1, unit: "ud", unit_price: 180.0, subtotal: 180, included: true, provider_id: "leroy", isRealData: false },
    ],
    allFetchedMaterials: [],
    useSuggestedMaterials: true,
    isRealDataMode: false,
    totals: {
      directCost: 0,
      materialsCost: 0,
      clientPrice: 0,
      profit: 0,
    }
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
          const rawName = item.supplier_name || item.source || item.provider || item.provider_name || item.supplier || (item.metadata?.source);
          if (!rawName || typeof rawName !== 'string' || rawName.trim() === "") return "Proveedor Genérico";
          
          const upper = rawName.trim().toUpperCase();
          if (activeSector === "construccion") {
            if (upper.includes("LEROY") || upper.includes("MERLIN")) return "Leroy Merlin";
            if (upper.includes("OBRAMAT") || upper.includes("BRICOMART")) return "Obramat";
            if (upper.includes("SALTOKI")) return "Saltoki";
            if (upper.includes("CYPE")) return "CYPE / Banco de precios";
            if (upper.includes("MERCADO") || upper.includes("REFERENCIA")) return "Referencia mercado";
          }
          return rawName.trim();
        }

        // Initialize with existing mock options so they don't disappear if real data only has "generic" items
        const providersMap = new Map<string, ProviderOption>();
        state.providerOptions.forEach(p => {
          providersMap.set(p.id, { ...p, materialsCount: 0 });
        });

        const realMaterials: Material[] = [];

        data.forEach(item => {
          const normName = normalizeSupplierName(item);
          const provId = normName === "Proveedor Genérico" ? "generic" : normName === "Referencia mercado" ? "market" : normName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          
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
              isRealData: true
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
            isRealData: true
          });

          // Update counts and estimated basket price for this provider
          const p = providersMap.get(provId)!;
          p.materialsCount! += 1;
          p.estimatedPrice += (item.unit_price || 0); // initial 1 ud estimation
        });

        const newProviderOptions = Array.from(providersMap.values());
        if (newProviderOptions.length === 0) return;

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
    // Skip if we just loaded a draft that has its own material list visible already
    if (!state.selectedProviderId) return;
    
    if (state.isRealDataMode) {
      const newVisible = state.allFetchedMaterials.filter(m => m.provider_id === state.selectedProviderId);
      // Only set if different length to prevent loop re-renders
      if (state.materials.length === 0 || state.materials[0]?.provider_id !== state.selectedProviderId) {
        setState(prev => ({ ...prev, materials: newVisible }));
      }
    } else {
      // Mock logic
      const multiplier = state.selectedProviderId === "obramat" ? 0.9 : state.selectedProviderId === "local" ? 1.1 : 1.0;
      if (state.materials.length > 0 && state.materials[0]?.provider_id === state.selectedProviderId) return;

      setState(prev => {
        const newMaterials = prev.materials.map(m => {
          const basePrice = m.id === "m1" ? 18.5 : m.id === "m2" ? 12.0 : m.id === "m3" ? 35.0 : m.id === "m4" ? 45.0 : 180.0;
          const newUnitPrice = basePrice * multiplier;
          return {
            ...m,
            unit_price: newUnitPrice,
            subtotal: m.quantity * newUnitPrice,
            provider_id: state.selectedProviderId!
          };
        });
        return { ...prev, materials: newMaterials };
      });
    }
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

  const nextStep = () => {
    if (!validateStep(state.currentStep)) return;
    
    // Inject construction fallback items if moving to step 1 and items are default
    if (state.currentStep === 0 && (state.sector === "construccion" || !state.sector)) {
      const isReforma = state.serviceType?.toLowerCase().includes("reforma") || !state.serviceType;
      const isDefaultPartidas = state.partidas.length === 0 || (state.partidas.length === 2 && state.partidas[0].id === "example-1");
      if (isReforma && isDefaultPartidas) {
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

    setState(prev => ({ ...prev, currentStep: prev.currentStep + 1, validationError: null }));
    saveDraft(false); // Force save on step change
  };
  const prevStep = () => setState(prev => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1), validationError: null }));
  const goToStep = (step: number) => {
    if (step > state.currentStep) {
      for (let i = state.currentStep; i < step; i++) {
        if (!validateStep(i)) return;
      }
    }
    setState(prev => ({ ...prev, currentStep: step, validationError: null }));
  };

  return (
    <BudgetContext.Provider value={{ 
      state, updateState, updateSectorData, nextStep, prevStep, goToStep,
      addPartida, updatePartida, removePartida,
      setSelectedProvider, updateMaterial, setUseSuggestedMaterials,
      saveDraft, loadDraft, finalizeBudget
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
