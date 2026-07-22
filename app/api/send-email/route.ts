import { Resend } from "resend";
import { NextResponse } from "next/server";
import { escapeHtml, sanitizeEmail, sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive, getClientIp } from "@/lib/rate-limit";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    // Rate limit: 10 emails per minute per IP
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const to = sanitizeEmail(body.to);
    const subject = sanitizeText(body.subject, 200);
    const message = sanitizeText(body.message, 5000);
    const clientName = sanitizeText(body.clientName, 100);

    if (!to) {
      return NextResponse.json({ error: "Email de destino invalido" }, { status: 400 });
    }
    if (!subject || !message) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    // Escape HTML in user-provided content to prevent XSS
    const safeClientName = escapeHtml(clientName || "");
    const safeMessage = escapeHtml(message);
    const safeSubject = escapeHtml(subject);

    const htmlContent = `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; background: #0f2744; border-radius: 12px; padding: 8px 16px;">
            <span style="color: #00c896; font-weight: bold; font-size: 18px;">Enlaze</span>
          </div>
        </div>
        <div style="background: #f4f7fa; border-radius: 16px; padding: 32px; border: 1px solid #e8eef4;">
          <p style="color: #0a1929; margin: 0 0 8px 0;">Hola ${safeClientName},</p>
          <div style="color: #3b5068; line-height: 1.7; white-space: pre-wrap;">${safeMessage}</div>
        </div>
        <p style="text-align: center; color: #8899a8; font-size: 12px; margin-top: 24px;">Enviado con Enlaze</p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: "Enlaze <onboarding@resend.dev>",
      to: [to],
      subject: safeSubject,
      html: htmlContent,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
