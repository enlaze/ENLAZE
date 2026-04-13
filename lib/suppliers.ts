import { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";

/* ═══════════════ Types ═══════════════ */

export interface Supplier {
  id: string;
  user_id: string;
  name: string;
  trade_name: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  province: string | null;
  country: string;
  contact_person: string | null;
  payment_method: string;
  payment_terms_days: number;
  iban: string | null;
  notes: string | null;
  category_id: string | null;
  status: "active" | "inactive" | "blocked";
  total_invoiced: number;
  total_paid: number;
  created_at: string;
  updated_at: string;
}

export interface ReceivedInvoice {
  id: string;
  user_id: string;
  supplier_id: string | null;
  project_id: string | null;
  category_id: string | null;
  invoice_number: string;
  supplier_name: string;
  supplier_nif: string | null;
  issue_date: string;
  reception_date: string;
  due_date: string | null;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  irpf_percent: number;
  irpf_amount: number;
  total: number;
  status: string;
  payment_status: string;
  amount_paid: number;
  payment_date: string | null;
  payment_method: string | null;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierPayment {
  id: string;
  user_id: string;
  supplier_id: string | null;
  received_invoice_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  is_default: boolean;
}

export interface ExpenseSummary {
  total_pending: number;
  total_paid_month: number;
  total_overdue: number;
  invoices_pending: number;
  invoices_overdue: number;
  suppliers_active: number;
}

/* ═══════════════ Labels ═══════════════ */

export const supplierStatusLabels: Record<string, { label: string; color: string }> = {
  active: { label: "Activo", color: "bg-green-900/30 text-green-300" },
  inactive: { label: "Inactivo", color: "bg-gray-700 text-gray-400" },
  blocked: { label: "Bloqueado", color: "bg-red-900/30 text-red-300" },
};

export const receivedInvoiceStatusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  approved: { label: "Aprobada", color: "bg-blue-900/30 text-blue-300" },
  paid: { label: "Pagada", color: "bg-green-900/30 text-green-300" },
  partial: { label: "Pago parcial", color: "bg-orange-900/30 text-orange-300" },
  rejected: { label: "Rechazada", color: "bg-red-900/30 text-red-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
};

export const paymentMethodLabels: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  domiciliacion: "Domiciliación",
  cheque: "Cheque",
  pagare: "Pagaré",
  otro: "Otro",
};

/* ═══════════════ Supplier CRUD ═══════════════ */

export async function getSuppliers(
  supabase: SupabaseClient,
  opts?: { status?: string; search?: string; limit?: number; offset?: number }
) {
  let query = supabase
    .from("suppliers")
    .select("*", { count: "exact" })
    .order("name", { ascending: true });

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts?.search) {
    query = query.or(`name.ilike.%${opts.search}%,nif.ilike.%${opts.search}%,trade_name.ilike.%${opts.search}%`);
  }
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);

  const { data, count, error } = await query;
  return { data: (data || []) as Supplier[], count: count || 0, error };
}

export async function getSupplier(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
  return { data: data as Supplier | null, error };
}

export async function createSupplier(supabase: SupabaseClient, supplier: Partial<Supplier>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "No autenticado" };

  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...supplier, user_id: user.id })
    .select()
    .single();

  if (data) {
    notify(supabase, {
      user_id: user.id,
      type: "system",
      severity: "info",
      title: "Nuevo proveedor registrado",
      message: `Se ha dado de alta el proveedor "${supplier.name}"`,
      link: `/dashboard/suppliers/${data.id}`,
    }).catch(() => {});
    logActivity(supabase, {
      action: "supplier_created",
      entity_type: "supplier",
      entity_id: data.id,
      description: `Proveedor creado: ${supplier.name}`,
    }).catch(() => {});
  }

  return { data: data as Supplier | null, error };
}

export async function updateSupplier(supabase: SupabaseClient, id: string, updates: Partial<Supplier>) {
  const { data, error } = await supabase
    .from("suppliers")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (data) {
    logActivity(supabase, {
      action: "supplier_updated",
      entity_type: "supplier",
      entity_id: id,
      description: `Proveedor actualizado: ${data.name}`,
    }).catch(() => {});
  }

  return { data: data as Supplier | null, error };
}

/* ═══════════════ Received Invoices ═══════════════ */

export async function getReceivedInvoices(
  supabase: SupabaseClient,
  opts?: { status?: string; supplier_id?: string; search?: string; limit?: number; offset?: number }
) {
  let query = supabase
    .from("received_invoices")
    .select("*, suppliers(name)", { count: "exact" })
    .order("issue_date", { ascending: false });

  if (opts?.status && opts.status !== "all") query = query.eq("status", opts.status);
  if (opts?.supplier_id) query = query.eq("supplier_id", opts.supplier_id);
  if (opts?.search) {
    query = query.or(`invoice_number.ilike.%${opts.search}%,supplier_name.ilike.%${opts.search}%`);
  }
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);

  const { data, count, error } = await query;
  return { data: (data || []) as ReceivedInvoice[], count: count || 0, error };
}

export async function getReceivedInvoice(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("received_invoices").select("*").eq("id", id).single();
  return { data: data as ReceivedInvoice | null, error };
}

