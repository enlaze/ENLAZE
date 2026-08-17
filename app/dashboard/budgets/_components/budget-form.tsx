/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { analytics } from "@/lib/analytics";
import { saveDocumentVersion } from "@/lib/document-versions";

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

interface PaymentPhase {
  percent: number;
  concept: string;
  moment: string;
}

const paymentMethodQuickOptions = ["Transferencia bancaria", "Bizum", "Efectivo", "Tarjeta", "A convenir"];

function defaultPaymentSchedule(depositPercent: number): PaymentPhase[] {
  const deposit = Math.max(0, Math.min(100, depositPercent));
  return [
    { percent: deposit, concept: "Anticipo", moment: "Al aceptar el presupuesto" },
    { percent: Math.max(0, 100 - deposit), concept: "Resto", moment: "A la finalización" },
  ];
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

interface PBSearchResult {
  id: string;
  name: string;
  unit: string;
  price: number;
  brand: string | null;
  sku: string | null;
  provider_name: string;
}

function emptyPartida(): Partida {
  return { concept: "", description: "", quantity: 1, unit: "ud", category: "material", unit_price: 0, subtotal: 0 };
}

function useProductSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PBSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pb/search?q=${encodeURIComponent(q)}&limit=8`);
        const data = await res.json();
        setResults(data.results || []);
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
  }, []);

  return { query, search, results, loading, clear: () => { setQuery(""); setResults([]); } };
}

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const inputSmCls =
  "w-full bg-white text-navy-900 rounded-lg px-3 py-2 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none text-sm dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const labelCls = "block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1";
const labelSmCls = "block text-xs text-navy-500 dark:text-zinc-400 mb-1";

export function BudgetForm({ editBudgetId }: { editBudgetId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const { serviceTypes, budgetCategories, options } = useSector();

  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editBudgetId));
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
  const [depositPercent, setDepositPercent] = useState(30);
  const [paymentMethod, setPaymentMethod] = useState("Transferencia bancaria");
  const [paymentIban, setPaymentIban] = useState("");
  const [fiscalIban, setFiscalIban] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentPhase[]>(defaultPaymentSchedule(30));
  const [warrantyText, setWarrantyText] = useState("");
  const [executionDeadlineText, setExecutionDeadlineText] = useState("");
  const [observations, setObservations] = useState("");
  const [conditionsText, setConditionsText] = useState("");
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
      const [, , { data: fiscal }] = await Promise.all([
        loadClients(user.id),
        loadProjects(user.id),
        supabase.from("fiscal_settings").select("iban").eq("user_id", user.id).maybeSingle(),
      ]);
      const settingsIban = fiscal?.iban || "";
      if (settingsIban) setFiscalIban(settingsIban);

      if (!editBudgetId && settingsIban) {
        setPaymentIban(settingsIban);
      }

      if (editBudgetId) {
        const [{ data: existingBudget }, { data: existingItems }] =
          await Promise.all([
            supabase
              .from("budgets")
              .select("*")
              .eq("id", editBudgetId)
              .eq("user_id", user.id)
              .maybeSingle(),
            supabase
              .from("budget_items")
              .select("*")
              .eq("budget_id", editBudgetId)
              .order("created_at", { ascending: true }),
          ]);

        if (!existingBudget) {
          toast.error("No se encontró el presupuesto");
          router.push("/dashboard/budgets");
          return;
        }

        setSelectedClientId(existingBudget.client_id || "");
        setSelectedProjectId(existingBudget.project_id || "");
        setTitle(existingBudget.title || "");
        setClientName(existingBudget.client_name || "");
        setClientEmail(existingBudget.client_email || "");
        setClientPhone(existingBudget.client_phone || "");
        setClientAddress(existingBudget.client_address || "");
        setServiceType(existingBudget.service_type || "general");
        setValidUntil(existingBudget.valid_until?.slice(0, 10) || "");
        setIvaPercent(Number(existingBudget.iva_percent ?? 21));
        setNotes(existingBudget.notes || "");
        const loadedDeposit = Number(existingBudget.deposit_percent ?? 30);
        setDepositPercent(loadedDeposit);
        setPaymentMethod(existingBudget.payment_method || "Transferencia bancaria");
        setPaymentIban(existingBudget.payment_iban || settingsIban || "");
        setDiscountType(existingBudget.discount_type === "amount" ? "amount" : "percent");
        setDiscountPercent(Number(existingBudget.discount_percent ?? 0));
        setDiscountAmount(Number(existingBudget.discount_amount ?? 0));
        const loadedSchedule = Array.isArray(existingBudget.payment_schedule) ? existingBudget.payment_schedule : [];
        setPaymentSchedule(
          loadedSchedule.length > 0
            ? loadedSchedule.map((phase: { percent?: number; concept?: string; moment?: string }) => ({
                percent: Number(phase.percent ?? 0),
                concept: phase.concept || "",
                moment: phase.moment || "",
              }))
            : defaultPaymentSchedule(loadedDeposit)
        );
        setWarrantyText(existingBudget.warranty_text || "");
        setExecutionDeadlineText(existingBudget.execution_deadline_text || "");
        setObservations(existingBudget.observations || "");
        setConditionsText(existingBudget.conditions_text || "");
        setPartidas(
          existingItems?.length
            ? existingItems.map((item) => ({
                concept: item.concept || "",
                description: item.description || "",
                quantity: Number(item.quantity || 0),
                unit: item.unit || "ud",
                category: item.category || "material",
                unit_price: Number(item.unit_price || 0),
                subtotal:
                  Number(item.quantity || 0) * Number(item.unit_price || 0),
              }))
            : [emptyPartida()]
        );
        setLoadingExisting(false);
      }
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

  function addPaymentPhase() {
    setPaymentSchedule([...paymentSchedule, { percent: 0, concept: "", moment: "" }]);
  }

  function removePaymentPhase(index: number) {
    setPaymentSchedule(paymentSchedule.filter((_, i) => i !== index));
  }

  function updatePaymentPhase(index: number, field: keyof PaymentPhase, value: string | number) {
    const updated = [...paymentSchedule];
    updated[index] = { ...updated[index], [field]: value };
    setPaymentSchedule(updated);
  }

  const paymentPhasesTotal = paymentSchedule.reduce((sum, phase) => sum + (Number(phase.percent) || 0), 0);

  const subtotal = partidas.reduce((sum, p) => sum + p.subtotal, 0);
  const discountValue =
    discountType === "amount"
      ? Math.min(subtotal, Math.max(0, discountAmount))
      : Math.round(subtotal * (Math.max(0, Math.min(100, discountPercent)) / 100) * 100) / 100;
  const taxableBase = Math.max(0, subtotal - discountValue);
  const ivaAmount = taxableBase * (ivaPercent / 100);
  const total = taxableBase + ivaAmount;

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

    if (editBudgetId) {
      const { data: updatedBudget, error: updateError } = await supabase.rpc(
        "update_budget_with_items",
        {
          p_budget_id: editBudgetId,
          p_budget_data: {
            client_id: selectedClientId || null,
            project_id: selectedProjectId || null,
            title,
            client_name: clientName || selectedClient?.name || "",
            client_email: clientEmail,
            client_phone: clientPhone,
            client_address: clientAddress,
            service_type: serviceType,
            iva_percent: ivaPercent,
            notes,
            valid_until: validUntil || null,
            deposit_percent: depositPercent,
            payment_method: paymentMethod,
            payment_iban: paymentIban,
            discount_type: discountType,
            discount_percent: discountPercent,
            discount_amount: discountAmount,
            payment_schedule: paymentSchedule,
            warranty_text: warrantyText,
            execution_deadline_text: executionDeadlineText,
            observations,
            conditions_text: conditionsText,
          },
          p_items: partidas,
        }
      );

      if (updateError || !updatedBudget) {
        toast.error("No se pudieron guardar los cambios", {
          description: updateError?.message || "Error desconocido",
        });
        setSaving(false);
        return;
      }

      saveDocumentVersion(supabase, {
        entity_type: "budget",
        entity_id: editBudgetId,
        version: Number(updatedBudget.version || 1),
        snapshot: {
          ...updatedBudget,
          items: partidas,
        } as Record<string, unknown>,
        change_summary: "Presupuesto editado manualmente",
      });
      toast.success("Presupuesto actualizado");
      router.push(`/dashboard/budgets/${editBudgetId}`);
      return;
    }

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
        deposit_percent: depositPercent,
        payment_method: paymentMethod,
        payment_iban: paymentIban,
        discount_type: discountType,
        discount_percent: discountPercent,
        discount_amount: discountValue,
        payment_schedule: paymentSchedule,
        warranty_text: warrantyText,
        execution_deadline_text: executionDeadlineText,
        observations,
        conditions_text: conditionsText,
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

    analytics.budgetCreated("manual", serviceType);
    router.push("/dashboard/budgets/" + budget.id);
  }

  if (loadingExisting) {
    return (
      <div className="mx-auto max-w-4xl py-16 text-center text-sm text-navy-500 dark:text-zinc-400">
        Cargando presupuesto...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/dashboard/budgets"
        className="text-sm text-navy-500 hover:text-brand-green mb-3 inline-block dark:text-zinc-400"
      >
        ← Volver a presupuestos
      </Link>
      <PageHeader title={editBudgetId ? "Editar presupuesto" : "Nuevo presupuesto"} />

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
                    <ConceptAutocomplete
                      value={p.concept}
                      onChange={(val) => updatePartida(i, "concept", val)}
                      onSelect={(product) => {
                        updatePartida(i, "concept", product.name);
                        updatePartida(i, "unit", product.unit);
                        updatePartida(i, "unit_price", product.price);
                        updatePartida(i, "subtotal", partidas[i].quantity * product.price);
                        if (product.brand) {
                          updatePartida(i, "description", `${product.brand} — ${product.provider_name}`);
                        } else {
                          updatePartida(i, "description", product.provider_name);
                        }
                      }}
                      placeholder="Buscar en banco de precios o escribir concepto *"
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

        {/* Condiciones del presupuesto */}
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
            Condiciones del presupuesto
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Validez del presupuesto</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Anticipo (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={depositPercent}
                onChange={(e) => setDepositPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                className={inputCls}
              />
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>Descuento</label>
              <div className="flex gap-2">
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value === "amount" ? "amount" : "percent")}
                  className={inputCls}
                  style={{ maxWidth: 90 }}
                >
                  <option value="percent">%</option>
                  <option value="amount">€</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountType === "percent" ? discountPercent : discountAmount}
                  onChange={(e) => {
                    const v = Math.max(0, parseFloat(e.target.value) || 0);
                    if (discountType === "percent") setDiscountPercent(Math.min(100, v));
                    else setDiscountAmount(v);
                  }}
                  placeholder={discountType === "percent" ? "0" : "0.00"}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>Forma de pago</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {paymentMethodQuickOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPaymentMethod(opt)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      paymentMethod === opt
                        ? "bg-brand-green text-navy-900 border-brand-green"
                        : "bg-white text-navy-600 border-navy-200 hover:border-brand-green dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder="Ej: 50% al aceptar, 50% a la finalización"
                className={inputCls}
              />
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>IBAN</label>
              <input
                type="text"
                value={paymentIban}
                onChange={(e) => setPaymentIban(e.target.value)}
                placeholder="ES00 0000 0000 0000 0000 0000"
                className={inputCls}
              />
              {fiscalIban && paymentIban.trim() !== fiscalIban.trim() && (
                <p className="text-xs text-navy-400 mt-1 dark:text-zinc-500">
                  IBAN por defecto en Ajustes → Empresa: {fiscalIban}.{" "}
                  <button type="button" onClick={() => setPaymentIban(fiscalIban)} className="text-brand-green hover:underline">
                    Usar este
                  </button>
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls} style={{ marginBottom: 0 }}>Fases de pago</label>
                <button type="button" onClick={addPaymentPhase} className="text-xs text-brand-green hover:underline font-medium">
                  + Añadir fase
                </button>
              </div>
              <div className="space-y-2">
                {paymentSchedule.map((phase, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={phase.percent}
                      onChange={(e) => updatePaymentPhase(i, "percent", Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                      placeholder="%"
                      className={inputSmCls}
                    />
                    <input
                      type="text"
                      value={phase.concept}
                      onChange={(e) => updatePaymentPhase(i, "concept", e.target.value)}
                      placeholder="Concepto (ej: Anticipo)"
                      className={inputSmCls}
                    />
                    <input
                      type="text"
                      value={phase.moment}
                      onChange={(e) => updatePaymentPhase(i, "moment", e.target.value)}
                      placeholder="Momento (ej: Al aceptar / al inicio / a la entrega)"
                      className={inputSmCls}
                    />
                    {paymentSchedule.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePaymentPhase(i)}
                        className="text-red-600 hover:text-red-700 text-sm dark:text-red-400 dark:hover:text-red-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {paymentSchedule.length === 0 && (
                  <p className="text-xs text-navy-400 dark:text-zinc-500">Sin fases definidas. Se usará el anticipo/resto por defecto.</p>
                )}
              </div>
              {paymentSchedule.length > 0 && paymentPhasesTotal !== 100 && (
                <p className="text-xs text-amber-600 mt-1 dark:text-amber-400">
                  Las fases suman {paymentPhasesTotal}% (no es obligatorio que sumen 100%).
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>Plazo de ejecución</label>
              <textarea
                value={executionDeadlineText}
                onChange={(e) => setExecutionDeadlineText(e.target.value)}
                rows={2}
                placeholder="Ej: 15 días laborables desde el inicio de la obra"
                className={`${inputCls} resize-none`}
              />
            </div>
            <div>
              <label className={labelCls}>Garantía</label>
              <textarea
                value={warrantyText}
                onChange={(e) => setWarrantyText(e.target.value)}
                rows={2}
                placeholder="Ej: 2 años de garantía en mano de obra y materiales"
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Condiciones</label>
              <textarea
                value={conditionsText}
                onChange={(e) => setConditionsText(e.target.value)}
                rows={3}
                placeholder="Condiciones legales/comerciales del presupuesto..."
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Observaciones</label>
              <textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                rows={2}
                placeholder="Observaciones adicionales para el cliente..."
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>
        </Card>

        {/* Notas */}
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Notas internas</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notas adicionales (visibles en el presupuesto)..."
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
            {discountValue > 0 && (
              <>
                <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                  <span>Descuento{discountType === "percent" ? ` (${discountPercent}%)` : ""}</span>
                  <span className="font-medium">-{discountValue.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-sm text-navy-600 dark:text-zinc-400">
                  <span>Base imponible</span>
                  <span className="text-navy-900 dark:text-white font-medium">{taxableBase.toFixed(2)} €</span>
                </div>
              </>
            )}
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
            {saving
              ? "Guardando..."
              : editBudgetId
                ? "Guardar cambios"
                : "Guardar presupuesto"}
          </button>
          <Link
            href={
              editBudgetId
                ? `/dashboard/budgets/${editBudgetId}`
                : "/dashboard/budgets"
            }
            className="px-6 py-3 bg-white text-navy-700 border border-navy-200 rounded-xl hover:bg-navy-50 transition text-center dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}

// ─── Autocomplete component ──────────────────────────────────────────────

function ConceptAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  onSelect: (product: PBSearchResult) => void;
  placeholder?: string;
  className?: string;
}) {
  const { search, results, loading, clear } = useProductSearch();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          search(e.target.value);
          setOpen(true);
        }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-navy-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left px-4 py-2.5 hover:bg-brand-green/10 dark:hover:bg-brand-green/10 transition border-b border-navy-100 dark:border-zinc-800 last:border-b-0"
              onClick={() => {
                onSelect(r);
                clear();
                setOpen(false);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900 dark:text-white truncate">
                    {r.name}
                  </p>
                  <p className="text-xs text-navy-500 dark:text-zinc-400">
                    {r.provider_name}{r.brand ? ` · ${r.brand}` : ""} · {r.unit}
                  </p>
                </div>
                <span className="text-sm font-bold text-brand-green whitespace-nowrap">
                  {r.price.toFixed(2)} €
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
