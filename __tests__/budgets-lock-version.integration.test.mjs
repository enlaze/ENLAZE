import test from "node:test";
import assert from "node:assert/strict";
import { MIGRATION, DATABASE, MARKER, read, block, connectionConfig, assertCluster } from "./lib/budgets-lock-version-bench.mjs";

// Destructivo SÓLO dentro del clúster desechable, nunca una base de trabajo.
// Reutiliza el bootstrap de la RPC y lo amplía con un fixture de cabecera.
// No es una reproducción completa del esquema de Supabase ni un test PostgREST.
test("E1 sobre PostgreSQL 17 aislado", { timeout: 120000 }, async (t) => {
  if (process.env.RUN_BUDGET_LOCK_VERSION_INTEGRATION_TESTS !== "1") {
    t.skip("NOT RUN: se requiere opt-in al clúster desechable");
    return;
  }
  const config = connectionConfig(process.env);
  const { Client } = await import("pg");
  const admin = new Client(config);
  t.after(async () => { await admin.end(); });
  await admin.connect();
  const { rows: [cluster] } = await admin.query(`select
    current_database() as database, current_setting('enlaze.test_cluster_marker', true) as marker,
    (select rolsuper from pg_roles where rolname = current_user) as superuser,
    host(inet_server_addr()) as address, current_setting('server_version_num') as version_num,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres', '${DATABASE}')) as other_databases`);
  assertCluster(cluster);
  t.diagnostic(`PostgreSQL ${cluster.version_num}; ${DATABASE}; marcador ${MARKER}`);

  // Leer todos los artefactos antes de ejecutar DDL. Ningún fichero de entorno.
  const bootstrap = read("__tests__/support/bootstrap-budget-schema.sql");
  const legacy = ["20260904120000_replace_budget_items.sql", "20260908111706_replace_budget_items_persist_cost.sql"]
    .map((name) => read(`supabase/migrations/${name}`));
  const migration = read(`supabase/migrations/${MIGRATION}`);
  const rollback = block(read("docs/fase2/ROLLBACK.sql"), "ROLLBACK_2F2_E1");
  const fingerprintSql = block(read("docs/fase2/CHECKS.sql"), "CHECK_12_FINGERPRINT");
  const valuesSql = block(read("docs/fase2/CHECKS.sql"), "CHECK_12_VALUES");
  const OWNER = "11111111-1111-4111-8111-111111111111";
  let budgetId;

  async function apply(sql) {
    await admin.query("begin");
    try { await admin.query(sql); await admin.query("commit"); }
    catch (error) { await admin.query("rollback"); throw error; }
  }
  async function undo(ack = true) {
    await admin.query("select set_config('enlaze.allow_lock_version_rollback', $1, false)",
      [ack ? "before_revision_clients" : ""]);
    try { await admin.query(rollback); }
    catch (error) { await admin.query("rollback"); throw error; }
    finally { await admin.query("reset enlaze.allow_lock_version_rollback"); }
  }
  async function setup(candidate = migration) {
    await admin.query(bootstrap);
    // Fixture E1 basado en la auditoría de 2026-09-08, NO lectura actual de producción.
    // El bootstrap compartido sólo modela lo necesario para replace_budget_items.
    await admin.query(`alter table public.budgets
      alter column status drop not null, alter column status set default 'pending',
      add column version integer default 1,
      add column subtotal numeric(12,2), add column iva_percent numeric(5,2),
      add column iva_amount numeric(12,2), add column total numeric(12,2),
      add column wizard_state jsonb default '{}'::jsonb;
      insert into auth.users (id) values ('${OWNER}');
      insert into public.budgets (user_id, title, status, version, subtotal, iva_percent, iva_amount, total)
      select '${OWNER}', 'fixture E1 ' || n,
             (array['borrador','pendiente','enviado','aceptado','rechazado'])[1 + n % 5],
             1 + n % 3, 60.01, 21, 12.60, 72.61 from generate_series(1,18) n;
      insert into public.budget_items
        (budget_id, sort_order, concept, quantity, unit_price, subtotal, unit_price_cost, subtotal_cost)
      select id, n, 'fixture item ' || n, 2, 20, 40.01, 10.11, 20.22
      from public.budgets cross join generate_series(0,1) n;`);
    for (const sql of legacy) await apply(sql);
    budgetId = (await admin.query("select id from public.budgets order by id limit 1")).rows[0].id;
    if (candidate !== null) await apply(candidate);
  }
  async function data() { return (await admin.query(fingerprintSql)).rows[0]; }
  async function catalog() {
    // Catálogo relevante, no pg_dump completo: columnas visibles, restricciones,
    // índices, políticas, triggers, ACL y cuerpos de funciones de public/auth.
    return (await admin.query(`select
      (select jsonb_agg(jsonb_build_array(c.relname, a.attname, format_type(a.atttypid,a.atttypmod),
               a.attnotnull, pg_get_expr(d.adbin,d.adrelid), col_description(c.oid,a.attnum))
               order by c.relname,a.attname)
       from pg_attribute a join pg_class c on c.oid=a.attrelid
       join pg_namespace n on n.oid=c.relnamespace
       left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
       where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped) as columns,
      (select jsonb_agg(jsonb_build_array(conrelid::regclass::text, conname, pg_get_constraintdef(oid),convalidated)
               order by conrelid,conname) from pg_constraint where connamespace='public'::regnamespace) as constraints,
      (select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
               order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','auth') and c.relkind='r') as tables,
      (select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.prosrc,p.proacl,p.prosecdef,p.proconfig)
               order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','auth')) as functions,
      (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)
       from pg_policies p where schemaname in ('public','auth')) as policies,
      (select jsonb_agg(jsonb_build_array(tgrelid::regclass::text,tgname,pg_get_triggerdef(oid),tgenabled)
               order by tgrelid,tgname) from pg_trigger where not tgisinternal
       and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)) as triggers,
      (select jsonb_agg(to_jsonb(i) order by schemaname,tablename,indexname)
       from pg_indexes i where schemaname in ('public','auth')) as indexes`)).rows[0];
  }
  async function insertRevision(value) {
    return admin.query("insert into public.budgets(user_id, lock_version) values($1,$2) returning lock_version", [OWNER, value]);
  }
  const rejectNull = () => assert.rejects(insertRevision(null), { code: "23502" });
  const rejectZero = () => assert.rejects(insertRevision(0), { code: "23514", constraint: "ck_budgets_lock_version_positive" });
  async function checkDefault() {
    const { rows: [row] } = await admin.query("insert into public.budgets(user_id) values($1) returning lock_version", [OWNER]);
    assert.equal(row.lock_version, 1);
  }

  await t.test("expansión conserva filas, importes, heap y catálogo ajeno", async () => {
    await setup(null);
    const before = await data();
    const schemaBefore = await catalog();
    const physical = async () => (await admin.query(`select
      pg_relation_filenode('public.budgets') as heap,
      (select jsonb_agg(jsonb_build_array(id,ctid::text,xmin::text) order by id) from public.budgets) as tuples`)).rows[0];
    const heapBefore = await physical();
    await apply(migration);
    assert.deepEqual(await data(), before);
    assert.deepEqual(await physical(), heapBefore);
    const schemaAfter = await catalog();
    assert.equal(schemaAfter.columns.length, schemaBefore.columns.length + 1);
    assert.equal(schemaAfter.constraints.length, schemaBefore.constraints.length + 1);
    schemaAfter.columns = schemaAfter.columns.filter((c) => !(c[0] === "budgets" && c[1] === "lock_version"));
    schemaAfter.constraints = schemaAfter.constraints.filter((c) => c[1] !== "ck_budgets_lock_version_positive");
    assert.deepEqual(schemaAfter, schemaBefore);
    assert.deepEqual((await admin.query(valuesSql)).rows[0], { total_rows: "18", invalid_rows: "0", not_initial: "0" });
  });
  await t.test("catálogo: integer, DEFAULT 1, NOT NULL y CHECK validado", async () => {
    await setup();
    const { rows: [column] } = await admin.query(`select data_type,is_nullable,column_default from information_schema.columns
      where table_schema='public' and table_name='budgets' and column_name='lock_version'`);
    assert.deepEqual(column, { data_type: "integer", is_nullable: "NO", column_default: "1" });
    const { rows: [constraint] } = await admin.query(`select convalidated, pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='public.budgets'::regclass and conname='ck_budgets_lock_version_positive'`);
    assert.equal(constraint.convalidated, true);
    assert.equal(constraint.definition, "CHECK ((lock_version >= 1))");
    await checkDefault();
  });
  await t.test("NULL, cero y negativos fallan sin modificar filas", async () => {
    await setup();
    const before = await data();
    await rejectNull(); await rejectZero();
    await assert.rejects(insertRevision(-1), { code: "23514" });
    await assert.rejects(admin.query("update public.budgets set lock_version=0 where id=$1", [budgetId]), { code: "23514" });
    assert.deepEqual(await data(), before);
  });
  await t.test("revisiones positivas y version documental independientes", async () => {
    await setup();
    assert.equal((await insertRevision(2)).rows[0].lock_version, 2);
    const before = (await admin.query("select version from public.budgets where id=$1", [budgetId])).rows[0].version;
    await admin.query("update public.budgets set lock_version=lock_version+1 where id=$1", [budgetId]);
    assert.deepEqual((await admin.query("select version,lock_version from public.budgets where id=$1", [budgetId])).rows[0],
      { version: before, lock_version: 2 });
  });
  await t.test("no restringe status ni cambia su default pending / nullable", async () => {
    await setup();
    for (const status of ["borrador","pendiente","enviado","aceptado","rechazado","pending","accepted","rejected",null]) {
      const { rows: [row] } = await admin.query("insert into public.budgets(user_id,status) values($1,$2) returning status,lock_version", [OWNER,status]);
      assert.deepEqual(row, { status, lock_version: 1 });
    }
    assert.equal((await admin.query("insert into public.budgets(user_id) values($1) returning status", [OWNER])).rows[0].status, "pending");
  });
  await t.test("writer legado conserva orden y costes; E1 no incrementa revisiones", async () => {
    await setup();
    const before = (await admin.query("select to_jsonb(b)::text as row from public.budgets b where id=$1", [budgetId])).rows[0].row;
    await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
    await admin.query("set role authenticated");
    try {
      const items = ["A","B"].map((concept) => ({ concept, quantity: 2, unit_price: 20, subtotal: 40.01, unit_price_cost: 10.11, subtotal_cost: 20.22 }));
      assert.equal((await admin.query("select public.replace_budget_items($1,$2::jsonb) as count", [budgetId, JSON.stringify(items)])).rows[0].count, 2);
    } finally { await admin.query("reset role"); }
    assert.equal((await admin.query("select to_jsonb(b)::text as row from public.budgets b where id=$1", [budgetId])).rows[0].row, before);
    assert.deepEqual((await admin.query("select concept,sort_order,subtotal::text,subtotal_cost::text from public.budget_items where budget_id=$1 order by sort_order", [budgetId])).rows,
      [{ concept:"A",sort_order:0,subtotal:"40.01",subtotal_cost:"20.22" }, { concept:"B",sort_order:1,subtotal:"40.01",subtotal_cost:"20.22" }]);
  });
  await t.test("drift: una columna existente aborta sin ignorar su definición", async () => {
    await setup(null);
    await admin.query("alter table public.budgets add column lock_version text default 'unexpected'");
    const before = await catalog();
    await assert.rejects(apply(migration), { code: "42701" });
    assert.deepEqual(await catalog(), before);
  });
  await t.test("contención: vence lock_timeout sin despliegue parcial", async () => {
    await setup(null);
    const before = await catalog();
    const locker = new Client(config);
    try {
      await locker.connect(); await locker.query("begin; lock table public.budgets in share mode");
      await assert.rejects(apply(migration), { code: "55P03" });
    } finally { await locker.query("rollback").catch(() => {}); await locker.end(); }
    assert.deepEqual(await catalog(), before);
  });
  await t.test("reversión sin confirmación se niega sin efectos", async () => {
    await setup(); const before = await catalog();
    await assert.rejects(undo(false), { code: "55000" });
    assert.deepEqual(await catalog(), before);
  });
  await t.test("reversión no borra revisiones utilizadas", async () => {
    await setup(); await admin.query("update public.budgets set lock_version=2 where id=$1", [budgetId]);
    await assert.rejects(undo(), { code: "55000" });
    assert.equal((await admin.query("select lock_version from public.budgets where id=$1", [budgetId])).rows[0].lock_version, 2);
  });
  await t.test("reversión se niega si ya existen RPC nuevas", async () => {
    await setup();
    await admin.query("create function public.save_budget() returns integer language sql as 'select 1'");
    await assert.rejects(undo(), { code: "55000" });
  });
  await t.test("reversión permitida restaura datos y catálogo; permite reaplicar", async () => {
    await setup(null); const before = await catalog(); const rowsBefore = await data();
    await apply(migration); await undo();
    assert.deepEqual(await catalog(), before);
    assert.deepEqual(await data(), rowsBefore);
    await apply(migration); await checkDefault();
  });
  for (const [label, mutate, verify] of [
    ["NOT NULL", (s) => s.replace("not null default", "default"), rejectNull],
    ["DEFAULT", (s) => s.replace("default 1", ""), checkDefault],
    ["CHECK", (s) => s.replace("constraint ck_budgets_lock_version_positive check (lock_version >= 1)", ""), rejectZero],
  ]) {
    await t.test(`control negativo real: eliminar ${label} hace fallar su prueba`, async () => {
      const mutant = mutate(migration); assert.notEqual(mutant, migration);
      if (label === "DEFAULT") {
        // Con filas previas, quitar DEFAULT hace fallar el propio ADD COLUMN
        // NOT NULL, antes del primer INSERT del cliente. Ése es el fallo esperado.
        await setup(null);
        const before = await catalog(); const rowsBefore = await data();
        await assert.rejects(apply(mutant), { code: "23502", table: "budgets", column: "lock_version" });
        assert.deepEqual(await catalog(), before);
        assert.deepEqual(await data(), rowsBefore);
      } else {
        await setup(mutant);
        await assert.rejects(verify(), { code: "ERR_ASSERTION", message: /Missing expected rejection/ });
      }
      await setup(); await verify();
    });
  }
});
