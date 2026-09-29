// S3.3 paso (c) — desaparece projects.access_token.
//
// Cierra el lote. Lo que hay que demostrar: que se lleva la columna con sus
// dos índices y su restricción única, que no toca ninguna otra cosa del
// esquema, que no pierde ni una fila, que el portal moderno sigue igual — y
// que se niega a ejecutarse si quedara un solo valor, porque sobre una columna
// con datos el drop sí destruiría secretos irrecuperables.
//
// También se comprueba la compensación, que aquí sí existe: sobre una columna
// vacía, reponerla devuelve el estado exacto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const dbName = "enlaze_revision_rpcs_test";

const PASO_A = "supabase/migrations/20260928120000_retire_legacy_portal_links.sql";
const PASO_B = "supabase/migrations/20260929100000_portal_rpcs_drop_legacy_token.sql";
const PASO_C = "supabase/migrations/20260929140000_projects_drop_access_token.sql";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PROYECTO = "90000000-0000-4000-8000-000000000001";

const bloque = (nombre) =>
  sql("docs/fase2/ROLLBACK.sql").split(`-- BEGIN ${nombre}\n`)[1].split(`-- END ${nombre}`)[0];

test("S3.3 (c) retira la columna sin llevarse nada más por delante",
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

  await db.query("drop schema if exists portal_token_internal cascade");
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));
  for (const m of [
    "20260915140000_portal_tokens_owner_only.sql",
    "20260915150000_portal_token_read_access.sql",
    "20260923120000_portal_token_lifecycle.sql",
    "20260925090000_portal_token_listing.sql",
    "20260925100000_portal_token_ui_cutover.sql",
    "20260925110000_portal_tokens_least_privilege.sql",
    "20260927100000_projects_access_token_no_default.sql",
  ]) await db.query(inlined(`supabase/migrations/${m}`));

  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  await db.query(`insert into public.projects(id,user_id,name,access_token)
    select ('90000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, $1, 'Obra ' || g,
           ('bbbbbbbb-bbbb-4bbb-8bbb-' || lpad(g::text,12,'0'))::uuid
      from generate_series(1,8) g`, [OWNER]);
  const moderno = (await db.query(`insert into public.portal_tokens
      (project_id,token,permissions,is_active,created_by)
    values($1,gen_random_uuid(),'["read","approve_changes"]'::jsonb,true,$2)
    returning token::text as t`, [PROYECTO, OWNER])).rows[0].t;

  const columna = async () => (await db.query(`select count(*)::int as n from pg_attribute
    where attrelid='public.projects'::regclass and attname='access_token' and not attisdropped`)).rows[0].n;
  const indices = async () => (await db.query(`select count(*)::int as n from pg_indexes
    where schemaname='public' and tablename='projects' and indexdef like '%access_token%'`)).rows[0].n;
  const restricciones = async () => (await db.query(`select count(*)::int as n from pg_constraint
    where conrelid='public.projects'::regclass and pg_get_constraintdef(oid) like '%access_token%'`)).rows[0].n;
  const filas = async () => (await db.query("select count(*)::int as n from public.projects")).rows[0].n;
  const huellaModerna = async () => (await db.query(
    "select md5(public.portal_read_snapshot($1)::text) as h", [moderno])).rows[0].h;
  // Huella del esquema EXCLUYENDO la columna objetivo: es lo que debe quedar
  // intacto. Si cambia, la migración se llevó algo que no le tocaba.
  const esquemaSinObjetivo = async () => (await db.query(
    `select md5(string_agg(c, chr(10) order by c)) as h from (
       select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-') as c
         from information_schema.columns
        where table_schema='public'
          and not (table_name='projects' and column_name='access_token')) s`)).rows[0].h;

  let esquemaAntes, huellaAntes, filasAntes;

  await t.test("estado de partida: columna, restricción única y dos índices", async () => {
    assert.equal(await columna(), 1);
    assert.equal(await restricciones(), 1, "la unicidad de S3.1 sigue en pie");
    assert.ok(await indices() >= 1, "al menos el índice de la restricción única");
    filasAntes = await filas();
    assert.equal(filasAntes, 8);
  });

  await t.test("con enlaces vivos, (c) se niega: destruiría secretos", async () => {
    await assert.rejects(() => db.query(inlined(PASO_C)),
      (e) => /there are 8 projects with a legacy link; dropping the column would destroy them irrecoverably/.test(e.message));
  });

  await t.test("con (b) sin aplicar, (c) se niega", async () => {
    await db.query(inlined(PASO_A));
    assert.equal((await db.query(
      "select count(*)::int as n from public.projects where access_token is not null")).rows[0].n, 0);
    await assert.rejects(() => db.query(inlined(PASO_C)),
      (e) => /functions still reference access_token; apply 20260929100000 first/.test(e.message),
      "las RPC todavía nombran la columna: el drop las dejaría sin compilar");
  });

  await t.test("tras (b), (c) elimina columna, restricción e índices", async () => {
    await db.query(inlined(PASO_B));
    esquemaAntes = await esquemaSinObjetivo();
    huellaAntes = await huellaModerna();
    await db.query(inlined(PASO_C));
    assert.equal(await columna(), 0, "la columna ya no existe");
    assert.equal(await indices(), 0, "los dos índices cayeron con ella");
    assert.equal(await restricciones(), 0, "y la restricción única también");
  });

  await t.test("no se perdió ninguna fila ni se movió nada más del esquema", async () => {
    assert.equal(await filas(), filasAntes, "las ocho filas siguen ahí");
    assert.equal(await esquemaSinObjetivo(), esquemaAntes,
      "ninguna otra columna de ninguna otra tabla cambió");
  });

  await t.test("el portal moderno responde exactamente igual", async () => {
    assert.equal(await huellaModerna(), huellaAntes,
      "quitar la columna no puede alterar lo que ve un enlace moderno");
  });

  await t.test("volver a aplicarla no rompe", async () => {
    await db.query(inlined(PASO_C));
    assert.equal(await columna(), 0);
  });

  await t.test("la compensación exige reconocimiento explícito", async () => {
    await db.query("begin");
    try {
      await assert.rejects(() => db.query(bloque("ROLLBACK_E4_L3_S33C")
        .replace(/^begin;$/m, "").replace(/^commit;$/m, "")),
        (e) => /restore_empty_access_token_column acknowledgement/.test(e.message));
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("la compensación devuelve el estado exacto", async () => {
    await db.query("begin");
    try {
      await db.query("set local enlaze.allow_access_token_column_rollback = 'restore_empty_access_token_column'");
      await db.query(bloque("ROLLBACK_E4_L3_S33C").replace(/^begin;$/m, "").replace(/^commit;$/m, ""));
      assert.equal(await columna(), 1, "la columna vuelve");
      assert.equal(await restricciones(), 1, "con su restricción única");
      assert.ok(await indices() >= 1, "y su índice");
      const col = (await db.query(`select a.attnotnull as notnull,
          coalesce(pg_get_expr(d.adbin,d.adrelid),'(none)') as por_defecto
        from pg_attribute a
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='public.projects'::regclass and a.attname='access_token'`)).rows[0];
      assert.equal(col.notnull, false, "nullable, como la dejó S3.1");
      assert.equal(col.por_defecto, "(none)",
        "y SIN default: reponerlo volvería a emitir un enlace en cada alta");
      assert.equal((await db.query(
        "select count(*)::int as n from public.projects where access_token is not null")).rows[0].n, 0,
        "las ocho filas vuelven con el valor a NULL, que es el estado que había");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const { detectarControlTransaccion } = await import("./lib/sql-toplevel.mjs");
    assert.deepEqual(detectarControlTransaccion(sql(PASO_C)), []);
    assert.equal(/\bcreate\s+index\s+concurrently\b/i.test(sql(PASO_C)), false);
  });
});
