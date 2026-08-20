/**
 * Recurrencia de los envíos programados.
 *
 * Lo que se comprueba aquí es lo que el usuario da por hecho al configurar el
 * envío: que "cada lunes a las 9" sean las 9 de Madrid en invierno y en verano,
 * que un envío de hoy a una hora ya pasada salte a la siguiente ocurrencia y
 * que las recurrencias nunca se queden atascadas en una fecha imposible.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNextRun,
  madridWallClockToUtc,
  weekdayOf,
  validateSchedule,
  validateAudience,
  parseTime,
  parseDate,
} from "../lib/scheduled-messages.ts";

/** Cómo se ve ese instante desde Madrid; es lo que el usuario configuró. */
const inMadrid = (date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
    .format(date)
    .replace(",", "");

const spec = (over) => ({
  schedule_type: "daily",
  send_time: "09:00",
  days_of_week: [],
  day_of_month: null,
  start_date: "2026-08-20",
  ...over,
});

/* ── Zona horaria ────────────────────────────────────────────────────────── */

test("las 09:00 de Madrid son las 07:00 UTC en verano y las 08:00 en invierno", () => {
  assert.equal(madridWallClockToUtc({ y: 2026, m: 7, d: 15 }, 9, 0).toISOString(), "2026-07-15T07:00:00.000Z");
  assert.equal(madridWallClockToUtc({ y: 2026, m: 1, d: 15 }, 9, 0).toISOString(), "2026-01-15T08:00:00.000Z");
});

test("un envío diario mantiene la hora de pared al cruzar el cambio de hora", () => {
  /* Octubre 2026: el domingo 25 se atrasan los relojes. El envío de las 09:00
     tiene que seguir siendo a las 09:00 de Madrid, aunque el UTC cambie. */
  const antes = computeNextRun(spec({ start_date: "2026-10-01" }), new Date("2026-10-24T12:00:00Z"));
  const despues = computeNextRun(spec({ start_date: "2026-10-01" }), new Date("2026-10-26T12:00:00Z"));
  assert.equal(inMadrid(antes), "25/10/2026 09:00");
  assert.equal(inMadrid(despues), "27/10/2026 09:00");
  assert.equal(antes.toISOString(), "2026-10-25T08:00:00.000Z");
  assert.equal(despues.toISOString(), "2026-10-27T08:00:00.000Z");
});

/* ── Una vez ─────────────────────────────────────────────────────────────── */

test("un envío único devuelve su instante, y null cuando ya ha pasado", () => {
  const s = spec({ schedule_type: "once", start_date: "2026-09-01", send_time: "18:30" });
  assert.equal(computeNextRun(s, new Date("2026-08-20T10:00:00Z")).toISOString(), "2026-09-01T16:30:00.000Z");
  assert.equal(computeNextRun(s, new Date("2026-09-02T10:00:00Z")), null);
});

test("un envío único de hoy a una hora ya pasada no se dispara", () => {
  const s = spec({ schedule_type: "once", start_date: "2026-08-20", send_time: "09:00" });
  assert.equal(computeNextRun(s, new Date("2026-08-20T12:00:00Z")), null);
});

/* ── Cada día ────────────────────────────────────────────────────────────── */

test("cada día: hoy si la hora aún no ha llegado, mañana si ya pasó", () => {
  const s = spec({ send_time: "09:00", start_date: "2026-08-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T05:00:00Z"))), "20/08/2026 09:00");
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T08:00:00Z"))), "21/08/2026 09:00");
});

test("cada día no se adelanta a la fecha de inicio", () => {
  const s = spec({ send_time: "09:00", start_date: "2026-12-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T05:00:00Z"))), "01/12/2026 09:00");
});

/* ── Cada semana ─────────────────────────────────────────────────────────── */

test("lunes = 0 y domingo = 6, como el selector L M X J V S D", () => {
  assert.equal(weekdayOf({ y: 2026, m: 8, d: 17 }), 0); // lunes
  assert.equal(weekdayOf({ y: 2026, m: 8, d: 23 }), 6); // domingo
});

test("cada semana con un solo día salta al siguiente lunes", () => {
  const s = spec({ schedule_type: "weekly", days_of_week: [0], send_time: "09:00", start_date: "2026-08-01" });
  // Jueves 20 de agosto de 2026 → el próximo lunes es el 24.
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T12:00:00Z"))), "24/08/2026 09:00");
});

test("cada semana con varios días elige el más cercano de la lista", () => {
  // Lunes, miércoles y viernes.
  const s = spec({ schedule_type: "weekly", days_of_week: [0, 2, 4], send_time: "09:00", start_date: "2026-08-01" });
  const jueves = computeNextRun(s, new Date("2026-08-20T12:00:00Z"));
  assert.equal(inMadrid(jueves), "21/08/2026 09:00"); // viernes
  const viernesTarde = computeNextRun(s, new Date("2026-08-21T12:00:00Z"));
  assert.equal(inMadrid(viernesTarde), "24/08/2026 09:00"); // lunes siguiente
  const domingo = computeNextRun(s, new Date("2026-08-23T12:00:00Z"));
  assert.equal(inMadrid(domingo), "24/08/2026 09:00");
});

test("cada semana dispara hoy mismo si es su día y aún no ha llegado la hora", () => {
  const s = spec({ schedule_type: "weekly", days_of_week: [0], send_time: "09:00", start_date: "2026-08-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-24T05:00:00Z"))), "24/08/2026 09:00");
});

