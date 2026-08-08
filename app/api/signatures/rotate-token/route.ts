import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { rateLimitSensitive } from "@/lib/rate-limit";

const REASON_MESSAGES: Record<string, { status: number; error: string }> = {
  signature_not_found: { status: 404, error: "Firma no encontrada" },
  not_authorized: { status: 403, error: "No autorizado sobre esta firma" },
  account_locked: { status: 409, error: "Cuenta en proceso de eliminación" },
  not_pending: { status: 409, error: "Esta firma ya no está pendiente de firmar" },
};

// POST /api/signatures/rotate-token
// Devuelve un token público NUEVO para una firma propia todavía pendiente,
// para poder construir/reconstruir el enlace público /firmar/{token} bajo
// demanda (el token solo se entrega en claro al crear la firma; el id de
// la fila es adivinable y el propio /firmar/[id] lo rechaza como
// autorización). La identidad sale SIEMPRE de la sesión, nunca del body.
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
      console.error("[signatures/rotate-token] falta configuración de service role");
      return NextResponse.json(
        { error: "El servicio de firma no está disponible en este momento." },
        { status: 503 }
      );
    }

    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const signatureId = body?.signature_id;
    if (!signatureId || typeof signatureId !== "string") {
      return NextResponse.json({ error: "Falta signature_id" }, { status: 400 });
    }

    const { data, error } = await supabaseService.rpc("rotate_signature_public_token_locked", {
      p_signature_id: signatureId,
      p_user_id: user.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as { ok: boolean; reason?: string; public_token?: string };
    if (!result.ok || !result.public_token) {
      const mapped = REASON_MESSAGES[result.reason || ""] || {
        status: 500,
        error: "No se pudo generar el enlace de firma",
      };
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    // public_token se devuelve UNA sola vez en claro; solo se guarda su hash.
    return NextResponse.json({ public_token: result.public_token });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
