import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../_lib/auth";
import { getAccessTokenInfo } from "@/lib/services/google-api";
import {
  emptySheetsIntel,
  fetchSheetsIntel,
  SheetsIntel,
  SheetsStatus,
} from "@/lib/agent/intelligence/sheets";

function tokenStatusToSheets(status: string): SheetsStatus {
  switch (status) {
    case "decrypt_failed":
      return "decrypt_failed";
    case "no_refresh_token":
    case "refresh_failed":
      return "expired_token";
    case "not_connected":
    case "no_credentials":
      return "not_connected";
    default:
      return "api_error";
  }
}

async function markActive(supabase: SupabaseClient, userId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("agent_connections")
    .update({ connected: true, status: "active", last_sync_at: now, error_message: null, updated_at: now })
    .eq("user_id", userId)
    .eq("module", "google_sheets");
}

function summaryLine(intel: SheetsIntel): string {
  if (!intel.connected) return `Google Sheets no operativo (${intel.status}). ${intel.error_message ?? ""}`.trim();
  const parts: string[] = [];
  const name = intel.active_sheet?.name || "hoja activa";
  parts.push(`Hoja "${name}"`);
  parts.push(`${intel.rows_analyzed} filas`);
  parts.push(`detección: ${intel.detection_confidence}`);
  if (intel.sales_summary?.today) {
    parts.push(`hoy ${intel.sales_summary.today.revenue.toFixed(0)}€`);
  } else if (intel.sales_summary?.yesterday) {
    parts.push(`ayer ${intel.sales_summary.yesterday.revenue.toFixed(0)}€`);
  }
  if (intel.alerts.length > 0) parts.push(`${intel.alerts.length} alerta(s)`);
  return parts.join(" · ");
}

interface SheetsConnectionConfig {
  active_sheet_id?: string;
  active_sheet_name?: string;
  target_spreadsheet_id?: string;
  target_spreadsheet_name?: string;
}

/**
 * GET /api/agent/sheets/summary?user_id=xxx
 *
 * Enriched Sheets intel: schema-detected columns, sales summary, top products,
 * alerts. If schema detection isn't confident, sales_summary/top_products
 * are null and detection_confidence='low' — we never invent numbers.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config")
      .eq("user_id", userId)
      .eq("module", "google_sheets")
      .maybeSingle();

    if (!connection || !connection.connected) {
      const intel = emptySheetsIntel("not_connected", "Google Sheets not connected");
      return NextResponse.json({
        ok: true,
        ...intel,
        summary:
          "Google Sheets no conectado — conecta tu cuenta en Ajustes > Integraciones para leer datos financieros o de inventario.",
        last_sync_at: null,
      });
    }

    const tokenInfo = await getAccessTokenInfo(supabase, userId, "google_sheets");
    if (tokenInfo.status !== "active" || !tokenInfo.token) {
      const intel = emptySheetsIntel(tokenStatusToSheets(tokenInfo.status), tokenInfo.error_message);
      return NextResponse.json({
        ok: true,
        ...intel,
        summary: `Google Sheets no operativo (${tokenInfo.status}). ${tokenInfo.error_message ?? ""}`.trim(),
        last_sync_at: new Date().toISOString(),
      });
    }

    let config: SheetsConnectionConfig | null = null;
    const raw = connection.config;
    if (raw) {
      try {
        config = typeof raw === "string" ? (JSON.parse(raw) as SheetsConnectionConfig) : (raw as SheetsConnectionConfig);
      } catch {
        config = null;
      }
    }

    const intel = await fetchSheetsIntel({ accessToken: tokenInfo.token, config });
    if (intel.connected) await markActive(supabase, userId);

    return NextResponse.json({
      ok: true,
      ...intel,
      summary: summaryLine(intel),
      last_sync_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/sheets/summary] Unexpected error:", message);
    return NextResponse.json({
      ok: true,
      ...emptySheetsIntel("api_error", message),
      summary: `Google Sheets no operativo (error inesperado). ${message}`,
      last_sync_at: new Date().toISOString(),
    });
  }
}
