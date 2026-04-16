/**
 * Notification Service
 * Handles email notifications for business events with Resend integration
 * Respects user notification preferences stored in Supabase
 */

import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "./error-handler";
import * as clientCreatedTemplate from "./email-templates/client-created";
import * as budgetSentTemplate from "./email-templates/budget-sent";
import * as budgetAcceptedTemplate from "./email-templates/budget-accepted";
import * as budgetRejectedTemplate from "./email-templates/budget-rejected";
import * as invoicePaidTemplate from "./email-templates/invoice-paid";
import * as supplierAddedTemplate from "./email-templates/supplier-added";
import * as projectCreatedTemplate from "./email-templates/project-created";
import * as orderCreatedTemplate from "./email-templates/order-created";

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@enlaze.es";

/**
 * Notification result type
 */
export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Notification settings from user preferences
 */
interface NotificationSettings {
  client_created?: boolean;
  budget_sent?: boolean;
  budget_accepted?: boolean;
  budget_rejected?: boolean;
  invoice_paid?: boolean;
  supplier_added?: boolean;
  project_created?: boolean;
  order_created?: boolean;
}

/**
 * Get user notification preferences from Supabase
 * Defaults to enabled for most notifications
 */
async function getUserNotificationPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<NotificationSettings> {
  try {
    // Try notification_settings table first
    const { data, error } = await supabase
      .from("notification_settings")
      .select("email_notifications")
      .eq("user_id", userId)
      .single();

    if (!error && data?.email_notifications) {
      return data.email_notifications as NotificationSettings;
    }

    // Fallback to user_metadata
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
      userId
    );

    if (!userError && userData?.user?.user_metadata?.notification_settings) {
      return userData.user.user_metadata.notification_settings as NotificationSettings;
    }

    // Default settings if nothing is found
    return {
      client_created: true,
      budget_sent: true,
      budget_accepted: true,
      budget_rejected: false,
      invoice_paid: true,
      supplier_added: true,
      project_created: true,
      order_created: true,
    };
  } catch (error) {
    logError(error, { component: "notification-service", action: "getUserNotificationPrefs" });
    // Return default settings on error
    return {
      client_created: true,
      budget_sent: true,
      budget_accepted: true,
      budget_rejected: false,
      invoice_paid: true,
      supplier_added: true,
      project_created: true,
      order_created: true,
    };
  }
}

/**
 * Get user email from auth
 */
async function getUserEmail(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email || null;
  } catch (error) {
    logError(error, { component: "notification-service", action: "getUserEmail" });
    return null;
  }
}

/**
 * Get user full name from metadata
 */
async function getUserName(supabase: SupabaseClient): Promise<string> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  } catch (error) {
    return "Usuario";
  }
}

/**
 * Send email via Resend
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<NotificationResult> {
  try {
    if (!process.env.RESEND_API_KEY) {
      return {
        success: false,
        error: "RESEND_API_KEY no está configurado",
      };
    }

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      replyTo: "support@enlaze.es",
    });

    if (error) {
      logError(error, {
        component: "notification-service",
        action: "sendEmail",
        context: { to, subject },
      });
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
    logError(error, {
      component: "notification-service",
      action: "sendEmail",
      context: { to, subject },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

/**
 * Log notification to activity log
 */
