#!/usr/bin/env node
/**
 * Inyecta el motor de hechos (lib/agent/briefing-facts.ts) dentro del nodo
 * "Build Claude Prompt" del workflow de comercio local.
 *
 * El nodo de n8n no puede importar módulos del repo, así que el código se pega
 * transpilado entre dos marcadores. Este script es la única forma legítima de
 * tocar esa región; `__tests__/agent-briefing-reliability.test.mjs` falla si el
 * workflow y el .ts se separan.
 *
 *   node scripts/sync-briefing-facts.mjs           → escribe el workflow
 *   node scripts/sync-briefing-facts.mjs --check   → solo comprueba (CI/tests)
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "lib/agent/briefing-facts.ts");
const WORKFLOW = path.join(ROOT, "n8n-workflow-comercio-local-v6.3.json");
const NODE_NAME = "Build Claude Prompt";

const BEGIN = "// BEGIN GENERADO DESDE lib/agent/briefing-facts.ts — NO EDITAR A MANO";
const END = "// END GENERADO DESDE lib/agent/briefing-facts.ts";

/** TS → JS plano, sin `export`, listo para pegar en un nodo Code de n8n. */
export function transpileFactsEngine(tsSource) {
  // Se quitan los `export` ANTES de transpilar: con ellos TypeScript trata el
  // fichero como módulo y emite `exports.__esModule`, que revienta dentro del
  // nodo Code. Sin ellos queda un script plano con funciones globales, que es
  // exactamente lo que n8n necesita.
  const comoScript = tsSource.replace(/^export\s+/gm, "");
  const { outputText, diagnostics } = ts.transpileModule(comoScript, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: true,
  });
  if (diagnostics && diagnostics.length > 0) {
    throw new Error(
      "briefing-facts.ts no transpila limpio: " +
        diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join(" | "),
    );
  }
  // `module: None` deja las funciones como declaraciones globales, que es
  // justo lo que necesita el nodo. Solo hay que quitar la palabra `export`.
  return outputText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Devuelve el jsCode con la región generada sustituida. */
export function injectFactsEngine(jsCode, generated) {
  const beginIdx = jsCode.indexOf(BEGIN);
  const endIdx = jsCode.indexOf(END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`El nodo "${NODE_NAME}" no tiene los marcadores de la región generada`);
  }
  const beforeEnd = jsCode.lastIndexOf("\n", endIdx);
  const head = jsCode.slice(0, beginIdx + BEGIN.length);
  const tail = jsCode.slice(beforeEnd);
  return (
    head +
    "\n// Regenerar con: npm run sync:briefing-facts\n" +
    "// ══════════════════════════════════════════════════════════════════════════\n" +
    generated +
    "\n// ══════════════════════════════════════════════════════════════════════════" +
    tail
  );
}

export function buildSyncedWorkflow() {
  const raw = fs.readFileSync(WORKFLOW, "utf8");
  const parsed = JSON.parse(raw);
  const workflow = Array.isArray(parsed) ? parsed[0] : parsed;
  const node = workflow.nodes.find((n) => n.name === NODE_NAME);
  if (!node) throw new Error(`No existe el nodo ${NODE_NAME}`);

  const generated = transpileFactsEngine(fs.readFileSync(SOURCE, "utf8"));
  const next = injectFactsEngine(node.parameters.jsCode, generated);
  return { raw, parsed, workflow, node, next, changed: next !== node.parameters.jsCode };
}

function main() {
  const check = process.argv.includes("--check");
  const { raw, parsed, node, next, changed } = buildSyncedWorkflow();

  if (check) {
    if (changed) {
      console.error("El motor de hechos del workflow está desincronizado con lib/agent/briefing-facts.ts.");
      console.error("Ejecuta: npm run sync:briefing-facts");
      process.exit(1);
    }
    console.log("El workflow y lib/agent/briefing-facts.ts están sincronizados.");
    return;
  }

  if (!changed) {
    console.log("Sin cambios: el workflow ya estaba sincronizado.");
    return;
  }
  node.parameters.jsCode = next;
  // Se respeta el salto final tal y como venía, para no ensuciar el diff.
  const eol = raw.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(WORKFLOW, JSON.stringify(parsed, null, 2) + eol);
  console.log(`Nodo "${NODE_NAME}" actualizado (${next.length} caracteres).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
