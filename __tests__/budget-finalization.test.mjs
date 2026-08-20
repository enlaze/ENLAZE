import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isCanonicalBudgetItemUnit,
  normalizeBudgetItemUnit,
} from "../lib/budget-units.ts";
import { buildScopeMaterials } from "../lib/budget-engine.ts";

test("budget item units are normalized to the database whitelist", () => {
  const cases = new Map([
    ["lotes", "lote"],
    ["unidad", "ud"],
    ["Unidades", "ud"],
    ["m²", "m2"],
    ["metros lineales", "ml"],
    ["saco", "sacos"],
    ["rollo", "rollos"],
    ["cubo", "cubos"],
    ["Partida alzada", "pa"],
    ["formato inventado por IA", "ud"],
  ]);

  for (const [input, expected] of cases) {
    const normalized = normalizeBudgetItemUnit(input);
    assert.equal(normalized, expected, input);
    assert.ok(isCanonicalBudgetItemUnit(normalized), normalized);
  }
});

test("every deterministic construction material can be finalized", () => {
  const materials = buildScopeMaterials({
    superficie_m2: 160,
    num_banos: 2,
    incluye_cocina: true,
    incluye_ventanas: true,
    incluye_climatizacion: true,
    estancias: ["vivienda_completa"],
    actuaciones: [
      "demoliciones", "albanileria", "electricidad", "fontaneria", "climatizacion",
      "alicatados", "pavimentos", "pintura", "carpinteria_interior",
      "carpinteria_exterior", "cocina_montaje", "banos_sanitarios", "iluminacion",
      "limpieza_final", "gestion_residuos",
    ],
    calidad: "media",
    ubicacion: "Alicante",
  });

  assert.ok(materials.length > 0);
  assert.ok(materials.every((material) =>
    isCanonicalBudgetItemUnit(normalizeBudgetItemUnit(material.unit))
  ));
  assert.ok(materials.every((material) => material.unit !== "lotes"));
});

test("the budget wizard normalizes both items and materials before inserts", async () => {
  const source = await readFile(
    new URL("../app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", import.meta.url),
    "utf8",
  );
  const normalizationCalls = source.match(/unit: normalizeBudgetItemUnit\([pm]\.unit\)/g) || [];

  assert.ok(normalizationCalls.length >= 4, `found ${normalizationCalls.length} normalization calls`);
  assert.match(source, /if \(itemsError\) throw itemsError/);
});

test("PDF preparation no longer invokes Python or pip at runtime", async () => {
  const route = await readFile(
    new URL("../app/api/budgets/pdf/route.ts", import.meta.url),
    "utf8",
  );
  const detailPage = await readFile(
    new URL("../app/dashboard/budgets/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(route, /pip3|reportlab|execSync|child_process/);
  assert.match(route, /generateBudgetPDFHTML/);
  assert.match(route, /X-Enlaze-PDF-Mode/);
  assert.match(detailPage, /const pdfWindow = window\.open/);
  assert.match(detailPage, /printPDF\(html, pdfWindow\)/);
});
