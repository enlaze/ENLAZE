#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/*
 * Uso:
 *   SYNC_API_KEY=... npm run scrape:prices
 *   npm run scrape:prices -- --dry-run
 *   npm run scrape:prices -- --dry-run --max-products 10
 *
 * Sin --max-products se recorren todas las páginas de cada categoría.
 */

const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const MANOMANO_ORIGIN = "https://www.manomano.es";
const PRODUCT_CARD_SELECTOR =
  '[data-testid="products-layout-category"] ' +
  '[data-testid="productCardVertical"]';
const DEFAULT_API_URL = "https://enlaze.vercel.app/api/pb/ingest";
const DEFAULT_SYNC_REQUEST_URL =
  "https://enlaze.vercel.app/api/prices/n8n-sync";
const DEFAULT_DEBUG_DIR = path.resolve(process.cwd(), "debug-scraper");
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_PROTOCOL_TIMEOUT_MS = 300_000;
const DEFAULT_CATEGORY_ATTEMPTS = 2;
const DEFAULT_CATEGORY_CONCURRENCY = 2;
const MAX_CATEGORY_CONCURRENCY = 3;
const DEFAULT_CATEGORY_TIMEOUT_MS = 15 * 60 * 1000;
const CANCELLATION_POLL_INTERVAL_MS = 5_000;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

class SyncCancelledError extends Error {
  constructor(message = "Rastreo cancelado por el usuario") {
    super(message);
    this.name = "SyncCancelledError";
  }
}

const DEFAULT_CATEGORIES = [
  {
    name: "Cementos y morteros",
    url: `${MANOMANO_ORIGIN}/cementos-y-morteros-3950`,
    category: "material",
    subcategory: "cementos_y_morteros",
  },
  {
    name: "Puertas de entrada",
    url: `${MANOMANO_ORIGIN}/puertas-de-entrada-2769`,
    category: "carpinteria",
    subcategory: "puertas",
  },
  {
    name: "Herramientas de albañil",
    url: `${MANOMANO_ORIGIN}/herramientas-de-albanil-538`,
    category: "herramientas",
    subcategory: "albanileria",
  },
  {
    name: "Iluminación profesional",
    url: `${MANOMANO_ORIGIN}/iluminacion-profesional-3403`,
    category: "electricidad",
    subcategory: "iluminacion",
  },
  {
    name: "Racores de latón",
    url: `${MANOMANO_ORIGIN}/racores-de-laton-1555`,
    category: "fontaneria",
    subcategory: "racores",
  },
];

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
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    String(value).toLowerCase() === "all"
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return parsePositiveInteger(value, Number.POSITIVE_INFINITY);
}

async function mapWithConcurrency(
  items,
  concurrency,
  worker,
  shouldStop = () => false
) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      if (shouldStop()) break;
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(
    Math.max(1, concurrency),
    Math.max(1, items.length)
  );
  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );
  return results.filter((result) => result !== undefined);
}

function throwIfSyncCancelled(options) {
  if (options.cancelState?.cancelled) {
    throw new SyncCancelledError();
  }
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
    "chrome-win64/chrome.exe",
  ];

  return fs
    .readdirSync(chromeCache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .flatMap((build) =>
      relativeExecutables.map((executable) =>
        path.join(chromeCache, build, executable)
      )
    )
    .filter((executable) => fs.existsSync(executable));
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
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function categoryFromOverride(url) {
  return {
    name: "URL manual",
    url,
    category: String(getOption("category", "material")),
    subcategory: String(getOption("subcategory", "manual")),
  };
}

function parseSpanishPriceLabel(value) {
  const label = String(value || "").replace(/\u00a0/g, " ").trim();
  if (
    !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?\s*€$/.test(label)
  ) {
    return Number.NaN;
  }

  const numericValue = label.replace(/\s*€$/, "");
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

function validateProduct(product) {
  const evidencePrice = parseSpanishPriceLabel(product?.raw_price);
  return (
    product &&
    typeof product.name === "string" &&
    product.name.trim().length >= 3 &&
    typeof product.price === "number" &&
    Number.isFinite(product.price) &&
    product.price > 0 &&
    typeof product.sku === "string" &&
    /^MM-\d+$/.test(product.sku) &&
    typeof product.product_url === "string" &&
    product.product_url.startsWith(`${MANOMANO_ORIGIN}/p/`) &&
    Number.isFinite(evidencePrice) &&
    Math.abs(evidencePrice - product.price) < 0.005
  );
}

function buildPageUrl(categoryUrl, pageNumber) {
  const pageUrl = new URL(categoryUrl);
  if (pageNumber <= 1) {
    pageUrl.searchParams.delete("page");
  } else {
    pageUrl.searchParams.set("page", String(pageNumber));
  }
  return pageUrl.href;
}

async function dismissCookieBanner(page) {
  await page.waitForSelector("button", { timeout: 5_000 }).catch(() => null);

  return page.evaluate(() => {
    const acceptedLabels = [
      "aceptar y cerrar",
      "aceptar todas",
      "aceptar todo",
      "aceptar",
    ];
    const button = Array.from(document.querySelectorAll("button")).find((item) =>
      acceptedLabels.includes((item.textContent || "").trim().toLowerCase())
    );

    if (!button) return false;
    button.click();
    return true;
  });
}

async function scrollUntilStable(page) {
  let previousCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 12 && stableRounds < 3; round += 1) {
    const count = await page.$$eval(
      PRODUCT_CARD_SELECTOR,
      (cards) => cards.length
    );

    stableRounds = count === previousCount ? stableRounds + 1 : 0;
    previousCount = count;

    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700));
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return previousCount;
}

