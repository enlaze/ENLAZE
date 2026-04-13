import { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType =
  | "budget_sent"
  | "budget_viewed"
  | "budget_accepted"
  | "budget_rejected"
  | "invoice_due"
  | "invoice_paid"
  | "invoice_overdue"
  | "payment_received"
  | "compliance_alert"
  | "compliance_expiry"
  | "project_update"
  | "system";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  severity: NotificationSeverity;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

/**
 * Fire-and-forget: create a notification for the current user.
 * Never throws — fails silently to console.
 */
export async function notify(
  supabase: SupabaseClient,
  params: CreateNotificationParams
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("notifications").insert({
      user_id: user.id,
      type: params.type,
      title: params.title,
      body: params.body || null,
      severity: params.severity || "info",
      entity_type: params.entity_type || null,
      entity_id: params.entity_id || null,
      action_url: params.action_url || null,
    });
  } catch (e) {
    console.warn("[notifications] failed to create:", e);
  }
}

/**
 * Fetch unread notification count for current user.
 */
export async function getUnreadCount(supabase: SupabaseClient): Promise<number> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch recent notifications (unread first, then recent read).
 */
export async function getNotifications(
  supabase: SupabaseClient,
  limit: number = 20,
  offset: number = 0
): Promise<Notification[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .is("dismissed_at", null)
      .order("read_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    return (data as Notification[]) || [];
  } catch {
    return [];
  }
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(
  supabase: SupabaseClient,
  notificationId: string
) {
  try {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
  } catch (e) {
    console.warn("[notifications] markAsRead failed:", e);
  }
}

/**
 * Mark all unread notifications as read for current user.
 */
export async function markAllAsRead(supabase: SupabaseClient) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  } catch (e) {
    console.warn("[notifications] markAllAsRead failed:", e);
  }
}

/**
 * Dismiss (soft-delete) a notification.
 */
export async function dismissNotification(
  supabase: SupabaseClient,
  notificationId: string
) {
  try {
    await supabase
      .from("notifications")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", notificationId);
  } catch (e) {
    console.warn("[notifications] dismiss failed:", e);
  }
}

// ── Notification type metadata for UI rendering ──

export const notificationIcons: Record<string, string> = {
  budget_sent: "📤",
  budget_viewed: "👁️",
  budget_accepted: "✅",
  budget_rejected: "❌",
  invoice_due: "⏰",
  invoice_paid: "💰",
  invoice_overdue: "🔴",
  payment_received: "💵",
  compliance_alert: "⚠️",
  compliance_expiry: "📅",
  project_update: "🏗️",
  system: "🔔",
};

export const severityColors: Record<NotificationSeverity, string> = {
  info: "text-blue-400 bg-blue-500/10",
  warning: "text-yellow-400 bg-yellow-500/10",
  error: "text-red-400 bg-red-500/10",
  success: "text-emerald-400 bg-emerald-500/10",
};
