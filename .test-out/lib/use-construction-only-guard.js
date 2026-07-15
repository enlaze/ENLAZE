"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useConstructionOnlyGuard = useConstructionOnlyGuard;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const sector_context_1 = require("@/lib/sector-context");
const sector_config_1 = require("@/lib/sector-config");
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
function useConstructionOnlyGuard() {
    const router = (0, navigation_1.useRouter)();
    const { sectorKey, loading } = (0, sector_context_1.useSector)();
    const isConstruction = (0, sector_config_1.normalizeSector)(sectorKey) === "construccion";
    (0, react_1.useEffect)(() => {
        if (!loading && !isConstruction) {
            router.replace("/dashboard");
        }
    }, [loading, isConstruction, router]);
    return !loading && isConstruction;
}
