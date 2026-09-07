// FASE 2F-1APP — único punto de la aplicación que nombra `replace_budget_items`.
//
// La RPC sustituye de forma atómica el conjunto completo de líneas de un
// presupuesto: valida, borra e inserta dentro de una sola transacción con la
// cabecera bloqueada. El par DELETE + INSERT que este helper reemplaza podía
// quedarse a medias y dejar el presupuesto sin partidas.
//
// Este módulo no contiene lógica de dominio y no debe adquirirla. En concreto
// no normaliza filas, no inventa conceptos para las líneas sin `concept`, no
// descarta líneas inválidas y no toca cantidades, precios, subtotales,
// categorías, capítulos, datos canónicos, `budget_id` ni `sort_order`. La RPC
// es la autoridad sobre qué es válido; el helper solo transporta y verifica.
//
// Tampoco captura sus propios errores: cualquier fallo se propaga al llamante,
// que es quien decide si mostrarlo, reintentarlo o abortar el flujo. Convertir
// aquí un fallo en un valor de retorno benigno es exactamente el defecto que
// esta fase corrige.

/**
 * Una fila del payload, tal y como la construye el generador. Deliberadamente
 * opaca: el helper no interpreta ninguna clave.
 */
export type BudgetItemRow = Record<string, unknown>;

/** Forma mínima de la respuesta de PostgREST que el helper necesita leer. */
export interface BudgetItemsRpcResponse {
  data: unknown;
  error: unknown;
}

/**
 * Estructura mínima del cliente. La cumplen tanto el cliente real de
 * `@supabase/ssr` como los clientes falsos de los tests, sin que ninguno de
 * los dos tenga que conocer al otro ni obligarnos a importar tipos de
 * Supabase en el banco de pruebas.
 */
export interface BudgetItemsRpcClient {
  rpc(
    fn: string,
    params: { p_budget_id: string; p_items: readonly BudgetItemRow[] },
  ): PromiseLike<BudgetItemsRpcResponse>;
}

/** Nombre exacto de la función en la base de datos. */
export const REPLACE_BUDGET_ITEMS_RPC = "replace_budget_items";

function comoError(valor: unknown, prefijo: string): Error {
  if (valor instanceof Error) return valor;
  const mensaje =
    typeof valor === "object" && valor !== null && typeof (valor as { message?: unknown }).message === "string"
      ? (valor as { message: string }).message
      : String(valor);
  const error = new Error(`${prefijo}: ${mensaje}`);
  (error as Error & { cause?: unknown }).cause = valor;
  return error;
}

/**
 * Sustituye atómicamente todas las líneas de un presupuesto.
 *
 * Envía las filas tal cual llegan y devuelve el número de líneas confirmado
 * por la base de datos. Lanza si la RPC devuelve error o si el recuento
 * devuelto no coincide exactamente con el enviado: un recuento distinto
 * significa que lo persistido no es lo que el asistente cree haber guardado, y
 * el llamante no debe poder confundir eso con un éxito.
 *
 * `items` vacío es una operación legítima: vacía las líneas del presupuesto y
 * la RPC devuelve `0`.
 */
export async function replaceBudgetItems(
  supabase: BudgetItemsRpcClient,
  budgetId: string,
  items: readonly BudgetItemRow[],
): Promise<number> {
  const { data, error } = await supabase.rpc(REPLACE_BUDGET_ITEMS_RPC, {
    p_budget_id: budgetId,
    p_items: items,
  });

  if (error) {
    throw comoError(error, "No se pudieron guardar las partidas");
  }

  if (data === null || data === undefined) {
    throw new Error(
      "No se pudieron guardar las partidas: replace_budget_items no devolvió ningún recuento",
    );
  }

  if (typeof data !== "number" || !Number.isInteger(data)) {
    throw new Error(
      `No se pudieron guardar las partidas: replace_budget_items devolvió un recuento no entero (${JSON.stringify(data)})`,
    );
  }

  if (data !== items.length) {
    throw new Error(
      `No se pudieron guardar las partidas: replace_budget_items confirmó ${data} líneas y se enviaron ${items.length}`,
    );
  }

  return data;
}
