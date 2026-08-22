#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Rastreador de precios públicos de proveedores oficiales.
 *
 * Uso:
 *   npm run scrape:suppliers -- --dry-run
 *   npm run scrape:suppliers -- --providers leroy,obramat --max-pages 1
 *
 * Principios de fiabilidad:
 * - solo acepta fichas de producto del dominio oficial;
 * - exige referencia estable, URL, precio visible y moneda EUR;
 * - en Leroy Merlin descarta vendedores del marketplace;
 * - conserva el ámbito del precio, la fecha, el IVA y el vendedor como evidencia;
 * - si una categoría falla, no modifica los precios anteriores.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const DEFAULT_API_URL = "https://enlaze.vercel.app/api/pb/ingest";
const DEFAULT_USER_AGENT = "ENLAZE-Public-Price-Monitor/1.0";
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 120_000;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

const PROVIDERS = {
  leroy: {
    key: "leroy",
    name: "Leroy Merlin",
    origin: "https://www.leroymerlin.es",
    skuPrefix: "LM",
    directSellerPattern: /vendido (?:y enviado )?por leroy merlin/i,
    priceScope: "PVP web España",
    categories: [
      {
        key: "cementos",
        name: "Leroy Merlin · Cementos",
        url: "https://www.leroymerlin.es/productos/construccion/cementos-morteros-y-yesos/cementos/",
        category: "material",
        subcategory: "cementos_y_morteros",
      },
      {
        key: "placas_yeso",
        name: "Leroy Merlin · Placas de yeso",
        url: "https://www.leroymerlin.es/productos/construccion/tabiques-y-techos/placas-de-carton-yeso-fibrocemento-y-yeso/placas-de-yeso-p.html",
        category: "material",
        subcategory: "placas_de_yeso",
      },
      {
        key: "puertas",
        name: "Leroy Merlin · Puertas de interior",
        url: "https://www.leroymerlin.es/productos/puertas-ventanas-y-escaleras/puertas-interior/",
        category: "carpinteria",
        subcategory: "puertas",
      },
    ],
  },
  obramat: {
    key: "obramat",
    name: "OBRAMAT",
    origin: "https://www.obramat.es",
    skuPrefix: "OB",
    directSellerPattern: null,
    priceScope: "PVP web con IVA; disponibilidad por almacén",
    categories: [
      {
        key: "cementos",
        name: "OBRAMAT · Cemento gris",
        url: "https://www.obramat.es/materiales-de-construccion/cementos-y-morteros/cementos/cemento-gris/",
        category: "material",
        subcategory: "cementos_y_morteros",
      },
      {
        key: "morteros",
        name: "OBRAMAT · Morteros",
        url: "https://www.obramat.es/materiales-de-construccion/cementos-y-morteros/morteros/",
        category: "material",
        subcategory: "cementos_y_morteros",
      },
      {
        key: "placas_yeso",
        name: "OBRAMAT · Placas de yeso",
        url: "https://www.obramat.es/materiales-de-construccion/tabiques-y-techos-continuos/placas-de-yeso-laminado/",
        category: "material",
        subcategory: "placas_de_yeso",
      },
      {
        key: "perfiles_yeso",
        name: "OBRAMAT · Perfiles para placas de yeso",
        url: "https://www.obramat.es/materiales-de-construccion/tabiques-y-techos-continuos/perfiles-pladur/?p=1",
        category: "material",
        subcategory: "perfiles_de_yeso",
      },
      {
        key: "aislamiento",
        name: "OBRAMAT · Aislamiento térmico",
        url: "https://www.obramat.es/materiales-de-construccion/aislamientos/aislante-termico/",
        category: "material",
        subcategory: "aislamiento",
      },
      {
        key: "impermeabilizacion",
        name: "OBRAMAT · Impermeabilización",
        url: "https://www.obramat.es/materiales-de-construccion/impermeabilizacion/laminas-impermeabilizantes/",
        category: "material",
        subcategory: "impermeabilizacion",
      },
      {
        key: "puertas",
        name: "OBRAMAT · Puertas de interior",
        url: "https://www.obramat.es/puertas-y-ventanas/puertas-interior/puertas-de-madera-interiores/",
        category: "carpinteria",
        subcategory: "puertas",
      },
      {
        key: "griferia",
        name: "OBRAMAT · Grifería de lavabo",
        url: "https://www.obramat.es/banos/grifos-de-bano/grifos-de-lavabo/",
        category: "fontaneria",
        subcategory: "griferia",
      },
      {
        key: "griferia_ducha",
        name: "OBRAMAT · Grifería de ducha",
        url: "https://www.obramat.es/banos/grifos-de-bano/grifos-de-ducha/",
        category: "fontaneria",
        subcategory: "griferia",
      },
      {
        key: "lavabos",
        name: "OBRAMAT · Lavabos",
        url: "https://www.obramat.es/banos/lavabos/",
        category: "sanitarios",
        subcategory: "lavabos",
      },
      {
        key: "inodoros",
        name: "OBRAMAT · Inodoros",
        url: "https://www.obramat.es/banos/wc/inodoros/",
        category: "sanitarios",
        subcategory: "inodoros",
      },
      {
        key: "platos_ducha",
        name: "OBRAMAT · Platos de ducha",
        url: "https://www.obramat.es/banos/platos-de-ducha/",
        category: "sanitarios",
        subcategory: "platos_de_ducha",
      },
      {
        key: "mamparas_frontales",
        name: "OBRAMAT · Mamparas frontales de ducha",
        url: "https://www.obramat.es/banos/mamparas-de-ducha/mampara-de-ducha-frontal/",
        category: "sanitarios",
        subcategory: "mamparas",
      },
      {
        key: "multicapa",
        name: "OBRAMAT · Tubería y accesorios multicapa",
        url: "https://www.obramat.es/fontaneria/alimentacion-de-agua/multicapa/?p=1",
        category: "fontaneria",
        subcategory: "multicapa",
      },
      {
        key: "colectores",
        name: "OBRAMAT · Colectores de agua",
        url: "https://www.obramat.es/fontaneria/alimentacion-de-agua/colectores/?p=1",
        category: "fontaneria",
        subcategory: "colectores",
      },
      {
        key: "llaves_paso",
        name: "OBRAMAT · Llaves de paso y corte",
        url: "https://www.obramat.es/fontaneria/alimentacion-de-agua/llaves-de-paso/?p=1",
        category: "fontaneria",
        subcategory: "llaves_de_paso",
      },
      {
        key: "pvc_evacuacion",
        name: "OBRAMAT · Tubería PVC de evacuación",
        url: "https://www.obramat.es/fontaneria/evacuacion-de-agua/tuberia-pvc/",
        category: "fontaneria",
        subcategory: "pvc_evacuacion",
      },
      {
        key: "sifones_valvulas",
        name: "OBRAMAT · Sifones y válvulas",
        url: "https://www.obramat.es/fontaneria/evacuacion-de-agua/sifones-y-valvulas/",
        category: "fontaneria",
        subcategory: "sifones_y_valvulas",
      },
      {
        key: "cables",
        name: "OBRAMAT · Cables y mangueras",
        url: "https://www.obramat.es/electricidad/cables-y-mangueras/?page=1",
        category: "electricidad",
        subcategory: "cables",
      },
      {
        key: "cuadros_electricos",
        name: "OBRAMAT · Cuadros eléctricos",
        url: "https://www.obramat.es/electricidad/cajas-distribucion/cuadros-electricos/",
        category: "electricidad",
        subcategory: "cuadros_electricos",
      },
      {
        key: "mecanismos_empotrar",
        name: "OBRAMAT · Mecanismos eléctricos de empotrar",
        url: "https://www.obramat.es/electricidad/mecanismos/mecanismos-de-empotrar/",
        category: "electricidad",
        subcategory: "mecanismos_electricos",
      },
      {
        key: "cementos_cola",
        name: "OBRAMAT · Cementos cola",
        url: "https://www.obramat.es/ceramica/colocacion-y-acabado/cementos-cola/",
        category: "material",
        subcategory: "cementos_cola",
      },
      {
        key: "suelos_porcelanicos",
        name: "OBRAMAT · Suelos porcelánicos",
        url: "https://www.obramat.es/ceramica/suelos-ceramicos/suelos-porcelanicos/",
        category: "revestimiento",
        subcategory: "suelos_porcelanicos",
      },
      {
        key: "pintura",
        name: "OBRAMAT · Pintura interior",
        url: "https://www.obramat.es/pintura-y-drogueria/pintura-interior/pinturas-paredes-y-techos/pintura-interior-blanca/",
        category: "material",
        subcategory: "pintura",
      },
      {
        key: "imprimaciones",
        name: "OBRAMAT · Imprimaciones",
        url: "https://www.obramat.es/pintura-y-drogueria/preparacion-de-soportes-y-reparacion/imprimaciones/",
        category: "material",
        subcategory: "imprimaciones",
      },
      {
        key: "masillas_reparacion",
        name: "OBRAMAT · Masillas de reparación",
        url: "https://www.obramat.es/pintura-y-drogueria/preparacion-de-soportes-y-reparacion/soluciones-reparacion/",
        category: "material",
        subcategory: "masillas",
      },
      {
        key: "plasticos_protectores",
        name: "OBRAMAT · Plásticos protectores",
        url: "https://www.obramat.es/pintura-y-drogueria/proteccion-antes-de-pintar/plasticos-protectores/?p=1",
        category: "material",
        subcategory: "proteccion_pintura",
      },
      {
        key: "cintas_pintor",
        name: "OBRAMAT · Cintas de pintor",
        url: "https://www.obramat.es/pintura-y-drogueria/proteccion-antes-de-pintar/cintas-de-pintor/",
        category: "material",
        subcategory: "proteccion_pintura",
      },
      {
        key: "brochas",
        name: "OBRAMAT · Brochas",
        url: "https://www.obramat.es/herramientas/herramientas-de-pintura/brochas/",
        category: "herramienta",
        subcategory: "herramientas_de_pintura",
      },
      {
        key: "rodillos",
        name: "OBRAMAT · Rodillos",
        url: "https://www.obramat.es/herramientas/herramientas-de-pintura/rodillos/",
        category: "herramienta",
        subcategory: "herramientas_de_pintura",
      },
      {
        key: "siliconas",
        name: "OBRAMAT · Siliconas",
        url: "https://www.obramat.es/pintura-y-drogueria/espumas-siliconas-y-selladores/siliconas/",
        category: "material",
        subcategory: "siliconas_y_selladores",
      },
    ],
  },
};

