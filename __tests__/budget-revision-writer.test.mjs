import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const budgetListPage = readFileSync(
  new URL("../app/dashboard/budgets/page.tsx", import.meta.url),
  "utf8",
);
const budgetDetailPage = readFileSync(
  new URL("../app/dashboard/budgets/[id]/page.tsx", import.meta.url),
  "utf8",
);

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
      () => saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, [{ concept: "x" }]),
      (error) => error instanceof BudgetRevisionError && error.code === "PT409",
    );
    try {
      await saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, [{ concept: "x" }]);
    } catch (error) {
      assert.equal(isBudgetRevisionConflict(error), true);
      assert.match(budgetRevisionErrorMessage(error), /Recarga la página/);
    }
  });

  test("refresca las vistas sin cambios locales tras PT409 antes de permitir otro intento", () => {
    assert.match(
      budgetListPage,
      /if \(isBudgetRevisionConflict\(error\)\) \{\s*const refreshed = await fetchBudgets\(\);[\s\S]*?refreshed[\s\S]*?La lista se ha actualizado\.[\s\S]*?No se pudo actualizar la lista\.[\s\S]*?\} else \{/,
      "la lista debe reemplazar su lock_version obsoleto con una lectura nueva",
    );
    assert.match(
      budgetListPage,
      /const \{ data, error \} = await supabase[\s\S]*?if \(error \|\| !data\) return false;[\s\S]*?setBudgets\(data as Budget\[\]\);[\s\S]*?return true;/,
      "la lista no debe afirmar que se actualizó cuando la lectura falla",
    );
    assert.match(
      budgetDetailPage,
      /if \(isBudgetRevisionConflict\(error\)\) \{\s*await loadBudget\(\);[\s\S]*?La ficha se ha actualizado\.[\s\S]*?\} else \{[\s\S]*?\}\s*\}\s*setUpdating\(false\);/,
      "la ficha debe reemplazar su lock_version obsoleto con una lectura nueva",
    );
    assert.match(budgetListPage, /budgets\.find\([\s\S]*?budget\.lock_version/);
    assert.match(budgetDetailPage, /changeBudgetStatus\([\s\S]*?budget\.lock_version/);
  });

  test("explica en castellano que un presupuesto antiguo debe guardarse antes de enviarse", async () => {
    // Mensaje y código reales de change_budget_status, reproducidos contra
    // PostgreSQL 17 con un presupuesto en pendiente y sin versión documental.
    const raised = { code: "22023", message: "Finalize the budget before changing its status" };
    const f = fake({ data: null, error: raised });
    try {
      await changeBudgetStatus(f.client, result.budget_id, 1, "enviado");
      assert.fail("debería rechazar");
    } catch (error) {
      const shown = budgetRevisionErrorMessage(error);
      assert.doesNotMatch(shown, /Finalize|status/i, "no debe filtrarse el mensaje en inglés");
      // La salida comprobada en el banco: guardar una vez crea la versión.
      assert.match(shown, /guárdalo una vez/);
      assert.match(shown, /enviado/);
    }
  });

  test("traduce el resto de rechazos que la interfaz puede provocar", async () => {
    const cases = [
      ["Invalid budget status transition", /no es posible desde el estado actual/],
      ["Use the contractual revision flow for this budget", /no puede editarse como un borrador/],
      ["A contractual budget with positive total requires items", /sin partidas/],
      ["Account deletion in progress", /borrado de cuenta/],
      ["Budget is not available", /ya no está disponible/],
    ];
    for (const [message, expected] of cases) {
      const f = fake({ data: null, error: { code: "22023", message } });
      try {
        await changeBudgetStatus(f.client, result.budget_id, 1, "enviado");
        assert.fail("debería rechazar");
      } catch (error) {
        assert.match(budgetRevisionErrorMessage(error), expected);
      }
    }
  });

  test("un mensaje desconocido se muestra tal cual, sin inventar una causa", async () => {
    const f = fake({ data: null, error: { code: "XX000", message: "algo inesperado" } });
    try {
      await changeBudgetStatus(f.client, result.budget_id, 1, "enviado");
      assert.fail("debería rechazar");
    } catch (error) {
      assert.match(budgetRevisionErrorMessage(error), /algo inesperado/);
    }
  });

  test("se niega a vaciar las partidas de un presupuesto sin permiso explícito", async () => {
    // save_budget/finalize_budget reemplazan el conjunto entero: un array vacío
    // borra todas las líneas. Sin la afirmación de que ese vacío es del usuario,
    // no se envía siquiera la petición.
    for (const [write, label] of [[saveBudgetRevision, "guardar"], [finalizeBudgetRevision, "finalizar"]]) {
      const f = fake();
      await assert.rejects(
        () => write(f.client, result.budget_id, 1, { title: "X" }, []),
        /no se han cargado las partidas|no se vacía/,
        `${label} debería rechazar el conjunto vacío`,
      );
      assert.deepEqual(f.calls, [], `${label} no debe llegar a la base de datos`);
    }
  });

  test("permite vaciarlas cuando la hidratación confirma que el vacío es del usuario", async () => {
    for (const write of [saveBudgetRevision, finalizeBudgetRevision]) {
      const f = fake({ data: { ...result, items_count: 0 }, error: null });
      await write(f.client, result.budget_id, 1, { title: "X" }, [], { allowEmptyItems: true });
      assert.equal(f.calls.length, 1);
      assert.deepEqual(f.calls[0].params.p_items, []);
    }
  });

  test("un conjunto con partidas no necesita permiso alguno", async () => {
    const f = fake();
    await saveBudgetRevision(f.client, result.budget_id, 1, { title: "X" }, [{ concept: "x" }]);
    assert.equal(f.calls.length, 1);
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
      () => saveBudgetRevision(f.client, result.budget_id, 1, { title: "B" }, [{ concept: "x" }, { concept: "y" }]),
      /número de partidas confirmadas no coincide/,
    );
  });
});
