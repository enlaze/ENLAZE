"use client";

import React, { useState } from "react";
import Link from "next/link";
import { PartyPopper } from "lucide-react";
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
import { Button, LinkButton } from "@/components/ui/button";
import { generateBudgetPDFHTML, printPDF } from "@/lib/pdf-generator";
import { analytics } from "@/lib/analytics";

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
                analytics.budgetDraftRecovered();
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
  const { state, saveDraft, finalizeBudget } = useBudgetGenerate();
  const [finalizedId, setFinalizedId] = useState<string | null>(null);
  const [exportingPDF, setExportingPDF] = useState<'client' | 'internal' | null>(null);
  const supabase = createClient();

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

  const handleFinalize = async () => {
    const id = await finalizeBudget();
    if (id) {
      setFinalizedId(id);
    }
  };

  const handleExportPDF = async (mode: 'client' | 'internal') => {
    // Usamos el presupuesto ya guardado en Supabase (no el estado en memoria del
    // wizard) para que la salida sea idéntica a la del flujo clásico: mismos
    // campos nuevos (anticipo, IBAN, garantía, plazo, observaciones, condiciones)
    // y mismos datos de empresa.
    if (!finalizedId) return;
    setExportingPDF(mode);
    try {
      const [{ data: budget }, { data: items }, { data: profile }, { data: fiscal }] = await Promise.all([
        supabase.from("budgets").select("*").eq("id", finalizedId).maybeSingle(),
        supabase.from("budget_items").select("*").eq("budget_id", finalizedId).order("created_at", { ascending: true }),
        supabase.from("profiles").select("business_name, full_name, logo_url").maybeSingle(),
        supabase.from("fiscal_settings").select("*").maybeSingle(),
      ]);

      if (!budget) return;

      const html = generateBudgetPDFHTML(
        {
          ...budget,
          company_name: profile?.business_name || profile?.full_name || "",
          company_logo_url: profile?.logo_url || "",
          company_nif: (fiscal as { nif?: string; cif?: string } | null)?.nif || (fiscal as { nif?: string; cif?: string } | null)?.cif || "",
          company_address: (fiscal as { address?: string; fiscal_address?: string } | null)?.address || (fiscal as { address?: string; fiscal_address?: string } | null)?.fiscal_address || "",
          company_phone: (fiscal as { phone?: string } | null)?.phone || "",
          company_email: (fiscal as { email?: string } | null)?.email || "",
        },
        (items || []).map(i => ({ ...i, subtotal_cost: 0 })),
        mode
      );
      analytics.budgetExportedPDF(mode);
      printPDF(html);
    } finally {
      setExportingPDF(null);
    }
  };

  if (finalizedId) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-zinc-900 border border-brand-green/30 rounded-2xl animate-in fade-in zoom-in-95 mt-8 shadow-sm">
        <div className="w-20 h-20 bg-brand-green/20 rounded-full flex items-center justify-center mb-6">
          <PartyPopper className="h-9 w-9 text-[#00c896]" />
        </div>
        <h2 className="text-2xl font-bold text-navy-900 dark:text-white mb-2">¡Presupuesto Finalizado!</h2>
        <p className="text-navy-600 dark:text-zinc-400 text-center max-w-md mb-8">
          Tu presupuesto ha sido guardado oficialmente. Puedes visualizarlo en el panel estándar o exportar el PDF ahora mismo.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <LinkButton href={`/dashboard/budgets/${finalizedId}`} className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-zinc-800 dark:hover:bg-zinc-700">
            Abrir presupuesto clásico
          </LinkButton>
          <Button variant="secondary" onClick={() => handleExportPDF('client')} disabled={exportingPDF !== null}>
            {exportingPDF === 'client' ? "Generando..." : "Exportar PDF Cliente"}
          </Button>
          <Button variant="secondary" onClick={() => handleExportPDF('internal')} disabled={exportingPDF !== null} className="border-brand-green/50 text-brand-green hover:bg-brand-green/10">
            {exportingPDF === 'internal' ? "Generando..." : "Exportar PDF Interno"}
          </Button>
        </div>
      </div>
    );
  }

  const renderStep = () => {
    if (isConstruction) {
      switch (state.currentStep) {
        case 0: return <ScopeStep />;
        case 1: return <ItemsStep />;
        case 2: return <ProvidersStep />;
        default: return <ScopeStep />;
      }
    }
    // Non-construction sectors never reach this component: the budgets segment
    // guard (app/dashboard/budgets/layout.tsx) redirects them to /dashboard.
    // The old "Flujo Retail en construcción" placeholder is gone by design.
    return null;
  };

  return (
    <>
      <DraftRecoveryManager />
      
      <div className="flex justify-between items-center mb-6">
        <GenerateStepper steps={steps} />
        
        <div className={`hidden sm:flex gap-3 items-center ${state.isFinalizing ? 'opacity-50 pointer-events-none' : ''}`}>
          {state.lastSavedAt && (
            <span className="text-xs text-navy-400 dark:text-zinc-500 font-medium">
              Guardado a las {state.lastSavedAt}
            </span>
          )}
          {state.saveError && (
            <span className="text-xs text-red-500 font-medium max-w-[200px] truncate" title={state.saveError}>
              Error: {state.saveError}
            </span>
          )}
          <Button variant="secondary" onClick={() => saveDraft(true)} disabled={state.isSavingDraft}>
            {state.isSavingDraft ? "Guardando..." : "Guardar borrador"}
          </Button>
          <Button
            className="bg-brand-green hover:bg-brand-green/90 text-navy-900 font-bold border-0 shadow-md"
            onClick={handleFinalize}
            disabled={state.isFinalizing || state.partidas.length === 0 || !state.title}
            title={!state.title ? "Completa el titulo en el Paso 1" : state.partidas.length === 0 ? "Añade al menos una partida" : ""}
          >
            {state.isFinalizing ? "Finalizando..." : "Finalizar presupuesto"}
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
  // Comercio_local is redirected to /dashboard by the budgets segment guard
  // (app/dashboard/budgets/layout.tsx), so the wizard and the old "en
  // construcción" placeholder are never reached outside construction.

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
