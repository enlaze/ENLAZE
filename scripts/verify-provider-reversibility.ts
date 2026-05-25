/**
 * verify-provider-reversibility.ts
 * Commit 1.1.b.2 — Verification script for provider enrichment.
 *
 * Run: npx --yes tsx scripts/verify-provider-reversibility.ts
 */

import {
  applyProviderToAIMaterials,
  type ProviderMaterial,
  type ProviderAdjustmentMeta,
} from "../lib/provider-materials";

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ─── Test Data ──────────────────────────────────────────────────────────────

const baseAIMaterials: ProviderMaterial[] = [
  {
    id: "mat-1",
    name: "Mortero de cemento M-7.5 (saco 25kg)",
    quantity: 20,
    unit: "sacos",
    unit_price: 3.5,
    subtotal: 70,
    included: true,
    provider_id: "engine",
    isRealData: false,
    sourceType: "market_reference",
  },
  {
    id: "mat-2",
    name: "Placa de yeso laminado 13mm (Pladur N)",
    quantity: 30,
    unit: "ud",
    unit_price: 5.8,
    subtotal: 174,
    included: true,
    provider_id: "engine",
    isRealData: false,
    sourceType: "market_reference",
  },
  {
    id: "mat-3",
    name: "Azulejo porcelanico 60x60cm",
    quantity: 25,
    unit: "m2",
    unit_price: 18.5,
    subtotal: 462.5,
    included: true,
    provider_id: "engine",
    isRealData: false,
    sourceType: "market_reference",
  },
  {
    id: "mat-4",
    name: "Inodoro compacto salida dual",
    quantity: 1,
    unit: "ud",
    unit_price: 155,
    subtotal: 155,
    included: false, // not included — should be preserved as-is
    provider_id: "engine",
    isRealData: false,
    sourceType: "market_reference",
  },
];

// Provider A has a match for mat-1 and mat-3 only
const providerCatalogA: ProviderMaterial[] = [
  {
    id: "prov-a-1",
    name: "Mortero de cemento M-7.5 (saco 25kg)",
    quantity: 1,
    unit: "sacos",
    unit_price: 4.2, // different price
    subtotal: 4.2,
    included: true,
    provider_id: "leroy-merlin",
    isRealData: true,
    sourceType: "n8n_sync",
  },
  {
    id: "prov-a-2",
    name: "Azulejo porcelanico 60x60cm",
    quantity: 1,
    unit: "m2",
    unit_price: 22.0, // different price
    subtotal: 22.0,
    included: true,
    provider_id: "leroy-merlin",
    isRealData: true,
    sourceType: "n8n_sync",
  },
  {
    id: "prov-a-other",
    name: "Grifo monomando cocina",
    quantity: 1,
    unit: "ud",
    unit_price: 89.0,
    subtotal: 89.0,
    included: true,
    provider_id: "leroy-merlin",
    isRealData: true,
    sourceType: "n8n_sync",
  },
];

// Provider B has a match for mat-2 only
const providerCatalogB: ProviderMaterial[] = [
  {
    id: "prov-b-1",
    name: "Placa de yeso laminado 13mm (Pladur N)",
    quantity: 1,
    unit: "ud",
    unit_price: 6.5,
    subtotal: 6.5,
    included: true,
    provider_id: "obramat",
    isRealData: true,
    sourceType: "n8n_sync",
  },
];

// Provider C has a match with unit_price 0 (should be treated as no-match)
const providerCatalogC: ProviderMaterial[] = [
  {
    id: "prov-c-1",
    name: "Mortero de cemento M-7.5 (saco 25kg)",
    quantity: 1,
    unit: "sacos",
    unit_price: 0, // zero price — should be treated as no-match
    subtotal: 0,
    included: true,
    provider_id: "saltoki",
    isRealData: true,
    sourceType: "n8n_sync",
  },
];

const allCatalog = [...providerCatalogA, ...providerCatalogB, ...providerCatalogC];

// ─── Tests ──────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════");
console.log("  Commit 1.1.b.2 — verify-provider-reversibility");
console.log("══════════════════════════════════════════════════════════════\n");

// Test 1: Same length preserved
console.log("TEST 1: Output length equals input length");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  assert(result.length === baseAIMaterials.length, `Length: ${result.length} === ${baseAIMaterials.length}`);
}

// Test 2: Match exacto — mat-1 should get provider price
console.log("\nTEST 2: Exact match uses provider price");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  const mat1 = result.find(m => m.id === "mat-1")!;
  assert(mat1.unit_price === 4.2, `mat-1 unit_price = ${mat1.unit_price} (expected 4.2)`);
  assert(mat1.subtotal === Math.round(20 * 4.2 * 100) / 100, `mat-1 subtotal = ${mat1.subtotal} (expected ${20 * 4.2})`);
  assert(mat1.isRealData === true, "mat-1 isRealData = true");
  assert(mat1.missing_in_selected_provider === false, "mat-1 missing_in_selected_provider = false");
  assert(mat1.provider_adjustment?.applied === true, "mat-1 provider_adjustment.applied = true");
  assert(mat1.provider_adjustment?.match_type === "exact", "mat-1 match_type = exact");
  assert(mat1.provider_adjustment?.original_unit_price === 3.5, "mat-1 original_unit_price preserved = 3.5");
}

