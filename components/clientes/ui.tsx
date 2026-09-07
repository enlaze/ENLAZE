"use client";

/**
 * Piezas visuales de Clientes (listado, formulario y ficha).
 *
 * El diseño (bundle de Claude Design) traía su propia paleta en hexadecimales
 * dentro de `[data-theme]`: `--brand #10b981`, `--blue #0ea5e9`,
 * `--red #e11d48`, `--amber #f59e0b`, `--ink #0f1b2d`... Aquí NO se
 * reintroduce ninguno de esos literales. Cada variable del diseño se traduce
 * al token que el dashboard ya tiene, igual que se hizo en Facturación:
 *
 *   diseño          → token del sistema
 *   --bg            → (hereda el fondo del dashboard: white / zinc-950)
 *   --card          → white / zinc-900
 *   --soft          → navy-50 / zinc-800·50
 *   --border        → navy-100 / zinc-800
 *   --ink           → navy-900 / white
 *   --muted         → navy-600 / zinc-400
 *   --faint         → navy-400 / zinc-500
 *   --brand         → brand-green          (verde de marca de Enlaze)
 *   --brand-ink     → success-ink
 *   --brand-soft    → brand-green/12
 *   --blue / -ink   → info / info-ink      (--blue-soft → info/12)
 *   --amber / -ink  → warning / warning-ink
 *   --red / -ink    → danger / danger-ink
 *   --shadow        → [data-cli-surface] en globals.css, derivada de navy-900
 *
 * POR QUÉ ESTO ARREGLA EL BUG DE LAS ETIQUETAS PÁLIDAS: los semánticos se
 * redefinen bajo `:root.dark` en globals.css, así que `bg-danger/12
 * text-danger-ink` significa lo mismo en los dos temas y NO necesita variante
 * `dark:`. El fallo anterior venía de usar clases pensadas solo para oscuro
 * (`bg-yellow-900/30 text-yellow-300`) también en claro, donde quedaban
 * lavadas. Aquí no hay ni una clase `-900/30` ni un `text-*-300` suelto.
 *
 * Gemelo de `components/facturacion/ui.tsx`: mismas cadenas de token para los
 * mismos significados. Si cambia un tono, cambia en los dos.
 */

import React from "react";

/* ─── Tonos ──────────────────────────────────────────────────────────────
   Los cinco significados que usa la sección: neutro, éxito (cobrado,
   aceptado), aviso (pendiente, por vencer), peligro (vencido, rechazado) e
   info (enviado, en curso). */

export type CliTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Cifra grande de una tarjeta de resumen. */
const toneValue: Record<CliTone, string> = {
  neutral: "text-navy-900 dark:text-white",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  info: "text-info-ink",
};

