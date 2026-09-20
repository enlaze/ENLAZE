import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
export const ROOT = new URL("../../", import.meta.url);
export const MIGRATION = "20260915160000_budget_revision_rpcs.sql";
export const DATABASE = "enlaze_revision_rpcs_test";
export const MARKER = "budget_revision_rpcs_2f2";
export const read = p => readFileSync(new URL(p, ROOT), "utf8");
// The bench runs one transaction, so a migration that carries its own top-level
// control has to be stripped: its commit would end the bench's transaction.
export const inlined = p => read(p).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
export function config(env) {
  assert.equal(env.RUN_REVISION_RPCS_INTEGRATION_TESTS, "1");
  assert.equal(env.REVISION_RPCS_DB_ACK, "DISPOSABLE_ONLY");
  assert.equal(env.REVISION_RPCS_CLUSTER_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(env).filter(k=>k.startsWith("PG")), [], "Inherited PG environment");
  const m=/^postgres(?:ql)?:\/\/([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)@127\.0\.0\.1:55435\/enlaze_revision_rpcs_test$/.exec(env.TEST_DATABASE_URL??"");
  assert.ok(m && m[0]===env.TEST_DATABASE_URL, "Only the disposable localhost E2 database is allowed");
  return {host:"127.0.0.1",port:55435,database:DATABASE,user:m[1],password:m[2],
    ssl:false,connectionTimeoutMillis:5000,query_timeout:15000,application_name:"e2-bench"};
}
export function cluster(row) {
  assert.match(String(row.other_databases), /^[0-9]+$/);
  assert.match(String(row.version_num), /^[0-9]+$/);
  assert.equal(row.database,DATABASE); assert.equal(row.marker,MARKER);
  assert.equal(row.superuser,true); assert.equal(Number(row.other_databases),0);
  assert.equal(Math.floor(Number(row.version_num)/10000),17);
  assert.ok(isIPv4(row.address??"") && (row.address==="127.0.0.1" || row.address.startsWith("10.") ||
    row.address.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(row.address)));
}
export async function guard(db) {
  cluster((await db.query(`select current_database() as database,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    host(inet_server_addr()) as address,current_setting('server_version_num') as version_num,
    (select count(*) from pg_database where not datistemplate and datname not in ('postgres',current_database())) as other_databases`)).rows[0]);
}
export async function setup(db, candidate = read("supabase/migrations/"+MIGRATION)) {
  await guard(db);
  await db.query("begin");
  try {
    await db.query("drop schema if exists budget_internal cascade");
    await db.query(read("__tests__/support/bootstrap-budget-schema.sql"));
    await db.query(read("__tests__/support/budget-revision-rpcs-schema.sql"));
    await db.query(read("supabase/migrations/20260908111706_replace_budget_items_persist_cost.sql"));
    await db.query(read("supabase/migrations/20260914090000_budgets_lock_version.sql"));
    // Applied and verified in production before E2. The bench mirrors that chain
    // so the snapshot below proves E2 leaves the portal hardening untouched.
    await db.query(inlined("supabase/migrations/20260915140000_portal_tokens_owner_only.sql"));
    const unchanged = async () => (await db.query("select (select jsonb_agg(jsonb_build_array(c.relname,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tables, (select prosrc from pg_proc where oid='public.replace_budget_items(uuid,jsonb)'::regprocedure) as legacy")).rows[0];
    const before = await unchanged();
    await db.query(candidate);
    assert.deepEqual(await unchanged(), before, "E2 changes neither existing table ACL/RLS nor the legacy writer");
    await db.query("commit");
  } catch(e) { await db.query("rollback"); throw e; }
}
