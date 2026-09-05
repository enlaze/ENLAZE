// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";

/* Este módulo forma parte del bundle principal del cliente: si algo aquí
   lanza, React no hidrata, la app queda inerte y cada submit del login pasa a
   ser una recarga completa. Por eso ni el init ni el hook de navegación
   pueden propagar una excepción. */

safeTelemetry(() =>
  Sentry.init({
    dsn: "https://34ca40d19351d9299e389cd6d7cade20@o4511746734948352.ingest.de.sentry.io/4511746843213904",

    // Add optional integrations for additional features
    integrations: [Sentry.replayIntegration()],

    // Sample 20% of traces in production, 100% in development
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,

    dataCollection: {
      // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
      // userInfo: false,
      // httpBodies: [],
    },
  })
);

export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = (
  ...args
) => safeTelemetry(() => Sentry.captureRouterTransitionStart(...args));