async function waitForProductsOrSecurityChallenge(page, timeoutMs) {
  const stateHandle = await page.waitForFunction(
    (cardSelector) => {
      if (document.querySelector(cardSelector)) return "products";

      const title = (document.title || "").toLowerCase();
      const content = (document.body?.innerText || "").toLowerCase();
      if (
        title.includes("un momento") ||
        content.includes("verificación de seguridad") ||
        content.includes("no eres un bot") ||
        content.includes("malicious bots")
      ) {
        return "security_challenge";
      }
      return false;
    },
    { polling: 1_000, timeout: timeoutMs },
    PRODUCT_CARD_SELECTOR
  );

  const state = await stateHandle.jsonValue();
  await stateHandle.dispose();
  return state;
}

async function hasNextCategoryPage(page, categoryUrl, currentPage) {
  const categoryPath = new URL(categoryUrl).pathname;

  return page.evaluate(
    ({ expectedPage, expectedPath }) =>
      Array.from(document.querySelectorAll("a[href]")).some((link) => {
        try {
          const linkUrl = new URL(link.getAttribute("href"), window.location.href);
          return (
            linkUrl.origin === window.location.origin &&
            linkUrl.pathname === expectedPath &&
            Number(linkUrl.searchParams.get("page")) === expectedPage
          );
        } catch {
          return false;
        }
      }),
    { expectedPage: currentPage + 1, expectedPath: categoryPath }
  );
}

async function saveDebugArtifacts(page, debugDir, categoryName) {
  await fsPromises.mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `${timestamp}-${slugify(categoryName)}`;
  const htmlPath = path.join(debugDir, `${basename}.html`);
  const screenshotPath = path.join(debugDir, `${basename}.png`);

  await Promise.all([
    fsPromises.writeFile(htmlPath, await page.content(), "utf8"),
    page.screenshot({ path: screenshotPath, fullPage: true }),
  ]);

  return { htmlPath, screenshotPath };
}

