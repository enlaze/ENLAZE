import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceAfterPriceEdit,
  evidenceForSave,
  resolvedPriceEvidence,
  generatedPriceBaseline,
  estimatedPriceEvidence,
  AI_ESTIMATE_CONFIDENCE,
  evidenceAfterResolverMiss,
  isEstimateSourceType,
  summarizePriceProvenance,
} from "../lib/budget-price-provenance.ts";
import { assertCurrentPriceComment } from "./support/price-provenance-comment.mjs";
import { buildClientView, buildInternalView } from "../lib/budget-engine.ts";
import { generateClientPDFHTML, generateInternalPDFHTML, generateBudgetPDFHTML } from "../lib/pdf-generator.ts";

test("resolver misses preserve AI and user/real evidence, including confidence and timestamp", () => {
  for (const source of ["ai_estimate", "technical_bank", "user_edited"]) {
    const original = resolvedPriceEvidence(12, source, source === "ai_estimate" ? 0.20 : 0.95, "2026-10-08T10:00:00Z");
    assert.deepEqual(evidenceAfterResolverMiss(original, "2026-10-20T10:00:00Z"), original);
  }
  assert.equal(evidenceAfterResolverMiss({}, "2026-10-20T10:00:00Z").price_source_type, "estimated");
});

test("one weak-source definition includes NULL and market estimates, independently of confidence", () => {
  for (const source of ["estimated", "market_estimate", "ai_estimate", null, undefined])
    assert.equal(isEstimateSourceType(source), true);
  for (const source of ["technical_bank", "provider_updated", "preferred_supplier", "user_edited", "private_tariff"])
    assert.equal(isEstimateSourceType(source), false);
});

test("provenance summary weighs sale amounts, not line counts, and excludes optional lines", () => {
  const lines = [
    { subtotal: 900, price_source_type: "ai_estimate" },
    { subtotal: 30, price_source_type: "estimated" },
    { subtotal: 10, price_source_type: "market_estimate" },
    { subtotal: 10, price_source_type: null },
    { subtotal: 50, price_source_type: "technical_bank" },
    { subtotal: 5000, price_source_type: "ai_estimate", status: "opcional" },
  ];
  assert.deepEqual(summarizePriceProvenance(lines), {
    totalLines: 5, weakLines: 4, totalAmount: 1000, weakAmount: 950, weakPercent: 95,
  });
  assert.equal(summarizePriceProvenance([
    { subtotal: 950, price_source_type: "ai_estimate" },
    ...Array.from({ length: 5 }, () => ({ subtotal: 10, price_source_type: "provider_updated" })),
  ]).weakPercent, 95, "one of six lines still represents 95% of the amount");
});

test("fully resolved and empty/zero budgets have a finite 0% summary", () => {
  assert.deepEqual(summarizePriceProvenance([
    { subtotal: 30, price_source_type: "technical_bank" },
    { subtotal: 70, price_source_type: "provider_updated" },
  ]), { totalLines: 2, weakLines: 0, totalAmount: 100, weakAmount: 0, weakPercent: 0 });
  assert.equal(summarizePriceProvenance([]).weakPercent, 0);
  assert.equal(summarizePriceProvenance([{ subtotal: 0, price_source_type: null }]).weakPercent, 0);
  assert.equal(summarizePriceProvenance([
    { subtotal: 0.1, price_source_type: "ai_estimate" },
    { subtotal: 0.2, price_source_type: "technical_bank" },
  ]).totalAmount, 0.3);
});

test("a resolved line carries the exact source, confidence and date into its save payload", () => {
  const evidence = resolvedPriceEvidence(12.5, "technical_bank", 0.78, "2026-10-08T10:00:00Z");
  assert.deepEqual(evidenceForSave(evidence), {
    price_source_type: "technical_bank",
    price_confidence: 0.78,
    price_checked_at: "2026-10-08T10:00:00Z",
  });
});

test("editing the resolver price replaces its claim with user_edited, not the old source", () => {
  const original = resolvedPriceEvidence(12.5, "technical_bank", 0.78, "2026-10-08T10:00:00Z");
  const edited = evidenceAfterPriceEdit(original, 14, "2026-10-08T12:00:00Z");
  assert.deepEqual(evidenceForSave(edited), {
    price_source_type: "user_edited",
    price_confidence: 0.95,
    price_checked_at: "2026-10-08T12:00:00Z",
  });
  assert.deepEqual(evidenceForSave(evidenceAfterPriceEdit(edited, 12.5, "2026-10-08T13:00:00Z")),
    evidenceForSave(original), "restoring the exact quote restores its evidence");
  assert.deepEqual(evidenceForSave(original, 14, "2026-10-08T12:00:00Z"),
    evidenceForSave(edited), "the save boundary must catch edits from other callers too");
});

