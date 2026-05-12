"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import { normalizeSector } from "@/lib/sector-config";
import PageHeader from "@/components/ui/page-header";
import { BudgetGenerateProvider, useBudgetGenerate } from "./_components/BudgetGenerateProvider";
import { GenerateLayout } from "./_components/GenerateLayout";
import { GenerateStepper, StepDef } from "./_components/GenerateStepper";
import { ScopeStep } from "./_components/steps/ScopeStep";
import { ItemsStep } from "./_components/steps/ItemsStep";
import { ProvidersStep } from "./_components/steps/ProvidersStep";
import { createClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";

function DraftRecoveryManager() {
  const { loadDraft, saveDraft, state } = useBudgetGenerate();
  const [drafts, setDrafts] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const supabase = createClient();

  React.useEffect(() => {
    async function check() {
      // Si ya hay un draftId activo en el estado, no mostramos el recovery porque estamos editándolo
      if (state.draftId) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase.from('budgets')
        .select('id, title, updated_at, wizard_state')
        .eq('user_id', user.id)
        .eq('status', 'borrador')
        .order('updated_at', { ascending: false });
        
      if (data && data.length > 0) {
        setDrafts(data);
        setShowModal(true);
      }
    }
    check();
  }, [state.draftId]);

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 border border-navy-100 dark:border-zinc-800 p-6 rounded-2xl w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-xl font-bold text-navy-900 dark:text-white mb-2">Borradores pendientes</h2>
        <p className="text-sm text-navy-500 dark:text-zinc-400 mb-4">
          Hemos encontrado versiones de presupuestos sin terminar. ¿Deseas recuperar alguno o empezar desde cero?
        </p>
        
        <div className="max-h-60 overflow-y-auto mb-6 space-y-2">
          {drafts.map(d => (
            <button 
              key={d.id}
              onClick={() => {
                // Inyectamos el estado crudo tal cual se guardó
                loadDraft(d.wizard_state);
                setShowModal(false);
              }}
              className="w-full text-left p-3 rounded-lg border border-navy-100 dark:border-zinc-800 hover:border-brand-green/50 hover:bg-navy-50 dark:hover:bg-zinc-800 transition group"
            >
              <div className="font-semibold text-navy-900 dark:text-white group-hover:text-brand-green">{d.title || "Presupuesto sin título"}</div>
              <div className="text-xs text-navy-400 dark:text-zinc-500">Última modificación: {new Date(d.updated_at).toLocaleString('es-ES')}</div>
            </button>
          ))}
        </div>
        
        <div className="flex justify-end gap-3 pt-4 border-t border-navy-100 dark:border-zinc-800">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Empezar nuevo</Button>
        </div>
      </div>
    </div>
  );
}

// Separamos el contenido que necesita el contexto en un componente interno
function WizardContent() {
  const { state, saveDraft } = useBudgetGenerate();
  const isConstruction = state.sector === "construccion";

  // Pasos dinámicos por sector
  const steps: StepDef[] = isConstruction ? [
    { id: "scope", label: "Tipo de obra" },
    { id: "items", label: "Partidas" },
    { id: "providers", label: "Proveedor y materiales" },
  ] : [
    { id: "business", label: "Tipo de negocio" },
    { id: "services", label: "Servicios y packs" },
    { id: "equipment", label: "Equipamiento" },
  ];

  const renderStep = () => {
    if (isConstruction) {
      switch (state.currentStep) {
        case 0: return <ScopeStep />;
        case 1: return <ItemsStep />;
        case 2: return <ProvidersStep />;
        default: return <ScopeStep />;
      }
    } else {
      // Placeholder para Retail
      return (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-zinc-900 border border-navy-100 dark:border-zinc-800 rounded-2xl">
          <span className="text-4xl mb-4">🏪</span>
          <h2 className="text-xl font-bold text-navy-900 dark:text-white mb-2">Flujo Retail en construcción</h2>
          <p className="text-navy-500 dark:text-zinc-400 text-center">
            Este sector utilizará una estructura de pasos distinta (Equipamiento, Suscripción, Mantenimiento).
          </p>
        </div>
      );
    }
  };

  return (
    <>
      <DraftRecoveryManager />
      
      <div className="flex justify-between items-center mb-6">
        <GenerateStepper steps={steps} />
        
        <div className="hidden sm:flex gap-2">
          <Button variant="secondary" onClick={() => saveDraft(true)} disabled={!state.draftId && state.currentStep === 0}>
            Guardar borrador
          </Button>
          <Button className="bg-brand-green hover:bg-brand-green/90 text-navy-900 font-bold border-0 shadow-md">
            Finalizar presupuesto
          </Button>
        </div>
      </div>

      <GenerateLayout>
        {renderStep()}
      </GenerateLayout>
    </>
  );
}

export default function GenerateBudgetPage() {
  const { sectorKey } = useSector();

  return (
    <div className="mx-auto w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <Link
          href="/dashboard/budgets"
          className="text-sm text-navy-500 hover:text-brand-green mb-3 inline-block dark:text-zinc-400"
        >
          ← Volver a presupuestos
        </Link>
        <PageHeader
          title="Generador de presupuestos (Pro)"
          description="Asistente interactivo conectado a mercado real y sugerencias de IA."
        />
      </div>

      <BudgetGenerateProvider initialSector={sectorKey}>
        <WizardContent />
      </BudgetGenerateProvider>
    </div>
  );
}
