"use client";

/**
 * Ajustes → Personalización.
 *
 * Deja al usuario ocultar del menú lateral las secciones que no usa. Es una
 * preferencia PERSONAL (profiles.hidden_modules) que se aplica encima del
 * filtrado por sector: aquí solo se listan las secciones que ese sector ya le
 * muestra, reutilizando la lista canónica del propio sidebar
 * (resolveSectorNavItems en app/dashboard/layout.tsx) para que iconos y
 * etiquetas no se dupliquen.
 *
 * Ocultar afecta SOLO al menú: las rutas siguen accesibles por URL directa.
 * Los hrefs de NON_HIDEABLE_HREFS (Centro de control y Ajustes) se muestran
 * bloqueados — sin ellos no habría manera de volver a activar el resto.
 */

import { useMemo, useState } from "react";
import {
  NON_HIDEABLE_HREFS,
  SECTION_ORDER,
  resolveSectorNavItems,
  type NavItem,
} from "@/lib/dashboard-nav";
import { useSector } from "@/lib/sector-context";
import { useToast } from "@/components/ui/toast";
import Loading from "@/components/ui/loading";
import { CARD, GhostButton, PanelHeader, PILL, Switch } from "@/components/settings/ui";

const SECTION_TITLES: Record<string, string> = {
  _top: "Principal",
  General: "General",
  Negocio: "Negocio",
  Finanzas: "Finanzas",
  Sistema: "Sistema",
};

export default function PersonalizacionPanel() {
  const { visibleModules, hiddenModules, setHiddenModules, loading } = useSector();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  // Las mismas secciones que salen en el sidebar por su sector (aún sin aplicar
  // la preferencia personal: aquí queremos ver también las ocultas).
  const items = useMemo(() => resolveSectorNavItems(visibleModules()), [visibleModules]);

  const hidden = useMemo(() => new Set(hiddenModules), [hiddenModules]);
  const hiddenCount = items.filter(
    (item) => !NON_HIDEABLE_HREFS.has(item.href) && hidden.has(item.href),
  ).length;

  const groups = SECTION_ORDER.map((section) => ({
    key: section ?? "_top",
    title: SECTION_TITLES[section ?? "_top"],
    items: items.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  async function toggle(item: NavItem, visible: boolean) {
    if (NON_HIDEABLE_HREFS.has(item.href)) return;

    const next = visible
      ? hiddenModules.filter((href) => href !== item.href)
      : [...hiddenModules, item.href];

    setPending(item.href);
    try {
      await setHiddenModules(next);
    } catch (error) {
      toast.error("No se pudo guardar la preferencia", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  async function showAll() {
    setPending("__all__");
    try {
      await setHiddenModules([]);
      toast.success("Todas las secciones son visibles de nuevo");
    } catch (error) {
      toast.error("No se pudo guardar la preferencia", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PanelHeader
        title="Personalización"
        description="Oculta las secciones que no uses. Podrás volver a activarlas cuando quieras — no se borra nada."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            marginTop: 20,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--st-muted)" }}>
            {hiddenCount === 0
              ? "Ahora mismo se ven todas tus secciones."
              : `${hiddenCount} ${hiddenCount === 1 ? "sección oculta" : "secciones ocultas"} en el menú lateral.`}
          </span>
          {hiddenCount > 0 && (
            <GhostButton onClick={showAll} disabled={pending !== null}>
              Mostrar todas
            </GhostButton>
          )}
        </div>
      </PanelHeader>

      {groups.map((group, groupIdx) => (
        <div key={group.key} style={{ ...CARD, marginTop: groupIdx === 0 ? 32 : 24 }}>
          <div
            style={{
              padding: "14px 28px",
              background: "var(--st-panel-2)",
              borderBottom: "1px solid var(--st-border)",
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: ".14em",
              color: "var(--st-muted)",
              textTransform: "uppercase",
            }}
          >
            {group.title}
          </div>

          {group.items.map((item, i) => {
            const locked = NON_HIDEABLE_HREFS.has(item.href);
            const visible = locked || !hidden.has(item.href);
            return (
              <div
                key={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 24,
                  padding: "16px 28px",
                  ...(i === 0 ? {} : { borderTop: "1px solid var(--st-border)" }),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{
                      flex: "none",
                      lineHeight: 0,
                      color: visible ? "var(--st-text-2)" : "var(--st-muted)",
                      opacity: visible ? 1 : 0.6,
                    }}
                  >
                    {item.icon}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: visible ? "var(--st-text)" : "var(--st-muted)",
                      }}
                    >
                      {item.label}
                    </span>
                    {locked && <span style={PILL}>Siempre visible</span>}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--st-muted)",
                      minWidth: 52,
                      textAlign: "right",
                    }}
                  >
                    {locked ? "Fijada" : visible ? "Visible" : "Oculta"}
                  </span>
                  <Switch
                    checked={visible}
                    disabled={locked || pending !== null}
                    onChange={(v) => toggle(item, v)}
                    label={`Mostrar ${item.label} en el menú lateral`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <p
        style={{
          margin: "20px 0 0",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--st-muted)",
          maxWidth: "70ch",
        }}
      >
        Ocultar una sección solo la quita del <strong style={{ color: "var(--st-text-2)" }}>menú lateral</strong>:
        sus datos siguen intactos y la página continúa accesible si entras por su enlace directo o desde el
        buscador. <strong style={{ color: "var(--st-text-2)" }}>Centro de control</strong> y{" "}
        <strong style={{ color: "var(--st-text-2)" }}>Ajustes</strong> no se pueden ocultar.
      </p>
    </div>
  );
}