test("old payloads still carry nullable price evidence", () => {
  assert.deepEqual(evidenceForSave({}), {
    price_source_type: null,
    price_confidence: null,
    price_checked_at: null,
  });
});

test("current emitted price sources are a subset of the pending COMMENT only migration", assertCurrentPriceComment);

test("AI evidence survives save and manual edits, including reloaded lines", () => {
  const original = generatedPriceBaseline({ price_source_type: "ai_estimate",
    price_confidence: AI_ESTIMATE_CONFIDENCE, price_checked_at: "2026-10-15T09:00:00Z" }, 15);
  assert.equal(evidenceForSave(original, 15).price_confidence, 0.20);
  assert.equal(evidenceForSave(original, 15).price_source_type, "ai_estimate");
  const edited = evidenceAfterPriceEdit(original, 20, "2026-10-15T10:00:00Z");
  assert.equal(evidenceForSave(edited, 20).price_source_type, "user_edited");
  assert.equal(evidenceForSave(original, 20).price_source_type, "user_edited", "save catches another editor");
  assert.deepEqual(evidenceForSave(evidenceAfterPriceEdit(edited, 15, "2026-10-15T11:00:00Z")), evidenceForSave(original));
  const reloaded = evidenceForSave(original);
  assert.equal(evidenceAfterPriceEdit(reloaded, 20, "2026-10-15T10:00:00Z").price_source_type, "user_edited");
});

test("generation baseline never relabels or resets resolver/user evidence", () => {
  for (const source of ["technical_bank", "provider_updated", "manual_locked", "user_edited"]) {
    const original = resolvedPriceEvidence(12, source, 0.82, "2026-10-08T10:00:00Z");
    assert.deepEqual(generatedPriceBaseline(original, 12), original);
  }
  assert.deepEqual(evidenceForSave(generatedPriceBaseline({}, 12)), evidenceForSave({}),
    "a missing API assignment remains a detectable NULL, never silently repaired");
  assert.deepEqual(estimatedPriceEvidence("2026-10-15T09:00:00Z"), {
    price_source_type: "estimated", price_confidence: 0.05, price_checked_at: "2026-10-15T09:00:00Z",
  });
});

test("AI provenance appears in internal PDFs and leaves both client renderers unchanged", () => {
  const scope = { superficie_m2: 40, num_banos: 0, incluye_cocina: false, incluye_ventanas: false,
    incluye_climatizacion: false, estancias: [], actuaciones: ["pintura"], calidad: "media", ubicacion: "Madrid" };
  const item = { id: "test", concept: "Pintura pared", description: "Acabado", category: "mano_obra",
    chapter: "pintura", quantity: 40, unit: "m2", unit_price: 10, subtotal_cost: 400,
    unit_price_client: 12, subtotal_client: 480, status: "incluida" };
  const evidence = { price_source_type: "ai_estimate", price_confidence: 0.20, price_checked_at: "2026-10-15T09:00:00Z" };
  const budget = { budget_number: "TEST", title: "Pintura", service_type: "reforma", status: "borrador",
    created_at: evidence.price_checked_at, subtotal: 480, iva_percent: 21, iva_amount: 100.8, total: 580.8 };
  const material = { id: "mat", name: "Pintura", specification: "", procurementKind: "product", quantity: 2,
    unit: "ud", unit_price: 12, subtotal: 24, included: true, provider_id: "provisional",
    linked_chapter: "pintura", isRealData: false, sourceType: "estimated", ...evidence };
  const view = buildInternalView(scope, [{ ...item, ...evidence }], [material], 21);
  assert.equal(view.chapters[0].avgConfidence, 20);
  assert.equal(view.chapters[0].items[0].priceSourceType, "ai_estimate");
  assert.equal(view.chapters[0].materials[0].confidenceScore, 0.20);
  const html = generateInternalPDFHTML(budget, view);
  assert.equal((html.match(/Estimación IA · sin fuente técnica/g) || []).length, 2);
  const flatItem = { ...item, subtotal: 480 };
  assert.match(generateBudgetPDFHTML(budget, [{ ...flatItem, ...evidence }], "internal"), /Estimación IA · sin fuente técnica/);
  assert.equal(generateBudgetPDFHTML(budget, [{ ...flatItem, ...evidence }], "client"),
    generateBudgetPDFHTML(budget, [flatItem], "client"));
  assert.equal(generateClientPDFHTML(budget, buildClientView(scope, [{ ...item, ...evidence }], 21)),
    generateClientPDFHTML(budget, buildClientView(scope, [item], 21)));
  assert.doesNotMatch(generateInternalPDFHTML(budget, buildInternalView(scope, [item], [], 21)), /Estimación IA/,
    "legacy NULL is not relabeled as AI");
});