async function extractProducts(
  page,
  category,
  maxProducts = Number.POSITIVE_INFINITY
) {
  const products = await page.evaluate(
    ({ cardSelector, origin, categoryName, subcategoryName }) => {
      function parseSpanishPrice(value) {
        const label = String(value || "").replace(/\u00a0/g, " ").trim();
        if (
          !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?\s*€$/.test(label)
        ) {
          return Number.NaN;
        }

        const numericValue = label.replace(/\s*€$/, "");
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

      function inferUnit(name) {
        if (/\bpalet\b/i.test(name)) return "palet";
        if (/\b(lote|pack|juego)\b/i.test(name)) return "lote";
        if (/\bsaco\b/i.test(name)) return "saco";
        if (/\b(caja|cubo|balde|bote|botella)\b/i.test(name)) return "envase";
        return "ud";
      }

      function getSku(productUrl) {
        try {
          const parsedUrl = new URL(productUrl, origin);
          const modelId = parsedUrl.searchParams.get("model_id");
          if (modelId) return `MM-${modelId}`;
          const productId = parsedUrl.pathname.match(/-(\d+)$/)?.[1];
          return productId ? `MM-${productId}` : undefined;
        } catch {
          return undefined;
        }
      }

      return Array.from(document.querySelectorAll(cardSelector)).map((card) => {
        const namedLink = Array.from(
          card.querySelectorAll('a[href*="/p/"]')
        ).find((link) => (link.querySelector("p")?.textContent || "").trim());
        const fallbackLink = card.querySelector('a[href*="/p/"]');
        const productLink = namedLink || fallbackLink;
        const name =
          namedLink?.querySelector("p")?.textContent?.trim() ||
          Array.from(card.querySelectorAll("img[alt]"))
            .map((image) =>
              (image.getAttribute("alt") || "")
                .replace(/\s+\(\d+\/\d+\)$/, "")
                .trim()
            )
            .find(Boolean) ||
          "";
        const productUrl = productLink
          ? new URL(productLink.getAttribute("href"), origin).href
          : "";
        const priceElement = Array.from(
          card.querySelectorAll('[role="group"][aria-label]')
        ).find((element) => /€/.test(element.getAttribute("aria-label") || ""));
        const rawPrice =
          priceElement?.getAttribute("aria-label")?.trim() || "";
        const price = parseSpanishPrice(rawPrice);
        const images = Array.from(card.querySelectorAll("img[alt]"));
        const brandImage =
          images.find(
            (image) =>
              image.getAttribute("width") === "58" &&
              image.getAttribute("height") === "29"
          ) ||
          images.find((image) => {
            const alt = (image.getAttribute("alt") || "").trim();
            return (
              !image.closest("a") &&
              alt.length >= 2 &&
              alt.length <= 60 &&
              alt === alt.toUpperCase() &&
              alt !== name.toUpperCase()
            );
          });
        const brand = (brandImage?.getAttribute("alt") || "").trim();

        return {
          name,
          price,
          unit: inferUnit(name),
          category: categoryName,
          subcategory: subcategoryName,
          brand: brand || undefined,
          sku: getSku(productUrl),
          product_url: productUrl,
          raw_price: rawPrice,
        };
      });
    },
    {
      cardSelector: PRODUCT_CARD_SELECTOR,
      origin: MANOMANO_ORIGIN,
      categoryName: category.category,
      subcategoryName: category.subcategory,
    }
  );

  const uniqueProducts = new Map();
  for (const product of products) {
    if (!validateProduct(product)) continue;
    const key = product.sku || `${product.name.toLowerCase()}-${product.price}`;
    if (!uniqueProducts.has(key)) uniqueProducts.set(key, product);
  }

  const validProducts = Array.from(uniqueProducts.values());
  return Number.isFinite(maxProducts)
    ? validProducts.slice(0, maxProducts)
    : validProducts;
}

async function scrapeCategory(page, category, options) {
  console.log(`\n[${category.name}] Iniciando paginación completa`);

  const uniqueProducts = new Map();
  const debugArtifacts = [];
  let pagesScraped = 0;
  let totalRenderedCards = 0;

  for (
    let pageNumber = 1;
    pageNumber <= options.maxPages;
    pageNumber += 1
  ) {
    throwIfSyncCancelled(options);
    if (
      Number.isFinite(options.maxProducts) &&
      uniqueProducts.size >= options.maxProducts
    ) {
      break;
    }

    const pageUrl = buildPageUrl(category.url, pageNumber);
    console.log(`[${category.name}] Página ${pageNumber}: ${pageUrl}`);

    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    throwIfSyncCancelled(options);

    if (pageNumber === 1) await dismissCookieBanner(page);

    try {
      const pageState = await waitForProductsOrSecurityChallenge(
        page,
        options.timeoutMs
      );
      if (pageState === "security_challenge") {
        throw new Error(
          "ManoMano activó su verificación de seguridad. " +
            "La categoría se detuvo y conserva los precios anteriores."
        );
      }
    } catch (error) {
      const title = await page.title();
      const bodyPreview = await page
        .$eval("body", (body) => (body.innerText || "").slice(0, 240))
        .catch(() => "");
      const errorDebug = await saveDebugArtifacts(
        page,
        options.debugDir,
        `${category.name}-pagina-${pageNumber}-error`
      ).catch(() => undefined);
      const debugMessage = errorDebug
        ? ` Debug: ${errorDebug.htmlPath}`
        : "";
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      if (originalMessage.includes("verificación de seguridad")) {
        throw new Error(`${originalMessage}${debugMessage}`, { cause: error });
      }
      throw new Error(
        `No aparecieron tarjetas en la página ${pageNumber}. ` +
          `Título: "${title}". Contenido: ` +
          `"${bodyPreview.replace(/\s+/g, " ")}".${debugMessage}`,
        { cause: error }
      );
    }

    const renderedCards = await scrollUntilStable(page);
    throwIfSyncCancelled(options);
    const pageProducts = await extractProducts(page, category);
    let newProducts = 0;

    for (const product of pageProducts) {
      const key =
        product.sku || `${product.name.toLowerCase()}-${product.price}`;
      if (!uniqueProducts.has(key)) {
        uniqueProducts.set(key, product);
        newProducts += 1;
      }
    }

    pagesScraped += 1;
    totalRenderedCards += renderedCards;

    if (options.debug) {
      debugArtifacts.push(
        await saveDebugArtifacts(
          page,
          options.debugDir,
          `${category.name}-pagina-${pageNumber}`
        )
      );
    }

    console.log(
      `[${category.name}] Página ${pageNumber}: ` +
        `${pageProducts.length} válidos, ${newProducts} nuevos, ` +
        `${uniqueProducts.size} acumulados`
    );

    const hasNextPage = await hasNextCategoryPage(
      page,
      category.url,
      pageNumber
    );
    if (!hasNextPage || newProducts === 0) break;
  }

  const allProducts = Array.from(uniqueProducts.values());
  const products = Number.isFinite(options.maxProducts)
    ? allProducts.slice(0, options.maxProducts)
    : allProducts;

  console.log(
    `[${category.name}] Total: ${products.length} productos únicos ` +
      `en ${pagesScraped} páginas (${totalRenderedCards} tarjetas procesadas)`
  );

  return { products, pagesScraped, debugArtifacts };
}

async function postIngestBatch(category, products, options, batchNumber) {
  const response = await fetch(options.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      ...(options.vercelBypassSecret
        ? {
            "x-vercel-protection-bypass": options.vercelBypassSecret,
          }
        : {}),
    },
    body: JSON.stringify({
      provider_name: "ManoMano",
      sector: "construccion",
      source_url: category.url,
      products,
    }),
    signal: AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs),
      options.cancelState.abortController.signal,
    ]),
  });

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { raw: responseText };
  }

  if (!response.ok || result.ok === false) {
    throw new Error(
      `El lote ${batchNumber} respondió HTTP ${response.status}: ` +
        JSON.stringify(result)
    );
  }

  console.log(
    `[${category.name}] Lote ${batchNumber} completado: ` +
      `insertados=${result.inserted || 0}, actualizados=${result.updated || 0}, ` +
      `sin cambios=${result.unchanged || 0}, errores=${result.errors || 0}`
  );
  return result;
}

