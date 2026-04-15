import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * GET /api/agent/config?user_id=xxx
 * Returns the business configuration needed by the n8n agent.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.AGENT_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get user profile/settings for agent config
  const { data: user } = await supabase.auth.admin.getUserById(userId);

  // Get business config from settings (if exists)
  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return NextResponse.json({
    user_id: userId,
    business_name: user?.user?.user_metadata?.business_name || settings?.business_name || "Mi Negocio",
    business_type: settings?.business_type || "comercio",
    city: settings?.city || "Madrid",
    sector: settings?.sector || "comercio_local",
    google_place_id: settings?.google_place_id || null,
    coordinates: settings?.coordinates || null,
    keywords: settings?.agent_keywords || ["comercio local", "pyme", "autónomo"],
    competitors: settings?.competitors || [],
  });
}
