/**
 * Telemetría aislada — la observabilidad nunca puede tirar la app.
 *
 * `instrumentation-client.ts` se evalúa dentro del bundle principal del
 * cliente. Si algo ahí lanza (Sentry, su worker de Session Replay bloqueado
 * por la CSP, un JSON.parse sobre un valor vacío…), el módulo entero falla,
 * React no llega a hidratar y la app queda inerte: los formularios pasan a
 * hacer submit nativo y cada interacción se convierte en una recarga completa.
 *
 * Todo punto de entrada a Sentry pasa por aquí para que un fallo de
 * telemetría degrade la observabilidad y nada más.
 */

export function safeTelemetry<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    // console.warn y no captureException: si la telemetría es justo lo que
    // está roto, reportar el fallo por telemetría lo agravaría.
    console.warn("[telemetry] llamada ignorada tras fallar:", error);
    return undefined;
  }
}
