/**
 * Plomería compartida de WhatsApp Cloud API (Meta Graph).
 *
 * La usan tanto /api/whatsapp/send (un mensaje) como
 * /api/whatsapp/send-bulk (un envío a varios clientes): resolver las
 * credenciales del usuario y hablar con Graph es idéntico en ambos, y
 * el envío masivo necesita resolverlas UNA vez, no una por destinatario.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeDecryptToken } from "@/lib/crypto";

export const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";

/** Deja el teléfono en dígitos, sin `00` internacional ni separadores. */
export function normalizePhone(value: unknown) {
  let phone = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

export type WhatsAppSender = { token: string; phoneNumberId: string };

export type CredentialsResult =
  | { ok: true; sender: WhatsAppSender }
  | { ok: false; error: string; code?: string; status: number };

/**
 * Lee la conexión de WhatsApp del usuario y descifra el token.
 * Los mensajes de error son los que ya veía el usuario antes de
 * extraer esto de la ruta /api/whatsapp/send.
 */
export async function resolveWhatsAppSender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<CredentialsResult> {
  const { data: connection } = await supabase
    .from("agent_connections")
    .select("credentials_ref, connected, status")
    .eq("user_id", userId)
    .eq("module", "whatsapp")
    .maybeSingle();

  if (
    !connection ||
    connection.connected === false ||
    connection.status !== "connected" ||
    !connection.credentials_ref
  ) {
    return {
      ok: false,
      status: 409,
      code: "whatsapp_not_connected",
      error:
        "Conecta WhatsApp Business en Ajustes → Integraciones antes de enviar mensajes.",
    };
  }

  let credentials: { access_token?: string; phone_number_id?: string };
  try {
    credentials =
      typeof connection.credentials_ref === "string"
        ? JSON.parse(connection.credentials_ref)
        : connection.credentials_ref;
  } catch {
    return {
      ok: false,
      status: 409,
      error: "La conexión de WhatsApp no es válida. Vuelve a conectarla.",
    };
  }

  const decrypted = credentials.access_token
    ? safeDecryptToken(credentials.access_token)
    : null;
  if (!decrypted?.ok || !credentials.phone_number_id) {
    return {
      ok: false,
      status: 409,
      error: "La conexión de WhatsApp ha caducado. Vuelve a conectarla.",
    };
  }

  return {
    ok: true,
    sender: { token: decrypted.plaintext, phoneNumberId: credentials.phone_number_id },
  };
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; code: string };

/** Envía un mensaje de texto por la Cloud API. */
export async function sendWhatsAppText(
  sender: WhatsAppSender,
  to: string,
  message: string
): Promise<SendResult> {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
      sender.phoneNumberId
    )}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sender.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: message },
      }),
    }
  ).catch(() => null);

  const result = response ? await response.json().catch(() => null) : null;

  if (!response || !response.ok) {
    const metaCode = result?.error?.code;
    const outsideWindow =
      metaCode === 131047 ||
      /24.hour|customer service window|plantilla|template/i.test(
        result?.error?.message || ""
      );
    return {
      ok: false,
      code: outsideWindow ? "whatsapp_template_required" : "whatsapp_send_failed",
      error: outsideWindow
        ? "WhatsApp exige una plantilla aprobada porque han pasado más de 24 horas desde el último mensaje del cliente."
        : result?.error?.message || "Meta no pudo enviar el mensaje de WhatsApp.",
    };
  }

  return { ok: true, id: result?.messages?.[0]?.id || null };
}
