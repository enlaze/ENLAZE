import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
async function syncModuleState(
  supabase: any,
  userId: string,
  moduleName: string,
  data: {
    connected: boolean;
    status: string;
    error_message?: string | null;
  }
) {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("agent_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("module", moduleName)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("agent_connections")
      .update({
        connected: data.connected,
        status: data.status,
        last_sync_at: now,
        error_message: data.error_message ?? null,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("agent_connections")
      .insert({
        user_id: userId,
        module: moduleName,
        connected: data.connected,
        status: data.status,
        last_sync_at: now,
        error_message: data.error_message ?? null,
        config: {},
        created_at: now,
        updated_at: now,
      });
  }
}

/**
 * GET /api/agent/gmail/summary?user_id=xxx
 *
 * Returns Gmail inbox summary with automation-ready data:
 * - Unread count and priority threads
 * - Emails awaiting reply (detected by heuristic)
 * - Supplier/customer/invoice categorization
 * - Suggested replies for important threads
 * - Actionable items extracted from emails
 *
 * Graceful degradation: if not connected → connected:false + empty structures.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Check if Gmail module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at, credentials_ref")
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
        suggested_replies: [],
        action_items: [],
        summary:
          "Gmail no conectado — conecta tu cuenta en Ajustes > Integraciones para recibir resumen de bandeja, detección de emails pendientes y sugerencias de respuesta.",
      });
    }

    // ── Gmail IS connected ──
    // TODO: Replace with real Gmail API calls when OAuth is configured.
    // The structure below is the production contract that the n8n workflow expects.
    // When implementing, categorize emails by:
    //   - supplier_messages: from known suppliers (match against user's supplier list)
    //   - customer_messages: from customers or containing order/booking keywords
    //   - invoice_messages: containing "factura", "invoice", "pago" keywords
    //   - priority_threads: starred or from important contacts
    //   - awaiting_reply: sent by user > 48h ago with no response
await syncModuleState(supabase, userId, "gmail", {
  connected: true,
  status: "active",
  error_message: null,
});
await syncModuleState(supabase, userId, "gmail", {
  connected: true,
  status: "active",
  error_message: null,
});

return NextResponse.json({
  ok: true,
  connected: true,
  unread_count: 0,
  priority_threads: [],
  awaiting_reply: [],
  supplier_messages: [],
  customer_messages: [],
  invoice_messages: [],
  suggested_replies: [],
  action_items: [],
  summary:
    "Gmail conectado — sin datos nuevos. La integración completa con Gmail API se activará cuando configures credenciales.",
  last_sync_at: new Date().toISOString(),
});

} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Agent/gmail/summary] Error:", message);
  return NextResponse.json(
    { error: "Internal server error", detail: message },
    { status: 500 }
  );
}


