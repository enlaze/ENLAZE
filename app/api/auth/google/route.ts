import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  createOAuthState,
  type GoogleIntegrationModule,
} from "@/lib/oauth-state";

const RAW_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_ID = RAW_GOOGLE_CLIENT_ID ? RAW_GOOGLE_CLIENT_ID.replace(/^["']|["']$/g, '').trim() : undefined;

// APP_BASE_URL will be computed inside the handler based on the request origin

export async function GET(req: NextRequest) {
  // Determine environment from request headers (more reliable than nextUrl.origin in Vercel)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const APP_BASE_URL = isLocal ? "http://localhost:3000" : "https://enlaze.vercel.app";
  const GOOGLE_REDIRECT_URI = `${APP_BASE_URL}/api/auth/google/callback`;
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const requestOrigin = `${forwardedProto || (isLocal ? "http" : "https")}://${host}`;

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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!GOOGLE_CLIENT_ID) {
    console.error("[Google OAuth Init] Missing GOOGLE_CLIENT_ID in environment variables");
    return NextResponse.json({ error: "Missing GOOGLE_CLIENT_ID" }, { status: 500 });
  }

  const moduleToConnect = (req.nextUrl.searchParams.get("module") ||
    "gmail") as GoogleIntegrationModule;
  
  // Scopes based on module
  let scopes = ["https://www.googleapis.com/auth/userinfo.email"];
  if (moduleToConnect === "gmail") {
    scopes.push("https://www.googleapis.com/auth/gmail.readonly");
    scopes.push("https://www.googleapis.com/auth/gmail.compose");
  } else if (moduleToConnect === "google_calendar") {
    scopes.push("https://www.googleapis.com/auth/calendar.readonly");
    scopes.push("https://www.googleapis.com/auth/calendar.events");
  } else if (moduleToConnect === "google_sheets") {
    scopes.push("https://www.googleapis.com/auth/spreadsheets");
    scopes.push("https://www.googleapis.com/auth/drive.readonly"); // Necesario para buscar la hoja por defecto
  } else if (moduleToConnect === "google_business") {
    scopes.push("https://www.googleapis.com/auth/business.manage");
  } else if (moduleToConnect === "all") {
    scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly"
    ];
  }

  // Pass state to prevent CSRF and remember the module + origin
  let stateString: string;
  try {
    stateString = createOAuthState({
      userId: user.id,
      module: moduleToConnect,
      returnTo: requestOrigin,
    });
  } catch (error) {
    console.error("[Google OAuth Init] Unable to create signed state", error);
    return NextResponse.redirect(
      new URL(
        "/dashboard/settings/integrations?integration_error=server_configuration",
        req.url
      )
    );
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.append("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.append("redirect_uri", GOOGLE_REDIRECT_URI);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("scope", scopes.join(" "));
  authUrl.searchParams.append("access_type", "offline");
  authUrl.searchParams.append("prompt", "consent"); // Force consent to ensure refresh_token is returned
  authUrl.searchParams.append("state", stateString);

  return NextResponse.redirect(authUrl);
}
