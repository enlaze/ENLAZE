/**
 * finalize-classification.ts — Orquestador del enriquecimiento canónico previo a un
 * INSERT definitivo de `budget_items` (FASE 2D-3).
 *
 * QUÉ HACE, EXACTAMENTE:
 *   líneas económicas ya definitivas
 *     → una (1) carga de snapshot
 *     → clasificación en memoria
 *     → las mismas líneas MÁS las siete columnas canónicas.
 *
 * QUÉ NO HACE, Y NO DEBE EMPEZAR A HACER:
 *   no escribe en base de datos, no calcula ni redondea importes, no reordena, no
 *   filtra, no agrupa y no decide si un presupuesto se puede finalizar. Recibe las
 *   líneas cuando ya nadie va a tocar su dinero y devuelve exactamente esas líneas
 *   con metadatos añadidos. Todo lo económico ocurre antes y sigue ocurriendo fuera.
 *
 * POR QUÉ EXISTE COMO MÓDULO Y NO COMO UN TROZO DEL PROVIDER:
 *   el provider es un componente de React que no puede importarse en un test de
 *   `node:test`. Si la secuencia "cargar snapshot → clasificar → degradar si falla"
 *   viviera dentro de `finalizeBudget`, la única forma de probarla sería buscar
 *   cadenas en el código fuente, que comprueba que algo está ESCRITO pero no que
 *   FUNCIONE. Con las dependencias inyectadas, el fail-open se prueba haciendo que
 *   fallen de verdad. El provider queda como integración fina: reúne los argumentos,
 *   llama aquí una vez y persiste el resultado.
 *
 * EL CONTRATO CENTRAL — EQUIVALENCIA ECONÓMICA:
 *   para toda línea de entrada, la línea de salida conserva TODAS sus claves con su
 *   valor exacto, y sólo pueden añadirse o sobrescribirse las siete de
 *   CANONICAL_COLUMN_KEYS. La longitud y el orden del array son los mismos. Es una
 *   promesa que hereda de `classifyBudgetItems` y que la suite de 2D-3 vuelve a
 *   comprobar aquí, porque quien la rompa lo hará en el sitio donde se cablea, no en
 *   el sitio donde se documenta.
 *
 * FAIL-OPEN:
 *   el sistema canónico OBSERVA. Nunca puede impedir que se finalice un presupuesto.
 *   Si el snapshot no carga, si el clasificador se avería o si el clasificador
 *   devuelve líneas que ya no son las que recibió, cada línea sale `unmatched`
 *   conservando su procedencia y el flujo continúa. Ver `degradeAll`.
 *
 *   El tercer caso es el que obliga a que este módulo compare y no sólo capture: un
 *   clasificador que corrompe importes no lanza ninguna excepción, y dejar que el
 *   destrozo lo descubriese `assertPersistedTotalsMatch` significaría que una avería
 *   de la capa observadora bloquea la finalización. Ver `findEconomicViolation`. La
 *   puerta de cuadre sigue existiendo detrás, pero como último recurso.
 */

import type { ResolutionOrigin } from "../types/canonical";
import {
  CANONICAL_COLUMN_KEYS,
  classifyBudgetItems,
  unmatchedColumnsForLine,
  type CanonicalColumns,
  type ClassifiableLine,
  type ClassifyOptions,
  type ClassifyResult,
} from "./classify-budget-items";
import type { CanonicalRegistry, MinimalSupabaseClient } from "./registry";
import {
  loadCanonicalRegistrySnapshot,
  type CanonicalRegistrySnapshot,
  type LoadSnapshotOptions,
} from "./registry-snapshot";

// ─── Dependencias inyectables ─────────────────────────────────────────────────

export type SnapshotLoader = (
  options: LoadSnapshotOptions
) => Promise<CanonicalRegistrySnapshot>;

export type LineClassifier = <T extends ClassifiableLine>(
  lines: readonly T[],
  registry: CanonicalRegistry,
  options: ClassifyOptions
) => Promise<ClassifyResult<T>>;

// ─── Informe observable ───────────────────────────────────────────────────────

/**
 * En qué eslabón se rompió la cadena. `null` = no se rompió.
 *
 * Se distingue el eslabón porque las tres averías piden reacciones distintas del
 * humano que lea el log:
 *
 *   snapshot            → la base de datos o la red. Se mira fuera.
 *   classifier          → un defecto nuestro: `classifyBudgetItems` promete no lanzar,
 *                         y si lanza es que la promesa se ha roto.
 *   economic_integrity  → un defecto nuestro MUY grave: el clasificador devolvió
 *                         líneas que no son las que recibió. No lanzó, no falló, no
 *                         avisó: mintió. Es la única avería que se detecta comparando
 *                         en vez de capturando, y por eso hace falta una guarda
 *                         explícita. Ver `findEconomicViolation`.
 */