function getOption(name, fallback) {
  const exact = `--${name}`;
  const withEquals = `${exact}=`;
  const index = process.argv.findIndex(
    (argument) => argument === exact || argument.startsWith(withEquals)
  );
  if (index === -1) return fallback;
  const argument = process.argv[index];
  if (argument.startsWith(withEquals)) return argument.slice(withEquals.length);
  return process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : true;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalLimit(value) {
  if (!value || String(value).toLowerCase() === "all") {
    return Number.POSITIVE_INFINITY;
  }
  return parsePositiveInteger(value, Number.POSITIVE_INFINITY);
}

function normalizeProviderKeys(value) {
  const requested = String(value || "leroy,obramat")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((key) => !PROVIDERS[key]);
  if (invalid.length > 0) {
    throw new Error(
      `Proveedor no compatible: ${invalid.join(", ")}. Usa leroy u obramat.`
    );
  }
  return Array.from(new Set(requested));
}

function normalizeCategoryKeys(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  return new Set(
    normalized
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function findCachedChromeExecutables() {
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR ||
    path.join(os.homedir(), ".cache", "puppeteer");
  const chromeCache = path.join(cacheRoot, "chrome");
  if (!fs.existsSync(chromeCache)) return [];

  const relativeExecutables = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux64/chrome",
  ];
  return fs
    .readdirSync(chromeCache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .flatMap((build) =>
      relativeExecutables.map((relative) =>
        path.join(chromeCache, build, relative)
      )
    )
    .filter((candidate) => fs.existsSync(candidate));
}

function findChromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    ...findCachedChromeExecutables(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function parseSpanishPriceLabel(value) {
  const label = String(value || "").replace(/\u00a0/g, " ").trim();
  const match = label.match(
    /(?:^|\s)((?:\d+|\d{1,3}(?:\.\d{3})+)(?:\s*,\s*\d{1,2})?)\s*€(?:\s|$)/
  );
  if (!match) return Number.NaN;
  const numericValue = match[1].replace(/\s+/g, "");
  if (numericValue.includes(",")) {
    return Number.parseFloat(
      numericValue.replace(/\./g, "").replace(",", ".")
    );
  }
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numericValue)) {
    return Number.parseFloat(numericValue.replace(/\./g, ""));
  }
  return Number.parseFloat(numericValue);
}

function inferUnit(name, priceBasis) {
  const basis = String(priceBasis || "").toLowerCase();
  if (/m²|m2|metro cuadrado/.test(basis)) return "m2";
  if (/metro|ml/.test(basis)) return "ml";
  if (/kg|kilo/.test(basis)) return "kg";
  if (/litro|litre|\bl\b/.test(basis)) return "l";

  const normalizedName = String(name || "").toLowerCase();
  if (/\bpalet\b/.test(normalizedName)) return "palet";
  if (/\b(saco|bolsa)\b/.test(normalizedName)) return "saco";
  if (/\b(pack|lote|juego|kit)\b/.test(normalizedName)) return "lote";
  if (/\b(caja|cubo|bote|botella)\b/.test(normalizedName)) return "envase";
  return "ud";
}

function validateProduct(product, provider) {
  let parsedUrl;
  try {
    parsedUrl = new URL(product.product_url);
  } catch {
    return false;
  }

  const rawPrice = parseSpanishPriceLabel(product.raw_price);
  return (
    product.name.length >= 5 &&
    Number.isFinite(product.price) &&
    product.price > 0 &&
    product.price < 100_000 &&
    product.currency === "EUR" &&
    product.sku.startsWith(`${provider.skuPrefix}-`) &&
    parsedUrl.origin === provider.origin &&
    /-\d+\.html(?:$|\?)/.test(parsedUrl.pathname + parsedUrl.search) &&
    Number.isFinite(rawPrice) &&
    Math.abs(rawPrice - product.price) < 0.005 &&
    (!provider.directSellerPattern ||
      provider.directSellerPattern.test(product.seller)) &&
    (provider.key !== "leroy" ||
      Boolean(product.authorization_reference?.trim()))
  );
}

async function dismissCookies(page) {
  await page
    .evaluate(() => {
      const labels = [
        "aceptar y cerrar",
        "aceptar todas",
        "aceptar todo",
        "aceptar",
      ];
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) =>
          labels.includes(
            String(candidate.textContent || "").trim().toLowerCase()
          )
      );
      if (button) button.click();
    })
    .catch(() => undefined);
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    for (let index = 0; index < 8; index += 1) {
      window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    window.scrollTo(0, 0);
  });
}

