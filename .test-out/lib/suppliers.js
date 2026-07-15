"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentMethodLabels = exports.receivedInvoiceStatusLabels = exports.supplierStatusLabels = void 0;
exports.getSuppliers = getSuppliers;
exports.getSupplier = getSupplier;
exports.createSupplier = createSupplier;
exports.updateSupplier = updateSupplier;
exports.getReceivedInvoices = getReceivedInvoices;
exports.getReceivedInvoice = getReceivedInvoice;
exports.createReceivedInvoice = createReceivedInvoice;
exports.updateReceivedInvoice = updateReceivedInvoice;
exports.registerSupplierPayment = registerSupplierPayment;
exports.getSupplierPayments = getSupplierPayments;
exports.getExpenseSummary = getExpenseSummary;
exports.getExpenseCategories = getExpenseCategories;
const notifications_1 = require("@/lib/notifications");
const activity_log_1 = require("@/lib/activity-log");
/* ═══════════════ Labels ═══════════════ */
exports.supplierStatusLabels = {
    active: { label: "Activo", color: "bg-green-900/30 text-green-300" },
    inactive: { label: "Inactivo", color: "bg-gray-700 text-gray-400" },
    blocked: { label: "Bloqueado", color: "bg-red-900/30 text-red-300" },
};
exports.receivedInvoiceStatusLabels = {
    pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
    approved: { label: "Aprobada", color: "bg-blue-900/30 text-blue-300" },
    paid: { label: "Pagada", color: "bg-green-900/30 text-green-300" },
    partial: { label: "Pago parcial", color: "bg-orange-900/30 text-orange-300" },
    rejected: { label: "Rechazada", color: "bg-red-900/30 text-red-300" },
    overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
};
exports.paymentMethodLabels = {
    transferencia: "Transferencia",
    efectivo: "Efectivo",
    tarjeta: "Tarjeta",
    domiciliacion: "Domiciliación",
    cheque: "Cheque",
    pagare: "Pagaré",
    otro: "Otro",
};
/* ═══════════════ Supplier CRUD ═══════════════ */
async function getSuppliers(supabase, opts) {
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
    if (opts?.limit)
        query = query.limit(opts.limit);
    if (opts?.offset)
        query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);
    const { data, count, error } = await query;
    return { data: (data || []), count: count || 0, error };
}
async function getSupplier(supabase, id) {
    const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
    return { data: data, error };
}
async function createSupplier(supabase, supplier) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        return { data: null, error: "No autenticado" };
    const { data, error } = await supabase
        .from("suppliers")
        .insert({ ...supplier, user_id: user.id })
        .select()
        .single();
    if (data) {
        (0, notifications_1.notify)(supabase, {
            type: "system",
            severity: "info",
            title: "Nuevo proveedor registrado",
            body: `Se ha dado de alta el proveedor "${supplier.name}"`,
            entity_type: "supplier",
            entity_id: data.id,
            action_url: `/dashboard/suppliers/${data.id}`,
        }).catch(() => { });
        (0, activity_log_1.logActivity)(supabase, {
            action: "supplier_created",
            entity_type: "supplier",
            entity_id: data.id,
            metadata: { description: `Proveedor creado: ${supplier.name}` },
        }).catch(() => { });
    }
    return { data: data, error };
}
async function updateSupplier(supabase, id, updates) {
    const { data, error } = await supabase
        .from("suppliers")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
    if (data) {
        (0, activity_log_1.logActivity)(supabase, {
            action: "supplier_updated",
            entity_type: "supplier",
            entity_id: id,
            metadata: { description: `Proveedor actualizado: ${data.name}` },
        }).catch(() => { });
    }
    return { data: data, error };
}
/* ═══════════════ Received Invoices ═══════════════ */
async function getReceivedInvoices(supabase, opts) {
    let query = supabase
        .from("received_invoices")
        .select("*, suppliers(name)", { count: "exact" })
        .order("issue_date", { ascending: false });
    if (opts?.status && opts.status !== "all")
        query = query.eq("status", opts.status);
    if (opts?.supplier_id)
        query = query.eq("supplier_id", opts.supplier_id);
    if (opts?.search) {
        query = query.or(`invoice_number.ilike.%${opts.search}%,supplier_name.ilike.%${opts.search}%`);
    }
    if (opts?.limit)
        query = query.limit(opts.limit);
    if (opts?.offset)
        query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);
    const { data, count, error } = await query;
    return { data: (data || []), count: count || 0, error };
}
async function getReceivedInvoice(supabase, id) {
    const { data, error } = await supabase.from("received_invoices").select("*").eq("id", id).single();
    return { data: data, error };
}
async function createReceivedInvoice(supabase, invoice) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        return { data: null, error: "No autenticado" };
    const { data, error } = await supabase
        .from("received_invoices")
        .insert({ ...invoice, user_id: user.id })
        .select()
        .single();
    if (data && invoice.supplier_id) {
        // Update supplier total_invoiced
        const { error: incrementError } = await supabase.rpc("increment_supplier_invoiced", {
            p_supplier_id: invoice.supplier_id,
            p_amount: invoice.total || 0,
        });
        if (incrementError) {
            // Fallback: manual update
            const { data: s } = await supabase
                .from("suppliers")
                .select("total_invoiced")
                .eq("id", invoice.supplier_id)
                .single();
            if (s) {
                await supabase
                    .from("suppliers")
                    .update({ total_invoiced: Number(s.total_invoiced) + Number(invoice.total || 0) })
                    .eq("id", invoice.supplier_id);
            }
        }
        (0, notifications_1.notify)(supabase, {
            type: "system",
            severity: "info",
            title: "Factura recibida registrada",
            body: `Factura ${invoice.invoice_number} de ${invoice.supplier_name} por ${Number(invoice.total).toFixed(2)}€`,
            entity_type: "received_invoice",
            entity_id: data.id,
            action_url: `/dashboard/suppliers/invoices/${data.id}`,
        }).catch(() => { });
        (0, activity_log_1.logActivity)(supabase, {
            action: "received_invoice_created",
            entity_type: "received_invoice",
            entity_id: data.id,
            metadata: { description: `Factura recibida: ${invoice.invoice_number} de ${invoice.supplier_name}` },
        }).catch(() => { });
    }
    return { data: data, error };
}
async function updateReceivedInvoice(supabase, id, updates) {
    const { data, error } = await supabase
        .from("received_invoices")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
    return { data: data, error };
}
/* ═══════════════ Supplier Payments ═══════════════ */
async function registerSupplierPayment(supabase, params) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        return { success: false, error: "No autenticado" };
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
    if (payErr)
        return { success: false, error: payErr.message };
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
        (0, notifications_1.notify)(supabase, {
            type: "system",
            severity: "success",
            title: "Pago a proveedor registrado",
            body: `Pago de ${params.amount.toFixed(2)}€ en factura ${inv.invoice_number} de ${inv.supplier_name}`,
            entity_type: "supplier_payment",
            entity_id: params.received_invoice_id,
            action_url: `/dashboard/suppliers/invoices/${params.received_invoice_id}`,
        }).catch(() => { });
        (0, activity_log_1.logActivity)(supabase, {
            action: "supplier_payment_registered",
            entity_type: "supplier_payment",
            entity_id: params.received_invoice_id,
            metadata: { description: `Pago ${params.amount.toFixed(2)}€ a ${inv.supplier_name} (${inv.invoice_number})` },
        }).catch(() => { });
    }
    return { success: true };
}
async function getSupplierPayments(supabase, invoiceId) {
    const { data } = await supabase
        .from("supplier_payments")
        .select("*")
        .eq("received_invoice_id", invoiceId)
        .order("payment_date", { ascending: false });
    return (data || []);
}
/* ═══════════════ Expense Summary ═══════════════ */
async function getExpenseSummary(supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        return { total_pending: 0, total_paid_month: 0, total_overdue: 0, invoices_pending: 0, invoices_overdue: 0, suppliers_active: 0 };
    const { data } = await supabase.rpc("get_expense_summary", { p_user_id: user.id });
    return data || { total_pending: 0, total_paid_month: 0, total_overdue: 0, invoices_pending: 0, invoices_overdue: 0, suppliers_active: 0 };
}
/* ═══════════════ Categories ═══════════════ */
async function getExpenseCategories(supabase) {
    const { data } = await supabase.from("expense_categories").select("*").order("name");
    return (data || []);
}