export type CanonicalWiringFailure = "snapshot" | "classifier" | "economic_integrity" | null;

/**
 * Si el contexto privado de empresa llegó o no.
 *
 *   resolved    → hay `company_id` y la clasificación pudo ver la curación manual
 *                 de esa empresa además del vocabulario global.
 *   unavailable → no lo hay. La clasificación es SEGURA (sólo evidencia global, nunca
 *                 de otra empresa) pero es PEOR: los alias privados no se consultaron.
 *
 * Se declara en vez de deducirse de `companyId === null` porque son dos hechos
 * distintos: un presupuesto puede no tener tenant legítimamente, y eso no es lo mismo
 * que haberlo perdido. Sin esta distinción, una caída de auth produce un informe
 * indistinguible de una clasificación perfectamente normal.
 */
export type TenantContext = "resolved" | "unavailable";

/** Lo mínimo que este módulo necesita de la respuesta de `supabase.auth.getUser()`. */
export interface AuthUserResponse {
  data?: { user?: { id?: string | null } | null } | null;
  error?: unknown;
}

export interface ResolvedTenant {
  companyId: string | null;
  tenantContext: TenantContext;
  tenantFailure?: unknown;
}

/**
 * De una respuesta de `getUser()` a un tenant utilizable. Cuatro ramas y nada más.
 *
 *   error            → companyId null, unavailable        ← incluso con `user` poblado
 *   sin user         → companyId null, unavailable, code:no_session
 *   user sin error   → companyId user.id, resolved
 *
 * LA PRIMERA RAMA ES EL MOTIVO DE QUE ESTA FUNCIÓN EXISTA. Cuando `getUser()` devuelve
 * `error`, lo que venga en `data.user` no es una identidad verificada: puede ser una
 * sesión caducada que la librería no llegó a validar, o el residuo de la anterior. Leer
 * el `id` de ahí sería usar como tenant a alguien de quien acabamos de saber que no
 * podemos afirmar quién es, y ese identificador entra directamente en el filtro
 * `company_id` del snapshot. El fallo posible no es una clasificación peor: es leer
 * evidencia privada bajo una identidad no verificada. Ante la duda, sólo globales.
 *
 * Está fuera del provider a propósito: es una decisión de seguridad de cuatro ramas, y
 * dentro de un componente de React la única forma de comprobarla sería buscar cadenas
 * en el código fuente, que demuestra que algo está escrito y no que funcione. Aquí se
 * le puede pasar una respuesta artificial y observar lo que decide.
 *
 * También cubre la excepción: quien capture un throw llama con `{ error }` y cae en la
 * primera rama, que es exactamente el tratamiento que le corresponde.
 */
export function resolveTenant(response: AuthUserResponse): ResolvedTenant {
  if (response.error) {
    return { companyId: null, tenantContext: "unavailable", tenantFailure: response.error };
  }

  const id = response.data?.user?.id;
  if (typeof id !== "string" || id === "") {
    // Sin excepción y sin usuario. La sesión no está, y eso es una pérdida de contexto
    // igual que un error. Se pasa un `code` en vez de un `Error` porque de un `Error`
    // genérico sólo saldría la etiqueta "Error", que no distingue nada; así el log dice
    // `code:no_session`.
    return { companyId: null, tenantContext: "unavailable", tenantFailure: { code: "no_session" } };
  }

  return { companyId: id, tenantContext: "resolved" };
}

/**
 * Todo lo que se puede decir en voz alta sobre una clasificación.
 *
 * Son CONTADORES, deliberadamente. Ni un concepto, ni una descripción, ni un importe,
 * ni un identificador de cliente. Este objeto está pensado para acabar en un log, y
 * un log de presupuestos no debe poder reconstruir el presupuesto.
 */
