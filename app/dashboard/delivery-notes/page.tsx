/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { FormField, Input, Select, SearchInput } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";

interface DeliveryNote {
  id: string;
  project_id: string | null;
  supplier_id: string | null;
  order_id: string | null;
  invoice_id: string | null;
  note_number: string;
  status: string;
  reception_date: string;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes: string;
  created_at: string;
}

interface Supplier { id: string; name: string; }
interface Project { id: string; name: string; }
interface OrderMin { id: string; title: string; order_number: string; }

const statusConfig: Record<string, { label: string; variant: "yellow" | "blue" | "green" | "red" }> = {
  pending: { label: "Pendiente", variant: "yellow" },
  received: { label: "Recibido", variant: "blue" },
  verified: { label: "Verificado", variant: "green" },
  disputed: { label: "Incidencia", variant: "red" },
};

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

export default function DeliveryNotesPage() {
  const router = useRouter();
  const supabase = createClient();
  const { label } = useSector();

  const [userId, setUserId] = useState<string | null>(null);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [orders, setOrders] = useState<OrderMin[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    note_number: "", supplier_id: "", project_id: "", order_id: "",
    reception_date: new Date().toISOString().split("T")[0], notes: "",
  });

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [notesRes, suppliersRes, projectsRes, ordersRes] = await Promise.all([
      supabase.from("delivery_notes").select("*").eq("user_id", user.id).order("reception_date", { ascending: false }),
      supabase.from("suppliers").select("id, name").eq("status", "active").order("name"),
      supabase.from("projects").select("id, name").order("name"),
      supabase.from("orders").select("id, title, order_number").eq("user_id", user.id).order("order_date", { ascending: false }),
    ]);

    setNotes((notesRes.data as DeliveryNote[]) || []);
    setSuppliers((suppliersRes.data as Supplier[]) || []);
    setProjects((projectsRes.data as Project[]) || []);
    setOrders((ordersRes.data as OrderMin[]) || []);
    setLoading(false);
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    const { error } = await supabase.from("delivery_notes").insert({
      user_id: userId,
      note_number: form.note_number.trim(),
      supplier_id: form.supplier_id || null,
      project_id: form.project_id || null,
      order_id: form.order_id || null,
      reception_date: form.reception_date,
      notes: form.notes,
      status: "pending",
    });

    if (error) alert("Error: " + error.message);
    else {
      setForm({ note_number: "", supplier_id: "", project_id: "", order_id: "", reception_date: new Date().toISOString().split("T")[0], notes: "" });
      setShowForm(false);
      const { data } = await supabase.from("delivery_notes").select("*").eq("user_id", userId).order("reception_date", { ascending: false });
      setNotes((data as DeliveryNote[]) || []);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este albarán y todas sus líneas?")) return;
    await supabase.from("delivery_notes").delete().eq("id", id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  useEffect(() => { load(); }, []);

  const filtered = notes.filter((n) => {
    if (filterStatus !== "all" && n.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!n.note_number.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name || "—";
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name || "—";
  const orderLabel = (id: string | null) => {
    const o = orders.find((ord) => ord.id === id);
    return o ? (o.order_number || o.title) : "—";
  };

  const totalAlbaranes = notes.length;
  const pendientes = notes.filter((n) => n.status === "pending" || n.status === "received").length;
  const conIncidencia = notes.filter((n) => n.status === "disputed").length;
  const totalImporte = notes.reduce((s, n) => s + Number(n.total || 0), 0);

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={label("delivery_notes")}
        description="Recepción de material y servicios"
        actions={<Button onClick={() => setShowForm(!showForm)}>+ Nuevo albarán</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total albaranes" value={totalAlbaranes} accent="blue" />
        <StatCard label="Pendientes / Recibidos" value={pendientes} accent="yellow" />
        <StatCard label="Con incidencia" value={conIncidencia} accent="red" />
        <StatCard label="Importe total" value={eur(totalImporte)} accent="green" />
      </div>

      {showForm && (
        <Card className="mb-8">
          <h3 className="text-base font-semibold text-navy-900 dark:text-white mb-5">Nuevo albarán</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
            <FormField label="N.º Albarán">
              <Input type="text" value={form.note_number} onChange={(e) => setForm({ ...form, note_number: e.target.value })} placeholder="ALB-001" />
            </FormField>
            <FormField label="Proveedor">
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Sin asignar</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Obra">
              <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">Sin asignar</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Pedido vinculado">
              <Select value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })}>
                <option value="">Ninguno</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number || o.title}</option>)}
              </Select>
            </FormField>
            <FormField label="Fecha recepción">
              <Input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} />
            </FormField>
            <FormField label="Notas">
              <Input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones" />
            </FormField>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Crear albarán"}</Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por n.º albarán..." className="w-64" />
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="all">Todos los estados</option>
          {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search || filterStatus !== "all" ? "Sin resultados" : "Sin albaranes todavía"}
          description="Crea tu primer albarán para registrar recepciones de material"
        />
      ) : (
        <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/60">
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">N.º Albarán</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Proveedor</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider hidden md:table-cell">Obra</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Pedido</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Fecha</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Estado</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => {
                  const st = statusConfig[n.status] || { label: n.status, variant: "gray" as const };
                  return (
                    <tr key={n.id} className="border-b border-navy-50 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link href={`/dashboard/delivery-notes/${n.id}`} className="text-navy-900 hover:text-brand-green font-medium font-mono transition-colors">
                          {n.note_number || "Sin n.º"}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-navy-600 dark:text-zinc-400">{supplierName(n.supplier_id)}</td>
                      <td className="px-5 py-3.5 text-navy-600 dark:text-zinc-400 hidden md:table-cell">{projectName(n.project_id)}</td>
                      <td className="px-5 py-3.5 text-navy-500 dark:text-zinc-500 hidden lg:table-cell">{orderLabel(n.order_id)}</td>
                      <td className="px-5 py-3.5 text-navy-500 dark:text-zinc-500">{fmtDate(n.reception_date)}</td>
                      <td className="px-5 py-3.5 text-right font-medium text-navy-900 dark:text-white">{eur(n.total)}</td>
                      <td className="px-5 py-3.5"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/dashboard/delivery-notes/${n.id}`} className="text-xs text-brand-green hover:underline font-medium mr-3">Detalle</Link>
                        <button onClick={() => handleDelete(n.id)} className="text-xs text-red-600 hover:underline font-medium">Eliminar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