test("cada semana sin ningún día elegido no tiene próximo disparo", () => {
  const s = spec({ schedule_type: "weekly", days_of_week: [], start_date: "2026-08-01" });
  assert.equal(computeNextRun(s, new Date("2026-08-20T12:00:00Z")), null);
});

/* ── Cada mes ────────────────────────────────────────────────────────────── */

test("cada mes salta al mes siguiente cuando el día ya pasó", () => {
  const s = spec({ schedule_type: "monthly", day_of_month: 5, send_time: "08:30", start_date: "2026-01-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T12:00:00Z"))), "05/09/2026 08:30");
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-03T12:00:00Z"))), "05/08/2026 08:30");
});

test("cada mes cruza el fin de año", () => {
  const s = spec({ schedule_type: "monthly", day_of_month: 1, send_time: "08:30", start_date: "2026-01-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-12-15T12:00:00Z"))), "01/01/2027 08:30");
});

test("cada mes respeta la fecha de inicio aunque el día ya haya llegado", () => {
  const s = spec({ schedule_type: "monthly", day_of_month: 10, send_time: "08:30", start_date: "2027-03-01" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T12:00:00Z"))), "10/03/2027 08:30");
});

/* ── Cada año ────────────────────────────────────────────────────────────── */

test("cada año repite el día y el mes de la fecha de inicio", () => {
  const s = spec({ schedule_type: "yearly", send_time: "10:00", start_date: "2026-03-15" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-08-20T12:00:00Z"))), "15/03/2027 10:00");
  assert.equal(inMadrid(computeNextRun(s, new Date("2026-01-20T12:00:00Z"))), "15/03/2026 10:00");
});

test("un 29 de febrero cae al 28 en los años no bisiestos", () => {
  const s = spec({ schedule_type: "yearly", send_time: "10:00", start_date: "2028-02-29" });
  assert.equal(inMadrid(computeNextRun(s, new Date("2028-03-01T12:00:00Z"))), "28/02/2029 10:00");
  assert.equal(inMadrid(computeNextRun(s, new Date("2027-01-01T12:00:00Z"))), "29/02/2028 10:00");
});

/* ── Encadenado: lo que hace el dispatcher después de enviar ─────────────── */

test("encadenar disparos avanza siempre y nunca se repite", () => {
  const s = spec({ schedule_type: "weekly", days_of_week: [0, 3], send_time: "09:00", start_date: "2026-01-01" });
  let cursor = new Date("2026-08-20T12:00:00Z");
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const next = computeNextRun(s, cursor);
    assert.ok(next.getTime() > cursor.getTime(), "cada disparo tiene que ser posterior al anterior");
    seen.push(inMadrid(next));
    cursor = next;
  }
  assert.equal(new Set(seen).size, seen.length, "no puede repetir instante");
  // Lunes (0) y jueves (3), alternando.
  assert.deepEqual(seen.slice(0, 4), ["24/08/2026 09:00", "27/08/2026 09:00", "31/08/2026 09:00", "03/09/2026 09:00"]);
});

/* ── Validación ──────────────────────────────────────────────────────────── */

test("parseTime y parseDate rechazan lo que no es una hora o una fecha", () => {
  assert.deepEqual(parseTime("09:05"), { hh: 9, mm: 5 });
  assert.deepEqual(parseTime("23:59:30"), { hh: 23, mm: 59 });
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("nueve"), null);
  assert.deepEqual(parseDate("2026-02-28"), { y: 2026, m: 2, d: 28 });
  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("20/08/2026"), null);
});

test("validateSchedule limpia los días y anula lo que no aplica", () => {
  const r = validateSchedule({
    schedule_type: "weekly",
    send_time: "9:00",
    days_of_week: [4, 0, 0, 9, -1],
    day_of_month: 17,
    start_date: "2026-08-20",
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.days_of_week, [0, 4]);
  assert.equal(r.spec.day_of_month, null, "day_of_month no aplica en weekly");
  assert.equal(r.spec.send_time, "09:00");
});

test("validateSchedule rechaza una semana sin días y un mes fuera de rango", () => {
  assert.equal(validateSchedule({ schedule_type: "weekly", send_time: "09:00", days_of_week: [], start_date: "2026-08-20" }).ok, false);
  assert.equal(validateSchedule({ schedule_type: "monthly", send_time: "09:00", day_of_month: 31, start_date: "2026-08-20" }).ok, false);
  assert.equal(validateSchedule({ schedule_type: "cada rato", send_time: "09:00", start_date: "2026-08-20" }).ok, false);
});

test("validateAudience distingue la selección manual del filtro dinámico", () => {
  const manual = validateAudience({ mode: "manual", client_ids: ["a", "a", "b", 7, ""] });
  assert.ok(manual.ok);
  assert.deepEqual(manual.audience, { mode: "manual", client_ids: ["a", "b"] });

  const filtro = validateAudience({ mode: "filter", filter: "overdue_invoice" });
  assert.ok(filtro.ok);
  assert.deepEqual(filtro.audience, { mode: "filter", filter: "overdue_invoice" });

  assert.equal(validateAudience({ mode: "manual", client_ids: [] }).ok, false);
  assert.equal(validateAudience({ mode: "filter", filter: "los buenos" }).ok, false);
  assert.equal(validateAudience({}).ok, false);
});
