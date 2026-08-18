import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(
  root,
  "n8n-workflows/08-construccion-consolidado.json"
);

function loadWorkflow() {
  const parsed = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

test("el workflow consolidado conserva el ID y queda listo como borrador", () => {
  const workflow = loadWorkflow();
  assert.equal(workflow.id, "wfdP2cJs0ioJAJ6g");
  assert.equal(workflow.active, false);
  assert.equal(workflow.activeVersionId, null);
  assert.equal(workflow.settings.timezone, "Europe/Madrid");
});

test("no conserva scraping retail legado ni proveedores mal atribuidos", () => {
  const workflow = loadWorkflow();
  const serializedNodes = JSON.stringify(workflow.nodes);
  assert.doesNotMatch(serializedNodes, /Leroy|OBRAMAT|precios de respaldo/i);

  const directRetailRequests = workflow.nodes.filter(
    (node) =>
      node.type === "n8n-nodes-base.httpRequest" &&
      /manomano|leroymerlin|obramat/i.test(String(node.parameters?.url || ""))
  );
  assert.equal(directRetailRequests.length, 0);
});

test("usa el rastreador Puppeteer cancelable y mantiene las fuentes oficiales", () => {
  const workflow = loadWorkflow();
  const runner = workflow.nodes.find(
    (node) => node.name === "ManoMano · Rastrear y enviar precios"
  );
  assert.ok(runner);
  assert.equal(runner.type, "n8n-nodes-base.executeCommand");
  assert.match(runner.parameters.command, /scripts\/scraper-precios\.js/);

  const names = new Set(workflow.nodes.map((node) => node.name));
  assert.ok(names.has("CYPE - Generador de precios novedades"));
  assert.ok(names.has("BOE - Normativas"));
  assert.ok(names.has("INE - API Índices materiales construcción"));
  assert.ok(names.has("REE REData - Precio electricidad PVPC"));
});

test("todas las conexiones apuntan a nodos existentes", () => {
  const workflow = loadWorkflow();
  const names = new Set(workflow.nodes.map((node) => node.name));
  assert.equal(names.size, workflow.nodes.length);

  for (const [source, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `origen inexistente: ${source}`);
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        for (const target of branch) {
          assert.ok(names.has(target.node), `destino inexistente: ${target.node}`);
        }
      }
    }
  }
});
