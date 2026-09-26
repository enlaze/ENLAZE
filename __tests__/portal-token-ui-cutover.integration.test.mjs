// E4 lote 2 — el navegador pierde todo privilegio directo sobre portal_tokens,
// pero las cuatro RPC autenticadas siguen operativas. Solo se ejecuta contra
// el PostgreSQL 17 desechable y marcado del workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const MODERN_CHANGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEGACY_CHANGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("portal token UI cutover removes direct secret reads and preserves RPCs",
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
  await db.query("insert into public.projects(id,user_id,name) values($1,$2,'Obra')", [PROJECT, OWNER]);
  const legacyToken = (await db.query(
    "select access_token::text as token from public.projects where id=$1", [PROJECT])).rows[0].token;
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,$3,'Cambio moderno','proposed'),
      ($4,$2,$3,'Cambio heredado','proposed')`,
  [MODERN_CHANGE, OWNER, PROJECT, LEGACY_CHANGE]);

  const asOwner = async (expression, params = []) => {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
      await db.query("set local role authenticated");
      const result = await db.query(`select ${expression} as data`, params);
      await db.query("commit");
      return result.rows[0].data;
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
  };

  const asAnon = async (expression, params = []) => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const result = await db.query(`select ${expression} as data`, params);
      await db.query("commit");
      return result.rows[0].data;
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
  };

  const directPrivileges = [
    "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
  ];
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of directPrivileges) {
      assert.equal((await db.query(
        "select has_table_privilege($1,'public.portal_tokens',$2) as ok",
        [role, privilege])).rows[0].ok, false,
      `${role} no debe conservar ${privilege} directo`);
    }
  }
  for (const privilege of directPrivileges) {
    assert.equal((await db.query(
      "select has_table_privilege('service_role','public.portal_tokens',$1) as ok",
      [privilege])).rows[0].ok, true,
    `service_role debe conservar ${privilege}`);
  }

  assert.equal((await db.query(`select count(*)::integer as n
    from pg_attribute where attrelid='public.portal_tokens'::regclass
      and attnum > 0 and not attisdropped and attacl is not null`)).rows[0].n, 0,
  "no deben quedar ACL directas por columna");

  const issued = await asOwner(
    "public.portal_issue_token($1,'[\"read\",\"approve_changes\"]'::jsonb,null,'Cliente')",
    [PROJECT]);
  assert.match(issued.token, /^[0-9a-f-]{36}$/i, "emitir entrega el secreto una vez");

  for (const [kind, token] of [["moderno", issued.token], ["heredado", legacyToken]]) {
    const snapshot = await asAnon("public.portal_read_snapshot($1)", [token]);
    assert.equal(snapshot.project.id, PROJECT,
      `el portal ${kind} sigue leyendo mediante la RPC tras el revoke`);
    assert.equal(snapshot.capabilities.respond_changes, true);
  }
  for (const [kind, token, change] of [
    ["moderno", issued.token, MODERN_CHANGE],
    ["heredado", legacyToken, LEGACY_CHANGE],
  ]) {
    const response = await asAnon("public.portal_respond_to_change($1,$2,true)", [token, change]);
    assert.equal(response.status, "approved",
      `el portal ${kind} sigue respondiendo mediante la RPC tras el revoke`);
  }

  const listed = await asOwner("public.portal_list_tokens($1)", [PROJECT]);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].id, issued.id);
  assert.equal(JSON.stringify(listed).includes(issued.token), false,
    "el listado no puede recuperar el secreto");

  const rotated = await asOwner("public.portal_rotate_token($1)", [issued.id]);
  assert.notEqual(rotated.issued.token, issued.token);
  assert.equal(Object.hasOwn(rotated.revoked, "token"), false);
  const revoked = await asOwner("public.portal_revoke_token($1)", [rotated.issued.id]);
  assert.equal(revoked.is_active, false);
  assert.equal(Object.hasOwn(revoked, "token"), false);

  await assert.rejects(
    () => asOwner("(select token from public.portal_tokens where id=$1)", [rotated.issued.id]),
    /permission denied for table portal_tokens/,
    "ni siquiera el dueño puede releer el secreto con SELECT directo");

  await db.query("begin");
  try {
    await db.query("set local role anon");
    await assert.rejects(
      () => db.query("select count(*) from public.portal_tokens"),
      /permission denied for table portal_tokens/,
      "anon no debe depender de que RLS o una tabla vacía oculten el grant residual");
  } finally {
    await db.query("rollback");
  }

  for (const signature of [
    "portal_list_tokens(uuid,integer,timestamp with time zone,uuid)",
    "portal_issue_token(uuid,jsonb,timestamp with time zone,text)",
    "portal_rotate_token(uuid,timestamp with time zone)",
    "portal_revoke_token(uuid)",
  ]) {
    assert.equal((await db.query(
      "select has_function_privilege('authenticated',$1,'EXECUTE') as ok",
      [`public.${signature}`])).rows[0].ok, true, `${signature} sigue ejecutable`);
  }
});
