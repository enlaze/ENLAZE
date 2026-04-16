/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

interface Partida {
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  unit_price: number;
  subtotal_cost: number;
  unit_price_client: number;
  subtotal_client: number;
}

interface GeneratedBudget {
  title: string;
  partidas: Partida[];
  notes: string;
  margin_percent: number;
  total_cost: number;
  total_client: number;
  profit: number;
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

const fallbackServiceTypes = [
  { value: "reforma", label: "Reforma integral" },
  { value: "fontaneria", label: "Fontaneria" },
  { value: "electricidad", label: "Electricidad" },
  { value: "climatizacion", label: "Climatizacion" },
  { value: "multiservicios", label: "Multiservicios" },
  { value: "general", label: "General" },
];

const fallbackCategoryLabels: Record<string, string> = { material: "Material", mano_obra: "Mano de obra", otros: "Otros" };

const unitLabel: Record<string, string> = { ud: "ud", m2: "m2", ml: "ml", h: "h", kg: "kg", global: "global", m3: "m3", l: "l" };

export default function GenerateBudgetPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { serviceTypes, budgetCategories } = useSector();

  const [userId, setUserId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [serviceType, setServiceType] = useState("reforma");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [ivaPercent, setIvaPercent] = useState(21);
  const [validUntil, setValidUntil] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<GeneratedBudget | null>(null);
  const [error, setError] = useState("");

  const visibleProjects = selectedClientId
    ? projects.filter((project) => project.client_id === selectedClientId)
    : projects;

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

  // Validate that the selected project belongs to the selected client
  useEffect(() => {
    const isProjectInvalid =
      selectedClientId &&
      selectedProjectId &&
      !projects.some((project) => project.id === selectedProjectId && project.client_id === selectedClientId);

    if (isProjectInvalid) {
      setSelectedProjectId("");
    }
  }, [selectedClientId, selectedProjectId, projects]);

  async function handleGenerate() {
    if (!description.trim()) { setError("Escribe una descripcion del trabajo."); return; }
    setError("");
    setGenerating(true);
    setResult(null);

    try {
      const res = await fetch("/api/generate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, serviceType, userId }),
      });

      const data = await res.json();
      if (data.error) { setError(data.error); setGenerating(false); return; }
      setResult(data);
    } catch (err: any) {
      setError("Error de conexion: " + err.message);
    }
    setGenerating(false);
  }

  async function handleSave() {
    if (!result) return;
    if (!userId) {
      setError("No se pudo identificar el usuario.");
      return;
    }
    setSaving(true);

    const selectedClient = clients.find((client) => client.id === selectedClientId);

    const year = new Date().getFullYear();
    const randArray = new Uint32Array(1);
    crypto.getRandomValues(randArray);
    const rand = 10000 + (randArray[0] % 90000);
    const budgetNumber = "PRE-" + year + "-" + rand;

    const ivaClient = result.total_client * (ivaPercent / 100);

    const { data: budget, error: budgetErr } = await supabase
      .from("budgets")
      .insert({
        user_id: userId,
        client_id: selectedClientId || null,
        project_id: selectedProjectId || null,
        budget_number: budgetNumber,
        title: result.title,
        client_name: clientName || selectedClient?.name || "",
        client_email: clientEmail,
        client_phone: clientPhone,
        client_address: clientAddress,
        service_type: serviceType,
        status: "pendiente",
        subtotal: result.total_client,
        iva_percent: ivaPercent,
        iva_amount: ivaClient,
        total: result.total_client + ivaClient,
        notes: result.notes,
        valid_until: validUntil || null,
      })
      .select()
      .single();

    if (budgetErr || !budget) {
      setError("Error al guardar: " + (budgetErr?.message || ""));
      setSaving(false);
      return;
    }

    for (const p of result.partidas) {
      await supabase.from("budget_items").insert({
        budget_id: budget.id,
        concept: p.concept,
        description: p.description,
        quantity: p.quantity,
        unit: p.unit,
        category: p.category,
        unit_price: p.unit_price_client,
        subtotal: p.subtotal_client,
      });
    }

    setSaving(false);
    window.location.href = "/dashboard/budgets/" + budget.id;
  }

