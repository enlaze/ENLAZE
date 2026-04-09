"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useSector } from "@/lib/sector-context";

interface BudgetItem {
  id: string;
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  unit_price: number;
  subtotal: number;
}

interface Budget {
  id: string;
  budget_number: string;
  title: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  service_type: string;
  status: string;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes: string;
  valid_until: string;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "text-yellow-700", bg: "bg-yellow-100" },
  enviado: { label: "Enviado", color: "text-blue-700", bg: "bg-blue-100" },
  aceptado: { label: "Aceptado", color: "text-green-700", bg: "bg-green-100" },
  rechazado: { label: "Rechazado", color: "text-red-700", bg: "bg-red-100" },
};

const fallbackServiceLabels: Record<string, string> = {
  reforma: "Reforma integral",
  fontaneria: "Fontanería",
  electricidad: "Electricidad",
  climatizacion: "Climatización",
  multiservicios: "Multiservicios",
  general: "General",
};

const fallbackCategoryLabels: Record<string, string> = {
  material: "Material",
  mano_obra: "Mano de obra",
  otros: "Otros",
};

const unitLabels: Record<string, string> = {
  ud: "ud",
  m2: "m²",
  ml: "ml",
  h: "h",
  kg: "kg",
  global: "global",
};

export default function BudgetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { serviceTypes, budgetCategories } = useSector();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadBudget();
  }, []);

  async function loadBudget() {
    try {
      const { data: b, error: bErr } = await supabase
        .from("budgets")
        .select("*")
        .eq("id", params.id)
        .single();

      if (bErr || !b) {
        router.push("/dashboard/budgets");
        return;
      }

      const { data: bi } = await supabase
        .from("budget_items")
        .select("*")
        .eq("budget_id", params.id)
        .order("created_at", { ascending: true });

      setBudget(b);
      setItems(bi || []);
    } catch {
      router.push("/dashboard/budgets");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(newStatus: string) {
    if (!budget) return;
    setUpdating(true);
    const { error } = await supabase
      .from("budgets")
      .update({ status: newStatus })
      .eq("id", budget.id);

    if (!error) {
      setBudget({ ...budget, status: newStatus });
    }
    setUpdating(false);
  }

  async function deleteBudget() {
    if (!budget) return;
    if (!confirm("¿Estás seguro de eliminar este presupuesto? Esta acción no se puede deshacer.")) return;

    await supabase.from("budget_items").delete().eq("budget_id", budget.id);
    await supabase.from("budgets").delete().eq("id", budget.id);
    router.push("/dashboard/budgets");
  }

  async function duplicateBudget() {
    if (!budget) return;
    const year = new Date().getFullYear();
    const rand = Math.floor(10000 + Math.random() * 90000);
    const newNumber = `PRE-${year}-${rand}`;

    const { data: newB, error } = await supabase
      .from("budgets")
      .insert({
        budget_number: newNumber,
        title: budget.title + " (copia)",
        client_name: budget.client_name,
        client_email: budget.client_email,
        client_phone: budget.client_phone,
        client_address: budget.client_address,
        service_type: budget.service_type,
        status: "pendiente",
        subtotal: budget.subtotal,
        iva_percent: budget.iva_percent,
        iva_amount: budget.iva_amount,
        total: budget.total,
        notes: budget.notes,
        valid_until: budget.valid_until,
      })
      .select()
      .single();

    if (error || !newB) return alert("Error al duplicar");

    for (const item of items) {
      await supabase.from("budget_items").insert({
        budget_id: newB.id,
        concept: item.concept,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      });
    }

    router.push(`/dashboard/budgets/${newB.id}`);
  }

  function generatePDF() {
    if (!budget) return;

    const itemsHTML = items
      .map(
        (item, i) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 6px;font-size:13px;">${i + 1}</td>
        <td style="padding:8px 6px;font-size:13px;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#6b7280;font-size:12px;">${item.description}</span>` : ""}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${categoryLabels[item.category] || fallbackCategoryLabels[item.category] || item.category}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${item.quantity} ${unitLabels[item.unit] || item.unit}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;">${item.unit_price.toFixed(2)} €</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;font-weight:600;">${item.subtotal.toFixed(2)} €</td>
      </tr>`
      )
      .join("");

    const sTypes = serviceTypes();
    const serviceLabels: Record<string, string> = Object.fromEntries(sTypes.map(s => [s.value, s.label]));
    const cats = budgetCategories();
    const categoryLabels: Record<string, string> = Object.fromEntries(cats.map(c => [c.value, c.label]));

    const materialItems = items.filter((i) => i.category === "material");
    const laborItems = items.filter((i) => i.category === "mano_obra");
    const otherItems = items.filter((i) => i.category === "otros");

    const materialTotal = materialItems.reduce((s, i) => s + i.subtotal, 0);
    const laborTotal = laborItems.reduce((s, i) => s + i.subtotal, 0);
    const otherTotal = otherItems.reduce((s, i) => s + i.subtotal, 0);

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>${budget.budget_number}</title>
      <style>
        @page { size: A4; margin: 20mm; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 3px solid #00c896; padding-bottom: 20px; }
        .logo { font-size: 28px; font-weight: 800; color: #0a1628; }
        .logo span { color: #00c896; }
        .budget-info { text-align: right; font-size: 13px; color: #64748b; }
        .budget-number { font-size: 18px; font-weight: 700; color: #0a1628; }
        .section { margin-bottom: 24px; }
        .section-title { font-size: 14px; font-weight: 700; color: #00c896; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .client-info { background: #f8fafc; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #0a1628; color: white; padding: 10px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .totals { margin-top: 20px; display: flex; justify-content: flex-end; }
        .totals-box { background: #f8fafc; border-radius: 8px; padding: 16px 24px; min-width: 280px; }
        .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
        .total-final { font-size: 20px; font-weight: 800; color: #00c896; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 8px; }
        .breakdown { display: flex; gap: 16px; margin-bottom: 20px; }
        .breakdown-card { flex: 1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center; }
        .breakdown-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
        .breakdown-value { font-size: 16px; font-weight: 700; color: #0a1628; }
        .notes { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #92400e; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="logo">enl<span>a</span>ze</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Presupuesto profesional</div>
        </div>
        <div class="budget-info">
          <div class="budget-number">${budget.budget_number}</div>
          <div>Fecha: ${new Date(budget.created_at).toLocaleDateString("es-ES")}</div>
          <div>Válido hasta: ${budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}</div>
          <div style="margin-top:6px;">
            <span class="badge" style="background:${statusConfig[budget.status]?.bg || "#f1f5f9"};color:${statusConfig[budget.status]?.color?.replace("text-", "#") || "#64748b"};">
              ${statusConfig[budget.status]?.label || budget.status}
            </span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Datos del cliente</div>
        <div class="client-info">
          <strong>${budget.client_name || "Sin nombre"}</strong><br/>
          ${budget.client_email ? `Email: ${budget.client_email}<br/>` : ""}
          ${budget.client_phone ? `Teléfono: ${budget.client_phone}<br/>` : ""}
          ${budget.client_address ? `Dirección: ${budget.client_address}` : ""}
        </div>
      </div>

      <div class="section">
        <div class="section-title">${budget.title} — ${serviceLabels[budget.service_type] || fallbackServiceLabels[budget.service_type] || budget.service_type}</div>
        <table>
          <thead>
            <tr>
              <th style="width:30px;text-align:left;">#</th>
              <th style="text-align:left;">Concepto</th>
              <th style="width:90px;text-align:center;">Categoría</th>
              <th style="width:80px;text-align:center;">Cantidad</th>
              <th style="width:80px;text-align:right;">Precio ud.</th>
              <th style="width:90px;text-align:right;">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
      </div>

      <div class="breakdown">
        <div class="breakdown-card">
          <div class="breakdown-label">Material</div>
          <div class="breakdown-value">${materialTotal.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card">
          <div class="breakdown-label">Mano de obra</div>
          <div class="breakdown-value">${laborTotal.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card">
          <div class="breakdown-label">Otros</div>
          <div class="breakdown-value">${otherTotal.toFixed(2)} €</div>
        </div>
      </div>

      <div class="totals">
        <div class="totals-box">
          <div class="total-row"><span>Subtotal</span><span>${budget.subtotal.toFixed(2)} €</span></div>
          <div class="total-row"><span>IVA (${budget.iva_percent}%)</span><span>${budget.iva_amount.toFixed(2)} €</span></div>
          <div class="total-row total-final"><span>TOTAL</span><span>${budget.total.toFixed(2)} €</span></div>
        </div>
      </div>

      ${budget.notes ? `<div class="section" style="margin-top:24px;"><div class="section-title">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

      <div class="footer">
        Presupuesto generado con <strong>Enlaze</strong> · enlaze.es<br/>
        Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
      </div>
    </body>
    </html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  if (!budget) return null;

  const st = statusConfig[budget.status] || statusConfig.pendiente;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <Link href="/dashboard/budgets" className="text-sm text-[var(--color-navy-400)] hover:text-[var(--color-brand-green)] mb-2 inline-block">
            ← Volver a presupuestos
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">{budget.budget_number}</h1>
          <p className="text-[var(--color-navy-400)]">{budget.title}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${st.bg} ${st.color}`}>
            {st.label}
          </span>
          <button onClick={generatePDF} className="px-4 py-2 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-lg font-medium hover:opacity-90 transition text-sm">
            📄 Generar PDF
          </button>
        </div>
      </div>

      {/* Status Actions */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-4 mb-6 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-[var(--color-navy-300)] mr-2">Cambiar estado:</span>
        {Object.entries(statusConfig).map(([key, val]) => (
          <button
            key={key}
            onClick={() => updateStatus(key)}
            disabled={updating || budget.status === key}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              budget.status === key
                ? "bg-[var(--color-navy-600)] text-[var(--color-navy-300)] cursor-default"
                : "bg-[var(--color-navy-700)] text-[var(--color-navy-100)] hover:bg-[var(--color-navy-600)]"
            }`}
          >
            {val.label}
          </button>
        ))}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Client Info */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Datos del cliente</h3>
          <div className="space-y-2 text-sm">
            <p className="text-[var(--color-navy-100)] font-medium text-base">{budget.client_name || "Sin nombre"}</p>
            {budget.client_email && <p className="text-[var(--color-navy-300)]">📧 {budget.client_email}</p>}
            {budget.client_phone && <p className="text-[var(--color-navy-300)]">📱 {budget.client_phone}</p>}
            {budget.client_address && <p className="text-[var(--color-navy-300)]">📍 {budget.client_address}</p>}
          </div>
        </div>

        {/* Budget Info */}
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-3">Información del presupuesto</h3>
          <div className="space-y-2 text-sm">
            <p className="text-[var(--color-navy-300)]">Tipo de servicio: <span className="text-[var(--color-navy-100)] font-medium">{(() => { const sTypes = serviceTypes(); const serviceLabels = Object.fromEntries(sTypes.map(s => [s.value, s.label])); return serviceLabels[budget.service_type] || fallbackServiceLabels[budget.service_type] || budget.service_type; })()}</span></p>
            <p className="text-[var(--color-navy-300)]">Fecha creación: <span className="text-[var(--color-navy-100)]">{new Date(budget.created_at).toLocaleDateString("es-ES")}</span></p>
            <p className="text-[var(--color-navy-300)]">Válido hasta: <span className="text-[var(--color-navy-100)]">{budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}</span></p>
          </div>
        </div>
      </div>

      {/* Partidas Table */}
      <div className="bg-[var(--color-navy-800)] rounded-xl overflow-hidden mb-6">
        <div className="p-5 border-b border-[var(--color-navy-700)]">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">Partidas ({items.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--color-navy-750)]">
                <th className="text-left text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">#</th>
                <th className="text-left text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">Concepto</th>
                <th className="text-center text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">Categoría</th>
                <th className="text-center text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">Cantidad</th>
                <th className="text-right text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">Precio ud.</th>
                <th className="text-right text-xs font-semibold text-[var(--color-navy-300)] uppercase tracking-wider px-5 py-3">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className="border-t border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                  <td className="px-5 py-3 text-sm text-[var(--color-navy-400)]">{i + 1}</td>
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-[var(--color-navy-100)]">{item.concept}</p>
                    {item.description && <p className="text-xs text-[var(--color-navy-400)] mt-0.5">{item.description}</p>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      item.category === "material" ? "bg-blue-900/30 text-blue-300" :
                      item.category === "mano_obra" ? "bg-orange-900/30 text-orange-300" :
                      "bg-gray-700 text-gray-300"
                    }`}>
                      {(() => { const cats = budgetCategories(); const categoryLabels = Object.fromEntries(cats.map(c => [c.value, c.label])); return categoryLabels[item.category] || fallbackCategoryLabels[item.category] || item.category; })()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center text-sm text-[var(--color-navy-200)]">
                    {item.quantity} {unitLabels[item.unit] || item.unit}
                  </td>
                  <td className="px-5 py-3 text-right text-sm text-[var(--color-navy-200)]">{item.unit_price.toFixed(2)} €</td>
                  <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--color-navy-100)]">{item.subtotal.toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div className="flex justify-end mb-6">
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 w-full max-w-xs">
          <div className="flex justify-between text-sm text-[var(--color-navy-300)] mb-2">
            <span>Subtotal</span>
            <span className="text-[var(--color-navy-100)]">{budget.subtotal.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-sm text-[var(--color-navy-300)] mb-3">
            <span>IVA ({budget.iva_percent}%)</span>
            <span className="text-[var(--color-navy-100)]">{budget.iva_amount.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-lg font-bold border-t border-[var(--color-navy-700)] pt-3">
            <span className="text-[var(--color-navy-100)]">TOTAL</span>
            <span className="text-[var(--color-brand-green)]">{budget.total.toFixed(2)} €</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {budget.notes && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-2">Notas</h3>
          <p className="text-sm text-[var(--color-navy-300)] whitespace-pre-wrap">{budget.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-10">
        <button onClick={duplicateBudget} className="px-4 py-2 bg-[var(--color-navy-700)] text-[var(--color-navy-100)] rounded-lg hover:bg-[var(--color-navy-600)] transition text-sm font-medium">
          📋 Duplicar presupuesto
        </button>
        <button onClick={deleteBudget} className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition text-sm font-medium">
          🗑 Eliminar presupuesto
        </button>
      </div>
    </div>
  );
}
