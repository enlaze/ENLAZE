import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { sanitizeText } from "@/lib/sanitize";
import { rateLimitAuth } from "@/lib/rate-limit";
import { hashSignatureToken } from "@/lib/signature-token";
import crypto from "crypto";

const REASON_MESSAGES: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "No hay código OTP pendiente" },
  account_locked: { status: 409, error: "La cuenta está en proceso de eliminación." },
  already_used: { status: 410, error: "El código ya se ha utilizado. Solicita uno nuevo." },
  expired: { status: 410, error: "El código ha expirado. Solicita uno nuevo." },
  too_many_attempts: { status: 429, error: "Demasiados intentos. Solicita un nuevo código." },
};

export async function POST(request: Request) {
  try {
    // Strict rate limit: 5 OTP verifications per minute per IP
    const rl = rateLimitAuth(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos." },
        { status: 429 }
      );
    }

    const supabase = getServiceRoleClient();
    if (!supabase) {
      console.error("[signatures/verify-otp] falta configuración de service role");
      return NextResponse.json(
        { error: "El servicio de firma no está disponible en este momento." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";
    const code = sanitizeText(body.code || "", 6);

    if (!token) {
      return NextResponse.json({ error: "Falta token" }, { status: 400 });
    }
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Código invalido" }, { status: 400 });
    }

    const { data: sig, error: sigErr } = await supabase
      .from("digital_signatures")
      .select("id, status")
      .eq("public_token_hash", hashSignatureToken(token))
      .single();
    if (sigErr || !sig) {
      return NextResponse.json({ error: "Firma no encontrada" }, { status: 404 });
    }
    if (sig.status !== "pending") {
      return NextResponse.json({ error: "Esta firma ya se ha completado" }, { status: 409 });
    }

    // Find the latest unused OTP for this signature
    const { data: otp, error: otpErr } = await supabase
      .from("signature_otps")
      .select("id")
      .eq("signature_id", sig.id)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpErr || !otp) {
      return NextResponse.json({ error: "No hay código OTP pendiente" }, { status: 404 });
    }

    // Atomically re-validates not-used/not-expired/attempts and increments
    // attempts, checking the account-deletion lock server-side.
    const { data: attemptResult, error: attemptErr } = await supabase.rpc(
      "record_signature_otp_attempt_locked",
      { p_otp_id: otp.id }
    );
    if (attemptErr) {
      return NextResponse.json({ error: attemptErr.message }, { status: 500 });
    }
    const attempt = attemptResult as { ok: boolean; reason?: string; otp?: { code: string; attempts: number } };
    if (!attempt.ok || !attempt.otp) {
      const mapped = REASON_MESSAGES[attempt.reason || ""] || { status: 400, error: "No se pudo verificar el código" };
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    // Verify code using timing-safe comparison to prevent timing attacks
    const codeMatch = crypto.timingSafeEqual(
      Buffer.from(attempt.otp.code),
      Buffer.from(code.trim().padEnd(attempt.otp.code.length))
    );
    if (!codeMatch) {
      return NextResponse.json(
        { error: `Código incorrecto. Te quedan ${Math.max(0, 5 - attempt.otp.attempts)} intentos.` },
        { status: 401 }
      );
    }

    // Only marks digital_signatures as signed if a conditioned UPDATE on
    // signature_otps confirms, in the same statement, that the OTP belongs
    // to this signature, is unused, unexpired and within the attempt limit.
    const { data: signResult, error: signErr } = await supabase.rpc(
      "mark_signature_signed_locked",
      { p_otp_id: otp.id, p_signature_id: sig.id }
    );
    if (signErr) {
      return NextResponse.json({ error: signErr.message }, { status: 500 });
    }
    const signed = signResult as { ok: boolean; reason?: string; signed_at?: string };
    if (!signed.ok) {
      const mapped = REASON_MESSAGES[signed.reason || ""] || { status: 400, error: "No se pudo verificar el código" };
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, signed_at: signed.signed_at });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
