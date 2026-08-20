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
import { CHAPTER_LABELS } from "./budget-engine";

// ─── Shared Types (legacy) ──────────────────────────────────────────────────

export interface PDFBudget {
  budget_number: string;
  title: string;
  client_name?: string | null;
  client_nif?: string | null;
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
  company_name?: string | null;
  company_logo_url?: string | null;
  company_nif?: string | null;
  company_address?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
  company_web?: string | null;
  location?: string | null;
  geographic_profile?: string | null;
  geographic_adjustment?: string | null;
  technical_document_names?: string[];
  execution_weeks_min?: number | null;
  execution_weeks_max?: number | null;
  preparation_weeks_min?: number | null;
  preparation_weeks_max?: number | null;
  total_weeks_min?: number | null;
  total_weeks_max?: number | null;
  schedule_assumptions?: string[];
  execution_phases?: Array<{
    title: string;
    duration_days_min?: number;
    duration_days_max?: number;
    description?: string;
    depends_on?: string[];
  }>;
  // Presupix format: editable per-budget fields
  deposit_percent?: number | null;
  payment_method?: string | null;
  payment_iban?: string | null;
  warranty_text?: string | null;
  execution_deadline_text?: string | null;
  observations?: string | null;
  conditions_text?: string | null;
  discount_type?: string | null;
  discount_percent?: number | null;
  discount_amount?: number | null;
  payment_schedule?: Array<{ percent?: number; concept?: string; moment?: string }> | null;
}

