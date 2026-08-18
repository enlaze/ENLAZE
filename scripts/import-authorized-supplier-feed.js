#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Imports a price feed supplied or expressly authorized by the provider.
 * It never fetches protected product pages and runs as a dry-run by default.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_API_URL = "https://enlaze.vercel.app/api/pb/ingest";

const PROVIDERS = {
  leroy: {
    name: "Leroy Merlin",
    skuPrefix: "LM-",
    referencePattern: /^\d+$/,
    productOrigin: "https://www.leroymerlin.es",
    seller: "Leroy Merlin",
    evidenceType: "official_product_listing",
    priceIncludesVat: true,
  },
  "grupo-puma": {
    name: "Grupo Puma",
    skuPrefix: "PUMA-",
    referencePattern: /^[A-Z0-9][A-Z0-9._-]*$/i,
    productOrigin: "https://www.grupopuma.com",
    seller: "Grupo Puma",
    evidenceType: "authorized_price_tariff",
  },
};

function getOption(name, fallback = "") {
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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function euroLabel(value) {
  return `${Number(value).toFixed(2).replace(".", ",")} €`;
}

function canonicalUrl(value, expectedOrigin) {
  const url = new URL(String(value));
  url.hash = "";
  if (url.origin !== expectedOrigin) {
    throw new Error(`URL fuera del dominio oficial: ${url.href}`);
  }
  return url.href;
}

function normalizeInput(raw) {
  if (Array.isArray(raw)) return { source: {}, products: raw };
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.products)) {
    throw new Error("El feed debe contener un array products");
  }
  return { source: raw.source || {}, products: raw.products };
}

function buildProducts(providerKey, provider, feed, inputSha256, authorization) {
  const observedAt = new Date().toISOString();
  const pricesBySku = new Map();
  const productsBySku = new Map();
  const source = feed.source;

  let pumaCatalogUrl = "";
  if (providerKey === "grupo-puma") {
    pumaCatalogUrl = canonicalUrl(source.catalog_url, provider.productOrigin);
    if (!new URL(pumaCatalogUrl).pathname.startsWith("/uploads/")) {
      throw new Error("La tarifa de Grupo Puma debe proceder de /uploads/ oficial");
    }
    if (!Number.isFinite(Date.parse(source.catalog_published_at || ""))) {
      throw new Error("Falta catalog_published_at válido para Grupo Puma");
    }
    if (typeof source.price_includes_vat !== "boolean") {
      throw new Error("Indica price_includes_vat para la tarifa de Grupo Puma");
    }
  }

  for (const row of feed.products) {
    const name = String(row.name || "").trim();
    const reference = String(row.reference || row.manufacturer_reference || "")
      .trim()
      .replace(new RegExp(`^${provider.skuPrefix}`, "i"), "");
    const price = Number(row.price);
    if (!name || name.length < 4) throw new Error("Producto sin nombre válido");
    if (!provider.referencePattern.test(reference)) {
      throw new Error(`Referencia no válida para ${name}: ${reference}`);
    }
    if (!Number.isFinite(price) || price <= 0 || price >= 100_000) {
      throw new Error(`Precio no válido para ${name}`);
    }

    const sku = `${provider.skuPrefix}${reference}`;
    const previous = pricesBySku.get(sku);
    if (previous !== undefined && Math.abs(previous - price) > 0.001) {
      throw new Error(`La referencia ${sku} tiene precios contradictorios`);
    }
    if (previous !== undefined) continue;
    pricesBySku.set(sku, price);

    const common = {
      name,
      price,
      unit: String(row.unit || "ud"),
      category: String(row.category || "material"),
      subcategory: String(row.subcategory || ""),
      brand: String(row.brand || ""),
      description: String(row.description || ""),
      sku,
      raw_price: String(row.raw_price || euroLabel(price)),
      currency: "EUR",
      seller: provider.seller,
      price_basis: String(row.price_basis || row.unit || "ud"),
      vat_rate: 21,
      observed_at: String(row.observed_at || observedAt),
      evidence_type: provider.evidenceType,
      manufacturer_reference: reference,
      authorization_reference: authorization,
    };

    if (providerKey === "leroy") {
      common.product_url = canonicalUrl(row.product_url, provider.productOrigin);
      common.price_includes_vat = true;
      common.price_scope = String(row.price_scope || "PVP web España");
    } else {
      common.product_url = pumaCatalogUrl;
      common.catalog_url = pumaCatalogUrl;
      common.catalog_sha256 = String(source.catalog_sha256 || inputSha256);
      common.catalog_published_at = String(source.catalog_published_at);
      common.price_includes_vat = source.price_includes_vat;
      common.price_scope = String(source.price_scope || "Tarifa profesional");
    }

    productsBySku.set(sku, common);
  }

  return Array.from(productsBySku.values());
}

async function sendBatch(provider, products, options, batchNumber) {
  const response = await fetch(options.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider_name: provider.name,
      sector: "construccion",
      source_url: products[0].product_url,
      products,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(
      `Lote ${batchNumber}: HTTP ${response.status} ${JSON.stringify(result)}`
    );
  }
  return result;
}

async function main() {
  const providerKey = String(getOption("provider", "")).toLowerCase();
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error("Usa --provider leroy o --provider grupo-puma");

  const inputPath = path.resolve(String(getOption("input", "")));
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Indica un feed JSON válido con --input");
  }
  const inputBytes = fs.readFileSync(inputPath);
  const inputSha256 = crypto.createHash("sha256").update(inputBytes).digest("hex");
  const feed = normalizeInput(JSON.parse(inputBytes.toString("utf8")));
  const authorization = String(
    getOption(
      "authorization-reference",
      feed.source.authorization_reference || ""
    )
  ).trim();
  if (!authorization) {
    throw new Error("Falta --authorization-reference del proveedor");
  }

  const products = buildProducts(
    providerKey,
    provider,
    feed,
    inputSha256,
    authorization
  );
  if (products.length === 0) throw new Error("El feed no contiene precios");

  const options = {
    apiUrl: String(getOption("api-url", DEFAULT_API_URL)),
    apiKey: process.env.SYNC_API_KEY || process.env.AGENT_API_KEY,
    batchSize: Math.min(positiveInteger(getOption("batch-size", 300), 300), 500),
    send: hasFlag("send"),
  };
  const summary = {
    provider: provider.name,
    feed_sha256: inputSha256,
    total: products.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    sent: options.send,
  };

  if (!options.send) {
    console.log(JSON.stringify({ ...summary, sample: products.slice(0, 3) }, null, 2));
    return summary;
  }
  if (!options.apiKey) throw new Error("Falta SYNC_API_KEY o AGENT_API_KEY");

  let batchNumber = 0;
  for (let offset = 0; offset < products.length; offset += options.batchSize) {
    batchNumber += 1;
    const result = await sendBatch(
      provider,
      products.slice(offset, offset + options.batchSize),
      options,
      batchNumber
    );
    summary.inserted += Number(result.inserted || 0);
    summary.updated += Number(result.updated || 0);
    summary.unchanged += Number(result.unchanged || 0);
    summary.errors += Number(result.errors || 0);
  }
  if (summary.errors > 0) {
    throw new Error(`La API rechazó ${summary.errors} precios`);
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { buildProducts, main, PROVIDERS };
