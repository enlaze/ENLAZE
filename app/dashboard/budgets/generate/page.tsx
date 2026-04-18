/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";
import { normalizeSector } from "@/lib/sector-config";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";

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

const fallbackServiceTypesBySector: Record<string, { value: string; label: string }[]> = {
  construccion: [
    { value: "reforma", label: "Reforma integral" },
    { value: "fontaneria", label: "Fontaneria" },
    { value: "electricidad", label: "Electricidad" },
    { value: "climatizacion", label: "Climatizacion" },
    { value: "multiservicios", label: "Multiservicios" },
    { value: "general", label: "General" },
  ],
  comercio_local: [
    { value: "venta", label: "Venta de productos" },
    { value: "servicio", label: "Servicio al cliente" },
    { value: "marketing", label: "Marketing y publicidad" },
    { value: "logistica", label: "Logistica y transporte" },
    { value: "general", label: "General" },
  ],
};

const fallbackCategoryLabels: Record<string, string> = { material: "Material", mano_obra: "Mano de obra", otros: "Otros", producto: "Producto", personal: "Personal", marketing: "Marketing", local: "Local/Espacio", servicio: "Servicio" };

const unitLabel: Record<string, string> = { ud: "ud", m2: "m2", ml: "ml", h: "h", kg: "kg", global: "global", m3: "m3", l: "l" };

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none text-sm dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const labelCls = "block text-xs font-medium text-navy-500 dark:text-zinc-400 mb-1";

