"use client";

/**
 * Piezas comunes a las pantallas de WhatsApp y Emails.
 *
 * Las dos secciones son el mismo motor — "¿a quién?, ¿qué?, ¿cuándo?" más la
 * cola de programados — y solo cambian el canal, el preview y un par de
 * etiquetas. Todo lo que comparten vive aquí para que un retoque de diseño
 * caiga a la vez en ambas.
 *
 * Los estilos son inline (vienen del diseño original). Los tokens de color
 * están en app/globals.css bajo `[data-msg-surface]`, con la variante oscura
 * enganchada al `.dark` que pone el ThemeProvider en <html>.
 */

import React from "react";
import {
  OPEN_BUDGET_STATUSES,
  VAR_TOKENS,
  eur,
  importeOf,
  personalize,
} from "@/lib/messaging-vars";
import { SCHEDULE_TYPE_TO_MODE } from "@/lib/scheduled-messages";
import type {
  AudienceFilter,
  ScheduledMessage,
  SchedulerMode,
} from "@/lib/scheduled-messages";

/* La resolución de variables y los estados de presupuesto abiertos viven en
   lib/ porque el dispatcher de programados los necesita en el servidor; se
   reexportan aquí para que las pantallas los sigan importando de un solo sitio. */
export { OPEN_BUDGET_STATUSES, VAR_TOKENS, eur, importeOf, personalize };
export type { ScheduledMessage };

/* ── Modelo ──────────────────────────────────────────────────── */

/** Un cliente contactable, con lo que hace falta para filtrar y personalizar. */
export type MessagingClient = {
  id: string;
  name: string;
  /** Teléfono o email según el canal; es la dirección de envío. */
  address: string;
  company: string;
  status: string;
  /** Total de presupuestos aún sin cerrar. */
  pending: number;
  /** Total de facturas vencidas y sin cobrar. */
  overdue: number;
};

/** Cómo se etiqueta en la cola cada `status` de scheduled_messages. */
export type QueueStatus = "Activo" | "Pausado" | "Enviando" | "Completado" | "Error";

export type QueueItem = {
  id: string;
  canal: string;
  titulo: string;
  recips: string;
  next: string;
  rec: string;
  status: QueueStatus;
  /** El último error del dispatcher, si lo hubo. */
  nota?: string;
};

export type HistoryRow = {
  id: string;
  name: string;
  titulo: string;
  when: string;
  status: "Enviado" | "Fallido";
};

/** Alias del tipo compartido con la API de programados. */
export type Mode = SchedulerMode;
export type FilterKey = "todos" | "pend" | "venc" | "activos" | "none" | "";

/* ── Constantes del diseño ───────────────────────────────────── */

export const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
export const DAYNAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const MODES: [Mode, string][] = [
  ["ahora", "Ahora"],
  ["unavez", "Una vez"],
  ["dia", "Cada día"],
  ["semana", "Cada semana"],
  ["mes", "Cada mes"],
  ["ano", "Cada año"],
];

export const FILTERS: [FilterKey, string][] = [
  ["todos", "Todos"],
  ["pend", "Con presupuesto pendiente"],
  ["venc", "Factura vencida"],
  ["activos", "Solo clientes activos"],
  ["none", "Ninguno"],
];

/* ── Utilidades ──────────────────────────────────────────────── */

export const initials = (n: string) =>
  n.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

export const shortName = (n: string) => {
  const p = n.split(" ").filter(Boolean);
  return p[0] + (p[1] ? " " + p[1][0] + "." : "");
};

export const fmtDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.getDate() + " " + MONTHS[d.getMonth()];
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Trocea el texto en variables y literales para pintar el resaltado. */
export const highlightSegments = (text: string) =>
  text
    .split(/(\{[a-zA-ZáéíóúñÁÉÍÓÚÑ]+\})/)
    .filter((x) => x !== "")
    .map((t) => {
      const isVar = /^\{[a-zA-ZáéíóúñÁÉÍÓÚÑ]+\}$/.test(t);
      return {
        t,
        bg: isVar ? "var(--msg-brand-soft)" : "transparent",
        fg: isVar ? "var(--msg-brand-tx)" : "var(--msg-tx)",
        fw: isVar ? 600 : 500,
      };
    });

