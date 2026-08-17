#!/usr/bin/env node

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Checks the lightweight publication metadata before downloading the 269 MB PDF.
 * A full catalogue run is only needed when the official PDF fingerprint changes.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PUBLICATION =
  "https://view.publitas.com/catalogo-2026/catalogo-2026-alicante";

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

function booleanOption(name, fallback = false) {
  const value = getOption(name, fallback);
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "si", "sí"].includes(
    String(value).trim().toLocaleLowerCase("es")
  );
}

function extractJsonString(html, field) {
  const match = html.match(new RegExp(`"${field}":("(?:\\\\.|[^"\\\\])*")`));
  if (!match) throw new Error(`El visor no publicó ${field}`);
  return JSON.parse(match[1]);
}

function extractInteger(html, field) {
  const match = html.match(new RegExp(`"${field}":(\\d+)`));
  if (!match) throw new Error(`El visor no publicó ${field}`);
  return Number.parseInt(match[1], 10);
}

function canonicalPdfUrl(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  if (
    url.origin !== "https://view.publitas.com" ||
    !/^\/105196\/\d+\/pdfs\/[a-f0-9-]+\.pdf$/i.test(url.pathname)
  ) {
    throw new Error("El visor devolvió un PDF fuera de la cuenta oficial esperada");
  }
  return url.href;
}

function fingerprint(metadata) {
  const stable = JSON.stringify({
    publication_id: metadata.publication_id,
    source_document_id: metadata.source_document_id,
    pdf_url: metadata.pdf_url,
    num_pages: metadata.num_pages,
    etag: metadata.etag,
    last_modified: metadata.last_modified,
    content_length: metadata.content_length,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

async function main() {
  const publicationUrl = String(
    getOption("publication-url", DEFAULT_PUBLICATION)
  ).replace(/\/$/, "");
  const stateOption = getOption("state", "");
  const resultOption = getOption("result", "");
  const statePath = stateOption ? path.resolve(String(stateOption)) : "";
  const resultPath = resultOption ? path.resolve(String(resultOption)) : "";
  const force = booleanOption("force");

  const publicationResponse = await fetch(publicationUrl, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!publicationResponse.ok) {
    throw new Error(`El catálogo respondió HTTP ${publicationResponse.status}`);
  }
  const html = await publicationResponse.text();
  const pdfUrl = canonicalPdfUrl(extractJsonString(html, "downloadPdfUrl"));
  const numPages = extractInteger(html, "numPages");
  const publicationId = extractInteger(html, "id");
  const sourceDocumentId = extractInteger(html, "sourceDocumentId");

  const pdfResponse = await fetch(pdfUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(60_000),
  });
  if (!pdfResponse.ok) {
    throw new Error(`El PDF oficial respondió HTTP ${pdfResponse.status}`);
  }
  const lastModified = pdfResponse.headers.get("last-modified") || "";
  const metadata = {
    publication_url: publicationUrl,
    publication_id: publicationId,
    source_document_id: sourceDocumentId,
    pdf_url: pdfUrl,
    num_pages: numPages,
    etag: pdfResponse.headers.get("etag") || "",
    last_modified: lastModified,
    content_length: Number.parseInt(
      pdfResponse.headers.get("content-length") || "0",
      10
    ),
    published_at: Number.isFinite(Date.parse(lastModified))
      ? new Date(lastModified).toISOString()
      : new Date().toISOString(),
  };
  const currentFingerprint = fingerprint(metadata);
  let previousFingerprint = "";
  if (statePath && fs.existsSync(statePath)) {
    const previousState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    previousFingerprint = String(previousState.fingerprint || "");
  }
  const changed = force || previousFingerprint !== currentFingerprint;
  const result = {
    ...metadata,
    fingerprint: currentFingerprint,
    previous_fingerprint: previousFingerprint,
    changed,
    forced: force,
    checked_at: new Date().toISOString(),
  };

  if (resultPath) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  }
  writeGithubOutput({
    changed: String(changed),
    pdf_url: pdfUrl,
    last_page: String(numPages),
    published_at: metadata.published_at,
    fingerprint: currentFingerprint,
  });
  console.log(
    JSON.stringify({
      changed,
      forced: force,
      pdf_url: pdfUrl,
      pages: numPages,
      fingerprint: currentFingerprint,
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
