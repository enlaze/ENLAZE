// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";
import { portalScrubbingOptions } from "@/lib/sentry-portal-scrubbing";
import { redactPortalDeep } from "@/lib/portal-path-redaction";

/* Este módulo forma parte del bundle principal del cliente: si algo aquí
   lanza, React no hidrata, la app queda inerte y cada submit del login pasa a
   ser una recarga completa. Por eso ni el init ni el hook de navegación
   pueden propagar una excepción. */

/* ─── Session Replay está apagado a propósito, en toda la app ───────────────
   /portal/<secreto> es una URL portadora, y Replay graba la barra de
   direcciones y el DOM. Esa grabación NO pasa por beforeSend: no hay ningún
   hook que la redacte.

   Tampoco vale apagarlo solo en el portal y pararlo al entrar. El stop()
   público de @sentry/replay 10.66.0 es:

     this._replay.stop({ forceFlush: this._replay.recordingMode === "session" })

   es decir, en una sesión muestreada stop() **envía** el búfer. Parar la
   grabación al llegar al portal mandaría precisamente la grabación del portal.

   Mientras el token forme parte de la URL, Replay se queda fuera. Volver a
   encenderlo es parte del lote 2, cuando el secreto deje de viajar en la ruta;
   hay una prueba que falla si se reactiva antes. */

safeTelemetry(() =>
  Sentry.init({
    dsn: "https://34ca40d19351d9299e389cd6d7cade20@o4511746734948352.ingest.de.sentry.io/4511746843213904",

    integrations: [],

    // Sample 20% of traces in production, 100% in development
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Ver el bloque de arriba: Replay apagado mientras el token vaya en la URL.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Redacta /portal/<secreto> en eventos, trazas, breadcrumbs y logs.
    ...portalScrubbingOptions,

    dataCollection: {
      // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
      // userInfo: false,
      // httpBodies: [],
    },
  })
);

/* El primer argumento es el href de destino. Al navegar dentro de la app hacia
   /portal/<secreto>, ese href sería el nombre del span de navegación; se
   redacta en el origen y no solo en beforeSendTransaction. El nombre que queda,
   /portal/[token], es justo la ruta parametrizada que Sentry querría agrupar. */
export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = (
  ...args
) => safeTelemetry(() => Sentry.captureRouterTransitionStart(...redactPortalDeep(args)));
