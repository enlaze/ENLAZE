import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { config, guard, read, setup } from "./lib/budget-revision-rpcs-bench.mjs";
import { detectarControlTransaccion } from "./lib/sql-toplevel.mjs";
import { originalBodies, deployableOriginalBodies, upgradedBodies, extractFunction } from "../scripts/g3-l1b-generate.mjs";

const migration = read("supabase/migrations/20261008130000_budget_items_price_provenance_writers.sql");
const rollback = read("docs/fase2/ROLLBACK.sql");
const checks = read("docs/fase2/CHECKS.sql");
const l1a = read("supabase/migrations/20261008120000_budget_items_price_provenance.sql");
const owner = "d44a21ad-7d37-42fc-8e75-b2a8f4d67e44";
const budget = "648c5119-8f3e-420c-87ad-411332c21237";
const payload = [{
  concept: "Pintura", description: "Dos manos", quantity: 3, unit: "m2",
  category: "material", unit_price: 15.5, subtotal: 46.5,
  unit_price_cost: 8.25, subtotal_cost: 24.75,
  price_source_type: "provider_updated", price_confidence: 0.82,
  price_checked_at: "2026-10-08T10:00:00Z",
}];

function block(name) {
  const found = checks.match(new RegExp(`-- BEGIN ${name}\\n([\\s\\S]*?)-- END ${name}`));
  assert.ok(found, `${name} missing`);
  return found[1];
}

function hash(value) {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}

test("G3 L1b changes only four INSERTs and restores literal original bodies", () => {
  assert.deepEqual(detectarControlTransaccion(migration), []);
  const originals = originalBodies();
  const deployable = deployableOriginalBodies();
  const upgraded = upgradedBodies();
  const rollbackL1b = rollback.slice(rollback.indexOf("-- BEGIN ROLLBACK_G3_L1B"),
    rollback.indexOf("-- END ROLLBACK_G3_L1B") + "-- END ROLLBACK_G3_L1B".length);
  for (const [name, signature, end] of [
    ["replace", "create or replace function public.replace_budget_items(", "$function$;"],
    ["update", "create or replace function public.update_budget_with_items(", "$$;"],
    ["internal", "create or replace function budget_internal.replace_items(", "$fn$;"],
    ["duplicate", "create or replace function public.duplicate_budget(", "$fn$;"],
  ]) {
    assert.equal(extractFunction(migration, signature, end), upgraded[name]);
    assert.equal(extractFunction(rollbackL1b, signature, end), deployable[name]);
    assert.notEqual(upgraded[name], originals[name]);
  }
  assert.equal(deployable.internal.replace("create or replace function", "create function"), originals.internal);
  assert.equal(deployable.duplicate.replace("create or replace function", "create function"), originals.duplicate);
  assert.doesNotMatch(migration, /\bdrop\s+function\b/i);
  assert.match(rollback, /ROLLBACK_G3_L1B[\s\S]*ANTES de ROLLBACK_G3_L1A/);
  assert.match(migration, /user_edited/);
  const vectors = readFileSync(new URL("./fixtures/budget-economic-golden-vectors.json", import.meta.url));
  assert.equal(createHash("sha256").update(vectors).digest("hex"),
    "8c82e45f979175220f66792782250ca3b7a0e4b92dcaf996f18cb1e1b22097af",
    "economic golden vectors changed");
});

