/**
 * POST /api/notifications/send
 * Manual notification trigger endpoint for testing and admin actions
 * Requires authentication
 */

import { createClient } from "@/lib/supabase-server";
import { logError } from "@/lib/error-handler";
import {
  notifyClientCreated,
  notifyBudgetSent,
  notifyBudgetAccepted,
  notifyBudgetRejected,
  notifyInvoicePaid,
  notifySupplierAdded,
  notifyProjectCreated,
  notifyOrderCreated,
} from "@/lib/notification-service";

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
    const { event, data } = body;

    if (!event) {
      return Response.json(
        { success: false, message: "Campo 'event' requerido" },
        { status: 400 }
      );
    }

    let result;

    switch (event) {
      case "client_created":
        result = await notifyClientCreated(
          supabase,
          data?.clientName || "Cliente",
          data?.clientEmail
        );
        break;

      case "budget_sent":
        result = await notifyBudgetSent(
          supabase,
          data?.clientName || "Cliente",
          data?.budgetAmount,
          data?.budgetId
        );
        break;

      case "budget_accepted":
        result = await notifyBudgetAccepted(
          supabase,
          data?.clientName || "Cliente",
          data?.budgetAmount,
          data?.budgetId
        );
        break;

      case "budget_rejected":
        result = await notifyBudgetRejected(
          supabase,
          data?.clientName || "Cliente",
          data?.budgetAmount,
          data?.budgetId,
          data?.rejectionReason
        );
        break;

      case "invoice_paid":
        result = await notifyInvoicePaid(
          supabase,
          data?.clientName || "Cliente",
          data?.invoiceAmount,
          data?.invoiceId,
          data?.invoiceNumber
        );
        break;

      case "supplier_added":
        result = await notifySupplierAdded(
          supabase,
          data?.supplierName || "Proveedor",
          data?.supplierEmail,
          data?.category
        );
        break;

      case "project_created":
        result = await notifyProjectCreated(
          supabase,
          data?.projectName || "Proyecto",
          data?.clientName,
          data?.projectId,
          data?.startDate
        );
        break;

      case "order_created":
        result = await notifyOrderCreated(
          supabase,
          data?.supplierName || "Proveedor",
          data?.orderAmount,
          data?.orderId,
          data?.orderNumber
        );
        break;

      default:
        return Response.json(
          { success: false, message: `Evento desconocido: ${event}` },
          { status: 400 }
        );
    }

    return Response.json(result);
  } catch (error) {
    logError(error, { component: "notifications/send", action: "POST" });
    return Response.json(
      { success: false, message: "Error al enviar notificación" },
      { status: 500 }
    );
  }
}
