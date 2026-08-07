"use client";

/**
 * Ajustes → Notificaciones.
 *
 * Misma lógica que la antigua /settings/notifications: se hace merge de las
 * filas de `notification_preferences` con las 6 categorías canónicas (por
 * defecto in_app=true, email=false) y se guarda con upsert por
 * (user_id, category). Solo cambia la presentación.
 *
 * Añadido: el interruptor del briefing diario, que escribe en
 * `profiles.agent_enabled` (columna ya existente que lee /api/agent/config).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import Loading from "@/components/ui/loading";
import { CARD, DirtyIndicator, PanelHeader, SaveBar, Switch, ToggleRow } from "@/components/settings/ui";

interface NotificationPref {
  category: string;
  in_app: boolean;
  email: boolean;
}

const CATEGORIES = [
  {
    key: "budgets",
    label: "Presupuestos",
    description: "Aceptados, rechazados, enviados, vistos por el cliente.",
  },
  {
    key: "invoices",
    label: "Facturas",
    description: "Pagadas, vencidas, enviadas, anuladas.",
  },
  {
    key: "payments",
    label: "Cobros y pagos",
    description: "Pagos recibidos, vencimientos y recordatorios.",
  },
  {
    key: "compliance",
    label: "Cumplimiento",
    description: "Alertas legales, fiscales, de seguridad y caducidades.",
  },
  {
    key: "projects",
    label: "Obras / Proyectos",
    description: "Actualizaciones, cambios aprobados e hitos.",
  },
  {
    key: "system",
    label: "Sistema",
    description: "Actualizaciones de la plataforma y mantenimiento.",
  },
];

interface NotifState {
  prefs: NotificationPref[];
  briefing: boolean;
}

export default function NotificacionesPanel() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [state, setState] = useState<NotifState>({ prefs: [], briefing: true });
  const [baseline, setBaseline] = useState<NotifState>({ prefs: [], briefing: true });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(baseline), [state, baseline]);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: rows }, { data: profile }] = await Promise.all([
      supabase.from("notification_preferences").select("*").eq("user_id", user.id),
      supabase.from("profiles").select("agent_enabled").eq("id", user.id).maybeSingle(),
    ]);

    const existing = new Map((rows || []).map((p: NotificationPref) => [p.category, p]));
    const merged: NotifState = {
      prefs: CATEGORIES.map((cat) => {
        const saved = existing.get(cat.key);
        return {
          category: cat.key,
          in_app: saved ? saved.in_app : true,
          email: saved ? saved.email : false,
        };
      }),
      briefing: profile?.agent_enabled ?? true,
    };

    setState(merged);
    setBaseline(merged);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Carga inicial desde Supabase: el setState va dentro de `load`, tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggle(category: string, field: "in_app" | "email", value: boolean) {
    setState((prev) => ({
      ...prev,
      prefs: prev.prefs.map((p) => (p.category === category ? { ...p, [field]: value } : p)),
    }));
    setJustSaved(false);
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    for (const pref of state.prefs) {
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: userId,
          category: pref.category,
          in_app: pref.in_app,
          email: pref.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,category" },
      );
      if (error) {
        toast.error("Error guardando preferencias", { description: error.message });
        setSaving(false);
        return;
      }
    }

    if (state.briefing !== baseline.briefing) {
      const { error } = await supabase
        .from("profiles")
        .update({ agent_enabled: state.briefing, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) {
        toast.error("Error guardando el briefing", { description: error.message });
        setSaving(false);
        return;
      }
    }

    setBaseline(state);
    setSaving(false);
    setJustSaved(true);
    toast.success("Preferencias guardadas");
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PanelHeader
        title="Notificaciones"
        description="Decide qué te avisamos y por dónde. El briefing diario llega siempre a primera hora."
      >
        <DirtyIndicator dirty={dirty} justSaved={justSaved} />
      </PanelHeader>

      {/* Briefing del agente */}
      <div style={{ ...CARD, marginTop: 32 }}>
        <ToggleRow
          first
          title="Briefing económico diario"
          description="Resumen de tu negocio, noticias y ayudas de tu comunidad. Cada mañana a primera hora."
        >
          <Switch
            checked={state.briefing}
            onChange={(v) => {
              setState((prev) => ({ ...prev, briefing: v }));
              setJustSaved(false);
            }}
            label="Recibir el briefing económico diario"
          />
        </ToggleRow>
      </div>

      {/* Categorías × canal */}
      <div style={{ ...CARD, marginTop: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            padding: "14px 28px",
            background: "var(--st-panel-2)",
            borderBottom: "1px solid var(--st-border)",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: ".14em",
              color: "var(--st-muted)",
            }}
          >
            CATEGORÍA
          </span>
          <div style={{ display: "flex", gap: 18, flex: "none" }}>
            <span style={channelHeadStyle}>EN LA APP</span>
            <span style={channelHeadStyle}>EMAIL</span>
          </div>
        </div>

        {CATEGORIES.map((cat, i) => {
          const pref = state.prefs.find((p) => p.category === cat.key);
          return (
            <ToggleRow key={cat.key} first={i === 0} title={cat.label} description={cat.description}>
              <div style={{ width: 46, display: "flex", justifyContent: "center" }}>
                <Switch
                  checked={pref?.in_app ?? false}
                  onChange={(v) => toggle(cat.key, "in_app", v)}
                  label={`${cat.label} en la app`}
                />
              </div>
              <div style={{ width: 46, display: "flex", justifyContent: "center" }}>
                <Switch
                  checked={pref?.email ?? false}
                  onChange={(v) => toggle(cat.key, "email", v)}
                  label={`${cat.label} por email`}
                />
              </div>
            </ToggleRow>
          );
        })}
      </div>

      <p
        style={{
          margin: "20px 0 0",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--st-muted)",
          maxWidth: "70ch",
        }}
      >
        Las notificaciones <strong style={{ color: "var(--st-text-2)" }}>en la app</strong> aparecen en la
        campana del menú superior. Las de <strong style={{ color: "var(--st-text-2)" }}>email</strong> se
        envían a tu dirección de acceso. Puedes desactivar categorías individualmente cuando quieras.
      </p>

      <SaveBar dirty={dirty} saving={saving} canSave onSave={handleSave} onDiscard={() => setState(baseline)} />
    </div>
  );
}

const channelHeadStyle = {
  width: 46,
  textAlign: "center" as const,
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: ".08em",
  color: "var(--st-muted)",
};
