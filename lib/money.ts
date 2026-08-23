/**
 * Aritmética monetaria segura.
 *
 * Todo el dinero de un presupuesto se calcula en céntimos enteros y solo se
 * convierte a euros en el último paso, justo antes de mostrarlo o guardarlo.
 *
 * Motivo: con coma flotante, `0.1 + 0.2 !== 0.3` y `165 * 9.5 * 100` puede dar
 * 156750.00000000003. Eso hace imposible exigir que la suma de las líneas sea
 * *exactamente* igual al subtotal, que es precisamente la invariante que el
 * presupuesto necesita garantizar. Con enteros la igualdad es estricta y el
 * assert de cuadre no necesita épsilon.
 *
 * Convención de redondeo: mitad hacia arriba en valor absoluto
 * (0.005 -> 0.01, -0.005 -> -0.01), que es la práctica habitual en facturación
 * española.
 */

/** Redondeo a entero, mitad alejándose de cero. */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convierte euros a céntimos enteros. */
export function toCents(euros: unknown): number {
  const n = Number(euros);
  if (!Number.isFinite(n)) return 0;
  // El doble redondeo absorbe el ruido de representación: (0.1*100) es
  // 10.000000000000002, y (1.005*100) es 100.49999999999999.
  return roundHalfAwayFromZero(Number((n * 100).toFixed(4)));
}

/** Convierte céntimos enteros a euros. */
export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return roundHalfAwayFromZero(cents) / 100;
}

/**
 * Importe de una línea, en céntimos.
 *
 * La cantidad puede ser fraccionaria (m², horas), el precio unitario se
 * normaliza antes a céntimos para no encadenar dos multiplicaciones sucias.
 */
export function lineTotalCents(quantity: unknown, unitPrice: unknown): number {
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) return 0;
  const unitCents = toCents(unitPrice);
  return roundHalfAwayFromZero(Number((qty * unitCents).toFixed(4)));
}

/** Suma de céntimos. Exacta mientras se mantenga dentro de Number.MAX_SAFE_INTEGER. */
export function sumCents(values: number[]): number {
  let acc = 0;
  for (const v of values) acc += roundHalfAwayFromZero(Number(v) || 0);
  return acc;
}

/** Porcentaje de un importe en céntimos (IVA, descuento, margen). */
export function percentOfCents(cents: number, percent: unknown): number {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct === 0) return 0;
  return roundHalfAwayFromZero(Number(((cents * pct) / 100).toFixed(4)));
}

/** Acota un porcentaje al rango [0, 100]. */
export function clampPercent(percent: unknown): number {
  const pct = Number(percent);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** Formatea céntimos como importe en euros para mostrar. */
export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(fromCents(cents));
}
