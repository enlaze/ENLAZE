#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Collects the official OBRAMAT product links embedded in a Publitas catalogue.
 *
 * This intentionally keeps browser automation visible to the remote service:
 * no user-agent spoofing, webdriver hiding, challenge solving or retry storms.
 * The collector checkpoints after every spread and stops on repeated failures.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const DEFAULT_PUBLICATION =
  "https://view.publitas.com/catalogo-2026/catalogo-2026-alicante";
const DEFAULT_OUTPUT = "tmp/pdfs/obramat-catalog-links-alicante.json";
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spreadStarts(lastPage) {
  const pages = [1];
  for (let page = 2; page < lastPage; page += 2) pages.push(page);
  if (lastPage > 1) pages.push(lastPage);
  return pages;
}

function loadCheckpoint(outputPath, publicationUrl) {
  if (!fs.existsSync(outputPath)) {
    return { publication_url: publicationUrl, completed_spreads: [], links: [] };
  }
  const checkpoint = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (checkpoint.publication_url !== publicationUrl) {
    throw new Error("El checkpoint pertenece a otra publicación");
  }
  return checkpoint;
}

async function extractCurrentSpread(page) {
  return page.evaluate(() => {
    const slide = document.querySelector(".slide.current");
    const currentLabel = String(
      document.querySelector(".current-page")?.textContent || ""
    ).trim();
    const visiblePart = currentLabel.split("/")[0];
    const pageNumbers = visiblePart
      .split("-")
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite);
    const anchors = Array.from(
      slide?.querySelectorAll(
        'nav.hotspots a[href^="https://www.obramat.es/productos/"][href*=".html"]'
      ) || []
    );
    const links = anchors.flatMap((anchor) => {
      const url = anchor.href.split("?")[0];
      const reference = url.match(/-(\d+)\.html$/)?.[1];
      const left = Number.parseFloat(anchor.style.left || "0");
      const top = Number.parseFloat(anchor.style.top || "0");
      if (!reference || !Number.isFinite(left) || !Number.isFinite(top)) {
        return [];
      }
      const pageNumber =
        pageNumbers.length <= 1 || left < 50
          ? pageNumbers[0]
          : pageNumbers[1];
      if (!pageNumber) return [];
      return [
        {
          page: pageNumber,
          reference,
          name: String(anchor.getAttribute("aria-label") || "")
            .replace(/\s*-\s*Más info\s*$/i, "")
            .replace(/\s+/g, " ")
            .trim(),
          product_url: url,
          hotspot_left: left,
          hotspot_top: top,
        },
      ];
    });
    return {
      title: document.title,
      current_label: currentLabel,
      page_numbers: pageNumbers,
      links,
      text_length: String(document.body?.innerText || "").trim().length,
    };
  });
}

async function main() {
  const publicationUrl = String(
    getOption("publication-url", DEFAULT_PUBLICATION)
  ).replace(/\/$/, "");
  const outputPath = path.resolve(String(getOption("output", DEFAULT_OUTPUT)));
  const delayMs = positiveInteger(getOption("delay-ms", 750), 750);
  const lastPage = positiveInteger(getOption("last-page", 524), 524);
  const maxSpreads = positiveInteger(
    getOption("max-spreads", Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
  const resume = hasFlag("resume");
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error("No se encontró Chrome para leer el catálogo público");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const checkpoint = resume
    ? loadCheckpoint(outputPath, publicationUrl)
    : { publication_url: publicationUrl, completed_spreads: [], links: [] };
  const completed = new Set(checkpoint.completed_spreads || []);
  const linkMap = new Map(
    (checkpoint.links || []).map((link) => [
      `${link.page}:${link.reference}:${link.product_url}`,
      link,
    ])
  );
  const targets = spreadStarts(lastPage)
    .filter((spread) => !completed.has(spread))
    .slice(0, maxSpreads);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(30_000);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const action = BLOCKED_RESOURCE_TYPES.has(request.resourceType())
      ? request.abort()
      : request.continue();
    action.catch(() => undefined);
  });

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const spread = targets[index];
      const url = `${publicationUrl}/page/${spread}`;
      let extracted;
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(".slide.current nav.hotspots");
          await sleep(attempt === 1 ? 250 : 1_500);
          extracted = await extractCurrentSpread(page);
          if (!extracted.current_label || extracted.text_length < 20) {
            throw new Error("La publicación devolvió una página incompleta");
          }
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!extracted) {
        throw new Error(
          `Lectura detenida en ${url}: ${lastError?.message || "sin datos"}`
        );
      }

      for (const link of extracted.links) {
        linkMap.set(`${link.page}:${link.reference}:${link.product_url}`, link);
      }
      completed.add(spread);
      const snapshot = {
        publication_url: publicationUrl,
        updated_at: new Date().toISOString(),
        completed_spreads: Array.from(completed).sort((a, b) => a - b),
        links: Array.from(linkMap.values()).sort(
          (a, b) => a.page - b.page || a.reference.localeCompare(b.reference)
        ),
      };
      fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
      console.log(
        `[${index + 1}/${targets.length}] ${extracted.current_label}: ` +
          `${extracted.links.length} enlaces (${linkMap.size} acumulados)`
      );
      if (index < targets.length - 1) await sleep(delayMs);
    }
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  console.log(
    JSON.stringify({
      ok: true,
      output: outputPath,
      completed_spreads: completed.size,
      links: linkMap.size,
      unique_references: new Set(
        Array.from(linkMap.values()).map((link) => link.reference)
      ).size,
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
