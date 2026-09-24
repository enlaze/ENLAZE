/**
 * Protección explícita de Session Replay en el portal.
 *
 * `instrumentation-client.ts` decide si Replay arranca mirando la ruta con la
 * que se cargó el bundle. Esa decisión no se revisa después, así que una
 * navegación dentro de la app hacia `/portal/<secreto>` dejaría la grabación
 * corriendo con la URL portadora en la barra de direcciones y en el DOM.
 *
 * La grabación de Replay **no pasa por `beforeSend`**: no hay hook que la
 * redacte. Lo único que sirve es pararla.
 */

import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";

/**
 * Detiene Session Replay si está activo. Idempotente y silenciosa: si la
 * integración no está cargada —lo normal cuando el portal se abre con una
 * carga completa— no hay nada que parar.
 */
export function stopReplayOnPortal(): void {
  safeTelemetry(() => {
    const replay = Sentry.getClient()?.getIntegrationByName?.<
      ReturnType<typeof Sentry.replayIntegration>
    >("Replay");
    // `stop()` descarta el búfer en curso; `flush()` lo enviaría, que es justo
    // lo contrario de lo que se quiere aquí.
    replay?.stop?.();
  });
}
