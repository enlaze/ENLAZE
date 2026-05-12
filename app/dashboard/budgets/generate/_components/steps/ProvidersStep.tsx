"use client";

import React from "react";
import { useBudgetGenerate } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";

export function ProvidersStep() {
  const { state, setSelectedProvider, updateMaterial, setUseSuggestedMaterials } = useBudgetGenerate();
  const { providerOptions, selectedProviderId, materials, useSuggestedMaterials } = state;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <div className="mb-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">Selecciona el proveedor</h2>
            <p className="text-sm text-navy-600 dark:text-zinc-400">
              Escoge un proveedor principal para recalcular automáticamente los costes y márgenes de los materiales.
            </p>
          </div>
          <button className="hidden sm:flex px-4 py-2 bg-white dark:bg-zinc-800 border border-navy-200 dark:border-zinc-700 rounded-lg text-sm font-medium hover:bg-navy-50 dark:hover:bg-zinc-700 transition">
            Comparar proveedores
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {providerOptions.map(provider => {
            const isSelected = selectedProviderId === provider.id;
            return (
              <div 
                key={provider.id}
                onClick={() => setSelectedProvider(provider.id)}
                className={`relative rounded-xl p-4 cursor-pointer transition-all ${
                  isSelected 
                    ? "border-2 border-brand-green bg-brand-green/5 shadow-sm" 
                    : "border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-brand-green/50"
                }`}
              >
                {provider.isRecommended && (
                  <div className="absolute -top-3 -right-3 bg-brand-green text-navy-900 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full shadow-sm">
                    Recomendado
                  </div>
                )}
                {isSelected && (
                  <div className="absolute top-3 right-3 text-brand-green">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                  </div>
                )}
                <h3 className="font-bold text-navy-900 dark:text-white mb-1">{provider.name}</h3>
                <p className="text-xs text-navy-500 dark:text-zinc-400 mb-3 line-clamp-1">{provider.description}</p>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] text-navy-400 dark:text-zinc-500 uppercase tracking-wider">Cesta estimada</div>
                    <span className="text-sm font-bold text-navy-900 dark:text-white">{provider.estimatedPrice.toFixed(2)} €</span>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-navy-400 dark:text-zinc-500 uppercase tracking-wider">{provider.deliveryTime}</div>
                    <span className={`text-xs font-semibold ${
                      provider.stockLevel === 'Alto' ? 'text-brand-green' : 
                      provider.stockLevel === 'Medio' ? 'text-amber-500' : 'text-navy-500'
                    }`}>
                      {provider.stockLevel}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-6 border-t border-navy-100 dark:border-zinc-800">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
            <h3 className="text-lg font-bold text-navy-900 dark:text-white">Selecciona los materiales</h3>
            <div className="flex bg-navy-50 dark:bg-zinc-800 p-1 rounded-lg">
              <button 
                onClick={() => setUseSuggestedMaterials(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${useSuggestedMaterials ? "bg-white dark:bg-zinc-700 shadow-sm text-navy-900 dark:text-white" : "text-navy-500 dark:text-zinc-400 hover:text-navy-700"}`}
              >
                Sugeridos IA
              </button>
              <button 
                onClick={() => setUseSuggestedMaterials(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${!useSuggestedMaterials ? "bg-white dark:bg-zinc-700 shadow-sm text-navy-900 dark:text-white" : "text-navy-500 dark:text-zinc-400 hover:text-navy-700"}`}
              >
                Manual
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-navy-50 dark:bg-zinc-800/50 border-y border-navy-100 dark:border-zinc-800 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="p-3 w-10 text-center">Inc.</th>
                  <th className="p-3">Material</th>
                  <th className="p-3 w-24 text-right">Cant.</th>
                  <th className="p-3 w-20">Ud.</th>
                  <th className="p-3 w-28 text-right">Coste Ud.</th>
                  <th className="p-3 w-28 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                {materials.map((m) => (
                  <tr key={m.id} className={`hover:bg-navy-50/50 dark:hover:bg-zinc-800/50 transition-colors ${!m.included ? 'opacity-50' : ''}`}>
                    <td className="p-3 text-center">
                      <input 
                        type="checkbox" 
                        checked={m.included}
                        onChange={(e) => updateMaterial(m.id, { included: e.target.checked })}
                        className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                      />
                    </td>
                    <td className="p-3">
                      <p className="text-sm font-medium text-navy-900 dark:text-white">{m.name}</p>
                    </td>
                    <td className="p-3">
                      <input 
                        type="number"
                        min="0"
                        step="1"
                        value={m.quantity}
                        onChange={(e) => updateMaterial(m.id, { quantity: parseFloat(e.target.value) || 0 })}
                        disabled={!m.included}
                        className="w-full text-right font-medium text-navy-900 dark:text-white bg-transparent border border-transparent hover:border-navy-200 dark:hover:border-zinc-700 rounded p-1 focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green text-sm disabled:opacity-50"
                      />
                    </td>
                    <td className="p-3 text-sm text-navy-600 dark:text-zinc-400">
                      {m.unit}
                    </td>
                    <td className="p-3 text-right text-sm text-navy-600 dark:text-zinc-400">
                      {m.unit_price.toFixed(2)} €
                    </td>
                    <td className="p-3 text-right font-bold text-navy-900 dark:text-white text-sm">
                      {m.subtotal.toFixed(2)} €
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
