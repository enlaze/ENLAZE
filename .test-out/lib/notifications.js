"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.severityColors = exports.notificationIcons = void 0;
exports.notify = notify;
exports.getUnreadCount = getUnreadCount;
exports.getNotifications = getNotifications;
exports.markAsRead = markAsRead;
exports.markAllAsRead = markAllAsRead;
exports.dismissNotification = dismissNotification;
/**
 * Fire-and-forget: create a notification for the current user.
 * Never throws — fails silently to console.
 */
async function notify(supabase, params) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        if (!user)
            return;
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
    }
    catch (e) {
        console.warn("[notifications] failed to create:", e);
    }
}
/**
 * Fetch unread notification count for current user.
 */
async function getUnreadCount(supabase) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        if (!user)
            return 0;
        const { count } = await supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .is("read_at", null);
        return count || 0;
    }
    catch {
        return 0;
    }
}
/**
 * Fetch recent notifications (unread first, then recent read).
 */
async function getNotifications(supabase, limit = 20, offset = 0) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        if (!user)
            return [];
        const { data } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", user.id)
            .is("dismissed_at", null)
            .order("read_at", { ascending: true, nullsFirst: true })
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
        return data || [];
    }
    catch {
        return [];
    }
}
/**
 * Mark a single notification as read.
 */
async function markAsRead(supabase, notificationId) {
    try {
        await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("id", notificationId);
    }
    catch (e) {
        console.warn("[notifications] markAsRead failed:", e);
    }
}
/**
 * Mark all unread notifications as read for current user.
 */
async function markAllAsRead(supabase) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        if (!user)
            return;
        await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .is("read_at", null);
    }
    catch (e) {
        console.warn("[notifications] markAllAsRead failed:", e);
    }
}
/**
 * Dismiss (soft-delete) a notification.
 */
async function dismissNotification(supabase, notificationId) {
    try {
        await supabase
            .from("notifications")
            .update({ dismissed_at: new Date().toISOString() })
            .eq("id", notificationId);
    }
    catch (e) {
        console.warn("[notifications] dismiss failed:", e);
    }
}
// ── Notification type metadata for UI rendering ──
exports.notificationIcons = {
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
exports.severityColors = {
    info: "text-blue-400 bg-blue-500/10",
    warning: "text-yellow-400 bg-yellow-500/10",
    error: "text-red-400 bg-red-500/10",
    success: "text-emerald-400 bg-emerald-500/10",
};
