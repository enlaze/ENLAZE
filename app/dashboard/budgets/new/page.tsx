"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

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

export default function NewBudgetPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { serviceTypes, budgetCategories, subcategories: getSectorSubcats, options } = useSector();

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

  function updatePartida(index: number, field: keyof Partida, value: any) {
    const updated = [...partidas];
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
      alert("No se pudo identificar el usuario.");
      return;
    }
    if (!title || partidas.some((p) => !p.concept || p.unit_price <= 0)) {
      alert("Completa el título y todas las partidas con precio válido.");
      return;
    }

    setSaving(true);
    const selectedClient = clients.find((client) => client.id === selectedClientId);
    const year = new Date().getFullYear();
    const rand = Math.floor(10000 + Math.random() * 90000);
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
      alert("Error al guardar: " + (error?.message || ""));
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
      <div className="mb-6">
        <Link href="/dashboard/budgets" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block">
          ← Volver a presupuestos
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Nuevo presupuesto</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Datos generales */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Datos generales</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Título del presupuesto *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Ej: Reforma baño completo" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Cliente asociado</label>
              <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none">
                <option value="">Sin asignar</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Obra asociada</label>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none">
                <option value="">Sin asignar</option>
                {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Tipo de servicio</label>
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none">
                {(() => { const sTypes = serviceTypes(); const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes; return activeServiceTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>); })()}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">IVA</label>
              <select value={ivaPercent} onChange={(e) => setIvaPercent(Number(e.target.value))} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none">
                {ivaOptions.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Válido hasta</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Datos del cliente */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Datos del cliente</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Nombre</label>
              <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre del cliente" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Email</label>
              <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@cliente.com" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Teléfono</label>
              <input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="600 000 000" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-navy-300)] mb-1">Dirección</label>
              <input type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Dirección de la obra" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Partidas */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Partidas</h2>
            <button type="button" onClick={addPartida} className="text-sm bg-[var(--color-brand-green)] text-[var(--color-navy-900)] px-3 py-1.5 rounded-lg font-medium hover:opacity-90 transition">
              + Añadir partida
            </button>
          </div>

          <div className="space-y-4">
            {partidas.map((p, i) => (
              <div key={i} className="bg-[var(--color-navy-750)] rounded-lg p-4 border border-[var(--color-navy-600)]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[var(--color-navy-200)]">Partida {i + 1}</span>
                  {partidas.length > 1 && (
                    <button type="button" onClick={() => removePartida(i)} className="text-red-400 hover:text-red-300 text-sm">✕ Eliminar</button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div className="md:col-span-3">
                    <input type="text" value={p.concept} onChange={(e) => updatePartida(i, "concept", e.target.value)} placeholder="Concepto *" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
                  </div>
                  <div className="md:col-span-3">
                    <input type="text" value={p.description} onChange={(e) => updatePartida(i, "description", e.target.value)} placeholder="Descripción (opcional)" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cantidad</label>
                    <input type="number" min="0" step="0.01" value={p.quantity} onChange={(e) => updatePartida(i, "quantity", parseFloat(e.target.value) || 0)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-navy-400)] mb-1">Unidad</label>
                    <select value={p.unit} onChange={(e) => updatePartida(i, "unit", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                      {(() => { const unitOpts = options("units") || unitOptions; return unitOpts.map((u) => <option key={u} value={u}>{u}</option>); })()}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-navy-400)] mb-1">Categoría</label>
                    <select value={p.category} onChange={(e) => updatePartida(i, "category", e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
                      {(() => { const cats = budgetCategories(); const activeCats = cats.length > 0 ? cats : categoryOptions; return activeCats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>); })()}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-navy-400)] mb-1">Precio ud.</label>
                    <input type="number" min="0" step="0.01" value={p.unit_price} onChange={(e) => updatePartida(i, "unit_price", parseFloat(e.target.value) || 0)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-3 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-navy-400)] mb-1">Subtotal</label>
                    <div className="bg-[var(--color-navy-600)] text-[var(--color-navy-100)] rounded-lg px-3 py-2 text-sm font-medium">
                      {p.subtotal.toFixed(2)} €
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Notas</h2>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Condiciones, plazos de ejecución, garantías..." className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none resize-none" />
        </div>

        {/* Totales */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm text-[var(--color-navy-300)]">
              <span>Subtotal</span>
              <span className="text-[var(--color-navy-100)]">{subtotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm text-[var(--color-navy-300)]">
              <span>IVA ({ivaPercent}%)</span>
              <span className="text-[var(--color-navy-100)]">{ivaAmount.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t border-[var(--color-navy-700)] pt-3">
              <span className="text-[var(--color-navy-100)]">TOTAL</span>
              <span className="text-[var(--color-brand-green)]">{total.toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* Botón guardar */}
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="flex-1 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50">
            {saving ? "Guardando..." : "Guardar presupuesto"}
          </button>
          <Link href="/dashboard/budgets" className="px-6 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-xl hover:bg-[var(--color-navy-600)] transition text-center">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
