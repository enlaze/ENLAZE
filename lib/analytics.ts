/**
 * Analytics — PostHog integration
 *
 * Wraps posthog-js so the rest of the codebase never imports it directly.
 * If the env var NEXT_PUBLIC_POSTHOG_KEY is missing the calls are no-ops,
 * which means analytics won't break anything in development.
 *
 * ── Install ─────────────────────────────────────────────────────────
 *   npm install posthog-js
 *
 * ── Env vars (.env.local) ───────────────────────────────────────────
 *   NEXT_PUBLIC_POSTHOG_KEY=phc_...
 *   NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com   (or us)
 * ────────────────────────────────────────────────────────────────────
 */

import { isPortalPath, redactPortalDeep, redactPortalPath } from "@/lib/portal-path-redaction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthog: any = null;

let initialized = false;

/* Promesa única de inicialización. Sin esto, dos llamadas concurrentes pasaban
   las dos por `if (initialized) return` —que solo se pone a true DESPUÉS del
   import dinámico de posthog-js— y hacían dos `posthog.init`. Los dos efectos
   de AnalyticsProvider llaman a initAnalytics en el mismo tick, así que era el
   caso normal, no el raro. */
let initPromise: Promise<void> | null = null;

/* La ruta EN ESTE INSTANTE, no la que había cuando se montó el componente.
   Todo lo que pueda emitir o identificar la consulta justo antes de actuar:
   entre que algo se pide y se ejecuta, la pestaña puede haber navegado al
   portal. Fail-closed: si no se puede leer la ruta, se asume que sí. */
function onPortalNow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isPortalPath(window.location.pathname);
  } catch {
    return true;
  }
}

/* ── Init ─────────────────────────────────────────────────────────── */

export function initAnalytics(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  /* En /portal/<secreto> no se inicializa PostHog en absoluto.
     No basta con sanear los eventos: PostHog persiste $initial_current_url en
     localStorage y en cookie (persistence: "localStorage+cookie"), así que la
     URL portadora quedaría escrita en el navegador del cliente final aunque
     ningún evento llegara a salir. El portal es una página pública y anónima;
     lo que se pierde de producto no compensa guardar ahí un secreto.

     Este caso NO memoiza: si luego se navega desde el portal a una pantalla
     normal, la inicialización tiene que poder ocurrir allí. */
  if (onPortalNow()) return Promise.resolve();

  if (!initPromise) initPromise = runInit();
  return initPromise;
}

async function runInit(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.info("[analytics] NEXT_PUBLIC_POSTHOG_KEY not set — analytics disabled");
    }
    return;
  }

  try {
    // Dynamic import — will fail gracefully if posthog-js is not installed
    const ph = (await import("posthog-js")).default;
    posthog = ph;
  } catch {
    console.info("[analytics] posthog-js not installed — run: npm install posthog-js");
    return;
  }

  /* Segunda comprobación, inmediatamente antes de inicializar. La de arriba se
     hizo antes del import dinámico de posthog-js, y ese import tarda: la
     pestaña puede haber navegado al portal mientras estaba en vuelo, y entonces
     este init escribiría $initial_current_url —con el secreto— en localStorage
     y en la cookie del cliente final.

     Al abortar se suelta initPromise en vez de dejarla memoizada resuelta: si
     más tarde se sale del portal, la inicialización tiene que poder ocurrir. */
  if (onPortalNow()) {
    initPromise = null;
    return;
  }

  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    /* Desactivado a propósito: el pageview automático captura
       window.location.href tal cual, y lo hace en el propio init, antes de que
       nada pueda sanearlo. AnalyticsProvider ya emite un $pageview por cada
       cambio de ruta —con la ruta redactada—, así que no se pierde ninguno;
       de hecho se deja de enviar el duplicado que había. */
    capture_pageview: false,
    /* También desactivado, y por el mismo motivo que su hermano. Si alguien
       navega en la misma pestaña del dashboard al portal, PostHog ya está
       inicializado y emitiría un $pageleave desde /portal/<secreto>. Iría
       redactado, pero la política es que desde el portal no sale NINGÚN evento:
       el evento en sí ya delata que ese cliente abrió su enlace.

       Se apaga globalmente en vez de reactivarlo al salir del portal. La
       alternativa —opt_out/opt_in del capturado— puede pisar una preferencia de
       privacidad que el usuario haya fijado, y eso es peor que perder la métrica
       de permanencia. Vuelve en el lote 2, cuando el token salga de la URL. */
    capture_pageleave: false,
    autocapture: false,              // we define events explicitly
    persistence: "localStorage+cookie",
    /* Red de seguridad para todo lo que no emitimos nosotros: $pageleave,
       $initial_current_url, $referrer y cualquier propiedad que el SDK añada
       en el futuro pasan por aquí antes de salir. */
    sanitize_properties: (properties: Record<string, unknown>) =>
      redactPortalDeep(properties),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loaded: (instance: any) => {
      if (process.env.NODE_ENV === "development") {
        instance.debug();
      }
    },
  });

  initialized = true;
}