export interface CanonicalWiringReport {
  /** Líneas que entraron. Debe coincidir siempre con las que salen. */
  attempted: number;
  degraded: CanonicalWiringFailure;
  /** Etiqueta corta y no sensible de la avería. Nunca el mensaje completo. */
  failureKind: string | null;
  resolved: number;
  review: number;
  ambiguous: number;
  unmatched: number;
  /**
   * Consultas que costó el snapshot. Cero si no llegó a cargarse.
   *
   * NO es una constante. El coste es O(chunks de evidencia distinta): crece con el
   * número de alias_norm, source_ref y canonical_id DISTINTOS, troceados de 200 en
   * 200, no con el número de partidas. Un presupuesto grande necesitará más tandas.
   * Lo que sí es invariable es que la clasificación posterior cuesta cero.
   */
  snapshotQueries: number;
  /** Cargas de snapshot efectuadas. El contrato de 2D-3 es: 0 o 1, nunca más. */
  snapshotLoads: number;
  /** Si se pudo ver la curación privada de la empresa. */
  tenant_context: TenantContext;
  /** Etiqueta técnica corta si el contexto de empresa se perdió. Nunca el id. */
  tenantFailureKind: string | null;
}

export interface ClassifyForPersistenceOptions<T extends ClassifiableLine> {
  /** Líneas económicas DEFINITIVAS. No se modifican. */
  items: readonly T[];
  /** Tenant efectivo. `null` = sólo vocabulario global. */
  companyId: string | null;
  /**
   * Procedencia para las líneas que no la traen. Se deja sin valor a propósito en
   * `finalizeBudget`: inventar un origen para una línea rehidratada de un
   * `wizard_state` antiguo sería afirmar algo que no consta. NULL es la respuesta
   * honesta y es la que el backfill podrá corregir con contexto.
   */
  defaultOrigin?: ResolutionOrigin;
  supabase: MinimalSupabaseClient;
  /**
   * Lo declara quien resolvió el tenant, porque es el único que sabe si `companyId`
   * es null por derecho o por avería. Si no se declara, se asume lo optimista
   * ("resolved"): quien no distingue los dos casos no está perdiendo nada, y marcar
   * de oficio como averiado un null legítimo llenaría los logs de ruido.
   */
  tenantContext?: TenantContext;
  /** El error de auth, si lo hubo. Aquí sólo se le saca el nombre o el código. */
  tenantFailure?: unknown;
  /** Inyectables para los tests. En producción son los reales. */
  loadSnapshot?: SnapshotLoader;
  classify?: LineClassifier;
}

export interface ClassifyForPersistenceResult<T> {
  items: (T & CanonicalColumns)[];
  report: CanonicalWiringReport;
}

// ─── Utilidades internas ──────────────────────────────────────────────────────

/**
 * Etiqueta corta de una avería, apta para un log.
 *
 * Se queda con el NOMBRE del error o con el `code` de PostgREST, nunca con el
 * mensaje: los mensajes de Supabase citan valores de la fila que falló, y esos
 * valores son datos del cliente. Un log de observabilidad que filtra el contenido
 * del presupuesto no es observabilidad, es una fuga.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code !== "") return `code:${code}`;
  }
  return typeof error;
}

/**
 * Camino degradado: cada línea sale `unmatched` CONSERVANDO su procedencia.
 *
 * No construye la fila a mano. Delega en `unmatchedColumnsForLine`, que es la misma
 * función que usa `classifyBudgetItems` cuando el registry no responde. Así el
 * fallback no puede divergir de las restricciones de la tabla: si mañana cambia la
 * regla de `ck_origin_source_ref`, cambia en un solo sitio.
 */
function degradeAll<T extends ClassifiableLine>(
  items: readonly T[],
  defaultOrigin: ResolutionOrigin | null
): (T & CanonicalColumns)[] {
  return items.map((item) => ({ ...item, ...unmatchedColumnsForLine(item, defaultOrigin) }));
}

function emptyReport(
  attempted: number,
  tenant: TenantContext,
  tenantFailureKind: string | null
): CanonicalWiringReport {
  return {
    attempted,
    degraded: null,
    failureKind: null,
    resolved: 0,
    review: 0,
    ambiguous: 0,
    unmatched: 0,
    snapshotQueries: 0,
    snapshotLoads: 0,
    tenant_context: tenant,
    tenantFailureKind,
  };
}

/** Marca el informe como degradado y devuelve las líneas originales, sin clasificar. */
function degradedResult<T extends ClassifiableLine>(
  report: CanonicalWiringReport,
  pristine: readonly T[],
  defaultOrigin: ResolutionOrigin | null,
  cause: Exclude<CanonicalWiringFailure, null>,
  failureKind: string
): ClassifyForPersistenceResult<T> {
  report.degraded = cause;
  report.failureKind = failureKind;
  report.resolved = 0;
  report.review = 0;
  report.ambiguous = 0;
  report.unmatched = pristine.length;
  return { items: degradeAll(pristine, defaultOrigin), report };
}

