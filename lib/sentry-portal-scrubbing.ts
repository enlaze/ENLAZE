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

import { redactPortalDeep } from "@/lib/portal-path-redaction";

/* Constante sin datos. El error que hizo fallar el saneado puede llevar el
   secreto en su mensaje o en su stack —de hecho, es el caso más probable: algo
   reventó leyendo la URL—, y con enableLogs esta línea volvería a Sentry. Así
   que no se imprime ni el error, ni su mensaje, ni su tipo. Para depurar, el
   evento descartado se nota por su ausencia. */
const SCRUB_FAILED = "[telemetry] evento descartado: el saneado falló";

/** Un hook de Sentry que redacta y, si el saneado falla, descarta. */
function scrubbed<T>(input: T): T | null {
  try {
    return redactPortalDeep(input);
  } catch {
    // Ni captureException ni Sentry.logger: si lo roto es la telemetría,
    // reportarlo por telemetría lo agrava. Y el evento no sale.
    console.warn(SCRUB_FAILED);
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
