// E6 lote 1 — `authenticated` pierde TRUNCATE, REFERENCES, TRIGGER y MAINTAIN.
//
// Lo que de verdad hay que demostrar es que ANTES se podía truncar. RLS no
// cubre TRUNCATE, así que hoy un usuario autenticado con conexión directa
// vacía la tabla que quiera. Una prueba que solo comprobara «después no se
// puede» pasaría igual si el rol nunca hubiera podido.
//
// Y lo segundo: que SELECT, INSERT, UPDATE y DELETE siguen intactos. Si esta
// migración se los llevara, rompería el panel entero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const dbName = "enlaze_revision_rpcs_test";
const MIGRACION = "supabase/migrations/20261005160000_authenticated_drop_unused_privileges.sql";

test("E6 L1 retira los cuatro privilegios sobrantes sin tocar los cuatro útiles",
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

  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  // Estado de produccion: authenticated con los ocho privilegios, y el defecto
  // del esquema concediendolos a las tablas nuevas.
  await db.query("grant all privileges on all tables in schema public to authenticated");
  await db.query("alter default privileges in schema public grant all on tables to authenticated");
  await db.query("create table public.diana_e6(id integer primary key)");
  await db.query("grant all privileges on table public.diana_e6 to authenticated");
  await db.query("insert into public.diana_e6 values (1),(2),(3)");

  const privilegios = async (tabla = "diana_e6") => (await db.query(
    `select coalesce((select split_part(split_part(a,'=',2),'/',1)
                        from unnest(relacl::text[]) a where a like 'authenticated=%'),'')
       as p from pg_class where oid = ('public.'||$1)::regclass`, [tabla])).rows[0].p;
  // Devuelve el SQLSTATE, o 'SIN ERROR'.
  const comoAuth = async (consulta) => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query(consulta);
      return "SIN ERROR";
    } catch (error) {
      return error.code;
    } finally {
      await db.query("rollback");
    }
  };
  const tablasConAnon = async () => (await db.query(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and array_to_string(c.relacl,' ') like '%anon=%'`)).rows[0].n;
  const conPrivilegio = async (letra) => (await db.query(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral (select coalesce((select split_part(split_part(a,'=',2),'/',1)
        from unnest(c.relacl::text[]) a where a like 'authenticated=%'),'') as p) g
      where n.nspname='public' and c.relkind='r' and g.p like '%'||$1||'%'`, [letra])).rows[0].n;

  let anonAntes;

  await t.test("control negativo: hoy authenticated SÍ puede truncar", async () => {
    anonAntes = await tablasConAnon();
    assert.match(await privilegios(), /D/, "la tabla concede TRUNCATE");
    assert.equal(await comoAuth("truncate table public.diana_e6"), "SIN ERROR",
      "si no pudiera truncar ya, comprobar luego que no puede no mediria nada");
  });

  await t.test("y las cuatro operaciones útiles también funcionan", async () => {
    for (const [etiqueta, consulta] of [
      ["select", "select count(*) from public.diana_e6"],
      ["insert", "insert into public.diana_e6 values (99)"],
      ["update", "update public.diana_e6 set id = id"],
      ["delete", "delete from public.diana_e6 where id = 1"],
    ]) assert.equal(await comoAuth(consulta), "SIN ERROR", etiqueta);
  });

  await t.test("el guard aborta si una tabla fuese a quedarse sin nada", async () => {
    await db.query("begin");
    try {
      await db.query("create table public.solo_xtm_e6(id integer)");
      await db.query("revoke all on table public.solo_xtm_e6 from authenticated");
      await db.query("grant references, trigger, maintain on table public.solo_xtm_e6 to authenticated");
      await assert.rejects(() => db.query(inlined(MIGRACION)),
        (e) => /would be left with no privileges for authenticated/.test(e.message));
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("aplicada: desaparecen los cuatro sobrantes", async () => {
    await db.query(inlined(MIGRACION));
    for (const letra of ["D", "x", "t", "m"]) {
      assert.equal(await conPrivilegio(letra), 0, `ninguna tabla concede ${letra}`);
    }
  });

  await t.test("y ahora truncar da 42501, permiso denegado", async () => {
    assert.equal(await comoAuth("truncate table public.diana_e6"), "42501");
  });

  await t.test("pero SELECT, INSERT, UPDATE y DELETE siguen intactos", async () => {
    assert.match(await privilegios(), /^arwd$/, "quedan exactamente los cuatro útiles");
    for (const [etiqueta, consulta] of [
      ["select", "select count(*) from public.diana_e6"],
      ["insert", "insert into public.diana_e6 values (98)"],
      ["update", "update public.diana_e6 set id = id"],
      ["delete", "delete from public.diana_e6 where id = 2"],
    ]) assert.equal(await comoAuth(consulta), "SIN ERROR", `${etiqueta} sigue permitido`);
  });

  await t.test("una tabla nueva nace sin los cuatro", async () => {
    await db.query("create table public.posterior_e6(id integer)");
    try {
      assert.doesNotMatch(await privilegios("posterior_e6"), /[Dxtm]/);
    } finally {
      await db.query("drop table public.posterior_e6");
    }
  });

  await t.test("control negativo del defecto: sin esa línea, sí nacería con ellos", async () => {
    await db.query("begin");
    try {
      await db.query("alter default privileges in schema public grant all on tables to authenticated");
      await db.query("create table public.mutante_e6(id integer)");
      assert.match(await privilegios("mutante_e6"), /D/,
        "con el defecto puesto la tabla nueva SI concede TRUNCATE");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("no se tocó anon", async () => {
    // La propiedad no es "anon esta a cero" —eso lo garantiza E5, que este
    // banco no aplica— sino que ESTA migracion no lo mueve en ningun sentido.
    assert.equal(await tablasConAnon(), anonAntes,
      "esta migracion habla solo de authenticated");
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const { detectarControlTransaccion } = await import("./lib/sql-toplevel.mjs");
    assert.deepEqual(detectarControlTransaccion(sql(MIGRACION)), []);
    assert.equal(/\bcreate\s+index\s+concurrently\b/i.test(sql(MIGRACION)), false);
  });
});
