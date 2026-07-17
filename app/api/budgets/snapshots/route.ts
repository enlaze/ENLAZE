/**
 * GET  /api/budgets/snapshots?budget_id=...   — List snapshots for a budget
 * POST /api/budgets/snapshots                 — Create a new snapshot
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSnapshot,
  listSnapshots,
  type CreateSnapshotInput,
} from "@/lib/budget-snapshots";

async function getSupabaseAndUser() {
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

  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { supabase, user } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const budgetId = url.searchParams.get("budget_id");

  if (!budgetId) {
    return NextResponse.json({ error: "Falta budget_id" }, { status: 400 });
  }

  const snapshots = await listSnapshots(supabase, budgetId);

  return NextResponse.json({
    ok: true,
    budget_id: budgetId,
    snapshots,
    total: snapshots.length,
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { supabase, user } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();

    if (!body.budget_id || !body.items || !Array.isArray(body.items)) {
      return NextResponse.json(
        { error: "budget_id e items son obligatorios" },
        { status: 400 },
      );
    }

    const input: CreateSnapshotInput = {
      budget_id: body.budget_id,
      user_id: user.id,
      snapshot_type: body.snapshot_type || "generated",
      label: body.label,
      items: body.items,
      summary: body.summary,
      analysis: body.analysis,
      resolver_used: body.resolver_used,
      metadata: body.metadata,
    };

    const result = await createSnapshot(supabase, input);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "No se pudo crear el snapshot" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      snapshot_id: result.snapshot_id,
      version: result.version,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Snapshots] Error:", message);
    return NextResponse.json(
      { error: message || "Error al crear snapshot" },
      { status: 500 },
    );
  }
}
