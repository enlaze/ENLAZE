"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initAnalytics, identifyUser, analytics } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";
import { createClient } from "@/lib/supabase-browser";

/**
 * Initializes PostHog on mount and tracks route changes.
 * Drop into the root layout — does nothing if NEXT_PUBLIC_POSTHOG_KEY is unset.
 */
export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Init PostHog and identify user on mount (Sentry inits via instrumentation files)
  useEffect(() => {
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
    if (pathname) {
      analytics.pageViewed(pathname);
    }
  }, [pathname]);

  return <>{children}</>;
}
