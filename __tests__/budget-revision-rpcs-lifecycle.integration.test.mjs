// FASE 2F-2 · E3 — functional lifecycle through the app's real writer.
//
// Drives lib/budget-revision-writer.ts, the module the dashboard calls, through
// create, autosave, recover, finalize, edit, send, duplicate and a two-session
// conflict. The same assertions run over two transports:
//   sql  — the writer's rpc() mapped to the SQL function; runs anywhere the
//          disposable PostgreSQL 17 bench runs.
//   rest — real @supabase/supabase-js against PostgREST, as in the browser;
//          needs the bench's PostgREST, which only CI starts.
// Data is synthetic. Every target is checked before the first query, and every
// HTTP request is checked again in flight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { config, setup } from "./lib/budget-revision-rpcs-bench.mjs";
import {
  assertDisposableRestTarget,
  assertNoProductionEnvironment,
  guardedFetch,
} from "./lib/disposable-target-guard.mjs";
import {
  budgetRevisionErrorMessage,
  changeBudgetStatus,
  createBudgetWithItems,
  duplicateBudgetRevision,
  finalizeBudgetRevision,
  isBudgetRevisionConflict,
  saveBudgetRevision,
} from "../lib/budget-revision-writer.ts";

const enabled = process.env.RUN_REVISION_RPCS_INTEGRATION_TESTS === "1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const WRITERS = new Set([
  "create_budget_with_items", "save_budget", "finalize_budget",
  "change_budget_status", "duplicate_budget",
]);
const items = (n) => Array.from({ length: n }, (_, i) =>
  ({ concept: `Partida ${i + 1}`, quantity: "1", unit_price: String(100 * (i + 1)) }));

