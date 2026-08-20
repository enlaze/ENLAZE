/**
 * Resolución de las variables de un mensaje ({nombre}, {importe}, {empresa}).
 *
 * Vive en lib/ y no en components/messaging/shared.tsx porque el dispatcher
 * de envíos programados (app/api/cron/dispatch-scheduled) tiene que resolver
 * exactamente las mismas variables en el servidor, sin arrastrar un módulo
 * "use client". `shared.tsx` reexporta lo de aquí, así que sigue habiendo una
 * sola implementación para la vista previa y para el envío real.
 */

/** Lo mínimo que hace falta de un cliente para resolver las variables. */
export type MessagingVars = {
  name: string;
  company: string;
  /** Total de presupuestos aún sin cerrar. */
  pending: number;
  /** Total de facturas vencidas y sin cobrar. */
  overdue: number;
};

export const VAR_TOKENS = ["{nombre}", "{importe}", "{empresa}"];

export const eur = (n: number) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** El importe que resuelve `{importe}`: lo vencido manda sobre lo pendiente. */
export const importeOf = (c: MessagingVars) =>
  c.overdue > 0 ? eur(c.overdue) : c.pending > 0 ? eur(c.pending) : "el importe pendiente";

/** Sustituye {nombre}, {importe} y {empresa} con los datos del cliente. */
export const personalize = (body: string, c: MessagingVars) =>
  body
    .replace(/\{nombre\}/g, c.name.split(" ")[0])
    .replace(/\{importe\}/g, importeOf(c))
    .replace(/\{empresa\}/g, c.company || c.name);

/**
 * Los estados de presupuesto que cuentan como "abiertos" — los mismos que usa
 * la pantalla de Presupuestos. La app mezcla castellano e inglés porque el
 * campo `status` nunca se restringió en la base de datos.
 */
export const OPEN_BUDGET_STATUSES = ["pending", "pendiente", "borrador", "sent", "enviado"];
