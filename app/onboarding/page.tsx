"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import {
  recordLegalAcceptance,
  recordMarketingConsent,
} from "@/lib/activity-log";
import { useToast } from "@/components/ui/toast";
import { SECTOR_OPTIONS } from "@/lib/sectors";
import SectorIcon from "@/components/SectorIcon";
import { analytics } from "@/lib/analytics";

const sectors = SECTOR_OPTIONS;

const TERMS_VERSION = "v1.0";
const PRIVACY_VERSION = "v1.0";

const PROGRESS_KEY = "enlaze:onboarding-progress:v1";

type SavedProgress = {
  step: number;
  selectedSector: string;
  customSector: string;
  businessName: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing: boolean;
};

export default function OnboardingPage() {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [selectedSector, setSelectedSector] = useState("");
  const [customSector, setCustomSector] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");

  // Legal & consent state (Step 3)
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(false);

  // Progress is restored from sessionStorage after mount (not in a useState
  // initializer) so the server-rendered HTML and the first client render match.
  // Until then we render nothing below the logo, to avoid flashing step 1.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
    });
  }, []);

  // Restore progress. Leaving the page (e.g. opening the legal links, which are
  // plain <a href> full page loads) otherwise throws away every answer.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedProgress>;
        if (saved.step === 1 || saved.step === 2 || saved.step === 3) setStep(saved.step);
        if (typeof saved.selectedSector === "string") setSelectedSector(saved.selectedSector);
        if (typeof saved.customSector === "string") setCustomSector(saved.customSector);
        if (typeof saved.businessName === "string") setBusinessName(saved.businessName);
        if (typeof saved.acceptTerms === "boolean") setAcceptTerms(saved.acceptTerms);
        if (typeof saved.acceptPrivacy === "boolean") setAcceptPrivacy(saved.acceptPrivacy);
        if (typeof saved.acceptMarketing === "boolean") setAcceptMarketing(saved.acceptMarketing);
      }
    } catch {
      // Corrupt or unavailable storage (private mode, quota): start clean.
    }
    setRestored(true);
  }, []);

  // Persist on every change, but only once restored, or the first run would
  // overwrite the saved progress with the empty defaults.
  useEffect(() => {
    if (!restored) return;
    try {
      const progress: SavedProgress = {
        step,
        selectedSector,
        customSector,
        businessName,
        acceptTerms,
        acceptPrivacy,
        acceptMarketing,
      };
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Storage unavailable: progress just won't survive a reload.
    }
  }, [restored, step, selectedSector, customSector, businessName, acceptTerms, acceptPrivacy, acceptMarketing]);

  async function handleComplete() {
    if (!selectedSector || !acceptTerms || !acceptPrivacy) return;
    setSaving(true);

    const sector = selectedSector === "otro" ? customSector || "otro" : selectedSector;

    const { error } = await supabase
      .from("profiles")
      .update({
        business_sector: sector,
        business_name: businessName,
        onboarding_completed: true,
      })
      .eq("id", userId);

    if (error) {
      toast.error("No se pudo guardar tu sector", { description: error.message });
      setSaving(false);
      return;
    }

    // Track onboarding completion
    analytics.onboardingCompleted(sector, businessName);

    // Record legal acceptances (fire-and-forget, never blocks)
    await Promise.allSettled([
      recordLegalAcceptance(supabase, "terms", TERMS_VERSION),
      recordLegalAcceptance(supabase, "privacy", PRIVACY_VERSION),
      recordMarketingConsent(supabase, "email_marketing", acceptMarketing, "onboarding"),
    ]);

    try {
      sessionStorage.removeItem(PROGRESS_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }

    router.push("/dashboard");
  }

  const canFinish = acceptTerms && acceptPrivacy;

  return (
    <div className="min-h-screen bg-[var(--color-navy-950)] flex items-center justify-center p-4">
      <div className="max-w-3xl w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-[var(--color-navy-50)]">
            enla<span className="text-[var(--color-brand-green)]">z</span>e
          </h1>
          {restored && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className={"h-2 rounded-full transition-all " + (step >= 1 ? "bg-[var(--color-brand-green)] w-12" : "bg-[var(--color-navy-700)] w-8")}></div>
              <div className={"h-2 rounded-full transition-all " + (step >= 2 ? "bg-[var(--color-brand-green)] w-12" : "bg-[var(--color-navy-700)] w-8")}></div>
              <div className={"h-2 rounded-full transition-all " + (step >= 3 ? "bg-[var(--color-brand-green)] w-12" : "bg-[var(--color-navy-700)] w-8")}></div>
            </div>
          )}
        </div>

        {/* Step 1: Sector Selection */}
        {restored && step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-[var(--color-navy-50)] text-center mb-2">
              ¿A qué se dedica tu negocio?
            </h2>
            <p className="text-[var(--color-navy-400)] text-center mb-8 text-sm">
              Selecciona tu sector y configuraremos los agentes IA especializados para ti
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sectors.map((sector) => (
                <button
                  key={sector.id}
                  onClick={() => setSelectedSector(sector.id)}
                  className={"p-4 rounded-xl border-2 text-left transition-all " + (
                    selectedSector === sector.id
                      ? "border-[var(--color-brand-green)] bg-[var(--color-brand-green)]/10"
                      : "border-[var(--color-navy-700)] bg-[var(--color-navy-800)] hover:border-[var(--color-navy-500)]"
                  )}
                >
                  <div className={"mb-2 " + (
                    selectedSector === sector.id
                      ? "text-[var(--color-brand-green)]"
                      : "text-[var(--color-navy-300)]"
                  )}>
                    <SectorIcon id={sector.id} size={26} />
                  </div>
                  <p className="font-semibold text-[var(--color-navy-100)] text-sm">{sector.name}</p>
                  <p className="text-xs text-[var(--color-navy-400)] mt-1">{sector.desc}</p>
                </button>
              ))}
            </div>

            {selectedSector === "otro" && (
              <div className="mt-4">
                <input
                  type="text"
                  value={customSector}
                  onChange={(e) => setCustomSector(e.target.value)}
                  placeholder="Describe tu sector..."
                  className="w-full bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-3 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={() => { if (selectedSector) { analytics.onboardingSectorSelected(selectedSector); setStep(2); } }}
              disabled={!selectedSector}
              className="mt-6 w-full bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-30"
            >
              Continuar
            </button>
          </div>
        )}

        {/* Step 2: Business Details */}
        {restored && step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-[var(--color-navy-50)] text-center mb-2">
              Cuéntanos más sobre tu negocio
            </h2>
            <p className="text-[var(--color-navy-400)] text-center mb-8 text-sm">
              Esta información ayuda a los agentes IA a personalizar su trabajo
            </p>

            <div className="bg-[var(--color-navy-800)] rounded-xl p-6 space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-navy-300)] mb-2">Nombre de tu empresa o negocio</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ej: Reformas García S.L."
                  className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-3 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none"
                />
              </div>

              <div className="bg-[var(--color-navy-700)] rounded-lg p-4">
                <p className="text-sm font-medium text-[var(--color-navy-200)] mb-2">Lo que configuraremos para ti:</p>
                <div className="space-y-2 text-sm text-[var(--color-navy-400)]">
                  <p>✅ Agente IA especializado en tu sector</p>
                  <p>✅ Banco de precios adaptado a tu actividad</p>
                  <p>✅ Plantillas de presupuestos profesionales</p>
                  <p>✅ Normativas y regulaciones de tu sector</p>
                  <p>✅ Actualizaciones automáticas de precios de mercado</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-xl hover:bg-[var(--color-navy-600)] transition"
              >
                Atrás
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Legal Acceptance & Marketing Consent */}
        {restored && step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-[var(--color-navy-50)] text-center mb-2">
              Términos y consentimientos
            </h2>
            <p className="text-[var(--color-navy-400)] text-center mb-8 text-sm">
              Para continuar necesitamos que aceptes nuestros términos legales
            </p>

            <div className="bg-[var(--color-navy-800)] rounded-xl p-6 space-y-5">
              {/* Terms of Service — required */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-[var(--color-navy-500)] bg-[var(--color-navy-700)] text-[var(--color-brand-green)] accent-[var(--color-brand-green)] flex-shrink-0"
                />
                <span className="text-sm text-[var(--color-navy-200)] group-hover:text-[var(--color-navy-50)] transition">
                  Acepto los{" "}
                  <a
                    href="/legal/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] underline hover:opacity-80"
                  >
                    Términos y Condiciones de Uso
                  </a>
                  <span className="text-red-400 ml-1">*</span>
                </span>
              </label>

              {/* Privacy Policy — required */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={acceptPrivacy}
                  onChange={(e) => setAcceptPrivacy(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-[var(--color-navy-500)] bg-[var(--color-navy-700)] text-[var(--color-brand-green)] accent-[var(--color-brand-green)] flex-shrink-0"
                />
                <span className="text-sm text-[var(--color-navy-200)] group-hover:text-[var(--color-navy-50)] transition">
                  He leído y acepto la{" "}
                  <a
                    href="/legal/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] underline hover:opacity-80"
                  >
                    Política de Privacidad
                  </a>
                  <span className="text-red-400 ml-1">*</span>
                </span>
              </label>

              <div className="border-t border-[var(--color-navy-700)] pt-4">
                <p className="text-xs text-[var(--color-navy-500)] mb-3">Consentimiento opcional</p>

                {/* Marketing consent — optional */}
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={acceptMarketing}
                    onChange={(e) => setAcceptMarketing(e.target.checked)}
                    className="mt-1 h-5 w-5 rounded border-[var(--color-navy-500)] bg-[var(--color-navy-700)] text-[var(--color-brand-green)] accent-[var(--color-brand-green)] flex-shrink-0"
                  />
                  <span className="text-sm text-[var(--color-navy-200)] group-hover:text-[var(--color-navy-50)] transition">
                    Acepto recibir comunicaciones comerciales, novedades y ofertas de Enlaze por email.
                    Puedes darte de baja en cualquier momento desde los ajustes de tu cuenta.
                  </span>
                </label>
              </div>

              <p className="text-xs text-[var(--color-navy-500)]">
                <span className="text-red-400">*</span> Campos obligatorios
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-xl hover:bg-[var(--color-navy-600)] transition"
              >
                Atrás
              </button>
              <button
                onClick={handleComplete}
                disabled={saving || !canFinish}
                className="flex-1 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-30"
              >
                {saving ? "Configurando tu espacio..." : "Empezar a usar Enlaze"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
