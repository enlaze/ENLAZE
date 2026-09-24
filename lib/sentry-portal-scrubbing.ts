/**
 * Saneado de Sentry: ni un evento, traza, breadcrumb o log puede salir con el
 * secreto de un enlace del portal dentro.
 *
 * Los tres `init` de Sentry (cliente, servidor y edge) comparten estos hooks,
 * de modo que endurecer uno no deja los otros dos abiertos. El saneado es
 * ciego: recorre el evento entero en vez de enumerar los campos donde hoy
 * aparece la URL, porque esa lista se queda corta con cada versión del SDK.
 *
 * Todo va envuelto: si el saneado fallara, es preferible **descartar** el
 * evento a mandarlo sin redactar.
 */

import { redactPortalDeep, isPortalPath } from "@/lib/portal-path-redaction";

/** Un hook de Sentry que redacta y, si el saneado falla, descarta. */
function scrubbed<T>(input: T): T | null {
  try {
    return redactPortalDeep(input);
  } catch (error) {
    // Ni captureException ni Sentry.logger: si lo roto es la telemetría,
    // reportarlo por telemetría lo agrava. Y el evento no sale.
    console.warn("[telemetry] evento descartado: el saneado falló", error);
    return null;
  }
}

/** Hooks comunes a los tres entornos. Se expanden dentro de `Sentry.init`. */
export const portalScrubbingOptions = {
  beforeSend: scrubbed,
  beforeSendTransaction: scrubbed,
  beforeBreadcrumb: scrubbed,
  beforeSendLog: scrubbed,
};

/**
 * ¿Se está sirviendo ahora mismo una página del portal en el navegador?
 *
 * Session Replay graba la URL y el DOM, y su grabación no pasa por
 * `beforeSend`. En el portal no se graba, punto: no hay redacción que valga
 * sobre un vídeo de la barra de direcciones.
 */
export function onPortalRouteNow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isPortalPath(window.location.pathname);
  } catch {
    // Si ni siquiera se puede leer la ruta, se asume lo más restrictivo.
    return true;
  }
}
