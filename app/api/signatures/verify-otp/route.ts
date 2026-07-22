import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { signature_id, code } = await request.json();

    if (!signature_id || !code) {
      return NextResponse.json({ error: "Faltan signature_id y code" }, { status: 400 });
    }

    // Find the latest unused OTP for this signature
    const { data: otp, error: otpErr } = await supabase
      .from("signature_otps")
      .select("*")
      .eq("signature_id", signature_id)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpErr || !otp) {
      return NextResponse.json({ error: "No hay código OTP pendiente" }, { status: 404 });
    }

    // Check expiry
    if (new Date(otp.expires_at) < new Date()) {
      return NextResponse.json({ error: "El código ha expirado. Solicita uno nuevo." }, { status: 410 });
    }

    // Check max attempts
    if (otp.attempts >= 5) {
      return NextResponse.json({ error: "Demasiados intentos. Solicita un nuevo código." }, { status: 429 });
    }

    // Increment attempts
    await supabase
      .from("signature_otps")
      .update({ attempts: otp.attempts + 1 })
      .eq("id", otp.id);

    // Verify code
    if (otp.code !== code.trim()) {
      return NextResponse.json(
        { error: `Código incorrecto. Te quedan ${4 - otp.attempts} intentos.` },
        { status: 401 }
      );
    }

    // Mark OTP as used
    await supabase
      .from("signature_otps")
      .update({ used: true, used_at: new Date().toISOString() })
      .eq("id", otp.id);

    // Mark signature as verified and signed
    const now = new Date().toISOString();
    await supabase
      .from("digital_signatures")
      .update({
        otp_verified: true,
        otp_verified_at: now,
        status: "signed",
        signed_at: now,
        updated_at: now,
      })
      .eq("id", signature_id);

    return NextResponse.json({ success: true, signed_at: now });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
