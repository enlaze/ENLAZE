import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";

export const ROOT = new URL("../../", import.meta.url);
export const MIGRATION = "20260914090000_budgets_lock_version.sql";
export const MARKER = "budgets_lock_version_2f2";
export const DATABASE = "enlaze_lock_version_test";
export const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

export function block(sql, label) {
  const start = `-- BEGIN ${label}\n`;
  const end = `-- END ${label}`;
  assert.equal(sql.split(start).length, 2, `marcador único ${label}`);
  assert.equal(sql.split(end).length, 2, `cierre único ${label}`);
  const result = sql.split(start)[1].split(end)[0].trim();
  assert.ok(result, `bloque no vacío ${label}`);
  return result;
}

// Se ejecuta ANTES de importar pg y de abrir sockets. Ningún .env se carga.
// Credenciales sintéticas del banco: alfabeto cerrado, sin escapes ni parámetros.
export function connectionConfig(env) {
  assert.equal(env.RUN_BUDGET_LOCK_VERSION_INTEGRATION_TESTS, "1", "falta opt-in");
  assert.equal(env.LOCK_VERSION_TEST_DB_ACK, "DISPOSABLE_ONLY", "falta ACK de base");
  assert.equal(env.LOCK_VERSION_TEST_CLUSTER_ACK, "DISPOSABLE_CLUSTER", "falta ACK de clúster");
  assert.deepEqual(Object.keys(env).filter((key) => key.startsWith("PG")), [], "entorno PG heredado");
  const match = /^postgres(?:ql)?:\/\/([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)@127\.0\.0\.1:55434\/enlaze_lock_version_test$/.exec(env.TEST_DATABASE_URL ?? "");
  assert.ok(match && match[0] === env.TEST_DATABASE_URL, "destino no autorizado; se exige el banco local aislado (URL no impresa)");
  return {
    host: "127.0.0.1", port: 55434, database: DATABASE,
    user: match[1], password: match[2], ssl: false,
    connectionTimeoutMillis: 5000, query_timeout: 15000,
    application_name: "enlaze-lock-version-test",
  };
}

// El marcador evita confusiones; no sustituye a los ACK ni prueba por sí solo
// que un servidor sea desechable. Los parámetros personalizados son mutables.
export function assertCluster(row) {
  assert.equal(row.database, DATABASE, "base inesperada");
  assert.equal(row.marker, MARKER, "marcador de clúster inesperado");
  assert.equal(row.superuser, true, "se requiere superusuario del clúster desechable");
  // El cliente sólo conecta a 127.0.0.1, pero tras el NAT de Docker el servidor
  // ve su dirección privada de contenedor. No confundirla con el destino del cliente.
  assert.ok(isIPv4(row.address ?? "") && (
    row.address === "127.0.0.1" || row.address.startsWith("10.") ||
    row.address.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(row.address)
  ), "dirección de servidor fuera del banco local/contenedor");
  assert.match(String(row.version_num), /^[0-9]+$/);
  assert.match(String(row.other_databases), /^[0-9]+$/);
  assert.equal(Math.floor(Number(row.version_num) / 10000), 17, "se requiere PostgreSQL 17");
  assert.equal(Number(row.other_databases), 0, "el clúster contiene otras bases de datos");
}