/** El texto de "¿Cuándo?" en una frase. */
export function scheduleSummary(
  mode: Mode,
  date: string,
  time: string,
  weekdays: number[],
  monthday: number,
  count: number,
  unit: { one: string; many: string }
) {
  if (mode === "ahora")
    return "Se envía en cuanto confirmes — " + count + " " + (count === 1 ? unit.one : unit.many);
  if (mode === "unavez") return "Una vez el " + fmtDate(date) + " a las " + time;
  if (mode === "dia") return "Cada día a las " + time + " — empezando el " + fmtDate(date);
  if (mode === "semana") {
    const d = [...weekdays].sort((a, b) => a - b).map((i) => DAYNAMES[i]);
    const label =
      d.length === 0
        ? "ningún día elegido"
        : d.length === 7
          ? "todos los días"
          : d.length === 1
            ? "cada " + d[0]
            : "cada " + d.slice(0, -1).join(", ") + " y " + d[d.length - 1];
    return label.charAt(0).toUpperCase() + label.slice(1) + " a las " + time + " — empezando el " + fmtDate(date);
  }
  if (mode === "mes") return "El día " + monthday + " de cada mes a las " + time;
  return "Cada año el " + fmtDate(date) + " a las " + time;
}

/** Aplica un filtro rápido y devuelve los ids que quedan seleccionados. */
export function idsForFilter(k: FilterKey, clients: MessagingClient[]) {
  if (k === "todos") return clients.map((c) => c.id);
  if (k === "pend") return clients.filter((c) => c.pending > 0).map((c) => c.id);
  if (k === "venc") return clients.filter((c) => c.overdue > 0).map((c) => c.id);
  if (k === "activos") return clients.filter((c) => c.status === "active").map((c) => c.id);
  return [];
}

/* ── Puente con la tabla `scheduled_messages` ────────────────── */

/**
 * Los filtros rápidos que se pueden guardar como audiencia DINÁMICA: al
 * dispararse, el envío vuelve a preguntarse quién cumple el criterio. "Ninguno"
 * no es un filtro, es haber vaciado la selección, y por eso mapea a null.
 */
export const FILTER_TO_AUDIENCE: Record<FilterKey, AudienceFilter | null> = {
  todos: "all",
  pend: "pending_budget",
  venc: "overdue_invoice",
  activos: "active",
  none: null,
  "": null,
};

/** El camino de vuelta, para recargar un programado en "Nuevo envío". */
export const AUDIENCE_TO_FILTER: Record<AudienceFilter, FilterKey> = {
  all: "todos",
  pending_budget: "pend",
  overdue_invoice: "venc",
  active: "activos",
};

const AUDIENCE_LABEL: Record<AudienceFilter, string> = {
  all: "Todos los clientes",
  pending_budget: "Con presupuesto pendiente",
  overdue_invoice: "Con factura vencida",
  active: "Clientes activos",
};

const STATUS_LABEL: Record<ScheduledMessage["status"], QueueStatus> = {
  active: "Activo",
  paused: "Pausado",
  sending: "Enviando",
  done: "Completado",
  failed: "Error",
};

/** El color del punto y de la etiqueta de cada estado de la cola. */
export function queueTone(status: QueueStatus) {
  if (status === "Activo") return { dot: "var(--msg-brand)", bg: "var(--msg-brand-soft)", fg: "var(--msg-brand-tx)" };
  if (status === "Enviando") return { dot: "var(--msg-brand)", bg: "var(--msg-brand-soft)", fg: "var(--msg-brand-tx)" };
  if (status === "Pausado") return { dot: "var(--msg-warn)", bg: "var(--msg-warn-soft)", fg: "var(--msg-warn)" };
  if (status === "Error") return { dot: "var(--msg-dang)", bg: "var(--msg-dang-soft)", fg: "var(--msg-dang)" };
  return { dot: "var(--msg-mut)", bg: "var(--msg-chip)", fg: "var(--msg-tx-2)" };
}

