#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const backupDir = path.join(
  root,
  "n8n-workflows/backups/2026-08-18-construccion"
);
const outputPath = path.join(
  root,
  "n8n-workflows/08-construccion-consolidado.json"
);

function readWorkflow(filename) {
  const parsed = JSON.parse(fs.readFileSync(path.join(backupDir, filename), "utf8"));
  const workflow = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!workflow?.id || !Array.isArray(workflow.nodes) || !workflow.connections) {
    throw new Error(`${filename} no contiene un workflow válido`);
  }
  return structuredClone(workflow);
}

function renameNode(workflow, previousName, nextName) {
  const node = workflow.nodes.find((candidate) => candidate.name === previousName);
  if (!node) throw new Error(`No se encontró el nodo ${previousName}`);
  node.name = nextName;

  if (workflow.connections[previousName]) {
    workflow.connections[nextName] = workflow.connections[previousName];
    delete workflow.connections[previousName];
  }

  for (const connection of Object.values(workflow.connections)) {
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        for (const target of branch) {
          if (target.node === previousName) target.node = nextName;
        }
      }
    }
  }

  if (workflow.staticData?.[`node:${previousName}`]) {
    workflow.staticData[`node:${nextName}`] =
      workflow.staticData[`node:${previousName}`];
    delete workflow.staticData[`node:${previousName}`];
  }
}

function validateWorkflow(workflow) {
  const names = workflow.nodes.map((node) => node.name);
  const ids = workflow.nodes.map((node) => node.id);
  if (new Set(names).size !== names.length) throw new Error("Hay nombres de nodo duplicados");
  if (new Set(ids).size !== ids.length) throw new Error("Hay identificadores de nodo duplicados");

  const nameSet = new Set(names);
  for (const [source, connection] of Object.entries(workflow.connections)) {
    if (!nameSet.has(source)) throw new Error(`La conexión parte de un nodo inexistente: ${source}`);
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        for (const target of branch) {
          if (!nameSet.has(target.node)) {
            throw new Error(`La conexión apunta a un nodo inexistente: ${target.node}`);
          }
        }
      }
    }
  }

  const forbiddenLegacyNodes = workflow.nodes.filter((node) =>
    /Leroy|OBRAMAT|Gemini.*retail|Validar JSON precios IA|Merge retail/i.test(
      node.name
    )
  );
  if (forbiddenLegacyNodes.length > 0) {
    throw new Error(
      `Persisten nodos retail antiguos: ${forbiddenLegacyNodes
        .map((node) => node.name)
        .join(", ")}`
    );
  }

  const directRetailRequests = workflow.nodes.filter(
    (node) =>
      node.type === "n8n-nodes-base.httpRequest" &&
      /manomano|leroymerlin|obramat/i.test(String(node.parameters?.url || ""))
  );
  if (directRetailRequests.length > 0) {
    throw new Error("El workflow aún contiene scraping retail por HTTP directo");
  }

  const priceRunner = workflow.nodes.find(
    (node) => node.name === "ManoMano · Rastrear y enviar precios"
  );
  if (
    !priceRunner ||
    priceRunner.type !== "n8n-nodes-base.executeCommand" ||
    !String(priceRunner.parameters?.command || "").includes(
      "scripts/scraper-precios.js"
    )
  ) {
    throw new Error("Falta el rastreador Puppeteer verificado de ManoMano");
  }
}

const legacy = readWorkflow("legacy-construccion-51-nodos.json");
const official = readWorkflow("fuentes-oficiales-publicado.json");
const manomano = readWorkflow("manomano-publicado.json");

renameNode(
  official,
  "Cada día 08:00",
  "Fuentes oficiales · Cada día 08:00"
);
renameNode(
  official,
  "Manual Trigger",
  "Fuentes oficiales · Ejecutar manualmente"
);

const manomanoNames = new Map([
  ["Cada día 06:00", "ManoMano · Cada día 06:00"],
  ["Ejecutar manualmente", "ManoMano · Ejecutar manualmente"],
  [
    "Comprobar solicitudes cada minuto",
    "ManoMano · Comprobar solicitudes cada minuto",
  ],
  ["Recoger solicitud de ENLAZE", "ManoMano · Recoger solicitud de ENLAZE"],
  ["Continuar si hay solicitud", "ManoMano · Continuar si hay solicitud"],
  [
    "Rastrear todos los precios y enviar a ENLAZE",
    "ManoMano · Rastrear y enviar precios",
  ],
]);
for (const [previousName, nextName] of manomanoNames) {
  renameNode(manomano, previousName, nextName);
}

for (const node of manomano.nodes) {
  node.position = [node.position[0] + 2300, node.position[1]];
}

const consolidated = {
  ...legacy,
  id: "wfdP2cJs0ioJAJ6g",
  name: "ENLAZE - Construcción y reformas · consolidado",
  description:
    "Fuentes oficiales a las 08:00 y ManoMano por Puppeteer a las 06:00. " +
    "Sin scraping HTTP retail, proveedores mal atribuidos ni precios de respaldo.",
  active: false,
  activeVersionId: null,
  isArchived: false,
  nodes: [...official.nodes, ...manomano.nodes],
  connections: {
    ...official.connections,
    ...manomano.connections,
  },
  settings: {
    ...official.settings,
    ...manomano.settings,
    timezone: "Europe/Madrid",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
  },
  staticData: {
    ...(official.staticData || {}),
    ...(manomano.staticData || {}),
  },
  pinData: {},
  triggerCount: 0,
  versionMetadata: {
    name: "Consolidación segura de fuentes de construcción",
    description:
      "Sustituye el workflow legado por los dos flujos publicados y verificados.",
  },
};

validateWorkflow(consolidated);
fs.writeFileSync(outputPath, `${JSON.stringify([consolidated], null, 2)}\n`);

console.log(
  `Workflow consolidado: ${consolidated.nodes.length} nodos, ` +
    `${Object.keys(consolidated.connections).length} conexiones de origen`
);
console.log(outputPath);