// Test 3: No match — mat-2 should keep base price with leroy-merlin
console.log("\nTEST 3: No match keeps base price and flags missing");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  const mat2 = result.find(m => m.id === "mat-2")!;
  assert(mat2.unit_price === 5.8, `mat-2 unit_price = ${mat2.unit_price} (expected 5.8, base price)`);
  assert(mat2.missing_in_selected_provider === true, "mat-2 missing_in_selected_provider = true");
  assert(mat2.provider_adjustment?.applied === false, "mat-2 provider_adjustment.applied = false");
  assert(mat2.provider_adjustment?.match_type === "none", "mat-2 match_type = none");
  assert(typeof mat2.provider_fallback_reason === "string" && mat2.provider_fallback_reason.length > 0, "mat-2 has fallback reason");
}

// Test 4: id, quantity, included are preserved
console.log("\nTEST 4: id, quantity, included are preserved");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  for (const baseMat of baseAIMaterials) {
    const r = result.find(m => m.id === baseMat.id)!;
    assert(r.id === baseMat.id, `${baseMat.id}: id preserved`);
    assert(r.quantity === baseMat.quantity, `${baseMat.id}: quantity preserved (${r.quantity})`);
    assert(r.included === baseMat.included, `${baseMat.id}: included preserved (${r.included})`);
  }
}

// Test 5: Snapshot intacto — base not mutated
console.log("\nTEST 5: Base snapshot not mutated");
{
  const snapshotBefore = JSON.stringify(baseAIMaterials);
  applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  applyProviderToAIMaterials(baseAIMaterials, allCatalog, "obramat", "Obramat");
  const snapshotAfter = JSON.stringify(baseAIMaterials);
  assert(snapshotBefore === snapshotAfter, "baseAIMaterials unchanged after two calls");
}

// Test 6: Reversibility A → B → A
console.log("\nTEST 6: Reversibility A → B → A");
{
  const resultA1 = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  const resultB = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "obramat", "Obramat");
  const resultA2 = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");

  // A1 and A2 should produce the same prices (ignoring timestamps)
  for (let i = 0; i < resultA1.length; i++) {
    assert(resultA1[i].unit_price === resultA2[i].unit_price, `A→B→A: mat[${i}] price ${resultA1[i].unit_price} === ${resultA2[i].unit_price}`);
    assert(resultA1[i].missing_in_selected_provider === resultA2[i].missing_in_selected_provider, `A→B→A: mat[${i}] missing flag matches`);
  }

  // B should be different from A for mat-2 (obramat has match, leroy doesn't)
  const bMat2 = resultB.find(m => m.id === "mat-2")!;
  assert(bMat2.unit_price === 6.5, `B: mat-2 price = 6.5 (obramat match)`);
  assert(bMat2.missing_in_selected_provider === false, "B: mat-2 not missing in obramat");
}

// Test 7: Idempotency — apply(apply(x)) same output
console.log("\nTEST 7: Idempotency");
{
  const result1 = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  // Applying again from the same base should yield the same result
  const result2 = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "leroy-merlin", "Leroy Merlin");
  for (let i = 0; i < result1.length; i++) {
    assert(result1[i].unit_price === result2[i].unit_price, `Idempotent: mat[${i}] price ${result1[i].unit_price} === ${result2[i].unit_price}`);
    assert(result1[i].subtotal === result2[i].subtotal, `Idempotent: mat[${i}] subtotal matches`);
  }
}

// Test 8: Reset — null/empty provider clears metadata
console.log("\nTEST 8: Reset (null provider) clears metadata");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, null, "");
  for (const m of result) {
    assert(m.missing_in_selected_provider === undefined, `${m.id}: missing flag cleared`);
    assert(m.provider_adjustment === undefined, `${m.id}: provider_adjustment cleared`);
    assert(m.provider_fallback_reason === undefined, `${m.id}: fallback_reason cleared`);
    assert(m.unit_price === baseAIMaterials.find(b => b.id === m.id)!.unit_price, `${m.id}: base price restored`);
  }
}

// Test 9: Empty string provider also resets
console.log("\nTEST 9: Empty string provider also resets");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "", "");
  assert(result[0].provider_adjustment === undefined, "Empty string: no provider_adjustment");
  assert(result[0].unit_price === 3.5, "Empty string: base price");
}

// Test 10: unit_price 0 in provider treated as no-match
console.log("\nTEST 10: unit_price 0 in provider treated as no-match");
{
  const result = applyProviderToAIMaterials(baseAIMaterials, allCatalog, "saltoki", "Saltoki");
  const mat1 = result.find(m => m.id === "mat-1")!;
  assert(mat1.unit_price === 3.5, `mat-1 keeps base price 3.5 (provider has 0)`);
  assert(mat1.missing_in_selected_provider === true, "mat-1 flagged as missing (provider price is 0)");
}

// Test 11: Name normalization
console.log("\nTEST 11: Name normalization matches correctly");
{
  // Already tested implicitly via exact matches, but verify the mechanism
  const baseCopy: ProviderMaterial[] = [{
    id: "norm-test",
    name: "  MORTERO de Cemento m-7.5 (saco 25kg)  ",
    quantity: 10,
    unit: "sacos",
    unit_price: 3.0,
    subtotal: 30,
    included: true,
  }];
  const result = applyProviderToAIMaterials(baseCopy, allCatalog, "leroy-merlin", "Leroy Merlin");
  assert(result[0].unit_price === 4.2, `Normalized name match: price = ${result[0].unit_price} (expected 4.2)`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All provider reversibility tests passed.\n");
  process.exit(0);
}
