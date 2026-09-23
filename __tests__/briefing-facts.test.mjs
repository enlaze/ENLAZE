/**
 * Protege el enfoque híbrido del briefing: los hechos se calculan en código y
 * el modelo solo redacta.
 *
 * Aquí se vigilan tres cosas:
 *   1. que el prompt ya no lleve el ctx volcado en JSON,
 *   2. que el bloque de hechos diga los números como se dicen en castellano,
 *   3. que el motor del repo y el pegado dentro del nodo de n8n no se separen.
 *
 *   node --import tsx --test __tests__/briefing-facts.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildBriefingFacts,
  esperaEs,
  eurosEs,
  fechaLargaEs,
  numeroEs,
  plural,
  variacionEs,
} from "../lib/agent/briefing-facts.ts";
import { buildSyncedWorkflow } from "../scripts/sync-briefing-facts.mjs";
import { getSectorIntel } from "../lib/agent/sector-intel.ts";
import {
  loadFixture,
  loadNodeCode,
  ROOT,
  runBuildPromptNode,
} from "./lib/briefing-node-harness.mjs";

const NODO_PREVIO = path.join(ROOT, "__tests__/fixtures/briefing-prompt-node-previo.js");

function construirPrompt(codigo = loadNodeCode("Build Claude Prompt"), payload = loadFixture()) {
  const userConfig = {
    agent_name: "Agente de Comercio",
    agent_persona_prompt: "Eres el agente de comercio local de ENLAZE.",
    sector_intel: getSectorIntel(payload.sector),
  };
  const salida = runBuildPromptNode(codigo, { payload, userConfig });
  const body = salida._anthropic_body;
  return { body, system: body.system, user: body.messages[0].content, salida };
}

function bloqueDeHechos(user) {
  const i = user.indexOf("HECHOS DE HOY:");
  assert.ok(i !== -1, "el prompt no lleva el bloque de hechos");
  return user.slice(i + "HECHOS DE HOY:".length).trim();
}

/* ── Formato en castellano ─────────────────────────────────────────────── */

test("los importes se escriben como se escriben en España", () => {
  assert.equal(eurosEs(2480.5), "2.480,50 €");
  assert.equal(eurosEs(1310), "1.310,00 €");
  assert.equal(eurosEs(0), "0,00 €");
  assert.equal(eurosEs(null), "");
  assert.equal(numeroEs(4120, 0), "4.120");
});

test("la espera se dice en días a partir de las 24 horas", () => {
  // El caso concreto que el prompt viejo tenía que prohibir a mano: "107h".
  assert.equal(esperaEs(107), "4 días");
  assert.equal(esperaEs(24), "1 día");
  assert.equal(esperaEs(20), "20 horas");
  assert.equal(esperaEs(1), "1 hora");
  assert.equal(esperaEs(0.2), "menos de una hora");
});

test("las variaciones se cuentan en palabras, no en signos", () => {
  assert.equal(variacionEs(-12.4), "baja un 12,4 %");
  assert.equal(variacionEs(22.5), "sube un 22,5 %");
  assert.equal(variacionEs(0.1), "se mantiene");
});

test("las fechas se dicen, no se listan en ISO", () => {
  assert.equal(fechaLargaEs("2026-09-18", 2026), "18 de septiembre");
  assert.equal(fechaLargaEs("2025-12-24", 2026), "24 de diciembre de 2025");
});

test("los plurales concuerdan", () => {
  assert.equal(plural(1, "cita", "citas"), "1 cita");
  assert.equal(plural(3, "cita", "citas"), "3 citas");
});

/* ── El bloque de hechos ───────────────────────────────────────────────── */