export default function GenerateBudgetPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { serviceTypes, budgetCategories, sectorKey } = useSector();
  const normalizedSector = normalizeSector(sectorKey);
  const fallbackServiceTypes = fallbackServiceTypesBySector[normalizedSector] || fallbackServiceTypesBySector.construccion;

  const [userId, setUserId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [serviceType, setServiceType] = useState("");
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

  useEffect(() => {
    const sTypes = serviceTypes();
    const activeTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes;
    if (!serviceType || !activeTypes.some(s => s.value === serviceType)) {
      setServiceType(activeTypes[0]?.value || "general");
    }
  }, [sectorKey]);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      <Link
        href="/dashboard/budgets"
        className="text-sm text-navy-500 hover:text-brand-green mb-3 inline-block dark:text-zinc-400"
      >
        ← Volver a presupuestos
      </Link>
      <PageHeader
        title="Generador IA de presupuestos"
        description="Describe el trabajo y el agente IA generará el presupuesto completo automáticamente."
      />

      {/* Input Section */}
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Describe el trabajo
        </h2>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder={
            normalizedSector === "comercio_local"
              ? "Ej: Propuesta de aprovisionamiento de 50 camisetas básicas, etiquetado personalizado, packaging y envío a tienda..."
              : "Ej: Reforma de baño de 4m² con plato de ducha, alicatado completo, cambio de inodoro y lavabo, instalación eléctrica nueva con 3 puntos de luz LED..."
          }
          className={`${inputCls} resize-none`}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
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
              <option value={0}>0%</option><option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Válido hasta</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={labelCls}>Cliente asociado (opcional)</label>
            <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className={inputCls}>
              <option value="">Sin asignar</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Obra asociada (opcional)</label>
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className={inputCls}>
              <option value="">Sin asignar</option>
              {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="mt-4 w-full bg-brand-green text-navy-900 font-bold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50 text-sm"
        >
          {generating ? "El agente IA está generando el presupuesto..." : "Generar presupuesto con IA"}
        </button>
      </Card>

      {/* Client Data (collapsible) */}
      <details className="rounded-2xl border border-navy-100 bg-white shadow-sm p-5 mb-6 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <summary className="text-sm font-semibold text-brand-green uppercase tracking-wider cursor-pointer">
          Datos del cliente (opcional)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={labelCls}>Nombre</label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre del cliente" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@cliente.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="600 000 000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Dirección</label>
            <input type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Dirección de la obra" className={inputCls} />
          </div>
        </div>
      </details>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {generating && (
        <Card className="text-center mb-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-green mx-auto mb-4"></div>
          <p className="text-navy-900 dark:text-white font-medium">
            El agente IA está analizando el trabajo...
          </p>
          <p className="text-navy-500 dark:text-zinc-400 text-sm mt-1">
            Desglosando partidas, calculando cantidades y asignando precios
          </p>
        </Card>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Tu coste" value={`${result.total_cost.toFixed(2)} €`} />
            <StatCard label="Precio cliente" value={`${result.total_client.toFixed(2)} €`} accent="green" />
            <StatCard label="Tu beneficio" value={`+${result.profit.toFixed(2)} €`} accent="green" />
            <StatCard label="Margen aplicado" value={`${result.margin_percent}%`} accent="yellow" />
          </div>

          {/* Title */}
          <Card className="mb-6">
            <h2 className="text-lg font-bold text-navy-900 dark:text-white">{result.title}</h2>
            <p className="text-sm text-navy-500 dark:text-zinc-400 mt-1">{result.partidas.length} partidas generadas</p>
          </Card>

          {/* Partidas Table */}
          <Card padding={false} className="mb-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-navy-100 dark:bg-zinc-800/50 dark:border-zinc-800">
                  <tr>
                    <th className="text-left text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-4 py-3">#</th>
                    <th className="text-left text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-4 py-3">Concepto</th>
                    <th className="text-center text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-3 py-3">Cat.</th>
                    <th className="text-center text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-3 py-3">Cant.</th>
                    <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-3 py-3">Coste ud.</th>
                    <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-3 py-3">Precio cl.</th>
                    <th className="text-right text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase px-4 py-3">Total cl.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.partidas.map((p, i) => (
                    <tr
                      key={i}
                      className="border-t border-navy-100 hover:bg-gray-50 transition dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                    >
                      <td className="px-4 py-3 text-sm text-navy-500 dark:text-zinc-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-navy-900 dark:text-white">{p.concept}</p>
                        {p.description && <p className="text-xs text-navy-500 dark:text-zinc-400">{p.description}</p>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={
                          "text-xs px-2 py-1 rounded-full border " +
                          (p.category === "material" || p.category === "producto"
                            ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900"
                            : p.category === "mano_obra" || p.category === "servicio" || p.category === "personal"
                            ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900"
                            : "bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700")
                        }>
                          {(() => {
                            const cats = budgetCategories();
                            const catMap = Object.fromEntries(cats.map(c => [c.value, c.label]));
                            return (catMap[p.category] || fallbackCategoryLabels[p.category] || p.category);
                          })()}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm text-navy-800 dark:text-zinc-200">
                        {p.quantity} {unitLabel[p.unit] || p.unit}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-navy-500 dark:text-zinc-400">{p.unit_price.toFixed(2)}</td>
                      <td className="px-3 py-3 text-right text-sm text-navy-800 dark:text-zinc-200">{p.unit_price_client.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-navy-900 dark:text-white">
                        {p.subtotal_client.toFixed(2)} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Notes */}
          {result.notes && (
            <Card className="mb-6">
              <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-2">
                Notas del agente
              </h3>
              <p className="text-sm text-navy-700 dark:text-zinc-300">{result.notes}</p>
            </Card>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-3 bg-brand-green text-navy-900 rounded-xl font-bold hover:opacity-90 transition disabled:opacity-50 text-sm"
            >
              {saving ? "Guardando..." : "Guardar presupuesto"}
            </button>
            <button
              onClick={() => generatePDF("client")}
              className="px-4 py-3 bg-white text-navy-800 border border-navy-200 rounded-xl font-medium hover:bg-gray-50 transition text-sm dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              PDF Cliente
            </button>
            <button
              onClick={() => generatePDF("internal")}
              className="px-4 py-3 bg-white text-navy-800 border border-navy-200 rounded-xl font-medium hover:bg-gray-50 transition text-sm dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              PDF Interno
            </button>
            <button
              onClick={() => { setResult(null); setDescription(""); }}
              className="px-4 py-3 bg-white text-navy-700 border border-navy-200 rounded-xl font-medium hover:bg-gray-50 transition text-sm dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Nuevo presupuesto
            </button>
          </div>
        </>
      )}
    </div>
  );
}
