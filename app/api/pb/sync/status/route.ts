/**
 * GET /api/pb/sync/status
 *
 * Returns the current sync status: last run info, total products,
 * available/stale counts, and recent sync history.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSyncStatus } from "@/lib/price-sync-v2";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
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

  try {
    const status = await getSyncStatus(supabase);

    // Also get recent runs (last 10)
    const { data: recentRuns } = await supabase
      .from("pb_sync_runs")
      .select("id, scope, status, started_at, finished_at, records_checked, records_modified, records_new, records_errors")
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      ok: true,
      ...status,
      recent_runs: recentRuns ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PriceSyncStatus] Error:", message);
    return NextResponse.json(
      { error: message || "Error al obtener estado de sync" },
      { status: 500 },
    );
  }
}
