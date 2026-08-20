/**
 * Motor de recurrencia de los envíos programados.
 *
 * Todo lo de aquí es puro (sin Supabase, sin "use client", sin "server-only")
 * porque lo comparten tres sitios: la UI que crea el envío, la API que calcula
 * el primer `next_run_at` y el dispatcher que, después de enviar, calcula el
 * siguiente. Y así se puede testear sin levantar nada (__tests__/scheduled-messages.test.mjs).
 *
 * ── Zona horaria ────────────────────────────────────────────────────────────
 * El usuario piensa en hora de Madrid: "cada lunes a las 9" son las 9 de la
 * mañana en Madrid en enero y en julio, aunque en UTC sean las 08:00 y las
 * 07:00. Por eso la aritmética se hace sobre fechas civiles (año/mes/día) y
 * solo al final se convierte la hora de pared a un instante UTC, que es lo que
 * se guarda en `next_run_at`.
 */

/** Los modos del selector "¿Cuándo?" (components/messaging/Scheduler). */
export type SchedulerMode = "ahora" | "unavez" | "dia" | "semana" | "mes" | "ano";

export type ScheduleType = "once" | "daily" | "weekly" | "monthly" | "yearly";

export type MessageChannel = "whatsapp" | "email";

export type AudienceFilter = "all" | "pending_budget" | "overdue_invoice" | "active";

export type Audience =
  | { mode: "manual"; client_ids: string[] }
  | { mode: "filter"; filter: AudienceFilter };

export type ScheduleStatus = "active" | "paused" | "sending" | "done" | "failed";

/** La parte de la fila que define CUÁNDO se dispara. */
export type ScheduleSpec = {
  schedule_type: ScheduleType;
  /** "HH:MM" o "HH:MM:SS", en hora de Madrid. */
  send_time: string;
  /** Solo weekly. LUNES = 0 … DOMINGO = 6, como el selector de días. */
  days_of_week: number[];
  /** Solo monthly. 1-28. */
  day_of_month: number | null;
  /** "YYYY-MM-DD". */
  start_date: string;
};

/** Una fila de public.scheduled_messages tal y como la devuelve la API. */
export type ScheduledMessage = ScheduleSpec & {
  id: string;
  user_id: string;
  channel: MessageChannel;
  title: string | null;
  audience: Audience;
  subject: string | null;
  body: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
};

export const TIMEZONE = "Europe/Madrid";

/** Modo del selector → schedule_type de la tabla. "ahora" no se programa. */
export const MODE_TO_SCHEDULE_TYPE: Record<Exclude<SchedulerMode, "ahora">, ScheduleType> = {
  unavez: "once",
  dia: "daily",
  semana: "weekly",
  mes: "monthly",
  ano: "yearly",
};

export const SCHEDULE_TYPE_TO_MODE: Record<ScheduleType, Exclude<SchedulerMode, "ahora">> = {
  once: "unavez",
  daily: "dia",
  weekly: "semana",
  monthly: "mes",
  yearly: "ano",
};

export const SCHEDULE_TYPES: ScheduleType[] = ["once", "daily", "weekly", "monthly", "yearly"];

export const AUDIENCE_FILTERS: AudienceFilter[] = [
  "all",
  "pending_budget",
  "overdue_invoice",
  "active",
];

/* ── Fechas civiles ──────────────────────────────────────────────────────── */

/** Un día del calendario, sin hora ni zona. */
export type CivilDay = { y: number; m: number; d: number };

/** Los milisegundos UTC de la medianoche de ese día; sirve de número de día. */
const dayStamp = (c: CivilDay) => Date.UTC(c.y, c.m - 1, c.d);

const dayFromStamp = (ts: number): CivilDay => {
  const d = new Date(ts);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

const addDays = (c: CivilDay, n: number) => dayFromStamp(dayStamp(c) + n * 86_400_000);

/** LUNES = 0 … DOMINGO = 6, la convención del selector de días. */
export const weekdayOf = (c: CivilDay) => (new Date(dayStamp(c)).getUTCDay() + 6) % 7;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** <0 si a es anterior a b, 0 si son el mismo día, >0 si a es posterior. */
const compareDays = (a: CivilDay, b: CivilDay) => dayStamp(a) - dayStamp(b);

export function parseDate(value: string): CivilDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (day.m < 1 || day.m > 12) return null;
  if (day.d < 1 || day.d > daysInMonth(day.y, day.m)) return null;
  return day;
}

