/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Loading from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import InfoFlipCard from "@/components/ui/InfoFlipCard";

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

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }

export default function MarginsPage() {
  const supabase = createClient();
  const { serviceTypes } = useSector();
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [margins, setMargins] = useState<MarginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);

  async function loadMargins(uid: string) {
    const { data } = await supabase
      .from("margin_config")
      .select("*")
      .eq("user_id", uid)
      .order("service_type");
    setMargins(data || []);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      await loadMargins(user.id);
    })();
  }, []);

  async function saveMargin(serviceType: string, percent: number) {
    if (!userId) { toast.error("Sesión no iniciada"); return; }
    setSavingType(serviceType);
    const existing = margins.find((m) => m.service_type === serviceType);
    const isPersisted = existing && existing.id !== "temp";

    const { data, error } = isPersisted
      ? await supabase
          .from("margin_config")
          .update({ margin_percent: percent })
          .eq("id", existing!.id)
          .select()
          .single()
      : await supabase
          .from("margin_config")
          .insert({ user_id: userId, service_type: serviceType, margin_percent: percent })
          .select()
          .single();

    if (error || !data) {
      toast.error("No se pudo guardar el margen", { description: error?.message });
      setSavingType(null);
      return;
    }

    setMargins((prev) => {
      const without = prev.filter((m) => m.service_type !== serviceType);
      return [...without, data as MarginEntry].sort((a, b) => a.service_type.localeCompare(b.service_type));
    });
    toast.success("Margen guardado");
    setSavingType(null);
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

  if (loading) return <Loading />;

  const generalMargin = getMargin("general");

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Margen comercial"
        description="Configura el porcentaje de beneficio que aplicas sobre el coste. El presupuesto del cliente incluirá este margen."
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Márgenes"
            what="Tu radiografía financiera. Aquí ves cuánto ganas realmente en cada trabajo, descontando lo que te ha costado hacerlo — materiales, horas, proveedores."
            howTo="Para saber si tu negocio es rentable de verdad, no solo si factura mucho. Hay trabajos que parecen buenos pero apenas dejan margen, y otros más pequeños que son muy rentables. Con esta sección descubres cuáles son cuáles y puedes tomar mejores decisiones sobre qué trabajos aceptar y a qué precio."
          />
        }
      />

      {/* Ejemplo visual */}
      <Card className="mb-8">
        <h3 className="text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider mb-4">Ejemplo con margen general ({generalMargin}%)</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-xl bg-navy-50 dark:bg-zinc-900/60 border border-navy-100 dark:border-zinc-800 p-4">
            <p className="text-xs text-navy-500 dark:text-zinc-500 mb-1">Tu coste</p>
            <p className="text-xl font-bold text-navy-900 dark:text-white">1.000 EUR</p>
            <p className="text-xs text-navy-400 dark:text-zinc-500 mt-0.5">PDF interno</p>
          </div>
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-4">
            <p className="text-xs text-navy-500 dark:text-zinc-500 mb-1">Precio cliente</p>
            <p className="text-xl font-bold text-brand-green">{exampleCalc(1000, generalMargin).clientPrice.toFixed(0)} EUR</p>
            <p className="text-xs text-navy-400 dark:text-zinc-500 mt-0.5">PDF cliente</p>
          </div>
          <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-4">
            <p className="text-xs text-navy-500 dark:text-zinc-500 mb-1">Tu beneficio</p>
            <p className="text-xl font-bold text-blue-600">{exampleCalc(1000, generalMargin).profit.toFixed(0)} EUR</p>
            <p className="text-xs text-navy-400 dark:text-zinc-500 mt-0.5">por presupuesto</p>
          </div>
        </div>
      </Card>

      {/* Margin Config */}
      <div className="space-y-3">
        {(() => {
          const sTypes = serviceTypes();
          const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes;
          return activeServiceTypes.map((service) => {
            const currentMargin = getMargin(service.value);
            const hasCustom = margins.some((m) => m.service_type === service.value);
            const isGeneral = service.value === "general";

            return (
              <Card key={service.value} className={isGeneral ? "ring-1 ring-brand-green/20" : ""}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-navy-900 dark:text-white">{service.label}</h3>
                      {isGeneral && <span className="text-[11px] bg-brand-green/10 text-brand-green px-2 py-0.5 rounded-full font-medium">por defecto</span>}
                      {!isGeneral && !hasCustom && <span className="text-xs text-navy-400 dark:text-zinc-500">(usa margen general)</span>}
                    </div>
                    {isGeneral && (
                      <p className="text-xs text-navy-500 dark:text-zinc-500 mt-0.5">Se aplica a todos los servicios que no tengan un margen específico</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-xl bg-navy-50 dark:bg-zinc-900/60 border border-navy-100 dark:border-zinc-800 px-3 py-2">
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
                        className="w-14 rounded-lg border border-navy-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-center text-navy-900 dark:text-white focus:border-brand-green/40 focus:outline-none"
                      />
                      <span className="text-sm text-navy-500 dark:text-zinc-500">%</span>
                    </div>
                    <Button
                      onClick={() => saveMargin(service.value, currentMargin)}
                      disabled={savingType === service.value}
                      size="sm"
                    >
                      {savingType === service.value ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          });
        })()}
      </div>

      {/* Info */}
      <Card className="mt-8">
        <h3 className="text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider mb-3">¿Cómo funciona?</h3>
        <div className="text-sm text-navy-600 dark:text-zinc-400 space-y-2">
          <p>Cuando el agente IA genera un presupuesto, usa los precios de tu banco de precios como <strong className="text-navy-900">coste base</strong>.</p>
          <p>Luego aplica el margen comercial correspondiente al tipo de servicio para calcular el <strong className="text-navy-900">precio al cliente</strong>.</p>
          <p>Se generan <strong className="text-navy-900">2 PDFs</strong>: uno interno con los costes reales (para ti) y otro con los precios finales (para el cliente).</p>
        </div>
      </Card>
    </div>
  );
}
