#!/usr/bin/env node
/**
 * Compara la CALIDAD del briefing viejo contra el nuevo: mismo día, mismos
 * datos, los dos prompts contra el mismo modelo, y la salida lado a lado.
 *
 *   node scripts/comparar-briefing.mjs
 *   node scripts/comparar-briefing.mjs --salida comparacion.md
 *
 * Si ANTHROPIC_API_KEY no tiene saldo, el script NO falla: deja los dos
 * prompts escritos en .briefing-comparacion/ y avisa de que la comparación
 * queda pendiente de ejecutar. Volver a lanzarlo con saldo la completa.
 */
import fs from "node:fs";
import path from "node:path";
import {
  cargarEnvLocal,
  loadFixture,
  loadNodeCode,
  runBuildPromptNode,
} from "../__tests__/lib/briefing-node-harness.mjs";
import { getSectorIntel } from "../lib/agent/sector-intel.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const NODO_PREVIO = path.join(ROOT, "__tests__/fixtures/briefing-prompt-node-previo.js");
const DESTINO = path.join(ROOT, ".briefing-comparacion");
const MODELO = "claude-sonnet-4-6";

async function pedirBriefing(body) {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) return { ok: false, motivo: "No hay ANTHROPIC_API_KEY en el entorno." };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": clave,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const motivo = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    return { ok: false, motivo, sinSaldo: /credit balance/i.test(String(motivo)) };
  }
  const bloque = (data.content || []).find((c) => c && c.type === "text");
  const bruto = bloque ? String(bloque.text || "") : "";
  const limpio = bruto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return { ok: true, briefing: JSON.parse(limpio), usage: data.usage || null };
  } catch (err) {
    return { ok: false, motivo: `La respuesta no es JSON válido: ${err.message}`, bruto };
  }
}

/** Renderiza un briefing como texto legible, para poder leerlo de un vistazo. */
function comoTexto(b) {
  if (!b) return "(sin respuesta)";
  const lineas = [];
  lineas.push(`TITULAR: ${b.headline || "—"}`);
  lineas.push("");
  lineas.push(b.narrative || "—");
  if (Array.isArray(b.top_actions) && b.top_actions.length > 0) {
    lineas.push("");
    lineas.push("ACCIONES:");
    b.top_actions.forEach((a, i) => {
      lineas.push(`${i + 1}. [${a.impact || "?"}] ${a.action || ""}`);
      if (a.why) lineas.push(`   por qué: ${a.why}`);
      if (a.when) lineas.push(`   cuándo: ${a.when}`);
    });
  }
  for (const [clave, titulo] of [["watch_outs", "A VIGILAR"], ["opportunities", "OPORTUNIDADES"]]) {
    const items = Array.isArray(b[clave]) ? b[clave] : [];
    if (items.length > 0) {
      lineas.push("");
      lineas.push(`${titulo}:`);
      items.forEach((x) => lineas.push(`- ${x}`));
    }
  }
  lineas.push("");
  lineas.push(`TONO: ${b.mood || "—"}`);
  return lineas.join("\n");
}

async function main() {
  cargarEnvLocal();
  const idx = process.argv.indexOf("--salida");
  const nombreSalida = idx !== -1 ? process.argv[idx + 1] : "comparacion.md";

  const payload = loadFixture();
  const userConfig = {
    agent_name: "Agente de Comercio",
    agent_persona_prompt:
      "Eres el agente de comercio local de ENLAZE, especializado en tiendas de barrio.",
    sector_intel: getSectorIntel(payload.sector),
  };

  const versiones = [
    { clave: "antes", titulo: "Briefing VIEJO (ctx en JSON)", codigo: fs.readFileSync(NODO_PREVIO, "utf8") },
    { clave: "despues", titulo: "Briefing NUEVO (hechos en texto)", codigo: loadNodeCode("Build Claude Prompt") },
  ];

  fs.mkdirSync(DESTINO, { recursive: true });

  const resultados = [];
  for (const v of versiones) {
    const salida = runBuildPromptNode(v.codigo, { payload, userConfig });
    const body = salida._anthropic_body;
    fs.writeFileSync(
      path.join(DESTINO, `prompt-${v.clave}.txt`),
      `=== SYSTEM ===\n${body.system}\n\n=== USER ===\n${body.messages[0].content}\n`,
    );
    const respuesta = await pedirBriefing(body);
    resultados.push({ ...v, body, respuesta });
  }

  const fallidos = resultados.filter((r) => !r.respuesta.ok);
  if (fallidos.length > 0) {
    const sinSaldo = fallidos.some((r) => r.respuesta.sinSaldo);
    console.log("");
    console.log("Comparación de calidad: PREPARADA, pendiente de ejecutar.");
    console.log(`Motivo: ${fallidos[0].respuesta.motivo}`);
    console.log("");
    console.log(`Los dos prompts están escritos, listos para lanzar, en ${path.relative(ROOT, DESTINO)}/:`);
    console.log("  - prompt-antes.txt    (ctx volcado en JSON)");
    console.log("  - prompt-despues.txt  (bloque de hechos en castellano)");
    console.log("");
    console.log("Cuando la clave tenga saldo, este mismo comando completa la comparación:");
    console.log("  npm run comparar:briefing");
    console.log("");
    process.exitCode = sinSaldo ? 0 : 1;
    return;
  }

  const md = [];
  md.push("# Briefing viejo contra briefing nuevo");
  md.push("");
  md.push(`Mismo día, mismos datos (\`__tests__/fixtures/briefing-dia-completo.json\`), modelo \`${MODELO}\`.`);
  md.push("");
  md.push("| | " + resultados.map((r) => r.titulo).join(" | ") + " |");
  md.push("|---|" + resultados.map(() => "---").join("|") + "|");
  md.push(
    "| Tokens de entrada | " +
      resultados.map((r) => r.respuesta.usage?.input_tokens ?? "?").join(" | ") +
      " |",
  );
  md.push(
    "| Tokens de salida | " +
      resultados.map((r) => r.respuesta.usage?.output_tokens ?? "?").join(" | ") +
      " |",
  );
  md.push("");
  for (const r of resultados) {
    md.push(`## ${r.titulo}`);
    md.push("");
    md.push("```");
    md.push(comoTexto(r.respuesta.briefing));
    md.push("```");
    md.push("");
  }

  const destino = path.join(DESTINO, nombreSalida);
  fs.writeFileSync(destino, md.join("\n"));

  for (const r of resultados) {
    console.log("");
    console.log("═".repeat(78));
    console.log(r.titulo);
    console.log("═".repeat(78));
    console.log(comoTexto(r.respuesta.briefing));
  }
  console.log("");
  console.log(`Comparación escrita en ${path.relative(ROOT, destino)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