export function parseTime(value: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((value || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/* ── Hora de Madrid ↔ UTC ────────────────────────────────────────────────── */

const madridFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function madridParts(at: Date) {
  const p: Record<string, number> = {};
  for (const part of madridFormat.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** El día del calendario que se está viviendo en Madrid en ese instante. */
export function madridDayOf(at: Date): CivilDay {
  const p = madridParts(at);
  return { y: p.y, m: p.m, d: p.d };
}

/** Desplazamiento de Madrid respecto a UTC en ese instante, en ms (+1h o +2h). */
function madridOffsetMs(at: Date) {
  const p = madridParts(at);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Convierte una hora de pared de Madrid al instante UTC que le corresponde.
 *
 * Se hace en dos pasadas porque el desplazamiento depende del propio instante:
 * el primer tanteo usa el offset del momento equivocado cuando la fecha cae
 * justo en un cambio de hora, y la segunda pasada lo corrige. En la hora que
 * no existe (la madrugada de marzo en que se salta de las 2 a las 3) devuelve
 * el instante inmediatamente posterior al salto, que es cuando el usuario
 * espera que salga el mensaje.
 */
export function madridWallClockToUtc(day: CivilDay, hh: number, mm: number): Date {
  const wall = Date.UTC(day.y, day.m - 1, day.d, hh, mm, 0);
  let ts = wall - madridOffsetMs(new Date(wall));
  ts = wall - madridOffsetMs(new Date(ts));
  return new Date(ts);
}

/* ── Cálculo del próximo disparo ─────────────────────────────────────────── */

/**
 * El primer disparo ESTRICTAMENTE posterior a `after`, o null si ya no queda
 * ninguno (un "una vez" que ya pasó, o un "cada semana" sin días elegidos).
 *
 * `after` se pasa siempre explícito desde la API y el dispatcher para que el
 * cálculo sea reproducible en los tests.
 */
export function computeNextRun(spec: ScheduleSpec, after: Date = new Date()): Date | null {
  const time = parseTime(spec.send_time);
  const start = parseDate(spec.start_date);
  if (!time || !start) return null;

  const afterMs = after.getTime();
  if (!Number.isFinite(afterMs)) return null;

  const at = (day: CivilDay) => madridWallClockToUtc(day, time.hh, time.mm);
  const isFuture = (when: Date) => when.getTime() > afterMs;

  if (spec.schedule_type === "once") {
    const when = at(start);
    return isFuture(when) ? when : null;
  }

  /* En las recurrentes se empieza a mirar por el más tardío de los dos:
     la fecha de inicio (nunca antes) y hoy en Madrid (nunca en el pasado). */
  const today = madridDayOf(after);
  const from = compareDays(start, today) > 0 ? start : today;

  if (spec.schedule_type === "daily") {
    /* Como mucho dos vueltas: hoy si aún no ha pasado la hora, si no mañana. */
    for (let i = 0; i < 3; i++) {
      const when = at(addDays(from, i));
      if (isFuture(when)) return when;
    }
    return null;
  }

  if (spec.schedule_type === "weekly") {
    const days = [...new Set(spec.days_of_week)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0) return null;
    /* Ocho vueltas cubren la semana entera más el día de hoy ya pasado. */
    for (let i = 0; i < 8; i++) {
      const day = addDays(from, i);
      if (!days.includes(weekdayOf(day))) continue;
      const when = at(day);
      if (isFuture(when)) return when;
    }
    return null;
  }

  if (spec.schedule_type === "monthly") {
    const dom = spec.day_of_month;
    if (!Number.isInteger(dom as number) || (dom as number) < 1 || (dom as number) > 31) return null;
    for (let i = 0; i < 14; i++) {
      const y = from.y + Math.floor((from.m - 1 + i) / 12);
      const m = ((from.m - 1 + i) % 12) + 1;
      /* Clamp por si algún día se permite el 29-31: en febrero cae al último. */
      const day = { y, m, d: Math.min(dom as number, daysInMonth(y, m)) };
      if (compareDays(day, start) < 0) continue;
      const when = at(day);
      if (isFuture(when)) return when;
    }
    return null;
  }

  /* yearly: el día y el mes los fija start_date. El 29 de febrero cae al 28
     en los años que no son bisiestos, para que no se salte tres de cada
     cuatro años. */
  for (let i = 0; i < 6; i++) {
    const y = from.y + i;
    const day = { y, m: start.m, d: Math.min(start.d, daysInMonth(y, start.m)) };
    if (compareDays(day, start) < 0) continue;
    const when = at(day);
    if (isFuture(when)) return when;
  }
  return null;
}

/* ── Validación ──────────────────────────────────────────────────────────── */

export type ValidationResult = { ok: true; spec: ScheduleSpec } | { ok: false; error: string };

/**
 * Normaliza y comprueba lo que llega del cliente. Devuelve el spec ya limpio
 * (días ordenados y sin repetir, campos irrelevantes a su valor neutro) para
 * que la fila que se guarda no dependa de lo que mandara la UI de más.
 */
export function validateSchedule(input: {
  schedule_type?: unknown;
  send_time?: unknown;
  days_of_week?: unknown;
  day_of_month?: unknown;
  start_date?: unknown;
}): ValidationResult {
  const type = input.schedule_type;
  if (typeof type !== "string" || !SCHEDULE_TYPES.includes(type as ScheduleType)) {
    return { ok: false, error: "La frecuencia del envío no es válida." };
  }
  const scheduleType = type as ScheduleType;

  const time = parseTime(typeof input.send_time === "string" ? input.send_time : "");
  if (!time) return { ok: false, error: "La hora del envío no es válida." };

  const start = parseDate(typeof input.start_date === "string" ? input.start_date : "");
  if (!start) return { ok: false, error: "La fecha del envío no es válida." };

  let days: number[] = [];
  if (scheduleType === "weekly") {
    const raw = Array.isArray(input.days_of_week) ? input.days_of_week : [];
    days = [...new Set(raw.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (days.length === 0) {
      return { ok: false, error: "Elige al menos un día de la semana." };
    }
  }

  let dayOfMonth: number | null = null;
  if (scheduleType === "monthly") {
    const raw = Number(input.day_of_month);
    if (!Number.isInteger(raw) || raw < 1 || raw > 28) {
      return { ok: false, error: "El día del mes tiene que estar entre 1 y 28." };
    }
    dayOfMonth = raw;
  }

  return {
    ok: true,
    spec: {
      schedule_type: scheduleType,
      send_time: `${String(time.hh).padStart(2, "0")}:${String(time.mm).padStart(2, "0")}`,
      days_of_week: days,
      day_of_month: dayOfMonth,
      start_date: `${start.y}-${String(start.m).padStart(2, "0")}-${String(start.d).padStart(2, "0")}`,
    },
  };
}

/** Normaliza el bloque de audiencia que llega del cliente. */
export function validateAudience(input: unknown): { ok: true; audience: Audience } | { ok: false; error: string } {
  const raw = (input || {}) as { mode?: unknown; client_ids?: unknown; filter?: unknown };

  if (raw.mode === "filter") {
    if (typeof raw.filter !== "string" || !AUDIENCE_FILTERS.includes(raw.filter as AudienceFilter)) {
      return { ok: false, error: "El filtro de destinatarios no es válido." };
    }
    return { ok: true, audience: { mode: "filter", filter: raw.filter as AudienceFilter } };
  }

  if (raw.mode === "manual") {
    const ids = Array.isArray(raw.client_ids) ? raw.client_ids : [];
    const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (clean.length === 0) {
      return { ok: false, error: "Selecciona al menos un cliente." };
    }
    return { ok: true, audience: { mode: "manual", client_ids: clean } };
  }

  return { ok: false, error: "Los destinatarios del envío no son válidos." };
}
