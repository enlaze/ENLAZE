/**
 * GET /api/budgets/snapshots/[id]  — Get full snapshot by ID
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/budget-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
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

  const snapshot = await getSnapshot(supabase, id);

  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, snapshot });
}
