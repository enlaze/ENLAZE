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

test("the budget wizard normalizes every row it inserts into budget_items", async () => {
  const source = await readFile(
    new URL("../app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", import.meta.url),
    "utf8",
  );
  const normalizationCalls = source.match(/unit: normalizeBudgetItemUnit\([pm]\.unit\)/g) || [];

  // Fase 1 (Opcion A): los materiales dejaron de insertarse como lineas
  // economicas del cliente, porque applyMaterialBasketToItems ya los pliega
  // dentro del coste de la partida. Quedan por tanto dos puntos de insercion
  // -saveDraft y finalizeBudget-, ambos de partidas, y ambos deben normalizar
  // la unidad. La intencion original del test se mantiene: nada llega a
  // budget_items sin normalizar.
  assert.equal(normalizationCalls.length, 2, `found ${normalizationCalls.length} normalization calls`);
  assert.ok(
    normalizationCalls.every((call) => call.includes("p.unit")),
    "solo deben insertarse partidas",
  );
  // Un error del INSERT en budget_items debe propagarse, nunca tragarse: si se tragara,
  // el asistente diria "guardado" con la tabla vacia. Desde 2D-4 hay dos puntos donde
  // ese throw vive, porque el camino del borrador se extrajo a un modulo propio para
  // poder comparar la firma antes de escribir. El contrato es el mismo en los dos.
  assert.match(source, /if \(itemsErr\) throw itemsErr/, "finalizeBudget se traga el error del INSERT");

  const sync = await readFile(
    new URL("../lib/canonical/persist-budget-items.ts", import.meta.url),
    "utf8",
  );
  assert.match(sync, /if \(error\) throw error/, "el autoguardado se traga el error del INSERT");
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
