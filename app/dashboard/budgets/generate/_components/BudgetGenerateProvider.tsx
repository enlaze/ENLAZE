"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { normalizeSector } from "@/lib/sector-config";
import { createClient } from "@/lib/supabase-browser";

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
}

export interface BudgetState {
  currentStep: number;
  sector: string;
  // Common Data
  clientId: string;
  projectId: string;
  description: string;
  ivaPercent: number;
  marginPercent: number;
  // Dynamic Sector Data
  sectorData: Record<string, any>;
  // Partidas
  partidas: Partida[];
  // Provider Data
  selectedProviderId: string | null;
  providerOptions: ProviderOption[];
  materials: Material[];
  useSuggestedMaterials: boolean;
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
}

const BudgetContext = createContext<BudgetContextProps | undefined>(undefined);

export function BudgetGenerateProvider({ 
  children, 
  initialSector = "construccion" 
}: { 
  children: ReactNode;
  initialSector?: string;
}) {
  const [state, setState] = useState<BudgetState>({
    currentStep: 0,
    sector: normalizeSector(initialSector),
    clientId: "",
    projectId: "",
    description: "",
    ivaPercent: 21,
    marginPercent: 20,
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
      { id: "leroy", name: "Leroy Merlin", description: "Materiales de construcción y reforma", estimatedPrice: 1250, deliveryTime: "24-48h", stockLevel: "Alto", rating: 4.8, isRecommended: true },
      { id: "obramat", name: "Obramat", description: "Almacén profesional", estimatedPrice: 1180, deliveryTime: "48-72h", stockLevel: "Medio", rating: 4.5 },
      { id: "local", name: "Proveedor Local", description: "Distribuidores de zona", estimatedPrice: 1320, deliveryTime: "A consultar", stockLevel: "A consultar", rating: 4.0 },
    ],
    materials: [
      { id: "m1", name: "Azulejo porcelánico 60x60cm", quantity: 26, unit: "m2", unit_price: 18.5, subtotal: 481, included: true, provider_id: "leroy" },
      { id: "m2", name: "Cemento cola porcelánico", quantity: 5, unit: "sacos", unit_price: 12.0, subtotal: 60, included: true, provider_id: "leroy" },
      { id: "m3", name: "Pintura plástica blanca mate", quantity: 2, unit: "cubos 15L", unit_price: 35.0, subtotal: 70, included: true, provider_id: "leroy" },
      { id: "m4", name: "Cableado eléctrico libre halógenos", quantity: 1, unit: "rollo 100m", unit_price: 45.0, subtotal: 45, included: true, provider_id: "leroy" },
      { id: "m5", name: "Plato de ducha resina 120x70", quantity: 1, unit: "ud", unit_price: 180.0, subtotal: 180, included: true, provider_id: "leroy" },
    ],
    useSuggestedMaterials: true,
    totals: {
      directCost: 0,
      materialsCost: 0,
      clientPrice: 0,
      profit: 0,
    }
  });

  // HYDRATE WITH REAL DATA (Fase 4.1)
  useEffect(() => {
    if (state.sector !== "construccion") return;

    let mounted = true;
    const fetchRealData = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from("price_items")
          .select("id, name, unit, unit_price, supplier_name")
          .eq("user_id", user.id)
          .eq("sector", "construccion")
          .eq("category", "material")
          .eq("is_active", true)
          .limit(30); // Limitar para el subconjunto sugerido inicial

        if (error || !data || data.length === 0) return; // Fallback to mock

        if (!mounted) return;

        // Normalization logic for providers
        function normalizeSupplierName(name: string | null | undefined): string {
          if (!name || name.trim() === "") return "Proveedor Genérico";
          const upper = name.trim().toUpperCase();
          if (upper.includes("LEROY")) return "Leroy Merlin";
          if (upper.includes("OBRAMAT") || upper.includes("BRICOMART")) return "Obramat";
          if (upper.includes("SALTOKI")) return "Saltoki";
          return name.trim();
        }

        const providersMap = new Map<string, ProviderOption>();
        const realMaterials: Material[] = [];

        data.forEach(item => {
          const normName = normalizeSupplierName(item.supplier_name);
          const provId = normName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          
          if (!providersMap.has(provId)) {
            providersMap.set(provId, {
              id: provId,
              name: normName,
              description: normName === "Proveedor Genérico" ? "Materiales sin asignar" : "Catálogo propio",
              estimatedPrice: 0, // Derive below if needed
              deliveryTime: "Consultar",
              stockLevel: "A consultar",
              rating: 4.5,
              isRecommended: normName === "Leroy Merlin" || normName === "Obramat"
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
            provider_id: provId
          });
        });

        const newProviderOptions = Array.from(providersMap.values());
        if (newProviderOptions.length === 0) return;

        setState(prev => ({
          ...prev,
          providerOptions: newProviderOptions,
          selectedProviderId: newProviderOptions[0].id,
          materials: realMaterials
        }));

      } catch (err) {
        console.error("[BudgetGenerateProvider] Error fetching real prices:", err);
      }
    };

    fetchRealData();
    return () => { mounted = false; };
  }, [state.sector]);

  // Recalculate materials when provider changes (Mock Logic for V1)
  useEffect(() => {
    if (!state.selectedProviderId) return;
    
    // Simulate fetching different prices based on provider
    const multiplier = state.selectedProviderId === "obramat" ? 0.9 : state.selectedProviderId === "local" ? 1.1 : 1.0;
    
    setState(prev => {
      const newMaterials = prev.materials.map(m => {
        // Mock: just change the price slightly to show interactivity
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
  }, [state.selectedProviderId]);

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

  const nextStep = () => setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
  const prevStep = () => setState(prev => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1) }));
  const goToStep = (step: number) => setState(prev => ({ ...prev, currentStep: step }));

  return (
    <BudgetContext.Provider value={{ 
      state, updateState, updateSectorData, nextStep, prevStep, goToStep,
      addPartida, updatePartida, removePartida,
      setSelectedProvider, updateMaterial, setUseSuggestedMaterials
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
