/**
 * Formato único de importes en la app: «2.819,30 €».
 *
 * Ojo: en es-ES, Intl no agrupa los miles de un número de 4 cifras salvo que
 * se le pida (sale «2819,30 €»), ni siquiera con style: "currency". Por eso
 * useGrouping: true (= "always").
 */

const AMOUNT = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

type Amount = number | string | null | undefined;

function toNumber(n: Amount): number {
  const value = Number(n ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** «2.819,30» — sin símbolo, para tablas que ya ponen «€» aparte. */
export function formatAmount(n: Amount): string {
  return AMOUNT.format(toNumber(n));
}

/** «2.819,30 €» */
export function formatEur(n: Amount): string {
  return `${formatAmount(n)} €`;
}

const COMPACT = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });

/** «2,8 mil €» — solo para etiquetas pequeñas de gráficos. */
export function formatEurCompact(n: Amount): string {
  return `${COMPACT.format(toNumber(n))} €`;
}
