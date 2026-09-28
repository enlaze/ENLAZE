// S3.3 paso (a) — los ocho enlaces heredados se vacían.
//
// Es la primera migración de la serie que escribe datos, así que lo que hay
// que demostrar no es solo que hace su trabajo, sino que no hace nada más:
// ninguna fila borrada, ningún otro campo tocado, y el portal moderno intacto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const dbName = "enlaze_revision_rpcs_test";
const MIGRACION = "supabase/migrations/20260928120000_retire_legacy_portal_links.sql";
const OWNER = "11111111-1111-4111-8111-111111111111";
const CHANGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("S3.3 (a) vacía los ocho enlaces heredados sin tocar nada más",
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

  // Cadena completa hasta el estado de producción de hoy, S3.1 incluida.
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
  ]) {
    await db.query(inlined(`supabase/migrations/${m}`));
  }

  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  // Ocho proyectos con enlace, como producción. S3.1 ya quitó el default, así
  // que hay que dárselo explícitamente.
  await db.query(`insert into public.projects(id,user_id,name,access_token)
    select ('90000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, $1, 'Obra ' || g,
           ('a0000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid
      from generate_series(1,8) g`, [OWNER]);
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,'90000000-0000-4000-8000-000000000001','Cambio','proposed')`, [CHANGE, OWNER]);

  const enlaces = async () => (await db.query(
    `select count(*) filter (where access_token is not null) as con,
            count(*) filter (where access_token is null) as sin,
            count(*) as total from public.projects`)).rows[0];
  // Huella de todo lo que NO es access_token: si cambia, la migración tocó de más.
  const huellaSinToken = async () => (await db.query(
    `select md5(string_agg(t, chr(10) order by t)) as h from (
       select (p.id::text||'|'||p.user_id::text||'|'||coalesce(p.name,'')||'|'||
               coalesce(p.status,'')||'|'||coalesce(p.deleted_at::text,'')||'|'||
               coalesce(p.created_at::text,'')) as t
         from public.projects p) s`)).rows[0].h;

  const antes = await enlaces();
  const huellaAntes = await huellaSinToken();

  await t.test("el estado de partida es el de producción", async () => {
    assert.equal(Number(antes.con), 8, "ocho enlaces heredados");
    assert.equal(Number(antes.sin), 0);
    const col = (await db.query(
      `select a.attnotnull as nn, pg_get_expr(d.adbin,d.adrelid) as def
         from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='public.projects'::regclass and a.attname='access_token'`)).rows[0];
    assert.equal(col.nn, false, "S3.1 ya dejó la columna nullable");
    assert.equal(col.def, null, "y sin default");
  });

  await t.test("el guard aborta si el estado no es el revisado", async () => {
    for (const [preparacion, esperado, caso] of [
      [`insert into public.projects(id,user_id,name,access_token)
          values('95000000-0000-4000-8000-000000000001',$1,'Novena',
                 'a5000000-0000-4000-8000-000000000001')`,
       /expected the 8 reviewed legacy links, found 9/, "nueve enlaces"],
      [`update public.projects set access_token = null
          where id = '90000000-0000-4000-8000-000000000001'`,
       /expected the 8 reviewed legacy links, found 7/, "siete enlaces"],
      // Se borra uno y se añade otro activo: así siguen siendo ocho vivos y
      // la comprobación que salta es la de los borrados, no la del recuento.
      [`update public.projects set deleted_at = now()
          where id = '90000000-0000-4000-8000-000000000001';
        insert into public.projects(id,user_id,name,access_token)
          values('96000000-0000-4000-8000-000000000001',
                 '11111111-1111-4111-8111-111111111111','Repuesta',
                 'a6000000-0000-4000-8000-000000000001')`,
       /found 1 legacy links on deleted projects/, "uno en proyecto borrado"],
      [`alter table public.projects alter column access_token set default gen_random_uuid()`,
       /still has default/, "el default de vuelta"],
    ]) {
      await db.query("begin");
      try {
        await db.query(preparacion, preparacion.includes("$1") ? [OWNER] : []);
        await assert.rejects(() => db.query(inlined(MIGRACION)),
          (error) => esperado.test(error.message), caso);
      } finally {
        await db.query("rollback");
      }
    }
  });

  await t.test("vacía los ocho y no borra ni una fila", async () => {
    await db.query(inlined(MIGRACION));
    const despues = await enlaces();
    assert.equal(Number(despues.con), 0, "ningún enlace heredado queda");
    assert.equal(Number(despues.sin), 8);
    assert.equal(Number(despues.total), Number(antes.total),
      "no desaparece ningún proyecto: se vacía la columna, no se borra la fila");
  });

  await t.test("no tocó ningún otro campo de ningún proyecto", async () => {
    assert.equal(await huellaSinToken(), huellaAntes,
      "id, dueño, nombre, estado, borrado y alta quedan byte a byte igual");
  });

  await t.test("un enlace heredado ya no abre el portal, y no revienta", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const respuesta = (await db.query(
        "select public.portal_read_snapshot($1) as d",
        ["a0000000-0000-4000-8000-000000000001"])).rows[0].d;
      assert.equal(respuesta, null,
        "el enlace retirado no casa con nadie: el portal responde 'no encontrado'");
      await db.query("reset role");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("el portal moderno sigue funcionando entero", async () => {
    // La compatibilidad heredada sigue en las RPC —retirarla es el paso (b)—,
    // pero lo que importa es que emitir y leer por la vía nueva no se rompió.
    await db.query("begin");
    let token;
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
      await db.query("set local role authenticated");
      token = (await db.query(
        `select public.portal_issue_token($1::uuid,'["read","approve_changes"]'::jsonb) ->> 'token' as t`,
        ["90000000-0000-4000-8000-000000000001"])).rows[0].t;
      await db.query("reset role");
      await db.query("commit");
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
    assert.ok(token, "se emite un enlace moderno");
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const snapshot = (await db.query(
        "select public.portal_read_snapshot($1) as d", [token])).rows[0].d;
      assert.ok(snapshot, "y abre el portal");
      assert.equal(snapshot.project.id, "90000000-0000-4000-8000-000000000001");
      await db.query("reset role");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("control negativo: sin el update, los enlaces seguirían ahí", async () => {
    // Si la migración solo llevara el guard y el comentario, las aserciones de
    // arriba tendrían que fallar. Se comprueba sobre una copia sin el update.
    const mutante = inlined(MIGRACION).replace(
      /update public\.projects\s*\n\s*set access_token = null\s*\n\s*where access_token is not null;/,
      "-- sin update");
    assert.notEqual(mutante, inlined(MIGRACION), "el mutante debe diferir");
    await db.query("begin");
    try {
      await db.query(
        "update public.projects set access_token = gen_random_uuid() where access_token is null");
      assert.equal(Number((await enlaces()).con), 8, "ocho enlaces repuestos para la prueba");
      await db.query(mutante);
      assert.equal(Number((await enlaces()).con), 8,
        "sin el update los ocho enlaces siguen ahí: la aserción de arriba mide algo real");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("la auditoría no confunde enlaces con proyectos", async () => {
    /* Ocho es el número de ENLACES. Hoy coincide con el de proyectos porque
       los ocho que hay tienen enlace, pero desde S3.1 un alta nueva nace sin
       él. Una auditoría que comparase el recuento de proyectos contra 8
       gritaría «se borró algo» por un alta normal, que es justo lo contrario
       de lo que pasó. */
    const bloque = (nombre) =>
      sql("docs/fase2/CHECKS.sql").split(`-- BEGIN ${nombre}\n`)[1].split(`-- END ${nombre}`)[0];
    const auditoria = bloque("CHECK_E4_L3_S33A_AUDIT");

    await db.query("create schema if not exists supabase_migrations");
    await db.query(`create table if not exists supabase_migrations.schema_migrations(version text primary key)`);
    await db.query(`insert into supabase_migrations.schema_migrations values('20260928120000')
                    on conflict do nothing`);

    const veredicto = async () => (await db.query(auditoria)).rows[0].veredicto;
    assert.match(await veredicto(), /^OK/, "recién aplicada, la auditoría pasa");

    // Un proyecto nuevo, que por S3.1 nace sin enlace.
    await db.query("begin");
    try {
      await db.query(`insert into public.projects(id,user_id,name)
        values('97000000-0000-4000-8000-000000000001',$1,'Obra posterior')`, [OWNER]);
      const evidencia = (await db.query(auditoria)).rows[0];
      assert.equal(Number(evidencia.proyectos), 9, "ahora hay nueve proyectos");
      assert.equal(Number(evidencia.con_enlace), 0, "y ningún enlace heredado");
      assert.match(evidencia.veredicto, /^OK/,
        "crear un proyecto no puede hacer que la auditoría diga que se borró algo");
    } finally {
      await db.query("rollback");
    }

    // Y lo que sí debe abortar sigue abortando.
    await db.query("begin");
    try {
      await db.query(`update public.projects set access_token = gen_random_uuid()
                       where id = '90000000-0000-4000-8000-000000000002'`);
      assert.match(await veredicto(), /ABORTAR: quedan 1 enlaces heredados/,
        "un enlace superviviente sí detiene la auditoría");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("la migración es transaccional y no controla la transacción", () => {
    const texto = sql(MIGRACION);
    assert.equal(/^\s*(begin|commit|rollback|end)\s*;/im.test(texto), false);
    assert.equal(/\bconcurrently\b/i.test(texto), false);
    assert.equal(/\bdelete\s+from\b/i.test(texto), false, "no borra filas");
    assert.equal(/\bdrop\s+(table|column)\b/i.test(texto), false, "no retira la columna");
  });
});