export interface PDFBudgetItem {
  concept: string;
  description?: string | null;
  category: string;
  chapter?: string | null;
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

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

// ─── Shared HTML Building Blocks ────────────────────────────────────────────

function buildHeaderHTML(budget: PDFBudget, isInternal: boolean): string {
  const accent = isInternal ? "#334155" : "#00c896";
  const companyIdentity = budget.company_logo_url
    ? `<img src="${budget.company_logo_url}" alt="${budget.company_name || "Empresa"}" style="display:block;max-width:160px;max-height:66px;object-fit:contain;" />`
    : `<div style="font-size:28px;font-weight:800;color:#0a1628;">${budget.company_name || 'enl<span style="color:#00c896;">a</span>ze'}</div>`;
  return `
    <div class="header" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;border-bottom:3px solid ${accent};padding-bottom:20px;">
      <div>
        ${companyIdentity}
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

function buildFooterHTML(budget: PDFBudget): string {
  return `
    <div style="margin-top:40px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">
      <strong>${budget.company_name || "Tu empresa"}</strong> &middot; Documento generado con Enlaze<br/>
      Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
    </div>`;
}

function buildBudgetTextBlockHTML(label: string, text: string | null | undefined, accent = "#00c896"): string {
  if (!text) return "";
  const safeText = escapeHTML(text);
  return `
    <div style="clear:both;margin-top:24px;">
      <div style="font-size:14px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${label}</div>
      <div style="background:#f8fafc;border-left:4px solid ${accent};padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#334155;line-height:1.55;white-space:pre-wrap;">${safeText}</div>
    </div>`;
}

function buildInternalNotesHTML(notes: string | null | undefined): string {
  if (!notes) return "";
  const safeNotes = escapeHTML(notes);
  return `
    <div style="clear:both;margin-top:24px;">
      <div style="font-size:14px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notas internas - No enviar al cliente</div>
      <div class="notes" style="white-space:pre-wrap;">${safeNotes}</div>
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
    .totals-box { background: #f8fafc; border-radius: 8px; padding: 16px 24px; min-width: 280px; float: right; break-inside: avoid; page-break-inside: avoid; }
    .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
    .total-final { font-size: 20px; font-weight: 800; color: #00c896; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 8px; }
    .break-card { display: inline-block; background: #f8fafc; border-radius: 8px; padding: 12px 16px; text-align: center; margin-right: 12px; min-width: 100px; break-inside: avoid; page-break-inside: avoid; }
    .break-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
    .break-value { font-size: 15px; font-weight: 700; color: #0a1628; }
    .notes { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #92400e; break-inside: avoid; page-break-inside: avoid; }
    .budget-summary-row { break-inside: avoid; page-break-inside: avoid; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .confidence-bar { display: inline-block; height: 6px; border-radius: 3px; }
    .margin-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    /* Presupix client format */
    .px-section-row td { background: #f1f5f9; font-weight: 700; font-size: 13px; color: #0a1628; padding: 8px 6px; }
    .px-subtotal-row td { background: #f8fafc; font-weight: 700; font-size: 13px; color: #0a1628; padding: 8px 6px; border-top: 1px solid #cbd5e1; }
    .px-breakdown { float: right; min-width: 260px; margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
    .px-breakdown-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; color: #334155; }
    .px-breakdown-total { font-size: 18px; font-weight: 800; color: #0a1628; border-top: 2px solid #0a1628; margin-top: 6px; padding-top: 6px; }
    .px-block { clear: both; margin-top: 24px; break-inside: avoid; page-break-inside: avoid; }
    .px-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .px-text { font-size: 13px; color: #1e293b; line-height: 1.5; }
    .px-divider { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
    .px-payment-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .px-payment-table td { padding: 6px 0; font-size: 13px; vertical-align: top; }
    .px-payment-table .px-moment { font-size: 11px; color: #64748b; }
    .px-payment-table .px-amount { text-align: right; font-weight: 700; color: #0a1628; }
    .px-signatures { display: flex; justify-content: space-between; margin-top: 48px; }
    .px-sign-block { width: 45%; }
    .px-sign-line { border-top: 1px solid #94a3b8; margin-top: 40px; padding-top: 4px; font-size: 11px; color: #64748b; }
  `;
}

// ─── Presupix section grouping (flat item list per section) ────────────────

interface PresupixSection {
  label: string;
  items: PDFBudgetItem[];
  subtotal: number;
}

/**
 * Groups budget items into sections for the Presupix-style item table.
 * If every item shares the same chapter (or none set it), the whole budget
 * renders as a single section labelled with the budget title — matching the
 * reference "Presupix" sample. When multiple distinct chapters are present
 * (typical of the AI wizard flow), one section per chapter is produced.
 */
function buildPresupixSections(budgetTitle: string, items: PDFBudgetItem[]): PresupixSection[] {
  const distinctChapters = new Set(items.map(i => i.chapter).filter((c): c is string => !!c));

  if (distinctChapters.size <= 1) {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    return [{ label: budgetTitle, items, subtotal }];
  }

  const order = Array.from(distinctChapters);
  const sections: PresupixSection[] = order.map(chapter => {
    const chItems = items.filter(i => i.chapter === chapter);
    return {
      label: CHAPTER_LABELS[chapter] || chapter,
      items: chItems,
      subtotal: chItems.reduce((s, i) => s + i.subtotal, 0),
    };
  });

  const unassigned = items.filter(i => !i.chapter);
  if (unassigned.length > 0) {
    sections.push({
      label: "Otros",
      items: unassigned,
      subtotal: unassigned.reduce((s, i) => s + i.subtotal, 0),
    });
  }

  return sections;
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

  const scheduleHTML = budget.execution_weeks_min != null && budget.execution_weeks_max != null ? `
    <div style="background:#f8fafc;border:1px solid #cbd5e1;padding:10px 14px;border-radius:8px;margin-bottom:16px;">
      <div style="font-size:12px;color:#64748b;text-transform:uppercase;margin-bottom:5px;">Plazo orientativo</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#334155;">
        <span><strong>Preparacion y suministros:</strong> ${budget.preparation_weeks_min ?? "-"}-${budget.preparation_weeks_max ?? "-"} semanas</span>
        <span><strong>Ejecucion:</strong> ${budget.execution_weeks_min}-${budget.execution_weeks_max} semanas</span>
        <span><strong>Total recomendado:</strong> ${budget.total_weeks_min ?? "-"}-${budget.total_weeks_max ?? "-"} semanas</span>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:5px;">Plazo sujeto a validacion tecnica, licencias, medicion final y confirmacion de suministros.</div>
    </div>` : "";

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
  ${scheduleHTML}

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

  ${buildBudgetTextBlockHTML("Observaciones", budget.observations)}
  ${buildBudgetTextBlockHTML("Condiciones del presupuesto", budget.conditions_text)}

  ${buildFooterHTML(budget)}
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

  const phasesHTML = (budget.execution_phases || []).map((phase, index) => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px;font-size:11px;">${index + 1}. ${phase.title}</td>
      <td style="padding:6px;font-size:11px;text-align:center;">${phase.duration_days_min ?? "-"}-${phase.duration_days_max ?? "-"} dias</td>
      <td style="padding:6px;font-size:11px;">${phase.depends_on?.join(", ") || "Sin dependencia previa"}</td>
      <td style="padding:6px;font-size:11px;">${phase.description || ""}</td>
    </tr>
  `).join("");

  const planningHTML = `
    <div style="margin-bottom:24px;padding:14px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;">
      <div style="font-size:14px;font-weight:700;color:#334155;margin-bottom:10px;">PLANIFICACION Y CRITERIOS DEL PRESUPUESTO</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
        <div class="break-card"><div class="break-label">Ubicacion</div><div class="break-value" style="font-size:12px;">${budget.location || "Base nacional"}</div></div>
        <div class="break-card"><div class="break-label">Ajuste geografico</div><div class="break-value" style="font-size:12px;">${budget.geographic_profile || "Media nacional"}</div></div>
        <div class="break-card"><div class="break-label">Preparacion y compras</div><div class="break-value" style="font-size:12px;">${budget.preparation_weeks_min ?? "-"}-${budget.preparation_weeks_max ?? "-"} semanas</div></div>
        <div class="break-card"><div class="break-label">Ejecucion</div><div class="break-value" style="font-size:12px;">${budget.execution_weeks_min ?? "-"}-${budget.execution_weeks_max ?? "-"} semanas</div></div>
        <div class="break-card"><div class="break-label">Plazo total</div><div class="break-value" style="font-size:12px;">${budget.total_weeks_min ?? "-"}-${budget.total_weeks_max ?? "-"} semanas</div></div>
      </div>
      <div style="font-size:11px;color:#475569;margin-bottom:8px;"><strong>Criterio de plazo:</strong> Ruta critica calculada por superficie, gremios, secados y suministros. El plazo total se mide desde la validacion del encargo hasta la entrega; parte del aprovisionamiento puede solaparse con la ejecucion.</div>
      ${budget.geographic_adjustment ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;"><strong>Criterio geografico:</strong> ${budget.geographic_adjustment}</div>` : ""}
      ${(budget.technical_document_names || []).length > 0 ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;"><strong>Documentacion tecnica utilizada:</strong> ${budget.technical_document_names!.join(", ")}</div>` : ""}
      ${phasesHTML ? `
        <table style="margin-top:8px;">
          <thead><tr><th style="text-align:left;">Fase</th><th>Duracion</th><th style="text-align:left;">Dependencias</th><th style="text-align:left;">Alcance</th></tr></thead>
          <tbody>${phasesHTML}</tbody>
        </table>
      ` : ""}
    </div>`;

  let chapterIdx = 0;
  const chaptersHTML = internalView.chapters.map(ch => {
    chapterIdx++;

    // Margin color coding
    const marginColor = ch.marginPct >= 25 ? "#059669" : ch.marginPct >= 15 ? "#d97706" : "#dc2626";
    const marginBg = ch.marginPct >= 25 ? "#ecfdf5" : ch.marginPct >= 15 ? "#fffbeb" : "#fef2f2";

    // Confidence bar
    const confColor = ch.avgConfidence >= 70 ? "#059669" : ch.avgConfidence >= 50 ? "#d97706" : "#dc2626";
    const confWidth = Math.min(Math.max(ch.avgConfidence, 10), 100);

    const itemRows = (ch.items || []).map((item) => `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px 6px;font-size:10px;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#64748b;">${item.description}</span>` : ""}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center;">${item.quantity} ${unitLabels[item.unit] || item.unit}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right;">${fmt(item.baseUnitPrice)} &euro;</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center;">x${item.geographicFactor.toFixed(2)}</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right;">${fmt(item.unitCost)} &euro;</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right;">${fmt(item.subtotalCost)} &euro;</td>
        <td style="padding:4px 6px;font-size:10px;text-align:center;">${item.estimatedHours ?? "-"} h</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right;">${fmt(item.clientPrice)} &euro;</td>
        <td style="padding:4px 6px;font-size:10px;text-align:right;color:#059669;">+${fmt(item.margin)} &euro;</td>
      </tr>
    `).join("");
    const itemsHTML = `
      <table style="margin:4px 0 8px 0;width:100%;">
        <thead>
          <tr>
            <th style="text-align:left;">Partida y alcance</th>
            <th>Cantidad</th>
            <th>Base ud.</th>
            <th>Zona</th>
            <th>Coste ud.</th>
            <th>Coste</th>
            <th>Horas</th>
            <th>PVP</th>
            <th>Margen</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`;

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
        ${itemsHTML}
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

  ${planningHTML}

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

  ${buildBudgetTextBlockHTML("Observaciones", budget.observations, "#334155")}
  ${buildBudgetTextBlockHTML("Condiciones del presupuesto", budget.conditions_text, "#334155")}
  ${buildInternalNotesHTML(budget.notes)}

  ${buildFooterHTML(budget)}
</body>
</html>`;
}

// ─── C. Presupix client format ──────────────────────────────────────────────

function buildPresupixHeaderHTML(budget: PDFBudget): string {
  const companyIdentity = budget.company_logo_url
    ? `<img src="${budget.company_logo_url}" alt="${budget.company_name || "Empresa"}" style="display:block;max-width:170px;max-height:64px;object-fit:contain;margin-bottom:10px;" />`
    : `<div style="font-size:22px;font-weight:800;color:#0a1628;margin-bottom:8px;">${budget.company_name || 'enl<span style="color:#00c896;">a</span>ze'}</div>`;

  const companyLines = [
    budget.company_name ? `<strong>${budget.company_name}</strong>` : "",
    budget.company_nif ? `CIF: ${budget.company_nif}` : "",
    budget.company_address || "",
    budget.company_phone ? `Tel: ${budget.company_phone}` : "",
    budget.company_email || "",
    budget.company_web || "",
  ].filter(Boolean).join("<br/>");

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div>
        ${companyIdentity}
        <div style="font-size:12px;color:#475569;line-height:1.6;">${companyLines}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:26px;font-weight:800;color:#0a1628;letter-spacing:1px;margin-bottom:10px;">PRESUPUESTO</div>
        <table style="margin-left:auto;font-size:13px;">
          <tr><td style="color:#64748b;padding:2px 10px 2px 0;">N&ordm;</td><td style="font-weight:700;color:#0a1628;">${budget.budget_number}</td></tr>
          <tr><td style="color:#64748b;padding:2px 10px 2px 0;">Fecha</td><td style="font-weight:700;color:#0a1628;">${new Date(budget.created_at).toLocaleDateString("es-ES")}</td></tr>
          <tr><td style="color:#64748b;padding:2px 10px 2px 0;">Validez</td><td style="font-weight:700;color:#0a1628;">${budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "\u2014"}</td></tr>
        </table>
      </div>
    </div>
    <hr class="px-divider" />`;
}

function buildPresupixClientBlockHTML(budget: PDFBudget): string {
  return `
    <div style="margin-bottom:20px;">
      <div class="px-label">Cliente</div>
      <div style="font-size:14px;font-weight:700;color:#0a1628;margin-bottom:2px;">${budget.client_name || "Sin nombre"}</div>
      <div class="px-text">
        ${budget.client_nif ? `CIF/NIF: ${budget.client_nif}<br/>` : ""}
        ${budget.client_address ? `${budget.client_address}<br/>` : ""}
        ${budget.client_phone ? `Tel: ${budget.client_phone}<br/>` : ""}
        ${budget.client_email || ""}
      </div>
    </div>`;
}

function renderPresupixClientHTML(budget: PDFBudget, items: PDFBudgetItem[]): string {
  const sections = buildPresupixSections(budget.title, items);
  const showSectionHeader = sections.length > 1 || sections[0]?.label !== budget.title;

  let rowIdx = 0;
  const rowsHTML = sections.map(section => {
    const sectionHeaderHTML = `
      <tr class="px-section-row"><td colspan="6">${section.label}</td></tr>`;

    const itemRowsHTML = section.items.map(item => {
      rowIdx++;
      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 6px;font-size:12px;color:#64748b;vertical-align:top;">${rowIdx}</td>
          <td style="padding:8px 6px;font-size:12px;vertical-align:top;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#64748b;font-size:11px;">${item.description}</span>` : ""}</td>
          <td style="padding:8px 6px;font-size:12px;text-align:center;vertical-align:top;">${item.quantity}</td>
          <td style="padding:8px 6px;font-size:12px;text-align:center;vertical-align:top;">${unitLabels[item.unit] || item.unit}</td>
          <td style="padding:8px 6px;font-size:12px;text-align:right;vertical-align:top;">${fmt(item.unit_price)} &euro;</td>
          <td style="padding:8px 6px;font-size:12px;text-align:right;font-weight:600;vertical-align:top;">${fmt(item.subtotal)} &euro;</td>
        </tr>`;
    }).join("");

    const subtotalRowHTML = `
      <tr class="px-subtotal-row"><td colspan="5" style="text-align:right;">Subtotal &middot; ${section.label}</td><td style="text-align:right;">${fmt(section.subtotal)} &euro;</td></tr>`;

    return (showSectionHeader ? sectionHeaderHTML : "") + itemRowsHTML + subtotalRowHTML;
  }).join("");

  const depositPct = budget.deposit_percent ?? 30;
  const depositAmount = Math.round(budget.total * (depositPct / 100) * 100) / 100;
  const pendingAmount = Math.round((budget.total - depositAmount) * 100) / 100;

  // Descuento: aplica sobre el subtotal (base imponible) antes del IVA.
  const discountType = budget.discount_type === "amount" ? "amount" : "percent";
  const discountPercent = Math.max(0, Math.min(100, budget.discount_percent ?? 0));
  const discountAmountInput = Math.max(0, budget.discount_amount ?? 0);
  const discountValue =
    discountType === "amount"
      ? Math.min(budget.subtotal, discountAmountInput)
      : Math.round(budget.subtotal * (discountPercent / 100) * 100) / 100;
  const taxableBase = Math.max(0, budget.subtotal - discountValue);

  // Fases de pago: usa el calendario definido en el presupuesto, o cae al
  // comportamiento clásico (anticipo/resto) para presupuestos antiguos.
  const scheduleFromBudget =
    Array.isArray(budget.payment_schedule) && budget.payment_schedule.length > 0
      ? budget.payment_schedule
      : null;
  const scheduleForDisplay =
    scheduleFromBudget ?? [
      { percent: depositPct, concept: "Anticipo", moment: "Al aceptar &middot; Reserva de fecha e inicio de trabajos." },
      { percent: Math.max(0, 100 - depositPct), concept: "Pago a la finalizaci&oacute;n (resto)", moment: "A la entrega de la obra &middot; Salvo acuerdo por fases." },
    ];

  const cobroHTML = (budget.payment_method || budget.payment_iban) ? `
    <div class="px-block">
      <div class="px-label">M&eacute;todo de cobro</div>
      <div class="px-text">
        ${budget.payment_method ? `Forma de pago: <strong>${budget.payment_method}</strong><br/>` : ""}
        ${budget.payment_iban ? `IBAN: <strong>${budget.payment_iban}</strong>` : ""}
      </div>
    </div>` : "";

  const formaPagoRowsHTML = scheduleForDisplay
    .map((phase) => {
      const pct = Math.max(0, Math.min(100, Number(phase.percent) || 0));
      const amount = Math.round(budget.total * (pct / 100) * 100) / 100;
      const concept = phase.concept || "Pago";
      const moment = phase.moment || "";
      return `
        <tr>
          <td>${concept}${pct ? ` <strong>${pct}%</strong>` : ""}${moment ? `<br/><span class="px-moment">Momento: ${moment}</span>` : ""}</td>
          <td class="px-amount">${fmt(amount)} &euro;</td>
        </tr>`;
    })
    .join("");

  const formaPagoHTML = `
    <div class="px-block">
      <div class="px-label">Forma de pago</div>
      <table class="px-payment-table">
        ${formaPagoRowsHTML}
      </table>
    </div>`;

  const freeTextBlock = (label: string, text?: string | null) => text ? `
    <div class="px-block">
      <div class="px-label">${label}</div>
      <div class="px-text">${text}</div>
    </div>` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${budget.budget_number}</title>
  <style>${pageStyles(false)}</style>
</head>
<body>
  ${buildPresupixHeaderHTML(budget)}
  ${buildPresupixClientBlockHTML(budget)}

  <table>
    <thead>
      <tr>
        <th style="width:26px;text-align:left;">N&ordm;</th>
        <th style="text-align:left;">Descripci&oacute;n</th>
        <th style="width:60px;text-align:center;">Cantidad</th>
        <th style="width:50px;text-align:center;">Ud</th>
        <th style="width:80px;text-align:right;">Precio unit.</th>
        <th style="width:90px;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML}
    </tbody>
  </table>

  <div class="px-breakdown">
    ${discountValue > 0 ? `
    <div class="px-breakdown-row"><span>Subtotal</span><span>${fmt(budget.subtotal)} &euro;</span></div>
    <div class="px-breakdown-row" style="color:#b91c1c;"><span>Descuento${discountType === "percent" ? ` (${discountPercent}%)` : ""}</span><span>-${fmt(discountValue)} &euro;</span></div>
    <div class="px-breakdown-row"><span>Base imponible</span><span>${fmt(taxableBase)} &euro;</span></div>` : `
    <div class="px-breakdown-row"><span>Base imponible</span><span>${fmt(budget.subtotal)} &euro;</span></div>`}
    <div class="px-breakdown-row"><span>IVA (${budget.iva_percent}%)</span><span>${fmt(budget.iva_amount)} &euro;</span></div>
    <div class="px-breakdown-row px-breakdown-total"><span>TOTAL</span><span>${fmt(budget.total)} &euro;</span></div>
    ${!scheduleFromBudget ? `
    <div class="px-breakdown-row" style="margin-top:6px;"><span>Anticipo (${depositPct}%)</span><span>${fmt(depositAmount)} &euro;</span></div>
    <div class="px-breakdown-row"><span>Pendiente</span><span>${fmt(pendingAmount)} &euro;</span></div>` : ""}
  </div>

  ${cobroHTML}
  ${formaPagoHTML}

  <div class="px-block">
    <div class="px-breakdown-row px-breakdown-total" style="float:none;"><span>TOTAL</span><span>${fmt(budget.total)} &euro;</span></div>
  </div>

  ${freeTextBlock("Plazo de ejecuci&oacute;n", budget.execution_deadline_text)}
  ${freeTextBlock("Garant&iacute;a", budget.warranty_text)}
  ${freeTextBlock("Observaciones", budget.observations)}
  ${freeTextBlock("Condiciones", budget.conditions_text)}

  <div class="px-signatures">
    <div class="px-sign-block">
      <div class="px-sign-line">Firma del cliente<br/>Nombre y apellidos / Fecha</div>
    </div>
    <div class="px-sign-block">
      <div class="px-sign-line">Firma del profesional<br/>Nombre y apellidos / Fecha</div>
    </div>
  </div>

  ${buildFooterHTML(budget)}
</body>
</html>`;
}

// ─── D. Legacy Internal Generator ────────────────────────────────────────────

/**
 * Client mode renders the "Presupix" format (see the reference sample this
 * layout was built from): flat, numbered item list grouped under one or
 * more section headers, subtotal per section, base imponible/IVA/TOTAL,
 * anticipo/pendiente, notas, metodo de cobro + IBAN, forma de pago,
 * plazo de ejecucion, garantia, observaciones, condiciones and dual
 * signature blocks. Internal mode keeps the escandallo (cost/margin)
 * breakdown used for the "PDF interno" export.
 */
export function generateBudgetPDFHTML(
  budget: PDFBudget,
  items: PDFBudgetItem[],
  mode: 'client' | 'internal',
  serviceLabelsMap?: Record<string, string>,
  categoryLabelsMap?: Record<string, string>
): string {
  if (mode === "client") {
    return renderPresupixClientHTML(budget, items);
  }

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
      <div class="budget-summary-row" style="display:flex;gap:16px;margin-top:20px;border:2px dashed #059669;padding:10px;border-radius:8px;">
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

  <div class="budget-summary-row" style="display:flex;gap:16px;margin-bottom:20px;">
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

  ${buildBudgetTextBlockHTML("Observaciones", budget.observations, "#334155")}
  ${buildBudgetTextBlockHTML("Condiciones del presupuesto", budget.conditions_text, "#334155")}
  ${buildInternalNotesHTML(budget.notes)}

  ${buildFooterHTML(budget)}
</body>
</html>`;
}

// ─── Print Helper ───────────────────────────────────────────────────────────

export function printPDF(html: string, existingWindow?: Window | null) {
  const printWindow = existingWindow || window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}
