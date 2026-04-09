"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";

/* ═══════════════════════════ Types ═══════════════════════════ */

interface Project {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  address: string;
  description: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  budget_amount: number;
  actual_cost: number;
  notes: string;
  access_token: string;
  created_at: string;
  updated_at: string;
}

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
}

interface Budget {
  id: string;
  budget_number: string;
  title: string;
  service_type: string;
  status: string;
  subtotal: number;
  iva_amount: number;
  total: number;
  total_cost: number;
  created_at: string;
}

interface Invoice {
  id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  base_amount: number;
  iva_amount: number;
  irpf_amount: number;
  total_amount: number;
  category: string;
  payment_status: string;
  created_at: string;
}

interface Payment {
  id: string;
  project_id: string;
  client_id: string | null;
  budget_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  concept: string;
  notes: string;
  created_at: string;
}

interface ProjectChange {
  id: string;
  project_id: string;
  title: string;
  description: string;
  economic_impact: number;
  time_impact_days: number;
  status: string;
  client_approved: boolean;
  approved_date: string | null;
  notes: string;
  image_urls: string[];
  created_at: string;
  updated_at: string;
}

interface Milestone {
  id: string;
  project_id: string;
  title: string;
  planned_date: string | null;
  actual_date: string | null;
  status: string;
  sort_order: number;
  notes: string;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
  nif: string;
  email: string;
  phone: string;
  contact_person: string;
  trade: string;
  specialty: string;
  type: string;
  hourly_rate: number | null;
  rating: number | null;
  status: string;
}

interface ProjectSupplier {
  id: string;
  project_id: string;
  supplier_id: string;
  role: string;
  notes: string;
  created_at: string;
  suppliers: Supplier;
}

interface ProjectOrder {
  id: string;
  order_number: string;
  title: string;
  status: string;
  order_date: string;
  total: number;
  supplier_id: string | null;
}

interface ProjectDeliveryNote {
  id: string;
  note_number: string;
  status: string;
  reception_date: string;
  total: number;
  order_id: string | null;
  supplier_id: string | null;
}

/* ═══════════════════════════ Labels ═══════════════════════════ */