/** Un instante de la tabla, en hora de Madrid: "24 ago · 09:00". */
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", " ·");

/** Traduce una fila de `scheduled_messages` a la tarjeta de la cola. */
export function scheduledToQueueItem(row: ScheduledMessage, canal: string): QueueItem {
  const recips =
    row.audience.mode === "filter"
      ? AUDIENCE_LABEL[row.audience.filter] + " · se recalcula en cada envío"
      : row.audience.client_ids.length + (row.audience.client_ids.length === 1 ? " cliente" : " clientes");

  const mode = SCHEDULE_TYPE_TO_MODE[row.schedule_type];

  return {
    id: row.id,
    canal,
    titulo: row.title || row.subject || "Envío sin título",
    recips,
    next: row.next_run_at
      ? fmtWhen(row.next_run_at)
      : row.last_run_at
        ? "Último envío: " + fmtWhen(row.last_run_at)
        : "Sin próxima fecha",
    rec: MODES.find((m) => m[0] === mode)?.[1] || "Programado",
    status: STATUS_LABEL[row.status] || "Activo",
    nota: row.last_error || undefined,
  };
}

/** Los que siguen contando para el badge de la pestaña: aún van a salir. */
export const isPendingSchedule = (row: ScheduledMessage) =>
  row.status === "active" || row.status === "paused" || row.status === "sending";

/* ── Estilos del diseño ──────────────────────────────────────── */

export const chipOn = {
  background: "var(--msg-brand-soft)",
  color: "var(--msg-brand-tx)",
  borderColor: "var(--msg-brand)",
};
export const chipOff = {
  background: "transparent",
  color: "var(--msg-tx-2)",
  borderColor: "var(--msg-bd)",
};

export const card: React.CSSProperties = {
  border: "1px solid var(--msg-bd)",
  borderRadius: 16,
  background: "var(--msg-panel)",
  boxShadow: "var(--msg-sh)",
  padding: "22px 24px 24px",
};

export const field: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid var(--msg-bd)",
  borderRadius: 10,
  background: "var(--msg-panel-2)",
  color: "var(--msg-tx)",
  fontSize: 14,
  outline: "none",
};

export const labelCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12.5,
  color: "var(--msg-mut)",
  fontWeight: 700,
};

export const queueBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 13px",
  border: "1px solid var(--msg-bd)",
  borderRadius: 10,
  background: "var(--msg-panel-2)",
  color: "var(--msg-tx-2)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 800,
  letterSpacing: "-.02em",
};

/* ── Barra de pestañas ───────────────────────────────────────── */

export function TabBar<T extends string>({
  tabs,
  active,
  onPick,
}: {
  tabs: { key: T; label: string; badge?: number }[];
  active: T;
  onPick: (key: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 30, borderBottom: "1px solid var(--msg-bd)" }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          style={{
            /* El flex solo hace falta cuando hay contador al lado del texto;
               sin él, el diseño de WhatsApp pinta el botón tal cual. */
            ...(t.badge !== undefined ? { display: "flex", alignItems: "center", gap: 9 } : null),
            padding: "12px 2px",
            border: 0,
            background: "transparent",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            color: active === t.key ? "var(--msg-tx)" : "var(--msg-mut)",
            boxShadow: active === t.key ? "inset 0 -2px 0 var(--msg-brand-deep)" : "none",
          }}
        >
          {t.label}
          {t.badge !== undefined && (
            <span style={{ padding: "1px 8px", borderRadius: 20, background: "var(--msg-chip)", color: "var(--msg-tx-2)", fontSize: 11.5, fontWeight: 700 }}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
