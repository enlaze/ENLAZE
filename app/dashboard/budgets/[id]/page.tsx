"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import AcceptanceTimeline from "@/components/AcceptanceTimeline";
import { saveDocumentVersion, getNextVersion } from "@/lib/document-versions";
import { printPDF } from "@/lib/pdf-generator";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notifications";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import Loading from "@/components/ui/loading";
import Breadcrumbs from "@/components/ui/breadcrumbs";
import Link from "next/link";
import { normalizeBudgetItemUnit } from "@/lib/budget-units";

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
  client_id?: string | null;
  budget_number: string;
  title: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  client_nif?: string;
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
  // Formato Presupix
  deposit_percent?: number;
  payment_method?: string;
  payment_iban?: string;
  warranty_text?: string;
  execution_deadline_text?: string;
  observations?: string;
  conditions_text?: string;
  discount_type?: string;
  discount_percent?: number;
  discount_amount?: number;
  payment_schedule?: Array<{ percent?: number; concept?: string; moment?: string }>;
  wizard_state?: Record<string, unknown> | null;
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

      const { data: selectedClient } = b.client_id
        ? await supabase
            .from("clients")
            .select("name, email, phone")
            .eq("id", b.client_id)
            .maybeSingle()
        : { data: null };
      const hydratedBudget = {
        ...b,
        client_name: b.client_name || selectedClient?.name || "",
        client_email: b.client_email || selectedClient?.email || "",
        client_phone: b.client_phone || selectedClient?.phone || "",
      } as Budget;
      setBudget(hydratedBudget);
      setItems(bi || []);
      if (selectedClient) {
        void supabase
          .from("budgets")
          .update({
            client_name: hydratedBudget.client_name,
            client_email: hydratedBudget.client_email,
            client_phone: hydratedBudget.client_phone,
          })
          .eq("id", b.id);
      }
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
      title: "Mover presupuesto a la papelera",
      description: "El presupuesto y todas sus partidas se conservarán y podrás recuperarlos desde Papelera.",
      variant: "danger",
      confirmLabel: "Mover a la papelera",
    });
    if (!ok) return;

    try {
      const { data, error } = await supabase.rpc("move_to_trash", {
        p_entity_type: "budget",
        p_entity_id: budget.id,
      });
      if (error) throw error;
      if (!data) throw new Error("No se encontró el presupuesto");
      toast.success("Presupuesto movido a la papelera");
      router.push("/dashboard/budgets");
    } catch (error) {
      toast.error("No se pudo mover el presupuesto a la papelera");
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
        client_id: budget.client_id || null,
        client_name: budget.client_name,
        client_email: budget.client_email,
        client_phone: budget.client_phone,
        client_address: budget.client_address,
        client_nif: budget.client_nif || "",
        service_type: budget.service_type,
        status: "pendiente",
        subtotal: budget.subtotal,
        iva_percent: budget.iva_percent,
        iva_amount: budget.iva_amount,
        total: budget.total,
        notes: budget.notes,
        valid_until: budget.valid_until,
        deposit_percent: budget.deposit_percent,
        payment_method: budget.payment_method,
        payment_iban: budget.payment_iban,
        warranty_text: budget.warranty_text,
        execution_deadline_text: budget.execution_deadline_text,
        observations: budget.observations,
        conditions_text: budget.conditions_text,
        discount_type: budget.discount_type,
        discount_percent: budget.discount_percent,
        discount_amount: budget.discount_amount,
        payment_schedule: budget.payment_schedule,
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
        unit: normalizeBudgetItemUnit(item.unit),
        category: item.category,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      });
    }

    router.push(`/dashboard/budgets/${newB.id}`);
  }

  const [exportingPDF, setExportingPDF] = useState<"client" | "internal" | null>(null);

  async function exportPDF(mode: "client" | "internal") {
    if (!budget) return;
    const pdfWindow = window.open("", "_blank");
    if (!pdfWindow) {
      toast.error("El navegador ha bloqueado la ventana del PDF. Permite las ventanas emergentes e inténtalo de nuevo.");
      return;
    }
    pdfWindow.document.write("<p style='font-family:sans-serif;padding:24px'>Preparando PDF...</p>");
    setExportingPDF(mode);
    try {
      const res = await fetch("/api/budgets/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetId: budget.id, mode }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error generando PDF");
      }

      const html = await res.text();
      printPDF(html, pdfWindow);
      toast.success(`${mode === "client" ? "PDF del cliente" : "PDF interno"} preparado. Selecciona ‘Guardar como PDF’ en el diálogo de impresión.`);
    } catch (err: any) {
      pdfWindow.close();
      console.error("Error downloading PDF:", err);
      toast.error(err.message || "Error al preparar el PDF");
    } finally {
      setExportingPDF(null);
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
      {/* Breadcrumbs */}
      <Breadcrumbs
        className="mb-6"
        showHomeIcon
        items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Presupuestos", href: "/dashboard/budgets" },
          { label: budget.budget_number },
        ]}
      />

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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {budget.wizard_state && Object.keys(budget.wizard_state).length > 0 && (
            <Link
              href={`/dashboard/budgets/generate?budgetId=${budget.id}`}
              className="inline-flex items-center justify-center rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-navy-900 transition hover:bg-brand-green/90"
            >
              Abrir en Presupuesto inteligente
            </Link>
          )}
          <Link
            href={`/dashboard/budgets/${budget.id}/edit`}
            className="inline-flex items-center justify-center rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Editar
          </Link>
          <Button onClick={() => exportPDF("client")} disabled={exportingPDF !== null}>
            {exportingPDF === "client" ? "Preparando..." : "PDF cliente"}
          </Button>
          <Button variant="secondary" onClick={() => exportPDF("internal")} disabled={exportingPDF !== null}>
            {exportingPDF === "internal" ? "Preparando..." : "PDF interno"}
          </Button>
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
            {budget.client_nif && (
              <p className="text-navy-600 dark:text-zinc-400">
                <span className="text-navy-400 dark:text-zinc-500">NIF/CIF:</span> {budget.client_nif}
              </p>
            )}
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
          {!!budget.discount_amount && budget.discount_amount > 0 && (
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-red-600 dark:text-red-400">
                Descuento{budget.discount_type !== "amount" ? ` (${budget.discount_percent}%)` : ""}
              </span>
              <span className="text-red-600 dark:text-red-400 tabular-nums">
                -{budget.discount_amount.toFixed(2)} €
              </span>
            </div>
          )}
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

      {(budget.conditions_text || budget.notes) && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {budget.conditions_text && (
            <Card>
              <h3 className="mb-2 text-base font-semibold text-navy-900 dark:text-white">
                Condiciones del presupuesto
              </h3>
              <p className="whitespace-pre-wrap text-sm text-navy-600 dark:text-zinc-300">
                {budget.conditions_text}
              </p>
              <p className="mt-3 text-xs text-navy-400 dark:text-zinc-500">
                Incluidas en el PDF del cliente y en la copia interna.
              </p>
            </Card>
          )}
          {budget.notes && (
            <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10">
              <h3 className="mb-2 text-base font-semibold text-navy-900 dark:text-white">
                Notas internas
              </h3>
              <p className="whitespace-pre-wrap text-sm text-navy-600 dark:text-zinc-300">
                {budget.notes}
              </p>
              <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400">
                Información privada: solo aparece en el PDF interno.
              </p>
            </Card>
          )}
        </div>
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