/** Relleno de la barra bajo la cifra (el `barStyle` del diseño). */
const toneBar: Record<CliTone, string> = {
  neutral: "bg-navy-300 dark:bg-zinc-700",
  success: "bg-brand-green",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Etiqueta de estado: tinte al 12%, texto en el paso `-ink` y aro del mismo
    significado. Legible en los dos temas sin variante `dark:`. */
const tonePill: Record<CliTone, string> = {
  neutral:
    "bg-navy-100/70 text-navy-700 ring-navy-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  success: "bg-success/12 text-success-ink ring-success/30",
  warning: "bg-warning/12 text-warning-ink ring-warning/30",
  danger: "bg-danger/12 text-danger-ink ring-danger/30",
  info: "bg-info/12 text-info-ink ring-info/30",
};

/** Punto de color del selector de estado y de la actividad reciente. */
const toneDot: Record<CliTone, string> = {
  neutral: "bg-navy-300 dark:bg-zinc-600",
  success: "bg-brand-green",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/* ─── Tarjeta ────────────────────────────────────────────────────────────
   Esquina de 16px y la sombra doble del diseño (`data-cli-card` la engancha
   en globals.css). En oscuro la sombra se apaga y separa el borde, como en el
   resto del dashboard. */

export function CliCard({
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
      data-cli-card
      className={`rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
        padded ? "p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Rótulo de sección ──────────────────────────────────────────────────
   El "TE DEBE" / "ETIQUETAS" del diseño: 11px, 600, tracking ancho, en el
   gris más apagado. */

export function CliLabel({
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

/* ─── Tarjeta de resumen ─────────────────────────────────────────────────
   Las tres del encabezado de la ficha: rótulo, cifra tabular con el color del
   significado, detalle y barra de proporción. */

export function KpiTile({
  label,
  value,
  tone = "neutral",
  detail,
  pct,
}: {
  label: string;
  value: string;
  tone?: CliTone;
  detail?: string;
  /** 0–100. La barra se omite si no se pasa. */
  pct?: number;
}) {
  return (
    <CliCard className="flex min-w-0 flex-col gap-2 px-[18px] py-[17px]">
      <CliLabel>{label}</CliLabel>
      <span
        className={`truncate text-[clamp(1.25rem,1.7vw,1.625rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${toneValue[tone]}`}
      >
        {value}
      </span>
      {detail && (
        <span className="truncate text-[12.5px] text-navy-600 dark:text-zinc-400">
          {detail}
        </span>
      )}
      {pct !== undefined && (
        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-navy-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${toneBar[tone]}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      )}
    </CliCard>
  );
}

/* ─── Etiqueta de estado ─────────────────────────────────────────────────── */

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: CliTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-bold ring-1 ring-inset ${tonePill[tone]}`}
    >
      {children}
    </span>
  );
}

/* ─── Punto de color ─────────────────────────────────────────────────────── */

export function ToneDot({ tone = "neutral", className = "" }: { tone?: CliTone; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${toneDot[tone]} ${className}`} />;
}

/* ─── Avatar de iniciales ────────────────────────────────────────────────
   El diseño lo pinta con `linear-gradient(135deg,#10b981,#0ea5e9)`: verde de
   marca a azul. Mismo degradado con los tokens, sin literales. */

export function Avatar({
  children,
  size = "sm",
}: {
  children: React.ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-green to-info font-bold text-white ${
        size === "lg"
          ? "h-16 w-16 rounded-2xl text-lg"
          : "h-[38px] w-[38px] rounded-xl text-[12.5px]"
      }`}
    >
      {children}
    </span>
  );
}

/* ─── Botones del diseño ─────────────────────────────────────────────────
   Alto de 40px y esquina de 11px, iguales a los de Facturación para que las
   dos secciones no se vean de dos épocas distintas. */

export const cliBtnBase =
  "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-green/40 disabled:cursor-not-allowed disabled:opacity-50";

export const cliBtnPrimary = `${cliBtnBase} bg-brand-green text-white shadow-sm shadow-brand-green/25 hover:bg-brand-green-dark`;

export const cliBtnSecondary = `${cliBtnBase} border border-navy-200 bg-white text-navy-700 hover:border-navy-300 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800`;

/** El "Reclamar cobro" del diseño, que allí era el botón ámbar. */
export const cliBtnWarning = `${cliBtnBase} border border-warning/40 bg-warning/12 text-warning-ink hover:bg-warning/20`;

/* ─── Iconos ─────────────────────────────────────────────────────────────
   Los mismos trazos del diseño (24×24, stroke 1.9, redondeado). Sin emojis:
   el dashboard no los usa en ninguna pantalla. */

export function Icon({
  path,
  size = 15,
  className = "",
}: {
  path: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  whatsapp: "M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.7-4.9A8.4 8.4 0 1 1 21 11.5Z",
  mail: "M3 6.5h18v11H3zM3.5 7l8.5 6 8.5-6",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4",
  euro: "M16 7.5A5.5 5.5 0 0 0 8 12a5.5 5.5 0 0 0 8 4.5M6 11h6M6 13.5h6",
  phone:
    "M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5v3c0 1-.8 1.8-1.8 1.7C11.6 19.9 4.1 12.4 3.3 5.3 3.2 4.3 4 3.5 5 3.5Z",
  back: "M14 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  building: "M4 20V9.5L12 4l8 5.5V20M9.5 20v-6h5v6",
  chevron: "m6 10 6 6 6-6",
} as const;
