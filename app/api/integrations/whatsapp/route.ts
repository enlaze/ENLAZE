import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { encryptToken } from "@/lib/crypto";
import { sanitizeText } from "@/lib/sanitize";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function parseCredentials(value: unknown) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

export async function GET() {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data } = await supabase
    .from("agent_connections")
    .select("status, connected, credentials_ref")
    .eq("user_id", user.id)
    .eq("module", "whatsapp")
    .maybeSingle();
  const credentials = parseCredentials(data?.credentials_ref) as {
    phone_number_id?: string;
    whatsapp_business_account_id?: string;
    display_phone_number?: string;
    verified_name?: string;
  } | null;

  return NextResponse.json({
    connected: Boolean(
      data &&
        data.connected !== false &&
        data.status === "connected" &&
        credentials?.phone_number_id
    ),
    phone_number_id: credentials?.phone_number_id || "",
    whatsapp_business_account_id:
      credentials?.whatsapp_business_account_id || "",
    display_phone_number: credentials?.display_phone_number || "",
    verified_name: credentials?.verified_name || "",
  });
}

export async function POST(request: Request) {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const accessToken =
    typeof body.access_token === "string" ? body.access_token.trim() : "";
  const phoneNumberId = sanitizeText(body.phone_number_id, 80).replace(
    /\D/g,
    ""
  );
  const businessAccountId = sanitizeText(
    body.whatsapp_business_account_id,
    80
  ).replace(/\D/g, "");

  if (accessToken.length < 20 || !phoneNumberId) {
    return NextResponse.json(
      {
        error:
          "Introduce el token permanente y el identificador del número de teléfono de Meta.",
      },
      { status: 400 }
    );
  }

  const verifyResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
      phoneNumberId
    )}?fields=display_phone_number,verified_name`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const verification = await verifyResponse.json().catch(() => null);
  if (!verifyResponse.ok) {
    return NextResponse.json(
      {
        error:
          verification?.error?.message ||
          "Meta no ha podido verificar esos datos. Comprueba el token y el identificador del teléfono.",
      },
      { status: 400 }
    );
  }

  const credentials = {
    access_token: encryptToken(accessToken),
    phone_number_id: phoneNumberId,
    whatsapp_business_account_id: businessAccountId || null,
    display_phone_number: verification?.display_phone_number || "",
    verified_name: verification?.verified_name || "",
  };
  const { error } = await supabase.from("agent_connections").upsert(
    {
      user_id: user.id,
      module: "whatsapp",
      connected: true,
      status: "connected",
      credentials_ref: JSON.stringify(credentials),
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,module" }
  );
  if (error) {
    return NextResponse.json(
      { error: "No se pudo guardar la conexión de WhatsApp." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    connected: true,
    display_phone_number: credentials.display_phone_number,
    verified_name: credentials.verified_name,
  });
}

export async function DELETE() {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { error } = await supabase
    .from("agent_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("module", "whatsapp");
  if (error) {
    return NextResponse.json(
      { error: "No se pudo desconectar WhatsApp." },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true });
}
