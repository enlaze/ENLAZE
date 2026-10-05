import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const dbName = "enlaze_revision_rpcs_test";
const migration = readFileSync(new URL(
  "../supabase/migrations/20261005120000_anon_privileges_sentinel.sql",
  import.meta.url), "utf8");

test("E5: solo service_role puede invocar el centinela en PG17 desechable",
  { skip: !enabled, timeout: 120000 }, async (t) => {
  assert.equal(process.env.PORTAL_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);
  const socket = process.env.PORTAL_TEST_SOCKET;
  if (socket) assert.match(socket, /^\/private\/tmp\/enlaze-e2-bench\.[A-Za-z0-9]+$/);
  else assert.equal(process.env.TEST_DATABASE_URL,
    "postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/enlaze_revision_rpcs_test");

  const { Client } = await import("pg");
  const db = new Client(socket
    ? { host: socket, port: 55435, user: "postgres", database: dbName }
    : { connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  t.after(async () => db.end().catch(() => {}));

  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    current_setting('server_version_num')::integer as version,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres',current_database()))::integer as other_dbs`)).rows[0];
  assert.equal(identity.db, dbName);
  assert.equal(identity.marker, "budget_revision_rpcs_2f2");
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.other_dbs, 0);

  await db.query("drop schema if exists public cascade; create schema public");
  await db.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then
      create role service_role nologin noinherit;
    end if;
  end $$`);
  await db.query("grant usage on schema public to anon, authenticated, service_role");

  const asRole = async (role, query) => {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      return await db.query(query);
    } finally {
      await db.query("rollback");
    }
  };

  await t.test("control negativo: una función nueva sería invocable por anon", async () => {
    await db.query("create function public.probe() returns integer language sql as $$ select 1 $$");
    assert.equal((await asRole("anon", "select public.probe() as n")).rows[0].n, 1);
    await db.query("drop function public.probe()");
  });

  await db.query(migration);

  await t.test("anon recibe 42501 al ejecutar la función", async () => {
    await assert.rejects(() => asRole("anon", "select * from public.anon_privileges_sentinel()"),
      (error) => error.code === "42501");
  });

  await t.test("authenticated tampoco puede ejecutar", async () => {
    await assert.rejects(() => asRole("authenticated", "select * from public.anon_privileges_sentinel()"),
      (error) => error.code === "42501");
  });

  await t.test("service_role sí recibe OK y los recuentos", async () => {
    const rows = (await asRole("service_role", "select * from public.anon_privileges_sentinel()")).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { veredicto: "OK", reaparecidas: "0", nombres: "" });
  });

  await t.test("nombra una tabla nueva con privilegios para anon", async () => {
    await db.query("create table public.tabla_abierta_e5(id integer)");
    await db.query("grant select on public.tabla_abierta_e5 to anon");
    const rows = (await asRole("service_role", "select * from public.anon_privileges_sentinel()")).rows;
    assert.deepEqual(rows[0], {
      veredicto: "REVISAR: 1 tablas conceden privilegios a anon: tabla_abierta_e5",
      reaparecidas: "1",
      nombres: "tabla_abierta_e5",
    });
  });
});
