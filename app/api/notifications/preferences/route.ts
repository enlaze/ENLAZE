/**
 * GET /api/notifications/preferences - Fetch user notification preferences
 * POST /api/notifications/preferences - Update user notification preferences
 */

import { createClient } from "@/lib/supabase-server";
import { logError } from "@/lib/error-handler";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json(
        { success: false, message: "No autenticado" },
        { status: 401 }
      );
    }

    // Try notification_settings table first
    const { data, error } = await supabase
      .from("notification_settings")
      .select("email_notifications")
      .eq("user_id", user.id)
      .single();

    if (!error && data) {
      return Response.json({
        success: true,
        preferences: data.email_notifications || {},
      });
    }

    // Fallback: return default preferences
    const defaultPrefs = {
      client_created: true,
      budget_sent: true,
      budget_accepted: true,
      budget_rejected: false,
      invoice_paid: true,
      supplier_added: true,
      project_created: true,
      order_created: true,
    };

    return Response.json({
      success: true,
      preferences: defaultPrefs,
    });
  } catch (error) {
    logError(error, { component: "notifications/preferences", action: "GET" });
    return Response.json(
      { success: false, message: "Error al obtener preferencias" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json(
        { success: false, message: "No autenticado" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { emailNotifications } = body;

    if (!emailNotifications || typeof emailNotifications !== "object") {
      return Response.json(
        { success: false, message: "Formato inválido para emailNotifications" },
        { status: 400 }
      );
    }

    // Try to update notification_settings table
    try {
      const { error } = await supabase.from("notification_settings").upsert(
        {
          user_id: user.id,
          email_notifications: emailNotifications,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (!error) {
        return Response.json({
          success: true,
          message: "Preferencias guardadas correctamente",
          preferences: emailNotifications,
        });
      }
    } catch (tableError) {
      // Table might not exist, fall back to user_metadata
      console.warn(
        "[notifications/preferences] notification_settings table not available, using metadata"
      );
    }

    // Fallback: update user metadata
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        notification_settings: emailNotifications,
      },
    });

    if (updateError) {
      logError(updateError, {
        component: "notifications/preferences",
        action: "POST",
      });
      return Response.json(
        { success: false, message: "Error al guardar preferencias" },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: "Preferencias guardadas correctamente",
      preferences: emailNotifications,
    });
  } catch (error) {
    logError(error, { component: "notifications/preferences", action: "POST" });
    return Response.json(
      { success: false, message: "Error al guardar preferencias" },
      { status: 500 }
    );
  }
}
