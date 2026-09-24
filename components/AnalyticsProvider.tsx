"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initAnalytics, identifyUser, analytics } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";
import { stopReplayOnPortal } from "@/lib/replay-portal-guard";
import { isPortalPath, redactPortalPath } from "@/lib/portal-path-redaction";
import { createClient } from "@/lib/supabase-browser";

/**
 * Initializes PostHog on mount and tracks route changes.
 * Drop into the root layout — does nothing if NEXT_PUBLIC_POSTHOG_KEY is unset.
 *
 * Envuelve también /portal/<secreto>, que es una URL portadora: aquí se corta
 * todo lo que podría llevársela fuera. Ver lib/portal-path-redaction.
 */
export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onPortal = isPortalPath(pathname);

  // Init PostHog and identify user on mount (Sentry inits via instrumentation files)
  useEffect(() => {
    /* La ruta se lee aquí y no de `onPortal` para que este siga siendo un
       efecto de montaje puro, sin dependencias. initAnalytics ya se abstiene
       en el portal por su cuenta; esto evita además el identify. */
    if (isPortalPath(window.location.pathname)) return;
    initAnalytics();

    // Identify the current user if logged in
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        identifyUser(user.id, {
          email: user.email,
          name: user.user_metadata?.full_name,
        });
        setSentryUser({
          id: user.id,
          email: user.email ?? undefined,
          name: user.user_metadata?.full_name,
        });
      }
    });
  }, []);

  /* Session Replay se configura una sola vez, al cargar el bundle. Si alguien
     llega al portal navegando dentro de la app —no con una carga completa—,
     esa decisión ya se tomó con la ruta anterior y la grabación sigue viva.
     Aquí se para al entrar, que es lo único que llega a tiempo. */
  useEffect(() => {
    if (onPortal) stopReplayOnPortal();
  }, [onPortal]);

  // Track page views on route change
  useEffect(() => {
    if (!pathname) return;
    // En el portal no se emite pageview: ni siquiera redactado, porque el
    // evento en sí ya delata que ese cliente abrió un enlace concreto.
    if (onPortal) return;
    let cancelled = false;
    /* Hay que esperar a initAnalytics —es asíncrona, importa posthog-js de
       forma dinámica— o el primer $pageview se pierde: este efecto corría
       antes de que el SDK estuviera listo y trackEvent volvía sin hacer nada.
       Antes lo tapaba el capture_pageview automático de PostHog, que ahora
       está desactivado justo porque capturaba la URL sin sanear. La llamada
       es idempotente, así que repetirla en cada cambio de ruta no cuesta. */
    void initAnalytics().then(() => {
      if (!cancelled) analytics.pageViewed(redactPortalPath(pathname));
    });
    return () => { cancelled = true; };
  }, [pathname, onPortal]);

  return <>{children}</>;
}
