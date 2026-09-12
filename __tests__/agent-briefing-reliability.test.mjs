/**
 * Protege las garantías de coste y fiabilidad del briefing diario en el
 * workflow de comercio local. Si alguien reimporta el workflow desde n8n y
 * pierde uno de estos ajustes, estos tests lo cantan.
 *
 *   node --test __tests__/agent-briefing-reliability.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, "n8n-workflow-comercio-local-v6.3.json");

function loadWorkflow() {
  const parsed = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function node(name) {
  const workflow = loadWorkflow();
  const found = workflow.nodes.find((n) => n.name === name);
  assert.ok(found, `no existe el nodo ${name}`);
  return found;
}

/* ── Coste ─────────────────────────────────────────────────────────────── */

test("el contexto del prompt no lleva las URLs base64 de Google News", () => {
  const code = node("Build Claude Prompt").parameters.jsCode;
  const newsMap = code.slice(code.indexOf("ctx.news = fetchedNews"));
  const block = newsMap.slice(0, newsMap.indexOf("}));"));
  assert.ok(
    !/\burl\s*:/.test(block),
    "ctx.news vuelve a incluir url: son ~3.400 caracteres que el modelo no usa",
  );
  // Lo que sí necesita para poder citar una noticia.
  assert.match(block, /title:\s*n\.title/);
  assert.match(block, /source:\s*n\.source/);
});

/* ── Truncado ──────────────────────────────────────────────────────────── */

test("max_tokens deja margen sobre la salida medida (~790 tokens)", () => {
  const code = node("Build Claude Prompt").parameters.jsCode;
  const match = code.match(/max_tokens:\s*(\d+)/);
  assert.ok(match, "no se encuentra max_tokens en el cuerpo de la petición");
  assert.ok(
    Number(match[1]) >= 2048,
    `max_tokens=${match[1]} es demasiado justo: la salida medida llega a ~790 tokens`,
  );
});

/* ── Fiabilidad ────────────────────────────────────────────────────────── */

test("las llamadas al modelo reintentan con espera y con timeout holgado", () => {
  const briefing = node("Generate AI Briefing");
  assert.equal(briefing.retryOnFail, true);
  assert.ok(briefing.maxTries >= 3, `maxTries=${briefing.maxTries}`);
  assert.ok(
    briefing.waitBetweenTries >= 2000,
    `waitBetweenTries=${briefing.waitBetweenTries}`,
  );
  assert.ok(
    briefing.parameters.options.timeout >= 60000,
    `timeout=${briefing.parameters.options.timeout}: 30s se quedaba corto`,
  );
  // Si aun así falla, el flujo tiene que continuar hasta guardar el respaldo.
  assert.equal(briefing.continueOnFail, true);
  assert.equal(briefing.alwaysOutputData, true);

  const news = node("Fetch Sector News");
  assert.equal(news.retryOnFail, true);
  assert.ok(news.maxTries >= 2, `maxTries=${news.maxTries}`);
  assert.ok(news.waitBetweenTries >= 2000);
});

test("guardar el briefing reintenta (el upsert del backend lo hace idempotente)", () => {
  const send = node("Send to ENLAZE");
  assert.equal(send.retryOnFail, true);
  assert.ok(send.maxTries >= 2, `maxTries=${send.maxTries}`);
});

