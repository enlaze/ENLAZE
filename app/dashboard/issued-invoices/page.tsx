/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import Badge from "@/components/ui/badge";
import { SkeletonKpi, SkeletonTable } from "@/components/ui/skeleton";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";

/* ═══════════════ Types ═══════════════ */

interface IssuedInvoice {
  id: string; client_id: string | null; project_id: string | null;
  series: string; number: number; invoice_number: string;
  client_name: string; client_nif: string;
  clients?: { id: string; name: string } | null;
  issue_date: string; due_date: string | null;
  subtotal: number; iva_percent: number; iva_amount: number;
  irpf_percent: number; irpf_amount: number; total: number;
  status: string; payment_status: string; payment_date: string | null;
  verifactu_hash: string; verifactu_registered: boolean;
  created_at: string;
}

interface Client { id: string; name: string; email: string | null; }
interface Project { id: string; name: string; }

/* ═══════════════ Labels ═══════════════ */

const statusMap: Record<string, { label: string; variant: "gray" | "blue" | "purple" | "green" | "red" | "yellow" | "orange" }> = {
  draft: { label: "Borrador", variant: "gray" },
  issued: { label: "Emitida", variant: "blue" },
  sent: { label: "Enviada", variant: "purple" },
  paid: { label: "Cobrada", variant: "green" },
  overdue: { label: "Vencida", variant: "red" },
  cancelled: { label: "Anulada", variant: "gray" },
  rectified: { label: "Rectificada", variant: "orange" },
};

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }
function daysSince(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }

const inputCls = "w-full bg-white dark:bg-zinc-900 text-navy-900 dark:text-white placeholder:text-navy-400 dark:placeholder:text-zinc-500 rounded-lg px-4 py-2 border border-navy-200 dark:border-zinc-800 focus:border-brand-green focus:outline-none text-sm";

/* ═══════════════ Page ═══════════════ */

