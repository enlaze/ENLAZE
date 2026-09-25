import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  compareMigrations,
  isAligned,
  repoMigrations,
} from "../scripts/migraciones-check.mts";

test("coinciden cuando cada fichero tiene su versión y nada sobra", () => {
  const c = compareMigrations(["20260101000000_a.sql", "20260102000000_b.sql"], ["20260101000000", "20260102000000"]);
  assert.equal(isAligned(c), true);
});

test("señala por nombre las que faltan en la base", () => {
  const c = compareMigrations(["20260101000000_a.sql", "20260102000000_b.sql"], ["20260101000000"]);
  assert.deepEqual(c.pendingInDb, ["20260102000000_b.sql"]);
  assert.equal(isAligned(c), false);
});

test("señala las aplicadas en la base sin fichero en el repo", () => {
  const c = compareMigrations(["20260101000000_a.sql"], ["20260101000000", "20260103000000"]);
  assert.deepEqual(c.missingInRepo, ["20260103000000"]);
  assert.equal(isAligned(c), false);
});

test("una versión repetida en el repo no cuenta como alineada", () => {
  const c = compareMigrations(["20260101000000_a.sql", "20260101000000_b.sql"], ["20260101000000"]);
  assert.deepEqual(c.duplicatedInRepo, ["20260101000000"]);
  assert.equal(isAligned(c), false);
});

test("el repo solo cuenta ficheros de migración con versión de 14 dígitos", () => {
  for (const f of repoMigrations()) assert.match(f, /^\d{14}_.+\.sql$/);
});

// Management API simulada: responde con las versiones que se le den.
async function withApi(status, versions, fn) {
  const server = createServer((req, res) => {
    assert.equal(req.url, "/v1/projects/testref/database/migrations");
    assert.equal(req.headers.authorization, "Bearer sbp_test");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(versions.map((version) => ({ version, name: "x" }))));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function run(apiUrl, args = [], token = "sbp_test") {
  return new Promise((resolve) => {
    const env = { ...process.env, SUPABASE_API_URL: apiUrl, SUPABASE_PROJECT_REF: "testref" };
    if (token) env.SUPABASE_ACCESS_TOKEN = token;
    else delete env.SUPABASE_ACCESS_TOKEN;
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/migraciones-check.mts", ...args], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const repoVersions = () => repoMigrations().map((f) => f.slice(0, 14));

test("check: sale con 0 cuando la base tiene exactamente las del repo", async () => {
  await withApi(200, repoVersions(), async (url) => {
    const { code, out } = await run(url);
    assert.equal(code, 0, out);
    assert.match(out, /coinciden/);
  });
});

test("check: sale con 1 y nombra la migración sin aplicar", async () => {
  const files = repoMigrations();
  const last = files.at(-1);
  await withApi(200, repoVersions().slice(0, -1), async (url) => {
    const { code, out } = await run(url);
    assert.equal(code, 1, out);
    assert.ok(out.includes(last), out);
  });
});

test("check: sale con 2 si la API rechaza el token", async () => {
  await withApi(401, [], async (url) => {
    const { code, out } = await run(url);
    assert.equal(code, 2, out);
    assert.match(out, /401/);
    assert.match(out, /Migrations → Read/);
  });
});

test("check: sale con 2 si no hay credenciales", async () => {
  const { code, out } = await run("http://127.0.0.1:9", [], null);
  assert.equal(code, 2, out);
  assert.match(out, /SUPABASE_ACCESS_TOKEN/);
});

test("--warn: avisa de la divergencia pero nunca bloquea el arranque", async () => {
  const last = repoMigrations().at(-1);
  await withApi(200, repoVersions().slice(0, -1), async (url) => {
    const { code, out } = await run(url, ["--warn"]);
    assert.equal(code, 0, out);
    assert.match(out, /⚠ MIGRACIONES/);
    assert.ok(out.includes(last), out);
  });
  const { code, out } = await run("http://127.0.0.1:9", ["--warn"], null);
  assert.equal(code, 0, out);
  assert.match(out, /no se ha podido comprobar/);
});
