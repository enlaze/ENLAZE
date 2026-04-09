"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSector } from "@/lib/sector-context";

const fallbackServiceTypes = [
  { value: "general", label: "General (todos los servicios)" },
  { value: "reforma", label: "Reforma integral" },
  { value: "fontaneria", label: "Fontanería" },
  { value: "electricidad", label: "Electricidad" },
  { value: "climatizacion", label: "Climatización" },
  { value: "multiservicios", label: "Multiservicios" },
];

interface MarginEntry {
  id: string;
  service_type: string;
  margin_percent: number;
}

export default function MarginsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { serviceTypes } = useSector();

  const [margins, setMargins] = useState<MarginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadMargins(); }, []);

  async function loadMargins() {
    const { data } = await supabase
      .from("margin_config")
      .select("*")
      .order("service_type");
    setMargins(data || []);
    setLoading(false);
  }

  async function saveMargin(serviceType: string, percent: number) {
    setSaving(true);
    const existing = margins.find((m) => m.service_type === serviceType);

    if (existing) {
      await supabase
        .from("margin_config")
        .update({ margin_percent: percent })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("margin_config")
        .insert({ service_type: serviceType, margin_percent: percent });
    }

    await loadMargins();
    setSaving(false);
  }

  function getMargin(serviceType: string): number {
    const entry = margins.find((m) => m.service_type === serviceType);
    if (entry) return entry.margin_percent;
    const general = margins.find((m) => m.service_type === "general");
    return general ? general.margin_percent : 20;
  }

  function exampleCalc(cost: number, marginPercent: number) {
    const clientPrice = cost * (1 + marginPercent / 100);
    const profit = clientPrice - cost;
    return { clientPrice, profit };
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;

  const generalMargin = getMargin("general");

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Margen comercial</h1>
        <p className="text-[var(--color-navy-400)] text-sm mt-1">
          Configura el porcentaje de beneficio que aplicas sobre el coste. El presupuesto del cliente incluirá este margen, mientras que tu copia interna mostrará los costes reales.
        </p>
      </div>

      {/* Ejemplo visual */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-700)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Ejemplo con margen general ({generalMargin}%)</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-[var(--color-navy-700)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-navy-400)] mb-1">Tu coste</p>
            <p className="text-xl font-bold text-[var(--color-navy-100)]">1.000 €</p>
            <p className="text-xs text-[var(--color-navy-500)]">PDF interno</p>
          </div>
          <div className="bg-[var(--color-navy-700)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-navy-400)] mb-1">Precio cliente</p>
            <p className="text-xl font-bold text-[var(--color-brand-green)]">{exampleCalc(1000, generalMargin).clientPrice.toFixed(0)} €</p>
            <p className="text-xs text-[var(--color-navy-500)]">PDF cliente</p>
          </div>
          <div className="bg-[var(--color-navy-700)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-navy-400)] mb-1">Tu beneficio</p>
            <p className="text-xl font-bold text-green-400">{exampleCalc(1000, generalMargin).profit.toFixed(0)} €</p>
            <p className="text-xs text-[var(--color-navy-500)]">por presupuesto</p>
          </div>
        </div>
      </div>

      {/* Margin Config */}
      <div className="space-y-4">
        {(() => {
          const sTypes = serviceTypes();
          const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes;
          return activeServiceTypes.map((service) => {
          const currentMargin = getMargin(service.value);
          const hasCustom = margins.some((m) => m.service_type === service.value);
          const isGeneral = service.value === "general";

          return (
            <div key={service.value} className={`bg-[var(--color-navy-800)] rounded-xl p-5 border ${isGeneral ? "border-[var(--color-brand-green)]/30" : "border-[var(--color-navy-700)]"}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-[var(--color-navy-100)]">{service.label}</h3>
                    {isGeneral && <span className="text-xs bg-[var(--color-brand-green)]/20 text-[var(--color-brand-green)] px-2 py-0.5 rounded-full">por defecto</span>}
                    {!isGeneral && !hasCustom && <span className="text-xs text-[var(--color-navy-500)]">(usa margen general)</span>}
                  </div>
                  {isGeneral && (
                    <p className="text-xs text-[var(--color-navy-400)] mt-1">Se aplica a todos los servicios que no tengan un margen específico</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-[var(--color-navy-700)] rounded-lg px-3 py-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={currentMargin}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const updated = margins.map((m) => m.service_type === service.value ? { ...m, margin_percent: val } : m);
                        if (!margins.find((m) => m.service_type === service.value)) {
                          updated.push({ id: "temp", service_type: service.value, margin_percent: val });
                        }
                        setMargins(updated);
                      }}
                      className="w-24 accent-[var(--color-brand-green)]"
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={currentMargin}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        const updated = margins.map((m) => m.service_type === service.value ? { ...m, margin_percent: val } : m);
                        if (!margins.find((m) => m.service_type === service.value)) {
                          updated.push({ id: "temp", service_type: service.value, margin_percent: val });
                        }
                        setMargins(updated);
                      }}
                      className="w-16 bg-[var(--color-navy-600)] text-[var(--color-navy-50)] rounded px-2 py-1 text-sm text-center border border-[var(--color-navy-500)] focus:border-[var(--color-brand-green)] focus:outline-none"
                    />
                    <span className="text-sm text-[var(--color-navy-300)]">%</span>
                  </div>
                  <button
                    onClick={() => saveMargin(service.value, currentMargin)}
                    disabled={saving}
                    className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          );
          });
        })()}
      </div>

      {/* Info */}
      <div className="mt-6 bg-[var(--color-navy-800)] rounded-xl p-5 border border-[var(--color-navy-700)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-2">¿Cómo funciona?</h3>
        <div className="text-sm text-[var(--color-navy-300)] space-y-2">
          <p>Cuando el agente IA genera un presupuesto, usa los precios de tu banco de precios como <strong className="text-[var(--color-navy-100)]">coste base</strong>.</p>
          <p>Luego aplica el margen comercial correspondiente al tipo de servicio para calcular el <strong className="text-[var(--color-navy-100)]">precio al cliente</strong>.</p>
          <p>Se generan <strong className="text-[var(--color-navy-100)]">2 PDFs</strong>: uno interno con los costes reales (para ti) y otro con los precios finales (para el cliente).</p>
        </div>
      </div>
    </div>
  );
}
