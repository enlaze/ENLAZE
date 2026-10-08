import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceAfterPriceEdit,
  evidenceForSave,
  resolvedPriceEvidence,
} from "../lib/budget-price-provenance.ts";

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
    price_confidence: 1,
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
