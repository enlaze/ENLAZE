import { readFileSync } from "node:fs";
import { extractFunction } from "../scripts/g3-l1b-generate.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { partidasFromBudgetItems } from '../lib/budget-item-hydration.ts';
import { saveManualPrice } from '../lib/manual-price-writer.ts';
import { resolvedPriceEvidence, generatedPriceBaseline, evidenceAfterPriceEdit, evidenceForSave,
  summarizePriceProvenance, USER_SUPPLIED_CONFIDENCE } from '../lib/budget-price-provenance.ts';
import { resolveForConcept } from '../lib/price-resolver-v2.ts';

// Fast error/identity checks; the real browser E2E owns PostgreSQL persistence,
// RLS, instrumentation and later-budget adoption.
function client({ existing = [], failure = null } = {}) {
  const writes = [];
  const query = {
    eq() { return this; }, order() { return this; },
    limit: async () => ({ data: existing, error: null }),
    select() { return this; },
    async single() { return { data: { id: 'confirmed-id', ...writes.at(-1)?.payload }, error: failure }; },
    update(payload) { writes.push({ method: 'update', payload }); return this; },
    upsert(payload) { writes.push({ method: 'upsert', payload }); return this; },
    insert(payload) { writes.push({ method: 'insert', payload }); return this; },
  };
  return { from(table) { assert.equal(table, 'price_items'); return query; }, writes };
}
const input = { userId: 'owner', sector: 'construccion', collectionBudgetId: 'budget',
  values: { name: 'Pintura pared', unit: 'm²', unit_price: 37.5, category: 'mano_obra', description: 'Acabado' } };

test('collection uses existing bank fields, canonical unit and an idempotent identity', async () => {
  const a = client(), b = client();
  const saved = await saveManualPrice(a, input);
  await saveManualPrice(b, input);
  assert.equal(a.writes[0].method, 'upsert');
  assert.deepEqual(a.writes, b.writes);
  assert.equal(saved.unit, 'm2');
  assert.equal(saved.name, 'Pintura pared');
  assert.equal(saved.unit_price, 37.5);
  assert.equal(a.writes[0].payload.is_manual_override, true);
  assert.equal(a.writes[0].payload.user_id, 'owner');
  assert.equal(a.writes[0].payload.collection_budget_id, 'budget');
  assert.equal(a.writes[0].payload.is_active, true);
});

test('existing manual prices update in place, and Precios uses the same writer', async () => {
  const bank = client({ existing: [{ id: 'existing-bank-price' }] });
  const row = await saveManualPrice(bank, input);
  assert.equal(bank.writes[0].method, 'update');
  assert.equal(row.id, 'existing-bank-price');
  const prices = client();
  await saveManualPrice(prices, { ...input, collectionBudgetId: undefined,
    values: { ...input.values, is_manual_override: true, supplier_name: 'Mi proveedor' } });
  assert.equal(prices.writes[0].method, 'insert');
  assert.equal(prices.writes[0].payload.supplier_name, 'Mi proveedor');
  assert.equal(prices.writes[0].payload.collection_budget_id, undefined);
});

test('a failed bank write is surfaced, never reported as a collected price', async () => {
  const error = new Error('write denied');
  await assert.rejects(saveManualPrice(client({ failure: error }), input), /write denied/);
  for (const unit_price of [0, -1, NaN, Infinity]) {
    const bank = client();
    await assert.rejects(saveManualPrice(bank, { ...input, values: { ...input.values, unit_price } }));
    assert.equal(bank.writes.length, 0);
  }
});

test('own evidence survives hydration/save, reduces weak amount, and loses bank identity after an unsaved price edit', () => {
  const own = resolvedPriceEvidence(37.5, 'user_supplied', USER_SUPPLIED_CONFIDENCE, '2026-10-21T12:00:00Z', 'bank-id');
  const persisted = evidenceForSave(own, 37.5);
  assert.equal(persisted.price_source_type, 'user_supplied');
  assert.equal(persisted.price_confidence, 0.95);
  const hydrated = generatedPriceBaseline(persisted, 37.5);
  const [fromDetail] = partidasFromBudgetItems([{ ...persisted, unit_price_cost: 37.5, unit_price: 45,
    concept: 'Pintura', unit: 'm2', quantity: 1 }]);
  assert.equal(fromDetail.resolved_unit_price, 37.5);
  assert.equal(fromDetail.resolved_price_item_id, 'bank-id');
  assert.equal(fromDetail.price_source, 'user_supplied');
  const edited = evidenceAfterPriceEdit(hydrated, 38, '2026-10-21T13:00:00Z');
  assert.equal(edited.price_source_type, 'user_edited');
  assert.equal(edited.price_item_id, null);
  assert.equal(evidenceAfterPriceEdit(edited, 37.5, '2026-10-21T14:00:00Z').price_item_id, 'bank-id');
  const before = [{ subtotal: 950, price_source_type: 'ai_estimate' }, { subtotal: 50, price_source_type: 'technical_bank' }];
  assert.equal(summarizePriceProvenance(before).weakPercent, 95);
  assert.equal(summarizePriceProvenance([{ ...before[0], ...persisted }, before[1]]).weakPercent, 0);
});

test('b1 returns the matched bank identity, rejects wrong units and conflicting measurements', () => {
  const row = { id: 'bank-id', name: 'Tubo PVC 32 mm', unit: 'ml', unit_price: 37.5, is_manual_override: true };
  const data = { manual_prices: [row], current_prices: [], historical_prices: [], technical_prices: [], enlaze_prices: [] };
  const concept = { concept_name: row.name, category: 'material', unit: row.unit, quantity: 2 };
  const context = { company_id: 'owner', quality_tier: 'media', province: 'Madrid' };
  const resolved = resolveForConcept(concept, context, data);
  assert.equal(resolved.source_type, 'manual_locked');
  assert.equal(resolved.source_id, 'bank-id');
  assert.notEqual(resolveForConcept({ ...concept, unit: 'ud' }, context, data).source_type, 'manual_locked');
  assert.notEqual(resolveForConcept({ ...concept, concept_name: 'Tubo PVC 50 mm' }, context, data).source_type, 'manual_locked');
});

test('the new revision writer changes only bank identity transport; rollback restores the prior body', () => {
  const read = path => readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8');
  const previous = read('supabase/migrations/20261008130000_budget_items_price_provenance_writers.sql');
  const migration = read('supabase/migrations/20261021090000_user_supplied_prices.sql');
  const rollback = read('docs/fase3/G3-OWN-PRICES-ROLLBACK.sql');
  const body = source => extractFunction(source, 'create or replace function budget_internal.replace_items(', '$fn$;');
  const withoutIdentity = body(migration).replace(', price_item_id)', ')')
    .replace(",\n    nullif(t.item->>'price_item_id', '')::uuid", '');
  assert.equal(withoutIdentity, body(previous), 'all economic, canonical and authorization behavior is unchanged');
  assert.equal(body(rollback), body(previous));
});
