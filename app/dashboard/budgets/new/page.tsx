/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const fallbackServiceTypes = [
  { value: "reforma", label: "Reforma integral" },
  { value: "fontaneria", label: "Fontanería" },
  { value: "electricidad", label: "Electricidad" },
  { value: "climatizacion", label: "Climatización" },
  { value: "multiservicios", label: "Multiservicios" },
  { value: "general", label: "General" },
];

const unitOptions = ["ud", "m2", "ml", "h", "kg", "global"];
const categoryOptions = [
  { value: "material", label: "Material" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "otros", label: "Otros" },
];
const ivaOptions = [0, 4, 10, 21];

interface Partida {
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  unit_price: number;
  subtotal: number;
}

interface ClientOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  client_id: string | null;
}

function emptyPartida(): Partida {
  return { concept: "", description: "", quantity: 1, unit: "ud", category: "material", unit_price: 0, subtotal: 0 };
}

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const inputSmCls =
  "w-full bg-white text-navy-900 rounded-lg px-3 py-2 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none text-sm dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const labelCls = "block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1";
const labelSmCls = "block text-xs text-navy-500 dark:text-zinc-400 mb-1";

export default function NewBudgetPage() {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const { serviceTypes, budgetCategories, options } = useSector();

  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [serviceType, setServiceType] = useState("general");
  const [validUntil, setValidUntil] = useState("");
  const [ivaPercent, setIvaPercent] = useState(21);
  const [notes, setNotes] = useState("");
  const [partidas, setPartidas] = useState<Partida[]>([emptyPartida()]);

  async function loadClients(uid: string) {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", uid)
      .order("name");
    setClients(data || []);
  }

  async function loadProjects(uid: string) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, client_id")
      .eq("user_id", uid)
      .order("name");
    setProjects(data || []);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      await Promise.all([loadClients(user.id), loadProjects(user.id)]);
    }
    init();
  }, []);

  useEffect(() => {
    if (
      selectedClientId &&
      selectedProjectId &&
      !projects.some((project) => project.id === selectedProjectId && project.client_id === selectedClientId)
    ) {
      setSelectedProjectId("");
    }
  }, [selectedClientId, selectedProjectId, projects]);

  const visibleProjects = selectedClientId
    ? projects.filter((project) => project.client_id === selectedClientId)
    : projects;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updatePartida(index: number, field: keyof Partida, value: any) {
    const updated = [...partidas];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[index] as any)[field] = value;
    if (field === "quantity" || field === "unit_price") {
      updated[index].subtotal = updated[index].quantity * updated[index].unit_price;
    }
    setPartidas(updated);
  }

  function addPartida() {
    setPartidas([...partidas, emptyPartida()]);
  }

  function removePartida(index: number) {
    if (partidas.length === 1) return;
    setPartidas(partidas.filter((_, i) => i !== index));
  }

  const subtotal = partidas.reduce((sum, p) => sum + p.subtotal, 0);
  const ivaAmount = subtotal * (ivaPercent / 100);
  const total = subtotal + ivaAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      toast.error("No se pudo identificar el usuario.");
      return;
    }
    if (!title || partidas.some((p) => !p.concept || p.unit_price <= 0)) {
      toast.error("Completa el título y todas las partidas con precio válido.");
      return;
    }

    setSaving(true);
    const selectedClient = clients.find((client) => client.id === selectedClientId);
    const year = new Date().getFullYear();
    const randArray = new Uint32Array(1);
    crypto.getRandomValues(randArray);
    const rand = 10000 + (randArray[0] % 90000);
    const budgetNumber = "PRE-" + year + "-" + rand;

    const { data: budget, error } = await supabase
      .from("budgets")
      .insert({
        user_id: userId,
        client_id: selectedClientId || null,
        project_id: selectedProjectId || null,
        budget_number: budgetNumber,
        title,
        client_name: clientName || selectedClient?.name || "",
        client_email: clientEmail,
        client_phone: clientPhone,
        client_address: clientAddress,
        service_type: serviceType,
        status: "pendiente",
        subtotal,
        iva_percent: ivaPercent,
        iva_amount: ivaAmount,
        total,
        notes,
        valid_until: validUntil || null,
      })
      .select()
      .single();

    if (error || !budget) {
      toast.error("Error al guardar", { description: error?.message || "Error desconocido" });
      setSaving(false);
      return;
    }

    for (const p of partidas) {
      await supabase.from("budget_items").insert({
        budget_id: budget.id,
        concept: p.concept,
        description: p.description,
        quantity: p.quantity,
        unit: p.unit,
        category: p.category,
        unit_price: p.unit_price,
        subtotal: p.subtotal,
      });
    }

    router.push("/dashboard/budgets/" + budget.id);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/dashboard/budgets"
        className="text-sm text-navy-500 hover:text-brand-green mb-3 inline-block dark:text-zinc-400"
      >
        ← Volver a presupuestos
      </Link>
      <PageHeader title="Nuevo presupuesto" />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Datos generales */}
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Datos generales</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>Título del presupuesto *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Ej: Reforma baño completo"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cliente asociado</label>
              <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className={inputCls}>
                <option value="">Sin asignar</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Obra asociada</label>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className={inputCls}>
                <option value="">Sin asignar</option>
                {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tipo de servicio</label>
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={inputCls}>
                {(() => {
                  const sTypes = serviceTypes();
                  const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes;
                  return activeServiceTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>);
                })()}
              </select>
            </div>
            <div>
              <label className={labelCls}>IVA</label>
              <select value={ivaPercent} onChange={(e) => setIvaPercent(Number(e.target.value))} className={inputCls}>
                {ivaOptions.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Válido hasta</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
            </div>
          </div>
        </Card>

        {/* Datos del cliente */}
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Datos del cliente</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Nombre</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nombre del cliente"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="email@cliente.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="600 000 000"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Dirección</label>
              <input
                type="text"
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="Dirección de la obra"
                className={inputCls}
              />
            </div>
          </div>
        </Card>

        {/* Partidas */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider">Partidas</h2>
            <button
              type="button"
              onClick={addPartida}
              className="text-sm bg-brand-green text-navy-900 px-3 py-1.5 rounded-lg font-medium hover:opacity-90 transition"
            >
              + Añadir partida
            </button>
          </div>

          <div className="space-y-4">
            {partidas.map((p, i) => (
              <div
                key={i}
                className="rounded-xl p-4 border border-navy-100 bg-navy-50 dark:border-zinc-800 dark:bg-zinc-800/50"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-navy-800 dark:text-zinc-200">Partida {i + 1}</span>
                  {partidas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePartida(i)}
                      className="text-red-600 hover:text-red-700 text-sm dark:text-red-400 dark:hover:text-red-300"
                    >
                      ✕ Eliminar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div className="md:col-span-3">
                    <input
                      type="text"
                      value={p.concept}
                      onChange={(e) => updatePartida(i, "concept", e.target.value)}
                      placeholder="Concepto *"
                      className={inputSmCls}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <input
                      type="text"
                      value={p.description}
                      onChange={(e) => updatePartida(i, "description", e.target.value)}
                      placeholder="Descripción (opcional)"
                      className={inputSmCls}
                    />
                  </div>
                  <div>
                    <label className={labelSmCls}>Cantidad</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={p.quantity}
                      onChange={(e) => updatePartida(i, "quantity", parseFloat(e.target.value) || 0)}
                      className={inputSmCls}
                    />
                  </div>
                  <div>
                    <label className={labelSmCls}>Unidad</label>
                    <select
                      value={p.unit}
                      onChange={(e) => updatePartida(i, "unit", e.target.value)}
                      className={inputSmCls}
                    >
                      {(() => {
                        const unitOpts = options("units") || unitOptions;
                        return unitOpts.map((u) => <option key={u} value={u}>{u}</option>);
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className={labelSmCls}>Categoría</label>
                    <select
                      value={p.category}
                      onChange={(e) => updatePartida(i, "category", e.target.value)}
                      className={inputSmCls}
                    >
                      {(() => {
                        const cats = budgetCategories();
                        const activeCats = cats.length > 0 ? cats : categoryOptions;
                        return activeCats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>);
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className={labelSmCls}>Precio ud.</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={p.unit_price}
                      onChange={(e) => updatePartida(i, "unit_price", parseFloat(e.target.value) || 0)}
                      className={inputSmCls}
                    />
                  </div>
                  <div>
                    <label className={labelSmCls}>Subtotal</label>
                    <div className="bg-white text-navy-900 border border-navy-200 rounded-lg px-3 py-2 text-sm font-semibold dark:bg-zinc-900 dark:text-white dark:border-zinc-700">
                      {p.subtotal.toFixed(2)} €
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Notas */}
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Notas</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Condiciones, plazos de ejecución, garantías..."
            className={`${inputCls} resize-none`}
          />
        </Card>

        {/* Totales */}
        <Card>
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm text-navy-600 dark:text-zinc-400">
              <span>Subtotal</span>
              <span className="text-navy-900 dark:text-white font-medium">{subtotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm text-navy-600 dark:text-zinc-400">
              <span>IVA ({ivaPercent}%)</span>
              <span className="text-navy-900 dark:text-white font-medium">{ivaAmount.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t border-navy-200 pt-3 dark:border-zinc-700">
              <span className="text-navy-900 dark:text-white">TOTAL</span>
              <span className="text-brand-green">{total.toFixed(2)} €</span>
            </div>
          </div>
        </Card>

        {/* Botón guardar */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-brand-green text-navy-900 font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar presupuesto"}
          </button>
          <Link
            href="/dashboard/budgets"
            className="px-6 py-3 bg-white text-navy-700 border border-navy-200 rounded-xl hover:bg-navy-50 transition text-center dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