  function generatePDF(version: "internal" | "client") {
    if (!result) return;
    const isClient = version === "client";
    const partidas = result.partidas;
    const subtotal = isClient ? result.total_client : result.total_cost;
    const iva = subtotal * (ivaPercent / 100);
    const total = subtotal + iva;

    const cats = budgetCategories();
    const catMap = Object.fromEntries(cats.map(c => [c.value, c.label]));
    const rows = partidas.map((p, i) => {
      const price = isClient ? p.unit_price_client : p.unit_price;
      const sub = isClient ? p.subtotal_client : p.subtotal_cost;
      return '<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 6px;font-size:13px;">' + (i + 1) + '</td><td style="padding:8px 6px;font-size:13px;"><strong>' + p.concept + '</strong>' + (p.description ? '<br/><span style="color:#6b7280;font-size:12px;">' + p.description + '</span>' : '') + '</td><td style="padding:8px 6px;font-size:13px;text-align:center;">' + (catMap[p.category] || fallbackCategoryLabels[p.category] || p.category) + '</td><td style="padding:8px 6px;font-size:13px;text-align:center;">' + p.quantity + ' ' + (unitLabel[p.unit] || p.unit) + '</td><td style="padding:8px 6px;font-size:13px;text-align:right;">' + price.toFixed(2) + ' EUR</td><td style="padding:8px 6px;font-size:13px;text-align:right;font-weight:600;">' + sub.toFixed(2) + ' EUR</td></tr>';
    }).join("");

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Presupuesto</title><style>@page{size:A4;margin:20mm;}body{font-family:Helvetica Neue,Arial,sans-serif;color:#1e293b;margin:0;padding:0;}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;border-bottom:3px solid #00c896;padding-bottom:20px;}.logo{font-size:28px;font-weight:800;color:#0a1628;}.logo span{color:#00c896;}table{width:100%;border-collapse:collapse;}th{background:#0a1628;color:white;padding:10px 6px;font-size:12px;text-transform:uppercase;}.totals-box{background:#f8fafc;border-radius:8px;padding:16px 24px;float:right;min-width:280px;margin-top:20px;}.total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px;}.total-final{font-size:20px;font-weight:800;color:#00c896;border-top:2px solid #e2e8f0;margin-top:8px;padding-top:8px;}.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;}.footer{margin-top:40px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;clear:both;}</style></head><body><div class="header"><div><div class="logo">enl<span>a</span>ze</div><div style="font-size:12px;color:#64748b;margin-top:4px;">' + (isClient ? 'Presupuesto' : 'Presupuesto INTERNO (coste real)') + '</div></div><div style="text-align:right;font-size:13px;color:#64748b;"><div style="font-size:16px;font-weight:700;color:#0a1628;">Fecha: ' + new Date().toLocaleDateString("es-ES") + '</div>' + (validUntil ? '<div>Valido hasta: ' + new Date(validUntil).toLocaleDateString("es-ES") + '</div>' : '') + (!isClient ? '<div style="margin-top:6px;"><span class="badge" style="background:#fef3c7;color:#92400e;">DOCUMENTO INTERNO - NO ENVIAR AL CLIENTE</span></div>' : '') + '</div></div>' + (clientName ? '<div style="margin-bottom:20px;background:#f8fafc;border-radius:8px;padding:16px;font-size:13px;"><strong>' + clientName + '</strong>' + (clientEmail ? '<br/>Email: ' + clientEmail : '') + (clientPhone ? '<br/>Tel: ' + clientPhone : '') + (clientAddress ? '<br/>Dir: ' + clientAddress : '') + '</div>' : '') + '<div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">' + result.title + '</div><table><thead><tr><th style="text-align:left;">#</th><th style="text-align:left;">Concepto</th><th style="text-align:center;">Cat.</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Precio ud.</th><th style="text-align:right;">Importe</th></tr></thead><tbody>' + rows + '</tbody></table><div class="totals-box"><div class="total-row"><span>Subtotal</span><span>' + subtotal.toFixed(2) + ' EUR</span></div><div class="total-row"><span>IVA (' + ivaPercent + '%)</span><span>' + iva.toFixed(2) + ' EUR</span></div><div class="total-row total-final"><span>TOTAL</span><span>' + total.toFixed(2) + ' EUR</span></div>' + (!isClient ? '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0;"><div class="total-row" style="color:#10b981;"><span>Margen (' + result.margin_percent + '%)</span><span>+' + result.profit.toFixed(2) + ' EUR</span></div><div class="total-row" style="font-weight:700;"><span>Precio cliente</span><span>' + (result.total_client + result.total_client * ivaPercent / 100).toFixed(2) + ' EUR</span></div></div>' : '') + '</div>' + (result.notes ? '<div style="clear:both;padding-top:24px;"><div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notas</div><div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#92400e;">' + result.notes + '</div></div>' : '') + '<div class="footer">Presupuesto generado con <strong>Enlaze</strong> &middot; enlaze.es' + (!isClient ? '<br/><strong style="color:#ef4444;">COPIA INTERNA - CONFIDENCIAL</strong>' : '<br/>Este presupuesto tiene validez contractual una vez aceptado por ambas partes.') + '</div></body></html>';

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/budgets" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block">
          ← Volver a presupuestos
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Generador IA de presupuestos</h1>
        <p className="text-[var(--color-navy-400)] text-sm mt-1">Describe el trabajo y el agente IA generara el presupuesto completo automaticamente</p>
      </div>

      {/* Input Section */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Describe el trabajo</h2>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Ej: Reforma de bano de 4m2 con plato de ducha, alicatado completo, cambio de inodoro y lavabo, instalacion electrica nueva con 3 puntos de luz LED..."
          className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-3 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none resize-none text-sm"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Tipo de servicio</label>
            <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
              {(() => { const sTypes = serviceTypes(); const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes; return activeServiceTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>); })()}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">IVA</label>
            <select value={ivaPercent} onChange={(e) => setIvaPercent(Number(e.target.value))} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
              <option value={0}>0%</option><option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Valido hasta</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Cliente asociado (opcional)</label>
            <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
              <option value="">Sin asignar</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Obra asociada (opcional)</label>
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2.5 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm">
              <option value="">Sin asignar</option>
              {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        </div>

        <button onClick={handleGenerate} disabled={generating} className="mt-4 w-full bg-[var(--color-brand-green)] text-[var(--color-navy-900)] font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50 text-sm">
          {generating ? "El agente IA esta generando el presupuesto..." : "Generar presupuesto con IA"}
        </button>
      </div>

      {/* Client Data (collapsible) */}
      <details className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
        <summary className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider cursor-pointer">Datos del cliente (opcional)</summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div><label className="block text-xs text-[var(--color-navy-400)] mb-1">Nombre</label><input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre del cliente" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" /></div>
          <div><label className="block text-xs text-[var(--color-navy-400)] mb-1">Email</label><input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@cliente.com" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" /></div>
          <div><label className="block text-xs text-[var(--color-navy-400)] mb-1">Telefono</label><input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="600 000 000" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" /></div>
          <div><label className="block text-xs text-[var(--color-navy-400)] mb-1">Direccion</label><input type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Direccion de la obra" className="w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm" /></div>
        </div>
      </details>

      {/* Error */}
      {error && <div className="bg-red-900/20 border border-red-700 text-red-300 rounded-xl p-4 mb-6 text-sm">{error}</div>}

      {/* Loading */}
      {generating && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-10 text-center mb-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--color-brand-green)] mx-auto mb-4"></div>
          <p className="text-[var(--color-navy-200)] font-medium">El agente IA esta analizando el trabajo...</p>
          <p className="text-[var(--color-navy-400)] text-sm mt-1">Desglosando partidas, calculando cantidades y asignando precios</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
              <p className="text-xs text-[var(--color-navy-400)]">Tu coste</p>
              <p className="text-xl font-bold text-[var(--color-navy-100)]">{result.total_cost.toFixed(2)} EUR</p>
            </div>
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
              <p className="text-xs text-[var(--color-navy-400)]">Precio cliente</p>
              <p className="text-xl font-bold text-[var(--color-brand-green)]">{result.total_client.toFixed(2)} EUR</p>
            </div>
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
              <p className="text-xs text-[var(--color-navy-400)]">Tu beneficio</p>
              <p className="text-xl font-bold text-green-400">+{result.profit.toFixed(2)} EUR</p>
            </div>
            <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
              <p className="text-xs text-[var(--color-navy-400)]">Margen aplicado</p>
              <p className="text-xl font-bold text-orange-400">{result.margin_percent}%</p>
            </div>
          </div>

          {/* Title */}
          <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
            <h2 className="text-lg font-bold text-[var(--color-navy-50)]">{result.title}</h2>
            <p className="text-sm text-[var(--color-navy-400)] mt-1">{result.partidas.length} partidas generadas</p>
          </div>

          {/* Partidas Table */}
          <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-navy-700)]">
                    <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase px-4 py-3">#</th>
                    <th className="text-left text-xs font-semibold text-[var(--color-navy-400)] uppercase px-4 py-3">Concepto</th>
                    <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Cat.</th>
                    <th className="text-center text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Cant.</th>
                    <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Coste ud.</th>
                    <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-3 py-3">Precio cl.</th>
                    <th className="text-right text-xs font-semibold text-[var(--color-navy-400)] uppercase px-4 py-3">Total cl.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.partidas.map((p, i) => (
                    <tr key={i} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                      <td className="px-4 py-3 text-sm text-[var(--color-navy-400)]">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-[var(--color-navy-100)]">{p.concept}</p>
                        {p.description && <p className="text-xs text-[var(--color-navy-400)]">{p.description}</p>}
                      </td>
                      <td className="px-3 py-3 text-center"><span className={"text-xs px-2 py-1 rounded-full " + (p.category === "material" ? "bg-blue-900/30 text-blue-300" : p.category === "mano_obra" ? "bg-orange-900/30 text-orange-300" : "bg-zinc-900/30 text-zinc-300 dark:bg-zinc-900/50 dark:text-zinc-400")}>{(() => { const cats = budgetCategories(); const catMap = Object.fromEntries(cats.map(c => [c.value, c.label])); return (catMap[p.category] || fallbackCategoryLabels[p.category] || p.category); })()}</span></td>
                      <td className="px-3 py-3 text-center text-sm text-[var(--color-navy-200)]">{p.quantity} {unitLabel[p.unit] || p.unit}</td>
                      <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-400)]">{p.unit_price.toFixed(2)}</td>
                      <td className="px-3 py-3 text-right text-sm text-[var(--color-navy-200)]">{p.unit_price_client.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{p.subtotal_client.toFixed(2)} EUR</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          {result.notes && (
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-2">Notas del agente</h3>
              <p className="text-sm text-[var(--color-navy-300)]">{result.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
            <button onClick={handleSave} disabled={saving} className="px-4 py-3 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-xl font-bold hover:opacity-90 transition disabled:opacity-50 text-sm">
              {saving ? "Guardando..." : "Guardar presupuesto"}
            </button>
            <button onClick={() => generatePDF("client")} className="px-4 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-100)] rounded-xl font-medium hover:bg-[var(--color-navy-600)] transition text-sm">
              PDF Cliente
            </button>
            <button onClick={() => generatePDF("internal")} className="px-4 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-100)] rounded-xl font-medium hover:bg-[var(--color-navy-600)] transition text-sm">
              PDF Interno
            </button>
            <button onClick={() => { setResult(null); setDescription(""); }} className="px-4 py-3 bg-[var(--color-navy-700)] text-[var(--color-navy-300)] rounded-xl font-medium hover:bg-[var(--color-navy-600)] transition text-sm">
              Nuevo presupuesto
            </button>
          </div>
        </>
      )}
    </div>
  );
}
