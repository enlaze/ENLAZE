"use client";

import { useConstructionOnlyGuard } from "@/lib/use-construction-only-guard";

/**
 * Route guard for the whole budgets segment. Budgets are a construction-native
 * concept; for comercio_local the module is gated off (reversible product
 * decision). This single layer protects every budget route — list, new, [id]
 * and generate — against direct URL access or stale links, redirecting any
 * non-construccion sector back to /dashboard. Construction is unaffected.
 */
export default function BudgetsLayout({ children }: { children: React.ReactNode }) {
  const allowed = useConstructionOnlyGuard();
  if (!allowed) return null;
  return <>{children}</>;
}
