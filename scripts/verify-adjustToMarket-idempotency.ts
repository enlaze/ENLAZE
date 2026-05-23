/**
 * Standalone verification of adjustToMarket idempotency.
 *
 * Run with:  npx --yes tsx scripts/verify-adjustToMarket-idempotency.ts
 * Exits 1 on failure.
 *
 * Checks (commit 1.1.a):
 *   1. Double call does not re-scale (idempotency)
 *   2. Mixed state does not scale
 *   3. Scaled materials carry market_adjustment metadata
 *   4. source / price_type / confidence_score / sourceType preserved
 *   5. Safe-area guard works with 0 / null / undefined / negative / NaN
 */
import {
  adjustToMarket,
  buildScopeMaterials,
  normalizeBudgetItemsToScope,
  calculateItemCostBreakdown,
  getMarketRange,
  type BudgetScope,
} from "../lib/budget-engine";

const baseScope: BudgetScope = {
  superficie_m2: 80,
  num_banos: 2,
  incluye_cocina: true,
  incluye_ventanas: false,
  incluye_climatizacion: false,
  estancias: ["salon", "cocina", "bano1", "bano2", "dormitorio"],
  actuaciones: ["reforma_integral"],
  calidad: "media",
  ubicacion: "Madrid",
};

const marginMultiplier = 1.20;
const marginPct = 20;
const serviceType = "reforma integral";

let failed = 0;
const fail = (msg: string) => { console.error("✗ FAIL:", msg); failed++; };
const pass = (msg: string) => { console.log("✓ PASS:", msg); };

function buildItems() {
  const raw = normalizeBudgetItemsToScope(baseScope, [], marginMultiplier);
  return raw.map(i => calculateItemCostBreakdown(i, baseScope, marginPct));
}

console.log("─── Test 0: getMarketRange returns absolute totals ─────────");
{
  const range80 = getMarketRange(baseScope, serviceType);
  const range160 = getMarketRange({ ...baseScope, superficie_m2: 160 }, serviceType);
  const ratio = range160.min / range80.min;
  if (ratio < 1.9 || ratio > 2.1) {
    fail(`getMarketRange does not scale with area (ratio=${ratio.toFixed(2)})`);
  } else {
    pass(`getMarketRange returns totals (ratio at 2x area = ${ratio.toFixed(2)})`);
  }
}

console.log("\n─── CHECK 1: double call does not re-scale ─────────────────");
{
  const items = buildItems();
  const materials = buildScopeMaterials(baseScope);

  const r1 = adjustToMarket(baseScope, items, materials, serviceType, marginMultiplier);
  const r2 = adjustToMarket(baseScope, r1.items, r1.materials, serviceType, marginMultiplier);

  const t1 = r1.items.reduce((s, i) => s + i.subtotal_client, 0);
  const t2 = r2.items.reduce((s, i) => s + i.subtotal_client, 0);

  if (Math.abs(t1 - t2) > 0.01) {
    fail(`Totals differ across runs: ${t1.toFixed(2)} vs ${t2.toFixed(2)}`);
  } else {
    pass(`Totals stable across two runs: ${t1.toFixed(2)} EUR`);
  }

  if (r2.adjusted !== false) {
    fail(`Second run must not adjust again, got adjusted=${r2.adjusted}`);
  } else {
    pass(`Second run returned adjusted=false (idempotent)`);
  }

  let drifts = 0;
  for (let i = 0; i < r1.items.length; i++) {
    if (r1.items[i].unit_price !== r2.items[i].unit_price) drifts++;
  }
  if (drifts > 0) {
    fail(`${drifts} items drift in unit_price across runs`);
  } else {
    pass(`All ${r1.items.length} items stable in unit_price`);
  }

  const r3 = adjustToMarket(baseScope, r2.items, r2.materials, serviceType, marginMultiplier);
  const t3 = r3.items.reduce((s, i) => s + i.subtotal_client, 0);
  if (Math.abs(t1 - t3) > 0.01) {
    fail(`Drift after 3 runs: ${t1.toFixed(2)} vs ${t3.toFixed(2)}`);
  } else {
    pass(`Totals stable across three runs`);
  }
}