// ─── Guarda de integridad económica ───────────────────────────────────────────

/**
 * Copia defensiva de una línea, tomada ANTES de entregarla al clasificador.
 *
 * Sin ella la guarda no valdría nada: un clasificador que mutase los objetos de
 * entrada corrompería a la vez la salida Y la referencia contra la que se compara,
 * y las dos coincidirían perfectamente. Se compara contra una foto, no contra algo
 * que el sospechoso todavía puede tocar.
 *
 * `structuredClone` cubre el caso real (filas de datos planos y objetos anidados como
 * `cost_breakdown`). El `catch` existe porque clonar no puede ser el motivo de que un
 * presupuesto no se finalice: si la línea llevara algo no clonable, una copia
 * superficial sigue siendo mejor guarda que ninguna.
 */
function pristineCopy<T>(item: T): T {
  try {
    return structuredClone(item);
  } catch {
    return { ...item };
  }
}

/**
 * Igualdad estructural. `Object.is` para los escalares —trata NaN como igual a NaN,
 * que es lo correcto en una columna monetaria averiada— y recorrido para lo demás.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;

  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

const CANONICAL_KEY_SET: ReadonlySet<string> = new Set<string>(CANONICAL_COLUMN_KEYS);

/**
 * ¿Ha devuelto el clasificador algo que ya no es el presupuesto que recibió?
 *
 * Devuelve `null` si todo está en orden, o una etiqueta corta del incumplimiento.
 * Las etiquetas nombran COLUMNAS, nunca valores: `value:unit_price` dice qué campo
 * se movió, no a cuánto, para que el informe siga sin poder reconstruir nada.
 *
 * POR QUÉ NO BASTA CON EL TOTAL. Dos errores compensados —una línea que sube un euro
 * y otra que lo baja— dejan la base imponible intacta y el presupuesto destrozado.
 * También pasarían inadvertidos un capítulo cambiado, una unidad cambiada o una
 * descripción reescrita, que no afectan a ninguna suma y sí a lo que firma el
 * cliente. Por eso se compara clave a clave y no importe a importe.
 *
 * EL ORDEN se comprueba posicionalmente: comparar el índice i con el índice i es
 * exactamente lo que significa "mismo orden". Una permutación aparece como una
 * diferencia de valor en la primera clave que distinga a las dos líneas.
 *
 * Las siete columnas canónicas se ignoran a propósito: son justo las que el
 * clasificador tiene derecho a escribir.
 */
export function findEconomicViolation(
  before: readonly Record<string, unknown>[],
  after: readonly Record<string, unknown>[]
): string | null {
  if (before.length !== after.length) return "line_count";

  for (let i = 0; i < before.length; i += 1) {
    const antes = before[i]!;
    const despues = after[i]!;

    for (const key of Object.keys(antes)) {
      if (CANONICAL_KEY_SET.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(despues, key)) return `missing_key:${key}`;
      if (!sameValue(antes[key], despues[key])) return `value:${key}`;
    }

    for (const key of Object.keys(despues)) {
      if (CANONICAL_KEY_SET.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(antes, key)) return `extra_key:${key}`;
    }
  }

  return null;
}

function tally(
  report: CanonicalWiringReport,
  lines: readonly CanonicalColumns[]
): CanonicalWiringReport {
  for (const line of lines) {
    switch (line.canonical_status) {
      case "resolved":
        report.resolved += 1;
        break;
      case "review":
        report.review += 1;
        break;
      case "ambiguous":
        report.ambiguous += 1;
        break;
      default:
        report.unmatched += 1;
    }
  }
  return report;
}

// ─── Orquestación ─────────────────────────────────────────────────────────────

