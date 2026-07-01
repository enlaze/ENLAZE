"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSector } from "@/lib/sector-context";
import { normalizeSector } from "@/lib/sector-config";

/**
 * Budgets are a construction-native concept. For comercio_local the whole
 * module is gated off (reversible product decision — may be re-added during
 * validation). This guard protects the budget routes against direct URL access
 * or stale links: any non-construccion sector is redirected back to /dashboard.
 *
 * Returns whether the current sector may view budget routes. While the sector
 * config is still loading it returns `false` so the caller renders nothing —
 * this avoids a flash of budget UI before the redirect fires for comercio_local.
 * Construction users see at most a brief blank before the config resolves.
 */
export function useConstructionOnlyGuard(): boolean {
  const router = useRouter();
  const { sectorKey, loading } = useSector();
  const isConstruction = normalizeSector(sectorKey) === "construccion";

  useEffect(() => {
    if (!loading && !isConstruction) {
      router.replace("/dashboard");
    }
  }, [loading, isConstruction, router]);

  return !loading && isConstruction;
}