console.log("\n─── CHECK 2: mixed state does not scale ────────────────────");
{
  const items = buildItems();
  const materials = buildScopeMaterials(baseScope);

  const r1 = adjustToMarket(baseScope, items, materials, serviceType, marginMultiplier);

  if (!r1.adjusted) {
    pass(`Scope already above floor — mixed-state check skipped`);
  } else {
    const mixed = r1.items.map((it, idx) =>
      idx === 0 ? { ...it, market_adjustment: undefined } : it
    );

    const beforeTotal = mixed.reduce((s, i) => s + i.subtotal_client, 0);
    const beforePrices = mixed.map(i => i.unit_price);
    const beforePvp = mixed.map(i => i.cost_breakdown?.pvp ?? null);

    const r2 = adjustToMarket(baseScope, mixed, r1.materials, serviceType, marginMultiplier);

    const afterTotal = r2.items.reduce((s, i) => s + i.subtotal_client, 0);

    if (r2.adjusted !== false) {
      fail(`Mixed state must yield adjusted=false, got ${r2.adjusted}`);
    } else {
      pass(`Mixed state returned adjusted=false`);
    }

    if (!r2.message.toLowerCase().includes("estado mixto")) {
      fail(`Mixed-state message expected. Got: "${r2.message}"`);
    } else {
      pass(`Mixed-state message present`);
    }

    if (Math.abs(beforeTotal - afterTotal) > 0.01) {
      fail(`Mixed state changed totals: ${beforeTotal.toFixed(2)} → ${afterTotal.toFixed(2)}`);
    } else {
      pass(`Mixed state preserved client total (${beforeTotal.toFixed(2)} EUR)`);
    }

    let priceChanges = 0;
    for (let i = 0; i < mixed.length; i++) {
      if (beforePrices[i] !== r2.items[i].unit_price) priceChanges++;
    }
    if (priceChanges > 0) {
      fail(`Mixed state modified ${priceChanges} unit_price values`);
    } else {
      pass(`Mixed state preserved all unit_price values`);
    }

    let pvpChanges = 0;
    for (let i = 0; i < mixed.length; i++) {
      const before = beforePvp[i];
      const after = r2.items[i].cost_breakdown?.pvp ?? null;
      if (before !== after) pvpChanges++;
    }
    if (pvpChanges > 0) {
      fail(`Mixed state modified ${pvpChanges} cost_breakdown.pvp values`);
    } else {
      pass(`Mixed state preserved cost_breakdown.pvp values`);
    }
  }
}

console.log("\n─── CHECK 3: scaled materials carry market_adjustment ──────");
{
  const items = buildItems();
  const materials = buildScopeMaterials(baseScope);

  const r1 = adjustToMarket(baseScope, items, materials, serviceType, marginMultiplier);

  if (!r1.adjusted) {
    pass(`No adjustment needed — material tagging check skipped`);
  } else {
    const includedMats = r1.materials.filter(m => m.included);
    const untagged = includedMats.filter(m => !m.market_adjustment?.applied);
    if (untagged.length > 0) {
      fail(`${untagged.length} included materials NOT tagged with market_adjustment`);
    } else {
      pass(`All ${includedMats.length} included materials tagged`);
    }

    const itemFactor = r1.items[0].market_adjustment?.factor;
    const matFactor = includedMats[0]?.market_adjustment?.factor;
    if (itemFactor === undefined || matFactor === undefined) {
      fail(`Missing factor on items or materials`);
    } else if (Math.abs(itemFactor - matFactor) > 1e-6) {
      fail(`Item factor (${itemFactor}) and material factor (${matFactor}) differ`);
    } else {
      pass(`Items and materials share the same scale factor (${itemFactor.toFixed(4)})`);
    }

    const sample = includedMats[0].market_adjustment!;
    const complete =
      typeof sample.applied === "boolean" &&
      typeof sample.factor === "number" &&
      typeof sample.reason === "string" &&
      typeof sample.original_unit_price === "number" &&
      typeof sample.adjusted_unit_price === "number" &&
      typeof sample.adjusted_at === "string";
    if (!complete) {
      fail(`market_adjustment metadata incomplete on material`);
    } else {
      pass(`market_adjustment metadata complete`);
    }
  }
}

