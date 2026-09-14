import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { trocearStatements, detectarControlTransaccion } from "./lib/sql-toplevel.mjs";
import { ROOT, MIGRATION, MARKER, DATABASE, read, block, connectionConfig, assertCluster } from "./lib/budgets-lock-version-bench.mjs";

const sql = read(`supabase/migrations/${MIGRATION}`);
const expectedAlter = "alter table public.budgets add column lock_version integer not null default 1 constraint ck_budgets_lock_version_positive check (lock_version >= 1)";
function contract(candidate) {
  assert.ok(!/--\s*pg-delta:\s*transaction\s*=\s*false/i.test(candidate), "no desactivar la transacción del runner");
  const statements = trocearStatements(candidate).map((s) => s.replace(/\s+/g, " ").trim());
  assert.deepEqual(detectarControlTransaccion(candidate), []);
  assert.equal(statements.length, 4, "sólo cuatro sentencias autorizadas");
  assert.equal(statements[0], "set local lock_timeout = '5s'");
  assert.equal(statements[1], expectedAlter);
  assert.match(statements[2], /^comment on column public\.budgets\.lock_version is '[^']+'$/);
  assert.equal(statements[3], "notify pgrst, 'reload schema'");
}

test("E1: sólo añade revisión técnica, con restricciones y espera acotada", () => contract(sql));
for (const [label, mutate] of [
  ["sin NOT NULL", (s) => s.replace("not null default", "default")],
  ["sin DEFAULT", (s) => s.replace("default 1", "")],
  ["DEFAULT cero", (s) => s.replace("default 1", "default 0")],
  ["CHECK permite cero", (s) => s.replace(">= 1", ">= 0")],
  ["CHECK no validado", (s) => s.replace("check (lock_version >= 1)", "check (lock_version >= 1) not valid")],
  ["columna inesperada ignorada", (s) => s.replace("add column", "add column if not exists")],
  ["reescritura de importes", (s) => s + "\nupdate public.budgets set total = 0;"],
  ["transacción propia", (s) => `begin;\n${s}\ncommit;`],
  ["transacción desactivada", (s) => `-- pg-delta: transaction=false\n${s}`],
  ["declaración sólo en comentario", (s) => s.replace("alter table public.budgets", "-- alter table public.budgets")],
  ["sin recarga de caché", (s) => s.replace("notify pgrst, 'reload schema';", "")],
]) {
  test(`control negativo: ${label}`, () => {
    const mutant = mutate(sql);
    assert.notEqual(mutant, sql);
    assert.throws(() => contract(mutant));
  });
}

test("E1: versión única, dependencia presente y anterior, sin exigir ser la última", () => {
  const files = readdirSync(new URL("supabase/migrations/", ROOT)).filter((f) => f.endsWith(".sql")).sort();
  const check = (list) => {
    assert.equal(new Set(list.map((f) => f.slice(0, 14))).size, list.length);
    const dependency = list.indexOf("20260908111706_replace_budget_items_persist_cost.sql");
    const position = list.indexOf(MIGRATION);
    assert.ok(dependency >= 0 && position >= 0 && dependency < position);
  };
  check(files);
  check([...files, "20990101000000_future.sql"]);
  assert.throws(() => check(files.filter((f) => f !== MIGRATION)));
  assert.throws(() => check(files.filter((f) => !f.endsWith("_replace_budget_items_persist_cost.sql"))));
});

const env = {
  RUN_BUDGET_LOCK_VERSION_INTEGRATION_TESTS: "1",
  LOCK_VERSION_TEST_DB_ACK: "DISPOSABLE_ONLY",
  LOCK_VERSION_TEST_CLUSTER_ACK: "DISPOSABLE_CLUSTER",
  TEST_DATABASE_URL: "postgres://postgres:test_only@127.0.0.1:55434/enlaze_lock_version_test",
};
test("seguridad: el destino permitido produce una configuración explícita", () => {
  const config = connectionConfig(env);
  assert.equal(config.database, DATABASE);
  assert.equal(config.ssl, false);
  assert.equal(config.connectionString, undefined);
});
for (const [name, value] of Object.entries(env)) {
  test(`seguridad: rechaza ausencia de ${name}`, () => {
    const copy = { ...env };
    delete copy[name];
    assert.throws(() => connectionConfig(copy));
    assert.throws(() => connectionConfig({ ...env, [name]: value + "incorrecto" }));
  });
}
for (const suffix of ["?options=-c%20role=postgres", "#fragment", "/", "\n"]) {
  test(`seguridad: rechaza sufijo ${JSON.stringify(suffix)}`, () => {
    assert.throws(() => connectionConfig({ ...env, TEST_DATABASE_URL: env.TEST_DATABASE_URL + suffix }));
  });
}
test("seguridad: rechaza hosts, puertos, escapes y entorno heredado", () => {
  for (const url of [
    env.TEST_DATABASE_URL.replace("127.0.0.1", "localhost"),
    env.TEST_DATABASE_URL.replace("127.0.0.1", "db.example.com"),
    env.TEST_DATABASE_URL.replace("55434", "5432"),
    env.TEST_DATABASE_URL.replace("test_only", "test%5fonly"),
    env.TEST_DATABASE_URL.replace(DATABASE, "postgres"),
  ]) assert.throws(() => connectionConfig({ ...env, TEST_DATABASE_URL: url }));
  for (const key of ["PGOPTIONS", "PGHOST", "PGPASSWORD", "PGSERVICE", "PGSSLMODE", "PGPASSFILE"])
    assert.throws(() => connectionConfig({ ...env, [key]: "" }));
});
test("seguridad: todas las comprobaciones de clúster discriminan", () => {
  const row = { database: DATABASE, marker: MARKER, superuser: true, address: "127.0.0.1", version_num: "170006", other_databases: "0" };
  assertCluster(row);
  assertCluster({ ...row, address: "172.17.0.2" });
  assert.throws(() => assertCluster({ ...row, address: "8.8.8.8" }));
  assert.throws(() => assertCluster({ ...row, address: "172.17.999.1" }));
  for (const key of Object.keys(row)) assert.throws(() => assertCluster({ ...row, [key]: null }));
  assert.throws(() => assertCluster({ ...row, other_databases: "1" }));
});
test("reversión y checks: bloques delimitados fuera del historial activo", () => {
  const rollback = block(read("docs/fase2/ROLLBACK.sql"), "ROLLBACK_2F2_E1");
  assert.match(rollback, /before_revision_clients/);
  assert.match(rollback, /lock_version is distinct from 1/);
  assert.match(rollback, /drop column lock_version restrict/);
  assert.ok(!/\bcascade\b/i.test(rollback));
  for (const label of ["CHECK_12_FINGERPRINT", "CHECK_12_SCHEMA", "CHECK_12_VALUES"])
    assert.ok(trocearStatements(block(read("docs/fase2/CHECKS.sql"), label)).every((s) => /^select\b/i.test(s)));
});