test("los módulos por usuario reintentan dentro del nodo Code", () => {
  const code = node("Run User Modules").parameters.jsCode;
  assert.match(code, /MODULE_MAX_TRIES/);
  assert.match(code, /for \(let attempt = 1; attempt <= MODULE_MAX_TRIES/);
  // Los 4xx no se reintentan: ni la clave ni el usuario cambian entre intentos.
  assert.match(code, /if \(resp\.status < 500\) return last;/);
});

/* ── Respaldo mecánico: ningún usuario sin briefing ────────────────────── */

const payload = {
  user_id: "u-123",
  business_name: "Panadería San Juan",
  daily_summary: {
    headline: "Panadería San Juan: día sin urgencias. | 2 alerta(s) de costes.",
    priority_actions: ["2 alerta(s) de costes — revisar márgenes"],
    top_priorities: [
      { action: "Responde a Distribuciones Pérez", why: "Lleva 3 días esperando", time: "15 min" },
    ],
    opportunities_count: 2,
    risks_count: 1,
    tasks_high: 1,
  },
};

/** Ejecuta el código del nodo Merge AI Briefing con $json y $() simulados. */
function runMerge(claudeResponse, { breakPairing = false } = {}) {
  const code = node("Merge AI Briefing").parameters.jsCode;
  const $ = () => ({
    get item() {
      if (breakPairing) throw new Error("no pairing info");
      return { json: { _original_payload: payload } };
    },
    first: () => ({ json: { _original_payload: payload } }),
  });
  // eslint-disable-next-line no-new-func
  return new Function("$json", "$", code)(claudeResponse, $).json;
}

test("una respuesta correcta se marca como escrita por la IA", () => {
  const out = runMerge({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          headline: "Rebajas en su recta final",
          narrative: "Texto del modelo.",
          top_actions: [{ action: "a", why: "b", when: "hoy", impact: "alto" }],
          watch_outs: [],
          opportunities: [],
          mood: "neutro",
        }),
      },
    ],
  });
  const ai = out.daily_summary.ai_briefing;
  assert.equal(ai.source, "ai");
  assert.equal(ai.error, undefined);
  assert.equal(ai.headline, "Rebajas en su recta final");
  assert.equal(ai.truncated, false);
});

test("acepta JSON envuelto en vallas de markdown", () => {
  const out = runMerge({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '```json\n{"headline":"Con vallas"}\n```' }],
  });
  assert.equal(out.daily_summary.ai_briefing.source, "ai");
  assert.equal(out.daily_summary.ai_briefing.headline, "Con vallas");
});

// El escenario que dejó 16 de 56 briefings sin texto: cada uno de estos modos
// de fallo tiene que producir una fila guardable, nunca una excepción.
const failureModes = [
  ["salida truncada por max_tokens", { stop_reason: "max_tokens", content: [{ type: "text", text: '{"headline":"medio cortad' }] }, {}],
  ["timeout / error de red del nodo HTTP", { error: "ETIMEDOUT after 120000ms" }, {}],
  ["error de la API de Anthropic", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, {}],
  ["respuesta sin bloques de texto", { content: [] }, {}],
  ["n8n no puede emparejar los items", { error: "connect ECONNREFUSED" }, { breakPairing: true }],
  ["$json no es un objeto", null, {}],
];

for (const [label, response, opts] of failureModes) {
  test(`respaldo mecánico: ${label}`, () => {
    const out = runMerge(response, opts);
    const ai = out.daily_summary.ai_briefing;

    assert.equal(ai.source, "mechanical_fallback");
    assert.ok(ai.error, "el motivo del fallo tiene que quedar registrado");

    // Lo que garantiza que el usuario ve algo: titular, narrativa y acciones.
    assert.ok(ai.headline && ai.headline.length > 0, "sin titular");
    assert.ok(ai.narrative && ai.narrative.length > 0, "sin narrativa");
    assert.ok(Array.isArray(ai.top_actions) && ai.top_actions.length > 0, "sin acciones");

    // Y que la fila sigue siendo guardable por /api/agent/ingest.
    assert.equal(out.daily_summary.headline, payload.daily_summary.headline);
    assert.equal(out.user_id, payload.user_id);
  });
}

test("el respaldo no inventa datos que no estén en el resumen mecánico", () => {
  const out = runMerge({ content: [] });
  const ai = out.daily_summary.ai_briefing;
  assert.equal(ai.headline, payload.daily_summary.headline);
  assert.deepEqual(ai.watch_outs, []);
  assert.deepEqual(ai.opportunities, []);
  assert.equal(ai.top_actions[0].action, "Responde a Distribuciones Pérez");
});
