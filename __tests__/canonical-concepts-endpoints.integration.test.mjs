import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${program}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`postgrest exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status !== 503) return;
    } catch { /* Waiting for the disposable server to listen. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("postgrest did not become ready");
}

test("the surviving concepts GET resolves against PostgreSQL 17 and POST stays unavailable", { timeout: 120_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "enlaze-canonical-l1-"));
  const pgData = join(directory, "pgdata");
  const pgPort = await freePort();
  const restPort = await freePort();
  const nextPort = await freePort();
  let postgresStarted = false;
  let rest;
  let next;
  t.after(() => {
    if (next) next.kill("SIGTERM");
    if (rest) rest.kill("SIGTERM");
    if (postgresStarted) command("pg_ctl", ["-D", pgData, "-m", "immediate", "-w", "stop"]);
    rmSync(directory, { recursive: true, force: true });
  });

  command("initdb", ["-D", pgData, "-A", "trust", "-U", "postgres", "--no-instructions"]);
  command("pg_ctl", ["-D", pgData, "-l", join(directory, "postgres.log"),
    "-o", `-F -p ${pgPort} -h 127.0.0.1 -k ${directory}`, "-w", "start"]);
  postgresStarted = true;
  const psql = ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "-d", "postgres"];
  const version = command("psql", [...psql, "-A", "-t", "-c", "show server_version_num"]).trim();
  assert.equal(Math.floor(Number(version) / 10_000), 17, "the fixture must be PostgreSQL 17");

  command("psql", psql, { input: `
    create role anon nologin;
    create role authenticator login noinherit;
    grant anon to authenticator;
    grant usage on schema public to anon;
    create table public.canonical_concepts (
      id uuid primary key, display_name_es text not null, family text not null
    );
    grant select on all tables in schema public to anon;
    insert into public.canonical_concepts values
      ('11111111-1111-4111-8111-111111111111', 'Pintura plástica', 'PAINT');
  ` });

  rest = spawn("postgrest", [], {
    env: {
      PATH: process.env.PATH,
      PGRST_DB_URI: `postgres://authenticator@127.0.0.1:${pgPort}/postgres`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(restPort),
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${restPort}`;
  await ready(`${base}/`, rest);

  const concepts = source("app/api/pb/concepts/route.ts");
  const getSource = concepts.split("export async function GET(")[1]?.split("export async function POST(")[0];
  const table = getSource?.match(/\.from\("([^"]+)"\)/)?.[1];
  assert.ok(table, "extract the actual table from the concepts GET endpoint");
  const conceptResponse = await fetch(`${base}/${table}?select=id,display_name_es,family`);
  const conceptBody = await conceptResponse.json();
  assert.equal(conceptResponse.status, 200, JSON.stringify(conceptBody));
  assert.equal(conceptBody[0].display_name_es, "Pintura plástica");
  assert.doesNotMatch(concepts, /pb_normalized_concepts/, "concepts GET still names the missing table");

  // Next.js itself, not a mocked handler, must reject the removed POST.
  next = spawn(process.execPath, [
    fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
    "dev", "--webpack", "-p", String(nextPort), "-H", "127.0.0.1",
  ], {
    cwd: fileURLToPath(root),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: base,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "disposable_local_test_only",
    },
    stdio: "ignore",
  });
  let postResponse;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      postResponse = await fetch(`http://127.0.0.1:${nextPort}/api/pb/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      break;
    } catch {
      if (next.exitCode !== null) throw new Error(`Next.js exited with ${next.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(postResponse, "Next.js did not become ready");
  assert.equal(postResponse.status, 405, (await postResponse.text()).slice(0, 1_000));
});

test("the live price resolver reads canonical concept fields", () => {
  const resolver = source("app/api/prices/resolve/route.ts");
  assert.ok(/const concept = prod\?\.canonical_concepts\b/.test(resolver), "resolver must read canonical_concepts");
  assert.ok(/concept_name: concept\?\.display_name_es\b/.test(resolver), "resolver must use display_name_es");
  assert.ok(!/pb_normalized_concepts|concept\?\.canonical_name/.test(resolver), "resolver must not use legacy concept fields");
});
