"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { safeTelemetry } from "@/lib/telemetry-safe";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Última red de seguridad de la app: si el propio Sentry lanza aquí, el
    // boundary global caería y la pantalla de error quedaría en blanco.
    safeTelemetry(() => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