const statusLabelMap: Record<string, string> = {
  planning: "Planificación", approved: "Aprobada", in_progress: "En curso",
  paused: "Pausada", completed: "Finalizada", cancelled: "Cancelada",
};
const statusColorMap: Record<string, string> = {
  planning: "bg-blue-900/30 text-blue-300", approved: "bg-emerald-900/30 text-emerald-300",
  in_progress: "bg-yellow-900/30 text-yellow-300", paused: "bg-orange-900/30 text-orange-300",
  completed: "bg-green-900/30 text-green-300", cancelled: "bg-red-900/30 text-red-300",
};
const budgetStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  sent: { label: "Enviado", color: "bg-blue-900/30 text-blue-300" },
  accepted: { label: "Aceptado", color: "bg-green-900/30 text-green-300" },
  rejected: { label: "Rechazado", color: "bg-red-900/30 text-red-300" },
};
const invoiceStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  paid: { label: "Pagada", color: "bg-green-900/30 text-green-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
  cancelled: { label: "Anulada", color: "bg-gray-700 text-gray-400" },
};
const changeStatusMap: Record<string, { label: string; color: string }> = {
  proposed: { label: "Propuesto", color: "bg-blue-900/30 text-blue-300" },
  approved: { label: "Aprobado", color: "bg-green-900/30 text-green-300" },
  rejected: { label: "Rechazado", color: "bg-red-900/30 text-red-300" },
  executed: { label: "Ejecutado", color: "bg-emerald-900/30 text-emerald-300" },
};
const milestoneStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  in_progress: { label: "En curso", color: "bg-blue-900/30 text-blue-300" },
  completed: { label: "Completado", color: "bg-green-900/30 text-green-300" },
  cancelled: { label: "Cancelado", color: "bg-red-900/30 text-red-300" },
};
const orderStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-gray-700 text-gray-300" },
  sent: { label: "Enviado", color: "bg-blue-900/30 text-blue-300" },
  confirmed: { label: "Confirmado", color: "bg-emerald-900/30 text-emerald-300" },
  partial: { label: "Parcial", color: "bg-yellow-900/30 text-yellow-300" },
  received: { label: "Recibido", color: "bg-green-900/30 text-green-300" },
  cancelled: { label: "Cancelado", color: "bg-red-900/30 text-red-300" },
};
const dnStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  received: { label: "Recibido", color: "bg-blue-900/30 text-blue-300" },
  verified: { label: "Verificado", color: "bg-green-900/30 text-green-300" },
  disputed: { label: "Incidencia", color: "bg-red-900/30 text-red-300" },
};
const serviceLabels: Record<string, string> = {
  reforma: "Reforma", fontaneria: "Fontanería", electricidad: "Electricidad",
  climatizacion: "Climatización", multiservicios: "Multiservicios", general: "General",
};
const categoryLabels: Record<string, string> = {
  material: "Material", servicio: "Servicio", suministro: "Suministro",
  alquiler: "Alquiler", subcontrata: "Subcontrata", profesional: "Profesional",
  transporte: "Transporte", seguro: "Seguro", general: "General",
};
const paymentMethods = [
  { value: "transferencia", label: "Transferencia" }, { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" }, { value: "cheque", label: "Cheque" },
  { value: "pagare", label: "Pagaré" }, { value: "bizum", label: "Bizum" },
  { value: "otro", label: "Otro" },
];

/* ═══════════════════════════ Helpers ═══════════════════════════ */

function eur(n: number): string {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}

/* ═══════════════════════════ Empty forms ═══════════════════════════ */

const emptyPaymentForm = {
  amount: 0, payment_date: new Date().toISOString().split("T")[0],
  payment_method: "transferencia", concept: "", notes: "",
};
const emptyChangeForm = {
  title: "", description: "", economic_impact: 0, time_impact_days: 0,
  status: "proposed" as string, notes: "",
};
const emptyMilestoneForm = {
  title: "", planned_date: "", status: "pending" as string, notes: "",
};

/* ═══════════════════════════ Page ═══════════════════════════ */

type TabKey = "resumen" | "presupuestos" | "facturas" | "cobros" | "cambios" | "hitos" | "proveedores" | "trazabilidad";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [projectSuppliers, setProjectSuppliers] = useState<ProjectSupplier[]>([]);
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [projectOrders, setProjectOrders] = useState<ProjectOrder[]>([]);
  const [projectDeliveryNotes, setProjectDeliveryNotes] = useState<ProjectDeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabKey>("resumen");

  // Forms
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [savingPayment, setSavingPayment] = useState(false);

  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeForm, setChangeForm] = useState(emptyChangeForm);
  const [editingChangeId, setEditingChangeId] = useState<string | null>(null);
  const [savingChange, setSavingChange] = useState(false);

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState(emptyMilestoneForm);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [savingMilestone, setSavingMilestone] = useState(false);

  const [showSupplierAssign, setShowSupplierAssign] = useState(false);
  const [supplierAssignForm, setSupplierAssignForm] = useState({ supplier_id: "", role: "", notes: "" });
  const [savingSupplierAssign, setSavingSupplierAssign] = useState(false);

  const [linkCopied, setLinkCopied] = useState(false);

  /* ── Load all data ── */

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);

      const { data: proj, error: projErr } = await supabase
        .from("projects").select("*").eq("id", params.id).single();
      if (projErr || !proj) { router.push("/dashboard/projects"); return; }
      setProject(proj);

      // Build OR filter: project_id matches OR (client_id matches and project_id is null)
      const pid = params.id as string;
      const cid = proj.client_id;
      const budgetFilter = cid
        ? `project_id.eq.${pid},and(client_id.eq.${cid},project_id.is.null)`
        : `project_id.eq.${pid}`;
      const invoiceFilter = cid
        ? `project_id.eq.${pid},and(client_id.eq.${cid},project_id.is.null)`
        : `project_id.eq.${pid}`;

      const [clientRes, budgetsRes, invoicesRes, paymentsRes, changesRes, milestonesRes, projSuppliersRes, allSuppliersRes, ordersRes, dnRes] =
        await Promise.all([
          cid
            ? supabase.from("clients").select("id, name, email, phone, company").eq("id", cid).single()
            : Promise.resolve({ data: null }),
          supabase.from("budgets")
            .select("id, budget_number, title, service_type, status, subtotal, iva_amount, total, total_cost, created_at")
            .or(budgetFilter).order("created_at", { ascending: false }),
          supabase.from("invoices")
            .select("id, supplier_name, invoice_number, invoice_date, base_amount, iva_amount, irpf_amount, total_amount, category, payment_status, created_at")
            .or(invoiceFilter).order("invoice_date", { ascending: false }),
          supabase.from("payments")
            .select("*").eq("project_id", params.id as string).order("payment_date", { ascending: false }),
          supabase.from("project_changes")
            .select("*").eq("project_id", params.id as string).order("created_at", { ascending: false }),
          supabase.from("project_milestones")
            .select("*").eq("project_id", params.id as string).order("sort_order", { ascending: true }),
          supabase.from("project_suppliers")
            .select("*, suppliers(*)")
            .eq("project_id", params.id as string).order("created_at", { ascending: false }),
          supabase.from("suppliers")
            .select("id, name, nif, email, phone, contact_person, trade, specialty, type, hourly_rate, rating, status")
            .eq("status", "active").order("name"),
          supabase.from("orders")
            .select("id, order_number, title, status, order_date, total, supplier_id")
            .eq("project_id", params.id as string).order("order_date", { ascending: false }),
          supabase.from("delivery_notes")
            .select("id, note_number, status, reception_date, total, order_id, supplier_id")
            .eq("project_id", params.id as string).order("reception_date", { ascending: false }),
        ]);

      if (clientRes.data) setClient(clientRes.data as Client);
      setBudgets((budgetsRes.data as Budget[]) || []);
      setInvoices((invoicesRes.data as Invoice[]) || []);
      setPayments((paymentsRes.data as Payment[]) || []);
      setChanges((changesRes.data as ProjectChange[]) || []);
      setMilestones((milestonesRes.data as Milestone[]) || []);
      setProjectSuppliers((projSuppliersRes.data as ProjectSupplier[]) || []);
      setAllSuppliers((allSuppliersRes.data as Supplier[]) || []);
      setProjectOrders((ordersRes.data as ProjectOrder[]) || []);
      setProjectDeliveryNotes((dnRes.data as ProjectDeliveryNote[]) || []);
    } catch {
      router.push("/dashboard/projects");
    } finally {
      setLoading(false);
    }
  }

  /* ── CRUD: Payments ── */

  async function handleSavePayment() {
    if (!userId || !project) return;
    if (!paymentForm.amount || paymentForm.amount <= 0) { alert("El importe debe ser mayor que 0."); return; }
    if (!paymentForm.concept.trim()) { alert("Indica un concepto."); return; }
    setSavingPayment(true);
    const { error } = await supabase.from("payments").insert({
      user_id: userId, project_id: project.id, client_id: project.client_id,
      amount: paymentForm.amount, payment_date: paymentForm.payment_date,
      payment_method: paymentForm.payment_method, concept: paymentForm.concept.trim(),
      notes: paymentForm.notes,
    });
    if (error) alert("Error: " + error.message);
    else {
      setPaymentForm(emptyPaymentForm); setShowPaymentForm(false);
      const { data } = await supabase.from("payments").select("*")
        .eq("project_id", project.id).order("payment_date", { ascending: false });
      setPayments(data || []);
    }
    setSavingPayment(false);
  }

  async function handleDeletePayment(id: string) {
    if (!confirm("¿Eliminar este cobro?")) return;
    await supabase.from("payments").delete().eq("id", id);
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  /* ── CRUD: Changes ── */

  async function handleSaveChange() {
    if (!userId || !project) return;
    if (!changeForm.title.trim()) { alert("El título del cambio es obligatorio."); return; }
    setSavingChange(true);

    const payload = {
      project_id: project.id, user_id: userId,
      title: changeForm.title.trim(), description: changeForm.description,
      economic_impact: changeForm.economic_impact, time_impact_days: changeForm.time_impact_days,
      status: changeForm.status, notes: changeForm.notes,
      client_approved: changeForm.status === "approved" || changeForm.status === "executed",
      approved_date: (changeForm.status === "approved" || changeForm.status === "executed")
        ? new Date().toISOString().split("T")[0] : null,
      updated_at: new Date().toISOString(),
    };

    if (editingChangeId) {
      await supabase.from("project_changes").update(payload).eq("id", editingChangeId);
    } else {
      await supabase.from("project_changes").insert(payload);
    }

    setChangeForm(emptyChangeForm); setShowChangeForm(false); setEditingChangeId(null);
    const { data } = await supabase.from("project_changes").select("*")
      .eq("project_id", project.id).order("created_at", { ascending: false });
    setChanges(data || []);
    setSavingChange(false);
  }

  function startEditChange(c: ProjectChange) {
    setChangeForm({
      title: c.title, description: c.description,
      economic_impact: Number(c.economic_impact), time_impact_days: c.time_impact_days,
      status: c.status, notes: c.notes,
    });
    setEditingChangeId(c.id); setShowChangeForm(true);
  }

  async function handleDeleteChange(id: string) {
    if (!confirm("¿Eliminar este cambio?")) return;
    await supabase.from("project_changes").delete().eq("id", id);
    setChanges((prev) => prev.filter((c) => c.id !== id));
  }

  /* ── CRUD: Milestones ── */

  async function handleSaveMilestone() {
    if (!project) return;
    if (!milestoneForm.title.trim()) { alert("El título del hito es obligatorio."); return; }
    setSavingMilestone(true);

    const payload = {
      project_id: project.id,
      title: milestoneForm.title.trim(),
      planned_date: milestoneForm.planned_date || null,
      status: milestoneForm.status, notes: milestoneForm.notes,
      actual_date: milestoneForm.status === "completed" ? new Date().toISOString().split("T")[0] : null,
      sort_order: editingMilestoneId ? undefined : milestones.length,
    };

    if (editingMilestoneId) {
      const { status, ...updatePayload } = payload;
      await supabase.from("project_milestones")
        .update({ ...updatePayload, status })
        .eq("id", editingMilestoneId);
    } else {
      await supabase.from("project_milestones").insert(payload);
    }

    setMilestoneForm(emptyMilestoneForm); setShowMilestoneForm(false); setEditingMilestoneId(null);
    const { data } = await supabase.from("project_milestones").select("*")
      .eq("project_id", project.id).order("sort_order", { ascending: true });
    setMilestones(data || []);
    setSavingMilestone(false);
  }

  function startEditMilestone(m: Milestone) {
    setMilestoneForm({
      title: m.title, planned_date: m.planned_date || "",
      status: m.status, notes: m.notes,
    });
    setEditingMilestoneId(m.id); setShowMilestoneForm(true);
  }

  async function handleDeleteMilestone(id: string) {
    if (!confirm("¿Eliminar este hito?")) return;
    await supabase.from("project_milestones").delete().eq("id", id);
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }

  async function toggleMilestoneComplete(m: Milestone) {
    const newStatus = m.status === "completed" ? "pending" : "completed";
    const actualDate = newStatus === "completed" ? new Date().toISOString().split("T")[0] : null;
    await supabase.from("project_milestones")
      .update({ status: newStatus, actual_date: actualDate }).eq("id", m.id);
    setMilestones((prev) =>
      prev.map((ms) => ms.id === m.id ? { ...ms, status: newStatus, actual_date: actualDate } : ms)
    );
  }

  /* ── CRUD: Project Suppliers ── */

  async function handleAssignSupplier() {
    if (!userId || !project) return;
    if (!supplierAssignForm.supplier_id) { alert("Selecciona un proveedor/subcontrata."); return; }
    setSavingSupplierAssign(true);
    const { error } = await supabase.from("project_suppliers").insert({
      project_id: project.id, supplier_id: supplierAssignForm.supplier_id,
      role: supplierAssignForm.role, notes: supplierAssignForm.notes, user_id: userId,
    });
    if (error) alert("Error: " + error.message);
    else {
      setSupplierAssignForm({ supplier_id: "", role: "", notes: "" }); setShowSupplierAssign(false);
      const { data } = await supabase.from("project_suppliers")
        .select("*, suppliers(*)").eq("project_id", project.id).order("created_at", { ascending: false });
      setProjectSuppliers((data as ProjectSupplier[]) || []);
    }
    setSavingSupplierAssign(false);
  }

  async function handleRemoveSupplier(id: string) {
    if (!confirm("¿Quitar este proveedor de la obra?")) return;
    await supabase.from("project_suppliers").delete().eq("id", id);
    setProjectSuppliers((prev) => prev.filter((ps) => ps.id !== id));
  }

  const assignedSupplierIds = projectSuppliers.map((ps) => ps.supplier_id);
  const availableSuppliers = allSuppliers.filter((s) => !assignedSupplierIds.includes(s.id));

  /* ── Generate invoice from approved budget ── */

  async function generateInvoiceFromBudget(b: Budget) {
    if (!userId || !project) return;
    if (!confirm(`¿Generar factura emitida desde el presupuesto "${b.title}"?`)) return;

    // Load fiscal settings
    const { data: fiscal } = await supabase.from("fiscal_settings").select("*").eq("user_id", userId).single();
    if (!fiscal) { alert("Configura tus ajustes fiscales antes de facturar (Ajustes → Fiscal)."); return; }

    // Load client info
    let clientData = client;
    if (!clientData && project.client_id) {
      const { data } = await supabase.from("clients").select("*").eq("id", project.client_id).single();
      if (data) clientData = data as Client;
    }

    const series = fiscal.invoice_series || "F";
    const number = fiscal.invoice_next_number || 1;
    const year = new Date().getFullYear();
    const invoice_number = `${series}-${year}/${String(number).padStart(4, "0")}`;
    const issueDate = new Date().toISOString().split("T")[0];

    // Verifactu hash
    const { data: lastInv } = await supabase.from("issued_invoices")
      .select("verifactu_hash").eq("user_id", userId).order("number", { ascending: false }).limit(1).single();
    const prevHash = lastInv?.verifactu_hash || "0";
    const total = Number(b.total || 0);
    const hashInput = `${invoice_number}|${fiscal.nif}|${total.toFixed(2)}|${issueDate}|${prevHash}`;
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    const hash = Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

    const { data: newInv, error } = await supabase.from("issued_invoices").insert({
      user_id: userId,
      client_id: project.client_id,
      project_id: project.id,
      budget_id: b.id,
      series, number, invoice_number,
      issuer_name: fiscal.business_name,
      issuer_nif: fiscal.nif,
      issuer_address: `${fiscal.address}, ${fiscal.postal_code} ${fiscal.city}`,
      client_name: clientData?.name || "",
      client_nif: (clientData as unknown as Record<string, string>)?.nif || "",
      client_address: (clientData as unknown as Record<string, string>)?.address || "",
      client_email: clientData?.email || "",
      issue_date: issueDate,
      subtotal: b.subtotal, iva_percent: fiscal.default_iva_percent,
      iva_amount: b.iva_amount, irpf_percent: fiscal.default_irpf_percent,
      irpf_amount: Number(b.subtotal) * (Number(fiscal.default_irpf_percent) / 100),
      total: Number(b.total) - Number(b.subtotal) * (Number(fiscal.default_irpf_percent) / 100),
      status: "draft",
      verifactu_hash: hash, verifactu_prev_hash: prevHash,
      verifactu_qr_data: `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${fiscal.nif}&numserie=${invoice_number}&fecha=${issueDate}&importe=${total.toFixed(2)}`,
      verifactu_registered: fiscal.verifactu_enabled,
    }).select("id").single();

    if (error) { alert("Error: " + error.message); return; }

    // Increment number
    await supabase.from("fiscal_settings").update({
      invoice_next_number: number + 1, updated_at: new Date().toISOString(),
    }).eq("id", fiscal.id);

    // Copy budget lines to invoice lines
    const { data: budgetLines } = await supabase.from("budget_lines").select("*").eq("budget_id", b.id).order("sort_order");
    if (budgetLines && budgetLines.length > 0 && newInv) {
      const invoiceLines = budgetLines.map((bl: Record<string, unknown>, idx: number) => ({
        invoice_id: newInv.id,
        description: bl.description as string || "",
        unit: bl.unit as string || "ud",
        quantity: bl.quantity as number || 1,
        unit_price: bl.unit_price as number || 0,
        total: bl.total as number || 0,
        sort_order: idx,
      }));
      await supabase.from("issued_invoice_lines").insert(invoiceLines);
    }

    alert(`Factura ${invoice_number} creada. Redirigiendo...`);
    if (newInv) window.location.href = `/dashboard/issued-invoices/${newInv.id}`;
  }

  /* ═══════════════════════════ KPIs ═══════════════════════════ */

  const kpis = useMemo(() => {
    const nPresupuestos = budgets.length;
    const nFacturas = invoices.length;
    const nCobros = payments.length;
    const nCambios = changes.length;

    const totalPresupuestado = budgets.reduce((s, b) => s + Number(b.total || 0), 0);
    const totalAprobado = budgets.filter((b) => b.status === "accepted")
      .reduce((s, b) => s + Number(b.total || 0), 0);

    // Extras aprobados/ejecutados suman al presupuesto real
    const extrasAprobados = changes
      .filter((c) => c.status === "approved" || c.status === "executed")
      .reduce((s, c) => s + Number(c.economic_impact || 0), 0);
    const presupuestoAjustado = totalAprobado + extrasAprobados;

    const costeReal = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const costeRealPagado = invoices.filter((i) => i.payment_status === "paid")
      .reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const costePendientePago = invoices
      .filter((i) => i.payment_status === "pending" || i.payment_status === "overdue")
      .reduce((s, i) => s + Number(i.total_amount || 0), 0);

    const totalCobrado = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

    const margenPrevisto = presupuestoAjustado - costeReal;
    const margenReal = totalCobrado - costeRealPagado;
    const pendienteCobro = presupuestoAjustado - totalCobrado;

    const pctMargenPrevisto = presupuestoAjustado > 0 ? (margenPrevisto / presupuestoAjustado) * 100 : 0;
    const pctMargenReal = totalCobrado > 0 ? (margenReal / totalCobrado) * 100 : 0;
    const desviacionCoste = presupuestoAjustado > 0
      ? ((costeReal - presupuestoAjustado) / presupuestoAjustado) * 100 : 0;

    let estadoEconomico: "verde" | "amarillo" | "rojo" | "gris" = "gris";
    if (presupuestoAjustado > 0) {
      if (margenPrevisto >= 0 && desviacionCoste <= 5) estadoEconomico = "verde";
      else if (margenPrevisto >= 0 && desviacionCoste <= 15) estadoEconomico = "amarillo";
      else estadoEconomico = "rojo";
    }

    // Hitos
    const hitosTotal = milestones.length;
    const hitosCompletados = milestones.filter((m) => m.status === "completed").length;

    // Impacto tiempo de extras
    const diasExtra = changes
      .filter((c) => c.status === "approved" || c.status === "executed")
      .reduce((s, c) => s + (c.time_impact_days || 0), 0);

    const nProveedores = projectSuppliers.length;
    const nPedidos = projectOrders.length;
    const nAlbaranes = projectDeliveryNotes.length;

    return {
      nPresupuestos, nFacturas, nCobros, nCambios, nProveedores, nPedidos, nAlbaranes,
      totalPresupuestado, totalAprobado, extrasAprobados, presupuestoAjustado,
      costeReal, costeRealPagado, costePendientePago,
      totalCobrado, margenPrevisto, margenReal, pendienteCobro,
      pctMargenPrevisto, pctMargenReal, desviacionCoste, estadoEconomico,
      hitosTotal, hitosCompletados, diasExtra,
    };
  }, [budgets, invoices, payments, changes, milestones, projectSuppliers, projectOrders, projectDeliveryNotes]);

  /* ═══════════════════════════ Loading ═══════════════════════════ */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }
  if (!project) return null;

  const estadoColors = {
    verde: "bg-emerald-900/30 text-emerald-300 border-emerald-500/30",
    amarillo: "bg-yellow-900/30 text-yellow-300 border-yellow-500/30",
    rojo: "bg-red-900/30 text-red-300 border-red-500/30",
    gris: "bg-[var(--color-navy-700)] text-[var(--color-navy-400)] border-[var(--color-navy-600)]",
  };
  const estadoLabels = { verde: "Saludable", amarillo: "Atención", rojo: "En riesgo", gris: "Sin datos" };

  /* ═══════════════════════════ Render ═══════════════════════════ */

  return (
    <div className="max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <Link href="/dashboard/projects" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block">
            ← Volver a obras
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">{project.name}</h1>
          {project.address && <p className="text-[var(--color-navy-400)] text-sm mt-0.5">📍 {project.address}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColorMap[project.status] || "bg-gray-700 text-gray-300"}`}>
            {statusLabelMap[project.status] || project.status}
          </span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium border ${estadoColors[kpis.estadoEconomico]}`}>
            {estadoLabels[kpis.estadoEconomico]}
          </span>
          {kpis.hitosTotal > 0 && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-[var(--color-navy-700)] text-[var(--color-navy-300)]">
              {kpis.hitosCompletados}/{kpis.hitosTotal} hitos
            </span>
          )}
          <button
            onClick={() => {
              const url = `${window.location.origin}/portal/${project.access_token}`;
              navigator.clipboard.writeText(url);
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 3000);
            }}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-navy-700)] text-[var(--color-navy-200)] hover:bg-[var(--color-navy-600)] border border-[var(--color-navy-600)] transition flex items-center gap-1.5">
            {linkCopied ? "✓ Enlace copiado" : "🔗 Compartir con cliente"}
          </button>
        </div>
      </div>

      {/* ── Info cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Datos de la obra</h3>
          <div className="space-y-2 text-sm">
            <InfoRow label="Estado" value={statusLabelMap[project.status] || project.status} />
            <InfoRow label="Fecha inicio" value={fmtDate(project.start_date)} />
            <InfoRow label="Fecha fin" value={fmtDate(project.end_date)} />
            {kpis.diasExtra > 0 && <InfoRow label="Días extra (cambios)" value={`+${kpis.diasExtra} días`} />}
            {project.description && (
              <div className="pt-2 border-t border-[var(--color-navy-700)]">
                <span className="text-[var(--color-navy-400)] block mb-1">Descripción</span>
                <span className="text-[var(--color-navy-200)]">{project.description}</span>
              </div>
            )}
            {project.notes && (
              <div className="pt-2 border-t border-[var(--color-navy-700)]">
                <span className="text-[var(--color-navy-400)] block mb-1">Notas</span>
                <span className="text-[var(--color-navy-200)] whitespace-pre-wrap">{project.notes}</span>
              </div>
            )}
          </div>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Cliente asociado</h3>
          {client ? (
            <div className="space-y-2 text-sm">
              <p className="text-[var(--color-navy-100)] font-medium text-base">{client.name}</p>
              {client.company && <p className="text-[var(--color-navy-300)]">🏢 {client.company}</p>}
              {client.email && <p className="text-[var(--color-navy-300)]">📧 {client.email}</p>}
              {client.phone && <p className="text-[var(--color-navy-300)]">📱 {client.phone}</p>}
            </div>
          ) : (
            <p className="text-[var(--color-navy-500)] text-sm">Sin cliente asignado</p>
          )}
        </div>
      </div>

      {/* ── Panel económico ── */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Resumen económico</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <KpiCard label="Total presupuestado" value={eur(kpis.totalPresupuestado)} color="text-blue-400" sub={`${kpis.nPresupuestos} presupuesto${kpis.nPresupuestos !== 1 ? "s" : ""}`} />
          <KpiCard label="Aprobado por cliente" value={eur(kpis.totalAprobado)} color="text-emerald-400" />
          <KpiCard label="Extras aprobados" value={eur(kpis.extrasAprobados)} color={kpis.extrasAprobados > 0 ? "text-purple-400" : "text-[var(--color-navy-500)]"} sub={`${kpis.nCambios} cambio${kpis.nCambios !== 1 ? "s" : ""}`} />
          <KpiCard label="Presupuesto ajustado" value={eur(kpis.presupuestoAjustado)} color="text-blue-300" sub="Aprobado + extras" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <KpiCard label="Coste real acumulado" value={eur(kpis.costeReal)} color="text-orange-400" sub={`${kpis.nFacturas} factura${kpis.nFacturas !== 1 ? "s" : ""}`} />
          <KpiCard label="Cobrado" value={eur(kpis.totalCobrado)} color="text-[var(--color-brand-green)]" sub={`${kpis.nCobros} cobro${kpis.nCobros !== 1 ? "s" : ""}`} />
          <KpiCard label="Pendiente de cobro" value={eur(kpis.pendienteCobro)} color={kpis.pendienteCobro > 0 ? "text-yellow-400" : "text-[var(--color-navy-400)]"} />
          <KpiCard label="Facturas sin pagar" value={eur(kpis.costePendientePago)} color={kpis.costePendientePago > 0 ? "text-red-400" : "text-[var(--color-navy-400)]"} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-[var(--color-navy-750)] rounded-xl p-4">
            <p className="text-xs text-[var(--color-navy-400)] mb-1">Margen previsto</p>
            <p className={`text-xl font-bold ${kpis.margenPrevisto >= 0 ? "text-emerald-400" : "text-red-400"}`}>{eur(kpis.margenPrevisto)}</p>
            <p className="text-xs text-[var(--color-navy-500)] mt-0.5">{kpis.pctMargenPrevisto.toFixed(1)}% sobre ajustado</p>
          </div>
          <div className="bg-[var(--color-navy-750)] rounded-xl p-4">
            <p className="text-xs text-[var(--color-navy-400)] mb-1">Margen real</p>
            <p className={`text-xl font-bold ${kpis.margenReal >= 0 ? "text-emerald-400" : "text-red-400"}`}>{eur(kpis.margenReal)}</p>
            <p className="text-xs text-[var(--color-navy-500)] mt-0.5">{kpis.pctMargenReal.toFixed(1)}% sobre cobrado</p>
          </div>
          <div className="bg-[var(--color-navy-750)] rounded-xl p-4 flex items-center justify-center col-span-2 md:col-span-1">
            <div className="text-center">
              <p className="text-xs text-[var(--color-navy-400)] mb-1">Estado económico</p>
              <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold border ${estadoColors[kpis.estadoEconomico]}`}>
                {estadoLabels[kpis.estadoEconomico]}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 bg-[var(--color-navy-800)] rounded-xl p-1 overflow-x-auto">
        {([
          { key: "resumen" as TabKey, label: "Resumen" },
          { key: "presupuestos" as TabKey, label: "Presupuestos", count: kpis.nPresupuestos },
          { key: "facturas" as TabKey, label: "Facturas", count: kpis.nFacturas },
          { key: "cobros" as TabKey, label: "Cobros", count: kpis.nCobros },
          { key: "cambios" as TabKey, label: "Cambios", count: kpis.nCambios },
          { key: "hitos" as TabKey, label: "Hitos", count: kpis.hitosTotal },
          { key: "proveedores" as TabKey, label: "Proveedores", count: kpis.nProveedores },
          { key: "trazabilidad" as TabKey, label: "Trazabilidad", count: kpis.nPedidos + kpis.nAlbaranes },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-[var(--color-brand-green)] text-[var(--color-navy-900)]"
                : "text-[var(--color-navy-300)] hover:text-[var(--color-navy-100)] hover:bg-[var(--color-navy-750)]"
            }`}>
            {tab.label}
            {"count" in tab && tab.count !== undefined && (
              <span className={`ml-1 text-xs ${activeTab === tab.key ? "opacity-70" : "text-[var(--color-navy-500)]"}`}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════ TAB: Resumen ═══════ */}
      {activeTab === "resumen" && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-10">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Últimos movimientos</h3>
          {budgets.length === 0 && invoices.length === 0 && payments.length === 0 && changes.length === 0 ? (
            <p className="text-[var(--color-navy-500)] text-sm">No hay movimientos todavía en esta obra.</p>
          ) : (
            <div className="space-y-2">
              {[
                ...budgets.slice(0, 3).map((b) => ({ date: b.created_at, label: `Presupuesto ${b.budget_number} — ${b.title}`, amount: Number(b.total || 0), status: budgetStatusMap[b.status]?.label || b.status, color: "text-blue-400", sign: "" })),
                ...invoices.slice(0, 3).map((i) => ({ date: i.invoice_date || i.created_at, label: `Factura ${i.invoice_number || "s/n"} — ${i.supplier_name}`, amount: Number(i.total_amount || 0), status: invoiceStatusMap[i.payment_status]?.label || i.payment_status, color: "text-orange-400", sign: "−" })),
                ...payments.slice(0, 3).map((p) => ({ date: p.payment_date, label: `Cobro — ${p.concept}`, amount: Number(p.amount || 0), status: p.payment_method, color: "text-emerald-400", sign: "+" })),
                ...changes.filter((c) => c.status === "approved" || c.status === "executed").slice(0, 3).map((c) => ({ date: c.approved_date || c.created_at, label: `Extra — ${c.title}`, amount: Number(c.economic_impact || 0), status: changeStatusMap[c.status]?.label || c.status, color: "text-purple-400", sign: "+" })),
              ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10).map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--color-navy-700)] last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-navy-100)] truncate">{item.label}</p>
                    <p className="text-xs text-[var(--color-navy-500)]">{fmtDate(item.date)} · {item.status}</p>
                  </div>
                  <p className={`text-sm font-semibold ${item.color} ml-4 whitespace-nowrap`}>{item.sign}{eur(item.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: Presupuestos ═══════ */}
      {activeTab === "presupuestos" && (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden mb-10">
          <div className="p-5 border-b border-[var(--color-navy-700)] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Presupuestos ({budgets.length})</h3>
            <Link href="/dashboard/budgets/new" className="text-xs text-[var(--color-brand-green)] hover:underline">+ Nuevo presupuesto</Link>
          </div>
          {budgets.length === 0 ? (
            <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay presupuestos vinculados.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-[var(--color-navy-750)]">
                  <Th align="left">Nº</Th><Th align="left">Título</Th><Th>Servicio</Th><Th>Estado</Th><Th align="right">Total</Th><Th>Fecha</Th><Th align="right">Acción</Th>
                </tr></thead>
                <tbody>{budgets.map((b) => {
                  const st = budgetStatusMap[b.status] || { label: b.status, color: "bg-gray-700 text-gray-300" };
                  return (
                    <tr key={b.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-5 py-3 text-sm text-[var(--color-navy-300)] font-mono">{b.budget_number}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-navy-100)] font-medium">{b.title}</td>
                      <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{serviceLabels[b.service_type] || b.service_type}</td>
                      <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{eur(b.total)}</td>
                      <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-400)]">{fmtDate(b.created_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/dashboard/budgets/${b.id}`} className="text-xs text-[var(--color-brand-green)] hover:underline">Ver detalle</Link>
                          {b.status === "accepted" && (
                            <button onClick={() => generateInvoiceFromBudget(b)} className="text-xs text-purple-400 hover:underline">Facturar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: Facturas ═══════ */}
      {activeTab === "facturas" && (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden mb-10">
          <div className="p-5 border-b border-[var(--color-navy-700)] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Facturas ({invoices.length})</h3>
            <Link href="/dashboard/facturas" className="text-xs text-[var(--color-brand-green)] hover:underline">+ Nueva factura</Link>
          </div>
          {invoices.length === 0 ? (
            <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay facturas vinculadas.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-[var(--color-navy-750)]">
                  <Th align="left">Nº</Th><Th align="left">Proveedor</Th><Th>Categoría</Th><Th>Estado</Th><Th align="right">Base</Th><Th align="right">Total</Th><Th>Fecha</Th>
                </tr></thead>
                <tbody>{invoices.map((inv) => {
                  const st = invoiceStatusMap[inv.payment_status] || { label: inv.payment_status, color: "bg-gray-700 text-gray-300" };
                  return (
                    <tr key={inv.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-5 py-3 text-sm text-[var(--color-navy-300)] font-mono">{inv.invoice_number || "—"}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-navy-100)] font-medium">{inv.supplier_name}</td>
                      <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{categoryLabels[inv.category] || inv.category}</td>
                      <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-200)]">{eur(inv.base_amount)}</td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{eur(inv.total_amount)}</td>
                      <td className="px-5 py-3 text-center text-xs text-[var(--color-navy-400)]">{fmtDate(inv.invoice_date)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: Cobros ═══════ */}
      {activeTab === "cobros" && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Cobros ({payments.length})</h3>
            <button onClick={() => setShowPaymentForm(!showPaymentForm)}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Registrar cobro
            </button>
          </div>
          {showPaymentForm && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Importe (€) *">
                  <input type="number" min="0" step="0.01" value={paymentForm.amount || ""} onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })} className={inputCls} placeholder="0.00" />
                </FormField>
                <FormField label="Fecha *">
                  <input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} className={inputCls} />
                </FormField>
                <FormField label="Método de pago">
                  <select value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className={inputCls}>
                    {paymentMethods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Concepto *" span={2}>
                  <input type="text" value={paymentForm.concept} onChange={(e) => setPaymentForm({ ...paymentForm, concept: e.target.value })} className={inputCls} placeholder="Ej: Certificación Fase 1" />
                </FormField>
                <FormField label="Notas">
                  <input type="text" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className={inputCls} placeholder="Observaciones" />
                </FormField>
              </div>
              <FormActions onSave={handleSavePayment} onCancel={() => { setShowPaymentForm(false); setPaymentForm(emptyPaymentForm); }} saving={savingPayment} label="Guardar cobro" />
            </div>
          )}
          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {payments.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay cobros registrados.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="bg-[var(--color-navy-750)]">
                    <Th>Fecha</Th><Th align="left">Concepto</Th><Th>Método</Th><Th align="right">Importe</Th><Th align="right">Acción</Th>
                  </tr></thead>
                  <tbody>{payments.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-5 py-3 text-center text-sm text-[var(--color-navy-300)]">{fmtDate(p.payment_date)}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-navy-100)] font-medium">{p.concept}{p.notes && <span className="text-xs text-[var(--color-navy-500)] ml-2">({p.notes})</span>}</td>
                      <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">{paymentMethods.find((m) => m.value === p.payment_method)?.label || p.payment_method}</td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-emerald-400">{eur(p.amount)}</td>
                      <td className="px-5 py-3 text-right"><button onClick={() => handleDeletePayment(p.id)} className="text-xs text-red-400 hover:underline">Eliminar</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          {payments.length > 0 && (
            <div className="flex justify-end mt-3">
              <div className="bg-[var(--color-navy-800)] rounded-xl px-5 py-3">
                <span className="text-sm text-[var(--color-navy-400)] mr-3">Total cobrado:</span>
                <span className="text-lg font-bold text-[var(--color-brand-green)]">{eur(kpis.totalCobrado)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: Cambios / Extras ═══════ */}
      {activeTab === "cambios" && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Cambios / Extras ({changes.length})</h3>
            <button onClick={() => { setChangeForm(emptyChangeForm); setEditingChangeId(null); setShowChangeForm(!showChangeForm); }}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Nuevo cambio
            </button>
          </div>

          {showChangeForm && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)]">
              <h4 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">{editingChangeId ? "Editar cambio" : "Nuevo cambio"}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Título *" span={2}>
                  <input type="text" value={changeForm.title} onChange={(e) => setChangeForm({ ...changeForm, title: e.target.value })} className={inputCls} placeholder="Ej: Añadir tabique en cocina" />
                </FormField>
                <FormField label="Estado">
                  <select value={changeForm.status} onChange={(e) => setChangeForm({ ...changeForm, status: e.target.value })} className={inputCls}>
                    <option value="proposed">Propuesto</option>
                    <option value="approved">Aprobado por cliente</option>
                    <option value="rejected">Rechazado</option>
                    <option value="executed">Ejecutado</option>
                  </select>
                </FormField>
                <FormField label="Impacto económico (€)">
                  <input type="number" step="0.01" value={changeForm.economic_impact || ""} onChange={(e) => setChangeForm({ ...changeForm, economic_impact: parseFloat(e.target.value) || 0 })} className={inputCls} placeholder="0.00" />
                </FormField>
                <FormField label="Impacto en plazo (días)">
                  <input type="number" value={changeForm.time_impact_days || ""} onChange={(e) => setChangeForm({ ...changeForm, time_impact_days: parseInt(e.target.value) || 0 })} className={inputCls} placeholder="0" />
                </FormField>
                <FormField label="Descripción" span={3}>
                  <textarea value={changeForm.description} onChange={(e) => setChangeForm({ ...changeForm, description: e.target.value })} className={`${inputCls} min-h-[80px]`} placeholder="Describe el cambio solicitado por el cliente..." />
                </FormField>
                <FormField label="Observaciones" span={3}>
                  <input type="text" value={changeForm.notes} onChange={(e) => setChangeForm({ ...changeForm, notes: e.target.value })} className={inputCls} placeholder="Notas internas" />
                </FormField>
              </div>
              <FormActions onSave={handleSaveChange} onCancel={() => { setShowChangeForm(false); setChangeForm(emptyChangeForm); setEditingChangeId(null); }} saving={savingChange} label={editingChangeId ? "Guardar cambios" : "Crear cambio"} />
            </div>
          )}

          {/* Resumen impacto */}
          {changes.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <KpiCard label="Total cambios" value={String(changes.length)} color="text-purple-400" />
              <KpiCard label="Aprobados" value={String(changes.filter((c) => c.status === "approved" || c.status === "executed").length)} color="text-green-400" />
              <KpiCard label="Impacto económico" value={eur(kpis.extrasAprobados)} color="text-purple-400" />
              <KpiCard label="Impacto plazo" value={`+${kpis.diasExtra} días`} color={kpis.diasExtra > 0 ? "text-orange-400" : "text-[var(--color-navy-400)]"} />
            </div>
          )}

          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {changes.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay cambios registrados en esta obra.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-navy-700)]">
                {changes.map((c) => {
                  const st = changeStatusMap[c.status] || { label: c.status, color: "bg-gray-700 text-gray-300" };
                  return (
                    <div key={c.id} className="p-5 hover:bg-[var(--color-navy-750)] transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-semibold text-[var(--color-navy-100)]">{c.title}</h4>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                            {c.client_approved && <span className="text-xs text-green-400">✓ Cliente</span>}
                          </div>
                          {c.description && <p className="text-sm text-[var(--color-navy-300)] mb-2">{c.description}</p>}
                          <div className="flex flex-wrap gap-4 text-xs text-[var(--color-navy-400)]">
                            <span>💰 {eur(c.economic_impact)}</span>
                            {c.time_impact_days > 0 && <span>📅 +{c.time_impact_days} días</span>}
                            <span>Creado: {fmtDate(c.created_at)}</span>
                            {c.approved_date && <span>Aprobado: {fmtDate(c.approved_date)}</span>}
                          </div>
                          {c.notes && <p className="text-xs text-[var(--color-navy-500)] mt-1 italic">{c.notes}</p>}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => startEditChange(c)} className="text-xs text-[var(--color-brand-green)] hover:underline">Editar</button>
                          <button onClick={() => handleDeleteChange(c.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: Hitos ═══════ */}
      {activeTab === "hitos" && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Hitos ({milestones.length})</h3>
            <button onClick={() => { setMilestoneForm(emptyMilestoneForm); setEditingMilestoneId(null); setShowMilestoneForm(!showMilestoneForm); }}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Nuevo hito
            </button>
          </div>

          {showMilestoneForm && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)]">
              <h4 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">{editingMilestoneId ? "Editar hito" : "Nuevo hito"}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Título *" span={2}>
                  <input type="text" value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} className={inputCls} placeholder="Ej: Demolición completada" />
                </FormField>
                <FormField label="Estado">
                  <select value={milestoneForm.status} onChange={(e) => setMilestoneForm({ ...milestoneForm, status: e.target.value })} className={inputCls}>
                    <option value="pending">Pendiente</option>
                    <option value="in_progress">En curso</option>
                    <option value="completed">Completado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </FormField>
                <FormField label="Fecha prevista">
                  <input type="date" value={milestoneForm.planned_date} onChange={(e) => setMilestoneForm({ ...milestoneForm, planned_date: e.target.value })} className={inputCls} />
                </FormField>
                <FormField label="Notas" span={2}>
                  <input type="text" value={milestoneForm.notes} onChange={(e) => setMilestoneForm({ ...milestoneForm, notes: e.target.value })} className={inputCls} placeholder="Observaciones del hito" />
                </FormField>
              </div>
              <FormActions onSave={handleSaveMilestone} onCancel={() => { setShowMilestoneForm(false); setMilestoneForm(emptyMilestoneForm); setEditingMilestoneId(null); }} saving={savingMilestone} label={editingMilestoneId ? "Guardar hito" : "Crear hito"} />
            </div>
          )}

          {/* Progress bar */}
          {milestones.length > 0 && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--color-navy-300)]">Progreso</span>
                <span className="text-sm font-semibold text-[var(--color-navy-100)]">{kpis.hitosCompletados}/{kpis.hitosTotal}</span>
              </div>
              <div className="w-full bg-[var(--color-navy-700)] rounded-full h-2.5">
                <div
                  className="bg-[var(--color-brand-green)] h-2.5 rounded-full transition-all"
                  style={{ width: `${kpis.hitosTotal > 0 ? (kpis.hitosCompletados / kpis.hitosTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {milestones.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay hitos definidos para esta obra.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-navy-700)]">
                {milestones.map((m, idx) => {
                  const st = milestoneStatusMap[m.status] || { label: m.status, color: "bg-gray-700 text-gray-300" };
                  const isLate = m.planned_date && !m.actual_date && m.status !== "completed" && m.status !== "cancelled" && new Date(m.planned_date) < new Date();
                  return (
                    <div key={m.id} className="p-4 hover:bg-[var(--color-navy-750)] transition">
                      <div className="flex items-center gap-4">
                        {/* Check circle */}
                        <button onClick={() => toggleMilestoneComplete(m)}
                          className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition ${
                            m.status === "completed"
                              ? "bg-[var(--color-brand-green)] border-[var(--color-brand-green)] text-[var(--color-navy-900)]"
                              : "border-[var(--color-navy-600)] text-transparent hover:border-[var(--color-brand-green)]"
                          }`}>
                          {m.status === "completed" && <span className="text-sm">✓</span>}
                        </button>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--color-navy-500)]">#{idx + 1}</span>
                            <h4 className={`text-sm font-medium ${m.status === "completed" ? "text-[var(--color-navy-400)] line-through" : "text-[var(--color-navy-100)]"}`}>
                              {m.title}
                            </h4>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                            {isLate && <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 font-medium">Retrasado</span>}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-[var(--color-navy-500)] mt-1">
                            {m.planned_date && <span>Previsto: {fmtDate(m.planned_date)}</span>}
                            {m.actual_date && <span>Real: {fmtDate(m.actual_date)}</span>}
                            {m.notes && <span className="italic">{m.notes}</span>}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button onClick={() => startEditMilestone(m)} className="text-xs text-[var(--color-brand-green)] hover:underline">Editar</button>
                          <button onClick={() => handleDeleteMilestone(m.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: Proveedores ═══════ */}
      {activeTab === "proveedores" && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Proveedores / Subcontratas ({projectSuppliers.length})</h3>
            <button onClick={() => { setSupplierAssignForm({ supplier_id: "", role: "", notes: "" }); setShowSupplierAssign(!showSupplierAssign); }}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Asignar proveedor
            </button>
          </div>

          {showSupplierAssign && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)]">
              <h4 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">Asignar proveedor a esta obra</h4>
              {availableSuppliers.length === 0 ? (
                <p className="text-sm text-[var(--color-navy-400)]">No hay proveedores disponibles para asignar. <Link href="/dashboard/suppliers" className="text-[var(--color-brand-green)] hover:underline">Crear nuevo proveedor</Link></p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Proveedor *" span={1}>
                      <select value={supplierAssignForm.supplier_id} onChange={(e) => setSupplierAssignForm({ ...supplierAssignForm, supplier_id: e.target.value })} className={inputCls}>
                        <option value="">Seleccionar...</option>
                        {availableSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} — {s.trade}{s.type ? ` (${s.type === "subcontrata" ? "Subcontrata" : "Proveedor"})` : ""}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Rol en obra">
                      <input type="text" value={supplierAssignForm.role} onChange={(e) => setSupplierAssignForm({ ...supplierAssignForm, role: e.target.value })} className={inputCls} placeholder="Ej: Fontanería planta baja" />
                    </FormField>
                    <FormField label="Notas">
                      <input type="text" value={supplierAssignForm.notes} onChange={(e) => setSupplierAssignForm({ ...supplierAssignForm, notes: e.target.value })} className={inputCls} placeholder="Observaciones" />
                    </FormField>
                  </div>
                  <FormActions onSave={handleAssignSupplier} onCancel={() => { setShowSupplierAssign(false); setSupplierAssignForm({ supplier_id: "", role: "", notes: "" }); }} saving={savingSupplierAssign} label="Asignar" />
                </>
              )}
            </div>
          )}

          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {projectSuppliers.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay proveedores asignados a esta obra.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-navy-700)]">
                {projectSuppliers.map((ps) => {
                  const s = ps.suppliers;
                  const stars = s.rating ? "★".repeat(s.rating) + "☆".repeat(5 - s.rating) : "—";
                  return (
                    <div key={ps.id} className="p-4 hover:bg-[var(--color-navy-750)] transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Link href="/dashboard/suppliers" className="text-sm font-medium text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] transition">{s.name}</Link>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.type === "subcontrata" ? "bg-purple-900/30 text-purple-300" : "bg-blue-900/30 text-blue-300"}`}>
                              {s.type === "subcontrata" ? "Subcontrata" : "Proveedor"}
                            </span>
                            {ps.role && <span className="text-xs text-[var(--color-navy-400)]">· {ps.role}</span>}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-[var(--color-navy-500)]">
                            <span>{s.trade}{s.specialty ? ` — ${s.specialty}` : ""}</span>
                            {s.contact_person && <span>Contacto: {s.contact_person}</span>}
                            {s.phone && <span>{s.phone}</span>}
                            {s.email && <span>{s.email}</span>}
                            {s.hourly_rate && <span>{Number(s.hourly_rate).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}/h</span>}
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-[var(--color-navy-500)]">
                            <span className="text-yellow-400">{stars}</span>
                            {ps.notes && <span className="italic">{ps.notes}</span>}
                          </div>
                        </div>
                        <button onClick={() => handleRemoveSupplier(ps.id)} className="text-xs text-red-400 hover:underline flex-shrink-0">Quitar</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: Trazabilidad ═══════ */}
      {activeTab === "trazabilidad" && (
        <div className="space-y-6">
          {/* Pedidos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Pedidos ({projectOrders.length})</h3>
              <Link href="/dashboard/orders" className="text-xs text-[var(--color-brand-green)] hover:underline">Ver todos →</Link>
            </div>
            <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
              {projectOrders.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[var(--color-navy-500)]">No hay pedidos vinculados a esta obra.</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-navy-700)]">
                      <Th>Pedido</Th><Th>Fecha</Th><Th align="right">Total</Th><Th>Estado</Th><Th align="right">Acc.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectOrders.map((o) => {
                      const ost = orderStatusMap[o.status] || { label: o.status, color: "bg-gray-700 text-gray-300" };
                      const sName = allSuppliers.find((s) => s.id === o.supplier_id)?.name;
                      return (
                        <tr key={o.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                          <td className="px-4 py-3">
                            <p className="text-[var(--color-navy-100)] font-medium">{o.title}</p>
                            <p className="text-xs text-[var(--color-navy-500)]">{o.order_number}{sName ? ` · ${sName}` : ""}</p>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(o.order_date)}</td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(o.total)}</td>
                          <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ost.color}`}>{ost.label}</span></td>
                          <td className="px-4 py-3 text-right"><Link href={`/dashboard/orders/${o.id}`} className="text-xs text-[var(--color-brand-green)] hover:underline">Detalle</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Albaranes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Albaranes ({projectDeliveryNotes.length})</h3>
              <Link href="/dashboard/delivery-notes" className="text-xs text-[var(--color-brand-green)] hover:underline">Ver todos →</Link>
            </div>
            <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
              {projectDeliveryNotes.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[var(--color-navy-500)]">No hay albaranes vinculados a esta obra.</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-navy-700)]">
                      <Th>Albarán</Th><Th>Fecha</Th><Th align="right">Total</Th><Th>Estado</Th><Th>Pedido</Th><Th align="right">Acc.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectDeliveryNotes.map((dn) => {
                      const dst = dnStatusMap[dn.status] || { label: dn.status, color: "bg-gray-700 text-gray-300" };
                      const linkedOrder = projectOrders.find((o) => o.id === dn.order_id);
                      return (
                        <tr key={dn.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                          <td className="px-4 py-3 font-mono text-[var(--color-navy-100)]">{dn.note_number || "Sin nº"}</td>
                          <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(dn.reception_date)}</td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(dn.total)}</td>
                          <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dst.color}`}>{dst.label}</span></td>
                          <td className="px-4 py-3 text-[var(--color-navy-400)]">{linkedOrder ? (linkedOrder.order_number || linkedOrder.title) : "—"}</td>
                          <td className="px-4 py-3 text-right"><Link href={`/dashboard/delivery-notes/${dn.id}`} className="text-xs text-[var(--color-brand-green)] hover:underline">Detalle</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Traceability summary */}
          {(projectOrders.length > 0 || projectDeliveryNotes.length > 0) && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
              <h4 className="text-xs font-semibold text-[var(--color-navy-400)] uppercase mb-3">Resumen de trazabilidad</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-blue-400">{projectOrders.length}</p>
                  <p className="text-xs text-[var(--color-navy-500)]">Pedidos</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-purple-400">{projectDeliveryNotes.length}</p>
                  <p className="text-xs text-[var(--color-navy-500)]">Albaranes</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-400">{eur(projectOrders.reduce((s, o) => s + Number(o.total || 0), 0))}</p>
                  <p className="text-xs text-[var(--color-navy-500)]">Total pedidos</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-yellow-400">{eur(projectDeliveryNotes.reduce((s, d) => s + Number(d.total || 0), 0))}</p>
                  <p className="text-xs text-[var(--color-navy-500)]">Total albaranes</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ Shared UI ═══════════════════════════ */

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-[var(--color-navy-750)] rounded-xl p-4 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--color-navy-400)] mt-1">{label}</p>
      {sub && <p className="text-xs text-[var(--color-navy-500)] mt-0.5">{sub}</p>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-navy-400)]">{label}</span>
      <span className="text-[var(--color-navy-100)] font-medium">{value}</span>
    </div>
  );
}

function Th({ children, align = "center" }: { children: React.ReactNode; align?: "left" | "center" | "right" }) {
  return <th className={`${align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"} text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3`}>{children}</th>;
}

function FormField({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  const spanCls = span === 2 ? "md:col-span-2" : span === 3 ? "md:col-span-3" : "";
  return (
    <div className={spanCls}>
      <label className="block text-xs text-[var(--color-navy-400)] mb-1">{label}</label>
      {children}
    </div>
  );
}

function FormActions({ onSave, onCancel, saving, label }: { onSave: () => void; onCancel: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex gap-3 mt-4">
      <button onClick={onSave} disabled={saving}
        className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
        {saving ? "Guardando..." : label}
      </button>
      <button onClick={onCancel}
        className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm hover:bg-[var(--color-navy-600)] transition">
        Cancelar
      </button>
    </div>
  );
}
