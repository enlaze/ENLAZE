// Owns an entire PostgreSQL 17 cluster, not a database in an existing server.
// No .env loading, hosted target, external HTTP or real Stripe credential.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertNoProductionEnvironment } from "./disposable-target-guard.mjs";

const exec = promisify(execFile);
const ROOT = new URL("../../", import.meta.url);
const DATABASE = "enlaze_billing_webhook_test";
const MARKER = "billing_webhook_regression";
const JWT_SECRET = "billing_bench_synthetic_jwt_secret_not_for_any_real_service";
const migration = "supabase/migrations/20260924102515_billing_subscriptions_and_paywall.sql";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function startBillingBench({ beforeRest = async () => {} } = {}) {
  assertNoProductionEnvironment(process.env);
  assert.deepEqual(Object.keys(process.env).filter(name => /^(PG|PGRST_)/.test(name)), [],
    "Refusing inherited PostgreSQL/PostgREST connection settings");
  assert.deepEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "VERCEL_TOKEN"]
    .filter(name => process.env[name] !== undefined), [], "Refusing real integration credentials");
  const pgBin = process.env.BILLING_TEST_PG_BIN ?? [
    "/opt/homebrew/opt/postgresql@17/bin", "/usr/lib/postgresql/17/bin",
  ].find(path => existsSync(join(path, "initdb")));
  assert.ok(pgBin, "Install PostgreSQL 17 locally or set BILLING_TEST_PG_BIN; no download is attempted");
  const restBin = process.env.BILLING_TEST_POSTGREST_BIN ?? (
    existsSync("/opt/homebrew/opt/postgrest/bin/postgrest")
      ? "/opt/homebrew/opt/postgrest/bin/postgrest" : "postgrest");
  const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const version = (await exec(join(pgBin, "postgres"), ["--version"], { env: childEnv })).stdout;
  assert.match(version, /PostgreSQL\) 17\./, "Only PostgreSQL 17 is accepted");
  const restVersion = (await exec(restBin, ["--version"], { env: childEnv })).stdout.trim();
  const directory = await mkdtemp("/private/tmp/enlaze-billing-pg17-");
  const dataDir = join(directory, "data");
  const dbConfig = { host: directory, port: 55439, user: "postgres", database: DATABASE,
    connectionTimeoutMillis: 5000, query_timeout: 10000 };
  const nativeFetch = globalThis.fetch;
  let postgresStarted = false, restProcess, db;
  const close = async () => {
    globalThis.fetch = nativeFetch;
    if (restProcess && restProcess.exitCode === null) {
      const exited = new Promise(resolve => restProcess.once("exit", resolve));
      restProcess.kill("SIGTERM");
      await exited;
    }
    if (db) await db.end();
    if (postgresStarted) await exec(join(pgBin, "pg_ctl"),
      ["-D", dataDir, "-m", "immediate", "-w", "stop"], { env: childEnv });
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await exec(join(pgBin, "initdb"), ["-D", dataDir, "--auth=trust", "--username=postgres", "--no-locale"],
      { env: childEnv });
    await exec(join(pgBin, "pg_ctl"), ["-D", dataDir, "-l", join(directory, "postgres.log"),
      "-o", `-k ${directory} -p 55439 -c listen_addresses='' -c enlaze.test_cluster_marker=${MARKER}`, "-w", "start"],
    { env: childEnv });
    postgresStarted = true;
    const bootstrap = new Client({ ...dbConfig, database: "postgres" });
    await bootstrap.connect();
    try { await bootstrap.query(`create database ${DATABASE}`); }
    finally { await bootstrap.end(); }
    db = new Client(dbConfig);
    await db.connect();
    const identity = (await db.query(`select current_database() as name,
      current_setting('server_version_num')::int as version,
      current_setting('data_directory') as directory,
      current_setting('enlaze.test_cluster_marker') as marker,
      inet_server_addr() as address,
      (select rolsuper from pg_roles where rolname=current_user) as superuser,
      (select count(*)::int from pg_database where not datistemplate
        and datname not in ('postgres',current_database())) as other_databases`)).rows[0];
    assert.deepEqual(identity, { name: DATABASE, version: identity.version,
      directory: dataDir, marker: MARKER, address: null, superuser: true, other_databases: 0 });
    assert.equal(Math.floor(identity.version / 10000), 17);

    await db.query(await readFile(new URL("__tests__/support/billing-webhook-bootstrap.sql", ROOT), "utf8"));
    // Full, unmodified production billing migration, including stripe_events,
    // subscriptions, their constraints/RLS and the real paywall functions.
    await db.query(await readFile(new URL(migration, ROOT), "utf8"));
    await db.query(await readFile(new URL("supabase/migrations/20260928072843_billing_usage_summary.sql", ROOT), "utf8"));
    await db.query(`insert into public.plan_catalog(plan,trial_days,limits,features)
      values('prueba',5,'{}','{}');
      create schema billing_bench;
      create table billing_bench.writes(table_name text, row_id text, old_status text, new_status text);
      create function billing_bench.record_write() returns trigger language plpgsql security definer set search_path='' as $$
      begin
        insert into billing_bench.writes values(tg_table_name,
          coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'user_id'),
          to_jsonb(old)->>'status',to_jsonb(new)->>'status');
        return new;
      end $$;
      create trigger billing_bench_subscription_write after update on public.subscriptions
        for each row execute function billing_bench.record_write();
      create trigger billing_bench_event_write after update on public.stripe_events
        for each row execute function billing_bench.record_write();
      create function public.billing_bench_identity() returns jsonb language sql as $$
        select jsonb_build_object('database',current_database(),
          'marker',current_setting('enlaze.test_cluster_marker')) $$;`);

    await beforeRest(db);
    const portProbe = createServer();
    await new Promise((resolve, reject) => { portProbe.once("error", reject); portProbe.listen(0, "127.0.0.1", resolve); });
    const restPort = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    const origin = `http://127.0.0.1:${restPort}`;
    restProcess = spawn(restBin, [], { env: { ...childEnv,
      PGRST_DB_URI: `postgresql://authenticator@/${DATABASE}?host=${encodeURIComponent(directory)}&port=55439`,
      PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(restPort), PGRST_DB_POOL: "4",
    }, stdio: ["ignore", "ignore", "pipe"] });
    let restError = "";
    restProcess.stderr.on("data", chunk => { restError = (restError + chunk).slice(-2000); });
    restProcess.on("error", error => { restError = error.message; });
    const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const jwtData = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role: "service_role", exp: Math.floor(Date.now()/1000)+3600 })}`;
    const jwt = `${jwtData}.${createHmac("sha256", JWT_SECRET).update(jwtData).digest("base64url")}`;
    const guardedFetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
      assert.equal(url.origin, origin, "HTTP must stay on this bench's loopback origin");
      url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
      return nativeFetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
    };
    // Also refuse accidental fetches added elsewhere in the webhook later.
    globalThis.fetch = guardedFetch;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await guardedFetch(`${origin}/rpc/billing_bench_identity`,
          { headers: { Authorization: `Bearer ${jwt}` } });
        if (response.ok) {
          assert.deepEqual(await response.json(), { database: DATABASE, marker: MARKER });
          ready = true; break;
        }
      } catch (error) { if (error instanceof assert.AssertionError) throw error; }
      if (restProcess.exitCode !== null) break;
      await delay(100);
    }
    assert.ok(ready, `PostgREST did not expose the disposable database: ${restError}`);
    const admin = (afterResponse = async () => {}) => createClient(origin, jwt, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const response = await guardedFetch(input, init);
        await afterResponse(new URL(typeof input === "string" ? input : input.url ?? String(input)), init, response);
        return response;
      } },
    });
    console.log(`BENCH: ${version.trim()}; ${restVersion}; production billing migration; loopback only`);
    return { db, dbConfig, admin, origin, jwt, close };
  } catch (error) { await close(); throw error; }
}
