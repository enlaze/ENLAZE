import { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";

export interface Payment {
  id: string;
  user_id: string;
  invoice_id: string | null;
  project_id: string | null;
  client_id: string | null;
  budget_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  concept: string;
  notes: string | null;
  reference: string | null;
  status: "pending" | "completed" | "cancelled";
  type: "income" | "expense";
  created_at: string;
}

export interface TreasurySummary {
  total_income: number;
  total_expenses: number;
  net_balance: number;
  total_invoiced: number;
  total_collected: number;
  outstanding: number;
  overdue_count: number;
  overdue_amount: number;
}

export interface RegisterPaymentParams {
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  concept?: string;
  reference?: string;
  notes?: string;
}

/**
 * Get treasury summary for current user via DB function.
 */
export async function getTreasurySummary(
  supabase: SupabaseClient
): Promise<TreasurySummary | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase.rpc("get_treasury_summary", {
      p_user_id: user.id,
    });

    if (data && data.length > 0) return data[0] as TreasurySummary;
    return null;
  } catch (e) {
    console.warn("[payments] getTreasurySummary failed:", e);
    return null;
  }
}

/**
 * Register a payment against an invoice.
 * Updates invoice amount_paid and payment_status accordingly.
 */
export async function registerPayment(
  supabase: SupabaseClient,
  params: RegisterPaymentParams
): Promise<{ success: boolean; payment?: Payment; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autenticado" };

    // Get invoice details
    const { data: invoice } = await supabase
      .from("issued_invoices")
      .select("id, total, amount_paid, client_id, project_id, budget_id, invoice_number, payment_status")
      .eq("id", params.invoice_id)
      .single();

    if (!invoice) return { success: false, error: "Factura no encontrada" };

    const currentPaid = Number(invoice.amount_paid || 0);
    const invoiceTotal = Number(invoice.total || 0);
    const newTotalPaid = currentPaid + params.amount;

    // Insert payment
    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        user_id: user.id,
        invoice_id: params.invoice_id,
        client_id: invoice.client_id,
        project_id: invoice.project_id,
        budget_id: invoice.budget_id,
        amount: params.amount,
        payment_date: params.payment_date,
        payment_method: params.payment_method,
        concept: params.concept || `Pago factura ${invoice.invoice_number}`,
        reference: params.reference || null,
        notes: params.notes || null,
        status: "completed",
        type: "income",
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    // Update invoice amount_paid and status
    const newPaymentStatus =
      newTotalPaid >= invoiceTotal ? "paid" : "partial";

    const invoiceUpdate: Record<string, unknown> = {
      amount_paid: newTotalPaid,
      payment_status: newPaymentStatus,
      updated_at: new Date().toISOString(),
    };
    if (newPaymentStatus === "paid") {
      invoiceUpdate.payment_date = params.payment_date;
      invoiceUpdate.status = "paid";
    }

    await supabase
      .from("issued_invoices")
      .update(invoiceUpdate)
      .eq("id", params.invoice_id);

    // Fire-and-forget: log + notify
    logActivity(supabase, {
      action: "payment.registered",
      entity_type: "payment",
      entity_id: payment.id,
      metadata: {
        invoice_id: params.invoice_id,
        invoice_number: invoice.invoice_number,
        amount: params.amount,
        total_paid: newTotalPaid,
        invoice_total: invoiceTotal,
      },
    });

    notify(supabase, {
      type: "payment_received",
      title: `Cobro de €${params.amount.toLocaleString("es-ES")} registrado`,
      body: `Factura ${invoice.invoice_number} — ${newPaymentStatus === "paid" ? "Pagada completamente" : `Parcial: €${newTotalPaid.toLocaleString("es-ES")} / €${invoiceTotal.toLocaleString("es-ES")}`}`,
      severity: "success",
      entity_type: "issued_invoice",
      entity_id: params.invoice_id,
      action_url: `/dashboard/issued-invoices/${params.invoice_id}`,
    });

    return { success: true, payment: payment as Payment };
  } catch (e) {
    console.warn("[payments] registerPayment failed:", e);
    return { success: false, error: "Error inesperado" };
  }
}

/**
 * Get payments for an invoice.
 */
export async function getInvoicePayments(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<Payment[]> {
  try {
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("status", "completed")
      .order("payment_date", { ascending: false });

    return (data as Payment[]) || [];
  } catch {
    return [];
  }
}

/**
 * Check for overdue invoices and create notifications.
 * Fire-and-forget — called from dashboard load.
 */
export async function checkOverdueInvoices(supabase: SupabaseClient) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const today = new Date().toISOString().split("T")[0];

    // Find overdue invoices not yet marked
    const { data: overdue } = await supabase
      .from("issued_invoices")
      .select("id, invoice_number, total, amount_paid, due_date, payment_status")
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .neq("payment_status", "paid")
      .lt("due_date", today);

    if (!overdue || overdue.length === 0) return;

    // Update status to overdue if not already
    for (const inv of overdue) {
      if (inv.payment_status !== "overdue") {
        await supabase
          .from("issued_invoices")
          .update({ payment_status: "overdue", updated_at: new Date().toISOString() })
          .eq("id", inv.id);
      }
    }

    // Check if we already sent a notification today
    const { data: todayNotifs } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "invoice_overdue")
      .gte("created_at", `${today}T00:00:00`)
      .limit(1);

    if (todayNotifs && todayNotifs.length > 0) return; // Already notified today

    const totalOverdue = overdue.reduce(
      (s, inv) => s + Number(inv.total || 0) - Number(inv.amount_paid || 0),
      0
    );

    notify(supabase, {
      type: "invoice_overdue",
      title: `${overdue.length} factura${overdue.length !== 1 ? "s" : ""} vencida${overdue.length !== 1 ? "s" : ""}`,
      body: `Importe pendiente total: €${totalOverdue.toLocaleString("es-ES")}`,
      severity: "error",
      entity_type: "issued_invoice",
      action_url: "/dashboard/payments",
    });
  } catch (e) {
    console.warn("[payments] checkOverdueInvoices failed:", e);
  }
}

/**
 * Payment method display labels.
 */
export const paymentMethodLabels: Record<string, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  check: "Cheque",
  paypal: "PayPal",
  other: "Otro",
};
