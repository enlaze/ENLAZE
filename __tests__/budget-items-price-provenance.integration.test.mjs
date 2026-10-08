import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectarControlTransaccion } from "./lib/sql-toplevel.mjs";

const root = new URL("../", import.meta.url);
const file = (path) => readFileSync(new URL(path, root), "utf8");
const migration = file("supabase/migrations/20261008120000_budget_items_price_provenance.sql");
const checks = file("docs/fase2/CHECKS.sql");
const resolver = file("lib/price-resolver-v2.ts");
const expectedUrl = "postgres://postgres:g3_disposable_database_only@127.0.0.1:55436/enlaze_g3_price_provenance_test";

function block(name) {
  const match = checks.match(new RegExp(`-- BEGIN ${name}\\n([\\s\\S]*?)-- END ${name}`));
  assert.ok(match, `${name} debe existir`);
  return match[1];
}

test("G3 lote 1a: procedencia de precios en budget_items", { timeout: 120000 }, async (t) => {
  assert.equal(process.env.G3_TEST_ACK, "DISPOSABLE_ONLY");
  assert.equal(process.env.G3_TEST_DATABASE_URL, expectedUrl);
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);

  const { Client } = await import("pg");
  const db = new Client({ connectionString: expectedUrl });
  await db.connect();
  t.after(async () => db.end());

  const identity = (await db.query(`select current_database() as db,
    current_setting('server_version_num')::integer as version,
    (select count(*)::integer from pg_database where not datistemplate
      and datname not in ('postgres', current_database())) as other_dbs`)).rows[0];
  assert.equal(identity.db, "enlaze_g3_price_provenance_test");
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.other_dbs, 0);

  await db.query(`drop table if exists public.budget_items cascade;
    drop schema if exists supabase_migrations cascade;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key);
    create table public.budget_items(id integer primary key, concept text not null);
    insert into public.budget_items values (1,'Partida antigua A'),(2,'Partida antigua B');`);
  const before = (await db.query("select count(*)::integer as n from public.budget_items")).rows[0].n;

  await t.test("precheck registra las filas reales y la migración no controla transacciones", async () => {
    assert.deepEqual(detectarControlTransaccion(migration), []);
    const pre = (await db.query(block("CHECK_G3_L1A_PRECHECK"))).rows[0];
    assert.equal(pre.veredicto, "OK");
    assert.equal(Number(pre.partidas), before);
    assert.equal(Number(pre.columnas_presentes), 0);
  });

  // La mutación G3_TEST_SKIP_MIGRATION prueba este mismo test contra el estado
  // anterior; no deshabilita ninguna aserción posterior.
  if (process.env.G3_TEST_SKIP_MIGRATION !== "1") {
    await db.query(migration);
    await db.query("insert into supabase_migrations.schema_migrations(version) values ('20261008120000')");
  }

  await t.test("las tres columnas tienen exactamente los tipos y son anulables", async () => {
    const columns = (await db.query(`select attname,
      format_type(atttypid,atttypmod) as type, attnotnull
      from pg_attribute where attrelid='public.budget_items'::regclass
      and attname in ('price_source_type','price_confidence','price_checked_at')
      and attnum>0 and not attisdropped order by attname`)).rows;
    assert.deepEqual(columns, [
      { attname: "price_checked_at", type: "timestamp with time zone", attnotnull: false },
      { attname: "price_confidence", type: "numeric(3,2)", attnotnull: false },
      { attname: "price_source_type", type: "text", attnotnull: false },
    ]);
  });

  await t.test("el CHECK admite NULL, 0 y 1 y rechaza 1.5", async () => {
    const constraint = (await db.query(`select pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='public.budget_items'::regclass
      and conname='ck_budget_items_price_confidence_range'`)).rows[0];
    assert.ok(constraint?.definition, "debe existir el CHECK de confianza");
    await db.query("begin");
    try {
      for (const value of [null, 0, 1]) {
        await db.query("update public.budget_items set price_confidence=$1 where id=1", [value]);
      }
    } finally {
      await db.query("rollback");
    }
    await assert.rejects(() => db.query(
      "update public.budget_items set price_confidence=1.5 where id=1"),
      (error) => error.code === "23514");
  });

  await t.test("las filas antiguas siguen intactas y con procedencia NULL", async () => {
    const rows = (await db.query(`select id, concept, price_source_type,
      price_confidence, price_checked_at from public.budget_items order by id`)).rows;
    assert.equal(rows.length, before);
    assert.deepEqual(rows.map(({ id, concept }) => [id, concept]),
      [[1, "Partida antigua A"], [2, "Partida antigua B"]]);
    for (const row of rows) {
      assert.equal(row.price_source_type, null);
      assert.equal(row.price_confidence, null);
      assert.equal(row.price_checked_at, null);
    }
  });

  await t.test("todos los source_type literales del resolutor constan en el comentario", async () => {
    const emitted = new Set([...resolver.matchAll(/source_type:\s*"([^"]+)"/g)].map((match) => match[1]));
    assert.ok(emitted.size >= 11, "la prueba debe leer la escalera del resolutor");
    const result = await db.query(`select col_description('public.budget_items'::regclass,
      (select attnum from pg_attribute where attrelid='public.budget_items'::regclass
        and attname='price_source_type')) as description`);
    const description = result.rows[0].description;
    assert.ok(description?.includes("Valores esperados:"), "debe haber una lista documentada");
    const allowed = new Set(description.split("Valores esperados:")[1].split(".")[0]
      .split(",").map((value) => value.trim()));
    for (const source of emitted) assert.ok(allowed.has(source), `${source} falta del comentario`);
  });

  if (process.env.G3_TEST_SKIP_MIGRATION !== "1") {
    await t.test("la migración puede repetirse sin alterar las partidas", async () => {
      await db.query(migration);
      const after = (await db.query("select count(*)::integer as n from public.budget_items")).rows[0].n;
      assert.equal(after, before);
    });

    await t.test("la auditoría obliga a pegar y comparar el número de filas", async () => {
      const audit = block("CHECK_G3_L1A_AUDIT");
      const placeholder = (await db.query(audit)).rows[0];
      assert.match(placeholder.veredicto, /^ABORTAR: pega el valor/);
      const completed = audit.replace("-1::bigint as partidas_precheck", `${before}::bigint as partidas_precheck`);
      const ok = (await db.query(completed)).rows[0];
      assert.match(ok.veredicto, /^OK/);
      assert.equal(Number(ok.partidas_precheck), before);
      await db.query("begin");
      try {
        await db.query("delete from public.budget_items where id=2");
        const missing = (await db.query(completed)).rows[0];
        assert.match(missing.veredicto, /^ABORTAR: budget_items paso de 2 a 1 filas$/);
      } finally {
        await db.query("rollback");
      }
    });
  }
});
