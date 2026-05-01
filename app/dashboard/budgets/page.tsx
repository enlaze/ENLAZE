/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";
import InfoFlipCard from "@/components/ui/InfoFlipCard";

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

  const columns: Column<Budget>[] = [
    {
      key: "budget_number",
      header: "Nº",
      sortable: true,
      alwaysVisible: true,
      exportValue: (b) => b.budget_number,
      render: (b) => (
        <Link
          href={`/dashboard/budgets/${b.id}`}
          className="font-mono text-xs text-navy-700 dark:text-zinc-300 hover:text-brand-green"
          onClick={(e) => e.stopPropagation()}
        >
          {b.budget_number}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Título",
      sortable: true,
      alwaysVisible: true,
      exportValue: (b) => b.title,
      render: (b) => (
        <div>
          <Link
            href={`/dashboard/budgets/${b.id}`}
            className="font-medium text-navy-900 dark:text-white hover:text-brand-green"
            onClick={(e) => e.stopPropagation()}
          >
            {b.title}
          </Link>
          {b.clients && (
            <p className="text-xs text-navy-500 dark:text-zinc-500">
              {b.clients.name}{b.clients.company ? " · " + b.clients.company : ""}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "service_type",
      header: "Servicio",
      hidden: "hidden md:table-cell",
      sortable: true,
      exportValue: (b) => serviceLabel(b.service_type),
      render: (b) => (
        <span className="text-xs text-navy-600 dark:text-zinc-400">{serviceLabel(b.service_type)}</span>
      ),
    },
    {
      key: "created_at",
      header: "Fecha",
      sortable: true,
      hidden: "hidden lg:table-cell",
      exportValue: (b) => (b.created_at ? new Date(b.created_at) : null),
      render: (b) => (
        <span className="text-xs text-navy-500 dark:text-zinc-500 tabular-nums">
          {new Date(b.created_at).toLocaleDateString("es-ES")}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      exportValue: (b) => Number(b.total || 0),
      render: (b) => (
        <span className="font-medium text-navy-900 dark:text-white tabular-nums">
          {Number(b.total).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      exportValue: (b) => statusLabel(b.status),
      render: (b) => <Badge variant={statusVariant(b.status)}>{statusLabel(b.status)}</Badge>,
    },
    {
      key: "actions",
      header: "Acciones",
      align: "right",
      alwaysVisible: true,
      render: (b) => (
        <div className="flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <LinkButton href={`/dashboard/budgets/${b.id}`} variant="secondary" size="sm">
            Ver
          </LinkButton>
          {b.status === "pending" && (
            <Button onClick={() => updateStatus(b.id, "sent")} variant="secondary" size="sm">
              Enviado
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
      ),
    },
  ];

  const filters: FilterDef<Budget>[] = [
    {
      key: "status",
      label: "Estado",
      options: [
        { label: "Pendientes", value: "pending" },
        { label: "Enviados", value: "sent" },
        { label: "Aceptados", value: "accepted" },
        { label: "Rechazados", value: "rejected" },
      ],
      matches: (b, v) => b.status === v,
    },
  ];

  return (
    <>
      <PageHeader
        title={label("budgets")}
        count={budgets.length}
        countLabel={`presupuesto${budgets.length !== 1 ? "s" : ""} en total`}
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Presupuestos"
            what="El sitio donde creas y envías presupuestos a tus clientes de forma rápida y profesional. Sin Word, sin Excel, sin copiar y pegar de un sitio a otro."
            howTo="Para preparar un presupuesto en minutos, enviárselo al cliente y saber en todo momento si lo ha visto, si lo ha aceptado o si está pendiente de respuesta. Cuando el cliente dice que sí, lo conviertes en factura con un solo clic — sin volver a escribir nada."
          />
        }
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

      {budgets.length === 0 ? (
        <EmptyState
          title="Sin presupuestos todavía"
          description="Crea tu primer presupuesto profesional"
        />
      ) : (
        <DataTable<Budget>
          columns={columns}
          data={budgets}
          rowKey={(b) => b.id}
          searchable
          searchPlaceholder="Buscar por título, número o cliente..."
          searchFields={(b) => [b.title, b.budget_number, b.clients?.name, b.clients?.company]}
          filters={filters}
          initialSort={{ key: "created_at", dir: "desc" }}
          pageSize={25}
          exportable
          exportFileName="presupuestos"
          toggleableColumns
          emptyMessage="Sin resultados. Prueba con otro término."
        />
      )}
    </>
  );
}
