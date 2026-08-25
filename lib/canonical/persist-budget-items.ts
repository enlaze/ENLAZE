/**
 * persist-budget-items.ts — El paso "sincronizar `budget_items`" de `saveDraft`,
 * con el enriquecimiento canónico dentro (FASE 2D-4).
 *
 * QUÉ HACE:
 *   filas económicas ya definitivas, con la procedencia sellada
 *     → firma económica
 *     → si no cambió: SALIR sin tocar nada, sin auth y sin snapshot
 *     → si cambió: clasificar → cuadrar → DELETE + INSERT
 *
 * POR QUÉ ESTÁ AQUÍ Y NO DENTRO DEL PROVIDER:
 *   el orden de esos pasos ES el comportamiento. Que la firma se compare ANTES de
 *   cargar el vocabulario no es un detalle de implementación: es la diferencia entre
 *   un autoguardado que no cambió nada y cuesta cero, y uno que cuesta tres consultas
 *   cada vez que el usuario deja de teclear. Dentro de un componente de React eso sólo
 *   podría comprobarse leyendo el código fuente. Aquí se le inyectan un cliente falso
 *   y un cargador espía y se cuenta lo que de verdad ocurre.
 *
 * QUÉ NO HACE:
 *   no calcula importes, no decide qué partidas entran (eso lo filtra el provider, que
 *   es quien sabe qué es "opcional"), no escribe en `budgets` y no toca el estado de
 *   React. La clasificación es una transformación de PERSISTENCIA: su resultado va a la
 *   tabla y no vuelve nunca a `state.partidas`.
 */

import {
  CANONICAL_COLUMN_KEYS,
  type CanonicalColumns,
  type ClassifiableLine,
} from "./classify-budget-items";
import {
  enrichForPersistence,
  type CanonicalPersistenceContext,
  type CanonicalWiringReport,
  type LineClassifier,
  type ResolvedTenant,
  type SnapshotLoader,
} from "./finalize-classification";
import type { MinimalSupabaseClient } from "./registry";
import type { ResolutionOrigin } from "../types/canonical";

// ─── La firma ─────────────────────────────────────────────────────────────────

/**
 * Las CINCO columnas que el clasificador DERIVA. No las aporta el usuario ni el
 * asistente: se calculan a partir de la propia fila cada vez que se persiste.
 *
 * `canonical_origin` y `canonical_source_ref` NO están en esta lista, y ésa es la
 * decisión central de la revisión de 2D-4. Ver `persistenceSignature`.
 */
const DERIVED_COLUMN_KEYS = [
  "canonical_id",
  "canonical_status",
  "canonical_confidence",
  "canonical_source",
  "price_type",
] as const;

const DERIVED_KEY_SET: ReadonlySet<string> = new Set<string>(DERIVED_COLUMN_KEYS);

// Si alguna vez se añade una octava columna canónica, hay que decidir a conciencia si
// es DERIVADA (fuera de la firma) o APORTADA (dentro). Esta comprobación obliga a esa
// decisión en vez de dejar que la columna nueva se cuele por omisión.
const CANONICAL_KEY_SET: ReadonlySet<string> = new Set<string>(CANONICAL_COLUMN_KEYS);
for (const key of DERIVED_COLUMN_KEYS) {
  if (!CANONICAL_KEY_SET.has(key)) {
    throw new Error(`persist-budget-items: '${key}' ya no es una columna canónica`);
  }
}

