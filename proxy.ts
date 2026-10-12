import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { applySecurityHeaders } from "./lib/security-headers";
import { isBearerApiCall, isPublicApiRoute, isPublicRoute } from "./lib/proxy-routes";

/* ─────────────────────────────────────────────────────────
 * Security proxy for Enlaze
 * - Protects /dashboard and /api routes (requires auth)
 * - Adds security headers to ALL responses
 * - Allows public routes to pass through (lists in lib/proxy-routes.ts)
 * ───────────────────────────────────────────────────────── */

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Create response to modify
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Always add security headers
  response = applySecurityHeaders(response);

  // Skip auth check for public routes and static files
  if (isPublicRoute(pathname)) {
    return response;
  }

  // Skip auth for public API routes
  if (isPublicApiRoute(pathname)) {
    return response;
  }

  // Llamadas de sistema con Bearer: la ruta comprueba la clave ella misma
  if (isBearerApiCall(pathname, request.headers.get("authorization"))) {
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
            response = applySecurityHeaders(response);
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
        // Respuesta nueva, sin copiar las cabeceras de NextResponse.next():
        // con x-middleware-next, Next ignoraba este 401 y seguía hasta la ruta.
        return applySecurityHeaders(
          NextResponse.json({ error: "No autorizado" }, { status: 401 })
        );
      }
      // For dashboard routes, redirect to login
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
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
