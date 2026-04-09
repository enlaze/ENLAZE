"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

type Budget = {
  id: string;
  budget_number: string;
  title: string;
  service_type: string;
  subtotal: number;
  iva_amount: number;
  total: number;
  status: string;
  created_at: string;
  clients: { name: string; company: string } | null;
};

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const supabase = createClient();
  const { label, serviceTypes } = useSector();

  useEffect(() => { fetchBudgets(); }, []);

  const fetchBudgets = async () => {
    const { data } = await supabase.from("budgets").select("*, clients(name, company)").order("created_at", { ascending: false });
    if (data) setBudgets(data as any);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Eliminar este presupuesto?")) {
      await supabase.from("budgets").delete().eq("id", id);
      await fetchBudgets();
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("budgets").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    await fetchBudgets();
  };

  const filtered = budgets.filter(b => {
    const matchSearch = b.title.toLowerCase().includes(search.toLowerCase()) || b.budget_number.toLowerCase().includes(search.toLowerCase()) || (b.clients?.name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || b.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const statusColor = (s: string) => {
    if (s === "accepted") return "bg-brand-green/10 text-brand-green";
    if (s === "sent") return "bg-blue-50 text-blue-600";
    if (s === "pending") return "bg-yellow-50 text-yellow-600";
    return "bg-red-50 text-red-500";
  };
  const statusLabel = (s: string) => {
    if (s === "accepted") return "Aceptado";
    if (s === "sent") return "Enviado";
    if (s === "pending") return "Pendiente";
    return "Rechazado";
  };
  const serviceLabel = (s: string) => {
    const sTypes = serviceTypes();
    const map: Record<string, string> = Object.fromEntries(sTypes.map(st => [st.value, st.label]));
    return map[s] || s;
  };

  const totalAccepted = budgets.filter(b => b.status === "accepted").reduce((sum, b) => sum + Number(b.total), 0);
  const totalPending = budgets.filter(b => b.status === "pending" || b.status === "sent").reduce((sum, b) => sum + Number(b.total), 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-navy-900">{label("budgets")}</h1>
          <p className="mt-1 text-navy-600">{budgets.length} presupuesto{budgets.length !== 1 ? "s" : ""} en total</p>
        </div>
        <Link href="/dashboard/budgets/generate" className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition">⚡ Generar con IA</Link>
          <Link href="/dashboard/budgets/new" className="px-5 py-2.5 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors text-center">+ Nuevo presupuesto</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-navy-500">Aceptados</p>
          <p className="mt-1 text-2xl font-bold text-brand-green">{totalAccepted.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-navy-500">Pendientes</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">{totalPending.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 max-w-md px-4 py-3 rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Buscar por titulo, numero o cliente..." />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-4 py-3 rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50">
          <option value="all">Todos</option>
          <option value="pending">Pendientes</option>
          <option value="sent">Enviados</option>
          <option value="accepted">Aceptados</option>
          <option value="rejected">Rechazados</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-navy-100 bg-white p-12 text-center">
          <p className="text-4xl mb-4">📋</p>
          <h3 className="text-lg font-bold text-navy-900">{search || filterStatus !== "all" ? "Sin resultados" : "Sin presupuestos todavia"}</h3>
          <p className="mt-2 text-navy-600">{search ? "Prueba con otro termino" : "Crea tu primer presupuesto profesional"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(b => (
            <div key={b.id} className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-mono text-navy-400">{b.budget_number}</span>
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor(b.status)}`}>{statusLabel(b.status)}</span>
                    <span className="text-xs text-navy-400">{serviceLabel(b.service_type)}</span>
                  </div>
                  <h3 className="text-lg font-bold text-navy-900">{b.title}</h3>
                  {b.clients && <p className="text-sm text-navy-600">{b.clients.name}{b.clients.company ? " · " + b.clients.company : ""}</p>}
                  <p className="text-xs text-navy-400 mt-1">{new Date(b.created_at).toLocaleDateString("es-ES")}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-navy-900">{Number(b.total).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p>
                  <p className="text-xs text-navy-400">IVA incluido</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/dashboard/budgets/${b.id}`} className="px-3 py-1.5 rounded-lg border border-navy-200 text-xs font-medium text-navy-700 hover:bg-navy-50">Ver / Editar</Link>
                {b.status === "pending" && <button onClick={() => updateStatus(b.id, "sent")} className="px-3 py-1.5 rounded-lg border border-blue-200 text-xs font-medium text-blue-600 hover:bg-blue-50">Marcar enviado</button>}
                {b.status === "sent" && (
                  <>
                    <button onClick={() => updateStatus(b.id, "accepted")} className="px-3 py-1.5 rounded-lg border border-brand-green/30 text-xs font-medium text-brand-green hover:bg-brand-green/5">Aceptado</button>
                    <button onClick={() => updateStatus(b.id, "rejected")} className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-500 hover:bg-red-50">Rechazado</button>
                  </>
                )}
                <button onClick={() => handleDelete(b.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50">Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
