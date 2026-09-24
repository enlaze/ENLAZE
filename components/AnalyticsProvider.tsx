"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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

    // Identify the current user if logged in
    const supabase = createClient();
    /* Se espera también a initAnalytics. Si getUser resolvía antes de que
       terminara el import dinámico de posthog-js —lo normal con sesión en
       caché— identifyUser se encontraba `initialized` en false y se descartaba
       en silencio: el usuario no quedaba identificado en toda la sesión. */
    void Promise.all([initAnalytics(), supabase.auth.getUser()]).then(([, resultado]) => {
      const user = resultado.data.user;
      if (!user) return;
      /* Se vuelve a mirar la ruta: la respuesta es asíncrona y la pestaña puede
         haber navegado al portal mientras llegaba. Identificar al usuario
         estando ya en /portal/<secreto> ataría esa visita a una persona
         concreta, que es justo lo que el portal no debe hacer. */
      if (isPortalPath(window.location.pathname)) return;
      identifyUser(user.id, {
        email: user.email,
        name: user.user_metadata?.full_name,
      });
      setSentryUser({
        id: user.id,
        email: user.email ?? undefined,
        name: user.user_metadata?.full_name,
      });
    });
  }, []);

  return (
    <>
      {/* useSearchParams obliga a renderizar en cliente el árbol de componentes
          de cliente hasta el <Suspense> más cercano (docs de Next 16,
          use-search-params). Aislado aquí en un hermano que no pinta nada, esa
          frontera contiene solo al emisor de pageviews y {children} conserva su
          prerenderizado. */}
      {!onPortal && (
        <Suspense fallback={null}>
          <PageviewTracker />
        </Suspense>
      )}
      {children}
    </>
  );
}

/**
 * Emite un `$pageview` por cada navegación, incluidas las que solo cambian la
 * query.
 *
 * `usePathname` no incluye la query, así que ir de `?page=1` a `?page=2` no
 * cambiaba nada y el pageview se perdía. Antes daba igual porque lo recogía el
 * `capture_pageview` automático de PostHog, apagado justo porque capturaba la
 * URL sin sanear; al apagarlo, esas navegaciones dejaron de contarse.
 */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /* La cadena, no el objeto: Next devuelve una instancia nueva en cada
     navegación y compararla por referencia dispararía de más. */
  const query = searchParams.toString();

  useEffect(() => {
    if (!pathname) return;
    // En el portal no se emite pageview: ni siquiera redactado, porque el
    // evento en sí ya delata que ese cliente abrió un enlace concreto.
    if (isPortalPath(pathname)) return;
    let cancelled = false;
    /* Hay que esperar a initAnalytics —es asíncrona, importa posthog-js de
       forma dinámica— o el primer $pageview se pierde: este efecto corría
       antes de que el SDK estuviera listo y trackEvent volvía sin hacer nada.
       Devuelve siempre la misma promesa, así que llamarla en cada cambio de
       ruta no provoca una segunda inicialización. */
    void initAnalytics().then(() => {
      if (cancelled) return;
      /* URL completa, no solo el pathname: la captura automática de PostHog
         que esto sustituye mandaba host, query y UTM. Se lee en el momento de
         emitir, cuando la barra de direcciones ya refleja la ruta nueva. */
      const href = typeof window === "undefined" ? pathname : window.location.href;
      analytics.pageViewed(redactPortalPath(href), redactPortalPath(pathname));
    });
    return () => { cancelled = true; };
  }, [pathname, query]);

  return null;
}
