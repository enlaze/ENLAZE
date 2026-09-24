// Endurecimiento E4 — listado seguro de enlaces del portal.
//
// La propiedad que hay que demostrar es negativa: el resultado NO contiene el
// secreto, por ningún camino. Se comprueba sobre el JSON serializado entero y
// no solo sobre la clave `token`, porque el secreto podría colarse en otra
// clave, dentro de una etiqueta o en un mensaje de error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const dbName = "enlaze_revision_rpcs_test";
const marker = "budget_revision_rpcs_2f2";
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const FOREIGN_PROJECT = "44444444-4444-4444-8444-444444444444";
const DELETED_PROJECT = "55555555-5555-4555-8555-555555555555";
const EMPTY_PROJECT = "66666666-6666-4666-8666-666666666666";
const LEGACY = "77777777-7777-4777-8777-777777777777";

test("portal_list_tokens returns metadata for the owner and never the secret",
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
  t.after(async () => { await db.end().catch(() => {}); });

  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    current_setting('server_version_num')::integer as version,
    host(inet_server_addr()) as address,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres',current_database()))::integer as other_dbs`)).rows[0];
  assert.equal(identity.db, dbName);
  assert.equal(identity.marker, marker);
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.other_dbs, 0);
  if (socket) assert.equal(identity.address, null);

  await db.query("drop schema if exists portal_token_internal cascade");
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));
  await db.query(inlined("supabase/migrations/20260915140000_portal_tokens_owner_only.sql"));
  await db.query(inlined("supabase/migrations/20260915150000_portal_token_read_access.sql"));
  await db.query(inlined("supabase/migrations/20260923120000_portal_token_lifecycle.sql"));
  await db.query(inlined("supabase/migrations/20260925090000_portal_token_listing.sql"));

  await db.query("insert into auth.users(id) values($1),($2)", [OWNER, OTHER]);
  await db.query(`insert into public.projects(id,user_id,access_token,name,deleted_at)
    values($1,$2,$3,'Obra propia',null),($4,$5,null,'Obra ajena',null),
          ($6,$7,null,'Obra borrada',now()),($8,$9,null,'Obra sin enlaces',null)`,
    [PROJECT, OWNER, LEGACY, FOREIGN_PROJECT, OTHER,
     DELETED_PROJECT, OWNER, EMPTY_PROJECT, OWNER]);

  const as = async (client, role, uid, query, params = []) => {
    await client.query("begin");
    try {
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ""]);
      await client.query("set local role " + role);
      const result = await client.query(query, params);
      await client.query("reset role");
      await client.query("commit");
      return result;
    } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  };
  const rpc = async (role, uid, call, params = []) =>
    (await as(db, role, uid, `select ${call} as data`, params)).rows[0].data;
  const page = (project = PROJECT, uid = OWNER, args = "") =>
    rpc("authenticated", uid, `public.portal_list_tokens($1${args})`, [project]);
  // La mayoría de las pruebas solo miran las filas; el sobre se comprueba aparte.
  const list = async (project = PROJECT, uid = OWNER) => (await page(project, uid)).items;
  const issue = (project = PROJECT, extra = "") =>
    rpc("authenticated", OWNER, `public.portal_issue_token($1${extra})`, [project]);
  const bloque = (nombre) =>
    sql("docs/fase2/CHECKS.sql").split(`-- BEGIN ${nombre}\n`)[1].split(`-- END ${nombre}`)[0];

  await t.test("el precheck actual acepta E4-L1 ya aplicada y valida los datos", async () => {
    // Producción tiene ocho enlaces heredados. El fixture base representa uno;
    // los otros siete viven solo dentro de esta transacción y se deshacen.
    await db.query("begin");
    try {
      await db.query(`insert into public.projects(id,user_id,access_token,name)
        select ('90000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
               $1,
               ('a0000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
               'Legacy ' || g
          from generate_series(1,7) g`, [OWNER]);

      const historico = (await db.query(bloque("CHECK_E4_L1_PRECHECK"))).rows[0];
      assert.match(historico.veredicto, /ya existen objetos de E4/,
        "el gate histórico sigue detectando correctamente que E4-L1 ya existe");

      const actual = (await db.query(bloque("CHECK_E4_HARDENING_DATA_PRECHECK"))).rows[0];
      assert.equal(actual.veredicto, "OK",
        "el gate del listado no confunde E4-L1 completa con una aplicación parcial");
      assert.equal(Number(actual.tokens_modernos), 0);
      assert.equal(Number(actual.enlaces_legacy), 8);
      await db.query(bloque("CHECK_E4_HARDENING_DATA_PRECHECK_GATE"));
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("un proyecto sin enlaces devuelve una lista vacía, no nulo", async () => {
    const empty = await page(EMPTY_PROJECT);
    assert.deepEqual(empty.items, [], "coalesce a [] para que la interfaz no tenga que distinguir");
    assert.equal(empty.next_cursor, null, "sin nada detrás, no hay cursor");
  });

  await t.test("el listado trae los metadatos y jamás el secreto", async () => {
    const issued = await issue(PROJECT, ",'[\"read\",\"approve_changes\"]'::jsonb,null,'Cliente'");
    const listed = await list();
    assert.equal(listed.length, 1);
    const [only] = listed;

    // Lo que sí debe traer, para poder pintar la fila.
    assert.deepEqual(Object.keys(only).sort(), [
      "created_at", "expires_at", "id", "is_active", "is_live",
      "label", "permissions", "project_id", "revoked_at",
    ], "la forma del metadato es cerrada y conocida");
    assert.equal(only.id, issued.id);
    assert.equal(only.project_id, PROJECT);
    assert.deepEqual(only.permissions, ["read", "approve_changes"]);
    assert.equal(only.label, "Cliente");
    assert.equal(only.is_active, true);
    assert.equal(only.revoked_at, null);
    assert.equal(only.is_live, true);
    assert.ok(only.expires_at && only.created_at);

    // Lo que no debe traer, comprobado de tres maneras distintas.
    assert.equal(only.token, undefined, "no hay clave token");
    assert.equal(
      JSON.stringify(listed).includes(issued.token), false,
      "el secreto no aparece en ninguna clave ni valor del JSON serializado");
    assert.equal(
      JSON.stringify(listed).includes(LEGACY), false,
      "tampoco se cuela el enlace heredado del proyecto");
  });

  await t.test("ningún estado del enlace hace aparecer el secreto", async () => {
    // Un enlace de cada clase: vigente, revocado y caducado.
    const vivo = await issue();
    const revocado = await issue();
    await rpc("authenticated", OWNER, "public.portal_revoke_token($1)", [revocado.id]);
    const caducado = await issue();
    await db.query(`update public.portal_tokens
      set created_at = now() - interval '100 days', expires_at = now() - interval '1 day'
      where id = $1`, [caducado.id]);

    const listed = await list();
    const byId = Object.fromEntries(listed.map((t) => [t.id, t]));
    assert.equal(byId[vivo.id].is_live, true);
    assert.equal(byId[revocado.id].is_live, false, "revocado no está vigente");
    assert.equal(byId[revocado.id].revoked_at !== null, true);
    assert.equal(byId[caducado.id].is_live, false, "caducado tampoco, aunque siga is_active");
    assert.equal(byId[caducado.id].is_active, true, "y se ve que sigue activo pero vencido");

    const serialized = JSON.stringify(listed);
    for (const [estado, t] of [["vigente", vivo], ["revocado", revocado], ["caducado", caducado]]) {
      assert.equal(serialized.includes(t.token), false,
        `el secreto del enlace ${estado} no aparece en el listado`);
    }
  });

  await t.test("el orden es del más reciente al más antiguo y es estable", async () => {
    const listed = await list();
    const fechas = listed.map((t) => t.created_at);
    assert.deepEqual(fechas, [...fechas].sort().reverse(), "descendente por created_at");
    // Con created_at empatado —lo normal, todos en el mismo instante— el
    // desempate por id evita que dos llamadas devuelvan órdenes distintos.
    assert.deepEqual(await list(), listed, "dos llamadas seguidas dan el mismo orden");
  });

  await t.test("un proyecto ajeno, inexistente o borrado responden lo mismo", async () => {
    await issue(EMPTY_PROJECT);
    for (const [target, caso] of [
      [FOREIGN_PROJECT, "ajeno"],
      ["99999999-9999-4999-8999-999999999999", "inexistente"],
      [DELETED_PROJECT, "borrado"],
    ]) {
      await assert.rejects(() => list(target),
        (error) => error.code === "42501" && /Portal link is not available/.test(error.message),
        `proyecto ${caso}: mismo rechazo, sin revelar si existe`);
    }
    // Y el dueño de otro proyecto no ve los enlaces de este.
    await assert.rejects(() => list(PROJECT, OTHER),
      (error) => error.code === "42501" && /Portal link is not available/.test(error.message));
  });

  await t.test("anon no puede listar y el privilegio está donde debe", async () => {
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.portal_list_tokens(uuid,integer,timestamptz,uuid)','EXECUTE') as ok"
    )).rows[0].ok, true);
    for (const role of ["anon", "public", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.portal_list_tokens(uuid,integer,timestamptz,uuid)','EXECUTE') as ok",
        [role])).rows[0].ok, false, `${role} no debe listar`);
    }
    assert.equal((await db.query(
      `select has_function_privilege('authenticated',
         'portal_token_internal.visible_project(uuid,uuid)','EXECUTE') as ok`)).rows[0].ok, false,
      "el auxiliar privado sigue fuera del alcance de los clientes");
    await assert.rejects(
      () => rpc("anon", null, "public.portal_list_tokens($1)", [PROJECT]),
      (error) => error.code === "42501");
  });

  await t.test("listar no bloquea: no serializa las emisiones del proyecto", async () => {
    // visible_project no toma FOR UPDATE. Si lo tomara, esta transacción
    // abierta dejaría colgada cualquier emisión concurrente.
    const rival = new Client(socket
      ? { host: socket, port: 55435, user: "postgres", database: dbName }
      : { connectionString: process.env.TEST_DATABASE_URL });
    await rival.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
      await db.query("set local role authenticated");
      await db.query("select public.portal_list_tokens($1)", [EMPTY_PROJECT]);
      // Con el listado sin confirmar, otra sesión emite sin esperar.
      const emitted = await as(rival, "authenticated", OWNER,
        "select public.portal_issue_token($1) as data", [EMPTY_PROJECT]);
      assert.ok(emitted.rows[0].data.id, "la emisión no se quedó esperando al listado");
    } finally {
      await db.query("reset role").catch(() => {});
      await db.query("commit").catch(() => {});
      await rival.end().catch(() => {});
    }
  });

  await t.test("control negativo: si status devolviera el secreto, se notaría", async () => {
    const issued = await issue();
    // Se reescribe el auxiliar para que sí incluya el token, y se comprueba que
    // la aserción de arriba lo habría cazado. Todo dentro de una transacción
    // que se deshace, para no dejar el banco alterado.
    await db.query("begin");
    let leaked;
    try {
      await db.query(`create or replace function portal_token_internal.status(t public.portal_tokens)
        returns jsonb language sql immutable set search_path = ''
        as $fn$ select jsonb_build_object('id', t.id, 'token', t.token) $fn$`);
      // La llamada tiene que ir con el claim y el rol del dueño, igual que en
      // producción: como superusuario sin claim, auth.uid() es null y la RPC
      // rechazaría por propiedad antes de llegar a filtrar nada.
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
      await db.query("set local role authenticated");
      leaked = (await db.query("select public.portal_list_tokens($1) as d", [PROJECT])).rows[0].d.items;
      await db.query("reset role");
    } finally {
      await db.query("rollback").catch(() => {});
    }
    assert.equal(JSON.stringify(leaked).includes(issued.token), true,
      "con un status filtrón el secreto sale: la aserción mide algo real");

    const clean = await list();
    assert.equal(JSON.stringify(clean).includes(issued.token), false);
  });

  await t.test("la página tiene tope y el cursor recorre el historial sin saltos", async () => {
    // Un historial que no cabe en una página: 12 enlaces en un proyecto propio.
    // El tope de cinco solo cuenta vigentes, así que se revocan según se emiten.
    const PAGINADO = "88888888-8888-4888-8888-888888888888";
    await db.query(`insert into public.projects(id,user_id,name) values($1,$2,'Obra con historial')`,
      [PAGINADO, OWNER]);
    const emitidos = [];
    for (let n = 0; n < 12; n += 1) {
      const t = await issue(PAGINADO);
      await rpc("authenticated", OWNER, "public.portal_revoke_token($1)", [t.id]);
      emitidos.push(t);
    }

    // Recorrido completo a páginas de 5.
    const vistos = [];
    let cursor = null;
    let vueltas = 0;
    do {
      const args = cursor
        ? `,5,'${cursor.created_at}'::timestamptz,'${cursor.id}'::uuid`
        : ",5";
      const pagina = await page(PAGINADO, OWNER, args);
      assert.ok(pagina.items.length <= 5, "ninguna página pasa del límite pedido");
      vistos.push(...pagina.items.map((t) => t.id));
      cursor = pagina.next_cursor;
      vueltas += 1;
      assert.ok(vueltas <= 10, "el recorrido tiene que terminar");
    } while (cursor);

    assert.equal(vistos.length, 12, "se ven todos, ni uno de más");
    assert.equal(new Set(vistos).size, 12, "y ninguno repetido entre páginas");
    assert.deepEqual([...vistos].sort(), emitidos.map((t) => t.id).sort());

    // Orden estable pese a que created_at empata: desempate por id.
    const primera = await page(PAGINADO, OWNER, ",5");
    assert.deepEqual((await page(PAGINADO, OWNER, ",5")).items.map((t) => t.id),
      primera.items.map((t) => t.id), "dos llamadas iguales dan la misma página");

    // El cursor apunta a la última fila de la página, no a la primera.
    assert.equal(primera.next_cursor.id, primera.items.at(-1).id);

    // Página que no se llena: no hay cursor, porque no queda nada detrás.
    const holgada = await page(PAGINADO, OWNER, ",100");
    assert.equal(holgada.items.length, 12);
    assert.equal(holgada.next_cursor, null, "página incompleta no emite cursor");

    // Y el secreto sigue sin aparecer en ninguna página.
    for (const t of emitidos) {
      assert.equal(JSON.stringify(holgada).includes(t.token), false,
        "el secreto tampoco sale al paginar");
    }
    await db.query("delete from public.portal_tokens where project_id=$1", [PAGINADO]);
  });

  await t.test("un total múltiplo exacto del límite no inventa una página de más", async () => {
    // Con p_limit filas justas la página sale llena, pero no queda nada detrás.
    // Mirar solo "¿vino llena?" emitía cursor y el bucle daba una vuelta vacía.
    const EXACTO = "99999999-9999-4999-8999-999999999999";
    await db.query(`insert into public.projects(id,user_id,name) values($1,$2,'Obra exacta')`,
      [EXACTO, OWNER]);
    const creados = [];
    const nuevo = async () => {
      const t = await issue(EXACTO);
      await rpc("authenticated", OWNER, "public.portal_revoke_token($1)", [t.id]);
      creados.push(t);
      return t;
    };
    for (let n = 0; n < 3; n += 1) await nuevo();

    const justa = await page(EXACTO, OWNER, ",3");
    assert.equal(justa.items.length, 3, "la página sale llena");
    assert.equal(justa.next_cursor, null,
      "pero no hay nada detrás: total == límite no puede emitir cursor");

    // Una fila más y sí hay página siguiente.
    await nuevo();
    const primera = await page(EXACTO, OWNER, ",3");
    assert.equal(primera.items.length, 3, "nunca se devuelve la fila sonda");
    assert.ok(primera.next_cursor, "con límite + 1 sí hay cursor");

    const segunda = await page(EXACTO, OWNER,
      `,3,'${primera.next_cursor.created_at}'::timestamptz,'${primera.next_cursor.id}'::uuid`);
    assert.equal(segunda.items.length, 1, "la segunda página trae el resto");
    assert.equal(segunda.next_cursor, null, "y ahí se acaba");
    const vistos = [...primera.items, ...segunda.items].map((t) => t.id);
    assert.equal(new Set(vistos).size, 4, "las dos páginas no se solapan");
    assert.deepEqual(vistos.sort(), creados.map((t) => t.id).sort(), "y cubren todo");

    // El múltiplo exacto también con el límite por defecto de 20 y con 1.
    const unaSola = await page(EXACTO, OWNER, ",4");
    assert.equal(unaSola.items.length, 4);
    assert.equal(unaSola.next_cursor, null, "límite 4 sobre 4 filas: sin cursor");
    const deUnaEnUna = await page(EXACTO, OWNER, ",1");
    assert.equal(deUnaEnUna.items.length, 1);
    assert.ok(deUnaEnUna.next_cursor, "límite 1 sobre 4 filas: sí hay cursor");

    for (const t of creados) {
      for (const respuesta of [justa, primera, segunda, unaSola, deUnaEnUna]) {
        assert.equal(JSON.stringify(respuesta).includes(t.token), false,
          "el secreto no aparece en ninguna de las páginas");
      }
    }
    await db.query("delete from public.portal_tokens where project_id=$1", [EXACTO]);
  });

  await t.test("los argumentos de paginación se validan", async () => {
    const rechazo = (args, expected, caso) => assert.rejects(
      () => page(PROJECT, OWNER, args),
      (error) => error.code === "22023" && expected.test(error.message), caso);
    await rechazo(",0", /between 1 and 100/, "límite cero");
    await rechazo(",-1", /between 1 and 100/, "límite negativo");
    await rechazo(",101", /between 1 and 100/, "límite por encima del máximo");
    await rechazo(",null::integer", /between 1 and 100/, "límite nulo explícito");
    // Medio cursor no es un cursor.
    await rechazo(",5,now()", /must be given together/, "solo la fecha");
    await rechazo(",5,null::timestamptz,'00000000-0000-4000-8000-000000000000'::uuid",
      /must be given together/, "solo el id");
    // Los dos extremos admisibles sí entran.
    for (const limite of [1, 100]) {
      const ok = await page(PROJECT, OWNER, `,${limite}`);
      assert.ok(Array.isArray(ok.items), `límite ${limite} es válido`);
    }
    // El valor por defecto son 20 y no hace falta pasarlo.
    assert.ok(Array.isArray((await page()).items));
  });

  await t.test("el gate de auditoría del despliegue cuadra y deja de cuadrar si se altera algo", async () => {
    // El SQL se lee de CHECKS.sql, así que la documentación y la prueba no
    // pueden separarse: si alguien cambia el gate y se equivoca, esto falla.
    const gate = bloque("CHECK_E4_DEPLOY_AUDIT");
    const detalle = bloque("CHECK_E4_DEPLOY_AUDIT_DETALLE");

    // Libro de migraciones simulado: el banco no lo tiene.
    await db.query("create schema if not exists supabase_migrations");
    await db.query(`create table if not exists supabase_migrations.schema_migrations(version text primary key)`);
    await db.query(`insert into supabase_migrations.schema_migrations values('20260923120000'),('20260925090000')
                    on conflict do nothing`);

    const veredicto = async () => (await db.query(gate)).rows[0].veredicto;
    assert.equal(await veredicto(), "OK", "con todo en su sitio, el gate pasa");
    assert.equal((await db.query(detalle)).rows.length, 0, "y el detalle no señala nada");

    // ── Controles negativos ───────────────────────────────────────────────
    // Cada uno en su transacción, que se deshace: el banco queda como estaba.
    const rompiendo = async (sqlRoto, caso) => {
      await db.query("begin");
      try {
        await db.query(sqlRoto);
        const v = await veredicto();
        assert.notEqual(v, "OK", `el gate debe rechazar: ${caso}`);
        assert.match(v, /inventario de funciones no cuadra/, caso);
        assert.ok((await db.query(detalle)).rows.length > 0, `y el detalle lo señala: ${caso}`);
      } finally {
        await db.query("rollback");
      }
    };

    // 1 · Firma cambiada: mismo nombre, otros argumentos.
    await rompiendo(
      `drop function public.portal_revoke_token(uuid);
       create function public.portal_revoke_token(p_token_id uuid, p_extra text default null)
         returns jsonb language sql security definer set search_path = '' as $x$ select '{}'::jsonb $x$;`,
      "firma alterada");

    // 1b · Firma alterada pero con prosecdef y ACL IDÉNTICOS. Solo la
    //      comparación de identidades de argumentos puede cazar esto: si se
    //      quita esa condición del gate, este control deja de fallar.
    await rompiendo(
      `drop function public.portal_revoke_token(uuid);
       create function public.portal_revoke_token(p_token_id uuid, p_reason text default null)
         returns jsonb language sql security definer set search_path = '' as $x$ select '{}'::jsonb $x$;
       revoke all on function public.portal_revoke_token(uuid, text)
         from public, anon, authenticated, service_role;
       grant execute on function public.portal_revoke_token(uuid, text) to authenticated;`,
      "firma alterada con los mismos privilegios y el mismo prosecdef");

    // 2 · Overload inesperado: la buena sigue, pero hay una de más.
    await rompiendo(
      `create function public.portal_list_tokens(p_project_id uuid, p_todo boolean)
         returns jsonb language sql security definer set search_path = '' as $x$ select '{}'::jsonb $x$;`,
      "overload de más");

    // 3 · SECURITY DEFINER donde no toca.
    await rompiendo(
      `create or replace function public.portal_token_max_lifetime()
         returns interval language sql immutable security definer set search_path = ''
         as $x$ select interval '365 days' $x$;`,
      "prosecdef incorrecto");

    // 4 · Una RPC que deja de ser definer: se ejecutaría como el llamante.
    await rompiendo(
      `create or replace function public.portal_revoke_token(p_token_id uuid)
         returns jsonb language sql security invoker set search_path = '' as $x$ select '{}'::jsonb $x$;`,
      "definer retirado de una RPC");

    // 5 · EXECUTE concedido de más a anon.
    await rompiendo(
      "grant execute on function public.portal_issue_token(uuid,jsonb,timestamptz,text) to anon",
      "grant indebido a anon");

    // 6 · EXECUTE concedido a un auxiliar privado.
    await rompiendo(
      "grant execute on function portal_token_internal.lock_own_token(uuid,uuid) to authenticated",
      "auxiliar privado alcanzable");

    // 7 · EXECUTE retirado de quien sí debe tenerlo.
    await rompiendo(
      "revoke execute on function public.portal_list_tokens(uuid,integer,timestamptz,uuid) from authenticated",
      "authenticated sin permiso para listar");

    // 8 · Un ayudante puro que deja de ser ejecutable por PUBLIC: rompería el
    //     DEFAULT y el CHECK de la tabla para cualquier escritor legítimo.
    await rompiendo(
      "revoke execute on function public.portal_token_permissions_valid(jsonb) from public",
      "ayudante puro sin EXECUTE para PUBLIC");

    // 9 · Falta una función entera.
    await rompiendo(
      "drop function portal_token_internal.visible_project(uuid,uuid) cascade",
      "auxiliar ausente");

    // Y tras todos los rollbacks, el gate vuelve a decir OK.
    assert.equal(await veredicto(), "OK", "ningún control negativo dejó residuo");

    // El estado intermedio del push también se nombra.
    await db.query("begin");
    try {
      await db.query("delete from supabase_migrations.schema_migrations where version='20260925090000'");
      assert.match(await veredicto(), /^RECUPERAR: falta 20260925090000/,
        "si la primera quedó registrada y la segunda no, se dice cómo salir");
    } finally { await db.query("rollback"); }
  });

  await t.test("el SELECT directo sigue concedido: transición pendiente del lote 2", async () => {
    // Esto NO es lo deseable, es el estado de hoy, y queda registrado para que
    // nadie afirme "copia única" antes de tiempo. La retirada de este privilegio
    // va en el mismo despliegue que la interfaz del lote 2.
    assert.equal((await db.query(
      "select has_table_privilege('authenticated','public.portal_tokens','SELECT') as ok"
    )).rows[0].ok, true,
      "si esta aserción falla es que ya se retiró: actualiza la documentación y el lote 2");
    // Y el DML directo sigue prohibido, como dejó 20260915140000.
    for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
      assert.equal((await db.query(
        "select has_table_privilege('authenticated','public.portal_tokens',$1) as ok",
        [privilege])).rows[0].ok, false);
    }
  });
});
