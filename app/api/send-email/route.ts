import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { to, subject, message, clientName } = await request.json();

    if (!to || !subject || !message) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const { data, error } = await resend.emails.send({
      from: "Enlaze <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: \`
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-block; background: #0f2744; border-radius: 12px; padding: 8px 16px;">
              <span style="color: #00c896; font-weight: bold; font-size: 18px;">Enlaze</span>
            </div>
          </div>
          <div style="background: #f4f7fa; border-radius: 16px; padding: 32px; border: 1px solid #e8eef4;">
            <p style="color: #0a1929; margin: 0 0 8px 0;">Hola \${clientName || ""},</p>
            <div style="color: #3b5068; line-height: 1.7; white-space: pre-wrap;">\${message}</div>
          </div>
          <p style="text-align: center; color: #8899a8; font-size: 12px; margin-top: 24px;">Enviado con Enlaze</p>
        </div>
      \`,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
