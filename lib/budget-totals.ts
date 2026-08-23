/**
 * Única fuente matemática de verdad de un presupuesto.
 *
 * Antes de este módulo había cuatro totales distintos circulando por la
 * aplicación (la fila `budgets`, la suma de `budget_items`, `clientView.total`
 * y `internalView.totals`), cada uno calculado en su propio sitio. El PDF
 * imprimía las líneas de una fuente y la caja de totales de otra, por lo que
 * los importes visibles no podían sumar la base imponible.
 *
 * A partir de aquí, cualquier consumidor que necesite subtotal, descuento,
 * base imponible, IVA o total debe pedírselos a este módulo. No se recalcula
 * dinero en ningún otro lugar.
 *
 * Cadena de cálculo:
 *   lineTotal   = quantity * unitPrice
 *   subtotal    = SUM(lineTotals)
 *   descuento   = porcentaje sobre subtotal | importe fijo
 *   taxBase     = subtotal - descuento
 *   IVA         = taxBase * tipo
 *   total       = taxBase + IVA
 *
 * Todo en céntimos enteros (ver lib/money.ts) para que el cuadre pueda
 * exigirse con igualdad estricta.
 */

import {
  toCents,
  fromCents,
  sumCents,
  lineTotalCents,
  percentOfCents,
  clampPercent,
} from "./money";

/**
 * Versión del contrato de totales.
 *
 * Los presupuestos creados a partir de la Fase 1 llevan esta marca en
 * `wizard_state.totals_contract`. Significa: «budget_items contiene solo
 * partidas; los materiales son evidencia del escandallo y ya están dentro del
 * precio de la partida, no son líneas económicas independientes».
 *
 * Los presupuestos anteriores no la llevan y guardaron materiales como líneas
 * adicionales, por lo que su suma de líneas no cuadra con `budgets.subtotal`.
 * Ese descuadre es conocido y no debe bloquearlos: se avisa, no se rompe.
 */
export const TOTALS_CONTRACT_VERSION = "v2-partidas-only";

export interface BudgetTotalsLine {
  quantity: number;
  unit_price: number;
}

export interface BudgetTotalsInput {
  lines: BudgetTotalsLine[];
  ivaPercent?: number;
  discountType?: "percent" | "amount";
  discountPercent?: number;
  discountAmount?: number;
}

export interface BudgetTotals {
  /**
   * Importes en euros, listos para mostrar o persistir.
   *
   * IMPORTANTE: son una proyección para mostrar, no operandos aritméticos.
   * Sumarlos con coma flotante reintroduce el error que este módulo elimina
   * (por ejemplo 666.67 + 140 da 806.6700000000001). Para operar con ellos,
   * usa `cents`, o convierte antes con `toCents`.
   */
  subtotal: number;
  discountValue: number;
  taxableBase: number;
  ivaAmount: number;
  total: number;
  /** Importe de cada línea, en el mismo orden que la entrada. */
  lineTotals: number[];
  /** Los mismos valores en céntimos enteros, para comparaciones exactas. */
  cents: {
    subtotal: number;
    discountValue: number;
    taxableBase: number;
    ivaAmount: number;
    total: number;
    lineTotals: number[];
  };
}

/** Error de cuadre. Bloquea guardado, finalización y generación de PDF. */
export class BudgetTotalMismatchError extends Error {
  readonly code = "BUDGET_TOTAL_MISMATCH";
  readonly expectedCents: number;
  readonly actualCents: number;
  readonly deltaCents: number;

  constructor(expectedCents: number, actualCents: number, context?: string) {
    const delta = actualCents - expectedCents;
    super(
      `BUDGET_TOTAL_MISMATCH: la suma de las lineas (${fromCents(actualCents).toFixed(2)} EUR) ` +
        `no coincide con el subtotal mostrado (${fromCents(expectedCents).toFixed(2)} EUR). ` +
        `Desviacion: ${fromCents(delta).toFixed(2)} EUR.` +
        (context ? ` Contexto: ${context}.` : ""),
    );
    this.name = "BudgetTotalMismatchError";
    this.expectedCents = expectedCents;
    this.actualCents = actualCents;
    this.deltaCents = delta;
  }
}

