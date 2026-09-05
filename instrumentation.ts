import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";

export async function register() {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  } catch (error) {
    // Un fallo inicializando Sentry no puede impedir que arranque el servidor.
    console.warn("[telemetry] Sentry no pudo inicializarse:", error);
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) =>
  safeTelemetry(() => Sentry.captureRequestError(...args));
