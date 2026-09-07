// FASE 2F-1APP · BLOQUE A — banco ejecutable de `replaceBudgetItems`.
//
// Este es el único fichero del proyecto que ejecuta de verdad el escritor. El
// resto de la fase solo puede inspeccionar texto, porque el Provider es un
// componente de React y no hay jsdom en el proyecto. Por eso la lógica que
// decide si un guardado ha ido bien vive en un módulo aparte: para poder
// probarla con clientes falsos, sin base de datos y sin navegador.
//
// Lo que se protege aquí es que el helper no "arregle" nada por su cuenta. No
// normaliza filas, no inventa conceptos, no descarta líneas y no convierte un
// fallo en un valor de retorno benigno.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  replaceBudgetItems,
  REPLACE_BUDGET_ITEMS_RPC,
} from "../lib/budget-items-writer.ts";

const PRESUPUESTO = "11111111-2222-3333-4444-555555555555";

/**
 * Cliente falso: registra cada invocación y devuelve la respuesta indicada.
 * No imita PostgREST más allá de lo que el helper lee, a propósito: si el
 * helper empezase a depender de algo más, este banco dejaría de compilar
 * mentalmente y habría que revisarlo.
 */
function clienteFalso(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    rpc(fn, params) {
      llamadas.push({ fn, params });
      return Promise.resolve(respuesta);
    },
  };
}

function filasDeEjemplo() {
  return [
    {
      budget_id: PRESUPUESTO,
      concept: "Demolición de alicatado",
      description: "Incluye retirada de escombros",
      quantity: 12.5,
      unit: "m2",
      category: "mano_obra",
      chapter: "Demoliciones",
      unit_price: 18.4,
      subtotal: 230,
      sort_order: 0,
    },
    {
      budget_id: PRESUPUESTO,
      concept: "Azulejo porcelánico 60x60",
      description: "Material sugerido",
      quantity: 14,
      unit: "m2",
      category: "material",
      chapter: "materiales",
      unit_price: 21.78,
      subtotal: 304.92,
      sort_order: 1,
    },
  ];
}

