import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getValidAccessToken } from "@/lib/services/google-api";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    // Verify authenticated session
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;

    // Check if Sheets module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected")
      .eq("user_id", userId)
      .eq("module", "google_sheets")
      .maybeSingle();

    if (!connection || !connection.connected) {
      return NextResponse.json({ error: "Google Sheets no está conectado." }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(supabase, userId, "google_sheets");
    if (!accessToken) {
      return NextResponse.json({ error: "No se pudo obtener el token de acceso de Google." }, { status: 401 });
    }

    // Fetch the 20 most recently modified spreadsheets
    const driveRes = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime)", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!driveRes.ok) {
      const errData = await driveRes.json();
      console.error("[sheets/list] Drive API Error:", errData);
      return NextResponse.json({ error: "Error consultando Google Drive API" }, { status: 500 });
    }

    const driveData = await driveRes.json();
    const sheets = driveData.files || [];

    return NextResponse.json({ ok: true, sheets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/sheets/list] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}