async function ingestProducts(category, products, options) {
  if (options.dryRun) {
    console.log(
      `[${category.name}] DRY RUN: ${products.length} productos; ` +
        "no se enviaron datos. Muestra:",
      products.slice(0, 3)
    );
    return { ok: true, dryRun: true, total: products.length };
  }

  if (!options.apiKey) {
    throw new Error(
      "Falta SYNC_API_KEY. Defínela en el entorno o ejecuta con --dry-run."
    );
  }

  const aggregate = {
    ok: true,
    total: products.length,
    batches: Math.ceil(products.length / options.batchSize),
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
  };

  for (
    let offset = 0, batchNumber = 1;
    offset < products.length;
    offset += options.batchSize, batchNumber += 1
  ) {
    throwIfSyncCancelled(options);
    const batch = products.slice(offset, offset + options.batchSize);
    console.log(
      `[${category.name}] Enviando lote ${batchNumber}/${aggregate.batches} ` +
        `(${batch.length} productos)`
    );

    const result = await postIngestBatch(
      category,
      batch,
      options,
      batchNumber
    );
    aggregate.inserted += Number(result.inserted || 0);
    aggregate.updated += Number(result.updated || 0);
    aggregate.unchanged += Number(result.unchanged || 0);
    aggregate.errors += Number(result.errors || 0);
  }

  if (aggregate.errors > 0) {
    throw new Error(
      `Supabase rechazó ${aggregate.errors} productos de ${aggregate.total}. ` +
        "Los productos válidos sí se guardaron; revisa esta ejecución en n8n."
    );
  }

  return aggregate;
}

