/**
 * bc3-parser.ts
 *
 * Pure parser for BC3/FIEBDC-3 files (Spanish construction price database format).
 *
 * Supported record types (this commit):
 *   ~V  Version / metadata
 *   ~K  Constants (indirect costs, currency, decimals)
 *   ~C  Concepts (chapters, items, resources)
 *   ~D  Decompositions (parent-child relationships with yields)
 *   ~T  Long texts (extended descriptions)
 *
 * Unsupported records (~M, ~W, ~L, ~G, ~E, ~X, ~B, ~F, ~A, ~P) are
 * skipped and logged as warnings.
 *
 * This module is PURE: no side effects, no DB access, no network calls.
 * Input: string (file content). Output: ParsedBC3.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Raw concept extracted from a ~C record */
export interface BC3Concept {
  code: string;
  unit: string;
  summary: string;
  price: number;
  date: string;
  /** 0=unclassified, 1=labor, 2=machinery, 3=material */
  type: number;
}

/** A child entry inside a ~D decomposition */
export interface BC3DecompositionChild {
  childCode: string;
  factor: number;
  /** Quantity per unit of parent (rendimiento) */
  quantityPerUnit: number;
}

/** Decomposition record linking parent to children */
export interface BC3Decomposition {
  parentCode: string;
  children: BC3DecompositionChild[];
}

/** Long text from a ~T record */
export interface BC3LongText {
  code: string;
  text: string;
}

/** Metadata extracted from ~V and ~K records */
export interface BC3Metadata {
  fiebdcVersion: string;
  generatedBy: string;
  headerTitle: string;
  currency: string;
  decimals: number[];
  constants: Record<string, number>;
}

/** Warning for skipped/unsupported content */
export interface BC3Warning {
  line: number;
  record: string;
  message: string;
}

