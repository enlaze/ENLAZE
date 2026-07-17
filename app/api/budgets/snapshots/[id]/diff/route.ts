/**
 * GET /api/budgets/snapshots/[id]/diff?compare_to=UUID
 *
 * Compare this snapshot with another snapshot of the same budget.
 * Returns item-by-item diff with changes, deltas, and summary.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSnapshot, diffSnapshots } from "@/lib/budget-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
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

  const { id } = await context.params;
  const url = new URL(request.url);
  const compareToId = url.searchParams.get("compare_to");

  if (!compareToId) {
    return NextResponse.json(
      { error: "Falta compare_to (ID del snapshot a comparar)" },
      { status: 400 },
    );
  }

  // Fetch both snapshots in parallel
  const [snapshotA, snapshotB] = await Promise.all([
    getSnapshot(supabase, id),
    getSnapshot(supabase, compareToId),
  ]);

  if (!snapshotA) {
    return NextResponse.json({ error: `Snapshot ${id} no encontrado` }, { status: 404 });
  }

  if (!snapshotB) {
    return NextResponse.json({ error: `Snapshot ${compareToId} no encontrado` }, { status: 404 });
  }

  // Ensure same budget
  if (snapshotA.budget_id !== snapshotB.budget_id) {
    return NextResponse.json(
      { error: "Los snapshots deben pertenecer al mismo presupuesto" },
      { status: 400 },
    );
  }

  // Order: older first (from → to)
  const [from, to] = snapshotA.version < snapshotB.version
    ? [snapshotA, snapshotB]
    : [snapshotB, snapshotA];

  const diff = diffSnapshots(from, to);

  return NextResponse.json({ ok: true, diff });
}