function isRetryableBrowserError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /verificación de seguridad|no eres un bot|security challenge/i.test(
      message
    )
  ) {
    return false;
  }
  return /timed out|protocolTimeout|Target closed|Session closed|frame was detached/i.test(
    message
  );
}

async function createConfiguredPage(browser, options) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(options.timeoutMs);
  page.setDefaultTimeout(options.timeoutMs);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const requestAction = BLOCKED_RESOURCE_TYPES.has(request.resourceType())
      ? request.abort()
      : request.continue();
    requestAction.catch(() => undefined);
  });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  );
  return page;
}

async function launchBrowser(executablePath, userDataDir, options) {
  return puppeteer.launch({
    executablePath,
    headless: !options.headed,
    userDataDir,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--noerrdialogs",
      "--window-size=1440,1200",
    ],
    defaultViewport: { width: 1440, height: 1200 },
    protocolTimeout: options.protocolTimeoutMs,
  });
}

async function reportSyncRequest(options, action, payload = {}) {
  if (!options.syncRequestId || !options.apiKey) return null;

  try {
    const response = await fetch(options.syncRequestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...(options.vercelBypassSecret
          ? {
              "x-vercel-protection-bypass": options.vercelBypassSecret,
            }
          : {}),
      },
      body: JSON.stringify({
        action,
        request_id: options.syncRequestId,
        ...payload,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const responseText = await response.text();
    let result = {};
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      result = { responseText };
    }

    if (!response.ok) {
      if (result.cancelled === true) return result;
      console.warn(
        `[Solicitud n8n] No se pudo informar el estado ${action}: ` +
          `HTTP ${response.status} ${responseText.slice(0, 240)}`
      );
    }
    return result;
  } catch (error) {
    console.warn(
      `[Solicitud n8n] No se pudo informar el estado ${action}: ` +
        (error instanceof Error ? error.message : String(error))
    );
    return null;
  }
}

async function closeBrowser(browser) {
  if (!browser) return;
  const browserProcess = browser.process();
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Chrome no respondió al cierre")),
          5_000
        )
      ),
    ]);
  } catch {
    if (browserProcess && !browserProcess.killed) {
      browserProcess.kill("SIGTERM");
    }
    if (browser.isConnected()) browser.disconnect();
  }
}

async function activateSyncCancellation(options) {
  if (options.cancelState.cancelled) return;
  options.cancelState.cancelled = true;
  options.cancelState.abortController.abort(new SyncCancelledError());
  console.log("[Solicitud n8n] Cancelación recibida; cerrando el rastreador.");
  await Promise.allSettled(
    Array.from(options.cancelState.activeBrowsers, (browser) =>
      closeBrowser(browser)
    )
  );
}

function startSyncCancellationMonitor(options) {
  if (!options.syncRequestId || !options.apiKey) {
    return async () => undefined;
  }

  let stopped = false;
  let timer;
  let currentCheck = Promise.resolve();

  const check = async () => {
    const result = await reportSyncRequest(options, "status");
    if (
      result?.cancelled === true ||
      result?.request?.status === "cancelled"
    ) {
      await activateSyncCancellation(options);
    }
  };

  const tick = async () => {
    if (stopped || options.cancelState.cancelled) return;
    await check();
    if (!stopped && !options.cancelState.cancelled) {
      timer = setTimeout(() => {
        currentCheck = tick();
      }, CANCELLATION_POLL_INTERVAL_MS);
    }
  };

  currentCheck = tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await currentCheck;
  };
}