export async function createReceivedInvoice(supabase: SupabaseClient, invoice: Partial<ReceivedInvoice>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "No autenticado" };

  const { data, error } = await supabase
    .from("received_invoices")
    .insert({ ...invoice, user_id: user.id })
    .select()
    .single();

  if (data && invoice.supplier_id) {
    // Update supplier total_invoiced
    supabase.rpc("increment_supplier_invoiced", {
      p_supplier_id: invoice.supplier_id,
      p_amount: invoice.total || 0,
    }).catch(() => {
      // Fallback: manual update
      supabase
        .from("suppliers")
        .select("total_invoiced")
        .eq("id", invoice.supplier_id as string)
        .single()
        .then(({ data: s }) => {
          if (s) {
            supabase
              .from("suppliers")
              .update({ total_invoiced: Number(s.total_invoiced) + Number(invoice.total || 0) })
              .eq("id", invoice.supplier_id as string)
              .then(() => {});
          }
        });
    });

    notify(supabase, {
      user_id: user.id,
      type: "invoice",
      severity: "info",
      title: "Factura recibida registrada",
      message: `Factura ${invoice.invoice_number} de ${invoice.supplier_name} por ${Number(invoice.total).toFixed(2)}€`,
      link: `/dashboard/suppliers/invoices/${data.id}`,
    }).catch(() => {});

    logActivity(supabase, {
      action: "received_invoice_created",
      entity_type: "received_invoice",
      entity_id: data.id,
      description: `Factura recibida: ${invoice.invoice_number} de ${invoice.supplier_name}`,
    }).catch(() => {});
  }

  return { data: data as ReceivedInvoice | null, error };
}

export async function updateReceivedInvoice(supabase: SupabaseClient, id: string, updates: Partial<ReceivedInvoice>) {
  const { data, error } = await supabase
    .from("received_invoices")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  return { data: data as ReceivedInvoice | null, error };
}

/* ═══════════════ Supplier Payments ═══════════════ */

export async function registerSupplierPayment(
  supabase: SupabaseClient,
  params: {
    received_invoice_id: string;
    supplier_id: string;
    amount: number;
    payment_date?: string;
    payment_method?: string;
    reference?: string;
  }
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autenticado" };

  // Insert payment
  const { error: payErr } = await supabase.from("supplier_payments").insert({
    user_id: user.id,
    supplier_id: params.supplier_id,
    received_invoice_id: params.received_invoice_id,
    amount: params.amount,
    payment_date: params.payment_date || new Date().toISOString().split("T")[0],
    payment_method: params.payment_method || "transferencia",
    reference: params.reference,
  });

  if (payErr) return { success: false, error: payErr.message };

  // Update invoice amount_paid
  const { data: inv } = await supabase
    .from("received_invoices")
    .select("amount_paid, total, supplier_name, invoice_number")
    .eq("id", params.received_invoice_id)
    .single();

  if (inv) {
    const newPaid = Number(inv.amount_paid || 0) + params.amount;
    const newStatus = newPaid >= Number(inv.total) ? "paid" : "partial";
    await supabase
      .from("received_invoices")
      .update({
        amount_paid: newPaid,
        payment_status: newStatus,
        status: newStatus === "paid" ? "paid" : "partial",
        payment_date: newStatus === "paid" ? new Date().toISOString().split("T")[0] : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.received_invoice_id);

    // Update supplier total_paid
    const { data: sup } = await supabase
      .from("suppliers")
      .select("total_paid")
      .eq("id", params.supplier_id)
      .single();
    if (sup) {
      await supabase
        .from("suppliers")
        .update({ total_paid: Number(sup.total_paid || 0) + params.amount })
        .eq("id", params.supplier_id);
    }

    notify(supabase, {
      user_id: user.id,
      type: "payment",
      severity: "success",
      title: "Pago a proveedor registrado",
      message: `Pago de ${params.amount.toFixed(2)}€ en factura ${inv.invoice_number} de ${inv.supplier_name}`,
      link: `/dashboard/suppliers/invoices/${params.received_invoice_id}`,
    }).catch(() => {});

    logActivity(supabase, {
      action: "supplier_payment_registered",
      entity_type: "supplier_payment",
      entity_id: params.received_invoice_id,
      description: `Pago ${params.amount.toFixed(2)}€ a ${inv.supplier_name} (${inv.invoice_number})`,
    }).catch(() => {});
  }

  return { success: true };
}

export async function getSupplierPayments(supabase: SupabaseClient, invoiceId: string) {
  const { data } = await supabase
    .from("supplier_payments")
    .select("*")
    .eq("received_invoice_id", invoiceId)
    .order("payment_date", { ascending: false });
  return (data || []) as SupplierPayment[];
}

/* ═══════════════ Expense Summary ═══════════════ */

export async function getExpenseSummary(supabase: SupabaseClient): Promise<ExpenseSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { total_pending: 0, total_paid_month: 0, total_overdue: 0, invoices_pending: 0, invoices_overdue: 0, suppliers_active: 0 };

  const { data } = await supabase.rpc("get_expense_summary", { p_user_id: user.id });
  return (data as ExpenseSummary) || { total_pending: 0, total_paid_month: 0, total_overdue: 0, invoices_pending: 0, invoices_overdue: 0, suppliers_active: 0 };
}

/* ═══════════════ Categories ═══════════════ */

export async function getExpenseCategories(supabase: SupabaseClient) {
  const { data } = await supabase.from("expense_categories").select("*").order("name");
  return (data || []) as ExpenseCategory[];
}
