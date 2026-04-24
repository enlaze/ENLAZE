import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const GOOGLE_REDIRECT_URI = `${APP_BASE_URL}/api/auth/google/callback`;

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: "Missing GOOGLE_CLIENT_ID" }, { status: 500 });
  }

  const moduleToConnect = req.nextUrl.searchParams.get("module") || "gmail";
  
  // Scopes based on module
  let scopes = ["https://www.googleapis.com/auth/userinfo.email"];
  if (moduleToConnect === "gmail") {
    scopes.push("https://www.googleapis.com/auth/gmail.readonly");
  } else if (moduleToConnect === "google_calendar") {
    scopes.push("https://www.googleapis.com/auth/calendar.readonly");
  } else if (moduleToConnect === "google_sheets") {
    scopes.push("https://www.googleapis.com/auth/spreadsheets.readonly");
  } else if (moduleToConnect === "google_business") {
    scopes.push("https://www.googleapis.com/auth/business.manage");
  } else if (moduleToConnect === "all") {
    scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ];
  }

  // Pass state to prevent CSRF and remember the module
  const stateObj = { userId: user.id, module: moduleToConnect };
  const stateString = Buffer.from(JSON.stringify(stateObj)).toString("base64");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.append("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.append("redirect_uri", GOOGLE_REDIRECT_URI);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("scope", scopes.join(" "));
  authUrl.searchParams.append("access_type", "offline");
  authUrl.searchParams.append("prompt", "consent"); // Force consent to ensure refresh_token is returned
  authUrl.searchParams.append("state", stateString);

  return NextResponse.redirect(authUrl.toString());
}
