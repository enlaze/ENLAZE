/**
 * pdf-generator.ts
 * Generates HTML for budget PDFs in two modes:
 * 1. Client PDF: grouped by chapters, included tasks, NO internal escandallo
 * 2. Internal PDF: full breakdown with costs, margins, materials, sources
 *
 * Also keeps the legacy `generateBudgetPDFHTML` for backward compatibility.
 */

import type {
  BudgetClientView,
  BudgetInternalView,
  ClimaSystemSpec,
} from "./budget-engine";

// ─── Shared Types (legacy) ──────────────────────────────────────────────────

export interface PDFBudget {
  budget_number: string;
  title: string;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  service_type: string;
  status: string;
  created_at: string;
  valid_until?: string | null;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  total: number;
  notes?: string | null;
}

export interface PDFBudgetItem {
  concept: string;
  description?: string | null;
  category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  subtotal_cost?: number;
}

// ─── Shared Constants ───────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "#b45309", bg: "#fef3c7" },
  enviado: { label: "Enviado", color: "#1d4ed8", bg: "#dbeafe" },
  aceptado: { label: "Aceptado", color: "#15803d", bg: "#dcfce7" },
  rechazado: { label: "Rechazado", color: "#b91c1c", bg: "#fee2e2" },
  borrador: { label: "Borrador", color: "#475569", bg: "#f1f5f9" },
};

const fallbackServiceLabels: Record<string, string> = {
  reforma: "Reforma integral",
  fontaneria: "Fontaneria",
  electricidad: "Electricidad",
  climatizacion: "Climatizacion",
  multiservicios: "Multiservicios",
  general: "General",
  construccion: "Construccion",
};

const fallbackCategoryLabels: Record<string, string> = {
  material: "Suministro y col.",
  mano_obra: "Mano de obra",
  maquinaria: "Maquinaria",
  otros: "Otros",
};

const unitLabels: Record<string, string> = {
  ud: "ud", m2: "m\u00B2", ml: "ml", h: "h", kg: "kg",
  global: "global", PA: "PA", pa: "PA", lote: "lote",
  saco: "saco", rollo: "rollo", cubo: "cubo",
};

const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// ─── Shared HTML Building Blocks ────────────────────────────────────────────

function buildHeaderHTML(budget: PDFBudget, isInternal: boolean): string {
  const accent = isInternal ? "#334155" : "#00c896";
  return `
    <div class="header" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;border-bottom:3px solid ${accent};padding-bottom:20px;">
      <div>
        <div style="font-size:28px;font-weight:800;color:#0a1628;">enl<span style="color:#00c896;">a</span>ze</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">
          Presupuesto profesional
          ${isInternal ? '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;margin-left:8px;vertical-align:middle;">USO INTERNO</span>' : ''}
        </div>
      </div>
      <div style="text-align:right;font-size:13px;color:#64748b;">
        <div style="font-size:18px;font-weight:700;color:#0a1628;">${budget.budget_number}</div>
        <div>Fecha: ${new Date(budget.created_at).toLocaleDateString("es-ES")}</div>
        <div>Valido hasta: ${budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}</div>
        <div style="margin-top:6px;">
          <span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${statusConfig[budget.status]?.bg || "#f1f5f9"};color:${statusConfig[budget.status]?.color || "#475569"};">
            ${statusConfig[budget.status]?.label || budget.status}
          </span>
        </div>
      </div>
    </div>`;
}

function buildClientInfoHTML(budget: PDFBudget): string {
  return `
    <div style="margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Datos del cliente</div>
      <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:13px;line-height:1.6;">
        <strong>${budget.client_name || "Sin nombre"}</strong><br/>
        ${budget.client_email ? `Email: ${budget.client_email}<br/>` : ""}
        ${budget.client_phone ? `Telefono: ${budget.client_phone}<br/>` : ""}
        ${budget.client_address ? `Direccion: ${budget.client_address}` : ""}
      </div>
    </div>`;
}

function buildFooterHTML(): string {
  return `
    <div style="margin-top:40px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">
      Presupuesto generado con <strong>Enlaze</strong> &middot; enlaze.es<br/>
      Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
    </div>`;
}

