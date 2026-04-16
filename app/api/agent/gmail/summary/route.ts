import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/gmail/summary?user_id=xxx
 *
 * Returns Gmail inbox summary for a user.
 * If Gmail is not connected, returns connected:false with empty structures
 * so the n8n workflow can gracefully degrade.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Check if Gmail module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "gmail")
      .maybeSingle();

    if (!connection || !connection.connected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        unread_count: 0,
        priority_threads: [],
        awaiting_reply: [],
        supplier_messages: [],
        customer_messages: [],
        invoice_messages: [],
        summary: "Gmail no conectado — conecta tu cuenta para recibir resumen de bandeja.",
      });
    }

    // ── Gmail IS connected: fetch real data ──
    // TODO: Implement actual Gmail API integration when OAuth is set up.
    // For now, return a placeholder indicating the module is ready
    // but no real data is available yet.
    return NextResponse.json({
      ok: true,
      connected: true,
      unread_count: 0,
      priority_threads: [],
      awaiting_reply: [],
      supplier_messages: [],
      customer_messages: [],
      invoice_messages: [],
      summary: "Gmail conectado — sin datos nuevos por ahora.",
      last_sync_at: connection.last_sync_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/gmail/summary] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
