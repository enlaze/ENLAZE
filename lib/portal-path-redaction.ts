/**
 * Redacción de rutas del portal para telemetría.
 *
 * `/portal/<secreto>` es una URL portadora: quien la tenga entra. Por eso no
 * puede salir hacia PostHog, Sentry, la consola ni el almacenamiento del
 * navegador. Aquí vive la única definición de cómo se enmascara, para que
 * analytics, Sentry (cliente, servidor y edge) y las pruebas compartan
 * exactamente el mismo criterio.
 *
 * El secreto se sustituye por el nombre del segmento dinámico de Next,
 * `[token]`, que es lo que ya se ve en el árbol de rutas y no revela nada.
 *
 * ── Fail-closed ────────────────────────────────────────────────────────────
 * Todo lo que el recorrido no sepa redactar con certeza se sustituye por un
 * marcador. Devolver el valor original "porque probablemente no lleve nada"
 * es justo el fallo que hay que evitar: un objeto opaco, un ciclo o una rama
 * demasiado honda pueden contener la URL entera.
 */

export const PORTAL_PATH_PLACEHOLDER = "/portal/[token]";

/** Lo que se emite cuando el recorrido no puede garantizar un valor limpio. */
export const REDACTED_UNSAFE = "[redacted: unsafe value]";
export const REDACTED_DEPTH = "[redacted: max depth]";
export const REDACTED_CYCLE = "[redacted: cycle]";

/** Profundidad máxima del recorrido. Más allá se corta con marcador. */
const MAX_DEPTH = 12;

/**
 * Cualquier `/portal/<algo>` que no sea ya el marcador. El lookahead evita
 * redactar dos veces y que `[token]` acabe convertido en `[token]` anidado.
 *
 * Se para en `/`, `?` y `#`, así que enmascara igual un path suelto, una URL
 * absoluta con query y una URL incrustada en el texto de un error.
 */
