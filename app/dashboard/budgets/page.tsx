/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { SearchInput, Select } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

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
  const confirm = useConfirm();
  const toast = useToast();

  const fetchBudgets = async () => {
    const { data } = await supabase.from("budgets").select("*, clients(name, company)").order("created_at", { ascending: false });
    if (data) setBudgets(data as Budget[]);
  };

  useEffect(() => { fetchBudgets(); }, []);

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Eliminar presupuesto",
      description: "¿Eliminar este presupuesto?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("budgets").delete().eq("id", id);
      await fetchBudgets();
      toast.success("Presupuesto eliminado");
    } catch (error) {
      toast.error("Error al eliminar el presupuesto");
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

  const statusVariant = (s: string): "green" | "blue" | "yellow" | "red" =>
    s === "accepted" ? "green" : s === "sent" ? "blue" : s === "pending" ? "yellow" : "red";
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
      <PageHeader
        title={label("budgets")}
        count={budgets.length}
        countLabel={`presupuesto${budgets.length !== 1 ? "s" : ""} en total`}
        actions={
          <div className="flex gap-2">
            <LinkButton href="/dashboard/budgets/generate" variant="secondary" size="md">
              Generar con IA
            </LinkButton>
            <LinkButton href="/dashboard/budgets/new" size="md">
              + Nuevo presupuesto
            </LinkButton>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <StatCard
          label="Aceptados"
          value={totalAccepted.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
          accent="green"
        />
        <StatCard
          label="Pendientes"
          value={totalPending.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
          accent="yellow"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por título, número o cliente..."
          className="flex-1 max-w-md"
        />
        <Select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="sm:w-auto"
        >
          <option value="all">Todos</option>
          <option value="pending">Pendientes</option>
          <option value="sent">Enviados</option>
          <option value="accepted">Aceptados</option>
          <option value="rejected">Rechazados</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search || filterStatus !== "all" ? "Sin resultados" : "Sin presupuestos todavía"}
          description={search ? "Prueba con otro término" : "Crea tu primer presupuesto profesional"}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map(b => (
            <Card key={b.id} className="hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="text-xs font-mono text-navy-500">{b.budget_number}</span>
                    <Badge variant={statusVariant(b.status)}>
                      {statusLabel(b.status)}
                    </Badge>
                    <span className="text-xs text-navy-500">{serviceLabel(b.service_type)}</span>
                  </div>
                  <h3 className="text-base font-bold text-navy-900">{b.title}</h3>
                  {b.clients && (
                    <p className="text-sm text-navy-600 mt-1">
                      {b.clients.name}{b.clients.company ? " · " + b.clients.company : ""}
                    </p>
                  )}
                  <p className="text-xs text-navy-400 mt-1.5">{new Date(b.created_at).toLocaleDateString("es-ES")}</p>
                </div>
                <div className="text-right sm:flex-shrink-0">
                  <p className="text-xl font-bold text-navy-900">{Number(b.total).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p>
                  <p className="text-xs text-navy-400">IVA incluido</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-4 border-t border-navy-100 dark:border-zinc-800">
                <LinkButton href={`/dashboard/budgets/${b.id}`} variant="secondary" size="sm">
                  Ver / Editar
                </LinkButton>
                {b.status === "pending" && (
                  <Button onClick={() => updateStatus(b.id, "sent")} variant="secondary" size="sm">
                    Marcar enviado
                  </Button>
                )}
                {b.status === "sent" && (
                  <>
                    <Button onClick={() => updateStatus(b.id, "accepted")} variant="secondary" size="sm">
                      Aceptado
                    </Button>
                    <Button onClick={() => updateStatus(b.id, "rejected")} variant="danger" size="sm">
                      Rechazado
                    </Button>
                  </>
                )}
                <Button onClick={() => handleDelete(b.id)} variant="danger" size="sm">
                  Eliminar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
