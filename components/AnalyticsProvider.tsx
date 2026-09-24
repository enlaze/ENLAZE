"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initAnalytics, identifyUser, analytics } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";
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
       está desactivado justo porque capturaba la URL sin sanear. Devuelve
       siempre la misma promesa, así que llamarla en cada cambio de ruta no
       provoca una segunda inicialización. */
    void initAnalytics().then(() => {
      if (cancelled) return;
      /* URL completa, no solo el pathname: la captura automática de PostHog
         que esto sustituye mandaba host, query y UTM. Se lee en el momento de
         emitir, cuando la barra de direcciones ya refleja la ruta nueva. */
      const href = typeof window === "undefined" ? pathname : window.location.href;
      analytics.pageViewed(redactPortalPath(href), redactPortalPath(pathname));
    });
    return () => { cancelled = true; };
  }, [pathname, onPortal]);

  return <>{children}</>;
}
