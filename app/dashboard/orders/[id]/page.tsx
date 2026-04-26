/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import BackButton from "@/components/ui/back-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import Loading from "@/components/ui/loading";

/* ═══════════════ Types ═══════════════ */

interface Order {
  id: string; user_id: string; project_id: string | null; supplier_id: string | null;
  order_number: string; title: string; status: string; order_date: string;
  expected_date: string | null; subtotal: number; iva_percent: number;
  iva_amount: number; total: number; notes: string;
}

interface OrderLine {
  id: string; order_id: string; description: string; unit: string;
  quantity: number; unit_price: number; total: number; sort_order: number;
}

interface Supplier { id: string; name: string; phone: string; email: string; }
interface ProjectMin { id: string; name: string; }

/* ═══════════════ Labels ═══════════════ */

const defaultStatusColor = "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400";

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: defaultStatusColor },
  sent: { label: "Enviado", color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  confirmed: { label: "Confirmado", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  partial: { label: "Parcial", color: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  received: { label: "Recibido", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  cancelled: { label: "Cancelado", color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

const unitOptions = ["ud", "m", "m²", "m³", "kg", "l", "h", "ml", "global"];

/* ═══════════════ Helpers ═══════════════ */

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

/* ═══════════════ Page ═══════════════ */

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const orderId = params.id as string;
  const supabase = createClient();

  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [project, setProject] = useState<ProjectMin | null>(null);
  const [loading, setLoading] = useState(true);

  // Line form
  const [showLineForm, setShowLineForm] = useState(false);
  const [lineForm, setLineForm] = useState({ description: "", unit: "ud", quantity: 1, unit_price: 0 });
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState(false);

  // Status change
  const [savingStatus, setSavingStatus] = useState(false);

  async function loadOrder() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: ord, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
    if (error || !ord) { router.push("/dashboard/orders"); return; }
    setOrder(ord);

    const [linesRes, supplierRes, projectRes] = await Promise.all([
      supabase.from("order_lines").select("*").eq("order_id", orderId).order("sort_order"),
      ord.supplier_id ? supabase.from("suppliers").select("id, name, phone, email").eq("id", ord.supplier_id).single() : Promise.resolve({ data: null }),
      ord.project_id ? supabase.from("projects").select("id, name").eq("id", ord.project_id).single() : Promise.resolve({ data: null }),
    ]);

    setLines((linesRes.data as OrderLine[]) || []);
    if (supplierRes.data) setSupplier(supplierRes.data as Supplier);
    if (projectRes.data) setProject(projectRes.data as ProjectMin);
    setLoading(false);
  }

  /* ── Recalc totals ── */

  async function recalcTotals(newLines: OrderLine[]) {
    if (!order) return;
    const subtotal = newLines.reduce((s, l) => s + Number(l.total || 0), 0);
    const iva_amount = subtotal * (Number(order.iva_percent) / 100);
    const total = subtotal + iva_amount;
    await supabase.from("orders").update({ subtotal, iva_amount, total, updated_at: new Date().toISOString() }).eq("id", order.id);
    setOrder({ ...order, subtotal, iva_amount, total });
  }

  /* ── CRUD Lines ── */

  async function handleSaveLine() {
    if (!order) return;
    if (!lineForm.description.trim()) { toast.error("La descripción es obligatoria."); return; }
    setSavingLine(true);

    const lineTotal = lineForm.quantity * lineForm.unit_price;

    if (editingLineId) {
      const { error } = await supabase.from("order_lines").update({
        description: lineForm.description.trim(), unit: lineForm.unit,
        quantity: lineForm.quantity, unit_price: lineForm.unit_price, total: lineTotal,
      }).eq("id", editingLineId);
      if (error) toast.error("Error", { description: error.message });
    } else {
      const { error } = await supabase.from("order_lines").insert({
        order_id: order.id, description: lineForm.description.trim(), unit: lineForm.unit,
        quantity: lineForm.quantity, unit_price: lineForm.unit_price, total: lineTotal,
        sort_order: lines.length,
      });
      if (error) toast.error("Error", { description: error.message });
    }

    // Reload lines
    const { data } = await supabase.from("order_lines").select("*").eq("order_id", order.id).order("sort_order");
    const newLines = (data as OrderLine[]) || [];
    setLines(newLines);
    await recalcTotals(newLines);

    setLineForm({ description: "", unit: "ud", quantity: 1, unit_price: 0 });
    setEditingLineId(null);
    setShowLineForm(false);
    setSavingLine(false);
  }

  function startEditLine(l: OrderLine) {
    setLineForm({ description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price });
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
      await supabase.from("order_lines").delete().eq("id", id);
      const newLines = lines.filter((l) => l.id !== id);
      setLines(newLines);
      await recalcTotals(newLines);
      toast.success("Línea eliminada");
    } catch {
      toast.error("Error al eliminar la línea");
    }
  }

  /* ── Status change ── */

  async function handleStatusChange(newStatus: string) {
    if (!order) return;
    setSavingStatus(true);
    await supabase.from("orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", order.id);
    setOrder({ ...order, status: newStatus });
    setSavingStatus(false);
  }

  useEffect(() => { loadOrder(); }, []);

  /* ── Render ── */

  if (loading) {
    return <Loading />;
  }
  if (!order) return null;

  const st = statusMap[order.status] || { label: order.status, color: defaultStatusColor };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <BackButton fallbackHref="/dashboard/orders" label="Volver a pedidos" />
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{order.title}</h1>
          {order.order_number && <p className="text-sm text-navy-500 dark:text-zinc-400 font-mono">{order.order_number}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${st.color}`}>{st.label}</span>
          <Select value={order.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={savingStatus} className="w-auto">
            {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2">Proveedor</p>
          {supplier ? (
            <>
              <p className="text-sm font-medium text-navy-900 dark:text-white">{supplier.name}</p>
              {supplier.phone && <p className="text-xs text-navy-500 dark:text-zinc-400">{supplier.phone}</p>}
              {supplier.email && <p className="text-xs text-navy-500 dark:text-zinc-400">{supplier.email}</p>}
            </>
          ) : <p className="text-sm text-navy-500 dark:text-zinc-400">Sin asignar</p>}
        </Card>
        <Card>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2">Obra</p>
          {project ? (
            <Link href={`/dashboard/projects/${project.id}`} className="text-sm font-medium text-navy-900 dark:text-white hover:text-brand-green transition">{project.name}</Link>
          ) : <p className="text-sm text-navy-500 dark:text-zinc-400">Sin asignar</p>}
        </Card>
        <Card>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2">Fechas</p>
          <p className="text-sm text-navy-900 dark:text-white">Pedido: {fmtDate(order.order_date)}</p>
          <p className="text-sm text-navy-900 dark:text-white">Entrega: {fmtDate(order.expected_date)}</p>
        </Card>
      </div>

      {/* Lines */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">Líneas del pedido ({lines.length})</h3>
          <Button onClick={() => { setLineForm({ description: "", unit: "ud", quantity: 1, unit_price: 0 }); setEditingLineId(null); setShowLineForm(!showLineForm); }}>
            + Añadir línea
          </Button>
        </div>

        {showLineForm && (
          <Card className="mb-4">
            <h4 className="text-sm font-semibold text-navy-900 dark:text-white mb-4">{editingLineId ? "Editar línea" : "Nueva línea"}</h4>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <FormField label="Descripción" required className="md:col-span-3">
                <Input type="text" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} placeholder="Ej: Tubo PVC 110mm" />
              </FormField>
              <FormField label="Unidad">
                <Select value={lineForm.unit} onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })}>
                  {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </FormField>
              <FormField label="Cantidad">
                <Input type="number" step="0.001" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: parseFloat(e.target.value) || 0 })} />
              </FormField>
              <FormField label="Precio ud.">
                <Input type="number" step="0.01" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: parseFloat(e.target.value) || 0 })} />
              </FormField>
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-navy-500 dark:text-zinc-400">Total línea: <strong className="text-navy-900 dark:text-white">{eur(lineForm.quantity * lineForm.unit_price)}</strong></p>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => { setShowLineForm(false); setEditingLineId(null); }}>Cancelar</Button>
                <Button onClick={handleSaveLine} disabled={savingLine}>
                  {savingLine ? "Guardando..." : editingLineId ? "Guardar" : "Añadir"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card padding={false}>
          {lines.length === 0 ? (
            <div className="p-8 text-center"><p className="text-sm text-navy-500 dark:text-zinc-400">No hay líneas en este pedido. Añade materiales o servicios.</p></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50/60 dark:bg-zinc-900/50">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase w-8">#</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Descripción</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Ud.</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Cantidad</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Precio</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Total</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-navy-700 dark:text-zinc-300 uppercase">Acc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={l.id} className="border-b border-navy-100 dark:border-zinc-800 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition">
                        <td className="px-4 py-2.5 text-sm text-navy-500 dark:text-zinc-400">{idx + 1}</td>
                        <td className="px-4 py-2.5 text-sm text-navy-900 dark:text-white">{l.description}</td>
                        <td className="px-3 py-2.5 text-center text-sm text-navy-600 dark:text-zinc-400">{l.unit}</td>
                        <td className="px-3 py-2.5 text-right text-sm text-navy-600 dark:text-zinc-400">{Number(l.quantity).toLocaleString("es-ES")}</td>
                        <td className="px-3 py-2.5 text-right text-sm text-navy-600 dark:text-zinc-400">{eur(l.unit_price)}</td>
                        <td className="px-3 py-2.5 text-right text-sm font-medium text-navy-900 dark:text-white">{eur(l.total)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => startEditLine(l)} className="text-xs text-brand-green hover:underline">Editar</button>
                            <button onClick={() => handleDeleteLine(l.id)} className="text-xs text-red-600 dark:text-red-400 hover:underline">Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Totals */}
              <div className="border-t border-navy-100 dark:border-zinc-800 p-4">
                <div className="flex justify-end gap-8 text-sm">
                  <div className="text-right">
                    <p className="text-navy-500 dark:text-zinc-400">Subtotal: <span className="text-navy-900 dark:text-white font-medium ml-2">{eur(order.subtotal)}</span></p>
                    <p className="text-navy-500 dark:text-zinc-400">IVA ({order.iva_percent}%): <span className="text-navy-900 dark:text-white font-medium ml-2">{eur(order.iva_amount)}</span></p>
                    <p className="text-navy-900 dark:text-white font-bold text-base mt-1">Total: <span className="text-brand-green ml-2">{eur(order.total)}</span></p>
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Notes */}
      {order.notes && (
        <Card>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mb-1">Notas</p>
          <p className="text-sm text-navy-700 dark:text-zinc-300 whitespace-pre-wrap">{order.notes}</p>
        </Card>
      )}
    </div>
  );
}
