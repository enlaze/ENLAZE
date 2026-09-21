import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BudgetRevisionError,
  budgetRevisionErrorMessage,
  changeBudgetStatus,
  createBudgetWithItems,
  duplicateBudgetRevision,
  finalizeBudgetRevision,
  isBudgetRevisionConflict,
  saveBudgetRevision,
} from "../lib/budget-revision-writer.ts";

const result = {
  budget_id: "00000000-0000-4000-8000-000000000001",
  lock_version: 2,
  version: 1,
  status: "borrador",
  previous_status: "borrador",
  items_count: 1,
};

function fake(response = { data: result, error: null }) {
  const calls = [];
  return {
    calls,
    client: { rpc(fn, params) { calls.push({ fn, params }); return Promise.resolve(response); } },
  };
}

describe("budget revision writer", () => {
  test("transporta cada operación por su RPC contractual", async () => {
    const f = fake();
    await createBudgetWithItems(f.client, { title: "A" }, [{ concept: "x" }]);
    await saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, [{ concept: "x" }]);
    await finalizeBudgetRevision(f.client, result.budget_id, 2, { title: "C" }, [{ concept: "x" }]);
    await changeBudgetStatus(f.client, result.budget_id, 3, "enviado");
    await duplicateBudgetRevision(f.client, result.budget_id);
    assert.deepEqual(f.calls.map((call) => call.fn), [
      "create_budget_with_items", "save_budget", "finalize_budget",
      "change_budget_status", "duplicate_budget",
    ]);
    assert.equal(f.calls[1].params.p_expected_lock_version, 1);
    assert.equal(f.calls[2].params.p_expected_lock_version, 2);
    assert.equal(f.calls[3].params.p_expected_lock_version, 3);
  });

  test("conserva PT409 y ofrece un mensaje de recarga", async () => {
    const conflict = { code: "PT409", message: "Budget revision conflict" };
    const f = fake({ data: null, error: conflict });
    await assert.rejects(
      () => saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, []),
      (error) => error instanceof BudgetRevisionError && error.code === "PT409",
    );
    try {
      await saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, []);
    } catch (error) {
      assert.equal(isBudgetRevisionConflict(error), true);
      assert.match(budgetRevisionErrorMessage(error), /Recarga la página/);
    }
  });

  test("rechaza respuestas incompletas aunque PostgREST no devuelva error", async () => {
    const f = fake({ data: { budget_id: result.budget_id }, error: null });
    await assert.rejects(
      () => duplicateBudgetRevision(f.client, result.budget_id),
      /respuesta de la base de datos está incompleta/,
    );
  });

  test("no comunica éxito si la RPC informa de un número de partidas distinto", async () => {
    const f = fake();
    await assert.rejects(
      () => saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, []),
      /número de partidas confirmadas no coincide/,
    );
  });
});