async function run<T extends ClassifiableLine>(
  options: ClassifyForPersistenceOptions<T>
): Promise<ClassifyForPersistenceResult<T>> {
  const { items, companyId, supabase } = options;
  const defaultOrigin = options.defaultOrigin ?? null;
  const loadSnapshot = options.loadSnapshot ?? loadCanonicalRegistrySnapshot;
  const classify = options.classify ?? classifyBudgetItems;

  const report = emptyReport(
    items.length,
    options.tenantContext ?? "resolved",
    options.tenantFailure === undefined ? null : describeFailure(options.tenantFailure)
  );

  // Un presupuesto sin líneas no necesita vocabulario. Se corta antes de gastar una
  // consulta, no por optimizar sino porque cargar un snapshot para clasificar cero
  // líneas es una consulta que sólo puede fallar.
  if (items.length === 0) return { items: [], report };

  // La foto. Todo lo que se devuelva por un camino degradado sale de aquí, y es
  // también el testigo contra el que se compara la salida del clasificador.
  const pristine = items.map(pristineCopy);

  let snapshot: CanonicalRegistrySnapshot;
  try {
    // UNA sola carga por finalización, con `lines` completo: el coste del snapshot
    // es O(chunks de evidencia distinta), no O(partidas). Trocearlo por línea
    // reintroduciría el N+1 que este módulo existe para evitar.
    snapshot = await loadSnapshot({ supabase, lines: items, companyId, defaultOrigin: options.defaultOrigin });
  } catch (error) {
    return degradedResult(report, pristine, defaultOrigin, "snapshot", describeFailure(error));
  }

  report.snapshotLoads = 1;
  report.snapshotQueries = snapshot.stats.queries.total;

  let classified: ClassifyResult<T>;
  try {
    // A partir de aquí el registry es de memoria: cero I/O adicional, pase lo que
    // pase con la red. Es lo que hace que el contador de consultas de arriba sea el
    // coste TOTAL de la clasificación y no una parte de él.
    classified = await classify(items, snapshot.registry, { companyId, defaultOrigin: options.defaultOrigin });
  } catch (error) {
    return degradedResult(report, pristine, defaultOrigin, "classifier", describeFailure(error));
  }

  // GUARDA DE INTEGRIDAD ECONÓMICA. Se ejecuta siempre, también cuando todo ha ido
  // bien, porque una clasificación corrupta no se distingue de una correcta hasta
  // que se compara.
  //
  // Y sobre todo: la reacción correcta ante ella NO es dejar que el presupuesto
  // reviente más adelante en la puerta de cuadre. El sistema canónico es un
  // observador; que un observador se estropee no puede impedirle al usuario finalizar
  // su presupuesto. Así que aquí se tira la clasificación entera y se devuelven las
  // líneas ORIGINALES con metadatos seguros. El resultado es una clasificación peor
  // —todo `unmatched`— y un presupuesto económicamente intacto, que es exactamente el
  // intercambio que la fase 2D quiere.
  //
  // `assertPersistedTotalsMatch` sigue corriendo después, en el provider, pero a
  // partir de aquí recibirá siempre líneas económicamente originales: pasa a ser lo
  // que debe ser, la última barrera contra lo que nadie previó, y no el mecanismo
  // ordinario de detección de este fallo.
  const violation = findEconomicViolation(
    pristine as unknown as Record<string, unknown>[],
    classified.lines as unknown as Record<string, unknown>[]
  );
  if (violation !== null) {
    return degradedResult(report, pristine, defaultOrigin, "economic_integrity", violation);
  }

  return { items: classified.lines, report: tally(report, classified.lines) };
}

/**
 * Punto de entrada. NUNCA lanza, por contrato.
 *
 * El `try` exterior parece redundante —`run` ya captura las dos averías previstas—
 * y lo es mientras nada cambie. Está por lo IMPREVISTO: un `TypeError` al leer
 * `snapshot.stats`, un fallo del propio `degradeAll`, cualquier defecto futuro
 * introducido en este archivo. Sin él, un error nuestro en la capa observadora
 * abortaría `finalizeBudget` y el usuario no podría finalizar su presupuesto por un
 * problema con unos metadatos que ni siquiera sabe que existen. Esa es exactamente
 * la situación que la fase 2D declara inaceptable, así que el coste de un `try` de
 * más es trivial comparado con lo que evita.
 */
export async function classifyForPersistence<T extends ClassifiableLine>(
  options: ClassifyForPersistenceOptions<T>
): Promise<ClassifyForPersistenceResult<T>> {
  try {
    return await run(options);
  } catch (error) {
    const items = options.items ?? [];
    const report = emptyReport(
      items.length,
      options.tenantContext ?? "resolved",
      options.tenantFailure === undefined ? null : describeFailure(options.tenantFailure)
    );
    return degradedResult(
      report,
      items.map(pristineCopy),
      options.defaultOrigin ?? null,
      "classifier",
      describeFailure(error)
    );
  }
}

// ─── Envoltorio compartido por los dos puntos de escritura ────────────────────

