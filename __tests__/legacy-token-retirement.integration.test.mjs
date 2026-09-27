// S3.1 — projects.access_token deja de emitirse en cada alta.
//
// Lo que hay que demostrar es a la vez positivo y negativo: un proyecto nuevo
// ya no nace con enlace portador, y las ocho filas que ya existen no se mueven
// ni un byte. Solo se ejecuta contra el PostgreSQL 17 desechable y marcado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const MIGRACION = "supabase/migrations/20260927100000_projects_access_token_no_default.sql";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CHANGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("S3.1 corta la emisión heredada sin tocar las filas existentes",
  { skip: !enabled, timeout: 120000 }, async (t) => {
  assert.equal(process.env.PORTAL_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);
  const socket = process.env.PORTAL_TEST_SOCKET;
  if (socket) assert.match(socket, /^\/private\/tmp\/enlaze-e2-bench\.[A-Za-z0-9]+$/);
  else assert.equal(process.env.TEST_DATABASE_URL,
    "postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/enlaze_revision_rpcs_test");

  const { Client } = await import("pg");
  const db = new Client(socket
    ? { host: socket, port: 55435, user: "postgres", database: "enlaze_revision_rpcs_test" }
    : { connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  t.after(async () => db.end().catch(() => {}));

  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    current_setting('server_version_num')::integer as version,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres',current_database()))::integer as other_dbs`)).rows[0];
  assert.equal(identity.db, "enlaze_revision_rpcs_test");
  assert.equal(identity.marker, "budget_revision_rpcs_2f2");
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.other_dbs, 0);

  // Cadena completa hasta el estado de producción de hoy.
  await db.query("drop schema if exists portal_token_internal cascade");
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));
  for (const migration of [
    "20260915140000_portal_tokens_owner_only.sql",
    "20260915150000_portal_token_read_access.sql",
    "20260923120000_portal_token_lifecycle.sql",
    "20260925090000_portal_token_listing.sql",
    "20260925100000_portal_token_ui_cutover.sql",
    "20260925110000_portal_tokens_least_privilege.sql",
  ]) {
    await db.query(inlined(`supabase/migrations/${migration}`));
  }

  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  // Ocho proyectos con enlace heredado, como producción.
  await db.query(`insert into public.projects(id,user_id,name)
    select ('90000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, $1, 'Obra ' || g
      from generate_series(1,8) g`, [OWNER]);
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,'90000000-0000-4000-8000-000000000001','Cambio','proposed')`, [CHANGE, OWNER]);

  // Huella de las ocho filas ANTES: contenido completo, no solo el recuento.
  const huella = async () => (await db.query(
    `select md5(string_agg(t, chr(10) order by t)) as h, count(*)::int as n from (
       select p::text as t from public.projects p) s`)).rows[0];
  const antes = await huella();
  // Huella del esquema completo, y la misma excluyendo la columna objetivo.
  // La segunda es la que debe quedar intacta: si algo más se mueve, cambia.
  const columnas = async (excluirAccessToken = false) => (await db.query(
    `select md5(string_agg(c, chr(10) order by c)) as h from (
       select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-') as c
         from information_schema.columns
        where table_schema='public'
          ${excluirAccessToken ? "and not (table_name='projects' and column_name='access_token')" : ""}) s`)).rows[0].h;
  const esquemaAntes = await columnas();
  const esquemaSinObjetivoAntes = await columnas(true);
  const estadoColumna = async () => (await db.query(
    `select a.attnotnull as notnull, coalesce(pg_get_expr(d.adbin,d.adrelid),'(none)') as por_defecto
       from pg_attribute a
       left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.projects'::regclass and a.attname='access_token'`)).rows[0];

  await t.test("el estado de partida es el de producción", async () => {
    const col = await estadoColumna();
    assert.equal(col.notnull, true, "access_token es NOT NULL antes de S3.1");
    assert.equal(col.por_defecto, "gen_random_uuid()", "y emite un enlace en cada alta");
    assert.equal(antes.n, 8, "ocho proyectos con enlace heredado");
    const sinEnlace = (await db.query(
      "select count(*)::int as n from public.projects where access_token is null")).rows[0].n;
    assert.equal(sinEnlace, 0);
  });

  await t.test("el guard rechaza aplicarla sobre un estado que no es el previsto", async () => {
    for (const [preparacion, esperado, caso] of [
      ["alter table public.projects alter column access_token drop default",
       /expected access_token default gen_random_uuid\(\), found \(none\)/, "sin el default"],
      ["alter table public.projects alter column access_token set default '00000000-0000-4000-8000-000000000000'::uuid",
       /expected access_token default/, "con otro default"],
      ["alter table public.projects alter column access_token drop not null",
       /expected access_token to be NOT NULL/, "ya nullable"],
    ]) {
      await db.query("begin");
      try {
        await db.query(preparacion);
        await assert.rejects(() => db.query(inlined(MIGRACION)),
          (error) => esperado.test(error.message), caso);
      } finally {
        await db.query("rollback");
      }
    }
  });

  await t.test("aplicarla no mueve ninguna de las ocho filas", async () => {
    await db.query(inlined(MIGRACION));
    const despues = await huella();
    assert.equal(despues.n, 8, "siguen siendo ocho");
    assert.equal(despues.h, antes.h,
      "las filas son idénticas byte a byte: ni un token emitido, rotado ni borrado");
    const conEnlace = (await db.query(
      "select count(*)::int as n from public.projects where access_token is not null")).rows[0].n;
    assert.equal(conEnlace, 8, "los ocho conservan su enlace heredado");
  });

  await t.test("un proyecto nuevo ya no recibe enlace heredado", async () => {
    await db.query(`insert into public.projects(id,user_id,name)
      values('91000000-0000-4000-8000-000000000001',$1,'Obra nueva')`, [OWNER]);
    const nuevo = (await db.query(
      "select access_token from public.projects where id='91000000-0000-4000-8000-000000000001'")).rows[0];
    assert.equal(nuevo.access_token, null,
      "sin DEFAULT, un alta normal deja access_token en NULL");
    // Y la columna admite el NULL explícito, que es lo que S3.3 necesitará.
    await db.query(`insert into public.projects(id,user_id,name,access_token)
      values('91000000-0000-4000-8000-000000000002',$1,'Obra sin enlace',null)`, [OWNER]);
    assert.equal((await db.query(
      "select count(*)::int as n from public.projects where access_token is null")).rows[0].n, 2);
    await db.query("delete from public.projects where id::text like '91000000%'");
  });

  await t.test("el resto del esquema no cambia", async () => {
    assert.notEqual(await columnas(), esquemaAntes,
      "access_token sí cambió: es justo el objetivo de la migración");
    assert.equal(await columnas(true), esquemaSinObjetivoAntes,
      "ninguna otra columna de ninguna otra tabla se movió");
    const col = await estadoColumna();
    assert.equal(col.notnull, false, "access_token admite NULL");
    assert.equal(col.por_defecto, "(none)", "y ya no tiene DEFAULT");
    // La unicidad del enlace heredado se conserva mientras la columna exista.
    assert.equal((await db.query(
      `select count(*)::int as n from pg_constraint
        where conrelid='public.projects'::regclass and contype='u'
          and pg_get_constraintdef(oid) ilike '%access_token%'`)).rows[0].n, 1,
      "el índice único de access_token sigue en pie");
  });

  await t.test("el portal sigue abriendo los ocho enlaces heredados", async () => {
    // S3.1 no retira la compatibilidad de las RPC: eso es S3.3.
    // El secreto se lee como postgres y se pasa como parámetro: bajo el rol
    // anon la subconsulta no vería ninguna fila y la prueba mediría otra cosa.
    const heredado = (await db.query(
      `select access_token::text as t from public.projects
        where access_token is not null order by id limit 1`)).rows[0].t;
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const snapshot = (await db.query(
        "select public.portal_read_snapshot($1) as d", [heredado])).rows[0].d;
      assert.ok(snapshot, "un enlace heredado sigue abriendo el portal");
      assert.equal(snapshot.project.id, "90000000-0000-4000-8000-000000000001");
      assert.equal(snapshot.capabilities.respond_changes, true);
      await db.query("reset role");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("control negativo: sin DROP DEFAULT la prueba del alta falla", async () => {
    // El mutante deja el DEFAULT puesto. Si la aserción del proyecto nuevo no
    // estuviera midiendo nada, esto pasaría igual.
    // inlined() toma la RUTA, no el contenido.
    const original = inlined(MIGRACION);
    const mutante = original.replace(
      "alter column access_token drop default,\n  alter column access_token drop not null;",
      "alter column access_token drop not null;");
    assert.notEqual(mutante, original, "el mutante debe diferir del original");
    await db.query("begin");
    try {
      // Se rehace el estado de partida para poder aplicar el mutante.
      await db.query("alter table public.projects alter column access_token set default gen_random_uuid()");
      await db.query("update public.projects set access_token = gen_random_uuid() where access_token is null");
      await db.query("alter table public.projects alter column access_token set not null");
      await db.query(mutante);
      await db.query(`insert into public.projects(id,user_id,name)
        values('92000000-0000-4000-8000-000000000001',$1,'Obra con mutante')`, [OWNER]);
      const conMutante = (await db.query(
        "select access_token from public.projects where id='92000000-0000-4000-8000-000000000001'")).rows[0];
      assert.notEqual(conMutante.access_token, null,
        "con el DEFAULT intacto el proyecto nuevo SÍ recibe enlace: la aserción de arriba mide algo real");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const texto = sql(MIGRACION);
    assert.equal(/^\s*(begin|commit|rollback|end)\s*;/im.test(texto), false,
      "sin begin/commit propios: quien la aplica la envuelve");
    assert.equal(/\bcreate\s+index\s+concurrently\b/i.test(texto), false,
      "nada que exija ejecutarse fuera de una transacción");
    // Y de hecho se puede envolver y deshacer entera.
    await db.query("begin");
    try {
      await db.query("alter table public.projects alter column access_token set default gen_random_uuid()");
      await db.query("alter table public.projects alter column access_token set not null");
      await db.query(inlined(MIGRACION));
      assert.equal((await estadoColumna()).notnull, false);
    } finally {
      await db.query("rollback");
    }
    assert.equal((await estadoColumna()).notnull, false, "el estado posterior a la migración persiste");
  });
});
