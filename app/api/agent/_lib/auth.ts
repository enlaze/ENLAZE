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

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Async version that allows BOTH Agent API Key OR an authenticated browser session.
 */
export async function verifyAgentOrBrowserRequest(
  req: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | NextResponse> {
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.AGENT_API_KEY;
  let isAgentCall = false;

  if (expectedKey && authHeader === `Bearer ${expectedKey}`) {
    isAgentCall = true;
  }

  let userId = req.nextUrl.searchParams.get("user_id");

  // If not an agent call, verify browser session using cookies
  if (!isAgentCall) {
    try {
      const cookieStore = await cookies();
      const serverSupabase = createServerClient(
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
      const { data: { user } } = await serverSupabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized: Invalid session or missing Agent API Key" }, { status: 401 });
      }
      // Use the authenticated user's ID if not provided, or ensure it matches
      if (!userId) userId = user.id;
      if (userId && userId !== user.id) {
        return NextResponse.json({ error: "Unauthorized: Session user does not match user_id" }, { status: 403 });
      }
    } catch (e) {
      return NextResponse.json({ error: "Unauthorized: Failed to verify session" }, { status: 401 });
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: "user_id query parameter is required" },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  return { supabase, userId };
}
