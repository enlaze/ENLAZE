import type { NextResponse } from "next/server";

/* ─────────────────────────────────────────────────────────────────────
 * Cabeceras de seguridad de Enlaze.
 *
 * Vive en lib/ porque un middleware (proxy.ts) solo puede exportar la
 * función del proxy y `config`, y la CSP tiene que ser testeable.
 * ───────────────────────────────────────────────────────────────────── */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://*.sentry.io https://*.posthog.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
  "connect-src 'self' blob: https://*.supabase.co https://*.supabase.in https://*.sentry.io https://*.posthog.com wss://*.supabase.co",
  /* Sentry Session Replay comprime en un Worker creado desde un blob:. Sin
     worker-src explícito el navegador cae en script-src, bloquea el worker y
     Sentry revienta durante el arranque del cliente. blob: se abre aquí y
     solo aquí: script-src sigue sin admitirlo. */
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function applySecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Enable XSS protection (legacy browsers)
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer policy - don't leak full URLs
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy - restrict browser features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // HSTS - enforce HTTPS (1 year, include subdomains)
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );

  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);

  return response;
}
