 
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { FormField, Input, Select, Textarea, SearchInput } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { SkeletonKpi, SkeletonTable } from "@/components/ui/skeleton";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

interface ClientOption {
  id: string;
  name: string;
}

interface Project {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  address: string;
  description: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  budget_amount: number;
  actual_cost: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

const statusOptions = [
  { value: "planning", label: "Planificación" },
  { value: "approved", label: "Aprobada" },
  { value: "in_progress", label: "En curso" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Finalizada" },
  { value: "cancelled", label: "Cancelada" },
];

const emptyForm = {
  client_id: "",
  name: "",
  address: "",
  description: "",
  status: "planning",
  start_date: "",
  end_date: "",
  budget_amount: 0,
  actual_cost: 0,
  notes: "",
};

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

function getStatusBadgeVariant(status: string): "yellow" | "blue" | "green" | "gray" | "red" {
  switch (status) {
    case "planning":
      return "yellow";
    case "approved":
      return "blue";
    case "in_progress":
      return "green";
    case "paused":
      return "gray";
    case "completed":
      return "green";
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

export default function ProjectsPage() {
  const supabase = createClient();
  const { label } = useSector();
  const confirm = useConfirm();
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState(emptyForm);

  async function loadClients() {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .order("name");

    setClients(data || []);
  }

  async function loadProjects(uid?: string) {
    const targetUserId = uid || userId;
    if (!targetUserId) return;

    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false });

    setProjects(data || []);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setUserId(user.id);
      await Promise.all([
        loadClients(),
        loadProjects(user.id),
      ]);
      setLoading(false);
    }

    init();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(project: Project) {
    setForm({
      client_id: project.client_id || "",
      name: project.name || "",
      address: project.address || "",
      description: project.description || "",
      status: project.status || "planning",
      start_date: project.start_date || "",
      end_date: project.end_date || "",
      budget_amount: Number(project.budget_amount || 0),
      actual_cost: Number(project.actual_cost || 0),
      notes: project.notes || "",
    });
    setEditingId(project.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!userId) return;
    if (!form.name.trim()) {
      toast.error("El nombre de la obra es obligatorio.");
      return;
    }

    const payload = {
      user_id: userId,
      client_id: form.client_id || null,
      name: form.name.trim(),
      address: form.address,
      description: form.description,
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      budget_amount: Number(form.budget_amount || 0),
      actual_cost: Number(form.actual_cost || 0),
      notes: form.notes,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await supabase.from("projects").update(payload).eq("id", editingId);
    } else {
      await supabase.from("projects").insert(payload);
    }

    resetForm();
    await loadProjects();
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Eliminar obra",
      description: "¿Eliminar esta obra?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("projects").delete().eq("id", id);
      await loadProjects();
      toast.success("Obra eliminada");
    } catch (error) {
      toast.error("Error al eliminar la obra");
    }
  }

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients]
  );

  const filtered = projects.filter((project) => {
    const matchSearch =
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      (project.address || "").toLowerCase().includes(search.toLowerCase()) ||
      (clientMap[project.client_id || ""] || "").toLowerCase().includes(search.toLowerCase());

    const matchStatus = filterStatus === "all" || project.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalBudget = filtered.reduce((sum, p) => sum + Number(p.budget_amount || 0), 0);
  const totalCost = filtered.reduce((sum, p) => sum + Number(p.actual_cost || 0), 0);
  const totalMargin = totalBudget - totalCost;

  const statusLabelMap: Record<string, string> = {
    planning: "Planificación",
    approved: "Aprobada",
    in_progress: "En curso",
    paused: "Pausada",
    completed: "Finalizada",
    cancelled: "Cancelada",
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded bg-navy-100" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-navy-100/70" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <SkeletonTable rows={5} cols={6} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={label("projects")}
        description={`Gestiona tus ${label("projects").toLowerCase()}, cliente asociado y control económico básico`}
        actions={
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            + {label("project") === "Obra" ? "Nueva obra" : `Nuevo/a ${label("project").toLowerCase()}`}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label={label("projects")}
          value={filtered.length}
          accent="blue"
        />
        <StatCard
          label="Presupuesto total"
          value={eur(totalBudget)}
          accent="green"
        />
        <StatCard
          label="Margen provisional"
          value={eur(totalMargin)}
          accent={totalMargin >= 0 ? "green" : "red"}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por obra, dirección o cliente..."
          className="flex-1"
        />
        <Select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </div>

      {showForm && (
        <Card className="mb-6">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-4 mb-4">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
              {editingId ? "Editar obra" : "Nueva obra"}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <FormField label="Cliente">
              <Select
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Nombre de la obra" required className="md:col-span-2">
              <Input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Reforma integral vivienda San Juan"
              />
            </FormField>

            <FormField label="Dirección" className="md:col-span-3">
              <Input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Dirección de la obra"
              />
            </FormField>

            <FormField label="Estado">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Fecha inicio">
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </FormField>

            <FormField label="Fecha fin">
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </FormField>

            <FormField label="Presupuesto previsto (€)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.budget_amount}
                onChange={(e) => setForm({ ...form, budget_amount: Number(e.target.value) || 0 })}
              />
            </FormField>

            <FormField label="Coste real (€)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.actual_cost}
                onChange={(e) => setForm({ ...form, actual_cost: Number(e.target.value) || 0 })}
              />
            </FormField>

            <FormField label="Descripción" className="md:col-span-3">
              <Input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción breve de la obra"
              />
            </FormField>

            <FormField label="Notas" className="md:col-span-3">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Observaciones internas"
                className="min-h-[90px]"
              />
            </FormField>
          </div>

          <div className="flex gap-3 pt-4 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleSave}>
              {editingId ? "Guardar cambios" : "Crear obra"}
            </Button>
            <Button variant="secondary" onClick={resetForm}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={`No hay ${label("projects").toLowerCase()} creadas`}
          description={`Crea tu primera ${label("project").toLowerCase()} para empezar a organizar proyectos, presupuestos y costes.`}
          action={
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              + {label("project") === "Obra" ? "Nueva obra" : `Nuevo/a ${label("project").toLowerCase()}`}
            </Button>
          }
        />
      ) : (
        <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-50 bg-navy-50 dark:bg-zinc-900/60">
                  <th className="text-left text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-3">Obra</th>
                  <th className="text-left text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Cliente</th>
                  <th className="text-center text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Estado</th>
                  <th className="text-center text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Inicio</th>
                  <th className="text-center text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Fin</th>
                  <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Presupuesto</th>
                  <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-3">Coste</th>
                  <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id} className="border-b border-navy-50 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/projects/${project.id}`} className="text-sm font-medium text-brand-green hover:underline">
                        {project.name}
                      </Link>
                      {project.address && <p className="text-xs text-navy-500 dark:text-zinc-500">{project.address}</p>}
                    </td>
                    <td className="px-3 py-3 text-sm text-navy-600 dark:text-zinc-400">
                      {clientMap[project.client_id || ""] || "Sin asignar"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Badge variant={getStatusBadgeVariant(project.status)}>
                        {statusLabelMap[project.status] || project.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-navy-500 dark:text-zinc-500">
                      {fmtDate(project.start_date)}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-navy-500 dark:text-zinc-500">
                      {fmtDate(project.end_date)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-navy-900 dark:text-white font-medium">
                      {eur(project.budget_amount)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-navy-900 dark:text-white font-medium">
                      {eur(project.actual_cost)}
                    </td>
                    <td className="px-5 py-3 text-right space-x-2">
                      <Link href={`/dashboard/projects/${project.id}`} className="text-xs text-brand-green hover:underline mr-3">
                        Ver detalle
                      </Link>
                      <button onClick={() => startEdit(project)} className="text-xs text-brand-green hover:underline mr-3">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(project.id)} className="text-xs text-red-600 hover:underline">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
