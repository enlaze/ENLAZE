"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ═══════════════ Types ═══════════════ */

interface IssuedInvoice {
  id: string; client_id: string | null; project_id: string | null;
  series: string; number: number; invoice_number: string;
  client_name: string; client_nif: string;
  issue_date: string; due_date: string | null;
  subtotal: number; iva_percent: number; iva_amount: number;
  irpf_percent: number; irpf_amount: number; total: number;
  status: string; payment_status: string; payment_date: string | null;
  verifactu_hash: string; verifactu_registered: boolean;
  created_at: string;
}

interface Client { id: string; name: string; nif: string; email: string; address: string; }
interface Project { id: string; name: string; }

/* ═══════════════ Labels ═══════════════ */

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-gray-700 text-gray-300" },
  issued: { label: "Emitida", color: "bg-blue-900/30 text-blue-300" },
  sent: { label: "Enviada", color: "bg-purple-900/30 text-purple-300" },
  paid: { label: "Cobrada", color: "bg-green-900/30 text-green-300" },
  overdue: { label: "Vencida", color: "bg-red-900/30 text-red-300" },
  cancelled: { label: "Anulada", color: "bg-gray-700 text-gray-400" },
  rectified: { label: "Rectificada", color: "bg-orange-900/30 text-orange-300" },
};

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }
function daysSince(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

/* ═══════════════ Page ═══════════════ */

export default function IssuedInvoicesPage() {
  const router = useRouter();
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const [userId, setUserId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<IssuedInvoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_id: "", project_id: "", issue_date: new Date().toISOString().split("T")[0],
    due_date: "", notes: "",
  });

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [invRes, clientsRes, projRes] = await Promise.all([
      supabase.from("issued_invoices").select("*").eq("user_id", user.id).order("number", { ascending: false }),
      supabase.from("clients").select("id, name, nif, email, address").order("name"),
      supabase.from("projects").select("id, name").order("name"),
    ]);

    setInvoices((invRes.data as IssuedInvoice[]) || []);
    setClients((clientsRes.data as Client[]) || []);
    setProjects((projRes.data as Project[]) || []);
    setLoading(false);
  }

  async function handleCreate() {
    if (!userId) return;
    if (!form.client_id) { alert("Selecciona un cliente."); return; }
    setSaving(true);

    // Load fiscal settings for auto-numbering
    const { data: fiscal } = await supabase.from("fiscal_settings").select("*").eq("user_id", userId).single();
    if (!fiscal) { alert("Configura tus ajustes fiscales antes de emitir facturas (Ajustes → Fiscal)."); setSaving(false); return; }

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
      client_nif: client?.nif || "",
      client_address: client?.address || "",
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

    if (error) { alert("Error: " + error.message); setSaving(false); return; }

    // Increment next number
    await supabase.from("fiscal_settings").update({
      invoice_next_number: number + 1, updated_at: new Date().toISOString(),
    }).eq("id", fiscal.id);

    setForm({ client_id: "", project_id: "", issue_date: new Date().toISOString().split("T")[0], due_date: "", notes: "" });
    setShowForm(false);
    const { data } = await supabase.from("issued_invoices").select("*").eq("user_id", userId).order("number", { ascending: false });
    setInvoices((data as IssuedInvoice[]) || []);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta factura emitida?")) return;
    await supabase.from("issued_invoices").delete().eq("id", id);
    setInvoices((prev) => prev.filter((i) => i.id !== id));
  }

  // Filtering
  const filtered = invoices.filter((inv) => {
    if (filterStatus !== "all" && filterStatus === "overdue") {
      if (inv.payment_status === "paid" || !inv.due_date) return false;
      if (new Date(inv.due_date) >= new Date()) return false;
    } else if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!inv.invoice_number.toLowerCase().includes(q) && !inv.client_name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // KPIs
  const totalEmitido = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalCobrado = invoices.filter((i) => i.payment_status === "paid").reduce((s, i) => s + Number(i.total || 0), 0);
  const pendienteCobro = invoices.filter((i) => i.payment_status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + Number(i.total || 0), 0);
  const vencidas = invoices.filter((i) => i.due_date && i.payment_status !== "paid" && i.status !== "cancelled" && new Date(i.due_date) < new Date()).length;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Facturas Emitidas</h1>
          <p className="text-sm text-[var(--color-navy-400)]">Facturación a clientes con Verifactu y Facturae</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/settings/fiscal"
            className="px-4 py-2.5 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] rounded-xl text-sm border border-[var(--color-navy-600)] hover:bg-[var(--color-navy-600)] transition">
            ⚙ Ajustes fiscales
          </Link>
          <button onClick={() => setShowForm(!showForm)}
            className="px-5 py-2.5 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-xl font-semibold text-sm hover:opacity-90 transition">
            + Nueva factura
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-blue-400">{eur(totalEmitido)}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Total emitido</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-emerald-400">{eur(totalCobrado)}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Total cobrado</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-lg font-bold text-yellow-400">{eur(pendienteCobro)}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Pendiente cobro</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className={`text-lg font-bold ${vencidas > 0 ? "text-red-400" : "text-green-400"}`}>{vencidas}</p>
          <p className="text-xs text-[var(--color-navy-400)]">Facturas vencidas</p>
        </div>
      </div>

      {/* Alerta de vencidas */}
      {vencidas > 0 && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-300">Tienes {vencidas} factura{vencidas > 1 ? "s" : ""} vencida{vencidas > 1 ? "s" : ""} sin cobrar</p>
          <p className="text-xs text-red-400 mt-1">Revisa las facturas con fecha de vencimiento pasada y gestiona el cobro.</p>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">Nueva factura emitida</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cliente *</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls}>
                <option value="">Seleccionar...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.nif ? ` (${c.nif})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Obra</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha emisión</label>
              <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha vencimiento</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Concepto / observaciones" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[var(--color-navy-400)]">Cancelar</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {saving ? "Creando..." : "Crear factura"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Buscar por nº o cliente..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-100)] rounded-lg px-4 py-2 text-sm border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none w-64" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-100)] rounded-lg px-3 py-2 text-sm border border-[var(--color-navy-700)]">
          <option value="all">Todos los estados</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="overdue">Solo vencidas</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-[var(--color-navy-500)]">No hay facturas emitidas{search || filterStatus !== "all" ? " con esos filtros" : ""}.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-navy-700)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Factura</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Vto.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Estado</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase">VF</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const st = statusMap[inv.status] || { label: inv.status, color: "bg-gray-700 text-gray-300" };
                const isOverdue = inv.due_date && inv.payment_status !== "paid" && inv.status !== "cancelled" && new Date(inv.due_date) < new Date();
                const days = inv.due_date && isOverdue ? daysSince(inv.due_date) : 0;
                return (
                  <tr key={inv.id} className={`border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition ${isOverdue ? "bg-red-900/5" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/issued-invoices/${inv.id}`} className="text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] font-mono font-medium transition">
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-navy-300)]">{inv.client_name}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-400)]">{fmtDate(inv.issue_date)}</td>
                    <td className="px-4 py-3">
                      <span className={isOverdue ? "text-red-400 font-medium" : "text-[var(--color-navy-400)]"}>
                        {fmtDate(inv.due_date)}
                      </span>
                      {isOverdue && <span className="ml-1 text-xs text-red-400">({days}d)</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(inv.total)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-center">
                      {inv.verifactu_registered ? (
                        <span className="text-xs text-emerald-400" title="Hash Verifactu registrado">✓</span>
                      ) : (
                        <span className="text-xs text-[var(--color-navy-600)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/issued-invoices/${inv.id}`} className="text-xs text-[var(--color-brand-green)] hover:underline">Detalle</Link>
                        {inv.status === "draft" && (
                          <button onClick={() => handleDelete(inv.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