/**
 * Huella de todo lo que el ESTADO aporta a la fila persistida. Reescribir filas
 * idénticas es la operación más cara en disco de todo el asistente (un DELETE + INSERT
 * completo genera tuplas muertas y WAL), así que se salta entera cuando nada cambió.
 *
 * LA REGLA ES: la firma cubre lo que el estado APORTA a la fila; excluye lo que el
 * clasificador DERIVA de ella.
 *
 * Fuera quedan las cinco derivadas. Si entrasen, el sistema canónico podría provocar
 * escrituras por su cuenta —clasificar, ver que el resultado cambió respecto a lo
 * guardado, volver a guardar, reclasificar— que es exactamente el bucle que la firma
 * existe para impedir.
 *
 * Dentro quedan `canonical_origin` y `canonical_source_ref`, que en la primera versión
 * de 2D-4 estaban fuera. El motivo del cambio: desde 2D-4 la procedencia es una columna
 * PERSISTIDA que aporta el estado, y no es inmutable —hay proyecciones del asistente
 * que la pierden y `updatePartida` acepta sobrescribirla—. Una columna persistida,
 * mutable y fuera de la firma es una columna que puede quedarse desincronizada PARA
 * SIEMPRE: cambia sola, la firma no se entera, la salida temprana impide el UPDATE y la
 * tabla conserva el valor viejo sin que nada lo señale. La corrección de la persistencia
 * pesa más que conservar la firma byte a byte idéntica a la de antes de esta fase.
 *
 * Y no reintroduce el bucle, porque el resultado del clasificador nunca vuelve a
 * `state.partidas`: la procedencia sólo cambia cuando la cambia el asistente, no cuando
 * se clasifica. Tampoco añade autoguardados nuevos, porque `state.partidas` —y con él la
 * procedencia— ya formaba parte de `autosaveSignature` desde antes.
 *
 * Incluye `budgetId` porque dos borradores pueden contener legítimamente filas
 * idénticas y cada uno necesita las suyas.
 */
export function persistenceSignature(
  budgetId: string,
  rows: readonly Record<string, unknown>[]
): string {
  const aportado = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (DERIVED_KEY_SET.has(k)) continue;
      out[k] = v;
    }
    return out;
  });
  return `${budgetId}:${JSON.stringify(aportado)}`;
}

// ─── El cliente que hace falta para escribir ──────────────────────────────────

/**
 * Sólo el encadenado que este módulo usa. Igual que `MinimalSupabaseClient` en la capa
 * de lectura: describir lo que se necesita permite pasar un doble en los tests sin
 * arrastrar la superficie entera de supabase-js.
 */
export interface BudgetItemsWriter {
  from: (table: string) => {
    delete: () => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
    insert: (rows: readonly unknown[]) => Promise<{ error: unknown }>;
  };
}

// ─── La sincronización ────────────────────────────────────────────────────────

export interface SyncBudgetItemsOptions<T extends ClassifiableLine> {
  budgetId: string;
  /** Filas económicas definitivas CON la procedencia ya sellada. */
  items: readonly T[];
  /** La firma del último volcado que sí llegó a escribirse. `null` la primera vez. */
  previousSignature: string | null;
  tenant: ResolvedTenant;
  /**
   * El mismo cliente para leer el vocabulario y para escribir las filas.
   *
   * Se declara con el tipo de LECTURA porque es el que la capa canónica modela de
   * verdad; el de escritura se afirma abajo con `as`. Intersectar los dos no serviría:
   * TypeScript resolvería `from()` con la primera firma y el `delete()` volvería a no
   * existir. Es el mismo tratamiento que el provider da a `MinimalSupabaseClient`.
   */
  supabase: MinimalSupabaseClient;
  context: CanonicalPersistenceContext;
  /**
   * Puerta de cuadre, aplicada a las filas YA clasificadas y justo antes del INSERT.
   * Se inyecta porque el subtotal que hay que respetar lo conoce el provider, no este
   * módulo. Es la única cosa aquí dentro que puede —y debe— impedir una escritura.
   */
  verifyTotals: (rows: (T & CanonicalColumns)[]) => void;
  defaultOrigin?: ResolutionOrigin;
  log?: (report: CanonicalWiringReport, context: CanonicalPersistenceContext) => void;
  loadSnapshot?: SnapshotLoader;
  classify?: LineClassifier;
}