async function getPageDiagnostics(page) {
  return page.evaluate(() => {
    const text = String(
      document.body?.innerText || document.body?.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim();
    return {
      title: document.title,
      url: location.href,
      textLength: text.length,
      hasPrice: text.includes("€"),
      productLinks: document.querySelectorAll(
        'a[href*="/productos/"][href*=".html"]'
      ).length,
      blocked:
        /access denied|acceso denegado|captcha|are you a robot|no soy un robot|robot or human|temporarily blocked/i.test(
          `${document.title} ${text}`
        ),
    };
  });
}

async function extractProducts(page, provider, category) {
  const candidates = await page.evaluate(
    ({ origin, providerKey, directSellerRequired }) => {
      function clean(value) {
        return String(value || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function canonicalUrl(value) {
        try {
          const url = new URL(value, origin);
          url.hash = "";
          return url.href;
        } catch {
          return "";
        }
      }

      function findCard(link) {
        let current = link;
        for (let level = 0; current && level < 9; level += 1) {
          const text = clean(current.innerText || current.textContent);
          const productLinks = current.querySelectorAll?.(
            'a[href*="/productos/"][href*=".html"]'
          ).length;
          if (
            text.includes("€") &&
            text.length >= 20 &&
            text.length <= 3_000 &&
            productLinks >= 1 &&
            productLinks <= 4
          ) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      }

      function getName(card, link) {
        const selectors = [
          "[data-testid*='name']",
          "[class*='product-name']",
          "[class*='productName']",
          "h2",
          "h3",
          "h4",
        ];
        const named = selectors
          .flatMap((selector) => Array.from(card.querySelectorAll(selector)))
          .map((node) => clean(node.textContent))
          .find((text) => text.length >= 5 && text.length <= 260);
        if (named) return named;

        const imageAlt = Array.from(card.querySelectorAll("img[alt]"))
          .map((image) => clean(image.getAttribute("alt")))
          .find(
            (text) =>
              text.length >= 5 &&
              text.length <= 260 &&
              !/leroy merlin|obramat|logo/i.test(text)
          );
        return imageAlt || clean(link.textContent);
      }

      function getBrand(card, name) {
        const candidates = Array.from(card.querySelectorAll("img[alt]"))
          .map((image) => clean(image.getAttribute("alt")))
          .filter(
            (text) =>
              text.length >= 2 &&
              text.length <= 60 &&
              text.toUpperCase() === text &&
              text.toLowerCase() !== name.toLowerCase() &&
              !/LEROY MERLIN|OBRAMAT|LOGO/.test(text)
          );
        return candidates[0] || "";
      }

      function getPriceEvidence(card) {
        const text = clean(card.innerText || card.textContent);
        const matches = Array.from(
          text.matchAll(
            /(?:^|\s)((?:\d+|\d{1,3}(?:\.\d{3})+)(?:\s*,\s*\d{1,2})?)\s*€(?:\s*(?:IVA\s*)?\/\s*(m²|m2|unidad|ud|metro|kg|litro|l))?/gi
          )
        ).map((match) => ({
          raw: `${match[1].replace(/\s+/g, "")} €`,
          basis: clean(match[2] || ""),
          index: match.index || 0,
        }));

        const eligible = matches.filter((match) => {
          const surrounding = text.slice(
            Math.max(0, match.index - 25),
            match.index + match.raw.length + 35
          );
          return !/en lugar de|precio anterior|antes/i.test(surrounding);
        });

        if (providerKey === "obramat") {
          return (
            eligible.find((match) => {
              const suffix = text.slice(
                match.index + match.raw.length,
                match.index + match.raw.length + 30
              );
              return /IVA\s*\/\s*(?:unidad|ud|m²|m2|metro|kg)/i.test(
                suffix
              );
            }) ||
            eligible[0] ||
            null
          );
        }
        return eligible[0] || null;
      }

      const links = Array.from(
        document.querySelectorAll('a[href*="/productos/"][href*=".html"]')
      );
      const rows = [];
      const seen = new Set();

      for (const link of links) {
        const productUrl = canonicalUrl(link.getAttribute("href"));
        if (!productUrl || seen.has(productUrl)) continue;
        const parsed = new URL(productUrl);
        if (parsed.origin !== origin) continue;

        const reference = parsed.pathname.match(/-(\d+)\.html$/)?.[1];
        if (!reference) continue;
        const card = findCard(link);
        if (!card) continue;

        const name = getName(card, link);
        const evidence = getPriceEvidence(card);
        if (!name || !evidence) continue;
        const cardText = clean(card.innerText || card.textContent);
        const sellerMatch = cardText.match(
          /vendido(?:\s+y\s+enviado)?\s+por\s+([^€]{2,80})/i
        );
        const seller = clean(
          sellerMatch?.[1]?.split(
            /(?:envío|entrega|ver disponibilidad|cantidad|añadir)/i
          )[0] || (providerKey === "obramat" ? "OBRAMAT" : "")
        );
        if (directSellerRequired && !/leroy merlin/i.test(seller)) continue;

        seen.add(productUrl);
        rows.push({
          name,
          reference,
          product_url: productUrl,
          brand: getBrand(card, name),
          seller,
          raw_price: evidence.raw,
          price_basis: evidence.basis,
        });
      }
      return rows;
    },
    {
      origin: provider.origin,
      providerKey: provider.key,
      directSellerRequired: Boolean(provider.directSellerPattern),
    }
  );

  const observedAt = new Date().toISOString();
  const unique = new Map();
  for (const candidate of candidates) {
    const price = parseSpanishPriceLabel(candidate.raw_price);
    const product = {
      name: candidate.name,
      price,
      unit: inferUnit(candidate.name, candidate.price_basis),
      category: category.category,
      subcategory: category.subcategory,
      brand: candidate.brand || undefined,
      sku: `${provider.skuPrefix}-${candidate.reference}`,
      product_url: candidate.product_url,
      raw_price: candidate.raw_price,
      currency: "EUR",
      seller: candidate.seller || provider.name,
      price_basis: candidate.price_basis || "unidad",
      price_includes_vat: true,
      vat_rate: 21,
      price_scope: provider.priceScope,
      observed_at: observedAt,
      evidence_type: "official_product_listing",
      manufacturer_reference: candidate.reference,
      authorization_reference: category.authorizationReference,
    };
    if (!validateProduct(product, provider)) continue;
    if (!unique.has(product.sku)) unique.set(product.sku, product);
  }
  return Array.from(unique.values());
}

async function findNextPageUrl(page, currentUrl) {
  return page.evaluate((current) => {
    const currentUrlObject = new URL(current);
    const links = Array.from(document.querySelectorAll("a[href]"));
    const next = links.find((link) => {
      const label = `${link.getAttribute("aria-label") || ""} ${
        link.textContent || ""
      }`.toLowerCase();
      return (
        link.getAttribute("rel") === "next" ||
        /\bsiguiente\b|\bnext\b|›|»/.test(label)
      );
    });
    if (!next) return "";
    const url = new URL(next.getAttribute("href"), currentUrlObject);
    return url.origin === currentUrlObject.origin ? url.href : "";
  }, currentUrl);
}

async function scrapeCategory(
  browser,
  provider,
  category,
  options,
  browserUserAgent
) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(options.timeoutMs);
  page.setDefaultTimeout(options.timeoutMs);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const action = BLOCKED_RESOURCE_TYPES.has(request.resourceType())
      ? request.abort()
      : request.continue();
    action.catch(() => undefined);
  });
  await page.setUserAgent(browserUserAgent);

  const products = new Map();
  const visited = new Set();
  let nextUrl = category.url;
  let pagesScraped = 0;

  try {
    while (
      nextUrl &&
      pagesScraped < options.maxPages &&
      !visited.has(nextUrl) &&
      products.size < options.maxProducts
    ) {
      visited.add(nextUrl);
      console.log(`[${category.name}] Página ${pagesScraped + 1}: ${nextUrl}`);
      await page.goto(nextUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      await dismissCookies(page);

      // Leroy y OBRAMAT renderizan parte del catálogo de forma diferida.
      // Hay que recorrer la página antes de exigir que existan fichas y precios.
      try {
        await page.waitForFunction(
          () =>
            String(
              document.body?.innerText || document.body?.textContent || ""
            ).trim().length > 200,
          {
            polling: 500,
            timeout: Math.min(options.timeoutMs, 15_000),
          }
        );
      } catch {
        const diagnostic = await getPageDiagnostics(page);
        throw new Error(
          diagnostic.blocked
            ? "El proveedor mostró una pantalla de bloqueo; no se modificó ningún precio " +
                `(título=${diagnostic.title || "sin título"}, texto=${diagnostic.textLength})`
            : "El proveedor devolvió una página vacía o incompleta " +
                `(texto=${diagnostic.textLength}, título=${diagnostic.title || "sin título"}, ` +
                `URL=${diagnostic.url})`
        );
      }
      await scrollPage(page);
      try {
        await page.waitForFunction(
          () =>
            String(
              document.body?.innerText || document.body?.textContent || ""
            ).includes("€") &&
            document.querySelector('a[href*="/productos/"][href*=".html"]'),
          {
            polling: 500,
            timeout: Math.min(options.timeoutMs, 30_000),
          }
        );
      } catch {
        const diagnostic = await getPageDiagnostics(page);
        if (diagnostic.blocked) {
          throw new Error(
            "El proveedor mostró una pantalla de bloqueo; no se modificó ningún precio " +
              `(título=${diagnostic.title || "sin título"}, texto=${diagnostic.textLength})`
          );
        }
        throw new Error(
          "El catálogo no terminó de cargar " +
            `(enlaces=${diagnostic.productLinks}, precio=${diagnostic.hasPrice}, ` +
            `texto=${diagnostic.textLength}, título=${diagnostic.title || "sin título"})`
        );
      }

      const pageProducts = await extractProducts(page, provider, category);
      for (const product of pageProducts) {
        if (!products.has(product.sku)) products.set(product.sku, product);
        if (products.size >= options.maxProducts) break;
      }
      pagesScraped += 1;
      nextUrl = await findNextPageUrl(page, nextUrl);
      if (options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  const result = Array.from(products.values()).slice(0, options.maxProducts);
  if (result.length === 0) {
    throw new Error(
      "No se obtuvo ningún precio con referencia, URL y vendedor verificables"
    );
  }
  console.log(
    `[${category.name}] ${result.length} precios verificados en ${pagesScraped} página(s)`
  );
  return { products: result, pagesScraped };
}

async function sendBatch(provider, category, products, options, batchNumber) {
  const response = await fetch(options.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      ...(options.vercelBypassSecret
        ? { "x-vercel-protection-bypass": options.vercelBypassSecret }
        : {}),
    },
    body: JSON.stringify({
      provider_name: provider.name,
      sector: "construccion",
      source_url: category.url,
      products,
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok || body.ok === false) {
    throw new Error(
      `Lote ${batchNumber}: HTTP ${response.status} ${JSON.stringify(body)}`
    );
  }
  return body;
}

async function ingest(provider, category, products, options) {
  if (options.dryRun) {
    console.log(`[${category.name}] DRY RUN`, products.slice(0, 3));
    return {
      total: products.length,
      inserted: 0,
      updated: 0,
      unchanged: products.length,
      errors: 0,
    };
  }

  const summary = {
    total: products.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
  };
  let batchNumber = 0;
  for (let offset = 0; offset < products.length; offset += options.batchSize) {
    batchNumber += 1;
    const result = await sendBatch(
      provider,
      category,
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
    throw new Error(
      `La ingesta rechazó ${summary.errors} de ${summary.total} productos`
    );
  }
  return summary;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      () => run()
    )
  );
  return results;
}

async function main() {
  const providerKeys = normalizeProviderKeys(
    getOption("providers", process.env.SCRAPER_OFFICIAL_PROVIDERS)
  );
  const providers = providerKeys.map((key) => PROVIDERS[key]);
  const categoryKeys = normalizeCategoryKeys(getOption("categories", "all"));
  const options = {
    apiKey: process.env.SYNC_API_KEY || process.env.AGENT_API_KEY,
    apiUrl: String(
      getOption("api-url", process.env.PRICE_INGEST_URL || DEFAULT_API_URL)
    ),
    vercelBypassSecret:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
    dryRun: hasFlag("dry-run") || process.env.DRY_RUN === "1",
    batchSize: Math.min(
      parsePositiveInteger(
        getOption("batch-size", process.env.INGEST_BATCH_SIZE),
        DEFAULT_BATCH_SIZE
      ),
      500
    ),
    maxPages: parsePositiveInteger(getOption("max-pages", 1), 1),
    maxProducts: parseOptionalLimit(getOption("max-products", "all")),
    concurrency: Math.min(
      parsePositiveInteger(getOption("concurrency", 3), 3),
      4
    ),
    delayMs: parsePositiveInteger(
      getOption("delay-ms", process.env.SCRAPER_REQUEST_DELAY_MS),
      8_000
    ),
    timeoutMs: parsePositiveInteger(
      getOption("timeout-ms", process.env.SCRAPER_TIMEOUT_MS),
      DEFAULT_TIMEOUT_MS
    ),
    authorizationReference: String(
      getOption(
        "authorization-reference",
        process.env.LEROY_AUTHORIZATION_REFERENCE || ""
      )
    ).trim(),
  };

  if (!options.dryRun && !options.apiKey) {
    throw new Error("Falta SYNC_API_KEY o AGENT_API_KEY");
  }
  if (providerKeys.includes("leroy") && !options.authorizationReference) {
    throw new Error(
      "Leroy Merlin requiere una referencia de autorización para uso comercial"
    );
  }
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error(
      "No se encontró Chrome. Define PUPPETEER_EXECUTABLE_PATH."
    );
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 300_000,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--window-size=1440,1200"],
  });
  const browserUserAgent = DEFAULT_USER_AGENT;

  const availableCategoryKeys = new Set(
    providers.flatMap((provider) =>
      provider.categories.map((category) => category.key)
    )
  );
  const invalidCategoryKeys = categoryKeys
    ? Array.from(categoryKeys).filter(
        (categoryKey) => !availableCategoryKeys.has(categoryKey)
      )
    : [];
  if (invalidCategoryKeys.length > 0) {
    throw new Error(
      `Categoría no compatible: ${invalidCategoryKeys.join(", ")}`
    );
  }
  const tasks = providers.flatMap((provider) =>
    provider.categories
      .filter(
        (category) => !categoryKeys || categoryKeys.has(category.key)
      )
      .map((category) => ({ provider, category }))
  );
  for (const task of tasks) {
    if (task.provider.key === "leroy") {
      task.category = {
        ...task.category,
        authorizationReference: options.authorizationReference,
      };
    }
  }
  console.log(
    `Rastreo oficial: ${providers.map((item) => item.name).join(", ")}; ` +
      `${tasks.length} categorías; ${options.maxPages} página(s) por categoría`
  );

  let results;
  const blockedProviders = new Set();
  try {
    results = await mapWithConcurrency(
      tasks,
      providerKeys.includes("obramat") ? 1 : options.concurrency,
      async ({ provider, category }) => {
        if (blockedProviders.has(provider.key)) {
          return {
            provider: provider.name,
            category: category.name,
            ok: false,
            skipped: true,
            error: "Categoría omitida tras el bloqueo previo del proveedor",
          };
        }
        try {
          const scraped = await scrapeCategory(
            browser,
            provider,
            category,
            options,
            browserUserAgent
          );
          const ingestResult = await ingest(
            provider,
            category,
            scraped.products,
            options
          );
          return {
            provider: provider.name,
            category: category.name,
            ok: true,
            products: scraped.products.length,
            pages: scraped.pagesScraped,
            ...ingestResult,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (/pantalla de bloqueo/i.test(message)) {
            blockedProviders.add(provider.key);
          }
          console.error(`[${category.name}] ERROR: ${message}`);
          return {
            provider: provider.name,
            category: category.name,
            ok: false,
            error: message,
          };
        }
      }
    );
  } finally {
    await browser.close().catch(() => undefined);
  }

  console.table(results);
  const failures = results.filter((item) => !item.ok);
  if (failures.length > 0) process.exitCode = 1;
  return results;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main, PROVIDERS };
