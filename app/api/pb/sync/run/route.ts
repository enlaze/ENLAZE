/**
 * POST /api/pb/sync/run
 *
 * Triggers a price sync run. Can be called manually from the UI
 * or by a cron job / Supabase edge function.
 *
 * Auth: cookie-based (user) OR a server-side Bearer token (cron)
 *
 * Body (all optional):
 *   - scope: "all" | "source" | "provider"
 *   - scope_id: string (if scope != "all")
 *   - staleness_days: number (default 30)
 *   - change_threshold_pct: number (default 5)
 *   - idempotency_key: string (e.g. "daily-2026-07-16")
 *   - resume_after_id: string (cursor returned by a partial run)
 *   - time_budget_ms: number (default 240000)
 */
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { bearerMatchesToken } from "@/lib/price-sync-auth";
import { runPriceSync, type SyncConfig } from "@/lib/price-sync-v2";
import { requireWriteAccess } from "@/lib/subscription";

// A full catalogue pass currently covers more than 42,000 active products.
// Keep the platform limit explicit so scheduled runs can finish after the
// paginated reads and batched writes in the sync engine.
export const maxDuration = 300;

export async function POST(request: Request) {
  // Try Bearer auth first (cron/agent), then cookie auth (user)
  const authHeader = request.headers.get("authorization") || "";
  const validTokens = [
    process.env.PRICE_SYNC_TOKEN,
    process.env.WEBHOOK_SECRET,
    process.env.AGENT_API_KEY,
  ];
  const isCronAuth = bearerMatchesToken(authHeader, validTokens);

  let supabase;

  if (isCronAuth) {
    // Cron/agent: use service role for full access
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  } else {
    // User: cookie-based auth
    const cookieStore = await cookies();
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set() {},
          remove() {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Muro de pago: lanzar una sincronización de precios es de Profesional/Empresa.
    const blocked = await requireWriteAccess(user.id, "seguimiento_precios");
    if (blocked) return blocked;

    // La sincronización escribe el catálogo GLOBAL (pb_price_current,
    // pb_sync_runs), que desde 20260924113527 solo puede escribir
    // service_role. Ya comprobados sesión y plan, corre como sistema,
    // igual que la rama del cron.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Sincronización no configurada" }, { status: 503 });
    }
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  try {
    const body = await request.json().catch(() => ({}));

    const config: Partial<SyncConfig> = {};
    if (body.scope) config.scope = body.scope;
    if (body.scope_id) config.scope_id = body.scope_id;
    if (body.staleness_days) config.staleness_days = Number(body.staleness_days);
    if (body.change_threshold_pct) config.change_threshold_pct = Number(body.change_threshold_pct);
    if (body.idempotency_key) config.idempotency_key = body.idempotency_key;
    if (body.resume_after_id) config.resume_after_id = String(body.resume_after_id);
    if (body.time_budget_ms !== undefined) {
      const timeBudgetMs = Number(body.time_budget_ms);
      if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 1_000 || timeBudgetMs > 270_000) {
        return NextResponse.json(
          { error: "time_budget_ms debe estar entre 1000 y 270000" },
          { status: 400 },
        );
      }
      config.time_budget_ms = timeBudgetMs;
    }

    // Auto-generate daily idempotency key if not provided and called by cron
    if (isCronAuth && !config.idempotency_key) {
      config.idempotency_key = `daily-${new Date().toISOString().slice(0, 10)}`;
    }

    const result = await runPriceSync(supabase, config);

    return NextResponse.json({
      ok: result.status !== "error",
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PriceSyncRun] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al sincronizar precios" },
      { status: 500 },
    );
  }
}
