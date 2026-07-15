"use strict";
/**
 * Notification Service
 * Handles email notifications for business events with Resend integration
 * Respects user notification preferences stored in Supabase
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyClientCreated = notifyClientCreated;
exports.notifyBudgetSent = notifyBudgetSent;
exports.notifyBudgetAccepted = notifyBudgetAccepted;
exports.notifyBudgetRejected = notifyBudgetRejected;
exports.notifyInvoicePaid = notifyInvoicePaid;
exports.notifySupplierAdded = notifySupplierAdded;
exports.notifyProjectCreated = notifyProjectCreated;
exports.notifyOrderCreated = notifyOrderCreated;
const resend_1 = require("resend");
const error_handler_1 = require("./error-handler");
const clientCreatedTemplate = __importStar(require("./email-templates/client-created"));
const budgetSentTemplate = __importStar(require("./email-templates/budget-sent"));
const budgetAcceptedTemplate = __importStar(require("./email-templates/budget-accepted"));
const budgetRejectedTemplate = __importStar(require("./email-templates/budget-rejected"));
const invoicePaidTemplate = __importStar(require("./email-templates/invoice-paid"));
const supplierAddedTemplate = __importStar(require("./email-templates/supplier-added"));
const projectCreatedTemplate = __importStar(require("./email-templates/project-created"));
const orderCreatedTemplate = __importStar(require("./email-templates/order-created"));
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@enlaze.es";
/**
 * Get user notification preferences from Supabase
 * Defaults to enabled for most notifications
 */
async function getUserNotificationPrefs(supabase, userId) {
    try {
        // Try notification_settings table first
        const { data, error } = await supabase
            .from("notification_settings")
            .select("email_notifications")
            .eq("user_id", userId)
            .single();
        if (!error && data?.email_notifications) {
            return data.email_notifications;
        }
        // Fallback to user_metadata
        const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
        if (!userError && userData?.user?.user_metadata?.notification_settings) {
            return userData.user.user_metadata.notification_settings;
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "getUserNotificationPrefs" });
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
async function getUserEmail(supabase) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return user?.email || null;
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "getUserEmail" });
        return null;
    }
}
/**
 * Get user full name from metadata
 */
async function getUserName(supabase) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
    }
    catch (error) {
        return "Usuario";
    }
}
/**
 * Send email via Resend
 */
async function sendEmail(to, subject, html) {
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
            (0, error_handler_1.logError)(error, {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, {
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
async function logNotification(supabase, eventType, metadata) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user)
            return;
        await supabase.from("activity_log").insert({
            user_id: user.id,
            action: `notification.${eventType}`,
            entity_type: "notification",
            metadata,
        });
    }
    catch (error) {
        console.warn("[notification-service] failed to log:", error);
    }
}
// ────────────────────────────────────────────────────────────────────────────
// PUBLIC NOTIFICATION FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────
/**
 * Notify: Client Created
 */
async function notifyClientCreated(supabase, clientName, clientEmail) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyClientCreated" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Budget Sent
 */
async function notifyBudgetSent(supabase, clientName, budgetAmount, budgetId) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyBudgetSent" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Budget Accepted
 */
async function notifyBudgetAccepted(supabase, clientName, budgetAmount, budgetId) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyBudgetAccepted" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Budget Rejected
 */
async function notifyBudgetRejected(supabase, clientName, budgetAmount, budgetId, rejectionReason) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyBudgetRejected" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Invoice Paid
 */
async function notifyInvoicePaid(supabase, clientName, invoiceAmount, invoiceId, invoiceNumber) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyInvoicePaid" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Supplier Added
 */
async function notifySupplierAdded(supabase, supplierName, supplierEmail, category) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifySupplierAdded" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Project Created
 */
async function notifyProjectCreated(supabase, projectName, clientName, projectId, startDate) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyProjectCreated" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
/**
 * Notify: Order Created
 */
async function notifyOrderCreated(supabase, supplierName, orderAmount, orderId, orderNumber) {
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
    }
    catch (error) {
        (0, error_handler_1.logError)(error, { component: "notification-service", action: "notifyOrderCreated" });
        return { success: false, error: "Error al enviar notificación" };
    }
}
