// `maquinaria` pasa a ser categoría válida de budget_items.
//
// Lo que hay que demostrar tiene dos caras: que maquinaria entra, y que el
// vocabulario sigue cerrado. Una migración que ampliara relajando el CHECK
// pasaría la primera mitad y fallaría la segunda sin que nadie lo notara.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_BUDGET_REVISION_RPCS_TESTS === "1"
  || process.env.RUN_PORTAL_TOKEN_INTEGRATION === "1";
const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const inlined = (path) => sql(path).replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
const MIGRACION = "supabase/migrations/20260927120000_budget_items_allow_maquinaria.sql";
const dbName = "enlaze_revision_rpcs_test";

test("budget_items acepta maquinaria y sigue rechazando lo desconocido",
  { skip: !enabled, timeout: 120000 }, async (t) => {
  assert.equal(process.env.PORTAL_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);
  /* Dos formas de llegar al banco desechable y ninguna más: el socket que usa
     el banco local, o exactamente la URL del contenedor del workflow. Exigir
     socket dejaba fuera a CI, que levanta PostgreSQL por TCP. Una URL
     arbitraria no se acepta: se compara literalmente. */
  const socket = process.env.PORTAL_TEST_SOCKET;
  if (socket) assert.match(socket, /^\/private\/tmp\/enlaze-e2-bench\.[A-Za-z0-9]+$/);
  else assert.equal(process.env.TEST_DATABASE_URL,
    "postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/enlaze_revision_rpcs_test");

  const { Client } = await import("pg");
  const db = new Client(socket
    ? { host: socket, port: 55435, user: "postgres", database: dbName }
    : { connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  t.after(async () => db.end().catch(() => {}));

  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker',true) as marker,
    current_setting('server_version_num')::integer as version,
    (select count(*) from pg_database where not datistemplate
      and datname not in ('postgres',current_database()))::integer as other_dbs`)).rows[0];
  assert.equal(identity.db, dbName);
  assert.equal(identity.marker, "budget_revision_rpcs_2f2");
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.other_dbs, 0);

  // El bootstrap trae el CHECK de tres, como producción antes de la migración.
  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  // Se restituye el vocabulario de partida: el bootstrap ya viene ampliado en
  // esta rama, y la migración exige encontrar el de tres para poder aplicarse.
  await db.query("alter table public.budget_items drop constraint budget_items_category_check");
  await db.query(`alter table public.budget_items add constraint budget_items_category_check
    check (category = any (array['material'::text,'mano_obra'::text,'otros'::text]))`);

  const OWNER = "11111111-1111-4111-8111-111111111111";
  const BUDGET = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  await db.query(`insert into public.budgets(id,user_id,title,status)
    values($1,$2,'Presupuesto','borrador')`, [BUDGET, OWNER]);

  const insertar = (categoria, n) => db.query(
    `insert into public.budget_items(budget_id,concept,quantity,unit,category,unit_price,subtotal,sort_order)
     values($1,$2,1,'ud',$3,100,100,$4)`, [BUDGET, `Partida ${categoria}`, categoria, n]);
  const definicion = async () => (await db.query(
    `select pg_get_constraintdef(oid) as d from pg_constraint
      where conrelid='public.budget_items'::regclass and conname='budget_items_category_check'`)).rows[0]?.d;

  await t.test("antes de la migración, maquinaria se rechaza", async () => {
    await assert.rejects(() => insertar("maquinaria", 1),
      (error) => error.code === "23514" && /budget_items_category_check/.test(error.message),
      "este es el defecto: el generador la ofrecía y la base la tumbaba");
    for (const valida of ["material", "mano_obra", "otros"]) {
      await insertar(valida, 10 + valida.length);
    }
    assert.equal((await db.query("select count(*)::int as n from public.budget_items")).rows[0].n, 3);
  });

  await t.test("el guard rechaza aplicarla sobre un vocabulario que no es el previsto", async () => {
    for (const [preparacion, esperado, caso] of [
      ["alter table public.budget_items drop constraint budget_items_category_check",
       /does not exist; refusing to invent it/, "sin el CHECK"],
      // Un vocabulario distinto pero que las filas ya insertadas satisfacen:
      // si fuera más estrecho, fallaría al crearse y no probaría el guard.
      [`alter table public.budget_items drop constraint budget_items_category_check;
        alter table public.budget_items add constraint budget_items_category_check
          check (category = any (array['material'::text,'mano_obra'::text,'otros'::text,'logistica'::text]))`,
       /unexpected budget_items_category_check definition/, "con otro vocabulario"],
    ]) {
      await db.query("begin");
      try {
        await db.query(preparacion);
        await assert.rejects(() => db.query(inlined(MIGRACION)),
          (error) => esperado.test(error.message), caso);
      } finally {
        await db.query("rollback");
      }
    }
  });

  let filasAntes;
  await t.test("aplicarla no toca ninguna fila existente", async () => {
    filasAntes = (await db.query(
      `select md5(string_agg(t, chr(10) order by t)) as h, count(*)::int as n
         from (select i::text as t from public.budget_items i) s`)).rows[0];
    await db.query(inlined(MIGRACION));
    const despues = (await db.query(
      `select md5(string_agg(t, chr(10) order by t)) as h, count(*)::int as n
         from (select i::text as t from public.budget_items i) s`)).rows[0];
    assert.equal(despues.n, filasAntes.n, "mismo número de partidas");
    assert.equal(despues.h, filasAntes.h, "y byte a byte las mismas");
  });

  await t.test("maquinaria ya entra, y por la RPC de escritura también", async () => {
    await insertar("maquinaria", 99);
    assert.equal((await db.query(
      "select count(*)::int as n from public.budget_items where category='maquinaria'")).rows[0].n, 1,
      "inserción directa admitida");

    // La RPC transporta la categoría con coalesce(nullif(...),'otros'): lo que
    // llega es lo que se guarda, así que es el camino real del generador.
    const items = JSON.stringify([{
      concept: "Alquiler de retroexcavadora", description: "", quantity: 2, unit: "ud",
      category: "maquinaria", unit_price: 280, subtotal: 560, sort_order: 0,
    }]);
    // La RPC de escritura vive en 20260915160000 y necesita su propio esquema
    // de apoyo. Se aplica aquí, después de la migración, para comprobar el
    // camino real del generador y no solo la inserción directa.
    // El banco se reutiliza entre ejecuciones; el esquema privado de las RPC
    // no lo recrea el bootstrap, así que se retira antes de volver a crearlo.
    await db.query("drop schema if exists budget_internal cascade");
    await db.query(sql("__tests__/support/budget-revision-rpcs-schema.sql"));
    await db.query(inlined("supabase/migrations/20260914090000_budgets_lock_version.sql"));
    await db.query(inlined("supabase/migrations/20260915160000_budget_revision_rpcs.sql"));
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
      await db.query("set local role authenticated");
      await db.query(
        `select public.save_budget($1::uuid, 1, '{"title":"Presupuesto"}'::jsonb, $2::jsonb)`,
        [BUDGET, items]);
      await db.query("reset role");
      const guardadas = (await db.query(
        "select count(*)::int as n from public.budget_items where category='maquinaria'")).rows[0].n;
      assert.ok(guardadas >= 1, "la RPC guarda una partida de maquinaria sin 23514");
    } finally {
      await db.query("rollback");
    }
  });

  await t.test("el vocabulario sigue cerrado: nada fuera de las cuatro", async () => {
    for (const invalida of ["logistica", "transporte", "residuos", "MAQUINARIA", "", "otra_cosa"]) {
      await assert.rejects(() => insertar(invalida, 200 + invalida.length),
        (error) => error.code === "23514" && /budget_items_category_check/.test(error.message),
        `"${invalida}" debe seguir rechazándose`);
    }
    assert.equal(await definicion(),
      "CHECK ((category = ANY (ARRAY['material'::text, 'mano_obra'::text, 'maquinaria'::text, 'otros'::text])))",
      "la definición es exactamente la esperada, ni relajada ni ampliada de más");
  });

  await t.test("control negativo: una migración que relajara el CHECK pasaría la mitad buena", async () => {
    // Si en vez de ampliar se quitara el CHECK, maquinaria entraría igual y la
    // primera aserción seguiría verde. Lo que la delata es la segunda.
    await db.query("begin");
    try {
      await db.query("alter table public.budget_items drop constraint budget_items_category_check");
      await insertar("maquinaria", 300);
      assert.ok(true, "sin CHECK, maquinaria entra: esa prueba sola no distingue");
      await insertar("logistica", 301);
      assert.equal((await db.query(
        "select count(*)::int as n from public.budget_items where category='logistica'")).rows[0].n, 1,
        "y también entra cualquier invento: por eso hace falta comprobar el rechazo");
    } finally {
      await db.query("rollback");
    }
    // Restituido el CHECK por el rollback, el invento vuelve a caer.
    await assert.rejects(() => insertar("logistica", 302),
      (error) => error.code === "23514");
  });

  await t.test("la migración es transaccional y no controla la transacción", async () => {
    const texto = sql(MIGRACION);
    assert.equal(/^\s*(begin|commit|rollback|end)\s*;/im.test(texto), false,
      "sin begin/commit propios");
    assert.equal(/\bconcurrently\b/i.test(texto), false,
      "nada que exija ejecutarse fuera de una transacción");
  });
});
