/** Thin client for the atomic budget revision RPCs deployed in FASE 2F-2. */

export type BudgetRevisionPayload = Record<string, unknown>;
export type BudgetRevisionItem = Record<string, unknown>;

export interface BudgetRevisionResult {
  budget_id: string;
  lock_version: number;
  version: number;
  status: string;
  previous_status: string | null;
  items_count: number;
}

interface RpcResponse {
  data: unknown;
  error: unknown;
}

export interface BudgetRevisionRpcClient {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<RpcResponse>;
}

export class BudgetRevisionError extends Error {
  readonly code?: string;
  readonly original: unknown;

  constructor(message: string, original: unknown) {
    super(message);
    this.name = "BudgetRevisionError";
    this.original = original;
    if (typeof original === "object" && original !== null) {
      const code = (original as { code?: unknown }).code;
      if (typeof code === "string") this.code = code;
    }
  }
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(value);
}

function parseResult(data: unknown, operation: string): BudgetRevisionResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${operation}: la base de datos no devolvió un resultado válido`);
  }
  const result = data as Partial<BudgetRevisionResult>;
  if (
    typeof result.budget_id !== "string" ||
    !Number.isInteger(result.lock_version) || Number(result.lock_version) < 1 ||
    !Number.isInteger(result.version) || Number(result.version) < 1 ||
    typeof result.status !== "string" ||
    !Number.isInteger(result.items_count) || Number(result.items_count) < 0
  ) {
    throw new Error(`${operation}: la respuesta de la base de datos está incompleta`);
  }
  return result as BudgetRevisionResult;
}

async function call(
  client: BudgetRevisionRpcClient,
  fn: string,
  params: Record<string, unknown>,
  operation: string,
  expectedItemsCount?: number,
): Promise<BudgetRevisionResult> {
  const { data, error } = await client.rpc(fn, params);
  if (error) throw new BudgetRevisionError(`${operation}: ${errorMessage(error)}`, error);
  const result = parseResult(data, operation);
  if (expectedItemsCount !== undefined && result.items_count !== expectedItemsCount) {
    throw new Error(`${operation}: el número de partidas confirmadas no coincide. Recarga el presupuesto antes de continuar.`);
  }
  return result;
}

export function isBudgetRevisionConflict(error: unknown): boolean {
  if (error instanceof BudgetRevisionError) return error.code === "PT409";
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "PT409";
}

export function budgetRevisionErrorMessage(error: unknown): string {
  if (isBudgetRevisionConflict(error)) {
    return "Este presupuesto ha cambiado en otra pestaña o sesión. Recarga la página antes de volver a guardar.";
  }
  return errorMessage(error);
}

export function createBudgetWithItems(
  client: BudgetRevisionRpcClient,
  budgetData: BudgetRevisionPayload,
  items: readonly BudgetRevisionItem[],
) {
  return call(client, "create_budget_with_items", {
    p_budget_data: budgetData,
    p_items: items,
  }, "No se pudo crear el presupuesto", items.length);
}

export function saveBudgetRevision(
  client: BudgetRevisionRpcClient,
  budgetId: string,
  expectedLockVersion: number,
  budgetData: BudgetRevisionPayload,
  items: readonly BudgetRevisionItem[],
) {
  return call(client, "save_budget", {
    p_budget_id: budgetId,
    p_expected_lock_version: expectedLockVersion,
    p_budget_data: budgetData,
    p_items: items,
  }, "No se pudo guardar el presupuesto", items.length);
}

export function finalizeBudgetRevision(
  client: BudgetRevisionRpcClient,
  budgetId: string,
  expectedLockVersion: number,
  budgetData: BudgetRevisionPayload,
  items: readonly BudgetRevisionItem[],
) {
  return call(client, "finalize_budget", {
    p_budget_id: budgetId,
    p_expected_lock_version: expectedLockVersion,
    p_budget_data: budgetData,
    p_items: items,
  }, "No se pudo finalizar el presupuesto", items.length);
}

export function changeBudgetStatus(
  client: BudgetRevisionRpcClient,
  budgetId: string,
  expectedLockVersion: number,
  status: string,
) {
  return call(client, "change_budget_status", {
    p_budget_id: budgetId,
    p_expected_lock_version: expectedLockVersion,
    p_status: status,
  }, "No se pudo cambiar el estado del presupuesto");
}

export function duplicateBudgetRevision(client: BudgetRevisionRpcClient, budgetId: string) {
  return call(client, "duplicate_budget", {
    p_budget_id: budgetId,
  }, "No se pudo duplicar el presupuesto");
}