async function scrapeCategoryWithRetries(
  executablePath,
  category,
  options
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= DEFAULT_CATEGORY_ATTEMPTS;
    attempt += 1
  ) {
    const browserProfileDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "enlaze-scraper-")
    );
    let browser;
    try {
      browser = await launchBrowser(
        executablePath,
        browserProfileDir,
        options
      );
      options.cancelState.activeBrowsers.add(browser);
      throwIfSyncCancelled(options);
      const page = await createConfiguredPage(browser, options);
      let categoryTimer;
      const categoryTimeout = new Promise((_, reject) => {
        categoryTimer = setTimeout(() => {
          reject(
            new Error(
              `La categoría superó ${Math.round(
                options.categoryTimeoutMs / 60_000
              )} minutos y se detuvo para evitar un bloqueo.`
            )
          );
          void closeBrowser(browser);
        }, options.categoryTimeoutMs);
      });
      try {
        return await Promise.race([
          scrapeCategory(page, category, options),
          categoryTimeout,
        ]);
      } finally {
        clearTimeout(categoryTimer);
      }
    } catch (error) {
      lastError = error;
      if (options.cancelState.cancelled || error instanceof SyncCancelledError) {
        throw new SyncCancelledError();
      }
      if (
        attempt >= DEFAULT_CATEGORY_ATTEMPTS ||
        !isRetryableBrowserError(error)
      ) {
        throw error;
      }

      console.warn(
        `[${category.name}] Chrome se bloqueó; reintentando la categoría ` +
          `con un navegador limpio (${attempt + 1}/${DEFAULT_CATEGORY_ATTEMPTS})`
      );
    } finally {
      if (browser) options.cancelState.activeBrowsers.delete(browser);
      await closeBrowser(browser);
      await fsPromises.rm(browserProfileDir, {
        recursive: true,
        force: true,
      });
    }
  }

  throw lastError;
}

