#!/usr/bin/env node
/**
 * Mide el prompt del briefing diario antes y después del enfoque híbrido, con
 * los mismos datos de entrada (__tests__/fixtures/briefing-dia-completo.json).
 *
 *   node scripts/medir-briefing-tokens.mjs
 *   node scripts/medir-briefing-tokens.mjs --usuarios 500
 *
 * Los CARACTERES son exactos. Los TOKENS son exactos si ANTHROPIC_API_KEY
 * tiene saldo (se usa /v1/messages/count_tokens, que no se factura); si no,
 * se estiman con el contador local de abajo y la salida lo dice.
 */
import fs from "node:fs";
import path from "node:path";
import {
  cargarEnvLocal,
  FIXTURE_PATH,
  loadFixture,
  loadNodeCode,
  runBuildPromptNode,
} from "../__tests__/lib/briefing-node-harness.mjs";
import { getSectorIntel } from "../lib/agent/sector-intel.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const NODO_PREVIO = path.join(ROOT, "__tests__/fixtures/briefing-prompt-node-previo.js");
const MODELO = "claude-sonnet-4-6";

/** Precio por millón de tokens [entrada, salida] — tarifa oficial de Anthropic. */
const PRECIO_USD = { entrada: 3, salida: 15 };
/** Salida medida del briefing, según el comentario de max_tokens del workflow. */
const TOKENS_SALIDA = 790;

/**
 * Contador local, para cuando no hay saldo.
 *
 * No es el tokenizador de Anthropic (no es público). Aproxima su
 * comportamiento: cada signo de puntuación cuenta como una pieza y cada
 * palabra se parte en trozos de ~4 caracteres. Sobre texto plano y sobre JSON
 * da resultados distintos, que es justo lo que interesa medir aquí: el JSON
 * gasta más tokens por carácter que la prosa.
 */
export function estimarTokens(texto) {
  if (!texto) return 0;
  const piezas = String(texto).match(/[A-Za-zÀ-ÿ0-9]+|[^\sA-Za-zÀ-ÿ0-9]/g) || [];
  let total = 0;
  for (const pieza of piezas) {
    total += /^[A-Za-zÀ-ÿ0-9]+$/.test(pieza) ? Math.ceil(pieza.length / 4) : 1;
  }
  return total;
}

async function contarConApi(system, user) {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) return null;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "x-api-key": clave,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODELO, system, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data.input_tokens === "number" ? data.input_tokens : null;
  } catch {
    return null;
  }
}

function fmt(n, decimales = 0) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function fila(etiqueta, antes, despues, decimales = 0) {
  const delta = despues - antes;
  const pct = antes > 0 ? (delta / antes) * 100 : 0;
  return [
    etiqueta.padEnd(30),
    fmt(antes, decimales).padStart(12),
    fmt(despues, decimales).padStart(12),
    ((delta > 0 ? "+" : "") + fmt(delta, decimales)).padStart(12),
    ((pct > 0 ? "+" : "") + fmt(pct, 1) + " %").padStart(10),
  ].join("");
}

async function main() {
  cargarEnvLocal();
  const idx = process.argv.indexOf("--usuarios");
  const usuarios = idx !== -1 ? Number(process.argv[idx + 1]) || 100 : 100;

  const payload = loadFixture();
  const userConfig = {
    agent_name: "Agente de Comercio",
    agent_persona_prompt:
      "Eres el agente de comercio local de ENLAZE, especializado en tiendas de barrio.",
    sector_intel: getSectorIntel(payload.sector),
  };

  const previo = fs.readFileSync(NODO_PREVIO, "utf8");
  const actual = loadNodeCode("Build Claude Prompt");

  const versiones = {};
  for (const [nombre, codigo] of [["antes", previo], ["despues", actual]]) {
    const salida = runBuildPromptNode(codigo, { payload, userConfig });
    const body = salida._anthropic_body;
    const system = body.system;
    const user = body.messages[0].content;
    const exacto = await contarConApi(system, user);
    versiones[nombre] = {
      system,
      user,
      caracteres: system.length + user.length,
      tokens: exacto ?? estimarTokens(system) + estimarTokens(user),
      exacto: exacto !== null,
    };
  }

  const a = versiones.antes;
  const d = versiones.despues;
  const exacto = a.exacto && d.exacto;

  const coste = (tokensEntrada) =>
    (tokensEntrada / 1e6) * PRECIO_USD.entrada + (TOKENS_SALIDA / 1e6) * PRECIO_USD.salida;

  console.log("");
  console.log(`Briefing diario — prompt antes y después del enfoque híbrido`);
  console.log(`Datos de entrada: ${path.relative(ROOT, FIXTURE_PATH)} (las cuatro integraciones conectadas)`);
  console.log(`Modelo: ${MODELO} · ${PRECIO_USD.entrada} $/MTok entrada, ${PRECIO_USD.salida} $/MTok salida`);
  console.log(
    exacto
      ? "Tokens: exactos (endpoint count_tokens de Anthropic)."
      : "Tokens: ESTIMADOS con el contador local — la clave de Anthropic no tiene saldo.",
  );
  console.log("");
  console.log(
    "".padEnd(30) + "antes".padStart(12) + "después".padStart(12) + "dif.".padStart(12) + "".padStart(10),
  );
  console.log("-".repeat(76));
  console.log(fila("Caracteres del prompt", a.caracteres, d.caracteres));
  console.log(fila("Tokens de entrada", a.tokens, d.tokens));
  console.log(fila("Tokens de salida (medidos)", TOKENS_SALIDA, TOKENS_SALIDA));
  console.log("-".repeat(76));
  console.log(fila("Coste por briefing ($)", coste(a.tokens), coste(d.tokens), 5));
  console.log(fila(`Coste diario, ${usuarios} usuarios ($)`, coste(a.tokens) * usuarios, coste(d.tokens) * usuarios, 3));
  console.log(
    fila(`Coste mensual, ${usuarios} usuarios ($)`, coste(a.tokens) * usuarios * 30, coste(d.tokens) * usuarios * 30, 2),
  );
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
