import { NextRequest, NextResponse } from "next/server";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const body = await req.json();
    const { values, tab_name } = body;

    if (!values || !Array.isArray(values)) {
      return NextResponse.json({ error: "Missing required fields: values (array of strings)" }, { status: 400 });
    }

    // Check if Sheets module is connected and has a target_spreadsheet_id
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, config")
      .eq("user_id", userId)
      .eq("module", "google_sheets")
      .maybeSingle();

    if (!connection || !connection.connected) {
      return NextResponse.json({ error: "Google Sheets no está conectado" }, { status: 400 });
    }

    const targetSpreadsheetId = connection.config?.target_spreadsheet_id;
    if (!targetSpreadsheetId) {
      return NextResponse.json({ 
        error: "No hay hoja configurada. Por favor, selecciona una hoja en Ajustes > Integraciones antes de insertar datos." 
      }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(supabase, userId, "google_sheets");
    if (!accessToken) {
      return NextResponse.json({ error: "Sheets token missing or expired" }, { status: 401 });
    }

    const range = tab_name ? `${tab_name}!A:Z` : 'A:Z';

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [values]
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Sheets API Error: ${res.status} ${res.statusText} - ${errorText}`);
    }

    const data = await res.json();

    return NextResponse.json({
      ok: true,
      updated_range: data.updates?.updatedRange,
      message: "Fila añadida correctamente"
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/sheets/action/append-row] Error:", message);
    return NextResponse.json({ error: "Internal server error", detail: message }, { status: 500 });
  }
}
