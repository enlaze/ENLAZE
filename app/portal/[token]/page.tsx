"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";

/* ═══════════════════════════ Types ═══════════════════════════ */

interface Project {
  id: string;
  name: string;
  address: string;
  description: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  budget_amount: number;
  notes: string;
  created_at: string;
  client_id: string | null;
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
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  base_amount: number;
  iva_amount: number;
  total_amount: number;
  category: string;
  payment_status: string;
}

interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  concept: string;
}

interface ProjectChange {
  id: string;
  title: string;
  description: string;
  economic_impact: number;
  time_impact_days: number;
  status: string;
  client_approved: boolean;
  notes: string;
  created_at: string;
}

interface Milestone {
  id: string;
  title: string;
  planned_date: string | null;
  actual_date: string | null;
  status: string;
  sort_order: number;
  notes: string;
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
const invoiceStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  paid: { label: "Pagada", color: "bg-green-900/30 text-green-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
  cancelled: { label: "Anulada", color: "bg-gray-700 text-gray-400" },
};
const paymentMethodLabels: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta",
  cheque: "Cheque", pagare: "Pagaré", bizum: "Bizum", otro: "Otro",
};

/* ═══════════════════════════ Helpers ═══════════════════════════ */

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}

/* ═══════════════════════════ Page ═══════════════════════════ */

type PortalTab = "estado" | "presupuestos" | "cambios" | "facturas";

