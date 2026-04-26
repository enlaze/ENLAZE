"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import AcceptanceTimeline from "@/components/AcceptanceTimeline";
import { saveDocumentVersion, getNextVersion } from "@/lib/document-versions";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notifications";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import Loading from "@/components/ui/loading";
import BackButton from "@/components/ui/back-button";

interface BudgetItem {
  id: string;
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  unit_price: number;
  subtotal: number;
}

interface Budget {
  id: string;
  budget_number: string;
  title: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  service_type: string;
  status: string;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes: string;
  valid_until: string;
  created_at: string;
  // Compliance Phase 2
  version: number;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  accepted_by_name: string | null;
  accepted_ip: string | null;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "text-yellow-700", bg: "bg-yellow-100" },
  enviado: { label: "Enviado", color: "text-blue-700", bg: "bg-blue-100" },
  aceptado: { label: "Aceptado", color: "text-green-700", bg: "bg-green-100" },
  rechazado: { label: "Rechazado", color: "text-red-700", bg: "bg-red-100" },
};

const statusBadgeVariant: Record<string, "yellow" | "blue" | "green" | "red"> = {
  pendiente: "yellow",
  enviado: "blue",
  aceptado: "green",
  rechazado: "red",
};

const categoryBadgeVariant = (cat: string): "blue" | "orange" | "gray" => {
  if (cat === "material") return "blue";
  if (cat === "mano_obra") return "orange";
  return "gray";
};

const fallbackServiceLabels: Record<string, string> = {
  reforma: "Reforma integral",
  fontaneria: "Fontanería",
  electricidad: "Electricidad",
  climatizacion: "Climatización",
  multiservicios: "Multiservicios",
  general: "General",
};

const fallbackCategoryLabels: Record<string, string> = {
  material: "Material",
  mano_obra: "Mano de obra",
  otros: "Otros",
};

const unitLabels: Record<string, string> = {
  ud: "ud",
  m2: "m²",
  ml: "ml",
  h: "h",
  kg: "kg",
  global: "global",
};