describe("FASE 2F-1APP · BLOQUE A — contrato ejecutable de replaceBudgetItems", () => {
  test("invoca una sola vez la RPC, con su nombre y sus dos argumentos exactos", async () => {
    const filas = filasDeEjemplo();
    const cliente = clienteFalso({ data: filas.length, error: null });

    await replaceBudgetItems(cliente, PRESUPUESTO, filas);

    assert.equal(cliente.llamadas.length, 1, "el helper debe invocar la RPC exactamente una vez");
    assert.equal(cliente.llamadas[0].fn, "replace_budget_items");
    assert.equal(REPLACE_BUDGET_ITEMS_RPC, "replace_budget_items");
    assert.deepEqual(
      Object.keys(cliente.llamadas[0].params).sort(),
      ["p_budget_id", "p_items"],
      "no debe enviar ningún argumento además de p_budget_id y p_items",
    );
    assert.equal(cliente.llamadas[0].params.p_budget_id, PRESUPUESTO);
  });

  test("transmite las filas sin mutarlas ni normalizarlas", async () => {
    const filas = filasDeEjemplo();
    const copiaProfunda = JSON.parse(JSON.stringify(filas));
    const cliente = clienteFalso({ data: filas.length, error: null });

    await replaceBudgetItems(cliente, PRESUPUESTO, filas);

    const enviadas = cliente.llamadas[0].params.p_items;
    assert.equal(enviadas, filas, "debe enviar el mismo array, sin copiarlo ni reordenarlo");
    assert.deepEqual(filas, copiaProfunda, "no debe modificar las filas del llamante");
    assert.deepEqual(enviadas, copiaProfunda);
    assert.equal(enviadas[0].sort_order, 0, "no debe recalcular sort_order");
    assert.equal(enviadas[1].budget_id, PRESUPUESTO, "no debe eliminar budget_id");
  });

  test("no inventa conceptos ni descarta líneas inválidas: eso lo decide la RPC", async () => {
    // Una línea con el concepto vacío es exactamente lo que la interfaz permite
    // teclear. El helper debe enviarla tal cual y dejar que la base de datos la
    // rechace, no colar un "Partida sin concepto" ni filtrarla en silencio.
    const filas = [
      { concept: "", quantity: 1, unit_price: 0 },
      { concept: "   ", quantity: 2, unit_price: 5 },
    ];
    const cliente = clienteFalso({ data: 2, error: null });

    await replaceBudgetItems(cliente, PRESUPUESTO, filas);

    const enviadas = cliente.llamadas[0].params.p_items;
    assert.equal(enviadas.length, 2, "no debe descartar ninguna línea");
    assert.equal(enviadas[0].concept, "");
    assert.equal(enviadas[1].concept, "   ");
  });

  test("lanza cuando Supabase devuelve error, y conserva su mensaje", async () => {
    const cliente = clienteFalso({
      data: null,
      // SQLSTATE real de esta rama en la migración (línea 197-199): el rechazo
      // de un elemento inválido es 22023. El 22004 pertenece a otro fallo —los
      // argumentos ausentes, `p_budget_id` o `p_items` a NULL— y usarlo aquí
      // describía una base de datos que no existe.
      error: { message: "replace_budget_items: el elemento 0 no tiene concept", code: "22023" },
    });

    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
      (err) => {
        assert.ok(err instanceof Error, "debe lanzar un Error, no el objeto crudo");
        assert.match(err.message, /el elemento 0 no tiene concept/);
        assert.equal(err.cause?.code, "22023", "el código original debe seguir disponible en cause");
        return true;
      },
    );
  });

  test("lanza cuando el resultado es nulo o está ausente", async () => {
    for (const respuesta of [{ data: null, error: null }, { error: null }]) {
      const cliente = clienteFalso(respuesta);
      await assert.rejects(
        () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
        /no devolvió ningún recuento/,
      );
    }
  });

  test("lanza cuando el resultado es una cadena", async () => {
    // PostgREST podría devolver "2" en lugar de 2 si el tipo de retorno cambiase.
    // Un recuento que no es un número no confirma nada.
    const cliente = clienteFalso({ data: "2", error: null });
    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
      /recuento no entero/,
    );
  });

  test("lanza cuando el resultado es decimal", async () => {
    const cliente = clienteFalso({ data: 1.5, error: null });
    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
      /recuento no entero/,
    );
  });

  test("lanza cuando el recuento no coincide con las filas enviadas", async () => {
    const filas = filasDeEjemplo();
    const cliente = clienteFalso({ data: 1, error: null });

    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filas),
      (err) => {
        assert.match(err.message, /confirmó 1 líneas y se enviaron 2/);
        return true;
      },
    );
  });

  test("devuelve el recuento cuando coincide exactamente", async () => {
    const filas = filasDeEjemplo();
    const cliente = clienteFalso({ data: filas.length, error: null });

    const n = await replaceBudgetItems(cliente, PRESUPUESTO, filas);

    assert.equal(n, 2);
  });

  test("acepta el array vacío cuando la RPC devuelve cero", async () => {
    // Vaciar las líneas es una operación legítima: un presupuesto cuyas partidas
    // son todas opcionales debe quedarse sin líneas, no conservar las anteriores.
    const cliente = clienteFalso({ data: 0, error: null });

    const n = await replaceBudgetItems(cliente, PRESUPUESTO, []);

    assert.equal(n, 0);
    assert.equal(cliente.llamadas.length, 1, "el conjunto vacío no exime de llamar a la RPC");
    assert.deepEqual(cliente.llamadas[0].params.p_items, []);
  });

  test("un cero devuelto para un conjunto no vacío sigue siendo un fallo", async () => {
    const cliente = clienteFalso({ data: 0, error: null });
    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
      /confirmó 0 líneas y se enviaron 2/,
    );
  });

  test("no captura sus propios errores: un fallo de red se propaga intacto", async () => {
    const fallo = new Error("network down");
    const cliente = {
      rpc() {
        return Promise.reject(fallo);
      },
    };

    await assert.rejects(
      () => replaceBudgetItems(cliente, PRESUPUESTO, filasDeEjemplo()),
      (err) => {
        assert.equal(err, fallo, "debe propagar el mismo error, sin envolverlo");
        return true;
      },
    );
  });
});