export default function IssuedInvoicesPage() {
  const router = useRouter();
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<IssuedInvoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_id: "", project_id: "", issue_date: new Date().toISOString().split("T")[0],
    due_date: "", notes: "",
  });

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [invRes, clientsRes, projRes] = await Promise.all([
      supabase.from("issued_invoices").select("*, clients(id, name)").eq("user_id", user.id).order("number", { ascending: false }),
      supabase.from("clients").select("id, name, email").eq("user_id", user.id).order("name"),
      supabase.from("projects").select("id, name").eq("user_id", user.id).order("name"),
    ]);

    setInvoices((invRes.data as IssuedInvoice[]) || []);
    setClients((clientsRes.data as Client[]) || []);
    setProjects((projRes.data as Project[]) || []);
    setLoading(false);
  }

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
    const { data } = await supabase.from("issued_invoices").select("*, clients(id, name)").eq("user_id", userId).order("number", { ascending: false });
    setInvoices((data as IssuedInvoice[]) || []);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Eliminar factura emitida",
      description: "¿Eliminar esta factura emitida?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("issued_invoices").delete().eq("id", id);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      toast.success("Factura emitida eliminada");
    } catch (error) {
      toast.error("Error al eliminar la factura emitida");
    }
  }

  useEffect(() => { load(); }, []);

  function isOverdueInvoice(inv: IssuedInvoice): boolean {
    return !!(
      inv.due_date &&
      inv.payment_status !== "paid" &&
      inv.status !== "cancelled" &&
      new Date(inv.due_date) < new Date()
    );
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
          <span className={overdue ? "text-red-600 font-medium" : "text-navy-600 dark:text-zinc-400"}>
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
        return <Badge variant={st.variant}>{st.label}</Badge>;
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
          <Link href={`/dashboard/issued-invoices/${inv.id}`} className="text-xs text-brand-green hover:underline">
            Detalle
          </Link>
          {inv.status === "draft" && (
            <button onClick={() => handleDelete(inv.id)} className="text-xs text-red-600 hover:underline">
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

  // KPIs
  const totalEmitido = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalCobrado = invoices.filter((i) => i.payment_status === "paid").reduce((s, i) => s + Number(i.total || 0), 0);
  const pendienteCobro = invoices.filter((i) => i.payment_status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + Number(i.total || 0), 0);
  const vencidas = invoices.filter((i) => i.due_date && i.payment_status !== "paid" && i.status !== "cancelled" && new Date(i.due_date) < new Date()).length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-56 animate-pulse rounded bg-navy-100" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-navy-100/70" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Facturas Emitidas</h1>
          <p className="text-sm text-navy-600 dark:text-zinc-400">Facturación a clientes con Verifactu y Facturae</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/settings/fiscal"
            className="px-4 py-2.5 bg-white dark:bg-zinc-900 text-navy-700 dark:text-zinc-300 rounded-xl text-sm border border-navy-200 dark:border-zinc-800 hover:bg-navy-50 dark:hover:bg-zinc-800 transition">
            Ajustes fiscales
          </Link>
          <button onClick={() => setShowForm(!showForm)}
            className="px-5 py-2.5 bg-brand-green text-navy-900 dark:text-white rounded-xl font-semibold text-sm hover:opacity-90 transition">
            + Nueva factura
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-4 text-center border border-navy-100 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm dark:shadow-none">
          <p className="text-lg font-bold text-blue-600">{eur(totalEmitido)}</p>
          <p className="text-xs text-navy-600 dark:text-zinc-400">Total emitido</p>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center border border-navy-100 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm dark:shadow-none">
          <p className="text-lg font-bold text-green-600">{eur(totalCobrado)}</p>
          <p className="text-xs text-navy-600 dark:text-zinc-400">Total cobrado</p>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center border border-navy-100 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm dark:shadow-none">
          <p className="text-lg font-bold text-yellow-600">{eur(pendienteCobro)}</p>
          <p className="text-xs text-navy-600 dark:text-zinc-400">Pendiente cobro</p>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center border border-navy-100 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm dark:shadow-none">
          <p className={`text-lg font-bold ${vencidas > 0 ? "text-red-600" : "text-green-600"}`}>{vencidas}</p>
          <p className="text-xs text-navy-600 dark:text-zinc-400">Facturas vencidas</p>
        </div>
      </div>

      {/* Alerta de vencidas */}
      {vencidas > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 dark:bg-red-950/30 dark:border-red-900/50">
          <p className="text-sm font-medium text-red-900 dark:text-red-200">Tienes {vencidas} factura{vencidas > 1 ? "s" : ""} vencida{vencidas > 1 ? "s" : ""} sin cobrar</p>
          <p className="text-xs text-red-700 mt-1 dark:text-red-300/90">Revisa las facturas con fecha de vencimiento pasada y gestiona el cobro.</p>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl p-5 mb-6 border border-navy-100 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm dark:shadow-none">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white mb-4">Nueva factura emitida</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-navy-600 dark:text-zinc-400 mb-1">Cliente *</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls}>
                <option value="">Seleccionar...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-navy-600 dark:text-zinc-400 mb-1">Obra</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-navy-600 dark:text-zinc-400 mb-1">Fecha emisión</label>
              <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-navy-600 dark:text-zinc-400 mb-1">Fecha vencimiento</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-navy-600 dark:text-zinc-400 mb-1">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Concepto / observaciones" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-navy-600 dark:text-zinc-400 hover:text-navy-900">Cancelar</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-5 py-2 bg-brand-green text-navy-900 dark:text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {saving ? "Creando..." : "Crear factura"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {invoices.length === 0 ? (
        <EmptyState
          title="Aún no has emitido facturas"
          description="Crea tu primera factura emitida para empezar a facturar a tus clientes con Verifactu y Facturae."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 bg-brand-green text-navy-900 dark:text-white rounded-xl font-semibold text-sm hover:opacity-90 transition"
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
    </div>
  );
}
