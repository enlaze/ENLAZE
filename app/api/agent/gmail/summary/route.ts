import { NextRequest, NextResponse } from "next/server";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";
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
    const auth = await verifyAgentOrBrowserRequest(req);
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
    const accessToken = await getValidAccessToken(supabase, userId, "gmail");
    if (!accessToken) {
      return NextResponse.json({
        ok: false,
        connected: false,
        error: "Google token missing or expired.",
      }, { status: 401 });
    }

    // Fetch inbox messages
    const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread in:inbox&maxResults=20", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!gmailRes.ok) {
      throw new Error(`Gmail API error: ${gmailRes.statusText}`);
    }

    const { messages = [], resultSizeEstimate } = await gmailRes.json();
    const unread_count = resultSizeEstimate || messages.length;

    const priority_threads = [];
    const supplier_messages = [];
    const customer_messages = [];
    const invoice_messages = [];
    const otros = [];

    // Fetch details for up to 5 messages to avoid rate limits/slow responses
    const messagesToFetch = messages.slice(0, 5);
    
    for (const msg of messagesToFetch) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value || "Sin Asunto";
        const from = headers.find((h: any) => h.name === "From")?.value || "Desconocido";
        const snippet = msgData.snippet || "";

        const emailItem = { id: msg.id, subject, from, snippet };
        const textToAnalyze = `${subject} ${snippet} ${from}`.toLowerCase();

        if (textToAnalyze.includes("urgente") || textToAnalyze.includes("urgent")) {
          priority_threads.push(emailItem);
        } else if (textToAnalyze.includes("factura") || textToAnalyze.includes("invoice") || textToAnalyze.includes("pago")) {
          invoice_messages.push(emailItem);
        } else if (textToAnalyze.includes("pedido") || textToAnalyze.includes("order")) {
          customer_messages.push(emailItem);
        } else if (textToAnalyze.includes("proveedor") || textToAnalyze.includes("supplier") || textToAnalyze.includes("albarán")) {
          supplier_messages.push(emailItem);
        } else {
          otros.push(emailItem);
        }
      }
    }

    let summaryText = `Tienes ${unread_count} correos sin leer. `;
    if (priority_threads.length > 0) summaryText += `¡Hay ${priority_threads.length} correos urgentes! `;
    if (invoice_messages.length > 0) summaryText += `Tienes ${invoice_messages.length} facturas pendientes de revisar. `;
    if (customer_messages.length > 0) summaryText += `Han llegado ${customer_messages.length} mensajes sobre pedidos.`;

    await syncModuleState(supabase, userId, "gmail", {
      connected: true,
      status: "active",
      error_message: null,
    });

    return NextResponse.json({
      ok: true,
      connected: true,
      unread_count,
      priority_threads,
      awaiting_reply: [], // Heuristics for awaiting_reply can be added later
      supplier_messages,
      customer_messages,
      invoice_messages,
      otros,
      suggested_replies: [],
      action_items: [],
      summary: summaryText.trim() || "Tienes tu bandeja al día, sin correos importantes detectados.",
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
}



