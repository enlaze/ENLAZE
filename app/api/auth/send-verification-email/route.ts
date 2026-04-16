import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  sendVerificationEmail,
  generateVerificationToken,
} from "@/lib/email-service";
import { logError } from "@/lib/error-handler";

/**
 * POST /api/auth/send-verification-email
 * Sends verification email to user after signup
 *
 * Request body:
 * {
 *   email: string (required)
 *   userId: string (optional, for context)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   message: string
 *   messageId?: string (if successful)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        {
          success: false,
          message: "Email inválido",
        },
        { status: 400 }
      );
    }

    // Get the site URL for verification link
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://enlaze.es";

    // Generate verification token
    const { token } = generateVerificationToken(email);

    // Build verification URL
    const verifyUrl = `${siteUrl}/verify-email?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(email)}`;

    // Send email
    const emailResult = await sendVerificationEmail({
      email,
      token,
      verifyUrl,
    });

    if (!emailResult.success) {
      logError(
        new Error(`Failed to send verification email: ${emailResult.error}`),
        {
          component: "send-verification-email",
          action: "sendVerificationEmail",
          context: { email },
        }
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "No pudimos enviar el email de verificación. Por favor, intenta de nuevo.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Email de verificación enviado correctamente",
        messageId: emailResult.messageId,
      },
      { status: 200 }
    );
  } catch (error) {
    logError(error, {
      component: "send-verification-email",
      action: "POST",
    });

    return NextResponse.json(
      {
        success: false,
        message: "Error al enviar email de verificación",
      },
      { status: 500 }
    );
  }
}