async function main() {
  const overrideUrl = getOption("url");
  const options = {
    apiKey: process.env.SYNC_API_KEY || process.env.AGENT_API_KEY,
    vercelBypassSecret:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
    apiUrl: String(
      getOption(
        "api-url",
        process.env.PRICE_INGEST_URL || DEFAULT_API_URL
      )
    ),
    batchSize: Math.min(
      parsePositiveInteger(
        getOption("batch-size", process.env.INGEST_BATCH_SIZE),
        DEFAULT_BATCH_SIZE
      ),
      500
    ),
    categoryConcurrency: Math.min(
      parsePositiveInteger(
        getOption(
          "category-concurrency",
          process.env.SCRAPER_CATEGORY_CONCURRENCY
        ),
        DEFAULT_CATEGORY_CONCURRENCY
      ),
      MAX_CATEGORY_CONCURRENCY
    ),
    categoryTimeoutMs: parsePositiveInteger(
      getOption(
        "category-timeout-ms",
        process.env.SCRAPER_CATEGORY_TIMEOUT_MS
      ),
      DEFAULT_CATEGORY_TIMEOUT_MS
    ),
    cancelState: {
      cancelled: false,
      activeBrowsers: new Set(),
      abortController: new AbortController(),
    },
    debug:
      !hasFlag("no-debug") &&
      (hasFlag("debug") || process.env.SCRAPER_DEBUG === "1"),
    debugDir: path.resolve(
      String(getOption("debug-dir", DEFAULT_DEBUG_DIR))
    ),
    dryRun: hasFlag("dry-run") || process.env.DRY_RUN === "1",
    headed: hasFlag("headed"),
    maxPages: parsePositiveInteger(
      getOption("max-pages", process.env.MAX_PAGES_PER_CATEGORY),
      DEFAULT_MAX_PAGES
    ),
    maxProducts: parseOptionalLimit(
      getOption("max-products", process.env.MAX_PRODUCTS_PER_CATEGORY)
    ),
    protocolTimeoutMs: parsePositiveInteger(
      getOption(
        "protocol-timeout-ms",
        process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS
      ),
      DEFAULT_PROTOCOL_TIMEOUT_MS
    ),
    timeoutMs: parsePositiveInteger(
      getOption("timeout-ms", process.env.SCRAPER_TIMEOUT_MS),
      120_000
    ),
    syncRequestId: String(
      getOption(
        "sync-request-id",
        process.env.PRICE_SYNC_REQUEST_ID || ""
      ) || ""
    ),
    syncRequestUrl: String(
      getOption(
        "sync-request-url",
        process.env.PRICE_SYNC_REQUEST_URL || DEFAULT_SYNC_REQUEST_URL
      )
    ),
  };
  const categories = overrideUrl
    ? [categoryFromOverride(String(overrideUrl))]
    : DEFAULT_CATEGORIES;
  const executablePath = findChromeExecutable();

  if (!executablePath) {
    throw new Error(
      "No se encontró Chrome. Define PUPPETEER_EXECUTABLE_PATH con la ruta del navegador."
    );
  }

  if (!options.dryRun && !options.apiKey) {
    throw new Error(
      "Falta SYNC_API_KEY. Defínela en el entorno o usa --dry-run para validar sin ingerir."
    );
  }

  console.log(
    `Iniciando scraper de ManoMano ` +
      `(${options.dryRun ? "dry run" : "ingesta activa"}, ` +
      `${
        Number.isFinite(options.maxProducts)
          ? `máximo ${options.maxProducts} por categoría`
          : "todos los productos"
      }, ${options.categoryConcurrency} categorías en paralelo)`
  );

  let completedCategories = 0;
  const stopCancellationMonitor = startSyncCancellationMonitor(options);
  let summary;
  try {
    summary = await mapWithConcurrency(
      categories,
      options.categoryConcurrency,
      async (category) => {
        let categorySummary;
        try {
          throwIfSyncCancelled(options);
          const { products, pagesScraped, debugArtifacts } =
            await scrapeCategoryWithRetries(
              executablePath,
              category,
              options
            );
          throwIfSyncCancelled(options);
          if (products.length === 0) {
            throw new Error(
              "Las tarjetas se cargaron, pero ningún producto fue válido."
            );
          }
          const ingestResult = await ingestProducts(
            category,
            products,
            options
          );
          categorySummary = {
            category: category.name,
            ok: true,
            products: products.length,
            pagesScraped,
            debugArtifacts,
            ingestResult,
          };
        } catch (error) {
          if (
            options.cancelState.cancelled ||
            error instanceof SyncCancelledError
          ) {
            return {
              category: category.name,
              ok: false,
              cancelled: true,
              error: "Cancelado por el usuario",
            };
          }

          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`[${category.name}] ERROR: ${message}`);
          categorySummary = {
            category: category.name,
            ok: false,
            error: message,
          };
        }

        if (options.cancelState.cancelled) return categorySummary;

        completedCategories += 1;
        const progressResult = await reportSyncRequest(options, "progress", {
          progress: {
            completed: completedCategories,
            total: categories.length,
            label: category.name,
          },
        });
        if (
          progressResult?.cancelled === true ||
          progressResult?.request?.status === "cancelled"
        ) {
          await activateSyncCancellation(options);
        }

        return categorySummary;
      },
      () => options.cancelState.cancelled
    );
  } finally {
    await stopCancellationMonitor();
  }

  if (options.cancelState.cancelled) {
    console.log("Rastreo cancelado. No se iniciarán más categorías ni lotes.");
    return { summary, cancelled: true };
  }

  console.log("\nResumen:");
  console.table(
    summary.map((item) => ({
      categoria: item.category,
      estado: item.ok ? "ok" : "error",
      productos: item.products || 0,
      paginas: item.pagesScraped || 0,
      error: item.error || "",
    }))
  );

  const result = summary.reduce(
    (totals, item) => {
      totals.products += Number(item.products || 0);
      totals.inserted += Number(item.ingestResult?.inserted || 0);
      totals.updated += Number(item.ingestResult?.updated || 0);
      totals.unchanged += Number(item.ingestResult?.unchanged || 0);
      return totals;
    },
    {
      products: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      categories_completed: summary.filter((item) => item.ok).length,
      categories_total: categories.length,
    }
  );
  const failures = summary.filter((item) => !item.ok);

  if (failures.length > 0) {
    await reportSyncRequest(options, "fail", {
      result,
      error: failures
        .map((item) => `${item.category}: ${item.error}`)
        .join(" | ")
        .slice(0, 2000),
    });
    process.exitCode = 1;
  } else {
    await reportSyncRequest(options, "complete", { result });
  }

  return { summary, result };
}

if (require.main === module) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await reportSyncRequest(
      {
        apiKey: process.env.SYNC_API_KEY || process.env.AGENT_API_KEY,
        vercelBypassSecret:
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
        syncRequestId: String(
          getOption(
            "sync-request-id",
            process.env.PRICE_SYNC_REQUEST_ID || ""
          ) || ""
        ),
        syncRequestUrl: String(
          getOption(
            "sync-request-url",
            process.env.PRICE_SYNC_REQUEST_URL ||
              DEFAULT_SYNC_REQUEST_URL
          )
        ),
      },
      "fail",
      { error: message.slice(0, 2000) }
    );
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CATEGORIES,
  PRODUCT_CARD_SELECTOR,
  SyncCancelledError,
  buildPageUrl,
  extractProducts,
  findChromeExecutable,
  hasNextCategoryPage,
  mapWithConcurrency,
  parseOptionalLimit,
  validateProduct,
};
