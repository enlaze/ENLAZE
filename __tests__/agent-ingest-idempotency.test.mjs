/**
 * Contrato de idempotencia del ingest del agente.
 *
 * El nodo "Send to ENLAZE" del workflow reintenta, así que cada tabla que
 * escribe /api/agent/ingest tiene que entrar por upsert contra una clave con
 * índice UNIQUE. Estos tests son estáticos —leen el código y la migración— y
 * están para que un `insert` que vuelva a colarse, o un índice que se caiga,
 * salten aquí y no en producción con filas duplicadas.
 *
 * El comportamiento en sí (mismo ingest dos veces, día siguiente, estado del
 * usuario) se verificó contra la base real; esto solo fija el contrato.
 *
 *   node --test __tests__/agent-ingest-idempotency.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

const ingestRoute = fs.readFileSync(
  path.join(root, "app/api/agent/ingest/route.ts"),
  "utf8",
);
const newsRoute = fs.readFileSync(
  path.join(root, "app/api/agent/news/route.ts"),
  "utf8",
);
/* Las dos migraciones del cambio, juntas: agent_reviews va aparte porque su
   clave no lleva fecha y la expresión generada necesitó otra vuelta. */
const migration = [
  "supabase/migrations/20260912141703_agent_ingest_idempotency_all_tables.sql",
  "supabase/migrations/20260912155346_agent_reviews_content_dedupe_key.sql",
]
  .map((rel) => fs.readFileSync(path.join(root, rel), "utf8"))
  .join("\n");

/* Tabla → clave de conflicto que debe usar el upsert, y por qué.
   Las que NO llevan execution_date son entidades que persisten entre días. */
const TABLES = [
  ["agent_daily_summary", "user_id,execution_date"],
  ["agent_news", "user_id,execution_date,dedupe_key"],
  ["agent_signals", "user_id,execution_date,dedupe_key"],
  ["agent_campaigns", "user_id,execution_date,dedupe_key"],
  ["agent_tasks", "user_id,execution_date,dedupe_key"],
  ["agent_reviews", "user_id,dedupe_key"], // una reseña es un objeto fijo
  ["agent_leads", "user_id,place_id"], // un lead persiste y se actualiza
];

test("ninguna tabla del agente se escribe con insert en el ingest", () => {
  for (const [table] of TABLES) {
    const inserts = new RegExp(
      `from\\("${table}"\\)[\\s\\S]{0,120}?\\.insert\\(`,
      "g",
    );
    assert.equal(
      inserts.test(ingestRoute),
      false,
      `${table} vuelve a usar .insert() en el ingest: un reintento duplicaría filas`,
    );
  }
});

test("cada tabla usa la clave de conflicto documentada", () => {
  for (const [table, onConflict] of TABLES) {
    assert.ok(
      ingestRoute.includes(`from("${table}")`),
      `el ingest ya no escribe en ${table}`,
    );
    assert.ok(
      ingestRoute.includes(`onConflict: "${onConflict}"`),
      `falta el upsert con onConflict "${onConflict}" para ${table}`,
    );
  }
});

