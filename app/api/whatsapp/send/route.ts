import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { safeDecryptToken } from "@/lib/crypto";
import { sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";

interface WhatsAppCredentials {
  access_token?: string;
  phone_number_id?: string;
}

function normalizePhone(value: unknown) {
  let phone = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

export async function POST(request: Request) {
  const rateLimit = rateLimitSensitive(request);
  if (!rateLimit.allowed) {
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
  const to = normalizePhone(body.to);
  const message = sanitizeText(body.message, 4096);
  if (to.length < 8 || to.length > 15 || !message) {
    return NextResponse.json(
      {
        error:
          "Revisa el teléfono del cliente (con prefijo internacional) y el mensaje.",
      },
      { status: 400 }
    );
  }

  const { data: connection } = await supabase
    .from("agent_connections")
    .select("credentials_ref, connected, status")
    .eq("user_id", user.id)
    .eq("module", "whatsapp")
    .maybeSingle();
  if (
    !connection ||
    connection.connected === false ||
    connection.status !== "connected" ||
    !connection.credentials_ref
  ) {
    return NextResponse.json(
      {
        error:
          "Conecta WhatsApp Business en Ajustes → Integraciones antes de enviar mensajes.",
        code: "whatsapp_not_connected",
      },
      { status: 409 }
    );
  }

  let credentials: WhatsAppCredentials;
  try {
    credentials =
      typeof connection.credentials_ref === "string"
        ? JSON.parse(connection.credentials_ref)
        : connection.credentials_ref;
  } catch {
    return NextResponse.json(
      { error: "La conexión de WhatsApp no es válida. Vuelve a conectarla." },
      { status: 409 }
    );
  }

  const decrypted = credentials.access_token
    ? safeDecryptToken(credentials.access_token)
    : null;
  if (!decrypted?.ok || !credentials.phone_number_id) {
    return NextResponse.json(
      { error: "La conexión de WhatsApp ha caducado. Vuelve a conectarla." },
      { status: 409 }
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
      credentials.phone_number_id
    )}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decrypted.plaintext}`,
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
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const metaCode = result?.error?.code;
    const outsideWindow =
      metaCode === 131047 ||
      /24.hour|customer service window|plantilla|template/i.test(
        result?.error?.message || ""
      );
    return NextResponse.json(
      {
        error: outsideWindow
          ? "WhatsApp exige una plantilla aprobada porque han pasado más de 24 horas desde el último mensaje del cliente."
          : result?.error?.message ||
            "Meta no pudo enviar el mensaje de WhatsApp.",
        code: outsideWindow
          ? "whatsapp_template_required"
          : "whatsapp_send_failed",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    id: result?.messages?.[0]?.id || null,
  });
}
