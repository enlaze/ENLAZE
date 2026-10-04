// E5 — `anon` pierde los privilegios de tabla.
//
// Lo que hay que demostrar son tres cosas, y la primera es la que se finge con
// facilidad: que bajo el rol `anon` una consulta directa falle por PERMISO
// DENEGADO y no por RLS sin filas. Antes de la migración ya devuelve cero
// filas; una prueba que solo comprobara «cero filas» pasaría igual antes y
// después sin medir nada.
//
// Las otras dos: que `authenticated` conserve sus privilegios intactos —si la
// migración se los tocara, rompería el panel— y que el portal moderno siga
// respondiendo exactamente igual, porque sus RPC son SECURITY DEFINER y no
// dependen de los privilegios que se retiran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const dbName = "enlaze_revision_rpcs_test";

const MIGRACION = "supabase/migrations/20261004180000_anon_loses_table_privileges.sql";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PROYECTO = "90000000-0000-4000-8000-000000000001";

test("E5 retira los privilegios de tabla de anon sin tocar el resto",
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
    "20260914090000_budgets_lock_version.sql",
    "20260915140000_portal_tokens_owner_only.sql",
    "20260915150000_portal_token_read_access.sql",
    // Crea portal_respond_to_budget, la tercera RPC que el guard de E5 exige.
    "20260915160000_budget_revision_rpcs.sql",
    "20260923120000_portal_token_lifecycle.sql",
    "20260925090000_portal_token_listing.sql",
    "20260925100000_portal_token_ui_cutover.sql",
    "20260925110000_portal_tokens_least_privilege.sql",
    "20260927100000_projects_access_token_no_default.sql",
  ]) await db.query(inlined(`supabase/migrations/${m}`));

  // Los ocho proyectos con enlace heredado que el guard de S3.3(a) exige
  // encontrar: su migración se niega a vaciar un numero distinto del revisado.
  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  await db.query(`insert into public.projects(id,user_id,name,access_token)
    select ('90000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, $1, 'Obra ' || g,
           gen_random_uuid() from generate_series(1,8) g`, [OWNER]);
  for (const m of [
    "20260928120000_retire_legacy_portal_links.sql",
    "20260929100000_portal_rpcs_drop_legacy_token.sql",
  ]) await db.query(inlined(`supabase/migrations/${m}`));

  // El banco se pone en el estado de producción: anon con privilegios totales
  // sobre todas las tablas, y el defecto del esquema concediéndolos a las
  // nuevas. Sin esto la migración no tendría nada que revocar y la prueba
  // pasaría por vacío.
  await db.query("grant all privileges on all tables in schema public to anon, authenticated");
  await db.query("alter default privileges in schema public grant all on tables to anon, authenticated");

  const moderno = (await db.query(`insert into public.portal_tokens
      (project_id,token,permissions,is_active,created_by)
    values($1,gen_random_uuid(),'["read","approve_changes"]'::jsonb,true,$2)
    returning token::text as t`, [PROYECTO, OWNER])).rows[0].t;

  const conAnon = async () => (await db.query(`select count(*)::int as n from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
    where s.nspname='public' and c.relkind='r'
      and array_to_string(c.relacl,' ') like '%anon=%'`)).rows[0].n;
  const conAuth = async () => (await db.query(`select count(*)::int as n from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
    where s.nspname='public' and c.relkind='r'
      and array_to_string(c.relacl,' ') like '%authenticated=arwdDxtm%'`)).rows[0].n;
  const huella = async () => (await db.query(
    "select md5(public.portal_read_snapshot($1)::text) as h", [moderno])).rows[0].h;
  // Devuelve el código SQLSTATE, o 'SIN ERROR' con el número de filas.
  const leerComoAnon = async (tabla) => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const r = await db.query(`select count(*)::int as n from public.${tabla}`);
      return `SIN ERROR (${r.rows[0].n} filas)`;
    } catch (error) {
      return error.code;
    } finally {
      await db.query("rollback");
    }
  };

  let antesAuth, antesHuella;

  await t.test("control negativo: hoy anon no da error, da cero filas", async () => {
    assert.ok(await conAnon() > 0, "el banco reproduce el estado de produccion");
    for (const tabla of ["projects", "budgets", "clients"]) {
      assert.match(await leerComoAnon(tabla), /^SIN ERROR/,
        `${tabla}: hoy RLS filtra pero el privilegio esta ahi`);
    }
    antesAuth = await conAuth();
    antesHuella = await huella();
    assert.ok(antesAuth > 0 && antesHuella);
  });

  await t.test("sin las tres RPC del portal, la migración se niega", async () => {
    await db.query("begin");
    try {
      await db.query("revoke execute on function public.portal_read_snapshot(text) from anon");
      await assert.rejects(() => db.query(inlined(MIGRACION)),
        (e) => /expected the 3 portal RPCs to be SECURITY DEFINER and executable by anon, found 2/.test(e.message),
        "retirar los privilegios sin esa via dejaria el portal incomunicado");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("aplicada: anon pierde los privilegios en todas las tablas", async () => {
    await db.query(inlined(MIGRACION));
    assert.equal(await conAnon(), 0, "ninguna tabla conserva privilegios para anon");
  });

  await t.test("y ahora el error es de PERMISO, no de RLS sin filas", async () => {
    for (const tabla of ["projects", "budgets", "clients"]) {
      assert.equal(await leerComoAnon(tabla), "42501",
        `${tabla}: tiene que ser permiso denegado, no cero filas`);
    }
  });

  await t.test("authenticated conserva los suyos intactos", async () => {
    assert.equal(await conAuth(), antesAuth,
      "tocar authenticated romperia el panel, que consulta tablas con el JWT del usuario");
  });

  await t.test("el portal moderno responde exactamente igual", async () => {
    assert.equal(await huella(), antesHuella,
      "las RPC son SECURITY DEFINER: no dependen de los privilegios retirados");
  });

  await t.test("una tabla nueva nace sin privilegios para anon", async () => {
    await db.query("create table public.tabla_posterior_e5(id uuid primary key)");
    try {
      const acl = (await db.query(`select coalesce(array_to_string(relacl,' '),'(por defecto)') as acl
        from pg_class where oid='public.tabla_posterior_e5'::regclass`)).rows[0].acl;
      assert.equal(/anon=/.test(acl), false, `la tabla nueva no concede nada a anon: ${acl}`);
    } finally {
      await db.query("drop table public.tabla_posterior_e5");
    }
  });

  await t.test("control negativo del defecto: sin esa línea, sí nacería abierta", async () => {
    // Si el `alter default privileges` no estuviera, la tabla nueva volveria a
    // conceder todo a anon. Esto demuestra que esa linea es la que trabaja.
    await db.query("begin");
    try {
      await db.query("alter default privileges in schema public grant all on tables to anon");
      await db.query("create table public.tabla_mutante_e5(id uuid primary key)");
      const acl = (await db.query(`select coalesce(array_to_string(relacl,' '),'(por defecto)') as acl
        from pg_class where oid='public.tabla_mutante_e5'::regclass`)).rows[0].acl;
      assert.match(acl, /anon=/, "con el defecto puesto la tabla nueva SI concede a anon");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("handle_new_user deja de ser invocable por anon", async () => {
    const acl = (await db.query(`select coalesce(array_to_string(proacl,' '),'(por defecto)') as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='handle_new_user'`)).rows[0]?.acl;
    if (acl) assert.equal(/anon=X/.test(acl), false, `anon ya no la ejecuta: ${acl}`);
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const { detectarControlTransaccion } = await import("./lib/sql-toplevel.mjs");
    assert.deepEqual(detectarControlTransaccion(sql(MIGRACION)), []);
    assert.equal(/\bcreate\s+index\s+concurrently\b/i.test(sql(MIGRACION)), false);
  });
});
