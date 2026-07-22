import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/* ─────────────────────────────────────────────────────────
 * Security middleware for Enlaze
 * - Protects /dashboard and /api routes (requires auth)
 * - Adds security headers to ALL responses
 * - Allows public routes to pass through
 * ───────────────────────────────────────────────────────── */

// Routes that don't require authentication
const PUBLIC_ROUTES = [
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
const PUBLIC_API_ROUTES = [
  "/api/auth",             // Auth flow
  "/api/webhook",          // Webhooks (verified by their own mechanisms)
  "/api/webhooks",         // Webhooks
  "/api/signatures/public", // Public signing API
  "/api/signatures/verify-otp", // OTP verification (has its own security)
  "/api/signatures/send-otp",   // OTP sending (rate limited internally)
];

function isPublicRoute(pathname: string): boolean {
  // Check exact matches and prefix matches for public routes
  for (const route of PUBLIC_ROUTES) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return true;
    }
  }
  return false;
}

function isPublicApiRoute(pathname: string): boolean {
  for (const route of PUBLIC_API_ROUTES) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return true;
    }
  }
  return false;
}

function addSecurityHeaders(response: NextResponse): NextResponse {
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

  // Content Security Policy
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://*.sentry.io https://*.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.sentry.io https://*.posthog.com wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Create response to modify
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Always add security headers
  response = addSecurityHeaders(response);

  // Skip auth check for public routes and static files
  if (isPublicRoute(pathname)) {
    return response;
  }

  // Skip auth for public API routes
  if (isPublicApiRoute(pathname)) {
    return response;
  }

  // For protected routes (/dashboard/*, /api/*), verify authentication
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = NextResponse.next({
              request: { headers: request.headers },
            });
            response = addSecurityHeaders(response);
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // For API routes, return 401
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "No autorizado" },
          { status: 401, headers: Object.fromEntries(response.headers.entries()) }
        );
      }
      // For dashboard routes, redirect to login
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - Public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
