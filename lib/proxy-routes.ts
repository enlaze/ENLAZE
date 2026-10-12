/* ─────────────────────────────────────────────────────────────────────
 * Rutas que el proxy (proxy.ts) deja pasar sin sesión.
 *
 * Vive en lib/ porque proxy.ts solo puede exportar `proxy` y `config`, y
 * estas listas están fijadas en __tests__/proxy-api-callers.test.mjs: si
 * añades una ruta, esa prueba falla a propósito. Cada ruta de aquí tiene
 * que comprobar ella misma quién llama (firma, token o Bearer). El
 * inventario de llamantes está en informes/2026-10-12-b12-proxy-de-verdad.md.
 * ───────────────────────────────────────────────────────────────────── */

// Routes that don't require authentication
export const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/firmar",              // Public signature page
  "/contabilidad-print",  // Print page (opened from authenticated context)
  "/monitoring",          // Sentry tunnel
];

// API routes that don't require authentication
export const PUBLIC_API_ROUTES = [
  "/api/auth",             // Auth flow
  "/api/webhook",          // Webhooks (verified by their own mechanisms)
  "/api/webhooks",         // Webhooks
  "/api/signatures/public", // Public signing API
  "/api/signatures/verify-otp", // OTP verification (has its own security)
  "/api/signatures/send-otp",   // OTP sending (rate limited internally)
  "/api/pb/ingest",        // Price ingest from n8n (Bearer token auth internally)
  "/api/pb/sync/run",      // Sync trigger (Bearer token auth internally)
  "/api/prices/n8n-sync",  // n8n polling (Bearer token auth internally)
  "/api/technical-prices/import", // BC3 import (Bearer token auth internally)
  "/api/billing/webhook",  // Stripe (verifica la firma con STRIPE_WEBHOOK_SECRET)
  "/api/prices/process-alerts",      // Sistema (Bearer WEBHOOK_SECRET/AGENT_API_KEY dentro)
  "/api/prices/weekly-report/send",  // Sistema (Bearer WEBHOOK_SECRET/AGENT_API_KEY dentro)
];

// Rutas que llaman sistemas con `Authorization: Bearer <secreto>`.
// Ruta exacta, una por una: nada de prefijos. Cada una comprueba su propio
// secreto antes de hacer nada.
// Solo se saltan el proxy si traen cabecera Authorization Bearer: las que
// también usa el dashboard las llama con cookie y siguen pasando por aquí.
export const BEARER_API_ROUTES = [
  // n8n (n8n-workflow-comercio-local-v6.3.json): requireBearer /
  // verifyAgentRequest con AGENT_API_KEY, o sesión (verifyAgentOrBrowserRequest)
  "/api/agent/users",
  "/api/agent/config",
  "/api/agent/news",
  "/api/agent/ingest",
  "/api/agent/calendar/summary",
  "/api/agent/gmail/summary",
  "/api/agent/market/summary",
  "/api/agent/reputation/summary",
  "/api/agent/sheets/summary",
  // n8n, según n8n-workflows/SETUP.md: requireBearer(WEBHOOK_SECRET)
  "/api/pb/webhook",
  // GitHub Action anon-privileges-check.yml, cada 6 h: ANON_PRIVILEGES_CHECK_TOKEN
  "/api/internal/anon-privileges-check",
  // Cron de envíos programados (Vercel Cron o pg_cron, aún sin activar): CRON_SECRET
  "/api/cron/dispatch-scheduled",
];

const BEARER_API_ROUTE_SET = new Set(BEARER_API_ROUTES);

function matchesPrefixList(pathname: string, routes: readonly string[]): boolean {
  // Check exact matches and prefix matches
  return routes.some((route) => pathname === route || pathname.startsWith(route + "/"));
}

export function isPublicRoute(pathname: string): boolean {
  return matchesPrefixList(pathname, PUBLIC_ROUTES);
}

export function isPublicApiRoute(pathname: string): boolean {
  return matchesPrefixList(pathname, PUBLIC_API_ROUTES);
}

export function isBearerApiCall(pathname: string, authorization: string | null): boolean {
  return (
    BEARER_API_ROUTE_SET.has(pathname) &&
    (authorization || "").toLowerCase().startsWith("bearer ")
  );
}