const PORTAL_SEGMENT = /\/portal\/(?!\[token\](?=[/?#]|$))[^/?#\s"'<>]+/gi;

/** ¿Esta ruta es la del portal público? Acepta path o URL absoluta. */
export function isPortalPath(value: string | null | undefined): boolean {
  if (!value) return false;
  const path = value.startsWith("http")
    ? safeUrlPathname(value) ?? value
    : value;
  return /^\/portal(\/|$)/i.test(path);
}

function safeUrlPathname(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

/** Sustituye todo `/portal/<secreto>` por `/portal/[token]` dentro de un texto. */
export function redactPortalPath(value: string): string {
  return value.replace(PORTAL_SEGMENT, PORTAL_PATH_PLACEHOLDER);
}

/** Convierte algo a texto sin que un toString() hostil pueda tumbar el saneado. */
function redactedString(value: unknown): string {
  try {
    return redactPortalPath(String(value));
  } catch {
    return REDACTED_UNSAFE;
  }
}

/**
 * Un Error, aplanado a objeto plano y con cada parte redactada.
 *
 * Sentry serializa los errores antes de `beforeSend`, pero no siempre: un
 * `extra`, un `cause` o un error dentro de un array llegan como instancia. El
 * `stack` es el peor sitio, porque suele llevar la URL del documento.
 */
function redactError(error: Error, depth: number, ancestors: Set<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: redactedString(error.name),
    message: redactedString(error.message),
  };
  if (error.stack !== undefined) out.stack = redactedString(error.stack);
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = redactPortalDeep(cause, depth + 1, ancestors);
  // Propiedades propias que el código haya colgado del error (code, status…).
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    let raw: unknown;
    try {
      raw = (error as unknown as Record<string, unknown>)[key];
    } catch {
      out[redactPortalPath(key)] = REDACTED_UNSAFE;
      continue;
    }
    out[redactPortalPath(key)] = redactPortalDeep(raw, depth + 1, ancestors);
  }
  return out;
}

/**
 * Recorre una estructura cualquiera redactando cada cadena.
 *
 * Telemetría envía objetos que no controlamos del todo: propiedades de
 * PostHog, eventos de Sentry con breadcrumbs, cabeceras, `extra`… Enumerar los
 * campos que pueden traer la URL sería una lista que se queda corta a la
 * primera versión del SDK que añada uno. Se redacta todo lo que sea texto, y
 * lo que no se sepa recorrer se sustituye por un marcador.
 *
 * `ancestors` guarda solo la rama en curso, no todo lo visitado: si el mismo
 * objeto aparece colgando de dos claves distintas hay que redactarlo las dos
 * veces, no saltárselo la segunda por haberlo visto ya.
 */
export function redactPortalDeep<T>(value: T, depth = 0, ancestors = new Set<object>()): T {
  if (typeof value === "string") return redactPortalPath(value) as unknown as T;
  // Números, booleanos, null y undefined no pueden llevar texto dentro.
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind === "number" || kind === "boolean") return value;
  // bigint y symbol se pasan a texto redactado: un symbol lleva descripción.
  if (kind === "bigint" || kind === "symbol") return redactedString(value) as unknown as T;
  // Una función puede delatar la URL en su código fuente; no se envía nunca.
  if (kind === "function") return REDACTED_UNSAFE as unknown as T;
  if (kind !== "object") return redactedString(value) as unknown as T;

  const node = value as object;
  // Ciclo: se corta con marcador, no devolviendo el objeto original —que es
  // justo el que puede llevar el token— sin revisar.
  if (ancestors.has(node)) return REDACTED_CYCLE as unknown as T;
  // Rama demasiado honda: marcador, nunca el valor crudo.
  if (depth >= MAX_DEPTH) return REDACTED_DEPTH as unknown as T;

  ancestors.add(node);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactPortalDeep(item, depth + 1, ancestors)) as unknown as T;
    }
    if (value instanceof Error) {
      return redactError(value, depth, ancestors) as unknown as T;
    }
    // Una URL del portal se aplana a su href redactado: recorrer sus getters
    // devolvería pathname, search y href con el secreto intacto.
    if (typeof URL !== "undefined" && value instanceof URL) {
      return redactedString(value.href) as unknown as T;
    }
    if (value instanceof Date) return value;
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].map(([k, v]) => [
        redactedString(k), redactPortalDeep(v, depth + 1, ancestors),
      ])) as unknown as T;
    }
    if (value instanceof Set) {
      return [...value].map((item) => redactPortalDeep(item, depth + 1, ancestors)) as unknown as T;
    }

    const proto = Object.getPrototypeOf(node);
    const isPlain = proto === Object.prototype || proto === null;
    if (!isPlain) {
      /* Objeto opaco: una instancia de clase cualquiera. No se devuelve
         intacto —podría llevar la URL en cualquier campo— sino aplanado a sus
         propiedades enumerables propias, que es lo que un serializador
         acabaría leyendo de todos modos. */
      const flattened: Record<string, unknown> = {};
      for (const key of Object.keys(node)) {
        let raw: unknown;
        try {
          raw = (node as Record<string, unknown>)[key];
        } catch {
          flattened[redactPortalPath(key)] = REDACTED_UNSAFE;
          continue;
        }
        flattened[redactPortalPath(key)] = redactPortalDeep(raw, depth + 1, ancestors);
      }
      return flattened as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      let raw: unknown;
      try {
        raw = (node as Record<string, unknown>)[key];
      } catch {
        // Un getter que lanza: su excepción podría llevar el secreto en el
        // mensaje, así que ni se mira. La clave queda con marcador.
        out[redactPortalPath(key)] = REDACTED_UNSAFE;
        continue;
      }
      out[redactPortalPath(key)] = redactPortalDeep(raw, depth + 1, ancestors);
    }
    return out as unknown as T;
  } finally {
    ancestors.delete(node);
  }
}