async function logNotification(
  supabase: SupabaseClient,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: `notification.${eventType}`,
      entity_type: "notification",
      metadata,
    });
  } catch (error) {
    console.warn("[notification-service] failed to log:", error);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC NOTIFICATION FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Notify: Client Created
 */
export async function notifyClientCreated(
  supabase: SupabaseClient,
  clientName: string,
  clientEmail?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    // Check user preferences
    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.client_created) {
      return { success: true }; // Notification disabled
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = clientCreatedTemplate.getHtml({ userName, clientName, clientEmail });

    const result = await sendEmail(userEmail, clientCreatedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "client_created", { clientName, clientEmail });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyClientCreated" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Budget Sent
 */
export async function notifyBudgetSent(
  supabase: SupabaseClient,
  clientName: string,
  budgetAmount?: number,
  budgetId?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.budget_sent) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = budgetSentTemplate.getHtml({ userName, clientName, budgetAmount, budgetId });

    const result = await sendEmail(userEmail, budgetSentTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "budget_sent", { clientName, budgetAmount, budgetId });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyBudgetSent" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Budget Accepted
 */
export async function notifyBudgetAccepted(
  supabase: SupabaseClient,
  clientName: string,
  budgetAmount?: number,
  budgetId?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.budget_accepted) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = budgetAcceptedTemplate.getHtml({ userName, clientName, budgetAmount, budgetId });

    const result = await sendEmail(userEmail, budgetAcceptedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "budget_accepted", { clientName, budgetAmount, budgetId });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyBudgetAccepted" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Budget Rejected
 */
export async function notifyBudgetRejected(
  supabase: SupabaseClient,
  clientName: string,
  budgetAmount?: number,
  budgetId?: string,
  rejectionReason?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.budget_rejected) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = budgetRejectedTemplate.getHtml({
      userName,
      clientName,
      budgetAmount,
      budgetId,
      rejectionReason,
    });

    const result = await sendEmail(userEmail, budgetRejectedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "budget_rejected", {
        clientName,
        budgetAmount,
        budgetId,
        rejectionReason,
      });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyBudgetRejected" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Invoice Paid
 */
export async function notifyInvoicePaid(
  supabase: SupabaseClient,
  clientName: string,
  invoiceAmount?: number,
  invoiceId?: string,
  invoiceNumber?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.invoice_paid) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = invoicePaidTemplate.getHtml({
      userName,
      clientName,
      invoiceAmount,
      invoiceId,
      invoiceNumber,
    });

    const result = await sendEmail(userEmail, invoicePaidTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "invoice_paid", {
        clientName,
        invoiceAmount,
        invoiceId,
        invoiceNumber,
      });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyInvoicePaid" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Supplier Added
 */
export async function notifySupplierAdded(
  supabase: SupabaseClient,
  supplierName: string,
  supplierEmail?: string,
  category?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.supplier_added) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = supplierAddedTemplate.getHtml({ userName, supplierName, supplierEmail, category });

    const result = await sendEmail(userEmail, supplierAddedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "supplier_added", { supplierName, supplierEmail, category });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifySupplierAdded" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Project Created
 */
export async function notifyProjectCreated(
  supabase: SupabaseClient,
  projectName: string,
  clientName?: string,
  projectId?: string,
  startDate?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.project_created) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = projectCreatedTemplate.getHtml({
      userName,
      projectName,
      clientName,
      projectId,
      startDate,
    });

    const result = await sendEmail(userEmail, projectCreatedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "project_created", {
        projectName,
        clientName,
        projectId,
        startDate,
      });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyProjectCreated" });
    return { success: false, error: "Error al enviar notificación" };
  }
}

/**
 * Notify: Order Created
 */
export async function notifyOrderCreated(
  supabase: SupabaseClient,
  supplierName: string,
  orderAmount?: number,
  orderId?: string,
  orderNumber?: string
): Promise<NotificationResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Usuario no autenticado" };
    }

    const prefs = await getUserNotificationPrefs(supabase, user.id);
    if (!prefs.order_created) {
      return { success: true };
    }

    const userEmail = await getUserEmail(supabase);
    if (!userEmail) {
      return { success: false, error: "Usuario no tiene email configurado" };
    }

    const userName = await getUserName(supabase);
    const html = orderCreatedTemplate.getHtml({
      userName,
      supplierName,
      orderAmount,
      orderId,
      orderNumber,
    });

    const result = await sendEmail(userEmail, orderCreatedTemplate.subject, html);

    if (result.success) {
      await logNotification(supabase, "order_created", {
        supplierName,
        orderAmount,
        orderId,
        orderNumber,
      });
    }

    return result;
  } catch (error) {
    logError(error, { component: "notification-service", action: "notifyOrderCreated" });
    return { success: false, error: "Error al enviar notificación" };
  }
}
