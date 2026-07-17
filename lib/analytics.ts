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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthog: any = null;

let initialized = false;

/* ── Init ─────────────────────────────────────────────────────────── */

export async function initAnalytics() {
  if (initialized) return;
  if (typeof window === "undefined") return;

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

  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: true,          // auto-track page views
    capture_pageleave: true,         // track when user leaves
    autocapture: false,              // we define events explicitly
    persistence: "localStorage+cookie",
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
  posthog.identify(userId, traits);
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

/* ── Events ───────────────────────────────────────────────────────── */

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(event, properties);
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
  pageViewed: (path: string) =>
    trackEvent("$pageview", { $current_url: path }),

  searchUsed: (query: string) =>
    trackEvent("search_used", { query_length: query.length }),
};
