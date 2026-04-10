"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { useSector, SectorConfig } from "@/lib/sector-context";

const sectorIcons: Record<string, string> = {
  construccion: "🏗️",
  servicios: "💼",
  comercio: "🛒",
  instalaciones: "🔌",
};

export default function SectorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { sectorKey, reload } = useSector();

  const [sectors, setSectors] = useState<SectorConfig[]>([]);
  const [selected, setSelected] = useState(sectorKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadSectors() {
    const { data } = await supabase
      .from("sector_config")
      .select("*")
      .eq("is_active", true)
      .order("sector_label");
    if (data) setSectors(data as SectorConfig[]);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    // Upsert fiscal_settings with the new sector_key
    const { data: existing } = await supabase
      .from("fiscal_settings")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existing) {
      await supabase
        .from("fiscal_settings")
        .update({ sector_key: selected, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("fiscal_settings")
        .insert({ user_id: user.id, sector_key: selected });
    }

    // Reload sector context globally
    await reload();

    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
  }

  useEffect(() => {
    loadSectors();
  }, []);

  useEffect(() => {
    setSelected(sectorKey);
  }, [sectorKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-green"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">Sector de actividad</h1>
        <p className="text-sm text-navy-500 mt-1">
          Selecciona tu sector para adaptar la terminología, módulos visibles y opciones de formulario a tu negocio.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {sectors.map((s) => {
          const isSelected = selected === s.sector_key;
          return (
            <button
              key={s.sector_key}
              onClick={() => setSelected(s.sector_key)}
              className={`text-left rounded-2xl border-2 p-5 transition-all ${
                isSelected
                  ? "border-brand-green bg-brand-green/5 shadow-md"
                  : "border-navy-100 bg-white hover:border-navy-200 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl">{sectorIcons[s.sector_key] || "📦"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold ${isSelected ? "text-brand-green" : "text-navy-900"}`}>
                      {s.sector_label}
                    </h3>
                    {isSelected && (
                      <span className="text-xs bg-brand-green text-white px-2 py-0.5 rounded-full">Seleccionado</span>
                    )}
                  </div>
                  <p className="text-sm text-navy-500 mt-1">{s.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(s.sidebar_modules || [])
                      .filter((m) => m.visible)
                      .slice(0, 6)
                      .map((m) => (
                        <span key={m.key} className="text-xs bg-navy-50 text-navy-600 px-2 py-0.5 rounded-lg">
                          {m.icon} {m.label}
                        </span>
                      ))}
                    {(s.sidebar_modules || []).filter((m) => m.visible).length > 6 && (
                      <span className="text-xs text-navy-400">
                        +{(s.sidebar_modules || []).filter((m) => m.visible).length - 6} más
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Preview of what changes */}
      {selected !== sectorKey && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-6">
          <p className="text-sm text-amber-800 font-medium">
            ⚠️ Al cambiar de sector se actualizarán los nombres de menús, módulos visibles y opciones de formularios.
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
          disabled={saving || selected === sectorKey}
          className="px-6 py-2.5 bg-brand-green text-white rounded-xl font-semibold text-sm hover:opacity-90 transition disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar sector"}
        </button>
      </div>
    </div>
  );
}