test("el prompt ya no lleva el ctx volcado en JSON", () => {
  const codigo = loadNodeCode("Build Claude Prompt");
  assert.ok(
    !/JSON\.stringify\(ctx/.test(codigo),
    "el nodo vuelve a serializar el ctx: el modelo tendría que interpretar cifras otra vez",
  );
  const { user } = construirPrompt(codigo);
  const hechos = bloqueDeHechos(user);
  assert.ok(!hechos.includes('":'), "hay claves JSON en los hechos");
  assert.ok(!hechos.includes("  "), "hay indentación en los hechos");
  assert.ok(!/https?:\/\//.test(hechos), "hay URLs en los hechos");
});

test("los hechos traen los números ya resueltos y en castellano", () => {
  const { user } = construirPrompt();
  const hechos = bloqueDeHechos(user);
  assert.match(hechos, /2\.480,50 €/, "el importe de la factura vencida");
  assert.match(hechos, /VENCIDA el 18 de septiembre/, "el vencimiento, ya juzgado");
  assert.match(hechos, /Lleva 4 días esperando/, "la espera, ya convertida a días");
  assert.match(hechos, /baja un 12,4 % respecto a la semana pasada/, "la comparativa semanal");
  assert.match(hechos, /Hoy es miércoles, 23 de septiembre de 2026/, "el día, con su tilde");
});

test("los correos de ruido no llegan al modelo", () => {
  const { user } = construirPrompt();
  const hechos = bloqueDeHechos(user);
  assert.ok(
    !hechos.includes("Newsletter Panadería Hoy"),
    "un boletín comercial no puede ocupar sitio en el briefing",
  );
});

test("una hoja de ventas poco fiable no produce cifras de ventas", () => {
  const payload = loadFixture();
  payload.sheets.detection_confidence = "low";
  const { user } = construirPrompt(loadNodeCode("Build Claude Prompt"), payload);
  const hechos = bloqueDeHechos(user);
  assert.match(hechos, /no se ha podido interpretar con fiabilidad/);
  assert.ok(!hechos.includes("842,30 €"), "sigue colando el dato de ayer");
});

test("la estacionalidad llega resuelta al mes en curso", () => {
  const sector = {
    sector_key: "prueba",
    kpis_focus: [],
    seasonal_focus: [
      { key: "ahora", name: "Vuelta al cole", months: [9], note: "Se recupera el consumo de desayuno" },
      { key: "luego", name: "Navidad", months: [12], note: "Cestas y lotes de regalo" },
    ],
    campaign_archetypes: [],
    regulatory_notes: [],
    supplier_types: [],
  };
  const hechos = buildBriefingFacts({ date: "2026-09-23", sector_intel: sector });
  assert.match(hechos, /Vuelta al cole/);
  assert.ok(!hechos.includes("Navidad"), "en septiembre no toca hablar de Navidad");
});

test("un ctx vacío no revienta y lo dice sin inventar nada", () => {
  for (const entrada of [null, undefined, {}, { config: null, gmail_intel: null }]) {
    const hechos = buildBriefingFacts(entrada);
    assert.equal(typeof hechos, "string");
    assert.ok(hechos.length > 0);
  }
});

/* ── Coste ─────────────────────────────────────────────────────────────── */

test("el prompt nuevo es mucho más corto que el que volcaba el ctx", () => {
  const previo = construirPrompt(fs.readFileSync(NODO_PREVIO, "utf8"));
  const actual = construirPrompt();
  const antes = previo.system.length + previo.user.length;
  const despues = actual.system.length + actual.user.length;
  assert.ok(
    despues < antes * 0.5,
    `el prompt pasó de ${antes} a ${despues} caracteres: se esperaba al menos la mitad`,
  );
});

/* ── Deriva entre el repo y el workflow ────────────────────────────────── */

test("el motor pegado en el nodo es el de lib/agent/briefing-facts.ts", () => {
  const { changed } = buildSyncedWorkflow();
  assert.equal(
    changed,
    false,
    "el workflow y lib/agent/briefing-facts.ts se han separado: ejecuta `npm run sync:briefing-facts`",
  );
});

test("el nodo llama al motor de hechos y no a otra cosa", () => {
  const codigo = loadNodeCode("Build Claude Prompt");
  assert.match(codigo, /const hechosDelDia = buildBriefingFacts\(ctx\);/);
  assert.match(codigo, /function buildBriefingFacts\(/);
});