function pageStyles(isInternal: boolean): string {
  return `
    @page { size: A4 ${isInternal ? 'landscape' : 'portrait'}; margin: 15mm; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #0a1628; color: white; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .chapter-header { background: #f1f5f9; padding: 10px 12px; border-left: 4px solid ${isInternal ? '#334155' : '#00c896'}; margin-top: 20px; margin-bottom: 8px; border-radius: 0 6px 6px 0; }
    .chapter-title { font-size: 14px; font-weight: 700; color: #0a1628; }
    .chapter-subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
    .task-list { padding-left: 0; margin: 6px 0; list-style: none; }
    .task-item { padding: 3px 0; font-size: 12px; color: #475569; }
    .task-item::before { content: "\\2713 "; color: #00c896; font-weight: bold; }
    .totals-box { background: #f8fafc; border-radius: 8px; padding: 16px 24px; min-width: 280px; float: right; }
    .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
    .total-final { font-size: 20px; font-weight: 800; color: #00c896; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 8px; }
    .break-card { display: inline-block; background: #f8fafc; border-radius: 8px; padding: 12px 16px; text-align: center; margin-right: 12px; min-width: 100px; }
    .break-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
    .break-value { font-size: 15px; font-weight: 700; color: #0a1628; }
    .notes { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #92400e; }
    .confidence-bar { display: inline-block; height: 6px; border-radius: 3px; }
    .margin-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  `;
}

// ─── A. Client PDF (by chapters, no escandallo) ─────────────────────────────

