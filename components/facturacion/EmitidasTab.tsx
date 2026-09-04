"use client";

/**
 * Pestaña "Emitidas" del hub de Facturación.
 *
 * Es el contenido de app/dashboard/issued-invoices tal cual estaba (alta de
 * factura con numeración y cadena Verifactu, tabla, filtros, papelera), con
 * dos únicos cambios de encuadre:
 *   - Los KPIs suben al resumen del hub (BillingSummary), así que aquí no se
 *     repiten.
 *   - Las facturas vencidas ganan la acción de recordatorio de cobro.
 *
 * El pulido del rediseño es solo de acabado: rejilla de acciones a 40px,
 * aviso de vencidas sobre los tokens `danger`, etiquetas de estado con
 * contraste y celdas de la tabla afinadas. Ni la creación con cadena
 * Verifactu ni los filtros cambian.
 */

import { useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";
import ReminderDialog from "./ReminderDialog";
import {
  daysSince,
  eur,
  fmtDate,
  inputCls,
  isOverdueInvoice,
  statusMap,
  type IssuedInvoice,
} from "./shared";
import {
  FactCard,
  StatusPill,
  TabToolbar,
  factBtnPrimary,
  factBtnSecondary,
} from "./ui";
import type { IssuedInvoicesState } from "./useIssuedInvoices";

export default function EmitidasTab({ state }: { state: IssuedInvoicesState }) {
  const { supabase, userId, invoices, setInvoices, clients, projects, reload } = state;
  const confirm = useConfirm();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reminderFor, setReminderFor] = useState<IssuedInvoice | null>(null);
  const [form, setForm] = useState({
    client_id: "", project_id: "", issue_date: new Date().toISOString().split("T")[0],
    due_date: "", notes: "",
  });

  async function handleCreate() {
    if (!userId) return;
    if (!form.client_id) { toast.error("Selecciona un cliente."); return; }
    setSaving(true);

    // Load fiscal settings for auto-numbering
    const { data: fiscal } = await supabase.from("fiscal_settings").select("*").eq("user_id", userId).single();
    if (!fiscal) { toast.error("Configura tus ajustes fiscales antes de emitir facturas (Ajustes → Fiscal)."); setSaving(false); return; }

    const client = clients.find((c) => c.id === form.client_id);
    const series = fiscal.invoice_series || "F";
    const number = fiscal.invoice_next_number || 1;
    const year = new Date().getFullYear();
    const invoice_number = `${series}-${year}/${String(number).padStart(4, "0")}`;

    // Get previous hash for Verifactu chain
    const { data: lastInv } = await supabase.from("issued_invoices")
      .select("verifactu_hash").eq("user_id", userId).order("number", { ascending: false }).limit(1).single();
    const prevHash = lastInv?.verifactu_hash || "0";

    // Generate Verifactu hash: SHA-256 of (invoice_number + issuer_nif + total + issue_date + prev_hash)
    const hashInput = `${invoice_number}|${fiscal.nif}|0.00|${form.issue_date}|${prevHash}`;
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const qrData = `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${fiscal.nif}&numserie=${invoice_number}&fecha=${form.issue_date}&importe=0.00`;

    const { error } = await supabase.from("issued_invoices").insert({
      user_id: userId,
      client_id: form.client_id,
      project_id: form.project_id || null,
      series, number, invoice_number,
      issuer_name: fiscal.business_name,
      issuer_nif: fiscal.nif,
      issuer_address: `${fiscal.address}, ${fiscal.postal_code} ${fiscal.city}`,
      client_name: client?.name || "",
      client_nif: "",
      client_address: "",
      client_email: client?.email || "",
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      iva_percent: fiscal.default_iva_percent,
      irpf_percent: fiscal.default_irpf_percent,
      status: "draft",
      verifactu_hash: hash,
      verifactu_prev_hash: prevHash,
      verifactu_qr_data: qrData,
      verifactu_registered: fiscal.verifactu_enabled,
      notes: form.notes,
    });

    if (error) { toast.error("Error", { description: error.message }); setSaving(false); return; }

    // Increment next number
    await supabase.from("fiscal_settings").update({
      invoice_next_number: number + 1, updated_at: new Date().toISOString(),
    }).eq("id", fiscal.id);

    setForm({ client_id: "", project_id: "", issue_date: new Date().toISOString().split("T")[0], due_date: "", notes: "" });
    setShowForm(false);
    await reload();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Mover factura emitida a la papelera",
      description: "La factura se conservará y podrás recuperarla desde Papelera.",
      variant: "danger",
      confirmLabel: "Mover a la papelera",
    });
    if (!ok) return;
    try {
      const { data, error } = await supabase.rpc("move_to_trash", {
        p_entity_type: "issued_invoice",
        p_entity_id: id,
      });
      if (error) throw error;
      if (!data) throw new Error("No se encontró la factura");
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      toast.success("Factura emitida movida a la papelera");
    } catch {
      toast.error("No se pudo mover la factura a la papelera");
    }
  }

  const columns: Column<IssuedInvoice>[] = [
    {
      key: "invoice_number",
      header: "Factura",
      sortable: true,
      alwaysVisible: true,
      exportValue: (inv) => inv.invoice_number,
      render: (inv) => (
        <Link
          href={`/dashboard/issued-invoices/${inv.id}`}
          className="font-mono text-[12.5px] font-medium text-navy-900 transition hover:text-brand-green dark:text-white"
          onClick={(e) => e.stopPropagation()}
        >
          {inv.invoice_number}
        </Link>
      ),
    },
    {
      key: "client_name",
      header: "Cliente",
      sortable: true,
      exportValue: (inv) => inv.clients?.name || inv.client_name || "—",
      render: (inv) => (
        <span className="font-semibold text-navy-900 dark:text-white">
          {inv.clients?.name || inv.client_name || "—"}
        </span>
      ),
    },
    {
      key: "issue_date",
      header: "Fecha",
      sortable: true,
      hidden: "hidden md:table-cell",
      exportValue: (inv) => (inv.issue_date ? new Date(inv.issue_date) : null),
      render: (inv) => (
        <span className="text-navy-600 dark:text-zinc-400">{fmtDate(inv.issue_date)}</span>
      ),
    },
    {
      key: "due_date",
      header: "Vto.",
      sortable: true,
      hidden: "hidden lg:table-cell",
      exportValue: (inv) => (inv.due_date ? new Date(inv.due_date) : null),
      render: (inv) => {
        const overdue = isOverdueInvoice(inv);
        const days = overdue && inv.due_date ? daysSince(inv.due_date) : 0;
        return (
          <span
            className={`tabular-nums ${overdue ? "font-semibold text-danger-ink" : "text-navy-600 dark:text-zinc-400"}`}
          >
            {fmtDate(inv.due_date)}
            {overdue && <span className="ml-1 text-[11px] font-semibold">({days}d)</span>}
          </span>
        );
      },
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      exportValue: (inv) => Number(inv.total || 0),
      render: (inv) => (
        <span className="font-medium text-navy-900 dark:text-white tabular-nums">
          {eur(inv.total)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      exportValue: (inv) => statusMap[inv.status]?.label || inv.status,
      render: (inv) => {
        const st = statusMap[inv.status] || { label: inv.status, tone: "neutral" as const };
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={st.tone}>{st.label}</StatusPill>
            {isOverdueInvoice(inv) && inv.status !== "overdue" && (
              <StatusPill tone="danger">Vencida</StatusPill>
            )}
          </div>
        );
      },
    },
    {
      key: "verifactu",
      header: "VF",
      align: "center",
      defaultHidden: true,
      hidden: "hidden xl:table-cell",
      exportValue: (inv) => (inv.verifactu_registered ? "Sí" : "No"),
      render: (inv) =>
        inv.verifactu_registered ? (
          <span className="text-xs font-semibold text-success-ink" title="Hash Verifactu registrado">
            Sí
          </span>
        ) : (
          <span className="text-xs text-navy-400 dark:text-zinc-500">No</span>
        ),
    },
    {
      key: "actions",
      header: "Acc.",
      align: "right",
      alwaysVisible: true,
      render: (inv) => (
        <div className="flex justify-end gap-3.5" onClick={(e) => e.stopPropagation()}>
          {isOverdueInvoice(inv) && (
            <button
              onClick={() => setReminderFor(inv)}
              className="cursor-pointer text-[13px] font-semibold text-danger-ink hover:underline"
              title="Reclamar el cobro de esta factura"
            >
              Recordar
            </button>
          )}
          <Link
            href={`/dashboard/issued-invoices/${inv.id}`}
            className="text-[13px] font-semibold text-success-ink hover:underline"
          >
            Detalle
          </Link>
          {inv.status === "draft" && (
            <button
              onClick={() => handleDelete(inv.id)}
              className="cursor-pointer text-[13px] font-semibold text-danger-ink hover:underline"
            >
              Eliminar
            </button>
          )}
        </div>
      ),
    },
  ];

  const filters: FilterDef<IssuedInvoice>[] = [
    {
      key: "status",
      label: "Estado",
      options: [
        ...Object.entries(statusMap).map(([k, v]) => ({ label: v.label, value: k })),
        { label: "Solo vencidas", value: "__overdue__" },
      ],
      matches: (inv, v) => (v === "__overdue__" ? isOverdueInvoice(inv) : inv.status === v),
    },
  ];

  const overdue = invoices.filter(isOverdueInvoice);

  return (
    <div className="space-y-6">
      <TabToolbar
        actions={
          <>
            <Link href="/dashboard/settings/fiscal" className={factBtnSecondary}>
              Ajustes fiscales
            </Link>
            <button onClick={() => setShowForm(!showForm)} className={factBtnPrimary}>
              + Nueva factura
            </button>
          </>
        }
      >
        Facturación a clientes con Verifactu y Facturae
      </TabToolbar>

      {/* Aviso de vencidas + entrada al recordatorio de cobro */}
      {overdue.length > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-danger/30 bg-danger/8 px-[22px] py-[18px] sm:flex-row sm:items-center sm:gap-5">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[14.5px] font-semibold text-danger-ink">
              Tienes {overdue.length} factura{overdue.length > 1 ? "s" : ""} vencida
              {overdue.length > 1 ? "s" : ""} sin cobrar
              {" · "}
              {eur(overdue.reduce((s, i) => s + Number(i.total || 0), 0))}
            </span>
            <span className="text-[13.5px] text-danger-ink/85">
              Reclama el cobro desde la tabla. Pronto podrás dejar los recordatorios en automático.
            </span>
          </div>
          <button
            onClick={() => setReminderFor(overdue[0])}
            /* En claro el botón es macizo (danger-ink + blanco, como el
               diseño). En oscuro `--color-danger-ink` es un rojo claro: un
               botón macizo de ese color gritaría, así que pasa a relleno
               tintado con aro, que es como el dashboard resuelve el resto de
               acciones destructivas sobre panel oscuro. */
            className="inline-flex h-[38px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-danger-ink px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-danger dark:bg-danger/20 dark:text-danger-ink dark:ring-1 dark:ring-inset dark:ring-danger/40 dark:hover:bg-danger/30"
          >
            Reclamar la más antigua
          </button>
        </div>
      )}

      {/* Alta de factura */}
      {showForm && (
        <FactCard className="px-6 py-[22px]">
          <h3 className="mb-4 text-base font-bold tracking-[-0.01em] text-navy-900 dark:text-white">
            Nueva factura emitida
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-400">Cliente *</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls}>
                <option value="">Seleccionar...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-400">Obra</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-400">Fecha emisión</label>
              <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-400">Fecha vencimiento</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-400">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Concepto / observaciones" />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              onClick={() => setShowForm(false)}
              className="cursor-pointer px-4 text-sm font-medium text-navy-600 transition-colors hover:text-navy-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={saving} className={factBtnPrimary}>
              {saving ? "Creando..." : "Crear factura"}
            </button>
          </div>
        </FactCard>
      )}

      {invoices.length === 0 ? (
        <EmptyState
          title="Aún no has emitido facturas"
          description="Crea tu primera factura emitida para empezar a facturar a tus clientes con Verifactu y Facturae."
          action={
            <button onClick={() => setShowForm(true)} className={factBtnPrimary}>
              + Nueva factura
            </button>
          }
        />
      ) : (
        <DataTable<IssuedInvoice>
          columns={columns}
          data={invoices}
          rowKey={(inv) => inv.id}
          searchable
          searchPlaceholder="Buscar por nº, cliente o NIF..."
          searchFields={(inv) => [inv.invoice_number, inv.client_name, inv.client_nif]}
          filters={filters}
          initialSort={{ key: "issue_date", dir: "desc" }}
          pageSize={25}
          exportable
          exportFileName="facturas-emitidas"
          toggleableColumns
          emptyMessage="Sin facturas con esos filtros."
        />
      )}

      <ReminderDialog invoice={reminderFor} onClose={() => setReminderFor(null)} />
    </div>
  );
}
