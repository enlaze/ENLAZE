import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { encryptToken } from "@/lib/crypto";
import { verifyOAuthState } from "@/lib/oauth-state";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  ?.replace(/^["']|["']$/g, "")
  .trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
  ?.replace(/^["']|["']$/g, "")
  .trim();

// APP_BASE_URL will be computed inside the handler based on the request origin

function isValidReturnUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.origin === "http://localhost:3000") return true;
    if (parsed.origin === "https://enlaze.vercel.app") return true;

    const host = parsed.hostname;
    if (
      parsed.protocol === "https:" &&
      host.startsWith("enlaze-") &&
      host.endsWith("-enlazes-projects.vercel.app")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // Determine environment from request headers (more reliable than nextUrl.origin in Vercel)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const APP_BASE_URL = isLocal ? "http://localhost:3000" : "https://enlaze.vercel.app";
  const GOOGLE_REDIRECT_URI = `${APP_BASE_URL}/api/auth/google/callback`;

  try {
    const code = req.nextUrl.searchParams.get("code");
    const stateString = req.nextUrl.searchParams.get("state");
    const error = req.nextUrl.searchParams.get("error");

    if (error) {
      // If we don't have safeReturnTo yet, just use APP_BASE_URL
      return NextResponse.redirect(
        new URL(
          `${APP_BASE_URL}/dashboard/settings/integrations?integration_error=${encodeURIComponent(error)}`
        )
      );
    }

    if (!code || !stateString) {
      return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
    }

    const state = verifyOAuthState(stateString);
    if (!state) {
      return NextResponse.redirect(
        new URL(
          `${APP_BASE_URL}/dashboard/settings/integrations?integration_error=invalid_or_expired_state`
        )
      );
    }
    const { userId, module, returnTo } = state;

    const safeReturnTo = (returnTo && isValidReturnUrl(returnTo)) ? returnTo : APP_BASE_URL;

    if (
      !GOOGLE_CLIENT_ID ||
      !GOOGLE_CLIENT_SECRET ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.redirect(
        new URL(
          `${safeReturnTo}/dashboard/settings/integrations?integration_error=server_configuration`
        )
      );
    }

    // The signed state was created only after an authenticated request.
    // The service client is needed because Google always returns to the
    // canonical domain while the user may be working on a Vercel alias.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error("[Google OAuth] Token exchange failed", tokenData?.error);
      return NextResponse.redirect(new URL(`${safeReturnTo}/dashboard/settings/integrations?integration_error=token_exchange_failed`));
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch user info to get email (useful for metadata)
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userInfo = await userInfoResponse.json();
    const email = userInfo.email;

    // Encrypt tokens
    const encryptedAccess = encryptToken(access_token);
    const encryptedRefresh = refresh_token ? encryptToken(refresh_token) : null;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Store in Supabase agent_connections
    // We check if it exists first to not overwrite refresh_token if Google didn't send a new one
    const { data: existingConnection } = await supabase
      .from("agent_connections")
      .select("user_id, credentials_ref")
      .eq("user_id", userId)
      .eq("module", module)
      .maybeSingle();

    let oldRefreshToken = null;
    if (existingConnection?.credentials_ref) {
      try {
        const parsed = typeof existingConnection.credentials_ref === 'string' 
          ? JSON.parse(existingConnection.credentials_ref) 
          : existingConnection.credentials_ref;
        oldRefreshToken = parsed.refresh_token;
      } catch (e) {}
    }

    const finalRefreshToken = encryptedRefresh || oldRefreshToken;

    const credentialsObj = {
      access_token: encryptedAccess,
      refresh_token: finalRefreshToken,
      expires_at: expiresAt,
      email: email
    };

    // Atomic RPC: checks the account-deletion lock and upserts in one call,
    // closing the race window a separate check-then-write would leave open.
    const { error: upsertError } = await supabase.rpc("upsert_agent_connection_locked", {
      p_user_id: userId,
      p_module: module,
      p_connected: true,
      p_status: "connected",
      p_credentials_ref: JSON.stringify(credentialsObj),
      p_error_message: null,
    });

    if (upsertError) {
      console.error("[Google OAuth] Upsert error", upsertError.code);
      throw upsertError;
    }

    return NextResponse.redirect(new URL(`${safeReturnTo}/dashboard/settings/integrations?integration_success=${module}`));
  } catch (err: unknown) {
    console.error("Google OAuth Callback Error:", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(new URL(`${APP_BASE_URL}/dashboard/settings/integrations?integration_error=${encodeURIComponent(message)}`));
  }
}
