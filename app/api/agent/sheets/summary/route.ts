import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";

export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Check if Sheets module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "google_sheets")
      .maybeSingle();

    if (!connection || !connection.connected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        spreadsheet_id: null,
        spreadsheet_name: null,
        detected_columns: [],
        sample_data: [],
        summary: "Google Sheets no conectado — conecta tu cuenta en Ajustes > Integraciones para leer datos financieros o de inventario.",
      });
    }

    const accessToken = await getValidAccessToken(supabase, userId, "google_sheets");
    if (!accessToken) {
      return NextResponse.json({
        ok: false,
        connected: false,
        error: "Google token missing or expired.",
      }, { status: 401 });
    }

    // Phase 1: If user configured a specific sheet ID in config, use it. Otherwise, search recent sheets.
    let targetSpreadsheetId = connection.config?.target_spreadsheet_id;
    let spreadsheetName = connection.config?.target_spreadsheet_name || "Hoja configurada";
    let isFallback = false;

    if (!targetSpreadsheetId) {
      isFallback = true;
      // Fallback: search for the latest modified spreadsheet
      const driveRes = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&orderBy=modifiedTime desc&pageSize=1", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!driveRes.ok) {
        throw new Error(`Drive API error: ${driveRes.statusText}`);
      }

      const driveData = await driveRes.json();
      if (!driveData.files || driveData.files.length === 0) {
        return NextResponse.json({
          ok: true,
          connected: true,
          spreadsheet_id: null,
          spreadsheet_name: null,
          detected_columns: [],
          sample_data: [],
          summary: "No se encontraron hojas de cálculo en tu cuenta de Google Drive.",
          last_sync_at: new Date().toISOString()
        });
      }

      targetSpreadsheetId = driveData.files[0].id;
      spreadsheetName = driveData.files[0].name;
    }

    // Phase 2: Fetch sample data from the spreadsheet (A1:E5 to detect columns)
    const sheetsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/A1:E5`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!sheetsRes.ok) {
      throw new Error(`Sheets API error: ${sheetsRes.statusText}`);
    }

    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];

    let detected_columns: string[] = [];
    let sample_data: any[] = [];
    let summaryText = `Conectado a la hoja '${spreadsheetName}'. `;

    if (rows.length > 0) {
      detected_columns = rows[0]; // Assume first row is header
      sample_data = rows.slice(1);
      summaryText += `Detectadas ${detected_columns.length} columnas principales: ${detected_columns.join(", ")}. Se han extraído ${sample_data.length} filas de muestra.`;
    } else {
      summaryText += "La hoja de cálculo parece estar vacía o no tiene datos en el rango A1:E5.";
    }

    // Update connection state to mark as successful sync
    const now = new Date().toISOString();
    await supabase
      .from("agent_connections")
      .update({
        connected: true,
        status: "active",
        last_sync_at: now,
        error_message: null,
        updated_at: now,
      })
      .eq("user_id", userId)
      .eq("module", "google_sheets");

    return NextResponse.json({
      ok: true,
      connected: true,
      spreadsheet_id: targetSpreadsheetId,
      spreadsheet_name: spreadsheetName,
      detected_columns,
      sample_data,
      summary: summaryText,
      last_sync_at: now,
      is_fallback: isFallback,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/sheets/summary] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}