export default function ClientPortalPage() {
  const params = useParams();
  const token = params.token as string;

  const supabase = createClient();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>("estado");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => { loadPortal(); }, []);

  async function loadPortal() {
    try {
      // Try portal_tokens first, then fall back to projects.access_token (legacy)
      let proj = null;

      const { data: portalToken } = await supabase
        .from("portal_tokens")
        .select("project_id, id")
        .eq("token", token)
        .eq("is_active", true)
        .single();

      if (portalToken) {
        // Record access on portal_token (fire-and-forget)
        supabase.from("portal_tokens").update({
          last_accessed_at: new Date().toISOString(),
          access_count: (portalToken as unknown as Record<string, number>).access_count
            ? (portalToken as unknown as Record<string, number>).access_count + 1
            : 1,
        }).eq("id", portalToken.id).then(() => {});

        const { data: p } = await supabase
          .from("projects").select("*").eq("id", portalToken.project_id).single();
        if (p) proj = p;
      }

      // Fallback: legacy access_token on projects
      if (!proj) {
        const { data: p, error: pErr } = await supabase
          .from("projects").select("*").eq("access_token", token).single();
        if (pErr || !p) { setNotFound(true); setLoading(false); return; }
        proj = p;
      }

      if (!proj) { setNotFound(true); setLoading(false); return; }
      setProject(proj);

      const pid = proj.id;
      const cid = proj.client_id;

      const budgetFilter = cid
        ? `project_id.eq.${pid},and(client_id.eq.${cid},project_id.is.null)`
        : `project_id.eq.${pid}`;
      const invoiceFilter = cid
        ? `project_id.eq.${pid},and(client_id.eq.${cid},project_id.is.null)`
        : `project_id.eq.${pid}`;

      const [clientRes, budgetsRes, invoicesRes, paymentsRes, changesRes, milestonesRes] =
        await Promise.all([
          cid
            ? supabase.from("clients").select("id, name, email, phone, company").eq("id", cid).single()
            : Promise.resolve({ data: null }),
          supabase.from("budgets")
            .select("id, budget_number, title, service_type, status, subtotal, iva_amount, total, created_at")
            .or(budgetFilter).order("created_at", { ascending: false }),
          supabase.from("invoices")
            .select("id, invoice_number, invoice_date, base_amount, iva_amount, total_amount, category, payment_status")
            .or(invoiceFilter).order("invoice_date", { ascending: false }),
          supabase.from("payments")
            .select("id, amount, payment_date, payment_method, concept")
            .eq("project_id", pid).order("payment_date", { ascending: false }),
          supabase.from("project_changes")
            .select("id, title, description, economic_impact, time_impact_days, status, client_approved, notes, created_at")
            .eq("project_id", pid).order("created_at", { ascending: false }),
          supabase.from("project_milestones")
            .select("id, title, planned_date, actual_date, status, sort_order, notes")
            .eq("project_id", pid).order("sort_order", { ascending: true }),
        ]);

      if (clientRes.data) setClient(clientRes.data as Client);
      const budgetsList = (budgetsRes.data as Budget[]) || [];
      setBudgets(budgetsList);
      setInvoices((invoicesRes.data as Invoice[]) || []);
      setPayments((paymentsRes.data as Payment[]) || []);
      setChanges((changesRes.data as ProjectChange[]) || []);
      setMilestones((milestonesRes.data as Milestone[]) || []);

      // Fire-and-forget: mark un-viewed budgets as viewed_at
      const now = new Date().toISOString();
      const unviewedIds = budgetsList
        .filter((b) => !(b as unknown as Record<string, unknown>).viewed_at)
        .map((b) => b.id);
      if (unviewedIds.length > 0) {
        supabase.from("budgets")
          .update({ viewed_at: now })
          .in("id", unviewedIds)
          .then(() => {});
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  /* ── Actions: Approve/Reject budget ── */

  async function handleBudgetAction(id: string, newStatus: "accepted" | "rejected") {
    setActionLoading(id);
    const now = new Date().toISOString();
    const timestampFields: Record<string, string | null> = newStatus === "accepted"
      ? { accepted_at: now, rejected_at: null }
      : { rejected_at: now, accepted_at: null };

    const { error } = await supabase.from("budgets").update({
      status: newStatus,
      ...timestampFields,
    }).eq("id", id);
    if (error) {
      toast.error("Error", { description: error.message });
    } else {
      setBudgets((prev) => prev.map((b) => b.id === id ? { ...b, status: newStatus } : b));
      toast.success(newStatus === "accepted" ? "Presupuesto aceptado" : "Presupuesto rechazado");
    }
    setActionLoading(null);
  }

  /* ── Actions: Approve/Reject change ── */

  async function handleChangeAction(id: string, approve: boolean) {
    setActionLoading(id);
    const newStatus = approve ? "approved" : "rejected";
    const { error } = await supabase.from("project_changes").update({
      status: newStatus,
      client_approved: approve,
      approved_date: approve ? new Date().toISOString().split("T")[0] : null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) {
      toast.error("Error", { description: error.message });
    } else {
      setChanges((prev) => prev.map((c) =>
        c.id === id ? { ...c, status: newStatus, client_approved: approve } : c
      ));
      toast.success(approve ? "Cambio aprobado" : "Cambio rechazado");
    }
    setActionLoading(null);
  }

  /* ── KPIs ── */

  const kpis = useMemo(() => {
    const totalPresupuestado = budgets.reduce((s, b) => s + Number(b.total || 0), 0);
    const totalAprobado = budgets.filter((b) => b.status === "accepted")
      .reduce((s, b) => s + Number(b.total || 0), 0);
    const extrasAprobados = changes
      .filter((c) => c.status === "approved" || c.status === "executed")
      .reduce((s, c) => s + Number(c.economic_impact || 0), 0);
    const presupuestoAjustado = totalAprobado + extrasAprobados;
    const totalCobrado = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const pendienteCobro = presupuestoAjustado - totalCobrado;
    const hitosTotal = milestones.length;
    const hitosCompletados = milestones.filter((m) => m.status === "completed").length;
    const pctHitos = hitosTotal > 0 ? Math.round((hitosCompletados / hitosTotal) * 100) : 0;

    return { totalPresupuestado, totalAprobado, extrasAprobados, presupuestoAjustado, totalCobrado, pendienteCobro, hitosTotal, hitosCompletados, pctHitos };
  }, [budgets, changes, payments, milestones]);

  /* ── Render: loading / not found ── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--color-brand-green)] mx-auto mb-4"></div>
          <p className="text-[var(--color-navy-400)]">Cargando portal...</p>
        </div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-[var(--color-navy-100)] mb-2">Enlace no válido</h1>
          <p className="text-[var(--color-navy-400)]">Este enlace de acceso no existe o ha sido desactivado. Contacta con tu profesional para obtener un enlace actualizado.</p>
        </div>
      </div>
    );
  }

  const stLabel = statusLabelMap[project.status] || project.status;
  const stColor = statusColorMap[project.status] || "bg-gray-700 text-gray-300";

  /* ═══════════════════════════ Render ═══════════════════════════ */

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-brand-green)] flex items-center justify-center text-[var(--color-navy-900)] font-bold text-lg">E</div>
          <span className="text-sm text-[var(--color-navy-500)]">Portal de Cliente — Enlaze</span>
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)] mt-3">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${stColor}`}>{stLabel}</span>
          {project.address && <span className="text-sm text-[var(--color-navy-400)]">📍 {project.address}</span>}
          {client && <span className="text-sm text-[var(--color-navy-400)]">👤 {client.name}{client.company ? ` — ${client.company}` : ""}</span>}
        </div>
        {project.description && <p className="text-sm text-[var(--color-navy-400)] mt-2">{project.description}</p>}
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <KpiCard label="Presupuesto aprobado" value={eur(kpis.presupuestoAjustado)} color="text-emerald-400" />
        <KpiCard label="Total cobrado" value={eur(kpis.totalCobrado)} color="text-blue-400" />
        <KpiCard label="Pendiente de cobro" value={eur(kpis.pendienteCobro)} color={kpis.pendienteCobro > 0 ? "text-yellow-400" : "text-green-400"} />
        <KpiCard label="Progreso hitos" value={`${kpis.pctHitos}%`} color="text-purple-400" sub={`${kpis.hitosCompletados}/${kpis.hitosTotal}`} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--color-navy-800)] rounded-xl p-1 overflow-x-auto">
        {([
          { key: "estado" as PortalTab, label: "Estado y Hitos" },
          { key: "presupuestos" as PortalTab, label: "Presupuestos", count: budgets.length },
          { key: "cambios" as PortalTab, label: "Cambios / Extras", count: changes.length },
          { key: "facturas" as PortalTab, label: "Facturas y Cobros", count: invoices.length },
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

      {/* ═══════ TAB: Estado y Hitos ═══════ */}
      {activeTab === "estado" && (
        <div>
          {/* Project info */}
          <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Datos de la obra</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <InfoRow label="Fecha inicio" value={fmtDate(project.start_date)} />
              <InfoRow label="Fecha fin prevista" value={fmtDate(project.end_date)} />
              {kpis.extrasAprobados > 0 && <InfoRow label="Extras aprobados" value={eur(kpis.extrasAprobados)} />}
            </div>
          </div>

          {/* Milestones timeline */}
          <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Hitos de la obra ({kpis.hitosCompletados}/{kpis.hitosTotal})</h3>

            {/* Progress bar */}
            {milestones.length > 0 && (
              <div className="mb-5">
                <div className="w-full bg-[var(--color-navy-700)] rounded-full h-3">
                  <div
                    className="bg-[var(--color-brand-green)] h-3 rounded-full transition-all"
                    style={{ width: `${kpis.pctHitos}%` }}
                  />
                </div>
                <p className="text-xs text-[var(--color-navy-500)] mt-1 text-right">{kpis.pctHitos}% completado</p>
              </div>
            )}

            {milestones.length === 0 ? (
              <p className="text-[var(--color-navy-500)] text-sm">Aún no se han definido hitos para esta obra.</p>
            ) : (
              <div className="space-y-3">
                {milestones.map((m, idx) => {
                  const st = milestoneStatusMap[m.status] || { label: m.status, color: "bg-gray-700 text-gray-300" };
                  const isLate = m.planned_date && !m.actual_date && m.status !== "completed" && m.status !== "cancelled" && new Date(m.planned_date) < new Date();
                  return (
                    <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-navy-750)]">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        m.status === "completed"
                          ? "bg-[var(--color-brand-green)] text-[var(--color-navy-900)]"
                          : m.status === "in_progress"
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                          : "bg-[var(--color-navy-700)] text-[var(--color-navy-500)]"
                      }`}>
                        {m.status === "completed" ? "✓" : idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${m.status === "completed" ? "text-[var(--color-navy-400)] line-through" : "text-[var(--color-navy-100)]"}`}>{m.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                          {isLate && <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 font-medium">Retrasado</span>}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-navy-500)] mt-1">
                          {m.planned_date && <span>Previsto: {fmtDate(m.planned_date)}</span>}
                          {m.actual_date && <span>Completado: {fmtDate(m.actual_date)}</span>}
                          {m.notes && <span className="italic">{m.notes}</span>}
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

      {/* ═══════ TAB: Presupuestos ═══════ */}
      {activeTab === "presupuestos" && (
        <div>
          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {budgets.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay presupuestos disponibles.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-navy-700)]">
                {budgets.map((b) => {
                  const st = budgetStatusMap[b.status] || { label: b.status, color: "bg-gray-700 text-gray-300" };
                  const canAct = b.status === "sent" || b.status === "pending";
                  const isLoading = actionLoading === b.id;
                  return (
                    <div key={b.id} className="p-5">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs text-[var(--color-navy-500)] font-mono">{b.budget_number}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                          </div>
                          <h4 className="text-sm font-medium text-[var(--color-navy-100)]">{b.title}</h4>
                          <p className="text-xs text-[var(--color-navy-500)] mt-1">Fecha: {fmtDate(b.created_at)}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-lg font-bold text-[var(--color-navy-50)]">{eur(b.total)}</p>
                            <p className="text-xs text-[var(--color-navy-500)]">Base: {eur(b.subtotal)} + IVA: {eur(b.iva_amount)}</p>
                          </div>
                          {canAct && (
                            <div className="flex gap-2">
                              <button
                                disabled={isLoading}
                                onClick={() => handleBudgetAction(b.id, "accepted")}
                                className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                                {isLoading ? "..." : "Aceptar"}
                              </button>
                              <button
                                disabled={isLoading}
                                onClick={() => handleBudgetAction(b.id, "rejected")}
                                className="px-4 py-2 bg-red-600/20 text-red-300 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-600/30 transition disabled:opacity-50">
                                {isLoading ? "..." : "Rechazar"}
                              </button>
                            </div>
                          )}
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

      {/* ═══════ TAB: Cambios / Extras ═══════ */}
      {activeTab === "cambios" && (
        <div>
          {changes.length === 0 ? (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-8 text-center">
              <p className="text-[var(--color-navy-500)]">No hay cambios o extras registrados.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {changes.map((c) => {
                const st = changeStatusMap[c.status] || { label: c.status, color: "bg-gray-700 text-gray-300" };
                const canAct = c.status === "proposed";
                const isLoading = actionLoading === c.id;
                const impactColor = c.economic_impact > 0 ? "text-red-400" : c.economic_impact < 0 ? "text-green-400" : "text-[var(--color-navy-400)]";
                return (
                  <div key={c.id} className="bg-[var(--color-navy-800)] rounded-xl p-5">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-sm font-medium text-[var(--color-navy-100)]">{c.title}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                        </div>
                        {c.description && <p className="text-sm text-[var(--color-navy-400)] mt-1">{c.description}</p>}
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-[var(--color-navy-500)]">
                          <span className={`font-medium ${impactColor}`}>
                            Impacto: {c.economic_impact > 0 ? "+" : ""}{eur(c.economic_impact)}
                          </span>
                          {c.time_impact_days !== 0 && (
                            <span>Plazo: {c.time_impact_days > 0 ? "+" : ""}{c.time_impact_days} días</span>
                          )}
                          <span>Fecha: {fmtDate(c.created_at)}</span>
                        </div>
                        {c.notes && <p className="text-xs text-[var(--color-navy-500)] mt-1 italic">{c.notes}</p>}
                      </div>
                      {canAct && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            disabled={isLoading}
                            onClick={() => handleChangeAction(c.id, true)}
                            className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                            {isLoading ? "..." : "Aprobar"}
                          </button>
                          <button
                            disabled={isLoading}
                            onClick={() => handleChangeAction(c.id, false)}
                            className="px-4 py-2 bg-red-600/20 text-red-300 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-600/30 transition disabled:opacity-50">
                            {isLoading ? "..." : "Rechazar"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: Facturas y Cobros ═══════ */}
      {activeTab === "facturas" && (
        <div>
          {/* Invoices */}
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Facturas</h3>
          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden mb-6">
            {invoices.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay facturas registradas.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-navy-700)]">
                    <Th>Nº Factura</Th><Th>Fecha</Th><Th>Categoría</Th><Th align="right">Importe</Th><Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const st = invoiceStatusMap[inv.payment_status] || { label: inv.payment_status, color: "bg-gray-700 text-gray-300" };
                    return (
                      <tr key={inv.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                        <td className="px-4 py-3 font-mono text-xs text-[var(--color-navy-300)]">{inv.invoice_number || "—"}</td>
                        <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(inv.invoice_date)}</td>
                        <td className="px-4 py-3 text-[var(--color-navy-400)] capitalize">{inv.category}</td>
                        <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(inv.total_amount)}</td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Payments */}
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Cobros realizados</h3>
          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
            {payments.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay cobros registrados.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-navy-700)]">
                    <Th>Fecha</Th><Th>Concepto</Th><Th>Método</Th><Th align="right">Importe</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-3 text-[var(--color-navy-100)]">{p.concept}</td>
                      <td className="px-4 py-3 text-[var(--color-navy-400)]">{paymentMethodLabels[p.payment_method] || p.payment_method}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-400">{eur(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Summary */}
          <div className="mt-4 bg-[var(--color-navy-800)] rounded-xl p-4 flex flex-wrap gap-6 justify-end text-sm">
            <span className="text-[var(--color-navy-400)]">Total cobrado: <strong className="text-emerald-400">{eur(kpis.totalCobrado)}</strong></span>
            <span className="text-[var(--color-navy-400)]">Pendiente: <strong className={kpis.pendienteCobro > 0 ? "text-yellow-400" : "text-green-400"}>{eur(kpis.pendienteCobro)}</strong></span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-12 text-center space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--color-navy-600)]">
          <a href="/legal/aviso-legal" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-navy-400)] transition-colors">Aviso Legal</a>
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-navy-400)] transition-colors">Privacidad</a>
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-navy-400)] transition-colors">Términos</a>
          <a href="/legal/cookies" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-navy-400)] transition-colors">Cookies</a>
        </div>
        <p className="text-xs text-[var(--color-navy-600)]">
          Powered by <span className="text-[var(--color-brand-green)] font-medium">Enlaze</span> · Portal de acceso exclusivo para clientes
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════ Shared UI ═══════════════════════════ */

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--color-navy-400)] mt-1">{label}</p>
      {sub && <p className="text-xs text-[var(--color-navy-500)] mt-0.5">{sub}</p>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[var(--color-navy-700)]/50">
      <span className="text-[var(--color-navy-400)]">{label}</span>
      <span className="text-[var(--color-navy-100)] font-medium">{value}</span>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" }) {
  return (
    <th className={`px-4 py-3 text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
