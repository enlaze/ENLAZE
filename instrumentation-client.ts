// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";
import { portalScrubbingOptions, onPortalRouteNow } from "@/lib/sentry-portal-scrubbing";
import { redactPortalDeep } from "@/lib/portal-path-redaction";

/* Este módulo forma parte del bundle principal del cliente: si algo aquí
   lanza, React no hidrata, la app queda inerte y cada submit del login pasa a
   ser una recarga completa. Por eso ni el init ni el hook de navegación
   pueden propagar una excepción. */

/* /portal/<secreto> es una URL portadora. Session Replay graba la barra de
   direcciones y el DOM, y su grabación NO pasa por beforeSend, así que ahí no
   hay redacción posible: en el portal sencillamente no se graba. Los errores
   se siguen reportando, ya saneados. */
const onPortal = onPortalRouteNow();

safeTelemetry(() =>
  Sentry.init({
    dsn: "https://34ca40d19351d9299e389cd6d7cade20@o4511746734948352.ingest.de.sentry.io/4511746843213904",

    // Add optional integrations for additional features
    integrations: onPortal ? [] : [Sentry.replayIntegration()],

    // Sample 20% of traces in production, 100% in development
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: onPortal ? 0 : 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: onPortal ? 0 : 1.0,

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
