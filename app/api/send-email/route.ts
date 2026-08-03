import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { escapeHtml, sanitizeEmail, sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { getAccessTokenInfo } from "@/lib/services/google-api";

function encodeSubject(subject: string) {
  const singleLine = subject.replace(/[\r\n]+/g, " ").trim();
  return `=?UTF-8?B?${Buffer.from(singleLine, "utf8").toString("base64")}?=`;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export async function POST(request: Request) {
  try {
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados envíos. Inténtalo de nuevo en unos minutos." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const to = sanitizeEmail(body.to);
    const subject = sanitizeText(body.subject, 200);
    const message = sanitizeText(body.message, 5000);

    if (!to) {
      return NextResponse.json(
        { error: "El email del destinatario no es válido." },
        { status: 400 }
      );
    }
    if (!subject || !message) {
      return NextResponse.json(
        { error: "Completa el asunto y el mensaje." },
        { status: 400 }
      );
    }

    const tokenInfo = await getAccessTokenInfo(supabase, user.id, "gmail");
    if (!tokenInfo.token) {
      const needsReconnect = ![
        "not_connected",
        "no_credentials",
      ].includes(tokenInfo.status);
      return NextResponse.json(
        {
          error: needsReconnect
            ? "La autorización de Gmail ha caducado. Reconecta Gmail en Ajustes → Integraciones."
            : "Conecta Gmail en Ajustes → Integraciones para enviar emails desde tu cuenta.",
          code: needsReconnect
            ? "gmail_reconnect_required"
            : "gmail_not_connected",
        },
        { status: 409 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, business_name, logo_url")
      .eq("id", user.id)
      .maybeSingle();
    const senderName =
      sanitizeText(profile?.business_name || profile?.full_name || "", 120) ||
      tokenInfo.email ||
      "ENLAZE";
    const safeLogoUrl =
      typeof profile?.logo_url === "string" &&
      /^https:\/\/[^\s]+$/i.test(profile.logo_url)
        ? profile.logo_url
        : "";

    const safeMessage = escapeHtml(message);
    const htmlContent = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="color:#22334e;line-height:1.7;white-space:pre-wrap">${safeMessage}</div>
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5e7eb">
          ${safeLogoUrl ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(senderName)}" style="display:block;max-width:150px;max-height:64px;object-fit:contain;margin-bottom:10px" />` : ""}
          <div style="font-weight:700;color:#22334e">${escapeHtml(senderName)}</div>
          <div style="color:#64748b;font-size:12px">${escapeHtml(tokenInfo.email || "Gmail")}</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:5px">Enviado desde ENLAZE</div>
        </div>
      </div>
    `.trim();

    const rawMessage = [
      ...(tokenInfo.email
        ? [`From: ${encodeSubject(senderName)} <${tokenInfo.email}>`]
        : []),
      `To: ${to}`,
      `Subject: ${encodeSubject(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      htmlContent,
    ].join("\r\n");

    const gmailResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: toBase64Url(rawMessage) }),
      }
    );

    const gmailResult = await gmailResponse.json().catch(() => null);
    if (!gmailResponse.ok) {
      const reconnectRequired =
        gmailResponse.status === 401 || gmailResponse.status === 403;
      console.error(
        "[send-email] Gmail send failed",
        gmailResponse.status,
        gmailResult?.error?.status || "unknown"
      );
      return NextResponse.json(
        {
          error: reconnectRequired
            ? "Gmail necesita renovar el permiso de envío. Desconéctalo y vuelve a conectarlo en Integraciones."
            : "Gmail no pudo enviar el mensaje. Inténtalo de nuevo.",
          code: reconnectRequired
            ? "gmail_reconnect_required"
            : "gmail_send_failed",
        },
        { status: reconnectRequired ? 409 : 502 }
      );
    }

    return NextResponse.json({
      success: true,
      id: gmailResult?.id,
      provider: "gmail",
      from: tokenInfo.email || null,
    });
  } catch (error: unknown) {
    console.error("[send-email] Unexpected error", error);
    return NextResponse.json(
      { error: "No se pudo enviar el email. Inténtalo de nuevo." },
      { status: 500 }
    );
  }
}
