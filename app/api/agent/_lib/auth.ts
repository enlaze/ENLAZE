import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Shared auth + Supabase client for all /api/agent/* endpoints.
 * Returns { supabase, userId } on success or a NextResponse error.
 */
export function verifyAgentRequest(
  req: NextRequest,
): { supabase: SupabaseClient; userId: string } | NextResponse {
  // Auth check
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.AGENT_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // user_id is required
  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json(
      { error: "user_id query parameter is required" },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  return { supabase, userId };
}

/**
 * Type guard to check if verifyAgentRequest returned an error response.
 */
export function isErrorResponse(
  result: { supabase: SupabaseClient; userId: string } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