/** Full result of parsing a BC3 file */
export interface ParsedBC3 {
  concepts: BC3Concept[];
  decompositions: BC3Decomposition[];
  longTexts: BC3LongText[];
  metadata: BC3Metadata;
  warnings: BC3Warning[];
  stats: {
    totalLines: number;
    parsedRecords: number;
    skippedRecords: number;
    errorLines: number;
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * FIEBDC uses | as field separator and \ as sub-field separator.
 * Lines may span multiple lines if continued (we join first).
 * Trailing | is common and should be stripped.
 */
function splitFields(line: string): string[] {
  // Remove leading ~X| prefix — caller already stripped ~X
  // Remove trailing |
  const trimmed = line.replace(/\|$/, "");
  return trimmed.split("|");
}

function safeFloat(val: string | undefined): number {
  if (!val || val.trim() === "") return 0;
  const n = parseFloat(val.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function safeInt(val: string | undefined): number {
  if (!val || val.trim() === "") return 0;
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

// ─── Record parsers ─────────────────────────────────────────────────────────

function parseVersion(body: string, meta: BC3Metadata): void {
  const fields = splitFields(body);
  meta.fiebdcVersion = fields[0]?.trim() || "";
  meta.generatedBy = fields[1]?.trim() || "";
  meta.headerTitle = fields[2]?.trim() || "";
}

function parseConstants(body: string, meta: BC3Metadata): void {
  const fields = splitFields(body);
  if (fields.length === 0) return;

  // The constants field uses \ as separator between values
  // Format varies; common: DN\DD\DS\DR\DI\DD2\DD3\DD4\CI\GG\BI\BAJA\IVA
  // Or sometimes just decimals followed by currency
  const raw = fields[0] || "";
  const parts = raw.split("\\").map((s) => s.trim());

  // Look for currency (3-letter code)
  for (const p of parts) {
    if (/^[A-Z]{3}$/.test(p)) {
      meta.currency = p;
    }
  }

  // Try to extract decimal counts (first numeric values)
  const numericParts = parts.filter((p) => /^\d+$/.test(p));
  meta.decimals = numericParts.map((p) => parseInt(p, 10));

  // Named constants from position (if enough parts)
  const constantNames = [
    "DN",
    "DD",
    "DS",
    "DR",
    "DI",
    "DD2",
    "DD3",
    "DD4",
    "CI",
    "GG",
    "BI",
    "BAJA",
    "IVA",
  ];
  for (let i = 0; i < parts.length && i < constantNames.length; i++) {
    const val = safeFloat(parts[i]);
    if (val !== 0) {
      meta.constants[constantNames[i]] = val;
    }
  }
}

function parseConcept(body: string): BC3Concept | null {
  const fields = splitFields(body);
  if (fields.length < 1) return null;

  const code = fields[0]?.trim() || "";
  if (!code) return null;

  return {
    code,
    unit: fields[1]?.trim() || "",
    summary: fields[2]?.trim() || "",
    price: safeFloat(fields[3]),
    date: fields[4]?.trim() || "",
    type: safeInt(fields[5]),
  };
}

function parseDecomposition(body: string): BC3Decomposition | null {
  const fields = splitFields(body);
  if (fields.length < 2) return null;

  const parentCode = fields[0]?.trim() || "";
  if (!parentCode) return null;

  const childrenRaw = fields[1] || "";
  const parts = childrenRaw.split("\\").filter((s) => s.trim() !== "");

  // Children come in triples: code\factor\yield\code\factor\yield\...
  const children: BC3DecompositionChild[] = [];
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const childCode = parts[i].trim();
    if (!childCode) continue;
    children.push({
      childCode,
      factor: safeFloat(parts[i + 1]),
      quantityPerUnit: safeFloat(parts[i + 2]),
    });
  }

  if (children.length === 0) return null;
  return { parentCode, children };
}

function parseLongText(body: string): BC3LongText | null {
  const fields = splitFields(body);
  if (fields.length < 2) return null;

  const code = fields[0]?.trim() || "";
  if (!code) return null;

  return {
    code,
    text: fields.slice(1).join("|").trim(), // Text may contain |
  };
}

// ─── Main parser ────────────────────────────────────────────────────────────

const SUPPORTED_RECORDS = new Set(["V", "K", "C", "D", "T"]);
const KNOWN_UNSUPPORTED = new Set([
  "M",
  "W",
  "L",
  "G",
  "E",
  "X",
  "B",
  "F",
  "A",
  "P",
  "N",
  "O",
  "Q",
  "R",
  "S",
  "Y",
]);

/**
 * Join continuation lines.
 * In FIEBDC, a line that doesn't start with ~ is a continuation of the previous record.
 */
function joinContinuationLines(rawLines: string[]): string[] {
  const joined: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trimEnd();
    if (trimmed === "") continue;
    if (trimmed.startsWith("~") && trimmed.length > 1) {
      joined.push(trimmed);
    } else if (joined.length > 0) {
      // Continuation of previous line
      joined[joined.length - 1] += trimmed;
    }
    // else: orphan line before any record — skip
  }
  return joined;
}

/**
 * Parse a BC3/FIEBDC-3 file content string.
 * Pure function, no side effects.
 */
export function parseBC3(content: string): ParsedBC3 {
  const rawLines = content.split(/\r?\n/);
  const totalLines = rawLines.length;
  const lines = joinContinuationLines(rawLines);

  const metadata: BC3Metadata = {
    fiebdcVersion: "",
    generatedBy: "",
    headerTitle: "",
    currency: "EUR",
    decimals: [],
    constants: {},
  };

  const concepts: BC3Concept[] = [];
  const decompositions: BC3Decomposition[] = [];
  const longTexts: BC3LongText[] = [];
  const warnings: BC3Warning[] = [];

  let parsedRecords = 0;
  let skippedRecords = 0;
  let errorLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based for human readability

    // Every valid record starts with ~X| where X is a letter
    if (!line.startsWith("~")) {
      warnings.push({
        line: lineNum,
        record: "?",
        message: `Line does not start with ~: "${line.substring(0, 60)}..."`,
      });
      errorLines++;
      continue;
    }

    // Extract record type (character after ~)
    const recordType = line.charAt(1).toUpperCase();
    // Body is everything after ~X|
    const bodyStart = line.indexOf("|");
    if (bodyStart === -1) {
      warnings.push({
        line: lineNum,
        record: "?",
        message: `Malformed record — no field separator | found: "${line.substring(0, 60)}"`,
      });
      errorLines++;
      continue;
    }
    const body = line.substring(bodyStart + 1);

    if (!SUPPORTED_RECORDS.has(recordType)) {
      if (KNOWN_UNSUPPORTED.has(recordType)) {
        warnings.push({
          line: lineNum,
          record: `~${recordType}`,
          message: `Unsupported record type ~${recordType} — skipped`,
        });
      } else {
        warnings.push({
          line: lineNum,
          record: `~${recordType}`,
          message: `Unknown record type ~${recordType} — skipped`,
        });
      }
      skippedRecords++;
      continue;
    }

    try {
      switch (recordType) {
        case "V":
          parseVersion(body, metadata);
          parsedRecords++;
          break;

        case "K":
          parseConstants(body, metadata);
          parsedRecords++;
          break;

        case "C": {
          const concept = parseConcept(body);
          if (concept) {
            concepts.push(concept);
            parsedRecords++;
          } else {
            warnings.push({
              line: lineNum,
              record: "~C",
              message: "Failed to parse concept record",
            });
            errorLines++;
          }
          break;
        }

        case "D": {
          const decomp = parseDecomposition(body);
          if (decomp) {
            decompositions.push(decomp);
            parsedRecords++;
          } else {
            warnings.push({
              line: lineNum,
              record: "~D",
              message: "Failed to parse decomposition record",
            });
            errorLines++;
          }
          break;
        }

        case "T": {
          const lt = parseLongText(body);
          if (lt) {
            longTexts.push(lt);
            parsedRecords++;
          } else {
            warnings.push({
              line: lineNum,
              record: "~T",
              message: "Failed to parse long text record",
            });
            errorLines++;
          }
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({
        line: lineNum,
        record: `~${recordType}`,
        message: `Parse error: ${msg}`,
      });
      errorLines++;
    }
  }

  return {
    concepts,
    decompositions,
    longTexts,
    metadata,
    warnings,
    stats: {
      totalLines,
      parsedRecords,
      skippedRecords,
      errorLines,
    },
  };
}

// ─── Classification helpers (used by importer) ─────────────────────────────

/**
 * Classify parsed concepts into chapters, items (partidas), and resources.
 *
 * Logic:
 *   - A concept with unit="" that appears as parent in decompositions → chapter
 *   - A concept with unit!="" that appears as parent in decompositions → item (has breakdown)
 *   - A concept with unit!="" that only appears as child → resource (component)
 *   - A concept with unit!="" and no decomposition links → standalone item
 */
export interface ClassifiedConcepts {
  /** Root concept code(s) — typically the top-level bank/budget */
  rootCodes: string[];
  /** Chapter codes (unit="" and has children) */
  chapterCodes: Set<string>;
  /** Item/partida codes (unit!="" and has children = decomposition) */
  itemCodes: Set<string>;
  /** Resource codes (unit!="" and only appears as child, never as parent with children) */
  resourceCodes: Set<string>;
  /** Standalone items (unit!="" and no decomposition links at all) */
  standaloneCodes: Set<string>;
  /** Parent → children map from decompositions */
  parentChildMap: Map<string, BC3DecompositionChild[]>;
  /** Child → parent(s) map */
  childParentMap: Map<string, string[]>;
  /** Chapter hierarchy: code → parent chapter code */
  chapterParent: Map<string, string>;
  /** Chapter depth: code → level (1-based) */
  chapterDepth: Map<string, number>;
}

export function classifyConcepts(parsed: ParsedBC3): ClassifiedConcepts {
  const conceptMap = new Map<string, BC3Concept>();
  for (const c of parsed.concepts) {
    conceptMap.set(c.code, c);
  }

  // Build parent-child maps
  const parentChildMap = new Map<string, BC3DecompositionChild[]>();
  const childParentMap = new Map<string, string[]>();

  for (const d of parsed.decompositions) {
    parentChildMap.set(d.parentCode, d.children);
    for (const child of d.children) {
      const parents = childParentMap.get(child.childCode) || [];
      parents.push(d.parentCode);
      childParentMap.set(child.childCode, parents);
    }
  }

  // All codes that appear as parent
  const parentCodes = new Set(parentChildMap.keys());
  // All codes that appear as child
  const allChildCodes = new Set(childParentMap.keys());

  // Root: parent but never child
  const rootCodes: string[] = [];
  for (const code of parentCodes) {
    if (!allChildCodes.has(code)) {
      rootCodes.push(code);
    }
  }

  const chapterCodes = new Set<string>();
  const itemCodes = new Set<string>();
  const resourceCodes = new Set<string>();
  const standaloneCodes = new Set<string>();

  for (const c of parsed.concepts) {
    if (rootCodes.includes(c.code)) continue; // skip root

    const isParent = parentCodes.has(c.code);
    const hasUnit = c.unit !== "";

    if (!hasUnit && isParent) {
      // Chapter: no unit, has children
      chapterCodes.add(c.code);
    } else if (!hasUnit && !isParent && allChildCodes.has(c.code)) {
      // Chapter without own ~D record: no unit, child of ROOT or another chapter
      // (some BC3 generators omit ~D records for leaf chapters)
      chapterCodes.add(c.code);
    } else if (hasUnit && isParent) {
      // Item/partida: has unit and has decomposition
      itemCodes.add(c.code);
    } else if (hasUnit && !isParent && allChildCodes.has(c.code)) {
      // Resource: has unit, only appears as child
      resourceCodes.add(c.code);
    } else if (hasUnit && !isParent && !allChildCodes.has(c.code)) {
      // Standalone item: has unit, no decomposition links at all
      standaloneCodes.add(c.code);
    }
    // else: no unit, not parent, probably a malformed record — ignore
  }

  // Build chapter hierarchy
  const chapterParent = new Map<string, string>();
  for (const [parentCode, children] of parentChildMap) {
    if (chapterCodes.has(parentCode) || rootCodes.includes(parentCode)) {
      for (const child of children) {
        if (chapterCodes.has(child.childCode)) {
          chapterParent.set(child.childCode, parentCode);
        }
      }
    }
  }

  // Calculate chapter depths
  const chapterDepth = new Map<string, number>();
  function getDepth(code: string): number {
    if (chapterDepth.has(code)) return chapterDepth.get(code)!;
    const parent = chapterParent.get(code);
    if (!parent || rootCodes.includes(parent)) {
      chapterDepth.set(code, 1);
      return 1;
    }
    const d = getDepth(parent) + 1;
    chapterDepth.set(code, d);
    return d;
  }
  for (const code of chapterCodes) {
    getDepth(code);
  }

  return {
    rootCodes,
    chapterCodes,
    itemCodes,
    resourceCodes,
    standaloneCodes,
    parentChildMap,
    childParentMap,
    chapterParent,
    chapterDepth,
  };
}

/**
 * Infer component_type from BC3 concept type field and name heuristics.
 * type: 1=labor, 2=machinery, 3=material, 0=unclassified
 */
export function inferComponentType(
  concept: BC3Concept
): "labor" | "material" | "machinery" | "auxiliary" {
  if (concept.type === 1) return "labor";
  if (concept.type === 2) return "machinery";
  if (concept.type === 3) return "material";

  // Heuristic from name
  const lower = concept.summary.toLowerCase();
  if (
    lower.includes("oficial") ||
    lower.includes("peón") ||
    lower.includes("peon") ||
    lower.includes("ayudante") ||
    lower.includes("capataz") ||
    lower.includes("encargado")
  ) {
    return "labor";
  }
  if (
    lower.includes("hormigonera") ||
    lower.includes("grúa") ||
    lower.includes("grua") ||
    lower.includes("compresor") ||
    lower.includes("retroexcavadora") ||
    lower.includes("camión") ||
    lower.includes("camion") ||
    lower.includes("martillo")
  ) {
    return "machinery";
  }
  if (concept.unit === "%" || lower.includes("auxiliar")) {
    return "auxiliary";
  }

  return "auxiliary"; // default for unclassified
}
