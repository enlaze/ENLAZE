import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { encryptToken } from "@/lib/crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/auth/google/callback`;

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    const stateString = req.nextUrl.searchParams.get("state");
    const error = req.nextUrl.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(new URL(`/dashboard/settings/integrations?integration_error=${error}`, req.url));
    }

    if (!code || !stateString) {
      return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
    }

    // Decode state
    let state;
    try {
      state = JSON.parse(Buffer.from(stateString, "base64").toString("utf8"));
    } catch (e) {
      return NextResponse.json({ error: "Invalid state parameter" }, { status: 400 });
    }

    const { userId, module } = state;
    if (!userId || !module) {
      return NextResponse.json({ error: "Invalid state contents" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
    );

    // Verify authenticated session matches the state userId
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return NextResponse.redirect(new URL(`/dashboard/settings?integration_error=unauthorized`, req.url));
    }

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
      console.error("Token exchange failed:", tokenData);
      return NextResponse.redirect(new URL(`/dashboard/settings/integrations?integration_error=token_exchange_failed`, req.url));
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

    const payload = {
      user_id: userId,
      module: module,
      connected: true,
      status: "connected",
      credentials_ref: credentialsObj,
      error_message: null,
      updated_at: new Date().toISOString()
    };

    if (existingConnection) {
      const { error: updateError } = await supabase
        .from("agent_connections")
        .update(payload)
        .eq("user_id", userId)
        .eq("module", module);
        
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from("agent_connections")
        .insert(payload);
        
      if (insertError) throw insertError;
    }

    return NextResponse.redirect(new URL("/dashboard/settings/integrations?integration_success=true", req.url));
  } catch (err: any) {
    console.error("Google OAuth Callback Error:", err);
    return NextResponse.redirect(new URL(`/dashboard/settings/integrations?integration_error=${encodeURIComponent(err.message)}`, req.url));
  }
}
