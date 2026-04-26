"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import BackButton from "@/components/ui/back-button";

interface NotificationPref {
  id?: string;
  category: string;
  in_app: boolean;
  email: boolean;
}

const CATEGORIES = [
  {
    key: "budgets",
    label: "Presupuestos",
    description: "Aceptados, rechazados, enviados, vistos por el cliente",
    icon: "📋",
  },
  {
    key: "invoices",
    label: "Facturas",
    description: "Pagadas, vencidas, enviadas, anuladas",
    icon: "🧾",
  },
  {
    key: "payments",
    label: "Cobros y pagos",
    description: "Pagos recibidos, vencimientos, recordatorios",
    icon: "💰",
  },
  {
    key: "compliance",
    label: "Cumplimiento",
    description: "Alertas legales, fiscales, seguridad, caducidades",
    icon: "🛡️",
  },
  {
    key: "projects",
    label: "Obras / Proyectos",
    description: "Actualizaciones, cambios aprobados, hitos",
    icon: "🏗️",
  },
  {
    key: "system",
    label: "Sistema",
    description: "Actualizaciones de la plataforma, mantenimiento",
    icon: "⚙️",
  },
];

export default function NotificationPreferencesPage() {
  const supabase = createClient();
  const [prefs, setPrefs] = useState<NotificationPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");

  const loadPrefs = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id);

    // Merge existing prefs with all categories (defaults: in_app=true, email=false)
    const existing = new Map(
      (data || []).map((p: NotificationPref) => [p.category, p])
    );
    const merged = CATEGORIES.map((cat) => {
      const saved = existing.get(cat.key);
      return {
        category: cat.key,
        in_app: saved ? saved.in_app : true,
        email: saved ? saved.email : false,
        id: saved?.id,
      };
    });
    setPrefs(merged);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadPrefs(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePref(
    category: string,
    field: "in_app" | "email",
    value: boolean
  ) {
    setPrefs((prev) =>
      prev.map((p) =>
        p.category === category ? { ...p, [field]: value } : p
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    setResult("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    for (const pref of prefs) {
      await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          category: pref.category,
          in_app: pref.in_app,
          email: pref.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,category" }
      );
    }

    setResult("Preferencias guardadas correctamente");
    setSaving(false);
    setTimeout(() => setResult(""), 4000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-200 dark:border-zinc-800 border-t-brand-green" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackButton fallbackHref="/dashboard/settings" label="Volver a Ajustes" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
          Preferencias de notificaciones
        </h1>
        <p className="text-sm text-navy-500 dark:text-zinc-500 mt-1">
          Elige cómo y cuándo quieres recibir alertas
        </p>
      </div>

      <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr,80px,80px] items-center gap-4 border-b border-navy-100 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/50 px-6 py-3">
          <span className="text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">
            Categoría
          </span>
          <span className="text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider text-center">
            In-App
          </span>
          <span className="text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider text-center">
            Email
          </span>
        </div>

        {/* Rows */}
        {CATEGORIES.map((cat, i) => {
          const pref = prefs.find((p) => p.category === cat.key);
          return (
            <div
              key={cat.key}
              className={`grid grid-cols-[1fr,80px,80px] items-center gap-4 px-6 py-4 ${
                i < CATEGORIES.length - 1 ? "border-b border-navy-50" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{cat.icon}</span>
                <div>
                  <p className="text-sm font-medium text-navy-900 dark:text-white">
                    {cat.label}
                  </p>
                  <p className="text-xs text-navy-500 dark:text-zinc-500">{cat.description}</p>
                </div>
              </div>

              {/* In-App toggle */}
              <div className="flex justify-center">
                <button
                  onClick={() =>
                    togglePref(cat.key, "in_app", !pref?.in_app)
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    pref?.in_app ? "bg-brand-green" : "bg-navy-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white dark:bg-zinc-900 shadow transition-transform ${
                      pref?.in_app ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>

              {/* Email toggle */}
              <div className="flex justify-center">
                <button
                  onClick={() =>
                    togglePref(cat.key, "email", !pref?.email)
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    pref?.email ? "bg-brand-green" : "bg-navy-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white dark:bg-zinc-900 shadow transition-transform ${
                      pref?.email ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl bg-brand-green px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar preferencias"}
        </button>
        {result && (
          <p className="text-sm text-brand-green">{result}</p>
        )}
      </div>

      {/* Info */}
      <div className="mt-6 rounded-xl bg-navy-50 dark:bg-zinc-900 p-4">
        <p className="text-xs text-navy-500 dark:text-zinc-500">
          <strong>Nota:</strong> Las notificaciones in-app aparecen en la
          campana del menú superior. Las notificaciones por email se envían a tu
          dirección de correo registrada. Puedes desactivar categorías
          individualmente en cualquier momento.
        </p>
      </div>
    </div>
  );
}
