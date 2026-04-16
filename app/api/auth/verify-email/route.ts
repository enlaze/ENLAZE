import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { verifyToken } from "@/lib/email-service";
import { logError } from "@/lib/error-handler";

/**
 * POST /api/auth/verify-email
 * Verifies email token and updates user's email_verified status
 *
 * Request body:
 * {
 *   token: string (required)
 *   email: string (required)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   message: string
 *   redirect?: string (if successful)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { token, email } = await request.json();

    if (!token || !email) {
      return NextResponse.json(
        {
          success: false,
          message: "Token y email son requeridos",
        },
        { status: 400 }
      );
    }

    // Verify the token
    const tokenValidation = verifyToken(token);

    if (!tokenValidation.valid) {
      if (tokenValidation.expired) {
        return NextResponse.json(
          {
            success: false,
            message: "El enlace de verificación ha expirado. Solicita uno nuevo.",
            expired: true,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: "El enlace de verificación es inválido",
        },
        { status: 400 }
      );
    }

    // Verify email matches
    if (tokenValidation.email !== email) {
      return NextResponse.json(
        {
          success: false,
          message: "El email no coincide con el token",
        },
        { status: 400 }
      );
    }

    // Get Supabase admin client (server-side)
    const supabase = await createClient();

    // Get the current user from the token (using auth.getUser() with the session token)
    // In this case, we need to update based on the email provided
    const { data: userData, error: userError } =
      await supabase.auth.admin.listUsers();

    if (userError) {
      logError(userError, {
        component: "verify-email",
        action: "listUsers",
        context: { email },
      });

      return NextResponse.json(
        {
          success: false,
          message: "Error al verificar el email",
        },
        { status: 500 }
      );
    }

    // Find user by email
    const user = userData?.users?.find((u) => u.email === email);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Usuario no encontrado",
        },
        { status: 404 }
      );
    }

    // Update user metadata to mark email as verified
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...user.user_metadata,
          email_verified: true,
          email_verified_at: new Date().toISOString(),
        },
      }
    );

    if (updateError) {
      logError(updateError, {
        component: "verify-email",
        action: "updateUserById",
        context: { email, userId: user.id },
      });

      return NextResponse.json(
        {
          success: false,
          message: "Error al actualizar el estado de verificación",
        },
        { status: 500 }
      );
    }

    // Try to update the users table if it exists (optional)
    try {
      const { error: tableError } = await supabase
        .from("users")
        .update({
          email_verified: true,
          email_verified_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      // Log but don't fail if table doesn't exist or other errors
      if (tableError && tableError.code !== "PGRST116") {
        console.warn(
          "[VERIFY_EMAIL] Warning updating users table:",
          tableError
        );
      }
    } catch (error) {
      // Silently continue if users table doesn't exist
      console.warn("[VERIFY_EMAIL] Users table operation skipped");
    }

    return NextResponse.json(
      {
        success: true,
        message: "Email verificado correctamente",
        redirect: "/dashboard",
      },
      { status: 200 }
    );
  } catch (error) {
    logError(error, {
      component: "verify-email",
      action: "POST",
    });

    return NextResponse.json(
      {
        success: false,
        message: "Error al verificar el email",
      },
      { status: 500 }
    );
  }
}
