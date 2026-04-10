"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

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

export default function ProjectsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { label } = useSector();

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
      alert("El nombre de la obra es obligatorio.");
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
    if (!confirm("¿Eliminar esta obra?")) return;
    await supabase.from("projects").delete().eq("id", id);
    await loadProjects();
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">{label("projects")}</h1>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">
            Gestiona tus {label("projects").toLowerCase()}, cliente asociado y control económico básico
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition"
        >
          + {label("project") === "Obra" ? "Nueva obra" : `Nuevo/a ${label("project").toLowerCase()}`}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{filtered.length}</p>
          <p className="text-xs text-[var(--color-navy-400)]">{label("projects")}</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-brand-green)]">{totalBudget.toFixed(2)}€</p>
          <p className="text-xs text-[var(--color-navy-400)]">Presupuesto total</p>
        </div>
        <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
          <p className={`text-2xl font-bold ${totalMargin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalMargin.toFixed(2)}€
          </p>
          <p className="text-xs text-[var(--color-navy-400)]">Margen provisional</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Buscar por obra, dirección o cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[var(--color-navy-800)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-700)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
        >
          <option value="all">Todos los estados</option>
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {showForm && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
            {editingId ? "Editar obra" : "Nueva obra"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cliente</label>
              <select
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              >
                <option value="">Sin asignar</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nombre de la obra *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
                placeholder="Ej: Reforma integral vivienda San Juan"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Dirección</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
                placeholder="Dirección de la obra"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Estado</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha inicio</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Fecha fin</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Presupuesto previsto (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.budget_amount}
                onChange={(e) => setForm({ ...form, budget_amount: Number(e.target.value) || 0 })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Coste real (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.actual_cost}
                onChange={(e) => setForm({ ...form, actual_cost: Number(e.target.value) || 0 })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Descripción</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm"
                placeholder="Descripción breve de la obra"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs text-[var(--color-navy-400)] mb-1">Notas</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm min-h-[90px]"
                placeholder="Observaciones internas"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg text-sm font-medium hover:opacity-90 transition"
            >
              {editingId ? "Guardar cambios" : "Crear obra"}
            </button>
            <button
              onClick={resetForm}
              className="px-5 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-lg text-sm hover:bg-[var(--color-navy-600)] transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center">
          <p className="text-[var(--color-navy-400)]">No hay obras creadas todavía.</p>
          <p className="text-sm text-[var(--color-navy-500)] mt-1">Pulsa “Nueva obra” para empezar a organizar proyectos.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-navy-700)]">
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Obra</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Cliente</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Estado</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Inicio</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Fin</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Presupuesto</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-3 py-3">Coste</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase tracking-wider px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/projects/${project.id}`} className="text-sm font-medium text-[var(--color-navy-100)] hover:text-[var(--color-brand-green)] transition">
                        {project.name}
                      </Link>
                      {project.address && <p className="text-xs text-[var(--color-navy-400)]">{project.address}</p>}
                    </td>
                    <td className="px-3 py-3 text-sm text-[var(--color-navy-200)]">
                      {clientMap[project.client_id || ""] || "Sin asignar"}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-200)]">
                      {statusLabelMap[project.status] || project.status}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">
                      {project.start_date || "—"}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-[var(--color-navy-300)]">
                      {project.end_date || "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-100)]">
                      {Number(project.budget_amount || 0).toFixed(2)}€
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-100)]">
                      {Number(project.actual_cost || 0).toFixed(2)}€
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/dashboard/projects/${project.id}`} className="text-xs text-blue-400 hover:underline mr-3">
                        Ver detalle
                      </Link>
                      <button onClick={() => startEdit(project)} className="text-xs text-[var(--color-brand-green)] hover:underline mr-3">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(project.id)} className="text-xs text-red-400 hover:underline">
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
