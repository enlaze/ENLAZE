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
 */

import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge";
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
          className="text-navy-900 dark:text-white hover:text-brand-green font-mono font-medium transition"
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
        <span className="text-navy-700 dark:text-zinc-300">{inv.clients?.name || inv.client_name || "—"}</span>
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
          <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-navy-600 dark:text-zinc-400"}>
            {fmtDate(inv.due_date)}
            {overdue && <span className="ml-1 text-xs">({days}d)</span>}
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
        const st = statusMap[inv.status] || { label: inv.status, variant: "gray" as const };
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={st.variant}>{st.label}</Badge>
            {isOverdueInvoice(inv) && inv.status !== "overdue" && (
              <Badge variant="red">Vencida</Badge>
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
          <span className="text-xs text-green-600 font-medium" title="Hash Verifactu registrado">Sí</span>
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
        <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
          {isOverdueInvoice(inv) && (
            <button
              onClick={() => setReminderFor(inv)}
              className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
              title="Reclamar el cobro de esta factura"
            >
              Recordar
            </button>
          )}
          <Link href={`/dashboard/issued-invoices/${inv.id}`} className="text-xs text-brand-green hover:underline">
            Detalle
          </Link>
          {inv.status === "draft" && (
            <button onClick={() => handleDelete(inv.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">
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
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          Facturación a clientes con Verifactu y Facturae
        </p>
        <div className="flex gap-2">
          <Link href="/dashboard/settings/fiscal"
            className="rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm text-navy-700 transition hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Ajustes fiscales
          </Link>
          <button onClick={() => setShowForm(!showForm)}
            className="rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-green-dark">
            + Nueva factura
          </button>
        </div>
      </div>

      {/* Aviso de vencidas + entrada al recordatorio de cobro */}
      {overdue.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-red-900 dark:text-red-200">
                Tienes {overdue.length} factura{overdue.length > 1 ? "s" : ""} vencida{overdue.length > 1 ? "s" : ""} sin cobrar
                {" · "}{eur(overdue.reduce((s, i) => s + Number(i.total || 0), 0))}
              </p>
              <p className="mt-1 text-xs text-red-700 dark:text-red-300/90">
                Reclama el cobro desde la tabla. Pronto podrás dejar los recordatorios en automático.
              </p>
            </div>
            <button
              onClick={() => setReminderFor(overdue[0])}
              className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              Reclamar la más antigua
            </button>
          </div>
        </div>
      )}

      {/* Alta de factura */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <h3 className="mb-4 text-sm font-semibold text-navy-900 dark:text-white">Nueva factura emitida</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-navy-600 dark:text-zinc-400">Cliente *</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls}>
                <option value="">Seleccionar...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-navy-600 dark:text-zinc-400">Obra</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-navy-600 dark:text-zinc-400">Fecha emisión</label>
              <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-navy-600 dark:text-zinc-400">Fecha vencimiento</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-navy-600 dark:text-zinc-400">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Concepto / observaciones" />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-navy-600 hover:text-navy-900 dark:text-zinc-400">Cancelar</button>
            <button onClick={handleCreate} disabled={saving}
              className="rounded-lg bg-brand-green px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-green-dark disabled:opacity-50">
              {saving ? "Creando..." : "Crear factura"}
            </button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <EmptyState
          title="Aún no has emitido facturas"
          description="Crea tu primera factura emitida para empezar a facturar a tus clientes con Verifactu y Facturae."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-green-dark"
            >
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
