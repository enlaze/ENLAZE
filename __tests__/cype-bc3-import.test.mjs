import assert from "node:assert/strict";
import test from "node:test";
import { parseBC3, classifyConcepts } from "../lib/bc3-parser.ts";
import { calculateItemCostBreakdown } from "../lib/technical-price-importer.ts";

const cypeBarcelonaSample = [
  "~V|CYPE Ingenieros S.A.|FIEBDC-3/2016\\18082026|Generador de precios de la construcción. CYPE Ingenieros, S.A.||ANSI||2||||",
  "~K|2\\3\\3\\3\\3\\2\\2\\2\\EUR\\|",
  "~C|root##|||||0|",
  "~D|root##| 0\\1\\1\\ |",
  "~C|0#||Actuaciones previas|||0|",
  "~D|0#| 0X\\1\\1\\ |",
  "~C|0X#||Andamios y maquinaria de elevación|||0|",
  "~D|0X#| 0XA\\1\\1\\ |",
  "~C|0XA#||Andamios|||0|",
  "~D|0XA#| 0XA110\\1\\1\\ |",
  "~C|0XA110|Ud|Alquiler de andamio tubular de fachada.|0\\||0|",
  "~D|0XA110| mq13ats010a\\1\\3750\\ %\\1\\0.02\\ |",
  "~C|mq13ats010a|Ud|Alquiler diario de m² de andamio tubular.|0.1\\||2|",
  "~C|%|%|Costes directos complementarios|0\\||0|",
  "~C|re150101|kg|Envases de papel y cartón.|0\\||4|",
].join("\r\n");

test("parses the CYPE-style FIEBDC header", () => {
  const parsed = parseBC3(cypeBarcelonaSample);

  assert.equal(parsed.metadata.fiebdcVersion, "FIEBDC-3/2016");
  assert.equal(parsed.metadata.generatedBy, "CYPE Ingenieros S.A.");
  assert.equal(
    parsed.metadata.headerTitle,
    "Generador de precios de la construcción. CYPE Ingenieros, S.A."
  );
});

test("calculates CYPE percentage components using the accumulated subtotal", () => {
  const parsed = parseBC3(cypeBarcelonaSample);
  const classified = classifyConcepts(parsed);
  const concepts = new Map(parsed.concepts.map((concept) => [concept.code, concept]));
  const children = classified.parentChildMap.get("0XA110") || [];
  const breakdown = calculateItemCostBreakdown(children, concepts);

  assert.equal(breakdown.machineryCost, 375);
  assert.equal(breakdown.indirectCost, 7.5);
  assert.equal(breakdown.totalCost, 382.5);
  assert.deepEqual(breakdown.components.at(-1), {
    childCode: "%",
    componentType: "auxiliary",
    yield: 0.02,
    unitCost: 375,
    totalCost: 7.5,
  });
});

test("normalizes CYPE chapter markers and keeps waste concepts out of items", () => {
  const parsed = parseBC3(cypeBarcelonaSample);
  const classified = classifyConcepts(parsed);

  assert.deepEqual(classified.rootCodes, ["root"]);
  assert.equal(classified.chapterCodes.has("0XA"), true);
  assert.deepEqual(classified.childParentMap.get("0XA110"), ["0XA"]);
  assert.equal(classified.itemCodes.has("0XA110"), true);
  assert.equal(classified.resourceCodes.has("re150101"), true);
  assert.equal(classified.standaloneCodes.has("re150101"), false);
});
