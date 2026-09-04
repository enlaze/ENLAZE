"use client";

/**
 * Piezas visuales del hub de Facturación.
 *
 * El diseño de Facturación (bundle de Claude Design) traía su propia paleta en
 * hexadecimales sueltos: `--surface #ffffff`, `--text-2 #4d6b78`, `--amber-fg
 * #96590a`... Aquí NO se reintroduce ninguno de esos literales: cada color del
 * diseño se traduce al token que el dashboard ya tiene tras el refactor de
 * coherencia.
 *
 *   diseño            → token del sistema
 *   --surface         → white / zinc-900
 *   --surface-2       → navy-50 / zinc-900
 *   --border          → navy-100 / zinc-800
 *   --border-soft     → navy-50 / zinc-800
 *   --text            → navy-900 / white
 *   --text-2          → navy-600 / zinc-400
 *   --text-3          → navy-400 / zinc-500
 *   --brand           → brand-green
 *   --brand-strong    → brand-green-dark (texto: success-ink)
 *   --green-*         → success / success-ink
 *   --amber-*         → warning / warning-ink
 *   --red-*           → danger / danger-ink
 *   --blue-fg         → info-ink
 *   --neutral-*       → navy-100/700 · zinc-800/300
 *
 * Los semánticos ya se redefinen bajo `:root.dark`, así que `text-danger-ink`
 * o `bg-warning/12` significan lo mismo en los dos temas sin variante `dark:`.
 * Lo único que no cabe en una utilidad es la sombra del diseño, que vive en
 * `[data-fact-surface]` de globals.css derivada de `--color-navy-900`.
 */

import React from "react";

/* ─── Tonos ────────────────────────────────────────────────────────────
   Los cuatro del diseño (neutral, verde, ámbar, rojo) más `info`, que el
   diseño usaba solo para enlaces (--blue-fg) y aquí sirve para separar
   estados que si no quedarían indistinguibles. */

export type FactTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Cifra grande de una tarjeta de resumen. */
const toneValue: Record<FactTone, string> = {
  neutral: "text-navy-900 dark:text-white",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  info: "text-info-ink",
};

/** Etiqueta de estado: tinte + texto legible + aro del mismo significado.
    El tinte al 12% y el paso `-ink` son justo lo que arregla el contraste
    pálido que tenían las etiquetas de "Recibidas" (usaban utilidades de
    tema oscuro —`bg-yellow-900/30 text-yellow-300`— también en claro). */
const tonePill: Record<FactTone, string> = {
  neutral:
    "bg-navy-100/70 text-navy-700 ring-navy-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  success: "bg-success/12 text-success-ink ring-success/30",
  warning: "bg-warning/12 text-warning-ink ring-warning/30",
  danger: "bg-danger/12 text-danger-ink ring-danger/30",
  info: "bg-info/12 text-info-ink ring-info/30",
};

/* ─── Tarjeta ──────────────────────────────────────────────────────────
   Esquina de 16px y la sombra doble del diseño (`data-fact-card` la
   engancha en globals.css). En oscuro la sombra se apaga, como en el
   resto del dashboard. */

export function FactCard({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      data-fact-card
      className={`rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
        padded ? "p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Rótulo de sección ────────────────────────────────────────────────
   El "FACTURADO POR MES" / "PENDIENTE DE PAGO" del diseño: 11px, 600,
   tracking ancho, en el gris más apagado. */

export function FactLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-[0.1em] text-navy-400 dark:text-zinc-500 ${className}`}
    >
      {children}
    </span>
  );
}

/* ─── Tarjeta de resumen ───────────────────────────────────────────────
   Reemplaza a `StatCard` solo dentro de Facturación: el diseño pide
   rótulo pequeño arriba, cifra tabular grande con el color del
   significado, y el detalle debajo. */

export function StatTile({
  label,
  value,
  tone = "neutral",
  detail,
}: {
  label: string;
  value: string | number;
  tone?: FactTone;
  detail?: string;
}) {
  return (
    <FactCard className="flex min-w-0 flex-col gap-2 px-[18px] py-[17px]">
      <FactLabel>{label}</FactLabel>
      <span
        className={`truncate text-[clamp(1.125rem,1.55vw,1.6875rem)] font-bold leading-none tracking-[-0.02em] tabular-nums ${toneValue[tone]}`}
      >
        {value}
      </span>
      {detail && (
        <span className="truncate text-[12.5px] text-navy-600 dark:text-zinc-400">{detail}</span>
      )}
    </FactCard>
  );
}

/* ─── Etiqueta de estado ───────────────────────────────────────────────── */

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: FactTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[7px] px-2.5 text-xs font-semibold ring-1 ring-inset ${tonePill[tone]}`}
    >
      {children}
    </span>
  );
}

/* ─── Barra de acciones de pestaña ─────────────────────────────────────
   La línea "texto explicativo · botones" que abre Emitidas y Recibidas. */

export function TabToolbar({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5">
      <p className="text-[14.5px] text-navy-600 dark:text-zinc-400">{children}</p>
      <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
    </div>
  );
}

/* ─── Botones del diseño ───────────────────────────────────────────────
   Alto fijo de 40px y esquina de 11px, que es lo que hace que la fila de
   acciones cuadre con los filtros de la tabla (42px). Se quedan aquí y no
   en `components/ui/button.tsx` para no cambiar el botón de todo el
   dashboard en un commit de pulido de Facturación. */

export const factBtnBase =
  "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-green/40 disabled:cursor-not-allowed disabled:opacity-50";

export const factBtnPrimary = `${factBtnBase} bg-brand-green text-white shadow-sm shadow-brand-green/25 hover:bg-brand-green-dark`;

export const factBtnSecondary = `${factBtnBase} border border-navy-200 bg-white text-navy-700 hover:border-navy-300 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800`;
