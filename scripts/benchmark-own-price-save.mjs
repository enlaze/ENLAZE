// Run only through the existing owned-cluster runner --own-price-benchmark.
// This measures the real committed save_budget HTTP RPC, not a mock or a loop
// around the trigger alone. No hosted environment, build or production push.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { config, guard, setup, read } from '../__tests__/lib/budget-revision-rpcs-bench.mjs';
import { assertNoProductionEnvironment, assertDisposableRestTarget } from '../__tests__/lib/disposable-target-guard.mjs';
import { prepareWizardProvenance } from '../__tests__/support/budget-wizard-provenance.mjs';

assertNoProductionEnvironment(process.env);
const origin = assertDisposableRestTarget(process.env.E2_REST_URL);
const db = new Client(config(process.env));
const owner = '11111111-1111-4111-8111-111111111111';
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${jwtPart({ alg: 'HS256', typ: 'JWT' })}.${jwtPart({ role: 'authenticated', sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const jwt = `${unsigned}.${createHmac('sha256', process.env.E2_JWT_SECRET).update(unsigned).digest('base64url')}`;
const headers = { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` };
const reportDir = new URL('../informes/evidencias/g3-own-prices/', import.meta.url);
const round = n => Math.round(n * 1000) / 1000;
function distribution(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const quantile = p => sorted[Math.ceil(p * sorted.length) - 1];
  return { n: values.length, mean_ms: round(values.reduce((a,b) => a+b,0) / values.length),
    median_ms: round(quantile(0.5)), p95_ms: round(quantile(0.95)), min_ms: round(sorted[0]), max_ms: round(sorted.at(-1)) };
}
async function request(path, data) {
  const response = await fetch(new URL(path, origin), { method: 'POST', headers,
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000), redirect: 'error' });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
let triggerEnabled = true;
async function toggle(enabled) {
  // Only a guarded disposable superuser connection can do this; never exposed
  // as an application RPC. Nothing else in the schema changes between A/B.
  if (enabled === triggerEnabled) return;
  await db.query(`alter table public.budget_items ${enabled ? 'enable' : 'disable'} trigger record_own_price_reuse`);
  triggerEnabled = enabled;
}
await db.connect();
try {
  await guard(db);
  await setup(db);
  await prepareWizardProvenance(db);
  await db.query('insert into auth.users values($1)', [owner]);
  async function createBeforeMigration(title, number, items) {
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      const result = (await db.query('select public.create_budget_with_items($1::jsonb,$2::jsonb) as value',
        [JSON.stringify({title, budget_number:number}), JSON.stringify(items)])).rows[0].value;
      await db.query('commit');
      return result;
    } catch (error) { await db.query('rollback'); throw error; }
  }
  const first = await createBeforeMigration('Own prices benchmark origin', 'BENCH-OWN-ORIGIN', []);
  const target = await createBeforeMigration('59-line save benchmark', 'BENCH-OWN-59', Array.from({length:59}, (_,i) => ({
    concept: `Concepto de prueba ${i}`, category:'mano_obra', quantity:2, unit:'m2', unit_price:(i+1)*1.2,
    subtotal:(i+1)*2.4, unit_price_cost:i+1, subtotal_cost:(i+1)*2,
    price_source_type:'ai_estimate', price_confidence:0.2, price_checked_at:new Date().toISOString(),
  })));
  const dataGate = async () => (await db.query(`select (select count(*)::int from public.budgets) as budgets,
    count(*)::int as lines, md5(jsonb_agg(to_jsonb(i)-'price_item_id' order by sort_order)::text) as lines_hash
    from public.budget_items i`)).rows[0];
  const durability = (await db.query("select name,setting from pg_settings where name in ('fsync','synchronous_commit','full_page_writes') order by name")).rows;
  for (const setting of durability) assert.equal(setting.setting,'on', `${setting.name} must remain durable`);
  const beforeMigration = await dataGate();
  assert.equal(beforeMigration.lines,59);
  const migrationStart = performance.now();
  await db.query('begin');
  try {
    await db.query(read('supabase/migrations/20261021090000_user_supplied_prices.sql'));
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  const localApplyMs = performance.now() - migrationStart;
  assert.deepEqual(await dataGate(), beforeMigration, 'migration preserves existing 59-line budget data');
  await db.query("notify pgrst, 'reload schema'");
  for (let i = 0; i < 50; i++) {
    const r = await fetch(new URL('/price_items?select=id,collection_budget_id&limit=1',origin), {headers});
    if (r.ok) break;
    assert.ok(i < 49, `PostgREST price_items reload: ${await r.text()}`);
    await new Promise(resolve => setTimeout(resolve,100));
  }
  const priceIds = Array.from({length:59}, () => randomUUID());
  const bank = priceIds.map((id,i) => ({ id, user_id: owner, sector: 'construccion',
    name: `Concepto de prueba ${i}`, unit: 'm2', unit_price: i+1,
    source_type: 'manual', is_manual_override: true, is_active: true,
    collection_budget_id: first.budget_id }));
  const bankResponse = await fetch(new URL('/price_items', origin), { method: 'POST', headers,
    body: JSON.stringify(bank), redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(bankResponse.status, 201, await bankResponse.text());
  let lockVersion = target.lock_version;
  const results = [];
  const raw = [];
  const blocks = 20, samplesPerBlock = 10, warmupsPerBlock = 3;
  for (const scenario of [
    { name: '59 sin reutilizacion (salida inmediata)', matched: 0, firstUse: true },
    { name: '21 propias y 38 sin fuente (primer uso)', matched: 21, firstUse: true },
    { name: '59 propias (primer uso)', matched: 59, firstUse: true },
    { name: '59 propias (autoguardado, eventos ya existentes)', matched: 59, firstUse: false },
  ]) {
    const items = priceIds.map((id,i) => ({ concept: `Concepto de prueba ${i}`, category: 'mano_obra',
      quantity: 2, unit: 'm2', unit_price: (i+1)*1.2, subtotal: (i+1)*2.4,
      unit_price_cost: i+1, subtotal_cost: (i+1)*2,
      price_source_type: i < scenario.matched ? 'manual_locked' : 'ai_estimate',
      price_confidence: i < scenario.matched ? 1 : 0.2,
      price_item_id: i < scenario.matched ? id : null, price_checked_at: new Date().toISOString() }));
    const totals = items.reduce((sum,row) => sum+row.subtotal,0);
    const payload = { title: '59-line save benchmark', subtotal: totals, iva_percent: 21, iva_amount: totals*.21, total: totals*1.21 };
    await db.query("delete from public.user_price_collection_events where event_kind='reused'");
    async function save() {
      const start = performance.now();
      const result = await request('/rpc/save_budget', { p_budget_id: target.budget_id,
        p_expected_lock_version: lockVersion, p_budget_data: payload, p_items: items });
      const ms = performance.now() - start;
      lockVersion = result.lock_version;
      assert.equal(result.items_count, 59);
      return ms;
    }
    // Existing-event scenario is explicitly seeded by a real successful save.
    if (!scenario.firstUse) { await toggle(true); await save(); }
    const samples = { off: [], on: [] }, pairedBlockMeans = [];
    for (let block=0; block<blocks; block++) {
      const blockMeans = {};
      for (const enabled of block % 2 ? [true,false] : [false,true]) {
        await toggle(enabled);
        // After ALTER TABLE, discard warmups in both modes to avoid charging
        // relcache/plan invalidation to the row trigger under test.
        for (let i=0; i<warmupsPerBlock+samplesPerBlock; i++) {
          if (scenario.firstUse) await db.query("delete from public.user_price_collection_events where event_kind='reused'");
          const ms = await save();
          if (i>=warmupsPerBlock) {
            const mode = enabled ? 'on' : 'off';
            samples[mode].push(ms);
            raw.push({scenario: scenario.name, block, mode, ms});
          }
        }
        blockMeans[enabled ? 'on' : 'off'] = samples[enabled ? 'on' : 'off'].slice(-samplesPerBlock).reduce((a,b)=>a+b,0)/samplesPerBlock;
        const expected = scenario.firstUse ? (enabled ? scenario.matched : 0) : scenario.matched;
        const actual = Number((await db.query("select count(*) as n from public.user_price_collection_events where event_kind='reused'")).rows[0].n);
        assert.equal(actual, expected, `real reuse events with trigger ${enabled}`);
      }
      pairedBlockMeans.push(blockMeans.on-blockMeans.off);
    }
    const on = distribution(samples.on), off = distribution(samples.off);
    results.push({ scenario: scenario.name, matched: scenario.matched, off, on,
      delta_medians_ms: round(on.median_ms-off.median_ms),
      delta_means_ms: round(on.mean_ms-off.mean_ms), paired_block_delta: distribution(pairedBlockMeans) });
    console.log(JSON.stringify(results.at(-1)));
  }
  await toggle(true);
  assert.equal((await db.query("select count(*)::int as n from public.budget_items where budget_id=$1",[target.budget_id])).rows[0].n,59);
  const version = (await db.query('select version() as version')).rows[0].version;
  const report = { measured_at: new Date().toISOString(), version, durability,
    machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
    target: 'owned disposable localhost cluster; real committed PostgREST 14.4 save_budget RPC',
    local_migration_apply_ms: round(localApplyMs), production_migration_push: 'NOT EXECUTED; pending separate gated deployment',
    rows_per_save: 59, blocks, samples_per_mode_per_scenario: blocks*samplesPerBlock,
    warmups_per_mode_per_block: warmupsPerBlock,
    measurement: 'wall clock fetch + real save_budget + commit + response JSON; trigger-only A/B on identical migrated schema; alternating AB/BA blocks; no concurrent client load; default PostgreSQL durability',
    limits: 'local warmed single-user bench, not production latency or lock-wait forecast; first-use ledger cleanup excluded from timings',
    results, raw_samples: "save-59-lines-samples.csv", migration_data_gate: beforeMigration };
  await mkdir(reportDir,{recursive:true});
  await writeFile(new URL('save-59-lines-benchmark.json', reportDir), JSON.stringify(report,null,2)+'\n');
  await writeFile(new URL('save-59-lines-samples.csv', reportDir), 'scenario,block,mode,ms\n'+raw.map(row=>[results.findIndex(r=>r.scenario===row.scenario),row.block,row.mode,round(row.ms)].join(',')).join('\n')+'\n');
  console.log(`Local migration apply (not production push): ${round(localApplyMs)} ms`);
} finally {
  if (!triggerEnabled) await toggle(true);
  await db.end();
}
