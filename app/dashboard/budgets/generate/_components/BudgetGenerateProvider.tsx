"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { normalizeSector } from "@/lib/sector-config";

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
  selectedProvider: string | null;
  // Totals
  totals: {
    directCost: number;
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
    selectedProvider: null,
    totals: {
      directCost: 0,
      clientPrice: 0,
      profit: 0,
    }
  });

  // Calculate totals whenever partidas or margin change
  useEffect(() => {
    let directCost = 0;
    let clientPrice = 0;
    
    state.partidas.forEach(p => {
      directCost += p.subtotal_cost;
      clientPrice += p.subtotal_client;
    });

    const profit = clientPrice - directCost;

    setState(prev => ({
      ...prev,
      totals: { directCost, clientPrice, profit }
    }));
  }, [state.partidas, state.marginPercent]);

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

  const nextStep = () => setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
  const prevStep = () => setState(prev => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1) }));
  const goToStep = (step: number) => setState(prev => ({ ...prev, currentStep: step }));

  return (
    <BudgetContext.Provider value={{ 
      state, updateState, updateSectorData, nextStep, prevStep, goToStep,
      addPartida, updatePartida, removePartida
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