export function generateClientPDFHTML(
  budget: PDFBudget,
  clientView: BudgetClientView,
  serviceLabelsMap?: Record<string, string>,
): string {
  const sLabel = (serviceLabelsMap && serviceLabelsMap[budget.service_type]) ||
    fallbackServiceLabels[budget.service_type] || budget.service_type;

  let chapterIdx = 0;
  const chaptersHTML = clientView.chapters.map(ch => {
    chapterIdx++;
    const tasksHTML = ch.includedTasks.map(t =>
      `<li class="task-item">${t}</li>`
    ).join("");

    return `
      <div class="chapter-header">
        <div class="chapter-title">${chapterIdx}. ${ch.chapterLabel}</div>
        <div class="chapter-subtitle">${ch.clientDescription}</div>
      </div>
      <div style="padding:0 12px 8px 12px;">
        <ul class="task-list">${tasksHTML}</ul>
        <div style="text-align:right;font-size:14px;font-weight:600;color:#0a1628;margin-top:4px;">
          ${fmt(ch.subtotal)} &euro;
        </div>
      </div>`;
  }).join("");

  // Quality indicator
  const qualityHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:#64748b;text-transform:uppercase;margin-bottom:4px;">Nivel de acabados</div>
      <div style="font-size:14px;font-weight:600;color:#0a1628;">${clientView.qualityLabel}</div>
    </div>`;

  // Clima note if applicable
  let climaNote = "";
  if (clientView.climaSpec) {
    climaNote = `
      <div style="background:#f0fdfa;border-left:4px solid #14b8a6;padding:10px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;color:#0f766e;">
        <strong>Climatizacion:</strong> ${clientView.climaSpec.label} &mdash;
        ${clientView.climaSpec.assumptions[1] || ""}
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${budget.budget_number} - Presupuesto Cliente</title>
  <style>${pageStyles(false)}</style>
</head>
<body>
  ${buildHeaderHTML(budget, false)}
  ${buildClientInfoHTML(budget)}

  <div style="font-size:16px;font-weight:700;color:#0a1628;margin-bottom:4px;">${budget.title}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:16px;">${sLabel}</div>

  ${qualityHTML}
  ${climaNote}

  <div style="margin-bottom:24px;">
    <div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Desglose por capitulos</div>
    ${chaptersHTML}
  </div>

  <div style="clear:both;margin-top:24px;">
    <div class="totals-box">
      <div class="total-row"><span>Subtotal</span><span>${fmt(clientView.subtotal)} &euro;</span></div>
      <div class="total-row"><span>IVA (${clientView.ivaPct}%)</span><span>${fmt(clientView.ivaAmount)} &euro;</span></div>
      <div class="total-row total-final"><span>TOTAL</span><span>${fmt(clientView.total)} &euro;</span></div>
    </div>
  </div>

  ${budget.notes ? `<div style="clear:both;margin-top:24px;"><div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

  ${buildFooterHTML()}
</body>
</html>`;
}

// ─── B. Internal PDF (full escandallo) ──────────────────────────────────────

export function generateInternalPDFHTML(
  budget: PDFBudget,
  internalView: BudgetInternalView,
  serviceLabelsMap?: Record<string, string>,
): string {
  const sLabel = (serviceLabelsMap && serviceLabelsMap[budget.service_type]) ||
    fallbackServiceLabels[budget.service_type] || budget.service_type;

  let chapterIdx = 0;
  const chaptersHTML = internalView.chapters.map(ch => {
    chapterIdx++;

    // Margin color coding
    const marginColor = ch.marginPct >= 25 ? "#059669" : ch.marginPct >= 15 ? "#d97706" : "#dc2626";
    const marginBg = ch.marginPct >= 25 ? "#ecfdf5" : ch.marginPct >= 15 ? "#fffbeb" : "#fef2f2";

    // Confidence bar
    const confColor = ch.avgConfidence >= 70 ? "#059669" : ch.avgConfidence >= 50 ? "#d97706" : "#dc2626";
    const confWidth = Math.min(Math.max(ch.avgConfidence, 10), 100);

    // Materials table for this chapter
    let materialsHTML = "";
    if (ch.materials.length > 0) {
      const matRows = ch.materials.map(m => {
        const srcIcon = m.sourceType === "user_catalog" ? "&#9733;" :
                        m.sourceType === "enlaze_base" ? "&#9670;" :
                        m.sourceType === "web_search" ? "&#127760;" : "&#9679;";
        const confBarColor = m.confidenceScore >= 0.7 ? "#059669" : m.confidenceScore >= 0.5 ? "#d97706" : "#dc2626";
        return `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:4px 6px;font-size:11px;">${m.name}</td>
            <td style="padding:4px 6px;font-size:11px;text-align:center;">${m.quantity} ${unitLabels[m.unit] || m.unit}</td>
            <td style="padding:4px 6px;font-size:11px;text-align:right;">${fmt(m.unitPrice)} &euro;</td>
            <td style="padding:4px 6px;font-size:11px;text-align:right;">${fmt(m.subtotal)} &euro;</td>
            <td style="padding:4px 6px;font-size:11px;text-align:center;">${m.qualityTier}</td>
            <td style="padding:4px 6px;font-size:11px;">${srcIcon} ${m.supplier}</td>
            <td style="padding:4px 6px;font-size:11px;text-align:center;">
              <div class="confidence-bar" style="width:${Math.round(m.confidenceScore * 40)}px;background:${confBarColor};"></div>
              ${Math.round(m.confidenceScore * 100)}%
            </td>
          </tr>`;
      }).join("");

      materialsHTML = `
        <table style="margin:4px 0 8px 0;width:100%;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="background:#64748b;text-align:left;font-size:10px;padding:4px 6px;">Material</th>
              <th style="background:#64748b;text-align:center;font-size:10px;padding:4px 6px;width:60px;">Cant.</th>
              <th style="background:#64748b;text-align:right;font-size:10px;padding:4px 6px;width:65px;">Precio</th>
              <th style="background:#64748b;text-align:right;font-size:10px;padding:4px 6px;width:70px;">Subtotal</th>
              <th style="background:#64748b;text-align:center;font-size:10px;padding:4px 6px;width:50px;">Gama</th>
              <th style="background:#64748b;text-align:left;font-size:10px;padding:4px 6px;">Fuente</th>
              <th style="background:#64748b;text-align:center;font-size:10px;padding:4px 6px;width:70px;">Fiab.</th>
            </tr>
          </thead>
          <tbody>${matRows}</tbody>
        </table>`;
    }

    return `
      <div class="chapter-header" style="border-left-color:#334155;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="chapter-title">${chapterIdx}. ${ch.chapterLabel}</div>
          <div>
            <span class="margin-badge" style="background:${marginBg};color:${marginColor};">${ch.marginPct.toFixed(1)}% margen</span>
            <span style="font-size:12px;color:#64748b;margin-left:8px;">
              Fiabilidad:
              <span class="confidence-bar" style="width:${confWidth * 0.4}px;background:${confColor};vertical-align:middle;"></span>
              ${ch.avgConfidence}%
            </span>
          </div>
        </div>
      </div>
      <div style="padding:4px 12px;">
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <div class="break-card">
            <div class="break-label">M.Obra</div>
            <div class="break-value" style="font-size:13px;">${fmt(ch.laborCost)} &euro;</div>
          </div>
          <div class="break-card">
            <div class="break-label">Material</div>
            <div class="break-value" style="font-size:13px;">${fmt(ch.materialCost)} &euro;</div>
          </div>
          <div class="break-card">
            <div class="break-label">Equipo</div>
            <div class="break-value" style="font-size:13px;">${fmt(ch.equipmentCost)} &euro;</div>
          </div>
          <div class="break-card">
            <div class="break-label">Residuos</div>
            <div class="break-value" style="font-size:13px;">${fmt(ch.wasteCost)} &euro;</div>
          </div>
          <div class="break-card" style="background:#f0fdf4;">
            <div class="break-label" style="color:#059669;">Coste Dir.</div>
            <div class="break-value" style="font-size:13px;color:#059669;">${fmt(ch.directCost)} &euro;</div>
          </div>
          <div class="break-card" style="background:#eff6ff;">
            <div class="break-label" style="color:#1d4ed8;">PVP Cliente</div>
            <div class="break-value" style="font-size:13px;color:#1d4ed8;">${fmt(ch.clientPrice)} &euro;</div>
          </div>
          <div class="break-card" style="background:${marginBg};">
            <div class="break-label" style="color:${marginColor};">Beneficio</div>
            <div class="break-value" style="font-size:13px;color:${marginColor};">+${fmt(ch.margin)} &euro;</div>
          </div>
        </div>
        ${materialsHTML}
      </div>`;
  }).join("");

  // Global summary
  const t = internalView.totals;
  const globalMarginColor = t.totalMarginPct >= 25 ? "#059669" : t.totalMarginPct >= 15 ? "#d97706" : "#dc2626";

  const summaryHTML = `
    <div style="margin-top:24px;padding:16px;border:2px dashed #334155;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#334155;margin-bottom:12px;">RESUMEN INTERNO</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="break-card" style="background:#f8fafc;flex:1;">
          <div class="break-label">Mano de Obra</div>
          <div class="break-value">${fmt(t.laborCost)} &euro;</div>
        </div>
        <div class="break-card" style="background:#f8fafc;flex:1;">
          <div class="break-label">Materiales</div>
          <div class="break-value">${fmt(t.materialsCost)} &euro;</div>
        </div>
        <div class="break-card" style="background:#f8fafc;flex:1;">
          <div class="break-label">Equipos</div>
          <div class="break-value">${fmt(t.equipmentCost)} &euro;</div>
        </div>
        <div class="break-card" style="background:#f8fafc;flex:1;">
          <div class="break-label">Residuos</div>
          <div class="break-value">${fmt(t.wasteCost)} &euro;</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">
        <div class="break-card" style="background:#ecfdf5;flex:1;">
          <div class="break-label" style="color:#059669;">Coste Directo Total</div>
          <div class="break-value" style="color:#059669;">${fmt(t.directCost)} &euro;</div>
        </div>
        <div class="break-card" style="background:#eff6ff;flex:1;">
          <div class="break-label" style="color:#1d4ed8;">PVP Cliente (s/IVA)</div>
          <div class="break-value" style="color:#1d4ed8;">${fmt(t.clientSubtotal)} &euro;</div>
        </div>
        <div class="break-card" style="background:#f0fdf4;flex:1;">
          <div class="break-label" style="color:${globalMarginColor};">Beneficio Neto</div>
          <div class="break-value" style="color:${globalMarginColor};">+${fmt(t.totalMargin)} &euro;</div>
        </div>
        <div class="break-card" style="background:#f0fdf4;flex:1;">
          <div class="break-label" style="color:${globalMarginColor};">Margen Global</div>
          <div class="break-value" style="color:${globalMarginColor};">${t.totalMarginPct.toFixed(1)}%</div>
        </div>
      </div>
    </div>`;

  // Confidence overview
  const avgConf = internalView.avgConfidence;
  const confColor = avgConf >= 70 ? "#059669" : avgConf >= 50 ? "#d97706" : "#dc2626";
  const confidenceHTML = `
    <div style="margin-top:16px;font-size:12px;color:#64748b;">
      Fiabilidad media de precios:
      <span style="color:${confColor};font-weight:600;">${avgConf}%</span>
      <span class="confidence-bar" style="width:${avgConf * 0.5}px;background:${confColor};vertical-align:middle;margin-left:4px;"></span>
      &nbsp;&mdash;&nbsp;Gama: <strong>${internalView.qualityTier}</strong>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${budget.budget_number} - INTERNO</title>
  <style>${pageStyles(true)}</style>
</head>
<body>
  ${buildHeaderHTML(budget, true)}
  ${buildClientInfoHTML(budget)}

  <div style="font-size:16px;font-weight:700;color:#0a1628;margin-bottom:4px;">${budget.title}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:16px;">${sLabel}</div>

  <div style="margin-bottom:24px;">
    <div style="font-size:14px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Escandallo por capitulos</div>
    ${chaptersHTML}
  </div>

  ${summaryHTML}
  ${confidenceHTML}

  <div style="clear:both;margin-top:24px;">
    <div class="totals-box">
      <div class="total-row"><span>Subtotal cliente</span><span>${fmt(t.clientSubtotal)} &euro;</span></div>
      <div class="total-row"><span>IVA (${t.ivaPct}%)</span><span>${fmt(t.ivaAmount)} &euro;</span></div>
      <div class="total-row total-final"><span>TOTAL CLIENTE</span><span>${fmt(t.clientTotal)} &euro;</span></div>
    </div>
  </div>

  ${budget.notes ? `<div style="clear:both;margin-top:24px;"><div style="font-size:14px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

  ${buildFooterHTML()}
</body>
</html>`;
}

// ─── C. Legacy Generator (backward compat) ──────────────────────────────────

/**
 * @deprecated Use generateClientPDFHTML or generateInternalPDFHTML instead.
 * Kept for backward compatibility with existing code paths.
 */
export function generateBudgetPDFHTML(
  budget: PDFBudget,
  items: PDFBudgetItem[],
  mode: 'client' | 'internal',
  serviceLabelsMap?: Record<string, string>,
  categoryLabelsMap?: Record<string, string>
): string {

  const itemsHTML = items.map((item, i) => {
    let internalColumns = "";
    if (mode === "internal") {
      const cost = item.subtotal_cost || 0;
      const profit = item.subtotal - cost;
      const marginPercent = cost > 0 ? (profit / cost) * 100 : 0;

      internalColumns = `
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#64748b;">${cost.toFixed(2)} &euro;</td>
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#059669;">${marginPercent.toFixed(1)}%</td>
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#059669;font-weight:600;">+${profit.toFixed(2)} &euro;</td>
      `;
    }

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 6px;font-size:13px;">${i + 1}</td>
        <td style="padding:8px 6px;font-size:13px;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#6b7280;font-size:12px;">${item.description}</span>` : ""}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${(categoryLabelsMap && categoryLabelsMap[item.category]) || fallbackCategoryLabels[item.category] || item.category}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${item.quantity} ${unitLabels[item.unit] || item.unit}</td>
        ${mode === "internal" ? internalColumns : ""}
        <td style="padding:8px 6px;font-size:13px;text-align:right;">${item.unit_price.toFixed(2)} &euro;</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;font-weight:600;">${item.subtotal.toFixed(2)} &euro;</td>
      </tr>`;
  }).join("");

  const internalHeaders = mode === "internal" ? `
    <th style="width:70px;text-align:right;background:#334155;">Coste B.</th>
    <th style="width:60px;text-align:right;background:#059669;">Margen</th>
    <th style="width:70px;text-align:right;background:#059669;">Beneficio</th>
  ` : "";

  const materialItems = items.filter((i) => i.category === "material");
  const laborItems = items.filter((i) => i.category === "mano_obra");
  const otherItems = items.filter((i) => i.category !== "material" && i.category !== "mano_obra");

  const materialTotal = materialItems.reduce((s, i) => s + i.subtotal, 0);
  const laborTotal = laborItems.reduce((s, i) => s + i.subtotal, 0);
  const otherTotal = otherItems.reduce((s, i) => s + i.subtotal, 0);

  const calculatedSubtotal = materialTotal + laborTotal + otherTotal;
  const calculatedIva = calculatedSubtotal * (budget.iva_percent / 100);
  const calculatedTotal = calculatedSubtotal + calculatedIva;

  let internalBreakdown = "";
  if (mode === "internal") {
    const totalCost = items.reduce((s, i) => s + (i.subtotal_cost || 0), 0);
    const totalProfit = budget.subtotal - totalCost;
    const globalMargin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    internalBreakdown = `
      <div style="display:flex;gap:16px;margin-top:20px;border:2px dashed #059669;padding:10px;border-radius:8px;">
        <div class="break-card" style="background:#ecfdf5;flex:1;">
          <div class="break-label" style="color:#059669;">Coste Directo Total</div>
          <div class="break-value">${totalCost.toFixed(2)} &euro;</div>
        </div>
        <div class="break-card" style="background:#ecfdf5;flex:1;">
          <div class="break-label" style="color:#059669;">Beneficio Neto</div>
          <div class="break-value">+${totalProfit.toFixed(2)} &euro;</div>
        </div>
        <div class="break-card" style="background:#ecfdf5;flex:1;">
          <div class="break-label" style="color:#059669;">Margen Global</div>
          <div class="break-value">${globalMargin.toFixed(1)}%</div>
        </div>
      </div>
    `;
  }

  const sLabel = (serviceLabelsMap && serviceLabelsMap[budget.service_type]) || fallbackServiceLabels[budget.service_type] || budget.service_type;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${budget.budget_number}${mode === 'internal' ? ' - INTERNO' : ''}</title>
  <style>${pageStyles(mode === 'internal')}</style>
</head>
<body>
  ${buildHeaderHTML(budget, mode === 'internal')}
  ${buildClientInfoHTML(budget)}

  <div style="margin-bottom:24px;">
    <div style="font-size:14px;font-weight:700;color:${mode === 'internal' ? '#334155' : '#00c896'};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${budget.title} &mdash; ${sLabel}</div>
    <table>
      <thead>
        <tr>
          <th style="width:30px;text-align:left;">#</th>
          <th style="text-align:left;">Concepto</th>
          <th style="width:90px;text-align:center;">Categoria</th>
          <th style="width:60px;text-align:center;">Ud.</th>
          ${internalHeaders}
          <th style="width:80px;text-align:right;">Precio ud.</th>
          <th style="width:90px;text-align:right;">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:20px;">
    <div class="break-card">
      <div class="break-label">Material</div>
      <div class="break-value">${materialTotal.toFixed(2)} &euro;</div>
    </div>
    <div class="break-card">
      <div class="break-label">Mano de obra</div>
      <div class="break-value">${laborTotal.toFixed(2)} &euro;</div>
    </div>
    <div class="break-card">
      <div class="break-label">Otros</div>
      <div class="break-value">${otherTotal.toFixed(2)} &euro;</div>
    </div>
  </div>

  ${internalBreakdown}

  <div style="clear:both;margin-top:20px;">
    <div class="totals-box">
      <div class="total-row"><span>Subtotal</span><span>${calculatedSubtotal.toFixed(2)} &euro;</span></div>
      <div class="total-row"><span>IVA (${budget.iva_percent}%)</span><span>${calculatedIva.toFixed(2)} &euro;</span></div>
      <div class="total-row total-final"><span>TOTAL</span><span>${calculatedTotal.toFixed(2)} &euro;</span></div>
    </div>
  </div>

  ${budget.notes ? `<div style="clear:both;margin-top:24px;"><div style="font-size:14px;font-weight:700;color:${mode === 'internal' ? '#334155' : '#00c896'};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

  ${buildFooterHTML()}
</body>
</html>`;
}

// ─── Print Helper ───────────────────────────────────────────────────────────

export function printPDF(html: string) {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}
