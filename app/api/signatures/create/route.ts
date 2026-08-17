import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { sanitizeText, sanitizeEmail } from "@/lib/sanitize";
import { rateLimitSensitive, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429 }
      );
    }

    const supabaseService = getServiceRoleClient();
    if (!supabaseService) {
      console.error("[signatures/create] falta configuración de service role");
      return NextResponse.json(
        { error: "El servicio de firma no está disponible en este momento." },
        { status: 503 }
      );
    }

    // La identidad sale SIEMPRE de la sesión, nunca del body: un UUID
    // enviado por el cliente no puede autorizar crear una firma en nombre
    // de otra persona.
    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { entity_type, entity_id, signer_name, signer_email, signer_phone, signer_nif, signer_role } = body;

    if (!entity_type || !entity_id) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const allowedTypes = ["budget", "certification", "work_report", "project_act"];
    if (!allowedTypes.includes(entity_type)) {
      return NextResponse.json({ error: "Tipo de entidad no valido" }, { status: 400 });
    }

    const safeName = sanitizeText(signer_name || "", 200);
    if (!safeName) {
      return NextResponse.json({ error: "Nombre del firmante requerido" }, { status: 400 });
    }

    const { data, error } = await supabaseService.rpc("create_digital_signature_locked", {
      p_user_id: user.id,
      p_entity_type: sanitizeText(entity_type, 50),
      p_entity_id: entity_id,
      p_signer_name: safeName,
      p_signer_email: sanitizeEmail(signer_email || "") || "",
      p_signer_phone: sanitizeText(signer_phone || "", 20),
      p_signer_nif: sanitizeText(signer_nif || "", 20),
      p_signer_role: sanitizeText(signer_role || "cliente", 50),
      p_ip_address: getClientIp(request),
      p_user_agent: sanitizeText(request.headers.get("user-agent") || "", 500),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const result = data as { ok: boolean; signature?: { id: string }; public_token?: string };
    if (!result.ok || !result.signature || !result.public_token) {
      return NextResponse.json({ error: "No se pudo crear la firma" }, { status: 500 });
    }

    // public_token se devuelve UNA sola vez en claro; solo se guarda su hash.
    return NextResponse.json({ id: result.signature.id, public_token: result.public_token });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