test("el lote se deduplica antes de mandarlo", () => {
  // Postgres aborta la sentencia entera con «ON CONFLICT DO UPDATE command
  // cannot affect row a second time» si un mismo INSERT trae dos filas con la
  // misma clave, y el payload del agente puede repetir un elemento.
  assert.match(ingestRoute, /function dedupeRows</);
  // Una llamada por cada tabla que manda lotes: news, signals, campaigns,
  // tasks, reviews y leads. daily_summary manda una sola fila y no la necesita.
  const calls = ingestRoute.match(/dedupeRows\(/g) || [];
  assert.equal(
    calls.length,
    6,
    `dedupeRows se llama ${calls.length} veces; se esperaban 6 (una por tabla con lote)`,
  );
});

test("una sola fecha de ejecución para todo el payload", () => {
  // Si cada tabla calculara su propia fecha, un payload procesado a caballo de
  // la medianoche UTC repartiría sus filas entre dos días.
  assert.match(ingestRoute, /const executionDate = resolveExecutionDate\(payload\)/);
  const perTable = ingestRoute.match(/execution_date: executionDate/g) || [];
  assert.ok(
    perTable.length >= 5,
    `solo ${perTable.length} tablas reciben executionDate`,
  );
});

test("la otra vía que escribe noticias también hace upsert", () => {
  // /api/agent/news?write=1 y el ingest escriben los dos en agent_news. Con el
  // índice UNIQUE, un insert plano ahí fallaría por clave duplicada.
  assert.match(
    newsRoute,
    /from\("agent_news"\)\s*\.upsert\([\s\S]{0,120}?onConflict: "user_id,execution_date,dedupe_key"/,
  );
  assert.doesNotMatch(newsRoute, /from\("agent_news"\)\s*\.insert\(/);
});

/* ── La migración ──────────────────────────────────────────────────────── */

test("la migración crea un índice único por tabla", () => {
  const expected = {
    agent_news: "agent_news_user_date_item_key",
    agent_signals: "agent_signals_user_date_item_key",
    agent_campaigns: "agent_campaigns_user_date_item_key",
    agent_tasks: "agent_tasks_user_date_item_key",
    agent_reviews: "agent_reviews_user_item_key",
    agent_leads: "agent_leads_user_place_key",
  };
  for (const [table, index] of Object.entries(expected)) {
    assert.ok(
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${index}\\s+ON public\\.${table}`).test(
        migration,
      ),
      `falta el índice único ${index} sobre ${table}`,
    );
  }
});

test("las claves con fecha llevan execution_date y las persistentes no", () => {
  const conFecha = ["agent_news", "agent_signals", "agent_campaigns", "agent_tasks"];
  for (const table of conFecha) {
    assert.match(
      migration,
      new RegExp(`ON public\\.${table} \\(user_id, execution_date, dedupe_key\\)`),
      `${table} debería llevar execution_date en la clave: el mismo elemento puede reaparecer otro día`,
    );
  }
  // Una reseña y un lead son objetos externos fijos: con la fecha dentro
  // acumularían una copia por día y se perdería el estado del usuario.
  assert.match(migration, /ON public\.agent_reviews \(user_id, dedupe_key\)/);
  assert.match(migration, /ON public\.agent_leads \(user_id, place_id\)/);
});

test("dedupe_key es generada y nunca NULL", () => {
  // En un índice único los NULL cuentan como distintos entre sí, así que una
  // clave que pueda ser NULL no deduplica nada. Todas las columnas nullable que
  // entran en una dedupe_key tienen que pasar por coalesce.
  const bloques = migration.match(
    /ADD COLUMN IF NOT EXISTS dedupe_key text\s+GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/g,
  );
  assert.equal(bloques?.length, 5, "se esperaban 5 columnas dedupe_key generadas");

  // url, type, entity_id, author, review_date y text_content son nullable.
  for (const col of ["url", "type", "entity_id", "author", "review_date", "text_content"]) {
    const usos = migration.match(new RegExp(`\\b${col}\\b`, "g")) || [];
    if (usos.length === 0) continue;
    assert.match(
      migration,
      new RegExp(`coalesce\\([^)]*\\b${col}\\b`),
      `${col} es nullable y entra en una clave sin coalesce`,
    );
  }
});

test("review_date no se castea a text (no es inmutable)", () => {
  // `date::text` depende de DateStyle, es STABLE, y Postgres rechaza una
  // columna generada que no sea IMMUTABLE. Se usa días desde epoch.
  assert.doesNotMatch(migration, /coalesce\(review_date::text/);
  assert.match(migration, /review_date - DATE '1970-01-01'/);
});

test("las URLs de noticias no se normalizan a minúsculas", () => {
  // Las de Google News son base64, que distingue mayúsculas: normalizar
  // fundiría dos artículos distintos en uno.
  assert.doesNotMatch(migration, /md5\(lower\(coalesce\(nullif\(url/);
  assert.match(migration, /md5\(coalesce\(nullif\(url, ''\), title\)\)/);
});
