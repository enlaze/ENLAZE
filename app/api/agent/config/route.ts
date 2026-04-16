import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * GET /api/agent/config?user_id=xxx
 * Returns the business configuration needed by the n8n agent.
 * Always returns JSON — never throws unhandled.
 */
export async function GET(req: NextRequest) {
  try {
    // --- Auth check ---
    const authHeader = req.headers.get("authorization");
    const expectedKey = process.env.AGENT_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "user_id query parameter is required" },
        { status: 400 },
      );
    }

    // --- Fetch profile from profiles table (always exists) ---
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select(
        "id, email, full_name, company_name, business_name, business_sector, business_type, city, google_place_id, coordinates, agent_keywords, competitors",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[agent/config] Supabase error:", error.message);
      return NextResponse.json(
        { error: "Database error", detail: error.message },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found for user_id" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      business_id: profile.id,
      business_name:
        profile.business_name || profile.company_name || "Mi Negocio",
      business_type: profile.business_type || "comercio",
      sector: profile.business_sector || "comercio_local",
      city: profile.city || "Madrid",
      google_place_id: profile.google_place_id || null,
      coordinates: profile.coordinates || null,
      keywords: profile.agent_keywords || [
        "comercio local",
        "pyme",
        "autónomo",
      ],
      competitors: profile.competitors || [],
      ENLAZE_BASE_URL:
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "https://enlaze.vercel.app",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/config] Unhandled error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
