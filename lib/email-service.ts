import { Resend } from "resend";

/**
 * Email verification service
 * Handles sending and managing email verification tokens
 */

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailVerificationPayload {
  email: string;
  token: string;
  verifyUrl: string;
}

/**
 * Send email verification email via Resend
 * Token is valid for 24 hours
 */
export async function sendVerificationEmail({
  email,
  token,
  verifyUrl,
}: EmailVerificationPayload): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  try {
    if (!process.env.RESEND_API_KEY) {
      return {
        success: false,
        error: "RESEND_API_KEY no está configurado",
      };
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verifica tu email en Enlaze</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background-color: #f4f7fa;">
        <div style="background-color: #f4f7fa; padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh;">
          <div style="background: white; border-radius: 16px; max-width: 600px; width: 100%; padding: 40px; box-shadow: 0 2px 8px rgba(10, 25, 41, 0.08); border: 1px solid #e8eef4;">

            <!-- Header with logo -->
            <div style="text-align: center; margin-bottom: 40px;">
              <div style="display: inline-block; background: #0f2744; border-radius: 12px; padding: 8px 16px; margin-bottom: 24px;">
                <span style="color: #00c896; font-weight: bold; font-size: 20px;">Enlaze</span>
              </div>
              <h1 style="color: #0a1929; font-size: 28px; font-weight: 700; margin: 0; margin-bottom: 8px;">Verifica tu email</h1>
              <p style="color: #5a7185; font-size: 16px; margin: 0;">Completa tu registro en Enlaze</p>
            </div>

            <!-- Main content -->
            <div style="color: #3b5068; line-height: 1.6; margin-bottom: 32px;">
              <p style="font-size: 16px; margin: 0 0 16px 0;">¡Hola!</p>
              <p style="font-size: 16px; margin: 0 0 24px 0;">Gracias por registrarte en <strong>Enlaze</strong>. Para completar tu cuenta y comenzar a automatizar tu comunicación, verifica tu email haciendo clic en el botón de abajo.</p>
              <p style="font-size: 14px; color: #8899a8; margin: 0; font-style: italic;">Este enlace es válido durante 24 horas.</p>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin-bottom: 32px;">
              <a href="${verifyUrl}" style="display: inline-block; background-color: #00c896; color: white; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0, 200, 150, 0.3); transition: background-color 0.2s; border: none; cursor: pointer;">
                Verificar Email
              </a>
            </div>

            <!-- Alternative link -->
            <div style="background-color: #f4f7fa; border-radius: 12px; padding: 16px; border: 1px solid #e8eef4; margin-bottom: 32px;">
              <p style="color: #8899a8; font-size: 12px; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 600;">O copia este enlace en tu navegador:</p>
              <p style="color: #0a1929; font-size: 13px; margin: 0; word-break: break-all; font-family: 'Courier New', monospace;">
                <a href="${verifyUrl}" style="color: #00c896; text-decoration: none;">${verifyUrl}</a>
              </p>
            </div>

            <!-- Security note -->
            <div style="background-color: #fff9e6; border-left: 4px solid #ffd700; padding: 16px; border-radius: 8px; margin-bottom: 32px;">
              <p style="color: #5a7185; font-size: 13px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no creaste una cuenta en Enlaze, puedes ignorar este email. El enlace de verificación fue solicitado desde tu dirección de email.
              </p>
            </div>

            <!-- Footer -->
            <div style="border-top: 1px solid #e8eef4; padding-top: 24px; text-align: center;">
              <p style="color: #8899a8; font-size: 12px; margin: 0;">
                © 2024 Enlaze. Todos los derechos reservados.<br>
                <a href="https://enlaze.es" style="color: #00c896; text-decoration: none;">enlaze.es</a>
              </p>
            </div>

          </div>
        </div>
      </body>
      </html>
    `;

    const { data, error } = await resend.emails.send({
      from: "noreply@enlaze.es",
      to: email,
      subject: "Verifica tu email en Enlaze | Verify your email at Enlaze",
      html: htmlContent,
      replyTo: "support@enlaze.es",
    });

    if (error) {
      console.error("[EMAIL_SERVICE] Error sending verification email:", error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido al enviar email";
    console.error("[EMAIL_SERVICE] Exception:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Generate a verification token and return it with metadata
 * Token format: base64-encoded email:timestamp:random
 * Valid for 24 hours (86400 seconds)
 */
export function generateVerificationToken(email: string): {
  token: string;
  expiresAt: Date;
} {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const tokenData = `${email}:${timestamp}:${random}`;
  const token = Buffer.from(tokenData).toString("base64");

  const expiresAt = new Date(timestamp + 24 * 60 * 60 * 1000); // 24 hours

  return { token, expiresAt };
}

/**
 * Verify and decode a verification token
 * Returns email and validation status
 */
export function verifyToken(token: string): {
  valid: boolean;
  email?: string;
  expired?: boolean;
} {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [email, timestamp] = decoded.split(":");

    if (!email || !timestamp) {
      return { valid: false };
    }

    const tokenTime = parseInt(timestamp, 10);
    const now = Date.now();
    const expirationTime = 24 * 60 * 60 * 1000; // 24 hours

    if (now - tokenTime > expirationTime) {
      return { valid: false, expired: true, email };
    }

    return { valid: true, email };
  } catch (error) {
    console.error("[EMAIL_SERVICE] Token verification error:", error);
    return { valid: false };
  }
}
