"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { useSector } from "@/lib/sector-context";
import { useToast } from "@/components/ui/toast";
import BackButton from "@/components/ui/back-button";
import { SECTOR_OPTIONS, normalizeSectorId } from "@/lib/sectors";

/**
 * Map a granular sector id (from SECTOR_OPTIONS) to the coarse `sector_config.sector_key`
 * used by the price-bank / module layout system. Keeps fiscal_settings in sync after the
 * unification (única fuente de verdad = profiles.business_sector).
 */
function coarseSectorKey(granular: string): string {
  switch (granular) {
    case "construccion":
      return "construccion";
    case "comercio":
      return "comercio";
    default:
      return "servicios";
  }
}

export default function SectorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { sectorKey, reload } = useSector();
  const toast = useToast();

  const [selected, setSelected] = useState<string>(normalizeSectorId(sectorKey));
  const [initial, setInitial] = useState<string>(normalizeSectorId(sectorKey));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadCurrent() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_sector")
      .eq("id", user.id)
      .maybeSingle();
    const current = normalizeSectorId(profile?.business_sector || sectorKey);
    setSelected(current);
    setInitial(current);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        router.push("/login");
        return;
      }

      // 1. Update profiles.business_sector (única fuente de verdad para el agente)
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ business_sector: selected })
        .eq("id", user.id);
      if (profileError) throw profileError;

      // 2. Keep fiscal_settings.sector_key synced (coarse mapping for UI/terminology)
      const coarse = coarseSectorKey(selected);
      const { data: existing } = await supabase
        .from("fiscal_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("fiscal_settings")
          .update({ sector_key: coarse, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("fiscal_settings")
          .insert({ user_id: user.id, sector_key: coarse });
      }

      // Reload global sector context so the rest of the app picks it up
      await reload();
      setInitial(selected);

      toast.success("Sector actualizado");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      toast.error("Error al guardar", { description: message });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-green"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <BackButton fallbackHref="/dashboard/settings" label="Volver a Ajustes" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Sector de actividad</h1>
        <p className="text-sm text-navy-500 dark:text-zinc-500 mt-1">
          Selecciona tu subsector para que el agente diario, las plantillas y la terminología se adapten a tu negocio.
          Esta es la misma lista que viste en el onboarding.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {SECTOR_OPTIONS.map((s) => {
          const isSelected = selected === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className={`text-left rounded-2xl border-2 p-5 transition-all ${isSelected
                ? "border-brand-green bg-brand-green/5 shadow-md"
                : "border-navy-100 bg-white dark:bg-zinc-900 hover:border-navy-200 dark:hover:border-zinc-800 hover:shadow-sm"
                }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold ${isSelected ? "text-brand-green" : "text-navy-900 dark:text-white"}`}>
                      {s.name}
                    </h3>
                    {isSelected && (
                      <span className="text-xs bg-brand-green text-white px-2 py-0.5 rounded-full">Seleccionado</span>
                    )}
                  </div>
                  <p className="text-sm text-navy-500 dark:text-zinc-500 mt-1">{s.desc}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected !== initial && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-6">
          <p className="text-sm text-amber-800 font-medium">
            ⚠️ Al cambiar de sector el agente diario usará otra persona experta, otras noticias y otros KPIs.
            Tus datos existentes no se eliminarán.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        {saved && (
          <span className="text-sm text-brand-green flex items-center">✓ Sector actualizado</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || selected === initial}
          className="px-6 py-2.5 bg-brand-green text-white rounded-xl font-semibold text-sm hover:opacity-90 transition disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar sector"}
        </button>
      </div>
    </div>
  );
}