/** Calcula todos los importes a partir de las líneas. */
export function computeBudgetTotals(input: BudgetTotalsInput): BudgetTotals {
  const lineTotalsCents = (input.lines || []).map((l) => lineTotalCents(l?.quantity, l?.unit_price));
  const subtotalCents = Math.max(0, sumCents(lineTotalsCents));
  return finalize(subtotalCents, lineTotalsCents, input);
}

/**
 * Igual que `computeBudgetTotals` pero partiendo de un subtotal ya agregado.
 *
 * Existe para los consumidores que aún trabajan con un subtotal acumulado en
 * el estado del wizard en vez de con la lista de líneas. El resultado es
 * idéntico; lo que se pierde es la capacidad de verificar el cuadre, así que
 * quien la use debe además llamar a `assertBudgetTotalsConsistent`.
 */
export function computeBudgetTotalsFromSubtotal(
  subtotal: number,
  ivaPercent: number,
  discountType: "percent" | "amount" = "percent",
  discountPercent = 0,
  discountAmount = 0,
): BudgetTotals {
  const subtotalCents = Math.max(0, toCents(subtotal));
  return finalize(subtotalCents, [subtotalCents], {
    lines: [],
    ivaPercent,
    discountType,
    discountPercent,
    discountAmount,
  });
}

function finalize(
  subtotalCents: number,
  lineTotalsCents: number[],
  input: Omit<BudgetTotalsInput, "lines"> & { lines?: BudgetTotalsLine[] },
): BudgetTotals {
  const discountCents =
    input.discountType === "amount"
      ? Math.min(subtotalCents, Math.max(0, toCents(input.discountAmount)))
      : percentOfCents(subtotalCents, clampPercent(input.discountPercent));

  const taxableBaseCents = Math.max(0, subtotalCents - discountCents);
  const ivaCents = percentOfCents(taxableBaseCents, Math.max(0, Number(input.ivaPercent) || 0));
  const totalCents = taxableBaseCents + ivaCents;

  return {
    subtotal: fromCents(subtotalCents),
    discountValue: fromCents(discountCents),
    taxableBase: fromCents(taxableBaseCents),
    ivaAmount: fromCents(ivaCents),
    total: fromCents(totalCents),
    lineTotals: lineTotalsCents.map(fromCents),
    cents: {
      subtotal: subtotalCents,
      discountValue: discountCents,
      taxableBase: taxableBaseCents,
      ivaAmount: ivaCents,
      total: totalCents,
      lineTotals: lineTotalsCents,
    },
  };
}

export interface ConsistencyReport {
  ok: boolean;
  expectedCents: number;
  actualCents: number;
  deltaCents: number;
  deltaEuros: number;
}

/** Comprueba el cuadre sin lanzar. Útil para avisar sin bloquear. */
export function checkBudgetTotalsConsistency(
  displayedSubtotal: number,
  computed: BudgetTotals,
): ConsistencyReport {
  const expectedCents = toCents(displayedSubtotal);
  const actualCents = computed.cents.subtotal;
  const deltaCents = actualCents - expectedCents;
  return {
    ok: deltaCents === 0,
    expectedCents,
    actualCents,
    deltaCents,
    deltaEuros: fromCents(deltaCents),
  };
}

/**
 * Exige el cuadre. Lanza `BudgetTotalMismatchError` si la suma de las líneas
 * no es exactamente igual al subtotal mostrado.
 *
 * Se llama antes de guardar, antes de finalizar y antes de generar el PDF.
 */
export function assertBudgetTotalsConsistent(
  displayedSubtotal: number,
  computed: BudgetTotals,
  context?: string,
): void {
  const report = checkBudgetTotalsConsistency(displayedSubtotal, computed);
  if (!report.ok) {
    throw new BudgetTotalMismatchError(report.expectedCents, report.actualCents, context);
  }
}

/** ¿Este presupuesto se creó bajo el contrato de totales actual? */
export function hasCurrentTotalsContract(wizardState: unknown): boolean {
  if (!wizardState || typeof wizardState !== "object") return false;
  const contract = (wizardState as Record<string, unknown>).totals_contract;
  return contract === TOTALS_CONTRACT_VERSION;
}