/**
 * Cuál de los caminos de escritura está clasificando.
 *
 * Se etiqueta porque tienen frecuencias y consecuencias muy distintas:
 * `saveDraft` corre cada vez que el usuario deja de teclear, `finalizeBudget` una
 * sola vez sobre un documento que ya puede irse al cliente, y `editBudget` cada vez
 * que alguien guarda cambios en el formulario clásico de un presupuesto que YA
 * existe. Un informe degradado significa cosas diferentes en cada uno, y sin la
 * etiqueta serían indistinguibles en el log.
 *
 * `editBudget` (FASE 2D-5) es además el único de los cuatro cuya escritura no la hace
 * el cliente: enriquece las filas aquí y se las entrega a la RPC
 * `update_budget_with_items`, que hace el DELETE + INSERT dentro de PostgreSQL.
 *
 * `createBudget` (FASE 2D-7) es la otra mitad del formulario clásico: el alta MANUAL de
 * un presupuesto que todavía no existe. Se distingue de `editBudget` en que no hay nada
 * que borrar antes de escribir, y en que sus filas NACEN aquí: mientras nadie selle la
 * procedencia en el alta —hoy no lo hace ni el buscador del banco de precios—, todas
 * llegan sin origen y salen `unmatched`. Un `unmatched` masivo en este contexto es lo
 * esperado y no una señal de avería. El transporte de `canonical_origin` y
 * `canonical_source_ref` está puesto igualmente, para el día que sí se sellen.
 *
 * `duplicateBudget` (FASE 2D-8) es el único cuyas líneas NO nacen aquí: son la copia de
 * las partidas de un presupuesto que ya existía. Por eso transporta la procedencia del
 * original en lugar de inventarla —duplicar no vuelve a nacer una línea— y por eso
 * tampoco pasa `defaultOrigin`. Las cinco columnas derivadas sí se recalculan: una
 * clasificación vieja es un veredicto emitido contra el vocabulario canónico de otro
 * momento, y en las filas anteriores a la Fase 2 ni siquiera es un veredicto, es el
 * default `unmatched` de la columna.
 */
export type CanonicalPersistenceContext =
  | "saveDraft"
  | "finalizeBudget"
  | "editBudget"
  | "createBudget"
  | "duplicateBudget";

export interface EnrichForPersistenceOptions<T extends ClassifiableLine> {
  items: readonly T[];
  /** Ya resuelto por `resolveTenant`. Aquí no se vuelve a llamar a auth. */
  tenant: ResolvedTenant;
  supabase: MinimalSupabaseClient;
  context: CanonicalPersistenceContext;
  defaultOrigin?: ResolutionOrigin;
  /** Inyectable para los tests; en producción escribe en la consola. */
  log?: (report: CanonicalWiringReport, context: CanonicalPersistenceContext) => void;
  loadSnapshot?: SnapshotLoader;
  classify?: LineClassifier;
}

function defaultLog(report: CanonicalWiringReport, context: CanonicalPersistenceContext): void {
  // Sólo contadores y etiquetas técnicas. Ni conceptos, ni descripciones, ni importes,
  // ni el identificador de empresa: un log de presupuestos no debe permitir
  // reconstruir el presupuesto.
  console.info(`[canonical] ${context}`, report);
}

/**
 * `classifyForPersistence` más el desempaquetado del tenant y la observabilidad.
 *
 * Existe para que los dos puntos de escritura no repitan las mismas cinco líneas de
 * pegamento —esparcir `companyId`/`tenantContext`/`tenantFailure` y acordarse de
 * registrar el informe con la etiqueta correcta—, que es justo el tipo de duplicación
 * que se desincroniza en silencio: el día que el informe gane un campo, olvidarlo en
 * uno de los dos sitios no rompería ningún test.
 *
 * No añade ninguna decisión propia. Hereda íntegro el contrato de 2D-3: no lanza,
 * devuelve siempre las mismas líneas en el mismo orden, y ante cualquier avería
 * —snapshot, clasificador o corrupción económica— saca las líneas originales
 * `unmatched` conservando su procedencia.
 */
export async function enrichForPersistence<T extends ClassifiableLine>(
  options: EnrichForPersistenceOptions<T>
): Promise<ClassifyForPersistenceResult<T>> {
  const result = await classifyForPersistence({
    items: options.items,
    companyId: options.tenant.companyId,
    tenantContext: options.tenant.tenantContext,
    tenantFailure: options.tenant.tenantFailure,
    supabase: options.supabase,
    defaultOrigin: options.defaultOrigin,
    loadSnapshot: options.loadSnapshot,
    classify: options.classify,
  });

  (options.log ?? defaultLog)(result.report, options.context);
  return result;
}
