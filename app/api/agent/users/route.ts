import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * GET /api/agent/users?sector=comercio_local
 * Returns all users with agent_enabled=true for the given sector.
 * Used by the n8n workflow to iterate over users.
 */
export async function GET(req: NextRequest) {
  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    const expectedKey = process.env.AGENT_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sector = req.nextUrl.searchParams.get("sector") || "comercio_local";

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, business_name, business_type, business_sector, city, agent_enabled, agent_status, agent_last_run_at")
      .eq("agent_enabled", true)
      .eq("business_sector", sector)
      .order("business_name");

    if (error) {
      console.error("[agent/users] Supabase error:", error.message);
      return NextResponse.json(
        { error: "Database error", detail: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      sector,
      count: users?.length || 0,
      users: (users || []).map((u) => ({
        user_id: u.id,
        business_name: u.business_name || "Sin nombre",
        business_type: u.business_type || "comercio",
        city: u.city || "",
        agent_status: u.agent_status || "idle",
        agent_last_run_at: u.agent_last_run_at,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/users] Unhandled error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
