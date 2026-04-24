/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/* ═══════════════ Types ═══════════════ */

interface DeliveryNote {
  id: string; user_id: string; project_id: string | null; supplier_id: string | null;
  order_id: string | null; invoice_id: string | null; note_number: string; status: string;
  reception_date: string; subtotal: number; iva_percent: number; iva_amount: number;
  total: number; notes: string; image_url: string;
}

interface DeliveryNoteLine {
  id: string; delivery_note_id: string; order_line_id: string | null;
  description: string; unit: string; quantity_expected: number; quantity_received: number;
  unit_price: number; total: number; sort_order: number;
}

interface OrderLine {
  id: string; description: string; unit: string; quantity: number; unit_price: number; total: number;
}

interface Supplier { id: string; name: string; phone: string; email: string; }
interface ProjectMin { id: string; name: string; }
interface OrderMin { id: string; title: string; order_number: string; }
interface InvoiceMin { id: string; invoice_number: string; total_amount: number; }

/* ═══════════════ Labels ═══════════════ */

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-900/30 text-yellow-300" },
  received: { label: "Recibido", color: "bg-blue-900/30 text-blue-300" },
  verified: { label: "Verificado", color: "bg-green-900/30 text-green-300" },
  disputed: { label: "Incidencia", color: "bg-red-900/30 text-red-300" },
};

const unitOptions = ["ud", "m", "m²", "m³", "kg", "l", "h", "ml", "global"];

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

/* ═══════════════ Page ═══════════════ */