/* ── Identify ─────────────────────────────────────────────────────── */

export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (!initialized) return;
  /* Aunque PostHog se inicializara antes en el dashboard, desde el portal no se
     identifica a nadie: ataría esa visita anónima a una persona concreta. */
  if (onPortalNow()) return;
  posthog.identify(userId, traits ? redactPortalDeep(traits) : traits);
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

/* ── Events ───────────────────────────────────────────────────────── */

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  /* Última barrera, y la que de verdad cierra la política: desde el portal no
     sale NINGÚN evento de producto, esté quien esté llamando y se hubiera
     inicializado PostHog donde se hubiera inicializado. El evento en sí ya
     delata que ese cliente abrió su enlace, aunque vaya redactado. */
  if (onPortalNow()) return;
  // Redactado también en el emisor, no solo en sanitize_properties: así una
  // propiedad con la URL queda limpia aunque el hook del SDK cambie de nombre.
  posthog.capture(event, properties ? redactPortalDeep(properties) : properties);
}

/* ── Predefined product events ────────────────────────────────────── */

export const analytics = {
  // Auth
  userRegistered: (email: string) =>
    trackEvent("user_registered", { email }),

  userLoggedIn: (method: "email" | "google") =>
    trackEvent("user_logged_in", { method }),

  userLoggedOut: () =>
    trackEvent("user_logged_out"),

  // Onboarding
  onboardingStarted: () =>
    trackEvent("onboarding_started"),

  onboardingSectorSelected: (sector: string) =>
    trackEvent("onboarding_sector_selected", { sector }),

  onboardingCompleted: (sector: string, businessName: string) =>
    trackEvent("onboarding_completed", { sector, business_name: businessName }),

  // Budgets
  budgetCreated: (method: "manual" | "wizard", serviceType: string) =>
    trackEvent("budget_created", { method, service_type: serviceType }),

  budgetWizardStepCompleted: (step: number, stepName: string) =>
    trackEvent("budget_wizard_step_completed", { step, step_name: stepName }),

  budgetFinalized: (budgetId: string, total: number) =>
    trackEvent("budget_finalized", { budget_id: budgetId, total }),

  budgetStatusChanged: (budgetId: string, from: string, to: string) =>
    trackEvent("budget_status_changed", { budget_id: budgetId, from_status: from, to_status: to }),

  budgetExportedPDF: (mode: "client" | "internal") =>
    trackEvent("budget_exported_pdf", { mode }),

  budgetDraftSaved: () =>
    trackEvent("budget_draft_saved"),

  budgetDraftRecovered: () =>
    trackEvent("budget_draft_recovered"),

  // Price Bank
  priceImportStarted: () =>
    trackEvent("price_import_started"),

  priceImportCompleted: (productsImported: number) =>
    trackEvent("price_import_completed", { products_imported: productsImported }),

  // Clients
  clientCreated: () =>
    trackEvent("client_created"),

  // Navigation
  /* `url` debe ser la URL completa, no el pathname: la captura automática de
     PostHog que esto sustituye mandaba window.location.href, con host, query y
     parámetros UTM. Mandar solo el path habría roto la atribución de campañas
     sin que nadie se enterase hasta mirar los informes. */
  pageViewed: (url: string, pathname?: string) =>
    trackEvent("$pageview", {
      $current_url: redactPortalPath(url),
      ...(pathname ? { $pathname: redactPortalPath(pathname) } : {}),
    }),

  searchUsed: (query: string) =>
    trackEvent("search_used", { query_length: query.length }),
};