export default function BudgetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const { serviceTypes, budgetCategories } = useSector();
  const confirm = useConfirm();
  const toast = useToast();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadBudget();
  }, []);

  async function loadBudget() {
    try {
      const { data: b, error: bErr } = await supabase
        .from("budgets")
        .select("*")
        .eq("id", params.id)
        .single();

      if (bErr || !b) {
        router.push("/dashboard/budgets");
        return;
      }

      const { data: bi } = await supabase
        .from("budget_items")
        .select("*")
        .eq("budget_id", params.id)
        .order("created_at", { ascending: true });

      setBudget(b);
      setItems(bi || []);
    } catch {
      router.push("/dashboard/budgets");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(newStatus: string) {
    if (!budget) return;
    setUpdating(true);

    // Build timestamp fields based on new status
    const now = new Date().toISOString();
    const timestampUpdates: Record<string, string | null> = {};
    if (newStatus === "enviado" && !budget.sent_at) timestampUpdates.sent_at = now;
    if (newStatus === "aceptado" && !budget.accepted_at) timestampUpdates.accepted_at = now;
    if (newStatus === "rechazado" && !budget.rejected_at) timestampUpdates.rejected_at = now;

    const { error } = await supabase
      .from("budgets")
      .update({ status: newStatus, ...timestampUpdates })
      .eq("id", budget.id);

    if (!error) {
      const updated = { ...budget, status: newStatus, ...timestampUpdates };
      setBudget(updated);

      // Fire-and-forget: log activity + save version snapshot + notify
      logActivity(supabase, {
        action: `budget.status_changed`,
        entity_type: "budget",
        entity_id: budget.id,
        metadata: { from: budget.status, to: newStatus },
      });

      const notifMap: Record<string, { type: "budget_sent" | "budget_accepted" | "budget_rejected"; title: string; severity: "info" | "success" | "error" }> = {
        enviado: { type: "budget_sent", title: `Presupuesto ${budget.budget_number} enviado a ${budget.client_name}`, severity: "info" },
        aceptado: { type: "budget_accepted", title: `Presupuesto ${budget.budget_number} aceptado`, severity: "success" },
        rechazado: { type: "budget_rejected", title: `Presupuesto ${budget.budget_number} rechazado`, severity: "error" },
      };
      if (notifMap[newStatus]) {
        notify(supabase, {
          ...notifMap[newStatus],
          entity_type: "budget",
          entity_id: budget.id,
          action_url: `/dashboard/budgets/${budget.id}`,
        });
      }

      const nextVer = await getNextVersion(supabase, "budget", budget.id);
      saveDocumentVersion(supabase, {
        entity_type: "budget",
        entity_id: budget.id,
        version: nextVer,
        snapshot: updated as unknown as Record<string, unknown>,
        change_summary: `Estado cambiado de "${budget.status}" a "${newStatus}"`,
      });
    }
    setUpdating(false);
  }

  async function deleteBudget() {
    if (!budget) return;
    const ok = await confirm({
      title: "Eliminar presupuesto",
      description: "¿Estás seguro de eliminar este presupuesto? Esta acción no se puede deshacer.",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;

    try {
      await supabase.from("budget_items").delete().eq("budget_id", budget.id);
      await supabase.from("budgets").delete().eq("id", budget.id);
      toast.success("Presupuesto eliminado");
      router.push("/dashboard/budgets");
    } catch (error) {
      toast.error("Error al eliminar el presupuesto");
    }
  }

  async function duplicateBudget() {
    if (!budget) return;
    const year = new Date().getFullYear();
    const rand = Math.floor(10000 + Math.random() * 90000);
    const newNumber = `PRE-${year}-${rand}`;

    const { data: newB, error } = await supabase
      .from("budgets")
      .insert({
        budget_number: newNumber,
        title: budget.title + " (copia)",
        client_name: budget.client_name,
        client_email: budget.client_email,
        client_phone: budget.client_phone,
        client_address: budget.client_address,
        service_type: budget.service_type,
        status: "pendiente",
        subtotal: budget.subtotal,
        iva_percent: budget.iva_percent,
        iva_amount: budget.iva_amount,
        total: budget.total,
        notes: budget.notes,
        valid_until: budget.valid_until,
      })
      .select()
      .single();

    if (error || !newB) {
      toast.error("Error al duplicar");
      return;
    }

    for (const item of items) {
      await supabase.from("budget_items").insert({
        budget_id: newB.id,
        concept: item.concept,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      });
    }

    router.push(`/dashboard/budgets/${newB.id}`);
  }

  function generatePDF() {
    if (!budget) return;

    const itemsHTML = items
      .map(
        (item, i) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 6px;font-size:13px;">${i + 1}</td>
        <td style="padding:8px 6px;font-size:13px;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#6b7280;font-size:12px;">${item.description}</span>` : ""}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${categoryLabels[item.category] || fallbackCategoryLabels[item.category] || item.category}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${item.quantity} ${unitLabels[item.unit] || item.unit}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;">${item.unit_price.toFixed(2)} €</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;font-weight:600;">${item.subtotal.toFixed(2)} €</td>
      </tr>`
      )
      .join("");

    const sTypes = serviceTypes();
    const serviceLabels: Record<string, string> = Object.fromEntries(sTypes.map(s => [s.value, s.label]));
    const cats = budgetCategories();
    const categoryLabels: Record<string, string> = Object.fromEntries(cats.map(c => [c.value, c.label]));

    const materialItems = items.filter((i) => i.category === "material");
    const laborItems = items.filter((i) => i.category === "mano_obra");
    const otherItems = items.filter((i) => i.category === "otros");

    const materialTotal = materialItems.reduce((s, i) => s + i.subtotal, 0);
    const laborTotal = laborItems.reduce((s, i) => s + i.subtotal, 0);
    const otherTotal = otherItems.reduce((s, i) => s + i.subtotal, 0);

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>${budget.budget_number}</title>
      <style>
        @page { size: A4; margin: 20mm; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 3px solid #00c896; padding-bottom: 20px; }
        .logo { font-size: 28px; font-weight: 800; color: #0a1628; }
        .logo span { color: #00c896; }
        .budget-info { text-align: right; font-size: 13px; color: #64748b; }
        .budget-number { font-size: 18px; font-weight: 700; color: #0a1628; }
        .section { margin-bottom: 24px; }
        .section-title { font-size: 14px; font-weight: 700; color: #00c896; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .client-info { background: #f8fafc; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #0a1628; color: white; padding: 10px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .totals { margin-top: 20px; display: flex; justify-content: flex-end; }
        .totals-box { background: #f8fafc; border-radius: 8px; padding: 16px 24px; min-width: 280px; }
        .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
        .total-final { font-size: 20px; font-weight: 800; color: #00c896; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 8px; }
        .breakdown { display: flex; gap: 16px; margin-bottom: 20px; }
        .breakdown-card { flex: 1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center; }
        .breakdown-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
        .breakdown-value { font-size: 16px; font-weight: 700; color: #0a1628; }
        .notes { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #92400e; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="logo">enl<span>a</span>ze</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Presupuesto profesional</div>
        </div>
        <div class="budget-info">
          <div class="budget-number">${budget.budget_number}</div>
          <div>Fecha: ${new Date(budget.created_at).toLocaleDateString("es-ES")}</div>
          <div>Válido hasta: ${budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}</div>
          <div style="margin-top:6px;">
            <span class="badge" style="background:${statusConfig[budget.status]?.bg || "#f1f5f9"};color:${statusConfig[budget.status]?.color?.replace("text-", "#") || "#64748b"};">
              ${statusConfig[budget.status]?.label || budget.status}
            </span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Datos del cliente</div>
        <div class="client-info">
          <strong>${budget.client_name || "Sin nombre"}</strong><br/>
          ${budget.client_email ? `Email: ${budget.client_email}<br/>` : ""}
          ${budget.client_phone ? `Teléfono: ${budget.client_phone}<br/>` : ""}
          ${budget.client_address ? `Dirección: ${budget.client_address}` : ""}
        </div>
      </div>

      <div class="section">
        <div class="section-title">${budget.title} — ${serviceLabels[budget.service_type] || fallbackServiceLabels[budget.service_type] || budget.service_type}</div>
        <table>
          <thead>
            <tr>
              <th style="width:30px;text-align:left;">#</th>
              <th style="text-align:left;">Concepto</th>
              <th style="width:90px;text-align:center;">Categoría</th>
              <th style="width:80px;text-align:center;">Cantidad</th>
              <th style="width:80px;text-align:right;">Precio ud.</th>
              <th style="width:90px;text-align:right;">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
      </div>

      <div class="breakdown">
        <div class="breakdown-card">
          <div class="breakdown-label">Material</div>
          <div class="breakdown-value">${materialTotal.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card">
          <div class="breakdown-label">Mano de obra</div>
          <div class="breakdown-value">${laborTotal.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card">
          <div class="breakdown-label">Otros</div>
          <div class="breakdown-value">${otherTotal.toFixed(2)} €</div>
        </div>
      </div>

      <div class="totals">
        <div class="totals-box">
          <div class="total-row"><span>Subtotal</span><span>${budget.subtotal.toFixed(2)} €</span></div>
          <div class="total-row"><span>IVA (${budget.iva_percent}%)</span><span>${budget.iva_amount.toFixed(2)} €</span></div>
          <div class="total-row total-final"><span>TOTAL</span><span>${budget.total.toFixed(2)} €</span></div>
        </div>
      </div>

      ${budget.notes ? `<div class="section" style="margin-top:24px;"><div class="section-title">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

      <div class="footer">
        Presupuesto generado con <strong>Enlaze</strong> · enlaze.es<br/>
        Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
      </div>
    </body>
    </html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  }

  if (loading) return <Loading />;
  if (!budget) return null;

  const sTypes = serviceTypes();
  const serviceLabel = (() => {
    const map = Object.fromEntries(sTypes.map((s) => [s.value, s.label]));
    return map[budget.service_type] || fallbackServiceLabels[budget.service_type] || budget.service_type;
  })();

  const cats = budgetCategories();
  const categoryLabelMap = Object.fromEntries(cats.map((c) => [c.value, c.label]));
  const categoryLabel = (cat: string) =>
    categoryLabelMap[cat] || fallbackCategoryLabels[cat] || cat;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back link */}
      <BackButton fallbackHref="/dashboard/budgets" label="Volver a presupuestos" />

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-navy-900 dark:text-white">
              {budget.budget_number}
            </h1>
            <Badge variant={statusBadgeVariant[budget.status] || "gray"}>
              {statusConfig[budget.status]?.label || budget.status}
            </Badge>
            {budget.version > 1 && (
              <span className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-600 dark:bg-zinc-800 dark:text-zinc-300">
                v{budget.version}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-navy-500 dark:text-zinc-400">
            {budget.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={generatePDF}>Generar PDF</Button>
        </div>
      </div>

      {/* Status Actions */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase tracking-wider text-navy-500 dark:text-zinc-400">
            Cambiar estado
          </span>
          {Object.entries(statusConfig).map(([key, val]) => {
            const isCurrent = budget.status === key;
            return (
              <button
                key={key}
                onClick={() => updateStatus(key)}
                disabled={updating || isCurrent}
                className={
                  isCurrent
                    ? "cursor-default rounded-lg border border-brand-green/30 bg-brand-green/10 px-3 py-1.5 text-xs font-semibold text-brand-green"
                    : "rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition-colors hover:border-navy-300 hover:bg-navy-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }
              >
                {val.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Acceptance Timeline */}
      <Card className="mb-6">
        <h3 className="mb-3 text-base font-semibold text-navy-900 dark:text-white">
          Timeline de aceptación
        </h3>
        <AcceptanceTimeline
          mode="inline"
          events={[
            { label: "Creado", date: budget.created_at, status: "positive" },
            { label: "Enviado", date: budget.sent_at, status: "positive" },
            { label: "Visualizado", date: budget.viewed_at, status: "neutral" },
            budget.rejected_at
              ? { label: "Rechazado", date: budget.rejected_at, status: "negative", detail: budget.accepted_by_name ? `por ${budget.accepted_by_name}` : undefined }
              : { label: "Aceptado", date: budget.accepted_at, status: "positive", detail: budget.accepted_by_name ? `por ${budget.accepted_by_name}` : undefined },
          ]}
        />
      </Card>

      {/* Info Grid */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900 dark:text-white">
            Datos del cliente
          </h3>
          <div className="space-y-1.5 text-sm">
            <p className="text-base font-medium text-navy-900 dark:text-white">
              {budget.client_name || "Sin nombre"}
            </p>
            {budget.client_email && (
              <p className="text-navy-600 dark:text-zinc-400">
                <span className="text-navy-400 dark:text-zinc-500">Email:</span> {budget.client_email}
              </p>
            )}
            {budget.client_phone && (
              <p className="text-navy-600 dark:text-zinc-400">
                <span className="text-navy-400 dark:text-zinc-500">Teléfono:</span> {budget.client_phone}
              </p>
            )}
            {budget.client_address && (
              <p className="text-navy-600 dark:text-zinc-400">
                <span className="text-navy-400 dark:text-zinc-500">Dirección:</span> {budget.client_address}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900 dark:text-white">
            Información del presupuesto
          </h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-navy-500 dark:text-zinc-500">Tipo de servicio</dt>
              <dd className="font-medium text-navy-900 dark:text-white">{serviceLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-navy-500 dark:text-zinc-500">Fecha creación</dt>
              <dd className="text-navy-700 dark:text-zinc-200">
                {new Date(budget.created_at).toLocaleDateString("es-ES")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-navy-500 dark:text-zinc-500">Válido hasta</dt>
              <dd className="text-navy-700 dark:text-zinc-200">
                {budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* Partidas Table */}
      <Card className="mb-6" padding={false}>
        <div className="border-b border-navy-100 px-6 py-4 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-navy-900 dark:text-white">
            Partidas <span className="text-navy-400 dark:text-zinc-500">({items.length})</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-100 bg-navy-50/40 dark:border-zinc-800 dark:bg-zinc-800/30">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">#</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Concepto</th>
                <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Categoría</th>
                <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Cantidad</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Precio ud.</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item.id}
                  className="border-t border-navy-100 transition hover:bg-navy-50/40 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-5 py-3 text-sm text-navy-400 dark:text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-navy-900 dark:text-white">{item.concept}</p>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-navy-500 dark:text-zinc-500">{item.description}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <Badge variant={categoryBadgeVariant(item.category)}>
                      {categoryLabel(item.category)}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-center text-sm text-navy-700 dark:text-zinc-200 tabular-nums">
                    {item.quantity} {unitLabels[item.unit] || item.unit}
                  </td>
                  <td className="px-5 py-3 text-right text-sm text-navy-700 dark:text-zinc-200 tabular-nums">
                    {item.unit_price.toFixed(2)} €
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-semibold text-navy-900 dark:text-white tabular-nums">
                    {item.subtotal.toFixed(2)} €
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Totals */}
      <div className="mb-6 flex justify-end">
        <Card className="w-full max-w-xs">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-navy-500 dark:text-zinc-400">Subtotal</span>
            <span className="text-navy-900 dark:text-white tabular-nums">
              {budget.subtotal.toFixed(2)} €
            </span>
          </div>
          <div className="mb-3 flex justify-between text-sm">
            <span className="text-navy-500 dark:text-zinc-400">IVA ({budget.iva_percent}%)</span>
            <span className="text-navy-900 dark:text-white tabular-nums">
              {budget.iva_amount.toFixed(2)} €
            </span>
          </div>
          <div className="flex justify-between border-t border-navy-100 pt-3 text-lg font-bold dark:border-zinc-800">
            <span className="text-navy-900 dark:text-white">TOTAL</span>
            <span className="text-brand-green tabular-nums">
              {budget.total.toFixed(2)} €
            </span>
          </div>
        </Card>
      </div>

      {/* Notes */}
      {budget.notes && (
        <Card className="mb-6">
          <h3 className="mb-2 text-base font-semibold text-navy-900 dark:text-white">
            Notas
          </h3>
          <p className="whitespace-pre-wrap text-sm text-navy-600 dark:text-zinc-300">
            {budget.notes}
          </p>
        </Card>
      )}

      {/* Actions */}
      <div className="mb-10 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={duplicateBudget}>
          Duplicar presupuesto
        </Button>
        <Button variant="danger" onClick={deleteBudget}>
          Eliminar presupuesto
        </Button>
      </div>
    </div>
  );
}
