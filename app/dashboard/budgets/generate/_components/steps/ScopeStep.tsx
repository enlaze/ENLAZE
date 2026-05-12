"use client";

import React from "react";
import { useBudgetGenerate } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";

export function ScopeStep() {
  const { state, updateState } = useBudgetGenerate();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <h2 className="text-xl font-bold text-navy-900 dark:text-white mb-4">Alcance del proyecto</h2>
        <p className="text-sm text-navy-600 dark:text-zinc-400 mb-6">
          Define el tipo de proyecto y el nivel de calidad deseado. La IA utilizará esto para sugerir partidas y materiales.
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1">Descripción general</label>
            <textarea 
              className="w-full bg-white dark:bg-zinc-900 border border-navy-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green outline-none min-h-[100px]"
              placeholder="Ej: Reforma integral de piso de 80m2 con cambio de distribución..."
              value={state.description}
              onChange={(e) => updateState({ description: e.target.value })}
            />
          </div>
        </div>
      </Card>
      
      {/* Placeholder para más campos de alcance (Estancias, calidades, etc) */}
      <Card>
        <div className="flex items-center justify-center p-8 border-2 border-dashed border-navy-100 dark:border-zinc-800 rounded-xl">
          <p className="text-navy-500 dark:text-zinc-500 text-sm">Próximamente: Selector visual de estancias y calidades</p>
        </div>
      </Card>
    </div>
  );
}
