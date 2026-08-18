/**
 * Construcción y envío de emails por la API de Gmail.
 *
 * La usan /api/send-email (un email) y /api/email/send-bulk (un envío a
 * varios clientes): montar el MIME con la firma del negocio y hablar con
 * Gmail es idéntico en ambos, y el envío masivo necesita resolver el token
 * y el perfil UNA vez, no una por destinatario.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sanitizeText } from "@/lib/sanitize";
import { getAccessTokenInfo } from "@/lib/services/google-api";

/** Remitente resuelto: token de Gmail + cómo se firma el email. */
export type GmailSender = {
  token: string;
  email: string | null;
  senderName: string;
  logoUrl: string;
};

export type GmailSenderResult =
  | { ok: true; sender: GmailSender }
  | { ok: false; error: string; code: string; status: number };

function encodeSubject(subject: string) {
  const singleLine = subject.replace(/[\r\n]+/g, " ").trim();
  return `=?UTF-8?B?${Buffer.from(singleLine, "utf8").toString("base64")}?=`;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Resuelve el token de Gmail y los datos de firma del usuario.
 * Los mensajes de error son los que ya veía el usuario antes de extraer
 * esto de la ruta /api/send-email.
 */
export async function resolveGmailSender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<GmailSenderResult> {
  const tokenInfo = await getAccessTokenInfo(supabase, userId, "gmail");
  if (!tokenInfo.token) {
    const needsReconnect = !["not_connected", "no_credentials"].includes(tokenInfo.status);
    return {
      ok: false,
      status: 409,
      code: needsReconnect ? "gmail_reconnect_required" : "gmail_not_connected",
      error: needsReconnect
        ? "La autorización de Gmail ha caducado. Reconecta Gmail en Ajustes → Integraciones."
        : "Conecta Gmail en Ajustes → Integraciones para enviar emails desde tu cuenta.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, business_name, logo_url")
    .eq("id", userId)
    .maybeSingle();

  const senderName =
    sanitizeText(profile?.business_name || profile?.full_name || "", 120) ||
    tokenInfo.email ||
    "ENLAZE";
  const logoUrl =
    typeof profile?.logo_url === "string" && /^https:\/\/[^\s]+$/i.test(profile.logo_url)
      ? profile.logo_url
      : "";

  return {
    ok: true,
    sender: { token: tokenInfo.token, email: tokenInfo.email ?? null, senderName, logoUrl },
  };
}

/** El HTML del email: cuerpo escapado + pie con la marca del negocio. */
export function buildEmailHtml(sender: GmailSender, message: string) {
  const safeMessage = escapeHtml(message);
  return `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="color:#22334e;line-height:1.7;white-space:pre-wrap">${safeMessage}</div>
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5e7eb">
          ${sender.logoUrl ? `<img src="${escapeHtml(sender.logoUrl)}" alt="${escapeHtml(sender.senderName)}" style="display:block;max-width:150px;max-height:64px;object-fit:contain;margin-bottom:10px" />` : ""}
          <div style="font-weight:700;color:#22334e">${escapeHtml(sender.senderName)}</div>
          <div style="color:#64748b;font-size:12px">${escapeHtml(sender.email || "Gmail")}</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:5px">Enviado desde ENLAZE</div>
        </div>
      </div>
    `.trim();
}

export type GmailSendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; code: string; reconnect: boolean };

/** Envía un email por Gmail y traduce los fallos de Google a texto útil. */
export async function sendGmailMessage(
  sender: GmailSender,
  to: string,
  subject: string,
  message: string
): Promise<GmailSendResult> {
  const rawMessage = [
    ...(sender.email ? [`From: ${encodeSubject(sender.senderName)} <${sender.email}>`] : []),
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    buildEmailHtml(sender, message),
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sender.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: toBase64Url(rawMessage) }),
    }
  ).catch(() => null);

  const result = response ? await response.json().catch(() => null) : null;

  if (!response || !response.ok) {
    const reconnect = response?.status === 401 || response?.status === 403;
    console.error(
      "[gmail-send] Gmail send failed",
      response?.status ?? "network",
      result?.error?.status || "unknown"
    );
    return {
      ok: false,
      reconnect,
      code: reconnect ? "gmail_reconnect_required" : "gmail_send_failed",
      error: reconnect
        ? "Gmail necesita renovar el permiso de envío. Desconéctalo y vuelve a conectarlo en Integraciones."
        : "Gmail no pudo enviar el mensaje. Inténtalo de nuevo.",
    };
  }

  return { ok: true, id: result?.id ?? null };
}
