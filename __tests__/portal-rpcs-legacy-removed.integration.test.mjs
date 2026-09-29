// S3.3 paso (b) — las RPC del portal dejan de aceptar enlaces heredados.
//
// Lo que hay que demostrar son dos cosas a la vez, y la segunda es la que se
// olvida: que el camino heredado desaparece, y que para un enlace moderno la
// respuesta no cambia ni un byte. Una migración que retira compatibilidad es
// fácil de escribir de más.
//
// El control negativo es obligatorio: antes de aplicar (b) un access_token
// tiene que ABRIR el portal. Si no abriera, comprobar después que devuelve
// null no mediría nada.
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
const OWNER = "11111111-1111-4111-8111-111111111111";
const CHANGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HEREDADO = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const PROYECTO = "90000000-0000-4000-8000-000000000001";

test("S3.3 (b) retira la compatibilidad heredada sin mover el portal moderno",
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

  // Cadena hasta el estado inmediatamente anterior a (a): ocho enlaces vivos.
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
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,$3,'Cambio','proposed')`, [CHANGE, OWNER, PROYECTO]);
  const moderno = (await db.query(`insert into public.portal_tokens
      (project_id,token,permissions,is_active,created_by)
    values($1,gen_random_uuid(),'["read","approve_changes"]'::jsonb,true,$2)
    returning token::text as t`, [PROYECTO, OWNER])).rows[0].t;

  const huellaModerna = async () => (await db.query(
    "select md5(public.portal_read_snapshot($1)::text) as h", [moderno])).rows[0].h;
  const abre = async (token) => (await db.query(
    "select public.portal_read_snapshot($1) is not null as v", [token])).rows[0].v;

  let antes;

  await t.test("control negativo: hoy un enlace heredado SÍ abre el portal", async () => {
    assert.equal(await abre(HEREDADO), true,
      "si no abriera, comprobar despues que devuelve null no mediria nada");
    antes = await huellaModerna();
    assert.ok(antes, "el enlace moderno devuelve un snapshot");
  });

  await t.test("con enlaces heredados vivos, (b) se niega a aplicarse", async () => {
    await assert.rejects(() => db.query(inlined(PASO_B)),
      (error) => /there are still 8 legacy links; apply 20260928120000 first/.test(error.message),
      "retirar la compatibilidad con enlaces vivos dejaria fuera a quien los tuviera");
  });

  await t.test("tras (a) el snapshot moderno sigue igual", async () => {
    await db.query(inlined(PASO_A));
    assert.equal((await db.query(
      "select count(*)::int as n from public.projects where access_token is not null")).rows[0].n, 0);
    assert.equal(await huellaModerna(), antes, "el paso (a) no toca el portal moderno");
  });

  await t.test("(b) deja el snapshot moderno idéntico byte a byte", async () => {
    await db.query(inlined(PASO_B));
    assert.equal(await huellaModerna(), antes,
      "para un enlace moderno la respuesta no puede variar ni un byte");
  });

  await t.test("un access_token ya no abre el portal, ni siquiera reponiéndolo", async () => {
    // Se repone a mano justo lo que (a) vació: si el camino heredado siguiera
    // ahí, esto volveria a abrir. Es la prueba de que (b) lo retiro de verdad.
    await db.query("update public.projects set access_token = $1 where id = $2",
      [HEREDADO, "90000000-0000-4000-8000-000000000002"]);
    assert.equal(await abre(HEREDADO), false, "el camino heredado ya no existe");
    assert.equal((await db.query(
      "select public.portal_respond_to_change($1,$2,true) as r", [HEREDADO, CHANGE])).rows[0].r, null,
      "tampoco se puede responder a un cambio con un enlace heredado");
  });

  await t.test("el enlace moderno sigue pudiendo responder", async () => {
    const r = (await db.query(
      "select public.portal_respond_to_change($1,$2,true) as r", [moderno, CHANGE])).rows[0].r;
    assert.equal(r?.status, "approved", "lo que debe seguir funcionando, funciona");
  });

  await t.test("ninguna función del esquema nombra ya access_token", async () => {
    // Es la precondicion del paso (c): la columna no se puede retirar mientras
    // alguna funcion la mencione.
    assert.equal((await db.query(`select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) like '%access_token%'`)).rows[0].n, 0);
  });

  await t.test("privilegios y seguridad intactos tras el replace", async () => {
    const filas = (await db.query(`select p.proname,
        coalesce(array_to_string(p.proacl,' | '),'(por defecto)') as acl,
        p.prosecdef, array_to_string(p.proconfig,',') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public'
        and p.proname in ('portal_read_snapshot','portal_respond_to_change')
      order by p.proname`)).rows;
    assert.equal(filas.length, 2);
    for (const f of filas) {
      assert.match(f.acl, /anon=X/, `${f.proname} conserva execute para anon`);
      assert.match(f.acl, /authenticated=X/, `${f.proname} conserva execute para authenticated`);
      assert.equal(f.prosecdef, true, `${f.proname} sigue siendo security definer`);
      assert.equal(f.cfg, 'search_path=""', `${f.proname} conserva el search_path vacío`);
    }
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const { detectarControlTransaccion } = await import("./lib/sql-toplevel.mjs");
    assert.deepEqual(detectarControlTransaccion(sql(PASO_B)), [],
      "sin begin/commit propios: quien la aplica la envuelve");
    assert.equal(/\bcreate\s+index\s+concurrently\b/i.test(sql(PASO_B)), false);
  });

  await t.test("control negativo del guard: sin la rama heredada no se pisa un cambio ajeno", async () => {
    // Si alguien redefine las funciones por otro camino, (b) tiene que negarse
    // en vez de sobrescribir en silencio.
    await db.query("begin");
    try {
      // El subtest anterior repuso un access_token a proposito. Se limpia aqui
      // para que salte el guard que se quiere probar y no el de enlaces vivos,
      // que va antes —y que va antes por buenas razones—.
      await db.query("update public.projects set access_token = null where access_token is not null");
      await db.query(`create or replace function public.portal_read_snapshot(p_token text)
        returns jsonb language sql security definer set search_path = '' as $fn$ select null::jsonb $fn$`);
      await assert.rejects(() => db.query(inlined(PASO_B)),
        (error) => /portal_read_snapshot was modified outside this series/.test(error.message));
    } finally {
      await db.query("rollback");
    }
  });
});
