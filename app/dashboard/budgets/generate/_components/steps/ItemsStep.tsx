"use client";

import React, { useState, useCallback } from "react";
import { useBudgetGenerate, Partida } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function ItemsStep() {
  const { state, addPartida, updatePartida, removePartida, analyzeWithAI } = useBudgetGenerate();
  const { partidas } = state;

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = () => {
    addPartida({ concept: "Nueva partida", quantity: 1, unit_price: 0 });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card padding={false} className="overflow-hidden">
        <div className="p-6 border-b border-navy-100 dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900">
          <div>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">Constructor de Partidas</h2>
            <p className="text-sm text-navy-600 dark:text-zinc-400">Desglosa los trabajos y materiales</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleAdd}
              className="px-4 py-2 bg-white dark:bg-zinc-800 border border-navy-200 dark:border-zinc-700 rounded-lg text-sm font-medium hover:bg-navy-50 dark:hover:bg-zinc-700 transition"
            >
              + Añadir partida
            </button>
            <button 
              onClick={() => analyzeWithAI(true)}
              disabled={state.isAnalyzing}
              className="hidden sm:flex px-4 py-2 bg-brand-green/20 text-brand-green border border-brand-green/30 rounded-lg text-sm font-bold items-center gap-2 hover:bg-brand-green/30 transition disabled:opacity-50"
            >
              {state.isAnalyzing ? "✨ Regenerando propuesta con IA..." : "✨ Generar con IA"}
            </button>
          </div>
        </div>
        
        {partidas.length === 0 ? (
          <div className="text-center py-12 bg-navy-50 dark:bg-zinc-900/50">
            <span className="text-4xl mb-3 block">🏗️</span>
            <h3 className="text-lg font-bold text-navy-900 dark:text-white">Aún no hay partidas</h3>
            <p className="text-sm text-navy-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
              Añade partidas manualmente o usa la IA para generarlas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-navy-50 dark:bg-zinc-800/50 border-b border-navy-100 dark:border-zinc-800 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="p-4 w-1/3">Concepto y Descripción</th>
                  <th className="p-4 w-24">Estado</th>
                  <th className="p-4 w-24 text-right">Cant.</th>
                  <th className="p-4 w-20">Ud.</th>
                  <th className="p-4 w-28 text-right">Coste Ud.</th>
                  <th className="p-4 w-32 text-right">Subtotal</th>
                  <th className="p-4 w-16 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                {partidas.map((p) => (
                  <tr key={p.id} className="hover:bg-navy-50/50 dark:hover:bg-zinc-800/50 transition-colors group">
                    <td className="p-4">
                      <input 
                        type="text" 
                        value={p.concept}
                        onChange={(e) => updatePartida(p.id, { concept: e.target.value })}
                        className="w-full font-semibold text-navy-900 dark:text-white bg-transparent border-none p-0 focus:ring-0 text-sm"
                        placeholder="Nombre de la partida"
                      />
                      <input 
                        type="text"
                        value={p.description}
                        onChange={(e) => updatePartida(p.id, { description: e.target.value })}
                        className="w-full text-xs text-navy-500 dark:text-zinc-400 bg-transparent border-none p-0 focus:ring-0 mt-1"
                        placeholder="Descripción detallada..."
                      />
                    </td>
                    <td className="p-4">
                      <select 
                        value={p.status}
                        onChange={(e) => updatePartida(p.id, { status: e.target.value as any })}
                        className={`text-xs font-medium bg-transparent border-none p-0 focus:ring-0 cursor-pointer ${
                          p.status === 'opcional' ? 'text-amber-500' : 
                          p.status === 'estimada' ? 'text-blue-500' : 
                          'text-brand-green'
                        }`}
                      >
                        <option value="incluida" className="text-navy-900">Incluida</option>
                        <option value="opcional" className="text-navy-900">Opcional</option>
                        <option value="estimada" className="text-navy-900">Estimada</option>
                      </select>
                    </td>
                    <td className="p-4">
                      <input 
                        type="number"
                        min="0"
                        step="0.01"
                        value={p.quantity}
                        onChange={(e) => updatePartida(p.id, { quantity: parseFloat(e.target.value) || 0 })}
                        className="w-full text-right font-medium text-navy-900 dark:text-white bg-transparent border border-transparent hover:border-navy-200 dark:hover:border-zinc-700 rounded p-1 focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green text-sm"
                      />
                    </td>
                    <td className="p-4">
                      <input 
                        type="text"
                        value={p.unit}
                        onChange={(e) => updatePartida(p.id, { unit: e.target.value })}
                        className="w-full text-navy-600 dark:text-zinc-400 bg-transparent border border-transparent hover:border-navy-200 dark:hover:border-zinc-700 rounded p-1 focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green text-sm"
                      />
                    </td>
                    <td className="p-4">
                      <div className="relative flex items-center">
                        <input 
                          type="number"
                          min="0"
                          step="0.01"
                          value={p.unit_price}
                          onChange={(e) => updatePartida(p.id, { unit_price: parseFloat(e.target.value) || 0 })}
                          className="w-full text-right font-medium text-navy-900 dark:text-white bg-transparent border border-transparent hover:border-navy-200 dark:hover:border-zinc-700 rounded p-1 pr-4 focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green text-sm"
                        />
                        <span className="absolute right-0 text-navy-400 text-xs pointer-events-none">€</span>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-navy-900 dark:text-white block">
                        {p.subtotal_cost.toFixed(2)} €
                      </span>
                      <span className="text-[10px] text-navy-400 dark:text-zinc-500 block uppercase tracking-wider mt-0.5">
                        PVP: {p.subtotal_client.toFixed(2)} €
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => removePartida(p.id)}
                        className="text-navy-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                        title="Eliminar partida"
                      >
                        <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
