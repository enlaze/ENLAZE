import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const dbName = "enlaze_revision_rpcs_test";
const marker = "budget_revision_rpcs_2f2";

test("portal link validates without exposing other links", { skip: !enabled, timeout: 120000 }, async (t) => {
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
  t.after(async () => { try { await db.query("rollback"); } finally { await db.end(); } });
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
  assert.ok(socket ? identity.address === null : identity.address === "127.0.0.1");

  await db.query("begin");
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));

  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const project = "33333333-3333-4333-8333-333333333333";
  const foreignProject = "44444444-4444-4444-8444-444444444444";
  const ownToken = "55555555-5555-4555-8555-555555555555";
  const foreignToken = "66666666-6666-4666-8666-666666666666";
  const legacy = "77777777-7777-4777-8777-777777777777";
  const ownChange = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const foreignChange = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
  await db.query(`insert into public.projects(id,user_id,access_token,name)
    values($1,$2,$3,'Owner project'),($4,$5,$6,'Other project')`,
    [project, owner, legacy, foreignProject, other, "88888888-8888-4888-8888-888888888888"]);
  await db.query(`insert into public.portal_tokens(project_id,token,created_by)
    values($1,$2,$3),($4,$5,$6)`,
    [project, ownToken, owner, foreignProject, foreignToken, other]);
  await db.query("insert into public.budgets(user_id,project_id,title) values($1,$2,'Owner budget'),($3,$4,'Other budget')",
    [owner, project, other, foreignProject]);
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,$3,'Owner change','proposed'),($4,$5,$6,'Other change','proposed')`,
    [ownChange, owner, project, foreignChange, other, foreignProject]);

  const asRole = async (role, uid, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ""]);
    await db.query("set local role " + role);
    try { return await db.query(query, params); }
    finally { await db.query("reset role"); }
  };
  const countLinks = async (role, uid) =>
    Number((await asRole(role, uid, "select count(*)::integer as n from public.portal_tokens")).rows[0].n);
  const snapshot = async (token, role = "anon") =>
    (await asRole(role, null, "select public.portal_read_snapshot($1) as data", [token])).rows[0].data;

  await t.test("baseline policy really enumerates active links", async () => {
    assert.equal(await countLinks("anon", null), 2);
  });
  const migration = sql("supabase/migrations/20260915150000_portal_token_read_access.sql");
  assert.match(migration, /\nbegin;\n/i);
  assert.match(migration, /\ncommit;\s*$/i);
  await db.query(migration.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n"));
  await t.test("anonymous and another owner cannot enumerate links", async () => {
    assert.equal(await countLinks("anon", null), 0);
    assert.equal(await countLinks("authenticated", other), 1);
    assert.equal(await countLinks("authenticated", owner), 1);
    const directBudgetUpdate = await asRole("anon", null,
      "update public.budgets set title='tampered' where project_id=$1", [project]);
    assert.equal(directBudgetUpdate.rowCount, 0);
    assert.equal((await asRole("anon", null,
      "select has_function_privilege('anon','public.portal_read_snapshot(text)','EXECUTE') as allowed")).rows[0].allowed, true);
  });
  await t.test("a presented token reads only its project and never echoes a secret", async () => {
    const data = await snapshot(ownToken);
    assert.equal(data.project.id, project);
    assert.equal(data.budgets.length, 1);
    assert.equal(data.budgets[0].title, "Owner budget");
    assert.equal(data.invoices.length, 0);
    assert.equal(data.payments.length, 0);
    assert.equal(data.changes.length, 1);
    assert.equal(data.changes[0].title, "Owner change");
    assert.equal(data.milestones.length, 0);
    assert.doesNotMatch(JSON.stringify(data), new RegExp(ownToken));
    assert.doesNotMatch(JSON.stringify(data), /Other project|Other budget/);
    assert.equal((await snapshot(foreignToken)).project.id, foreignProject);
    assert.equal((await snapshot(legacy)).project.id, project);
  });
  await t.test("only a valid project link can answer its proposed change", async () => {
    const respond = (link, change, approve) => asRole("anon", null,
      "select public.portal_respond_to_change($1,$2,$3) as data", [link, change, approve]);
    assert.equal((await respond(ownToken, foreignChange, true)).rows[0].data, null);
    assert.equal((await respond("not-a-uuid", ownChange, true)).rows[0].data, null);
    const direct = await asRole("anon", null,
      "update public.project_changes set status='approved' where id=$1", [ownChange]);
    assert.equal(direct.rowCount, 0);
    assert.equal((await respond(ownToken, ownChange, true)).rows[0].data, null);
    await db.query("update public.portal_tokens set permissions='[\"read\",\"approve_changes\"]' where token=$1", [ownToken]);
    assert.equal((await respond(ownToken, ownChange, true)).rows[0].data.status, "approved");
    assert.equal((await respond(ownToken, ownChange, false)).rows[0].data, null);
    const state=(await db.query("select status,client_approved,approved_date from public.project_changes where id=$1", [ownChange])).rows[0];
    assert.equal(state.status, "approved");
    assert.equal(state.client_approved, true);
    assert.ok(state.approved_date);
    assert.equal((await db.query("select status from public.project_changes where id=$1", [foreignChange])).rows[0].status, "proposed");
  });
  await t.test("unknown, malformed, expired and revoked links fail closed", async () => {
    assert.equal(await snapshot("not-a-uuid"), null);
    assert.equal(await snapshot("99999999-9999-4999-8999-999999999999"), null);
    await db.query("update public.portal_tokens set is_active=false where token=$1", [ownToken]);
    assert.equal(await snapshot(ownToken), null);
    await db.query("update public.portal_tokens set is_active=true,expires_at=now()-interval '1 second' where token=$1", [ownToken]);
    assert.equal(await snapshot(ownToken), null);
    await db.query("update public.portal_tokens set expires_at=null,revoked_at=now() where token=$1", [ownToken]);
    assert.equal(await snapshot(ownToken), null);
    await db.query("update public.portal_tokens set token=$1 where project_id=$2", [legacy, project]);
    assert.equal(await snapshot(legacy), null, "a revoked modern link must not fall back to legacy");
  });
});
