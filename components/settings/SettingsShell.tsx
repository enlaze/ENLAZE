"use client";

/**
 * Contenedor de Ajustes: sub-navegación a la izquierda (con la tarjeta del
 * agente económico) y el panel activo a la derecha.
 *
 * Las cuatro rutas antiguas siguen existiendo y montan este mismo shell con la
 * pestaña correspondiente, así que ningún enlace queda roto — incluido el
 * retorno del OAuth de Google a /dashboard/settings/integrations?...
 * Al cambiar de pestaña se actualiza la URL con history.replaceState (soportado
 * por el App Router) para que sea enlazable sin provocar una navegación.
 */

import { useCallback, useEffect, useState } from "react";
import EmpresaPanel from "@/components/settings/EmpresaPanel";
import NotificacionesPanel from "@/components/settings/NotificacionesPanel";
import IntegracionesPanel from "@/components/settings/IntegracionesPanel";
import CuentaPanel from "@/components/settings/CuentaPanel";
import { IcoAccount, IcoBell, IcoCompany, IcoPlug, IcoSparkle } from "@/components/settings/ui";

export type SettingsTab = "empresa" | "notificaciones" | "integraciones" | "cuenta";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode; path: string }[] = [
  { id: "empresa", label: "Empresa y datos fiscales", icon: <IcoCompany />, path: "/dashboard/settings" },
  {
    id: "notificaciones",
    label: "Notificaciones",
    icon: <IcoBell />,
    path: "/dashboard/settings/notifications",
  },
  {
    id: "integraciones",
    label: "Integraciones",
    icon: <IcoPlug />,
    path: "/dashboard/settings/integrations",
  },
  { id: "cuenta", label: "Cuenta y tema", icon: <IcoAccount />, path: "/dashboard/settings/cuenta" },
];

export default function SettingsShell({ initialTab = "empresa" }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [completion, setCompletion] = useState<number | null>(null);

  const goTab = useCallback((next: SettingsTab) => {
    setTab(next);
    const target = TABS.find((t) => t.id === next);
    if (target) window.history.replaceState(null, "", target.path);
  }, []);

  // Si el usuario navega con atrás/adelante, la pestaña sigue a la URL.
  useEffect(() => {
    const onPop = () => {
      const match = [...TABS]
        .sort((a, b) => b.path.length - a.path.length)
        .find((t) => window.location.pathname === t.path);
      if (match) setTab(match.id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // El sangrado que anula el padding del <main> del dashboard vive en
  // globals.css, bajo [data-settings-surface], porque cambia en `md`.
  return (
    <div data-settings-surface>
      <div data-st-shell style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
        {/* ── Sub-navegación ── */}
        <aside
          data-st-subnav
          style={{
            width: 272,
            flex: "none",
            padding: "34px 20px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            borderRight: "1px solid var(--st-border)",
            position: "sticky",
            top: 57,
            alignSelf: "flex-start",
          }}
        >
          <div style={{ padding: "0 12px 16px" }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".14em",
                color: "var(--st-muted)",
              }}
            >
              AJUSTES
            </div>
          </div>

          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-subitem
                data-active={active}
                aria-current={active ? "page" : undefined}
                onClick={() => goTab(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 12px",
                  border: "none",
                  borderRadius: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  transition: "background .16s",
                  ...(active
                    ? { fontWeight: 700, color: "var(--st-accent-ink)", background: "var(--st-accent-soft)" }
                    : { fontWeight: 600, color: "var(--st-text-2)", background: "transparent" }),
                }}
              >
                <span style={{ flex: "none", lineHeight: 0 }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}

          {/* ── Tarjeta del agente económico ── */}
          <div
            style={{
              marginTop: 22,
              padding: 14,
              borderRadius: 12,
              border: "1px solid var(--st-border)",
              background: "var(--st-panel)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11.5,
                fontWeight: 700,
                color: "var(--st-accent-ink)",
                letterSpacing: ".02em",
              }}
            >
              <IcoSparkle />
              AGENTE ECONÓMICO
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--st-muted)" }}>
              Cuanto más completos estén estos datos, más preciso será tu briefing de cada mañana.
            </p>
            <div
              style={{
                marginTop: 11,
                height: 5,
                borderRadius: 3,
                background: "var(--st-field-alt)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${completion ?? 0}%`,
                  height: "100%",
                  background: "var(--st-accent)",
                  transition: "width .3s ease",
                }}
              />
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 600, color: "var(--st-text-2)" }}>
              {completion === null ? "Calculando tu perfil…" : `Perfil completado al ${completion}%`}
            </div>
          </div>
        </aside>

        {/* ── Panel activo ── */}
        <main
          data-st-content
          style={{ flex: 1, minWidth: 0, padding: "44px 0 140px 56px", maxWidth: 1080 }}
        >
          {/* El panel de Empresa se mantiene montado: es el que calcula el % de
              perfil y evita recargar sus datos cada vez que se vuelve a él. */}
          <div style={{ display: tab === "empresa" ? "block" : "none" }}>
            <EmpresaPanel onCompletionChange={setCompletion} />
          </div>
          {tab === "notificaciones" && <NotificacionesPanel />}
          {tab === "integraciones" && <IntegracionesPanel />}
          {tab === "cuenta" && <CuentaPanel />}
        </main>
      </div>
    </div>
  );
}
