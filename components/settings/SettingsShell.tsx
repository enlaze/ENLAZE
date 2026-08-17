"use client";

/**
 * Contenedor de Ajustes: barra de pestañas horizontal pegada bajo la cabecera
 * del dashboard (con el medidor de perfil a la derecha) y el panel activo
 * debajo.
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
  // globals.css, bajo [data-settings-surface], porque cambia en `md`. La barra
  // de pestañas lo revierte con margin/padding negativos (también en CSS) para
  // que su borde inferior llegue de lado a lado.
  return (
    <div data-settings-surface>
      {/* ── Sub-navegación ── */}
      <div
        data-st-subnav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 26,
          borderBottom: "1px solid var(--st-border)",
          background: "var(--st-bg)",
          position: "sticky",
          top: 57,
          zIndex: 20,
        }}
      >
        <div
          data-subitems
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            overflowY: "hidden",
            scrollbarWidth: "none",
          }}
        >
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
                  gap: 9,
                  flex: "none",
                  whiteSpace: "nowrap",
                  padding: "16px 14px",
                  border: "none",
                  borderBottom: `2px solid ${active ? "var(--st-accent)" : "transparent"}`,
                  marginBottom: -1,
                  background: "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  transition: "color .16s",
                  ...(active
                    ? { fontWeight: 700, color: "var(--st-text)" }
                    : { fontWeight: 600, color: "var(--st-muted)" }),
                }}
              >
                <span style={{ flex: "none", lineHeight: 0 }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ── Medidor de perfil (lo que alimenta al agente económico) ── */}
        <div
          data-st-progress
          title="Cuanto más completos estén estos datos, más preciso será tu briefing diario"
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 11, padding: "9px 0" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "var(--st-accent-ink)",
            }}
          >
            <IcoSparkle size={12} />
            PERFIL
          </div>
          <div
            style={{
              width: 88,
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
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--st-text-2)" }}>
            {completion === null ? "—" : `${completion}%`}
          </span>
        </div>
      </div>

      {/* ── Panel activo ── */}
      <main data-st-content style={{ width: "100%", maxWidth: 1080, padding: "40px 0 140px" }}>
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
  );
}
