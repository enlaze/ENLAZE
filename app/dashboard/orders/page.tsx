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

interface Order {
  id: string;
  project_id: string | null;
  supplier_id: string | null;
  order_number: string;
  title: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes: string;
  created_at: string;
}

interface Supplier { id: string; name: string; }
interface Project { id: string; name: string; }

const statusConfig: Record<string, { label: string; variant: "gray" | "blue" | "green" | "yellow" | "red" }> = {
  draft: { label: "Borrador", variant: "gray" },
  sent: { label: "Enviado", variant: "blue" },
  confirmed: { label: "Confirmado", variant: "green" },
  partial: { label: "Parcial", variant: "yellow" },
  received: { label: "Recibido", variant: "green" },
  cancelled: { label: "Cancelado", variant: "red" },
};

function eur(n: number) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }

export default function OrdersPage() {
  const router = useRouter();
  const supabase = createClient();
  const { label } = useSector();

  const [userId, setUserId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", order_number: "", supplier_id: "", project_id: "",
    order_date: new Date().toISOString().split("T")[0], expected_date: "",
    notes: "",
  });

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [ordersRes, suppliersRes, projectsRes] = await Promise.all([
      supabase.from("orders").select("*").eq("user_id", user.id).order("order_date", { ascending: false }),
      supabase.from("suppliers").select("id, name").eq("status", "active").order("name"),
      supabase.from("projects").select("id, name").order("name"),
    ]);

    setOrders((ordersRes.data as Order[]) || []);
    setSuppliers((suppliersRes.data as Supplier[]) || []);
    setProjects((projectsRes.data as Project[]) || []);
    setLoading(false);
  }

  async function handleSave() {
    if (!userId) return;
    if (!form.title.trim()) { alert("El título del pedido es obligatorio."); return; }
    setSaving(true);

    const { error } = await supabase.from("orders").insert({
      user_id: userId,
      title: form.title.trim(),
      order_number: form.order_number.trim(),
      supplier_id: form.supplier_id || null,
      project_id: form.project_id || null,
      order_date: form.order_date,
      expected_date: form.expected_date || null,
      notes: form.notes,
      status: "draft",
    });

    if (error) alert("Error: " + error.message);
    else {
      setForm({ title: "", order_number: "", supplier_id: "", project_id: "", order_date: new Date().toISOString().split("T")[0], expected_date: "", notes: "" });
      setShowForm(false);
      const { data } = await supabase.from("orders").select("*").eq("user_id", userId).order("order_date", { ascending: false });
      setOrders((data as Order[]) || []);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este pedido y todas sus líneas?")) return;
    await supabase.from("orders").delete().eq("id", id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }

  useEffect(() => { load(); }, []);

  const filtered = orders.filter((o) => {
    if (filterStatus !== "all" && o.status !== filterStatus) return false;
    if (filterSupplier !== "all" && o.supplier_id !== filterSupplier) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!o.title.toLowerCase().includes(q) && !o.order_number.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name || "—";
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name || "—";

  const totalPedidos = orders.length;
  const pendientes = orders.filter((o) => o.status === "draft" || o.status === "sent" || o.status === "confirmed").length;
  const totalImporte = orders.reduce((s, o) => s + Number(o.total || 0), 0);

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={label("orders")}
        description="Gestión de pedidos a proveedores y subcontratas"
        actions={<Button onClick={() => setShowForm(!showForm)}>+ Nuevo pedido</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total pedidos" value={totalPedidos} accent="blue" />
        <StatCard label="Pendientes" value={pendientes} accent="yellow" />
        <StatCard label="Importe total" value={eur(totalImporte)} accent="green" />
      </div>

      {showForm && (
        <Card className="mb-8">
          <h3 className="text-base font-semibold text-navy-900 mb-5">Nuevo pedido</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
            <FormField label="Título" required className="md:col-span-2">
              <Input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej: Material fontanería planta 2" />
            </FormField>
            <FormField label="N.º Pedido">
              <Input type="text" value={form.order_number} onChange={(e) => setForm({ ...form, order_number: e.target.value })} placeholder="PED-001" />
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
            <FormField label="Fecha pedido">
              <Input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} />
            </FormField>
            <FormField label="Fecha entrega prevista">
              <Input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
            </FormField>
            <FormField label="Notas" className="md:col-span-2">
              <Input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones del pedido" />
            </FormField>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Crear pedido"}</Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar pedidos..." className="w-64" />
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="all">Todos los estados</option>
          {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="w-auto">
          <option value="all">Todos los proveedores</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search || filterStatus !== "all" || filterSupplier !== "all" ? "Sin resultados" : "Sin pedidos todavía"}
          description="Crea tu primer pedido para empezar a gestionar compras"
        />
      ) : (
        <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 bg-navy-50/60">
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Pedido</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Proveedor</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 uppercase tracking-wider hidden md:table-cell">Obra</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Fecha</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Estado</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold text-navy-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const st = statusConfig[o.status] || { label: o.status, variant: "gray" as const };
                  return (
                    <tr key={o.id} className="border-b border-navy-50 hover:bg-navy-50/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link href={`/dashboard/orders/${o.id}`} className="text-navy-900 hover:text-brand-green font-medium transition-colors">
                          {o.title}
                        </Link>
                        {o.order_number && <p className="text-xs text-navy-400 font-mono">{o.order_number}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-navy-600">{supplierName(o.supplier_id)}</td>
                      <td className="px-5 py-3.5 text-navy-600 hidden md:table-cell">{projectName(o.project_id)}</td>
                      <td className="px-5 py-3.5 text-navy-500">{fmtDate(o.order_date)}</td>
                      <td className="px-5 py-3.5 text-right font-medium text-navy-900">{eur(o.total)}</td>
                      <td className="px-5 py-3.5"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/dashboard/orders/${o.id}`} className="text-xs text-brand-green hover:underline font-medium mr-3">Detalle</Link>
                        <button onClick={() => handleDelete(o.id)} className="text-xs text-red-600 hover:underline font-medium">Eliminar</button>
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
