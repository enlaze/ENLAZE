import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Las comprobaciones de S3.3 deciden si se puede dar un paso irreversible.
   Tienen que ser de solo lectura, no mostrar secretos y no dar luz verde por
   omisión. */

const checks = readFileSync("docs/fase2/CHECKS.sql", "utf8");
const bloque = (nombre) =>
  checks.split(`-- BEGIN ${nombre}\n`)[1].split(`-- END ${nombre}`)[0];
/* Solo el SQL: un comentario que mencione access_token o la palabra `delete`
   no es una lectura ni una escritura, y contarlo daría un falso positivo. */
const soloSql = (nombre) =>
  bloque(nombre).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
/* Y sin literales entre comillas: en el paso (c), `ilike '%access_token%'`
   busca el identificador dentro del cuerpo de una función; es lo contrario de
   leer la columna. */
const sqlSinLiterales = (nombre) => soloSql(nombre).replace(/'[^']*'/g, "''");

const BLOQUES = [
  "CHECK_E4_L3_S33_INVENTARIO",
  "CHECK_E4_L3_S33_PASO_B_PRECHECK",
  "CHECK_E4_L3_S33_PASO_C_PRECHECK",
];

test("los tres bloques existen y son de solo lectura", () => {
  for (const nombre of BLOQUES) {
    const sql = soloSql(nombre);
    assert.ok(sql.trim().length > 0, `${nombre} no está vacío`);
    assert.equal(/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/i.test(sql),
      false, `${nombre} no debe escribir ni cambiar nada`);
  }
});

test("ninguno selecciona el secreto del enlace", () => {
  /* Lo que no puede pasar es que access_token salga en la lista de columnas.
     Comprobarlo así, por lo que se proyecta, es más claro que intentar
     clasificar cada aparición: `is not null` y `ilike '%access_token%'` son
     usos legítimos y ninguno de los dos produce la columna en la salida. */
  for (const nombre of BLOQUES) {
    const sql = sqlSinLiterales(nombre);
    assert.equal(/access_token\s*,/.test(sql), false,
      `${nombre}: access_token no puede ir en una lista de columnas`);
    assert.equal(/access_token\s+as\s/i.test(sql), false,
      `${nombre}: ni proyectarse con alias`);
    assert.equal(/select\s+[^;]*\baccess_token\s*(from|$)/is.test(sql), false,
      `${nombre}: ni ser la única columna de un select`);
  }
  // Y el inventario sí mira los enlaces, solo que por presencia.
  assert.match(sqlSinLiterales("CHECK_E4_L3_S33_INVENTARIO"),
    /access_token is not null as tiene_enlace_heredado/,
    "el inventario informa de si hay enlace, no de cuál es");
});

test("el paso (b) exige cero enlaces, no «pocos»", () => {
  const sql = bloque("CHECK_E4_L3_S33_PASO_B_PRECHECK");
  assert.match(sql, /when heredados > 0 then 'ESPERAR/,
    "con un solo enlace vivo todavía no se puede retirar la compatibilidad");
  assert.match(sql, /when s31 = 0 then 'ABORTAR/,
    "y exige que S3.1 esté aplicada");
  assert.match(sql, /heredados_borrados > 0 then 'REVISAR/,
    "los enlaces en proyectos borrados se miran aparte, no se ignoran");
});

test("el paso (c) exige que la compatibilidad ya no esté", () => {
  const sql = bloque("CHECK_E4_L3_S33_PASO_C_PRECHECK");
  assert.match(sql, /rpc_con_legacy > 0 then 'ESPERAR/,
    "mientras una RPC acepte access_token, la columna no se toca");
  assert.match(sql, /portal_read_snapshot.*portal_respond_to_change|portal_respond_to_change.*portal_read_snapshot/s,
    "se comprueban las dos RPC, no una");
});

test("ningún veredicto da luz verde por omisión", () => {
  for (const nombre of BLOQUES.slice(1)) {
    const sql = bloque(nombre);
    const orden = sql.indexOf("else 'OK'");
    assert.ok(orden > sql.indexOf("when"),
      `${nombre}: el OK va al final, después de todas las condiciones de parada`);
    // Un `<>` sobre una columna que puede ser NULL daría NULL, no cierto, y el
    // case caería en el else. Aquí no debe haber ninguno.
    assert.equal(/when\s+\w+\s*<>/.test(sql), false,
      `${nombre}: usa comparaciones seguras frente a NULL`);
  }
});