test("G3 L1b keeps rows and economic vectors byte-identical except provenance", { timeout: 120000 }, async (t) => {
  const connection = config(process.env);
  const { Client } = await import("pg");
  const db = new Client(connection);
  await db.connect();
  t.after(async () => db.end());
  await guard(db);
  await setup(db);
  await db.query(l1a);
  await db.query(originalBodies().update);
  await db.query(`create table public.budget_snapshots (
    id uuid primary key default gen_random_uuid(), budget_id uuid not null,
    user_id uuid not null, version integer not null, snapshot_type text,
    label text, items_data jsonb, summary_data jsonb, metadata jsonb,
    total_items integer, total_cost numeric, total_sale numeric,
    unique(budget_id, version));
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations(version text primary key);
    truncate supabase_migrations.schema_migrations;
    insert into supabase_migrations.schema_migrations(version) values ('20261008120000');`);
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.budgets(id,user_id,title,status) values ($1,$2,'Test','pendiente')", [budget, owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);

  const rows = async () => (await db.query(`select
    to_jsonb(i) - 'id' - 'budget_id' - 'created_at'
      - 'price_source_type' - 'price_confidence' - 'price_checked_at' as economic,
    price_source_type, price_confidence::text, price_checked_at
    from public.budget_items i where budget_id=$1 order by sort_order`, [budget])).rows;
  const totals = async () => (await db.query(`select subtotal::text, iva_amount::text,
    total::text, discount_amount::text, version from public.budgets where id=$1`, [budget])).rows[0];

  async function run(fn, items) {
    await db.query("begin");
    try {
      if (fn === "replace") {
        await db.query("select public.replace_budget_items($1,$2::jsonb)", [budget, JSON.stringify(items)]);
      } else if (fn === "update") {
        await db.query("select public.update_budget_with_items($1,$2::jsonb,$3::jsonb)",
          [budget, JSON.stringify({ title: "Test", iva_percent: 21 }), JSON.stringify(items)]);
      } else if (fn === "core") {
        // This is the wizard's real save path: public.save_budget -> save_core
        // -> budget_internal.replace_items. Calling the legacy writer here
        // would leave the most important route untested.
        await db.query("select public.save_budget($1,$2,$3::jsonb,$4::jsonb)",
          [budget, 1, JSON.stringify({ title: "Test", subtotal: 46.5,
            iva_percent: 21, iva_amount: 9.77, total: 56.27 }), JSON.stringify(items)]);
      } else {
        assert.fail(`unknown writer ${fn}`);
      }
      return { rows: await rows(), totals: await totals() };
    } finally {
      await db.query("rollback");
    }
  }

  const pre = await db.query(block("CHECK_G3_L1B_PRECHECK"));
  assert.equal(pre.rows[0].veredicto, "OK");
  assert.equal(Number(pre.rows[0].partidas), 0);

  const before = {};
  for (const fn of ["core", "replace", "update"]) before[fn] = await run(fn, payload);
  if (process.env.G3_L1B_SKIP_MIGRATION !== "1") {
    await db.query(migration);
    await db.query("insert into supabase_migrations.schema_migrations(version) values ('20261008130000')");
    // Mutation: keep the public writers upgraded, but restore the internal
    // writer. The first assertion below must still fail through save_core.
    if (process.env.G3_L1B_SKIP_INTERNAL === "1") {
      await db.query(deployableOriginalBodies().internal);
    }
    if (process.env.G3_L1B_SKIP_DUPLICATE === "1") {
      await db.query(deployableOriginalBodies().duplicate);
    }
  }

  for (const fn of ["core", "replace", "update"]) {
    const after = await run(fn, payload);
    assert.equal(hash(after.rows.map((r) => r.economic)), hash(before[fn].rows.map((r) => r.economic)),
      `${fn}: economic row hash changed`);
    assert.deepEqual(after.totals, before[fn].totals, `${fn}: budget economics changed`);
    assert.equal(after.rows[0].price_source_type, "provider_updated");
    assert.equal(after.rows[0].price_confidence, "0.82");
    assert.equal(after.rows[0].price_checked_at?.toISOString(), "2026-10-08T10:00:00.000Z");
    const legacy = await run(fn, payload.map(({ price_source_type, price_confidence, price_checked_at, ...item }) => item));
    assert.equal(legacy.rows[0].price_source_type, null);
    assert.equal(legacy.rows[0].price_confidence, null);
    assert.equal(legacy.rows[0].price_checked_at, null);
  }

  if (process.env.G3_L1B_SKIP_MIGRATION !== "1") {
    const oldDate = "2025-04-03T09:15:00Z";
    await db.query("begin");
    try {
      const historical = payload.map((item) => ({ ...item, price_checked_at: oldDate }));
      await db.query("select public.save_budget($1,$2,$3::jsonb,$4::jsonb)",
        [budget, 1, JSON.stringify({ title: "Test", subtotal: 46.5,
          iva_percent: 21, iva_amount: 9.77, total: 56.27 }), JSON.stringify(historical)]);
      const copy = (await db.query("select public.duplicate_budget($1) as result", [budget])).rows[0].result;
      assert.ok(copy.budget_id && copy.budget_id !== budget);
      const snapshot = async (id) => (await db.query(`select
        to_jsonb(i) - 'id' - 'budget_id' - 'created_at' as line,
        price_source_type, price_confidence::text, price_checked_at
        from public.budget_items i where budget_id=$1 order by sort_order`, [id])).rows;
      const source = await snapshot(budget);
      const duplicated = await snapshot(copy.budget_id);
      assert.equal(source.length, 1);
      assert.deepEqual(duplicated.map((row) => row.line), source.map((row) => row.line),
        "duplicate must copy money, category and provenance without recalculation");
      assert.equal(duplicated[0].price_source_type, "provider_updated");
      assert.equal(duplicated[0].price_confidence, "0.82");
      assert.equal(duplicated[0].price_checked_at?.toISOString(), oldDate.replace("Z", ".000Z"),
        "copy must retain the old price date, not the time of duplication");
    } finally {
      await db.query("rollback");
    }
  }

  if (process.env.G3_L1B_SKIP_MIGRATION !== "1") {
    const audit = block("CHECK_G3_L1B_AUDIT");
    assert.match((await db.query(audit)).rows[0].veredicto, /^ABORTAR: pega partidas/);
    const pasted = audit.replace("-1::bigint as partidas_precheck", "0::bigint as partidas_precheck");
    assert.match((await db.query(pasted)).rows[0].veredicto, /^OK/);
    await db.query(`insert into public.budget_items(budget_id,concept,sort_order) values ($1,'Extra',0)`, [budget]);
    assert.match((await db.query(pasted)).rows[0].veredicto, /^ABORTAR: budget_items paso de 0 a 1 filas$/);

    const rollbackL1b = rollback.slice(rollback.indexOf("-- BEGIN ROLLBACK_G3_L1B"),
      rollback.indexOf("-- END ROLLBACK_G3_L1B") + "-- END ROLLBACK_G3_L1B".length);
    await db.query(rollbackL1b);
    const restored = await run("core", payload);
    assert.equal(restored.rows[0].price_source_type, null,
      "rollback must restore the original internal writer without breaking save_core");
    await db.query("begin");
    try {
      await db.query(`update public.budget_items set price_source_type='provider_updated',
        price_confidence=0.82, price_checked_at='2025-04-03T09:15:00Z'
        where budget_id=$1`, [budget]);
      const copy = (await db.query("select public.duplicate_budget($1) as result", [budget])).rows[0].result;
      const restoredCopy = (await db.query(`select price_source_type, price_confidence, price_checked_at
        from public.budget_items where budget_id=$1`, [copy.budget_id])).rows[0];
      assert.equal(restoredCopy.price_source_type, null,
        "rollback must restore the original duplicate writer, not just save_core");
      assert.equal(restoredCopy.price_confidence, null);
      assert.equal(restoredCopy.price_checked_at, null);
    } finally {
      await db.query("rollback");
    }
  }
});