console.log("\n─── CHECK 4: traceability preserved ─────────────────────────");
{
  const items = buildItems();
  const materials = buildScopeMaterials(baseScope);

  const itemSnapshot = items.map(i => i.cost_breakdown ? {
    source: i.cost_breakdown.source,
    confidence: i.cost_breakdown.confidence_score,
    type: i.cost_breakdown.price_type,
  } : null);
  const matSnapshot = materials.map(m => m.sourceType);

  const r1 = adjustToMarket(baseScope, items, materials, serviceType, marginMultiplier);

  let itemMutations = 0;
  for (let i = 0; i < r1.items.length; i++) {
    const before = itemSnapshot[i];
    const after = r1.items[i].cost_breakdown;
    if (!before || !after) continue;
    if (before.source !== after.source) itemMutations++;
    if (before.confidence !== after.confidence_score) itemMutations++;
    if (before.type !== after.price_type) itemMutations++;
  }
  if (itemMutations > 0) {
    fail(`source/confidence/type mutated in ${itemMutations} cases (items)`);
  } else {
    pass(`Items: source, confidence_score, price_type preserved`);
  }

  let matMutations = 0;
  for (let i = 0; i < r1.materials.length; i++) {
    if (matSnapshot[i] !== r1.materials[i].sourceType) matMutations++;
  }
  if (matMutations > 0) {
    fail(`sourceType mutated in ${matMutations} materials`);
  } else {
    pass(`Materials: sourceType preserved`);
  }

  if (r1.adjusted) {
    let mismatches = 0;
    for (const it of r1.items) {
      if (!it.cost_breakdown) continue;
      const cb = it.cost_breakdown;
      const directSum = cb.material_cost + cb.labor_cost + cb.equipment_cost + cb.waste_cost;
      if (Math.abs(directSum - it.subtotal_cost) > 1.0) mismatches++;
      if (Math.abs(cb.pvp - it.subtotal_client) > 1.0) mismatches++;
    }
    if (mismatches > 0) {
      fail(`${mismatches} coherence mismatches between cost_breakdown and totals`);
    } else {
      pass(`cost_breakdown numerics coherent with scaled prices`);
    }
  }
}

console.log("\n─── CHECK 5: safe-area guard ───────────────────────────────");
{
  const items = buildItems();
  const materials = buildScopeMaterials(baseScope);

  const cases: Array<[string, any]> = [
    ["0", 0],
    ["undefined", undefined],
    ["null", null],
    ["negative", -10],
    ["NaN", NaN],
  ];
  let safeAreaFailures = 0;
  for (const [label, badArea] of cases) {
    const scope = { ...baseScope, superficie_m2: badArea };
    const r = adjustToMarket(scope, items, materials, serviceType, marginMultiplier);
    if (r.adjusted !== false) {
      fail(`Bad area "${label}": adjusted should be false, got ${r.adjusted}`);
      safeAreaFailures++;
    }
    if (!Number.isFinite(r.pricePerM2)) {
      fail(`Bad area "${label}": pricePerM2 not finite (${r.pricePerM2})`);
      safeAreaFailures++;
    }
  }
  if (safeAreaFailures === 0) {
    pass(`Safe-area guard handles 0, undefined, null, negative, NaN`);
  }
}

console.log("\n─── Summary ─────────────────────────────────────────────────");
if (failed > 0) {
  console.error(`✗ ${failed} check(s) failed`);
  process.exit(1);
} else {
  console.log(`✓ All checks passed`);
  process.exit(0);
}
