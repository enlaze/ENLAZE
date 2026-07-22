import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  try {
    const { signature_id, email } = await request.json();

    if (!signature_id || !email) {
      return NextResponse.json({ error: "Faltan signature_id y email" }, { status: 400 });
    }

    // Verify signature exists
    const { data: sig, error: sigErr } = await supabase
      .from("digital_signatures")
      .select("id, signer_name, entity_type")
      .eq("id", signature_id)
      .single();

    if (sigErr || !sig) {
      return NextResponse.json({ error: "Firma no encontrada" }, { status: 404 });
    }

    // Generate OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Save OTP
    const { error: otpErr } = await supabase.from("signature_otps").insert({
      signature_id,
      code,
      email,
      expires_at: expiresAt.toISOString(),
    });

    if (otpErr) {
      return NextResponse.json({ error: otpErr.message }, { status: 500 });
    }

    // Entity type labels
    const entityLabels: Record<string, string> = {
      budget: "presupuesto",
      certification: "certificación",
      work_report: "parte de trabajo",
      project_act: "acta de obra",
    };
    const docLabel = entityLabels[sig.entity_type] || "documento";

    // Send email with OTP
    await resend.emails.send({
      from: "Enlaze <onboarding@resend.dev>",
      to: email,
      subject: `Código de verificación para firma - Enlaze`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-block; background: #0f2744; border-radius: 12px; padding: 8px 16px;">
              <span style="color: #00c896; font-weight: bold; font-size: 18px;">Enlaze</span>
            </div>
          </div>

          <div style="background: #f4f7fa; border-radius: 16px; padding: 32px; border: 1px solid #e8eef4; text-align: center;">
            <p style="color: #0a1929; font-size: 16px; margin: 0 0 8px 0;">
              Hola ${sig.signer_name},
            </p>
            <p style="color: #3b5068; font-size: 14px; margin: 0 0 24px 0;">
              Tu código de verificación para firmar el ${docLabel} es:
            </p>

            <div style="background: #0f2744; border-radius: 12px; padding: 20px; margin: 0 auto; max-width: 200px;">
              <span style="color: #00c896; font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace;">
                ${code}
              </span>
            </div>

            <p style="color: #8899a8; font-size: 12px; margin: 24px 0 0 0;">
              Este código expira en 10 minutos.<br/>
              Si no has solicitado esta firma, ignora este email.
            </p>
          </div>

          <p style="text-align: center; color: #8899a8; font-size: 11px; margin-top: 24px;">
            Firma electrónica verificada por Enlaze
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, expires_at: expiresAt.toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
