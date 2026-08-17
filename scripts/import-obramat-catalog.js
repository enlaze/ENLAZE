#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_API_URL = "https://enlaze.vercel.app/api/pb/ingest";

function getOption(name, fallback) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const index = process.argv.findIndex(
    (argument) => argument === exact || argument.startsWith(prefix)
  );
  if (index === -1) return fallback;
  const argument = process.argv[index];
  if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  return process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : true;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const inputPath = path.resolve(String(getOption("input", "")));
  const reportOption = getOption("report", "");
  const reportPath = reportOption
    ? path.resolve(String(reportOption))
    : "";
  const summaryOption = getOption("summary-output", "");
  const summaryPath = summaryOption
    ? path.resolve(String(summaryOption))
    : "";
  const apiUrl = String(getOption("api-url", DEFAULT_API_URL));
  const batchSize = Math.min(positiveInteger(getOption("batch-size", 300), 300), 500);
  const maxProducts = positiveInteger(
    getOption("max-products", Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
  const apiKey = process.env.SYNC_API_KEY || process.env.AGENT_API_KEY;
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Indica un archivo válido con --input");
  }
  if (!apiKey) throw new Error("Falta SYNC_API_KEY o AGENT_API_KEY");
  let products = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("El archivo no contiene precios");
  }
  let excludedConflicts = 0;
  if (reportPath) {
    if (!fs.existsSync(reportPath)) {
      throw new Error("El informe indicado con --report no existe");
    }
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const conflictingReferences = new Set(
      (report.conflicts_sample || [])
        .filter(
          (conflict) =>
            new Set((conflict.variants || []).map((variant) => variant.price))
              .size > 1
        )
        .map((conflict) => String(conflict.reference))
    );
    const initialLength = products.length;
    products = products.filter(
      (product) =>
        !conflictingReferences.has(String(product.manufacturer_reference))
    );
    excludedConflicts = initialLength - products.length;
  }
  products = products.slice(0, maxProducts);
  const summary = {
    total: products.length,
    excluded_conflicts: excludedConflicts,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
  };
  for (let offset = 0; offset < products.length; offset += batchSize) {
    const batch = products.slice(offset, offset + batchSize);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider_name: "OBRAMAT",
        sector: "construccion",
        source_url: batch[0].catalog_url,
        products: batch,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(
        `Lote ${offset / batchSize + 1}: HTTP ${response.status} ${JSON.stringify(result)}`
      );
    }
    summary.inserted += Number(result.inserted || 0);
    summary.updated += Number(result.updated || 0);
    summary.unchanged += Number(result.unchanged || 0);
    summary.errors += Number(result.errors || 0);
    console.log(
      `[${Math.min(offset + batch.length, products.length)}/${products.length}] ` +
        `altas=${result.inserted || 0}, actualizados=${result.updated || 0}, ` +
        `sin cambios=${result.unchanged || 0}, errores=${result.errors || 0}`
    );
    if (result.errors) {
      throw new Error(`La API rechazó ${result.errors} precios del lote`);
    }
    await sleep(250);
  }
  if (summaryPath) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  }
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
