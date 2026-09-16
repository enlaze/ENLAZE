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
  // Docker's loopback-published port reaches PostgreSQL through its bridge,
  // so inet_server_addr() is the container IP, not necessarily 127.0.0.1.
  // The exact client URL, database name and cluster marker are checked above.
  if (socket) assert.equal(identity.address, null);
  else assert.notEqual(identity.address, null);

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
  const ownClient = "99999999-9999-4999-8999-999999999999";
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
  // A second client of the same owner, with no project of its own. Nothing of
  // this client may ever surface through the first client's link.
  const otherClient = "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b";
  await db.query(`insert into public.clients(id,user_id,name)
    values($1,$2,'Owner client'),($3,$4,'Another client of the same owner')`,
    [ownClient, owner, otherClient, owner]);
  await db.query(`insert into public.projects(id,user_id,access_token,name,client_id)
    values($1,$2,$3,'Owner project',$7),($4,$5,$6,'Other project',null)`,
    [project, owner, legacy, foreignProject, other, "88888888-8888-4888-8888-888888888888", ownClient]);
  await db.query(`insert into public.portal_tokens(project_id,token,created_by)
    values($1,$2,$3),($4,$5,$6)`,
    [project, ownToken, owner, foreignProject, foreignToken, other]);
  const sentBudget = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const draftBudget = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  // Production's shape: most budgets carry no project and reach the portal only
  // through the client fallback, which portal_respond_to_budget refuses.
  const clientOnlyBudget = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const oddBudget = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
  await db.query(`insert into public.budgets(id,user_id,project_id,client_id,title,status)
    values($1,$2,$3,null,'Owner budget','enviado'),($4,$5,$6,null,'Owner draft','borrador'),
      ($7,$8,null,$9,'Client-only budget','enviado'),
      ($10,$11,$12,null,'Unknown state budget','plantilla'),
      ($13,$14,null,$15,'Another client budget','enviado'),
      ($16,$17,$18,null,'Other budget','enviado')`,
    [sentBudget, owner, project, draftBudget, owner, project,
      clientOnlyBudget, owner, ownClient,
      oddBudget, owner, project,
      "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c", owner, otherClient,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", other, foreignProject]);
  // Only the project-linked budget has the finalized document the writer demands.
  await db.query(`insert into public.document_versions(entity_type,entity_id,version)
    values('budget',$1,1),('budget',$2,1)`, [sentBudget, clientOnlyBudget]);
  await db.query(`insert into public.project_changes(id,user_id,project_id,title,status)
    values($1,$2,$3,'Owner change','proposed'),($4,$5,$6,'Other change','proposed')`,
    [ownChange, owner, project, foreignChange, other, foreignProject]);

  const asRole = async (role, uid, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ""]);
    await db.query("set local role " + role);
    // Swallow the reset failure: once the body aborts the transaction this also
    // fails, and its error would replace the one that actually explains why.
    try { return await db.query(query, params); }
    finally { await db.query("reset role").catch(() => {}); }
  };
  const countLinks = async (role, uid) =>
    Number((await asRole(role, uid, "select count(*)::integer as n from public.portal_tokens")).rows[0].n);
  const snapshot = async (token, role = "anon") =>
    (await asRole(role, null, "select public.portal_read_snapshot($1) as data", [token])).rows[0].data;

  await t.test("baseline policy really enumerates active links", async () => {
    assert.equal(await countLinks("anon", null), 2);
  });
  const forged = "12121212-1212-4121-8121-121212121212";
  const forge = (role, uid, created_by, target) => asRole(role, uid,
    `insert into public.portal_tokens(project_id,token,permissions,created_by)
     values($1,$2,'["read","approve_budgets"]'::jsonb,$3)`, [target, forged, created_by]);
  // Everything here runs in one transaction, so an expected failure would poison
  // it. The savepoint also rewinds the SET LOCAL ROLE the attempt left behind.
  const refuses = async (fn, code, message) => {
    await db.query("savepoint attempt");
    await assert.rejects(fn, (e) => e.code === code,
      `${message} (esperado ${code})`);
    await db.query("rollback to savepoint attempt");
  };
  await t.test("baseline: the FOR ALL policies really do let a stranger forge a link", async () => {
    // Guard against the assertions below passing for the wrong reason: the role
    // must actually hold the privilege production grants it.
    assert.equal((await db.query(
      "select has_table_privilege('authenticated','public.portal_tokens','INSERT') as ok")).rows[0].ok, true);
    // created_by = auth.uid() satisfies the OR on its own, so the project may be
    // anyone's. This is the defect 20260915140000 closes.
    await forge("authenticated", other, other, project);
    assert.equal(Number((await db.query(
      "select count(*)::integer as n from public.portal_tokens where token=$1", [forged])).rows[0].n), 1);
    await db.query("delete from public.portal_tokens where token=$1", [forged]);
  });
  const isolation = sql("supabase/migrations/20260915140000_portal_tokens_owner_only.sql");
  assert.match(isolation, /\nbegin;\n/i);
  assert.match(isolation, /\ncommit;\s*$/i);
  await db.query(isolation.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n"));
  await t.test("a portal link cannot be issued, read or revoked across projects", async () => {
    const privilege = async (p) => (await db.query(
      "select has_table_privilege('authenticated','public.portal_tokens',$1) as ok", [p])).rows[0].ok;
    // Least privilege: nothing writes this table directly any more.
    assert.equal(await privilege("SELECT"), true);
    assert.equal(await privilege("INSERT"), false);
    assert.equal(await privilege("UPDATE"), false);
    assert.equal(await privilege("DELETE"), false);

    // The point of this block: prove the refusal survives the privilege. Hand the
    // role back exactly what production grants it, so what rejects the write is
    // the policy and the trigger, not a missing GRANT.
    await db.query("grant insert,update,delete on public.portal_tokens to authenticated");
    try {
      assert.equal(await privilege("INSERT"), true);
      // The policy must refuse on its own. With the trigger still armed this
      // whole block would pass even with the permissive created_by branch back
      // in place, because the trigger would be the one rejecting.
      const policies = (await db.query(`select polname,
        pg_get_expr(polqual, polrelid) as using_expr,
        pg_get_expr(polwithcheck, polrelid) as check_expr
        from pg_policy where polrelid='public.portal_tokens'::regclass`)).rows;
      assert.deepEqual(policies.map((p) => p.polname), ["portal_tokens_owner"]);
      assert.ok(policies[0].check_expr, "WITH CHECK must be explicit, not inherited");
      for (const expr of [policies[0].using_expr, policies[0].check_expr]) {
        assert.doesNotMatch(expr, /created_by/,
          "the permissive created_by branch must be gone from both expressions");
        assert.match(expr, /project_id/);
      }
      await db.query("alter table public.portal_tokens disable trigger portal_tokens_require_owner");
      try {
        await refuses(() => forge("authenticated", other, other, project),
          "42501", "the policy alone must refuse a link for another project");
      } finally {
        await db.query("alter table public.portal_tokens enable trigger portal_tokens_require_owner");
      }

      await refuses(() => forge("authenticated", other, other, project),
        "42501", "a stranger must not issue a link for another project");
      // Naming the victim as created_by does not help either: the WITH CHECK is
      // about who is writing, not about what the row claims.
      await refuses(() => forge("authenticated", other, owner, project),
        "42501", "claiming the owner as created_by must not help");
      // Reading, updating and revoking someone else's link are equally refused.
      // Enumeration closes here, not in 20260915150000: this migration has to
      // stand on its own.
      assert.equal(await countLinks("anon", null), 0);
      assert.equal(await countLinks("authenticated", other), 1);
      assert.equal(await countLinks("authenticated", owner), 1);
      assert.equal((await asRole("authenticated", other,
        "update public.portal_tokens set revoked_at=now() where token=$1", [ownToken])).rowCount, 0);
      assert.equal((await asRole("authenticated", other,
        "delete from public.portal_tokens where token=$1", [ownToken])).rowCount, 0);

      // A legitimate issuance by the project's own owner still works.
      const mine = "13131313-1313-4131-8131-131313131313";
      await asRole("authenticated", owner,
        `insert into public.portal_tokens(project_id,token,created_by) values($1,$2,$3)`,
        [project, mine, owner]);
      assert.equal(Number((await db.query(
        "select count(*)::integer as n from public.portal_tokens where token=$1", [mine])).rows[0].n), 1);
      await db.query("delete from public.portal_tokens where token=$1", [mine]);

      // RLS is bypassed inside a SECURITY DEFINER function, so the invariant has
      // to hold at the table too. Superuser here stands in for such a function.
      await refuses(() => db.query(
        `insert into public.portal_tokens(project_id,token,created_by) values($1,$2,$3)`,
        [project, forged, other]),
        "42501", "a definer-rights writer must not forge either");
      await refuses(() => db.query(
        `insert into public.portal_tokens(project_id,token,created_by) values($1,$2,null)`,
        [project, forged]),
        "23502", "created_by must be present");
      // Repointing an existing link at another project is the same forgery.
      await refuses(() => db.query(
        "update public.portal_tokens set project_id=$1 where token=$2", [foreignProject, ownToken]),
        "42501", "a link must not be repointed at another project");
    } finally {
      await db.query("revoke insert,update,delete on public.portal_tokens from authenticated");
    }
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
    // The draft and the unknown-state budget are withheld from the client.
    assert.deepEqual(data.budgets.map((b) => b.title).sort(),
      ["Client-only budget", "Owner budget"]);
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
  await t.test("a client never sees a draft or an unrecognised state", async () => {
    for (const link of [ownToken, legacy]) {
      const titles = (await snapshot(link)).budgets.map((b) => b.title);
      assert.ok(!titles.includes("Owner draft"), `draft leaked into ${link}`);
      assert.ok(!titles.includes("Unknown state budget"), `unknown state leaked into ${link}`);
    }
    // Withheld from the portal, not deleted: the owner still has both rows.
    assert.equal(Number((await db.query(
      "select count(*)::integer as n from public.budgets where id in ($1,$2)",
      [draftBudget, oddBudget])).rows[0].n), 2);
  });
  await t.test("a project-less budget shows only where its client is unambiguous", async () => {
    const titles = async (link) => (await snapshot(link)).budgets.map((b) => b.title);
    const viewed = async (id) => (await db.query(
      "select viewed_at from public.budgets where id=$1", [id])).rows[0].viewed_at;

    // The rule never reaches across clients: this one belongs to another client
    // of the same owner and has no project, so no link of this client may show it.
    assert.ok(!(await titles(ownToken)).includes("Another client budget"));
    assert.ok(!(await titles(legacy)).includes("Another client budget"));
    assert.equal(await viewed("1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c"), null);
    // Nor across owners: the other owner's project and budget stay invisible.
    assert.doesNotMatch(JSON.stringify(await snapshot(ownToken)), /Other project|Other budget/);

    // One project for this client, so the link can only mean that project.
    assert.ok((await titles(ownToken)).includes("Client-only budget"));

    await db.query("savepoint ambiguous");
    try {
      await db.query(`insert into public.projects(id,user_id,name,client_id)
        values($1,$2,'Second project, same client',$3)`,
        ["2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d", owner, ownClient]);
      const after = await titles(ownToken);
      assert.ok(!after.includes("Client-only budget"),
        "with two projects for the client there is nothing that says which one");
      // The point of the rule is attribution, not hiding: what belongs to this
      // project by project_id is untouched, so the portal is not emptied.
      assert.ok(after.includes("Owner budget"));
      assert.equal((await snapshot(ownToken)).changes.length, 1);
      // And a budget the client is no longer shown must not be stamped as seen.
      await db.query("update public.budgets set viewed_at=null where id=$1", [clientOnlyBudget]);
      await snapshot(ownToken);
      assert.equal(await viewed(clientOnlyBudget), null,
        "a withheld budget must not get a Visualizado stamp");
    } finally {
      await db.query("rollback to savepoint ambiguous");
    }
    // Rolled back: the unambiguous case is intact for the rest of the suite.
    assert.ok((await titles(ownToken)).includes("Client-only budget"));
  });
  await t.test("capabilities never offer an action the database would refuse", async () => {
    const caps = async (link) => (await snapshot(link)).capabilities;
    // Default permissions are ["read"], so a modern link answers nothing.
    assert.deepEqual(await caps(ownToken), { respond_budgets: false, respond_changes: false });
    // A legacy access_token predates the permission model, but budgets always
    // need a token row, so it can never answer one.
    assert.deepEqual(await caps(legacy), { respond_budgets: false, respond_changes: true });
    await db.query(`update public.portal_tokens
      set permissions='["read","approve_changes","approve_budgets"]' where token=$1`, [ownToken]);
    // The capability is granted but 20260915160000 has not run: still no button.
    assert.deepEqual(await caps(ownToken), { respond_budgets: false, respond_changes: true });
    await db.query(`create function public.portal_respond_to_budget(
      p_token text, p_budget_id uuid, p_decision text, p_accepted_by_name text)
      returns jsonb language sql as $stub$ select null::jsonb $stub$`);
    assert.deepEqual(await caps(ownToken), { respond_budgets: true, respond_changes: true });
    await db.query("drop function public.portal_respond_to_budget(text,uuid,text,text)");
    await db.query(`update public.portal_tokens set permissions='["read"]' where token=$1`, [ownToken]);
  });
  await t.test("can_respond repeats every condition the budget writer checks", async () => {
    const byTitle = async (link) => Object.fromEntries(
      (await snapshot(link)).budgets.map((b) => [b.title, b.can_respond]));
    // Without the capability nothing is answerable, however good the budget is.
    assert.deepEqual(await byTitle(ownToken), {
      "Owner budget": false, "Client-only budget": false });
    await db.query(`update public.portal_tokens set permissions='["read","approve_budgets"]'
      where token=$1`, [ownToken]);
    await db.query(`create function public.portal_respond_to_budget(
      p_token text, p_budget_id uuid, p_decision text, p_accepted_by_name text)
      returns jsonb language sql as $stub$ select null::jsonb $stub$`);
    // Only the sent, project-linked, finalized budget qualifies. The client-only
    // one is listed but unanswerable: the writer matches on project_id.
    assert.deepEqual(await byTitle(ownToken), {
      "Owner budget": true, "Client-only budget": false });
    // Drop the finalized document and the same budget stops qualifying.
    await db.query("delete from public.document_versions where entity_id=$1", [sentBudget]);
    assert.equal((await byTitle(ownToken))["Owner budget"], false);
    await db.query(`insert into public.document_versions(entity_type,entity_id,version)
      values('budget',$1,1)`, [sentBudget]);
    // A legacy link never answers budgets, even for a qualifying one.
    assert.equal((await byTitle(legacy))["Owner budget"], false);
    await db.query("drop function public.portal_respond_to_budget(text,uuid,text,text)");
    await db.query(`update public.portal_tokens set permissions='["read"]' where token=$1`, [ownToken]);
  });
  await t.test("access accounting survives the closed policies", async () => {
    const counters = async () => (await db.query(
      "select access_count, last_accessed_at from public.portal_tokens where token=$1", [ownToken])).rows[0];
    const viewed = async (id) => (await db.query(
      "select viewed_at from public.budgets where id=$1", [id])).rows[0].viewed_at;
    const before = await counters();
    await snapshot(ownToken);
    const after = await counters();
    assert.equal(after.access_count, before.access_count + 1);
    assert.ok(after.last_accessed_at);
    // "Visualizado" means the client opened a budget we had sent; never a draft.
    assert.ok(await viewed(sentBudget));
    assert.equal(await viewed(draftBudget), null);
    const stamped = await viewed(sentBudget);
    await snapshot(ownToken);
    assert.deepEqual(await viewed(sentBudget), stamped, "viewed_at records the first visit only");
    // A legacy link has no token row to account on and must not fail for it.
    const beforeLegacy = (await counters()).access_count;
    assert.equal((await snapshot(legacy)).project.id, project);
    assert.equal((await counters()).access_count, beforeLegacy);
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