export interface SyncBudgetItemsResult {
  /** La firma de estas filas. El llamante debe recordarla SÓLO si se escribió. */
  signature: string;
  /** `true` si no había nada que hacer. Entonces no hubo snapshot, ni DELETE, ni INSERT. */
  skipped: boolean;
  /** El informe de la clasificación, o `null` si no se llegó a clasificar. */
  report: CanonicalWiringReport | null;
}

/**
 * Sincroniza `budget_items` con las filas dadas, clasificándolas por el camino.
 *
 * EL ORDEN IMPORTA Y ES ÉSTE:
 *
 *   1. firma       ← barata, en memoria, sin red
 *   2. ¿cambió?    ← si no, se sale aquí: cero consultas, cero escrituras
 *   3. clasificar  ← una carga de vocabulario, todo lo demás en memoria
 *   4. cuadrar     ← sobre las filas que realmente se van a escribir
 *   5. DELETE      ← y sólo entonces
 *   6. INSERT
 *
 * El paso 2 va antes del 3 a propósito. Al revés, un usuario que mueve el cursor por
 * el asistente sin cambiar nada pagaría el vocabulario entero para acabar descubriendo
 * que no había que guardar. Con este orden, un autoguardado sin cambios económicos
 * cuesta exactamente cero consultas.
 *
 * FAIL-OPEN, idéntico a 2D-3: `enrichForPersistence` no lanza. Si el snapshot se
 * avería, si el clasificador lanza o si devuelve algo que ya no es lo que recibió, las
 * filas salen ORIGINALES y `unmatched` conservando su procedencia, y el borrador se
 * guarda igual. Lo único que puede detener la escritura es `verifyTotals`, es decir, un
 * descuadre económico de verdad.
 */
export async function syncClassifiedBudgetItems<T extends ClassifiableLine>(
  options: SyncBudgetItemsOptions<T>
): Promise<SyncBudgetItemsResult> {
  const signature = persistenceSignature(
    options.budgetId,
    options.items as readonly Record<string, unknown>[]
  );

  if (signature === options.previousSignature) {
    return { signature, skipped: true, report: null };
  }

  const { items: classified, report } = await enrichForPersistence({
    items: options.items,
    tenant: options.tenant,
    supabase: options.supabase,
    context: options.context,
    defaultOrigin: options.defaultOrigin,
    log: options.log,
    loadSnapshot: options.loadSnapshot,
    classify: options.classify,
  });

  // Última barrera antes de tocar la tabla. Si lanza, no se borra ni se escribe nada:
  // un descuadre deja el borrador anterior intacto en vez de dejarlo a medias.
  options.verifyTotals(classified);

  const writer = options.supabase as unknown as BudgetItemsWriter;

  // El error del DELETE se COMPRUEBA. Antes de esta revisión no se comprobaba —ni aquí
  // ni en el código pre-2D-4 del que salió—, y era un defecto con dos consecuencias:
  // se seguía adelante hasta el INSERT sobre una tabla que no se había vaciado, es
  // decir, se DUPLICABAN las filas del presupuesto; y la firma avanzaba, con lo que el
  // siguiente autoguardado del mismo contenido salía temprano y la duplicación quedaba
  // congelada hasta que el usuario tocase un importe.
  //
  // supabase-js no lanza en estos casos: resuelve con `{ error }`. Por eso hay que
  // mirarlo explícitamente.
  const { error: deleteError } = await writer
    .from("budget_items")
    .delete()
    .eq("budget_id", options.budgetId);
  if (deleteError) throw deleteError;

  if (classified.length > 0) {
    const { error } = await writer.from("budget_items").insert(classified);
    if (error) throw error;
  }

  // Se devuelve la firma sólo cuando se ha llegado hasta aquí. Cualquier lanzamiento de
  // arriba deja al llamante sin firma nueva que recordar, y por tanto el siguiente
  // intento con el mismo contenido vuelve a sincronizar en vez de salir temprano. Es lo
  // que hace que un fallo de escritura se REINTENTE en lugar de perderse en silencio.
  return { signature, skipped: false, report };
}
