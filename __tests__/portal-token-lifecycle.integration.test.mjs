// E4 lote 1 — ciclo de vida de portal_tokens contra PostgreSQL 17 desechable.
//
// No se envuelve todo en una transacción: la prueba de carrera necesita dos
// sesiones que compitan de verdad por el bloqueo de fila. El bootstrap recrea
// los esquemas public y auth, así que cada ejecución parte de cero.
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
const LEGACY = "77777777-7777-4777-8777-777777777777";
const CHANGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("portal token lifecycle issues, rotates and revokes only for the owner",
  { skip: !enabled, timeout: 120000 }, async (t) => {
  assert.equal(process.env.PORTAL_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);
  const socket = process.env.PORTAL_TEST_SOCKET;
  if (socket) assert.match(socket, /^\/private\/tmp\/enlaze-e2-bench\.[A-Za-z0-9]+$/);
  else assert.equal(process.env.TEST_DATABASE_URL,
    "postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/enlaze_revision_rpcs_test");
  const { Client } = await import("pg");
  const connection = () => new Client(socket
    ? { host: socket, port: 55435, user: "postgres", database: dbName }
    : { connectionString: process.env.TEST_DATABASE_URL });

  const db = connection();
  await db.connect();
  const rival = connection();
  await rival.connect();
  t.after(async () => { await rival.end().catch(() => {}); await db.end().catch(() => {}); });

  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    current_setting('server_version_num')::integer as version,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    host(inet_server_addr()) as address,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres',current_database()))::integer as other_dbs`)).rows[0];
  assert.equal(identity.db, dbName);
  assert.equal(identity.marker, marker);
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.superuser, true);
  assert.equal(identity.other_dbs, 0);
  if (socket) assert.equal(identity.address, null);
  else assert.notEqual(identity.address, null);

  // La cadena real: esquema, el endurecimiento ya desplegado y el lote nuevo.
  // El bootstrap recrea public y auth, pero no el esquema privado de este lote.
  await db.query("drop schema if exists portal_token_internal cascade");
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));
  await db.query(inlined("supabase/migrations/20260915140000_portal_tokens_owner_only.sql"));
  await db.query(inlined("supabase/migrations/20260915150000_portal_token_read_access.sql"));
  await db.query(inlined("supabase/migrations/20260923120000_portal_token_lifecycle.sql"));

  await db.query("insert into auth.users(id) values($1),($2)", [OWNER, OTHER]);
  await db.query(`insert into public.projects(id,user_id,access_token,name,deleted_at)
    values($1,$2,$3,'Obra propia',null),($4,$5,null,'Obra ajena',null),($6,$7,null,'Obra borrada',now())`,
    [PROJECT, OWNER, LEGACY, FOREIGN_PROJECT, OTHER, DELETED_PROJECT, OWNER]);
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,$3,'Cambio','proposed')`, [CHANGE, OWNER, PROJECT]);

  // Cada llamada en su propia transacción: el rol y el claim son locales a ella.
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
  const rpc = async (client, role, uid, call, params = []) =>
    (await as(client, role, uid, `select ${call} as data`, params)).rows[0].data;
  const row = async (id) =>
    (await db.query("select * from public.portal_tokens where id=$1", [id])).rows[0];
  // Vigente es la definición del producto: activo, sin revocar y sin caducar.
  const liveFor = async (project) => Number((await db.query(
    `select count(*) from public.portal_tokens
     where project_id=$1 and is_active and revoked_at is null and expires_at > now()`,
    [project])).rows[0].count);
  const lifetime = async (id) => (await db.query(
    `select expires_at - created_at as span, expires_at > now() as future
     from public.portal_tokens where id=$1`, [id])).rows[0];
  const issue = (client = db, project = PROJECT) =>
    rpc(client, "authenticated", OWNER, "public.portal_issue_token($1)", [project]);
  const clear = () => db.query("delete from public.portal_tokens where project_id=$1", [PROJECT]);

  await t.test("el propietario emite un enlace y el servidor fija lo que no puede elegir", async () => {
    const issued = await rpc(db, "authenticated", OWNER,
      "public.portal_issue_token($1,$2::jsonb,null,$3)",
      [PROJECT, JSON.stringify(["read", "approve_changes"]), "  Enlace del cliente  "]);
    assert.equal(issued.project_id, PROJECT);
    assert.deepEqual(issued.permissions, ["read", "approve_changes"]);
    assert.equal(issued.is_active, true);
    assert.equal(issued.revoked_at, null);
    assert.equal(issued.label, "Enlace del cliente", "la etiqueta se normaliza");
    assert.match(issued.token, /^[0-9a-f-]{36}$/, "el secreto se devuelve al emitir");
    const stored = await row(issued.id);
    assert.equal(stored.created_by, OWNER, "created_by lo fija auth.uid(), no el llamante");
    assert.equal(Number(stored.access_count), 0);
    assert.equal(stored.last_accessed_at, null);
    // Dos emisiones nunca comparten secreto.
    const second = await rpc(db, "authenticated", OWNER, "public.portal_issue_token($1)", [PROJECT]);
    assert.notEqual(second.token, issued.token);
    assert.deepEqual(second.permissions, ["read"], "el permiso por defecto es solo lectura");
    await db.query("delete from public.portal_tokens where id=any($1)", [[issued.id, second.id]]);
  });

  await t.test("un proyecto ajeno, inexistente o borrado responden lo mismo", async () => {
    for (const [target, caso] of [
      [FOREIGN_PROJECT, "ajeno"],
      ["99999999-9999-4999-8999-999999999999", "inexistente"],
      [DELETED_PROJECT, "borrado"],
    ]) {
      await assert.rejects(
        () => rpc(db, "authenticated", OWNER, "public.portal_issue_token($1)", [target]),
        (error) => error.code === "42501" && /Portal link is not available/.test(error.message),
        `proyecto ${caso}: mismo rechazo, sin revelar si existe`,
      );
    }
    assert.equal(await liveFor(FOREIGN_PROJECT), 0);
  });

  await t.test("cada forma inválida de permisos se rechaza", async () => {
    const casos = [
      ['"read"', /must be a JSON array/, "una cadena suelta"],
      ['{"read":true}', /must be a JSON array/, "un objeto"],
      ['[]', /must always include read/, "vacío"],
      ['["approve_changes"]', /must always include read/, "sin read"],
      ['["read","read"]', /must not repeat/, "duplicado"],
      ['["read",1]', /only strings/, "elemento no textual"],
      ['["read",null]', /only strings/, "nulo"],
      ['["read","approve_budget"]', /Unknown portal permission/, "nombre antiguo singular"],
      ['["read","approve_change"]', /Unknown portal permission/, "nombre antiguo singular"],
      ['["read","admin"]', /Unknown portal permission/, "inventado"],
    ];
    for (const [permissions, expected, caso] of casos) {
      await assert.rejects(
        () => rpc(db, "authenticated", OWNER, "public.portal_issue_token($1,$2::jsonb)", [PROJECT, permissions]),
        (error) => error.code === "22023" && expected.test(error.message),
        `permisos ${caso}`,
      );
    }
    assert.equal(await liveFor(PROJECT), 0, "ningún rechazo deja fila");
  });

  await t.test("omitir la caducidad da 90 días, nunca un enlace perpetuo", async () => {
    // Tres formas de no decir nada: por defecto, NULL explícito y NULL con tipo.
    for (const call of ["public.portal_issue_token($1)",
      "public.portal_issue_token($1,'[\"read\"]'::jsonb, null)",
      "public.portal_issue_token($1,'[\"read\"]'::jsonb, null::timestamptz)"]) {
      const issued = await rpc(db, "authenticated", OWNER, call, [PROJECT]);
      assert.ok(issued.expires_at, "la respuesta trae siempre una fecha");
      const { span, future } = await lifetime(issued.id);
      assert.equal(span.days, 90, `${call}: el plazo por defecto es de 90 días`);
      assert.equal(future, true);
    }
    await clear();
  });

  await t.test("la caducidad tiene suelo y techo: ni pasada ni más de 365 días", async () => {
    const rechazo = async (expr, expected, caso) => assert.rejects(
      () => rpc(db, "authenticated", OWNER,
        `public.portal_issue_token($1,'["read"]'::jsonb, ${expr})`, [PROJECT]),
      (error) => error.code === "22023" && expected.test(error.message), caso);
    await rechazo("timestamptz '2020-01-01T00:00:00Z'", /must be in the future/, "fecha pasada");
    await rechazo("now()", /must be in the future/, "exactamente ahora");
    await rechazo("now() - interval '1 second'", /must be in the future/, "un segundo tarde");
    await rechazo("now() + interval '366 days'", /at most/, "un día por encima del tope");
    await rechazo("now() + interval '10 years'", /at most/, "muy por encima del tope");

    // Los dos extremos admisibles sí entran.
    for (const [expr, dias] of [["now() + interval '1 day'", 1], ["now() + interval '365 days'", 365]]) {
      const ok = await rpc(db, "authenticated", OWNER,
        `public.portal_issue_token($1,'["read"]'::jsonb, ${expr})`, [PROJECT]);
      assert.equal((await lifetime(ok.id)).span.days, dias, `${expr} es aceptable`);
    }
    assert.equal(await liveFor(PROJECT), 2, "solo entraron los dos válidos");
    await clear();
  });

  await t.test("como mucho cinco enlaces vigentes por proyecto", async () => {
    const cinco = [];
    for (let n = 0; n < 5; n += 1) cinco.push(await issue());
    assert.equal(await liveFor(PROJECT), 5, "el quinto entra sin problema");

    await assert.rejects(() => issue(),
      (error) => error.code === "PT409" && /maximum of 5 live portal links/.test(error.message),
      "el sexto se rechaza con un error estable");
    assert.equal(await liveFor(PROJECT), 5, "el rechazo no deja fila de más");

    // El tope es por proyecto, no por usuario: otro proyecto propio sigue libre.
    const otro = "66666666-6666-4666-8666-666666666666";
    await db.query(`insert into public.projects(id,user_id,name) values($1,$2,'Segunda obra')`,
      [otro, OWNER]);
    const ajeno = await issue(db, otro);
    assert.equal(await liveFor(otro), 1, "el tope no se comparte entre proyectos");
    await db.query("delete from public.portal_tokens where id=$1", [ajeno.id]);

    // Revocar libera plaza…
    await rpc(db, "authenticated", OWNER, "public.portal_revoke_token($1)", [cinco[0].id]);
    assert.equal(await liveFor(PROJECT), 4);
    const sexto = await issue();
    assert.equal(await liveFor(PROJECT), 5, "la plaza liberada se puede reutilizar");

    // …y caducar también, sin ningún proceso de limpieza. La fila se envejece a
    // mano respetando el CHECK, que compara contra created_at y no contra now().
    await db.query(`update public.portal_tokens
      set created_at = now() - interval '100 days', expires_at = now() - interval '1 day'
      where id = $1`, [sexto.id]);
    assert.equal(await liveFor(PROJECT), 4, "un enlace caducado deja de ocupar plaza");
    const septimo = await issue();
    assert.equal(await liveFor(PROJECT), 5);
    assert.ok(septimo.id, "y la plaza que liberó la caducidad es utilizable");
    await clear();
  });

  await t.test("con una sola plaza libre, dos emisiones simultáneas: gana exactamente una", async () => {
    for (let n = 0; n < 4; n += 1) await issue();
    assert.equal(await liveFor(PROJECT), 4, "queda una plaza");

    // Sesión A emite y deja la transacción abierta, reteniendo el proyecto.
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
    await db.query("set local role authenticated");
    await db.query("select public.portal_issue_token($1)", [PROJECT]);
    // Sesión B intenta ocupar la misma plaza: debe esperar, no contar en paralelo.
    await rival.query("begin");
    await rival.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
    await rival.query("set local role authenticated");
    const contender = rival.query("select public.portal_issue_token($1)", [PROJECT]);
    let settled = false;
    contender.then(() => { settled = true; }, () => { settled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(settled, false,
        "un COUNT sin bloqueo dejaría avanzar a las dos; aquí la segunda espera");
    } finally {
      // Pase lo que pase con la aserción, hay que soltar el bloqueo: si no, un
      // fallo aquí cuelga todas las pruebas posteriores en vez de delatarse.
      await db.query("reset role").catch(() => {});
      await db.query("commit").catch(() => {});
      await contender.catch(() => {});
      await rival.query("rollback").catch(() => {});
    }
    await assert.rejects(() => contender,
      (error) => error.code === "PT409" && /maximum of 5 live portal links/.test(error.message),
      "la perdedora se rechaza en vez de dejar seis vigentes");
    assert.equal(await liveFor(PROJECT), 5, "exactamente una ganó la plaza");
    await clear();
  });

  await t.test("rotar emite el sustituto y revoca el anterior en la misma transacción", async () => {
    const original = await rpc(db, "authenticated", OWNER,
      "public.portal_issue_token($1,$2::jsonb,null,$3)",
      [PROJECT, JSON.stringify(["read", "approve_changes"]), "Cliente"]);
    const rotated = await rpc(db, "authenticated", OWNER, "public.portal_rotate_token($1)", [original.id]);
    assert.notEqual(rotated.issued.token, original.token, "el secreto cambia");
    assert.deepEqual(rotated.issued.permissions, ["read", "approve_changes"], "hereda los permisos");
    assert.equal(rotated.issued.label, "Cliente", "hereda la etiqueta");
    assert.equal(rotated.issued.is_active, true);
    assert.equal(rotated.revoked.id, original.id);
    assert.equal(rotated.revoked.is_active, false);
    assert.ok(rotated.revoked.revoked_at, "el anterior queda revocado");
    assert.equal(rotated.revoked.token, undefined, "la respuesta del revocado no repite el secreto");
    assert.equal(await liveFor(PROJECT), 1, "queda exactamente un enlace vigente");
    await clear();
  });

  await t.test("rotar renueva el plazo entero, no hereda el tiempo restante", async () => {
    const corto = await rpc(db, "authenticated", OWNER,
      "public.portal_issue_token($1,'[\"read\"]'::jsonb, now() + interval '10 days')", [PROJECT]);
    assert.equal((await lifetime(corto.id)).span.days, 10);
    const rotado = await rpc(db, "authenticated", OWNER, "public.portal_rotate_token($1)", [corto.id]);
    assert.equal((await lifetime(rotado.issued.id)).span.days, 90,
      "sin fecha explícita, la rotación da 90 días nuevos desde la rotación");
    assert.equal(await liveFor(PROJECT), 1, "y sigue habiendo un único enlace vigente");

    // Una fecha explícita en la rotación se respeta, y también tiene techo.
    const conFecha = await rpc(db, "authenticated", OWNER,
      "public.portal_rotate_token($1, now() + interval '30 days')", [rotado.issued.id]);
    assert.equal((await lifetime(conFecha.issued.id)).span.days, 30);
    await assert.rejects(
      () => rpc(db, "authenticated", OWNER,
        "public.portal_rotate_token($1, now() + interval '366 days')", [conFecha.issued.id]),
      (error) => error.code === "22023" && /at most/.test(error.message),
      "la rotación respeta el mismo tope de 365 días");
    await assert.rejects(
      () => rpc(db, "authenticated", OWNER,
        "public.portal_rotate_token($1, now() - interval '1 day')", [conFecha.issued.id]),
      (error) => error.code === "22023" && /must be in the future/.test(error.message));
    assert.equal(await liveFor(PROJECT), 1, "los rechazos no revocaron ni emitieron nada");
    await clear();
  });

  await t.test("rotar al tope de plazas no consume una plaza de más", async () => {
    const cinco = [];
    for (let n = 0; n < 5; n += 1) cinco.push(await issue());
    assert.equal(await liveFor(PROJECT), 5);
    const rotado = await rpc(db, "authenticated", OWNER,
      "public.portal_rotate_token($1)", [cinco[2].id]);
    assert.equal(await liveFor(PROJECT), 5,
      "el saldo neto de la rotación es cero: revoca uno y emite uno");
    assert.equal((await row(cinco[2].id)).is_active, false);
    assert.equal((await row(rotado.issued.id)).is_active, true);
    // Y estando al tope, emitir sigue estando cerrado.
    await assert.rejects(() => issue(), (error) => error.code === "PT409");

    // Rotar un enlace ya caducado sí ocuparía la sexta plaza, así que se frena.
    await db.query(`update public.portal_tokens
      set created_at = now() - interval '100 days', expires_at = now() - interval '1 day'
      where id = $1`, [cinco[0].id]);
    assert.equal(await liveFor(PROJECT), 4, "el caducado ya no cuenta");
    await issue();
    assert.equal(await liveFor(PROJECT), 5, "otro ocupa la plaza que dejó");
    await assert.rejects(
      () => rpc(db, "authenticated", OWNER, "public.portal_rotate_token($1)", [cinco[0].id]),
      (error) => error.code === "PT409" && /maximum of 5 live portal links/.test(error.message),
      "resucitar un caducado por rotación tampoco puede saltarse el tope");
    assert.equal((await row(cinco[0].id)).revoked_at, null,
      "y el rechazo deshace la revocación: la rotación es todo o nada");
    await clear();
  });

  await t.test("dos rotaciones simultáneas no dejan dos sustitutos vigentes", async () => {
    const original = await rpc(db, "authenticated", OWNER, "public.portal_issue_token($1)", [PROJECT]);
    // Sesión A abre la rotación y la deja sin confirmar.
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
    await db.query("set local role authenticated");
    await db.query("select public.portal_rotate_token($1)", [original.id]);
    // Sesión B intenta lo mismo: se queda esperando el bloqueo de fila.
    await rival.query("begin");
    await rival.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
    await rival.query("set local role authenticated");
    const contender = rival.query("select public.portal_rotate_token($1)", [original.id]);
    let settled = false;
    contender.then(() => { settled = true; }, () => { settled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(settled, false, "la segunda rotación debe quedar bloqueada, no adelantarse");
    } finally {
      await db.query("reset role").catch(() => {});
      await db.query("commit").catch(() => {});
      await contender.catch(() => {});
      await rival.query("rollback").catch(() => {});
    }
    await assert.rejects(() => contender,
      (error) => error.code === "PT409" && /no longer active/.test(error.message),
      "la segunda rotación se rechaza en vez de emitir otro sustituto");
    assert.equal(await liveFor(PROJECT), 1, "un solo enlace vigente tras la carrera");
    await db.query("delete from public.portal_tokens where project_id=$1", [PROJECT]);
  });

  await t.test("revocar es idempotente y no repite el secreto", async () => {
    const issued = await rpc(db, "authenticated", OWNER, "public.portal_issue_token($1)", [PROJECT]);
    const revoked = await rpc(db, "authenticated", OWNER, "public.portal_revoke_token($1)", [issued.id]);
    assert.equal(revoked.is_active, false);
    assert.ok(revoked.revoked_at);
    assert.equal(revoked.token, undefined, "revocar no devuelve el secreto");
    const again = await rpc(db, "authenticated", OWNER, "public.portal_revoke_token($1)", [issued.id]);
    assert.equal(again.revoked_at, revoked.revoked_at, "repetir no mueve la fecha ni falla");
    assert.equal(await liveFor(PROJECT), 0);
    await db.query("delete from public.portal_tokens where project_id=$1", [PROJECT]);
  });

  await t.test("no se puede tocar ni descubrir el enlace de otro", async () => {
    const mine = await rpc(db, "authenticated", OWNER, "public.portal_issue_token($1)", [PROJECT]);
    for (const call of ["public.portal_rotate_token($1)", "public.portal_revoke_token($1)"]) {
      await assert.rejects(
        () => rpc(db, "authenticated", OTHER, call, [mine.id]),
        (error) => error.code === "42501" && /Portal link is not available/.test(error.message),
        `${call} desde otro usuario`,
      );
      // Un id inexistente responde igual que uno ajeno.
      await assert.rejects(
        () => rpc(db, "authenticated", OTHER, call, ["00000000-0000-4000-8000-000000000000"]),
        (error) => error.code === "42501",
      );
    }
    const untouched = await row(mine.id);
    assert.equal(untouched.is_active, true);
    assert.equal(untouched.revoked_at, null);
    assert.equal(Number((await as(db, "authenticated", OTHER,
      "select count(*)::int as n from public.portal_tokens")).rows[0].n), 0,
      "otro usuario no ve ni que existe");
    await db.query("delete from public.portal_tokens where project_id=$1", [PROJECT]);
  });

  await t.test("el DML directo sigue prohibido y anon no gestiona nada", async () => {
    for (const [role, privilege] of [["authenticated", "INSERT"], ["authenticated", "UPDATE"],
      ["authenticated", "DELETE"], ["anon", "INSERT"], ["anon", "UPDATE"], ["anon", "DELETE"]]) {
      assert.equal((await db.query(
        "select has_table_privilege($1,'public.portal_tokens',$2) as ok", [role, privilege])).rows[0].ok,
        false, `${role} no debe conservar ${privilege} directo`);
    }
    for (const fn of ["public.portal_issue_token(uuid,jsonb,timestamptz,text)",
      "public.portal_rotate_token(uuid,timestamptz)", "public.portal_revoke_token(uuid)"]) {
      assert.equal((await db.query(
        "select has_function_privilege('authenticated',$1,'EXECUTE') as ok", [fn])).rows[0].ok, true,
        `authenticated debe poder ejecutar ${fn}`);
      for (const role of ["anon", "public", "service_role"]) {
        assert.equal((await db.query(
          "select has_function_privilege($1,$2,'EXECUTE') as ok", [role, fn])).rows[0].ok, false,
          `${role} no debe ejecutar ${fn}`);
      }
    }
    // Y ejecutarlas como anon falla de verdad, no solo en el catálogo.
    await assert.rejects(
      () => rpc(db, "anon", null, "public.portal_issue_token($1)", [PROJECT]),
      (error) => error.code === "42501");
  });

  await t.test("los enlaces heredados y las RPC del portal siguen igual", async () => {
    const legacyBefore = (await db.query(
      "select access_token, deleted_at from public.projects where id=$1", [PROJECT])).rows[0];
    const issued = await rpc(db, "authenticated", OWNER,
      "public.portal_issue_token($1,$2::jsonb)", [PROJECT, JSON.stringify(["read", "approve_changes"])]);
    const legacyAfter = (await db.query(
      "select access_token, deleted_at from public.projects where id=$1", [PROJECT])).rows[0];
    assert.deepEqual(legacyAfter, legacyBefore, "emitir no toca projects.access_token");

    // El lector sigue aceptando el enlace heredado…
    const legacySnapshot = (await as(db, "anon", null,
      "select public.portal_read_snapshot($1) as d", [LEGACY])).rows[0].d;
    assert.equal(legacySnapshot.project.id, PROJECT);
    assert.equal(legacySnapshot.capabilities.respond_changes, true);
    // …y el token nuevo funciona con sus capacidades declaradas.
    const modernSnapshot = (await as(db, "anon", null,
      "select public.portal_read_snapshot($1) as d", [issued.token])).rows[0].d;
    assert.equal(modernSnapshot.project.id, PROJECT);
    assert.equal(modernSnapshot.capabilities.respond_changes, true);
    assert.equal(modernSnapshot.capabilities.respond_budgets, false,
      "este lote no concede approve_budgets");
    // Y la respuesta a cambios sigue operativa con el token nuevo.
    const answered = (await as(db, "anon", null,
      "select public.portal_respond_to_change($1,$2,true) as d", [issued.token, CHANGE])).rows[0].d;
    assert.equal(answered.status, "approved");
    await db.query("update public.project_changes set status='proposed' where id=$1", [CHANGE]);
    await db.query("delete from public.portal_tokens where project_id=$1", [PROJECT]);
  });

  await t.test("controles negativos: las aserciones agarran", async () => {
    // Sin el CHECK, un permiso inventado entraría en la tabla. Se comprueba en
    // una transacción que se deshace, para no dejar el banco alterado.
    await db.query("begin");
    await db.query("alter table public.portal_tokens drop constraint portal_tokens_permissions_check");
    await db.query(`insert into public.portal_tokens(project_id,permissions,created_by)
      values($1,'["admin"]'::jsonb,$2)`, [PROJECT, OWNER]);
    assert.equal(Number((await db.query(
      `select count(*) from public.portal_tokens where permissions @> '["admin"]'::jsonb`)).rows[0].count), 1,
      "sin el CHECK la fila inválida entra: el CHECK es lo que la frena");
    await db.query("rollback");

    // Con el CHECK puesto, la misma inserción falla.
    await assert.rejects(
      () => db.query(`insert into public.portal_tokens(project_id,permissions,created_by)
        values($1,'["admin"]'::jsonb,$2)`, [PROJECT, OWNER]),
      (error) => error.code === "23514" && /portal_tokens_permissions_check/.test(error.message));

    // Sin el revoke, anon podría ejecutar la emisión.
    const anonCan = async () => (await db.query(
      `select has_function_privilege('anon','public.portal_issue_token(uuid,jsonb,timestamptz,text)','EXECUTE') as ok`
    )).rows[0].ok;
    await db.query("begin");
    await db.query("grant execute on function public.portal_issue_token(uuid,jsonb,timestamptz,text) to anon");
    assert.equal(await anonCan(), true,
      "concedido a mano, anon sí puede: la aserción anterior mide algo real");
    await db.query("rollback");
    assert.equal(await anonCan(), false);
  });

  await t.test("la tabla exige caducidad por sí misma, no solo las RPC", async () => {
    const insert = (columnas, valores) => db.query(
      `insert into public.portal_tokens(project_id,created_by,${columnas})
       values($1,$2,${valores}) returning id`, [PROJECT, OWNER]);

    // NOT NULL: un NULL explícito no se cuela por debajo del DEFAULT.
    await assert.rejects(() => insert("expires_at", "null"),
      (error) => error.code === "23502" && /expires_at/.test(error.message),
      "expires_at no admite nulo");
    await assert.rejects(() => insert("created_at", "null"),
      (error) => error.code === "23502" && /created_at/.test(error.message),
      "created_at no admite nulo");

    // CHECK: ni caducidad anterior al alta ni plazo por encima de 365 días.
    for (const [valores, caso] of [
      ["now(), now()", "caduca en el mismo instante del alta"],
      ["now(), now() - interval '1 day'", "caduca antes del alta"],
      ["now(), now() + interval '366 days'", "un día por encima del tope"],
      ["now(), now() + interval '10 years'", "muy por encima del tope"],
    ]) {
      await assert.rejects(() => insert("created_at,expires_at", valores),
        (error) => error.code === "23514" && /portal_tokens_expiry_window_check/.test(error.message),
        caso);
    }

    // El DEFAULT de la columna, no solo el de la RPC, son 90 días.
    const porDefecto = (await insert("permissions", `'["read"]'::jsonb`)).rows[0].id;
    assert.equal((await lifetime(porDefecto)).span.days, 90,
      "el DEFAULT de expires_at vale 90 días aunque nadie pase por la RPC");

    // Control negativo: sin el CHECK, la fila fuera de ventana sí entraría.
    await db.query("begin");
    await db.query("alter table public.portal_tokens drop constraint portal_tokens_expiry_window_check");
    const colada = (await insert("created_at,expires_at", "now(), now() + interval '10 years'")).rows[0].id;
    assert.ok(colada, "sin el CHECK la fila entra: el CHECK es lo que la frena");
    await db.query("rollback");

    // Y sin el NOT NULL, el nulo explícito también.
    await db.query("begin");
    await db.query("alter table public.portal_tokens alter column expires_at drop not null");
    const perpetua = (await insert("expires_at", "null")).rows[0].id;
    assert.ok(perpetua, "sin el NOT NULL cabría un enlace perpetuo");
    await db.query("rollback");

    await clear();
  });
});
