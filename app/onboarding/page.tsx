"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

const sectors = [
  { id: "construccion", icon: "🏗️", name: "Construcción y Reformas", desc: "Reformas, obra nueva, rehabilitación, instalaciones" },
  { id: "legal", icon: "⚖️", name: "Legal y Abogacía", desc: "Asesoría jurídica, gestión documental, procedimientos" },
  { id: "hosteleria", icon: "🍽️", name: "Hostelería", desc: "Bares, restaurantes, cafeterías, catering" },
  { id: "salud", icon: "🏥", name: "Salud y Bienestar", desc: "Clínicas, fisioterapia, estética, psicología" },
  { id: "comercio", icon: "🛍️", name: "Comercio y Retail", desc: "Tiendas, comercio local, e-commerce" },
  { id: "automocion", icon: "🔧", name: "Automoción", desc: "Talleres mecánicos, chapa y pintura, recambios" },
  { id: "estetica", icon: "💇", name: "Peluquería y Estética", desc: "Peluquerías, centros de estética, spa" },
  { id: "educacion", icon: "📚", name: "Educación y Formación", desc: "Academias, formación, tutorías, coaching" },
  { id: "tecnologia", icon: "💻", name: "Tecnología y Digital", desc: "Desarrollo, IT, consultoría tech, diseño" },
  { id: "eventos", icon: "📸", name: "Eventos y Fotografía", desc: "Fotografía, vídeo, organización de eventos" },
  { id: "otro", icon: "🏢", name: "Otro sector", desc: "Mi sector no está en la lista" },
];

export default function OnboardingPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [selectedSector, setSelectedSector] = useState("");
  const [customSector, setCustomSector] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
    });
  }, []);

  async function handleComplete() {
    if (!selectedSector) return;
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
      alert("Error: " + error.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[var(--color-navy-950)] flex items-center justify-center p-4">
      <div className="max-w-3xl w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-[var(--color-navy-50)]">
            enl<span className="text-[var(--color-brand-green)]">a</span>ze
          </h1>
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className={"h-2 rounded-full transition-all " + (step >= 1 ? "bg-[var(--color-brand-green)] w-12" : "bg-[var(--color-navy-700)] w-8")}></div>
            <div className={"h-2 rounded-full transition-all " + (step >= 2 ? "bg-[var(--color-brand-green)] w-12" : "bg-[var(--color-navy-700)] w-8")}></div>
          </div>
        </div>

        {/* Step 1: Sector Selection */}
        {step === 1 && (
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
                  <div className="text-2xl mb-2">{sector.icon}</div>
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
              onClick={() => { if (selectedSector) setStep(2); }}
              disabled={!selectedSector}
              className="mt-6 w-full bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-30"
            >
              Continuar
            </button>
          </div>
        )}

        {/* Step 2: Business Details */}
        {step === 2 && (
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
                onClick={handleComplete}
                disabled={saving}
                className="flex-1 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50"
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
