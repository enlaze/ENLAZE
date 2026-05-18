/**
 * TypeScript mirror of the calendar + ctx construction that lives inside the
 * n8n workflow (`Build Claude Prompt` + `Run User Modules`). The agent
 * inspector at /dashboard/dev/agent-inspector uses this to render what the
 * agent will see on its next run, *without* talking to n8n.
 *
 * Keep this file in sync with:
 *   - buildSpanishCalendarContext() inside the "Build Claude Prompt" node
 *   - buildSpanishRetailCalendar()  inside the "Run User Modules" node
 *
 * If the n8n versions drift, the inspector will quietly lie. There is no
 * runtime check, so review this file when touching the workflow.
 */

export interface RetailEvent {
  key: string;
  name: string;
  date: string; // ISO yyyy-mm-dd
  in_days?: number;
  days_ago?: number;
}

export interface RetailCalendarContext {
  today: string;
  weekday_today: string;
  upcoming: RetailEvent[];
  recently_passed: RetailEvent[];
}

const WEEKDAYS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

export function buildSpanishRetailCalendar(today: Date, windowDays = 14): RetailCalendarContext {
  const year = today.getUTCFullYear();
  const firstSundayOfMonth = (m: number) => {
    const d = new Date(Date.UTC(year, m, 1));
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };
  const lastFridayOfMonth = (m: number) => {
    const d = new Date(Date.UTC(year, m + 1, 0));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  };

  const events: Array<{ key: string; name: string; date: Date; window_days?: number }> = [
    { key: "reyes",          name: "Reyes Magos (fin rebajas Navidad)", date: new Date(Date.UTC(year, 0, 6)) },
    { key: "rebajas_enero",  name: "Rebajas de enero",                  date: new Date(Date.UTC(year, 0, 7)), window_days: 21 },
    { key: "san_valentin",   name: "San Valentín",                      date: new Date(Date.UTC(year, 1, 14)) },
    { key: "dia_padre",      name: "Día del Padre",                     date: new Date(Date.UTC(year, 2, 19)) },
    { key: "sant_jordi",     name: "Sant Jordi / Día del Libro",        date: new Date(Date.UTC(year, 3, 23)) },
    { key: "dia_trabajador", name: "Día del Trabajador",                date: new Date(Date.UTC(year, 4, 1)) },
    { key: "dia_madre",      name: "Día de la Madre",                   date: firstSundayOfMonth(4) },
    { key: "san_juan",       name: "San Juan",                          date: new Date(Date.UTC(year, 5, 24)) },
    { key: "rebajas_verano", name: "Inicio rebajas de verano",          date: new Date(Date.UTC(year, 6, 1)), window_days: 21 },
    { key: "vuelta_cole",    name: "Vuelta al cole",                    date: new Date(Date.UTC(year, 8, 1)), window_days: 14 },
    { key: "halloween",      name: "Halloween",                         date: new Date(Date.UTC(year, 9, 31)) },
    { key: "todos_santos",   name: "Todos los Santos",                  date: new Date(Date.UTC(year, 10, 1)) },
    { key: "black_friday",   name: "Black Friday",                      date: lastFridayOfMonth(10), window_days: 10 },
    { key: "cyber_monday",   name: "Cyber Monday",                      date: (() => { const d = lastFridayOfMonth(10); d.setUTCDate(d.getUTCDate() + 3); return d; })() },
    { key: "constitucion",   name: "Constitución (puente)",             date: new Date(Date.UTC(year, 11, 6)) },
    { key: "inmaculada",     name: "Inmaculada (puente)",               date: new Date(Date.UTC(year, 11, 8)) },
    { key: "loteria",        name: "Lotería de Navidad",                date: new Date(Date.UTC(year, 11, 22)) },
    { key: "nochebuena",     name: "Nochebuena",                        date: new Date(Date.UTC(year, 11, 24)) },
    { key: "navidad",        name: "Navidad",                           date: new Date(Date.UTC(year, 11, 25)), window_days: 21 },
    { key: "nochevieja",     name: "Nochevieja",                        date: new Date(Date.UTC(year, 11, 31)) },
  ];

  const upcoming: RetailEvent[] = [];
  const recentlyPassed: RetailEvent[] = [];
  const todayMs = today.getTime();
  for (const e of events) {
    const w = e.window_days ?? windowDays;
    const diffDays = Math.round((e.date.getTime() - todayMs) / 86400000);
    const isoDate = e.date.toISOString().split("T")[0];
    if (diffDays >= 0 && diffDays <= w) {
      upcoming.push({ key: e.key, name: e.name, date: isoDate, in_days: diffDays });
    } else if (diffDays < 0 && diffDays >= -w) {
      recentlyPassed.push({ key: e.key, name: e.name, date: isoDate, days_ago: -diffDays });
    }
  }

  return {
    today: today.toISOString().split("T")[0],
    weekday_today: WEEKDAYS_ES[today.getUTCDay()],
    upcoming,
    recently_passed: recentlyPassed,
  };
}

/* ─── Build the same ctx the agent receives ──────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface AgentInspectionContext {
  config: {
    business_name: string | null;
    business_type: string | null;
    city: string | null;
    sector: string | null;
  };
  date: string;
  weekday_today: string;
  modules_state: {
    gmail: "CONECTADO" | "NO conectado";
    calendar: "CONECTADO" | "NO conectado";
    reputation: "CONECTADO" | "NO conectado";
    sheets: "CONECTADO" | "NO conectado";
  };
  upcoming_retail_events: RetailEvent[];
  recently_passed_retail_events: RetailEvent[];
  module_payloads: {
    gmail: Json;
    calendar: Json;
    sheets: Json;
    reputation: Json;
  };
}

export function buildInspectionContext(args: {
  profile: {
    business_name?: string | null;
    business_type?: string | null;
    city?: string | null;
    business_sector?: string | null;
  } | null;
  gmail: Json;
  calendar: Json;
  sheets: Json;
  reputation: Json;
  today?: Date;
}): AgentInspectionContext {
  const today = args.today ?? new Date();
  const calendar = buildSpanishRetailCalendar(today);
  return {
    config: {
      business_name: args.profile?.business_name ?? null,
      business_type: args.profile?.business_type ?? null,
      city: args.profile?.city ?? null,
      sector: args.profile?.business_sector ?? null,
    },
    date: calendar.today,
    weekday_today: calendar.weekday_today,
    modules_state: {
      gmail: args.gmail?.connected ? "CONECTADO" : "NO conectado",
      calendar: args.calendar?.connected ? "CONECTADO" : "NO conectado",
      reputation: args.reputation?.connected ? "CONECTADO" : "NO conectado",
      sheets: args.sheets?.connected ? "CONECTADO" : "NO conectado",
    },
    upcoming_retail_events: calendar.upcoming,
    recently_passed_retail_events: calendar.recently_passed,
    module_payloads: {
      gmail: args.gmail,
      calendar: args.calendar,
      sheets: args.sheets,
      reputation: args.reputation,
    },
  };
}