export default function DeliveryNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [note, setNote] = useState<DeliveryNote | null>(null);
  const [lines, setLines] = useState<DeliveryNoteLine[]>([]);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [project, setProject] = useState<ProjectMin | null>(null);
  const [order, setOrder] = useState<OrderMin | null>(null);
  const [invoice, setInvoice] = useState<InvoiceMin | null>(null);
  const [loading, setLoading] = useState(true);

  // Line form
  const [showLineForm, setShowLineForm] = useState(false);
  const [lineForm, setLineForm] = useState({ description: "", unit: "ud", quantity_expected: 0, quantity_received: 0, unit_price: 0, order_line_id: "" });
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  async function loadNote() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: dn, error } = await supabase.from("delivery_notes").select("*").eq("id", noteId).single();
    if (error || !dn) { router.push("/dashboard/delivery-notes"); return; }
    setNote(dn);

    const linesRes = await supabase.from("delivery_note_lines").select("*").eq("delivery_note_id", noteId).order("sort_order");
    setLines((linesRes.data as DeliveryNoteLine[]) || []);

    if (dn.supplier_id) {
      const { data } = await supabase.from("suppliers").select("id, name, phone, email").eq("id", dn.supplier_id).single();
      if (data) setSupplier(data as Supplier);
    }
    if (dn.project_id) {
      const { data } = await supabase.from("projects").select("id, name").eq("id", dn.project_id).single();
      if (data) setProject(data as ProjectMin);
    }
    if (dn.order_id) {
      const { data } = await supabase.from("orders").select("id, title, order_number").eq("id", dn.order_id).single();
      if (data) setOrder(data as OrderMin);
      const olRes = await supabase.from("order_lines").select("*").eq("order_id", dn.order_id).order("sort_order");
      setOrderLines((olRes.data as OrderLine[]) || []);
    }
    if (dn.invoice_id) {
      const { data } = await supabase.from("invoices").select("id, invoice_number, total_amount").eq("id", dn.invoice_id).single();
      if (data) setInvoice(data as InvoiceMin);
    }
    setLoading(false);
  }

  /* ── Recalc totals ── */

  async function recalcTotals(newLines: DeliveryNoteLine[]) {
    if (!note) return;
    const subtotal = newLines.reduce((s, l) => s + Number(l.total || 0), 0);
    const iva_amount = subtotal * (Number(note.iva_percent) / 100);
    const total = subtotal + iva_amount;
    await supabase.from("delivery_notes").update({ subtotal, iva_amount, total, updated_at: new Date().toISOString() }).eq("id", note.id);
    setNote({ ...note, subtotal, iva_amount, total });
  }

  /* ── Import lines from order ── */

  async function importFromOrder() {
    if (!note || orderLines.length === 0) return;
    if (lines.length > 0) {
      const ok = await confirm({
        title: "Importar líneas",
        description: "Ya hay líneas. ¿Importar líneas del pedido? (no se borran las existentes)",
        variant: "warning",
        confirmLabel: "Importar",
      });
      if (!ok) return;
    }

    try {
      const inserts = orderLines.map((ol, idx) => ({
      delivery_note_id: note.id, order_line_id: ol.id,
      description: ol.description, unit: ol.unit,
      quantity_expected: ol.quantity, quantity_received: 0,
      unit_price: ol.unit_price, total: 0,
      sort_order: lines.length + idx,
    }));

      const { error } = await supabase.from("delivery_note_lines").insert(inserts);
      if (error) {
        toast.error("Error al importar líneas del pedido");
        return;
      }

      const { data } = await supabase.from("delivery_note_lines").select("*").eq("delivery_note_id", note.id).order("sort_order");
      const newLines = (data as DeliveryNoteLine[]) || [];
      setLines(newLines);
      await recalcTotals(newLines);
      toast.success("Líneas del pedido importadas");
    } catch (error) {
      toast.error("Error al importar líneas del pedido");
    }
  }

  /* ── CRUD Lines ── */

  async function handleSaveLine() {
    if (!note) return;
    if (!lineForm.description.trim()) { toast.error("La descripción es obligatoria."); return; }
    setSavingLine(true);

    const lineTotal = lineForm.quantity_received * lineForm.unit_price;

    if (editingLineId) {
      await supabase.from("delivery_note_lines").update({
        description: lineForm.description.trim(), unit: lineForm.unit,
        quantity_expected: lineForm.quantity_expected, quantity_received: lineForm.quantity_received,
        unit_price: lineForm.unit_price, total: lineTotal,
        order_line_id: lineForm.order_line_id || null,
      }).eq("id", editingLineId);
    } else {
      await supabase.from("delivery_note_lines").insert({
        delivery_note_id: note.id, description: lineForm.description.trim(), unit: lineForm.unit,
        quantity_expected: lineForm.quantity_expected, quantity_received: lineForm.quantity_received,
        unit_price: lineForm.unit_price, total: lineTotal,
        sort_order: lines.length, order_line_id: lineForm.order_line_id || null,
      });
    }

    const { data } = await supabase.from("delivery_note_lines").select("*").eq("delivery_note_id", note.id).order("sort_order");
    const newLines = (data as DeliveryNoteLine[]) || [];
    setLines(newLines);
    await recalcTotals(newLines);

    setLineForm({ description: "", unit: "ud", quantity_expected: 0, quantity_received: 0, unit_price: 0, order_line_id: "" });
    setEditingLineId(null);
    setShowLineForm(false);
    setSavingLine(false);
  }

  function startEditLine(l: DeliveryNoteLine) {
    setLineForm({
      description: l.description, unit: l.unit,
      quantity_expected: l.quantity_expected, quantity_received: l.quantity_received,
      unit_price: l.unit_price, order_line_id: l.order_line_id || "",
    });
    setEditingLineId(l.id);
    setShowLineForm(true);
  }

  async function handleDeleteLine(id: string) {
    const ok = await confirm({
      title: "Eliminar línea",
      description: "¿Eliminar esta línea?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("delivery_note_lines").delete().eq("id", id);
      const newLines = lines.filter((l) => l.id !== id);
      setLines(newLines);
      await recalcTotals(newLines);
      toast.success("Línea eliminada");
    } catch (error) {
      toast.error("Error al eliminar la línea");
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!note) return;
    setSavingStatus(true);
    await supabase.from("delivery_notes").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", note.id);
    setNote({ ...note, status: newStatus });
    setSavingStatus(false);
  }

  useEffect(() => { loadNote(); }, []);

  /* ── Computed ── */

  const discrepancies = useMemo(() => {
    return lines.filter((l) => l.quantity_expected > 0 && l.quantity_received !== l.quantity_expected);
  }, [lines]);

  /* ── Render ── */

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;
  }
  if (!note) return null;

  const st = statusMap[note.status] || { label: note.status, color: "bg-zinc-900/30 text-zinc-300 dark:bg-zinc-900/50 dark:text-zinc-400" };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <Link href="/dashboard/delivery-notes" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block">← Volver a albaranes</Link>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Albarán {note.note_number || "(sin nº)"}</h1>
          <p className="text-sm text-[var(--color-navy-500)]">Recepción: {fmtDate(note.reception_date)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${st.color}`}>{st.label}</span>
          <select value={note.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={savingStatus}
            className="bg-[var(--color-navy-700)] text-[var(--color-navy-200)] rounded-lg px-3 py-1.5 text-sm border border-[var(--color-navy-600)]">
            {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {/* Discrepancy alert */}
      {discrepancies.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-300 mb-1">Discrepancias detectadas ({discrepancies.length})</p>
          <p className="text-xs text-red-400">Hay diferencias entre cantidad pedida y recibida en {discrepancies.length} línea{discrepancies.length > 1 ? "s" : ""}.</p>
        </div>
      )}

      {/* Traceability cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2">Proveedor</p>
          {supplier ? (
            <p className="text-sm font-medium text-[var(--color-navy-100)]">{supplier.name}</p>
          ) : <p className="text-sm text-[var(--color-navy-500)]">—</p>}
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2">Obra</p>
          {project ? (
            <Link href={`/dashboard/projects/${project.id}`} className="text-sm font-medium text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] transition">{project.name}</Link>
          ) : <p className="text-sm text-[var(--color-navy-500)]">—</p>}
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2">Pedido vinculado</p>
          {order ? (
            <Link href={`/dashboard/orders/${order.id}`} className="text-sm font-medium text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] transition">{order.order_number || order.title}</Link>
          ) : <p className="text-sm text-[var(--color-navy-500)]">—</p>}
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-2">Factura vinculada</p>
          {invoice ? (
            <p className="text-sm font-medium text-[var(--color-navy-100)]">{invoice.invoice_number} ({eur(invoice.total_amount)})</p>
          ) : <p className="text-sm text-[var(--color-navy-500)]">Sin factura</p>}
        </div>
      </div>

      {/* Lines */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Líneas del albarán ({lines.length})</h3>
          <div className="flex gap-2">
            {order && orderLines.length > 0 && (
              <button onClick={importFromOrder}
                className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-200)] border border-[var(--color-navy-600)] rounded-lg text-sm font-medium hover:bg-[var(--color-navy-600)] transition">
                Importar del pedido
              </button>
            )}
            <button onClick={() => { setLineForm({ description: "", unit: "ud", quantity_expected: 0, quantity_received: 0, unit_price: 0, order_line_id: "" }); setEditingLineId(null); setShowLineForm(!showLineForm); }}
              className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">
              + Añadir línea
            </button>
          </div>
        </div>

        {showLineForm && (
          <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-4 border border-[var(--color-navy-600)]">
            <h4 className="text-sm font-semibold text-[var(--color-navy-100)] mb-4">{editingLineId ? "Editar línea" : "Nueva línea"}</h4>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="md:col-span-3">
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Descripción *</label>
                <input type="text" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} className={inputCls} placeholder="Ej: Tubo PVC 110mm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Unidad</label>
                <select value={lineForm.unit} onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })} className={inputCls}>
                  {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cant. esperada</label>
                <input type="number" step="0.001" value={lineForm.quantity_expected} onChange={(e) => setLineForm({ ...lineForm, quantity_expected: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cant. recibida</label>
                <input type="number" step="0.001" value={lineForm.quantity_received} onChange={(e) => setLineForm({ ...lineForm, quantity_received: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-navy-400)] mb-1">Precio unitario</label>
                <input type="number" step="0.01" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: parseFloat(e.target.value) || 0 })} className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[var(--color-navy-400)]">Total línea: <strong className="text-[var(--color-navy-100)]">{eur(lineForm.quantity_received * lineForm.unit_price)}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => { setShowLineForm(false); setEditingLineId(null); }} className="px-4 py-2 text-sm text-[var(--color-navy-400)]">Cancelar</button>
                <button onClick={handleSaveLine} disabled={savingLine}
                  className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                  {savingLine ? "Guardando..." : editingLineId ? "Guardar" : "Añadir"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          {lines.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[var(--color-navy-500)]">No hay líneas.{order && orderLines.length > 0 ? " Puedes importar las líneas del pedido vinculado." : ""}</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-navy-700)]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase">Descripción</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase">Ud.</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Esperada</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Recibida</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Precio</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const hasDiscrepancy = l.quantity_expected > 0 && l.quantity_received !== l.quantity_expected;
                    return (
                      <tr key={l.id} className={`border-b border-[var(--color-navy-700)]/50 hover:bg-[var(--color-navy-750)] transition ${hasDiscrepancy ? "bg-red-900/10" : ""}`}>
                        <td className="px-4 py-3 text-[var(--color-navy-500)]">{idx + 1}</td>
                        <td className="px-4 py-3 text-[var(--color-navy-100)]">
                          {l.description}
                          {hasDiscrepancy && <span className="ml-2 text-xs text-red-400">⚠ Discrepancia</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-[var(--color-navy-400)]">{l.unit}</td>
                        <td className="px-4 py-3 text-right text-[var(--color-navy-400)]">{Number(l.quantity_expected).toLocaleString("es-ES")}</td>
                        <td className={`px-4 py-3 text-right font-medium ${hasDiscrepancy ? "text-red-400" : "text-[var(--color-navy-100)]"}`}>
                          {Number(l.quantity_received).toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-navy-300)]">{eur(l.unit_price)}</td>
                        <td className="px-4 py-3 text-right font-medium text-[var(--color-navy-100)]">{eur(l.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => startEditLine(l)} className="text-xs text-[var(--color-brand-green)] hover:underline">Editar</button>
                            <button onClick={() => handleDeleteLine(l.id)} className="text-xs text-red-400 hover:underline">Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-[var(--color-navy-700)] p-4">
                <div className="flex justify-end gap-8 text-sm">
                  <div className="text-right">
                    <p className="text-[var(--color-navy-400)]">Subtotal: <span className="text-[var(--color-navy-100)] font-medium ml-2">{eur(note.subtotal)}</span></p>
                    <p className="text-[var(--color-navy-400)]">IVA ({note.iva_percent}%): <span className="text-[var(--color-navy-100)] font-medium ml-2">{eur(note.iva_amount)}</span></p>
                    <p className="text-[var(--color-navy-200)] font-bold text-base mt-1">Total: <span className="text-[var(--color-brand-green)] ml-2">{eur(note.total)}</span></p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      {note.notes && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-navy-400)] mb-1">Notas</p>
          <p className="text-sm text-[var(--color-navy-300)]">{note.notes}</p>
        </div>
      )}
    </div>
  );
}
