import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeText, sanitizeEmail, isValidUuid } from "@/lib/sanitize";
import { rateLimitSensitive, getClientIp } from "@/lib/rate-limit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    // Rate limit: 10 signature creations per minute
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const {
      user_id,
      entity_type,
      entity_id,
      signer_name,
      signer_email,
      signer_phone,
      signer_nif,
      signer_role,
      signature_image,
    } = body;

    // Validate required fields
    if (!user_id || !isValidUuid(user_id)) {
      return NextResponse.json({ error: "user_id invalido" }, { status: 400 });
    }
    if (!entity_type || !entity_id) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    // Validate entity_type against allowed values
    const allowedTypes = ["budget", "certification", "work_report", "project_act"];
    if (!allowedTypes.includes(entity_type)) {
      return NextResponse.json({ error: "Tipo de entidad no valido" }, { status: 400 });
    }

    // Sanitize inputs
    const safeName = sanitizeText(signer_name || "", 200);
    if (!safeName) {
      return NextResponse.json({ error: "Nombre del firmante requerido" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("digital_signatures")
      .insert({
        user_id,
        entity_type: sanitizeText(entity_type, 50),
        entity_id,
        signer_name: safeName,
        signer_email: sanitizeEmail(signer_email || "") || "",
        signer_phone: sanitizeText(signer_phone || "", 20),
        signer_nif: sanitizeText(signer_nif || "", 20),
        signer_role: sanitizeText(signer_role || "cliente", 50),
        signature_image: signature_image || "",
        ip_address: getClientIp(request),
        user_agent: sanitizeText(request.headers.get("user-agent") || "", 500),
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