test("E3 · ciclo funcional con el escritor real, sólo contra el banco desechable",
  { skip: !enabled, timeout: 120000 }, async (t) => {
  // Controls first. Nothing below runs until the targets are proven disposable.
  assertNoProductionEnvironment(process.env);
  const restRequired = process.env.REQUIRE_REST_LIFECYCLE === "1";
  const restUrl = process.env.E2_REST_URL;
  if (restRequired) assert.ok(restUrl, "REQUIRE_REST_LIFECYCLE=1 but E2_REST_URL is missing");
  const restOrigin = restUrl === undefined ? null : assertDisposableRestTarget(restUrl);

  const { Client } = await import("pg");
  const db = new Client(config(process.env)); // exact localhost URL, triple ACK, no PG* env
  await db.connect();
  t.after(() => db.end());
  await setup(db); // marker, PostgreSQL 17, superuser, no other databases
  await db.query("insert into auth.users values ($1)", [OWNER]);

  const read = async (id) => {
    const { rows } = await db.query(`select to_jsonb(b) as budget,
        coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order, i.id)
          from public.budget_items i where i.budget_id = b.id), '[]'::jsonb) as items
      from public.budgets b where b.id = $1`, [id]);
    return rows[0] ? { ...rows[0].budget, items: rows[0].items } : null;
  };
  const documents = async (id) => Number((await db.query(
    "select count(*) as n from public.document_versions where entity_type = 'budget' and entity_id = $1",
    [id])).rows[0].n);

  // --- Transports ----------------------------------------------------------
  // The writer only needs rpc(fn, params) -> { data, error }, which is exactly
  // the part of supabase-js the dashboard uses.
  function sqlSession() {
    return {
      async rpc(fn, params) {
        assert.ok(WRITERS.has(fn), `RPC fuera del contrato del escritor: ${fn}`);
        const names = Object.keys(params);
        for (const name of names) assert.match(name, /^p_[a-z_]+$/);
        const args = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
        const values = names.map((name) => {
          const value = params[name];
          return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
        });
        // The JWT claim and the role are transaction-local, like a PostgREST request.
        await db.query("begin");
        try {
          await db.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
          await db.query("set local role authenticated");
          const { rows } = await db.query(`select public.${fn}(${args}) as data`, values);
          await db.query("commit");
          return { data: rows[0].data, error: null };
        } catch (error) {
          await db.query("rollback").catch(() => {});
          return { data: null, error: { code: error.code, message: error.message } };
        }
      },
    };
  }

  let restSession = null;
  if (restOrigin) {
    const secret = process.env.E2_JWT_SECRET;
    assert.ok(typeof secret === "string" && secret.length >= 32, "E2_JWT_SECRET must be the synthetic bench secret");
    const part = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
    const body = part({ alg: "HS256", typ: "JWT" }) + "." +
      part({ role: "authenticated", sub: OWNER, exp: Math.floor(Date.now() / 1000) + 600 });
    const bearer = body + "." + createHmac("sha256", secret).update(body).digest("base64url");
    const { createClient } = await import("@supabase/supabase-js");
    const hosts = new Set();
    restSession = () => createClient(restOrigin, "synthetic-local-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: "Bearer " + bearer },
        fetch: guardedFetch(restOrigin, { onRequest: (url) => hosts.add(url.origin) }),
      },
    });
    t.after(() => assert.deepEqual([...hosts], [restOrigin], "every request went to the disposable PostgREST"));
    // setup() rebuilt the schema: wait until PostgREST serves the new functions.
    await db.query("notify pgrst, 'reload schema'");
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        const response = await guardedFetch(restOrigin)(`${restOrigin}/`,
          { headers: { Authorization: "Bearer " + bearer } });
        const spec = await response.json();
        ready = response.ok && Boolean(spec.paths?.["/rpc/duplicate_budget"]);
      } catch { /* not ready yet */ }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "PostgREST must expose the E2 functions before the lifecycle runs");
  }

  // --- Scenarios, identical for both transports ----------------------------
  async function lifecycle(label, session) {
    // Crear.
    const created = await createBudgetWithItems(session,
      { title: `E3 ${label}`, budget_number: `E3-${label}`, total: "300" }, items(2));
    assert.equal(created.status, "borrador");
    assert.equal(created.lock_version, 1);
    assert.equal(created.items_count, 2);
    const id = created.budget_id;

    // Autoguardar, encadenando el lock_version devuelto como hace el proveedor.
    let lock = created.lock_version;
    for (const [title, count] of [["autoguardado 1", 2], ["autoguardado 2", 3]]) {
      const saved = await saveBudgetRevision(session, id, lock, { title }, items(count));
      assert.equal(saved.lock_version, lock + 1);
      assert.equal(saved.status, "borrador");
      assert.equal(saved.items_count, count);
      lock = saved.lock_version;
    }
    assert.equal(await documents(id), 0, "un borrador no genera versión documental");

    // Recuperar: lo que la app recarga es exactamente el último guardado.
    const recovered = await read(id);
    assert.equal(recovered.title, "autoguardado 2");
    assert.equal(recovered.lock_version, lock, "la revisión recargada es la que usará el siguiente guardado");
    assert.deepEqual(recovered.items.map((i) => i.concept), ["Partida 1", "Partida 2", "Partida 3"]);
    assert.deepEqual(recovered.items.map((i) => i.sort_order), [0, 1, 2]);

    // Finalizar.
    const finalized = await finalizeBudgetRevision(session, id, lock, { title: "finalizado", total: "600" }, items(3));
    assert.equal(finalized.status, "pendiente");
    assert.equal(finalized.version, 1);
    assert.equal(await documents(id), 1);
    lock = finalized.lock_version;

    // Editar: sobre un presupuesto pendiente, cada guardado versiona.
    const edited = await saveBudgetRevision(session, id, lock, { title: "editado", total: "600" }, items(3));
    assert.equal(edited.status, "pendiente");
    assert.equal(edited.version, 2);
    assert.equal(await documents(id), 2);
    lock = edited.lock_version;

    // Enviar.
    const sent = await changeBudgetStatus(session, id, lock, "enviado");
    assert.equal(sent.status, "enviado");
    assert.equal(sent.previous_status, "pendiente");
    assert.ok((await read(id)).sent_at, "enviar sella sent_at para el timeline");

    // Duplicar.
    const original = await read(id);
    const copy = await duplicateBudgetRevision(session, id);
    assert.notEqual(copy.budget_id, id);
    assert.equal(copy.status, "borrador");
    assert.equal(copy.lock_version, 1);
    assert.equal(copy.version, 1);
    assert.equal(copy.items_count, 3);
    assert.deepEqual((await read(copy.budget_id)).items.map((i) => i.concept),
      original.items.map((i) => i.concept));
    assert.deepEqual(await read(id), original, "duplicar no toca el original");
  }

  async function twoSessions(label, tabA, tabB) {
    const created = await createBudgetWithItems(tabA,
      { title: "conflicto", budget_number: `E3-C-${label}` }, items(1));
    const loaded = created.lock_version; // las dos pestañas abren la misma revisión
    const winner = await saveBudgetRevision(tabA, created.budget_id, loaded, { title: "pestaña A" }, items(1));
    assert.equal(winner.lock_version, loaded + 1);

    const beforeStale = await read(created.budget_id);
    let refused;
    try {
      await saveBudgetRevision(tabB, created.budget_id, loaded, { title: "pestaña B" }, items(2));
    } catch (error) { refused = error; }
    assert.ok(refused, "la pestaña con la revisión antigua no puede guardar");
    assert.equal(isBudgetRevisionConflict(refused), true);
    assert.match(budgetRevisionErrorMessage(refused), /otra pestaña o sesión/);
    assert.match(budgetRevisionErrorMessage(refused), /Recarga/);
    assert.deepEqual(await read(created.budget_id), beforeStale, "el guardado rechazado no cambia nada");

    // Tras recargar, la pestaña B sí puede guardar.
    const fresh = (await read(created.budget_id)).lock_version;
    const retried = await saveBudgetRevision(tabB, created.budget_id, fresh, { title: "pestaña B tras recargar" }, items(2));
    assert.equal(retried.lock_version, fresh + 1);
    assert.equal((await read(created.budget_id)).title, "pestaña B tras recargar");
  }

  async function legacyBudget(label, session) {
    // Un presupuesto como los anteriores a E2: pendiente y sin versión documental.
    const { rows } = await db.query(`insert into public.budgets
        (user_id, title, budget_number, status, version, lock_version, total)
      values ($1, 'Presupuesto antiguo', $2, 'pendiente', 1, 1, 1000) returning id`, [OWNER, `E3-L-${label}`]);
    const id = rows[0].id;
    const before = await read(id);
    let refused;
    try { await changeBudgetStatus(session, id, 1, "enviado"); } catch (error) { refused = error; }
    assert.ok(refused, "sin versión finalizada no se puede enviar");
    const shown = budgetRevisionErrorMessage(refused);
    assert.doesNotMatch(shown, /Finalize/, "el mensaje en inglés no llega al usuario");
    assert.match(shown, /guárdalo una vez/);
    assert.deepEqual(await read(id), before, "el rechazo no cambia nada");
    // Y la salida que indica el mensaje funciona de verdad.
    const saved = await saveBudgetRevision(session, id, 1, { title: "Presupuesto antiguo" }, items(1));
    assert.equal(await documents(id), 1);
    const sent = await changeBudgetStatus(session, id, saved.lock_version, "enviado");
    assert.equal(sent.status, "enviado");
  }

  const skipRest = restSession ? false : "E2_REST_URL no configurada: la capa HTTP sólo existe en CI";
  await t.test("sql · crear, autoguardar, recuperar, finalizar, editar, enviar y duplicar",
    () => lifecycle("sql", sqlSession()));
  await t.test("sql · conflicto entre dos sesiones", () => twoSessions("sql", sqlSession(), sqlSession()));
  await t.test("sql · presupuesto antiguo sin versión documental", () => legacyBudget("sql", sqlSession()));
  await t.test("rest · crear, autoguardar, recuperar, finalizar, editar, enviar y duplicar",
    { skip: skipRest }, () => lifecycle("rest", restSession()));
  await t.test("rest · conflicto entre dos sesiones",
    { skip: skipRest }, () => twoSessions("rest", restSession(), restSession()));
  await t.test("rest · presupuesto antiguo sin versión documental",
    { skip: skipRest }, () => legacyBudget("rest", restSession()));
});
