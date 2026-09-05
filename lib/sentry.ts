/**
 * Sentry — Error tracking helpers
 *
 * Initialization is handled automatically by the official Sentry SDK files:
 *   - instrumentation-client.ts  (browser)
 *   - sentry.server.config.ts    (Node.js server)
 *   - sentry.edge.config.ts      (Edge runtime)
 *
 * This file exports convenience wrappers used throughout the codebase
 * for manual error capture and user identification.
 */

import * as Sentry from "@sentry/nextjs";
import { safeTelemetry } from "@/lib/telemetry-safe";

/**
 * Capture an exception in Sentry with optional context.
 */
export function captureException(
  error: unknown,
  context?: {
    component?: string;
    action?: string;
    extra?: Record<string, unknown>;
  }
) {
  safeTelemetry(() =>
    Sentry.withScope((scope) => {
      if (context?.component) scope.setTag("component", context.component);
      if (context?.action) scope.setTag("action", context.action);
      if (context?.extra) scope.setExtras(context.extra);
      Sentry.captureException(error);
    })
  );
}

/**
 * Set the current user for Sentry context.
 */
export function setSentryUser(user: { id: string; email?: string; name?: string } | null) {
  safeTelemetry(() =>
    Sentry.setUser(
      user ? { id: user.id, email: user.email, username: user.name } : null
    )
  );
}
