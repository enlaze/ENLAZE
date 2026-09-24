/**
 * Redacción de rutas del portal para telemetría.
 *
 * `/portal/<secreto>` es una URL portadora: quien la tenga entra. Por eso no
 * puede salir hacia PostHog, Sentry, Session Replay, la consola ni el
 * almacenamiento del navegador. Aquí vive la única definición de cómo se
 * enmascara, para que analytics, Sentry (cliente, servidor y edge) y las
 * pruebas compartan exactamente el mismo criterio.
 *
 * El secreto se sustituye por el nombre del segmento dinámico de Next,
 * `[token]`, que es lo que ya se ve en el árbol de rutas y no revela nada.
 */

export const PORTAL_PATH_PLACEHOLDER = "/portal/[token]";

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

/**
 * Recorre una estructura cualquiera redactando cada cadena.
 *
 * Telemetría envía objetos que no controlamos del todo: propiedades de
 * PostHog, eventos de Sentry con breadcrumbs, cabeceras, `extra`… Enumerar los
 * campos que pueden traer la URL sería una lista que se queda corta a la
 * primera versión del SDK que añada uno. Se redacta todo lo que sea texto.
 *
 * Las claves también se redactan: un objeto indexado por URL filtraría igual.
 *
 * `depth` y `ancestors` acotan el recorrido: la telemetría no puede colgarse ni
 * reventar la pila por una estructura honda o cíclica. `ancestors` guarda solo
 * la rama en curso, no todo lo visitado: si el mismo objeto aparece colgando de
 * dos claves distintas hay que redactarlo las dos veces, no saltárselo la
 * segunda por haberlo visto ya.
 */
export function redactPortalDeep<T>(value: T, depth = 0, ancestors = new Set<object>()): T {
  if (typeof value === "string") return redactPortalPath(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 12) return value;

  const node = value as object;
  // Ciclo: este objeto es su propio antepasado. Se deja tal cual y se corta.
  if (ancestors.has(node)) return value;

  const isPlainObject = !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(node));
  // Solo arrays y objetos planos. Un Date, un Error o una instancia de clase se
  // devuelven intactos: reescribirlos a un objeto plano rompería al consumidor.
  if (!Array.isArray(value) && !isPlainObject) return value;

  ancestors.add(node);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactPortalDeep(item, depth + 1, ancestors)) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      out[redactPortalPath(key)] = redactPortalDeep(item, depth + 1, ancestors);
    }
    return out as unknown as T;
  } finally {
    ancestors.delete(node);
  }
}
