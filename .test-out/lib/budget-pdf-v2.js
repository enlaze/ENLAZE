"use strict";
/**
 * budget-pdf-v2.ts
 *
 * Generates HTML for budget PDFs from v2 ClientView and InternalView.
 *
 * Two modes:
 *   1. Client PDF: grouped by chapters, PVP prices, NO internal escandallo
 *   2. Internal PDF: full breakdown with costs, margins, confidence, sources
 *
 * Outputs HTML strings ready for Puppeteer/wkhtmltopdf conversion.
 *
 * PURE functions — no DB access, no side effects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateClientPdfHtml = generateClientPdfHtml;
exports.generateInternalPdfHtml = generateInternalPdfHtml;
// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtPct = (n) => n.toFixed(1);
const UNIT_LABELS = {
    ud: "ud", m2: "m\u00B2", ml: "ml", h: "h", kg: "kg",
    global: "global", PA: "PA", pa: "PA", lote: "lote",
    saco: "saco", rollo: "rollo", cubo: "cubo", m3: "m\u00B3",
};
function unitLabel(u) {
    return UNIT_LABELS[u] || u;
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
// ─── Shared styles ──────────────────────────────────────────────────────────
function pageStyles(isInternal) {
    return `
    @page {
      size: A4 ${isInternal ? "landscape" : "portrait"};
      margin: 15mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.4;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #0a1628;
      color: white;
      padding: 8px 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: left;
    }
    th.num { text-align: right; }
    th.center { text-align: center; }
    td { padding: 6px; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.center { text-align: center; }
    .chapter-header {
      background: #f1f5f9;
      padding: 10px 12px;
      border-left: 4px solid ${isInternal ? "#334155" : "#00c896"};
      margin-top: 20px;
      margin-bottom: 8px;
      border-radius: 0 6px 6px 0;
      page-break-inside: avoid;
    }
    .chapter-title { font-size: 14px; font-weight: 700; color: #0a1628; }
    .chapter-subtotal {
      text-align: right;
      font-size: 13px;
      font-weight: 600;
      color: #0a1628;
      padding: 6px 12px;
      background: #f8fafc;
      border-radius: 4px;
      margin-top: 4px;
    }
    .totals-box {
      background: #f8fafc;
      border-radius: 8px;
      padding: 16px 24px;
      min-width: 280px;
      float: right;
      margin-top: 24px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 14px;
    }
    .total-final {
      font-size: 20px;
      font-weight: 800;
      color: #00c896;
      border-top: 2px solid #e2e8f0;
      margin-top: 8px;
      padding-top: 8px;
    }
    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
    }
    .confidence-bar {
      display: inline-block;
      height: 6px;
      border-radius: 3px;
    }
    .margin-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .conditions {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
    }
    .conditions h3 {
      font-size: 13px;
      font-weight: 700;
      color: #00c896;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .conditions li {
      margin-bottom: 4px;
    }
  `;
}
// ─── Client PDF ─────────────────────────────────────────────────────────────
/**
 * Generate HTML for a client-facing budget PDF.
 *
 * Shows: company info, client info, project description, items by chapter
 * with unit price (PVP), subtotals, IVA, total, conditions, exclusions.
 *
 * Does NOT show: costs, margins, suppliers, confidence.
 */
function generateClientPdfHtml(view) {
    const { company, client, project, chapters, subtotal, tax_percent, tax_amount, total } = view;
    // Header
    const headerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;border-bottom:3px solid #00c896;padding-bottom:20px;">
      <div>
        <div style="font-size:28px;font-weight:800;color:#0a1628;">
          ${company.name ? escapeHtml(company.name) : 'enl<span style="color:#00c896;">a</span>ze'}
        </div>
        ${company.nif ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">NIF: ${escapeHtml(company.nif)}</div>` : ""}
        ${company.address ? `<div style="font-size:12px;color:#64748b;">${escapeHtml(company.address)}</div>` : ""}
        ${company.phone ? `<div style="font-size:12px;color:#64748b;">Tel: ${escapeHtml(company.phone)}</div>` : ""}
        ${company.email ? `<div style="font-size:12px;color:#64748b;">${escapeHtml(company.email)}</div>` : ""}
      </div>
      <div style="text-align:right;font-size:13px;color:#64748b;">
        <div style="font-size:18px;font-weight:700;color:#0a1628;">${escapeHtml(project.budget_number || "")}</div>
        <div>Fecha: ${escapeHtml(project.date)}</div>
        <div>Validez: ${project.validity_days} dias</div>
      </div>
    </div>`;
    // Client info
    const clientHTML = client
        ? `<div style="margin-bottom:24px;">
        <div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Datos del cliente</div>
        <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:13px;line-height:1.6;">
          <strong>${escapeHtml(client.name)}</strong><br/>
          ${client.nif ? `NIF: ${escapeHtml(client.nif)}<br/>` : ""}
          ${client.email ? `Email: ${escapeHtml(client.email)}<br/>` : ""}
          ${client.phone ? `Tel: ${escapeHtml(client.phone)}<br/>` : ""}
          ${client.address ? `Dir: ${escapeHtml(client.address)}` : ""}
        </div>
      </div>`
        : "";
    // Project description
    const projectHTML = project.description
        ? `<div style="font-size:16px;font-weight:700;color:#0a1628;margin-bottom:4px;">${escapeHtml(project.description)}</div>
       <div style="font-size:13px;color:#64748b;margin-bottom:16px;">${escapeHtml(project.location)}</div>`
        : "";
    // Chapters with items table
    const chaptersHTML = chapters
        .map((ch, idx) => {
        const itemRows = ch.items
            .map((item) => `
        <tr>
          <td style="width:60px;color:#64748b;font-size:11px;">${escapeHtml(item.code)}</td>
          <td>
            <div style="font-weight:600;">${escapeHtml(item.name)}</div>
            ${item.description ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(item.description)}</div>` : ""}
          </td>
          <td class="center" style="width:50px;">${unitLabel(item.unit)}</td>
          <td class="num" style="width:60px;">${item.quantity}</td>
          <td class="num" style="width:80px;">${fmt(item.unit_price)} &euro;</td>
          <td class="num" style="width:90px;font-weight:600;">${fmt(item.subtotal)} &euro;</td>
        </tr>`)
            .join("");
        return `
        <div class="chapter-header">
          <div class="chapter-title">${idx + 1}. ${escapeHtml(ch.name)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Concepto</th>
              <th class="center">Ud.</th>
              <th class="num">Cant.</th>
              <th class="num">Precio</th>
              <th class="num">Importe</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="chapter-subtotal">
          Subtotal ${escapeHtml(ch.name)}: ${fmt(ch.subtotal)} &euro;
        </div>`;
    })
        .join("");
    // Totals
    const totalsHTML = `
    <div style="clear:both;">
      <div class="totals-box">
        <div class="total-row"><span>Subtotal</span><span>${fmt(subtotal)} &euro;</span></div>
        <div class="total-row"><span>IVA (${tax_percent}%)</span><span>${fmt(tax_amount)} &euro;</span></div>
        <div class="total-row total-final"><span>TOTAL</span><span>${fmt(total)} &euro;</span></div>
      </div>
    </div>`;
    // Conditions + exclusions
    let conditionsHTML = "";
    if (view.conditions.length > 0 || view.exclusions.length > 0) {
        conditionsHTML = `<div style="clear:both;" class="conditions">`;
        if (view.conditions.length > 0) {
            conditionsHTML += `
        <h3>Condiciones</h3>
        <ul>${view.conditions.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
        }
        if (view.exclusions.length > 0) {
            conditionsHTML += `
        <h3>No incluido</h3>
        <ul>${view.exclusions.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
        }
        if (view.payment_terms) {
            conditionsHTML += `
        <h3>Forma de pago</h3>
        <p>${escapeHtml(view.payment_terms)}</p>`;
        }
        conditionsHTML += `</div>`;
    }
    // Footer
    const footerHTML = `
    <div class="footer">
      Presupuesto generado con <strong>Enlaze</strong> &middot; enlaze.es<br/>
      Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
    </div>`;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(project.budget_number)} - Presupuesto Cliente</title>
  <style>${pageStyles(false)}</style>
</head>
<body>
  ${headerHTML}
  ${clientHTML}
  ${projectHTML}

  <div style="font-size:14px;font-weight:700;color:#00c896;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
    Desglose por capitulos
  </div>
  ${chaptersHTML}
  ${totalsHTML}
  ${conditionsHTML}
  ${footerHTML}
</body>
</html>`;
}
// ─── Internal PDF ───────────────────────────────────────────────────────────
/**
 * Generate HTML for an internal budget PDF (escandallo).
 *
 * Shows: full cost breakdown per item (material, labor, machinery),
 * margins, profit, suppliers, price sources, confidence, risk.
 */
function generateInternalPdfHtml(view) {
    const { chapters, totals, confidence } = view;
    // Header
    const headerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;border-bottom:3px solid #334155;padding-bottom:20px;">
      <div>
        <div style="font-size:28px;font-weight:800;color:#0a1628;">
          enl<span style="color:#00c896;">a</span>ze
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">
          Escandallo interno
          <span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;margin-left:8px;vertical-align:middle;">
            USO INTERNO
          </span>
        </div>
      </div>
      <div style="text-align:right;font-size:13px;color:#64748b;">
        <div>Fecha: ${new Date().toLocaleDateString("es-ES")}</div>
      </div>
    </div>`;
    // Summary cards
    const marginColor = totals.margin_percent >= 25 ? "#059669" : totals.margin_percent >= 15 ? "#d97706" : "#dc2626";
    const confColor = confidence.overall >= 0.7 ? "#059669" : confidence.overall >= 0.5 ? "#d97706" : "#dc2626";
    const summaryHTML = `
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Coste directo</div>
        <div style="font-size:15px;font-weight:700;color:#0a1628;">${fmt(totals.direct_cost)} &euro;</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">PVP sin IVA</div>
        <div style="font-size:15px;font-weight:700;color:#0a1628;">${fmt(totals.sale_subtotal)} &euro;</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Beneficio</div>
        <div style="font-size:15px;font-weight:700;color:#0a1628;">${fmt(totals.profit)} &euro;</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Margen</div>
        <div style="font-size:15px;font-weight:700;color:${marginColor};">${fmtPct(totals.margin_percent)}%</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Fiabilidad</div>
        <div style="font-size:15px;font-weight:700;color:${confColor};">${Math.round(confidence.overall * 100)}%</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Horas totales</div>
        <div style="font-size:15px;font-weight:700;color:#0a1628;">${totals.total_hours.toFixed(1)} h</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Duracion est.</div>
        <div style="font-size:15px;font-weight:700;color:#0a1628;">${totals.duration_weeks_estimate}</div>
      </div>
    </div>`;
    // High risk items warning
    let riskHTML = "";
    if (confidence.high_risk_items.length > 0) {
        riskHTML = `
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;color:#991b1b;">
        <strong>Partidas de alto riesgo (${confidence.high_risk_items.length}):</strong><br/>
        ${confidence.high_risk_items.map((r) => escapeHtml(r)).join("<br/>")}
      </div>`;
    }
    // Chapters with full escandallo table
    const chaptersHTML = chapters
        .map((ch, idx) => {
        const chMarginColor = ch.margin_percent >= 25 ? "#059669" : ch.margin_percent >= 15 ? "#d97706" : "#dc2626";
        const chConfColor = ch.confidence_avg >= 0.7 ? "#059669" : ch.confidence_avg >= 0.5 ? "#d97706" : "#dc2626";
        const itemRows = ch.items
            .map((item) => {
            const riskColor = item.risk === "bajo" ? "#059669" : item.risk === "medio" ? "#d97706" : "#dc2626";
            const riskBg = item.risk === "bajo" ? "#ecfdf5" : item.risk === "medio" ? "#fffbeb" : "#fef2f2";
            const confBarWidth = Math.round(item.confidence * 40);
            const itemConfColor = item.confidence >= 0.7 ? "#059669" : item.confidence >= 0.5 ? "#d97706" : "#dc2626";
            return `
          <tr>
            <td style="font-size:11px;color:#64748b;width:70px;">${escapeHtml(item.code)}</td>
            <td style="max-width:180px;">
              <div style="font-weight:600;font-size:12px;">${escapeHtml(item.name)}</div>
            </td>
            <td class="center" style="width:35px;">${unitLabel(item.unit)}</td>
            <td class="num" style="width:45px;">${item.quantity}</td>
            <td class="num" style="width:55px;">${fmt(item.material_cost)}</td>
            <td class="num" style="width:55px;">${fmt(item.labor_cost)}</td>
            <td class="num" style="width:50px;">${item.labor_hours.toFixed(2)}</td>
            <td class="num" style="width:55px;">${fmt(item.machinery_cost)}</td>
            <td class="num" style="width:55px;font-weight:600;">${fmt(item.unit_cost)}</td>
            <td class="num" style="width:55px;">${fmt(item.unit_price_sale)}</td>
            <td class="num" style="width:65px;font-weight:600;">${fmt(item.subtotal_sale)}</td>
            <td class="center" style="width:40px;">
              <span class="margin-badge" style="color:${riskColor};background:${riskBg};">${fmtPct(item.margin_percent)}%</span>
            </td>
            <td style="width:60px;font-size:10px;">${item.supplier ? escapeHtml(item.supplier) : "-"}</td>
            <td class="center" style="width:50px;">
              <div class="confidence-bar" style="width:${confBarWidth}px;background:${itemConfColor};"></div>
              <div style="font-size:10px;">${Math.round(item.confidence * 100)}%</div>
            </td>
          </tr>`;
        })
            .join("");
        return `
        <div class="chapter-header">
          <div class="chapter-title">
            ${idx + 1}. ${escapeHtml(ch.chapter_label)}
            <span style="float:right;font-size:12px;font-weight:normal;">
              Margen: <span style="color:${chMarginColor};font-weight:700;">${fmtPct(ch.margin_percent)}%</span>
              &nbsp;&middot;&nbsp;
              Fiab: <span style="color:${chConfColor};font-weight:700;">${Math.round(ch.confidence_avg * 100)}%</span>
            </span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Cod.</th>
              <th>Concepto</th>
              <th class="center">Ud.</th>
              <th class="num">Cant.</th>
              <th class="num">Mat.</th>
              <th class="num">M.O.</th>
              <th class="num">Horas</th>
              <th class="num">Maq.</th>
              <th class="num">Coste</th>
              <th class="num">PVP</th>
              <th class="num">Importe</th>
              <th class="center">Marg.</th>
              <th>Fuente</th>
              <th class="center">Fiab.</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="chapter-subtotal">
          Coste: ${fmt(ch.subtotal_cost)} &euro; &nbsp;&middot;&nbsp;
          PVP: ${fmt(ch.subtotal_sale)} &euro; &nbsp;&middot;&nbsp;
          Beneficio: ${fmt(ch.subtotal_sale - ch.subtotal_cost)} &euro;
        </div>`;
    })
        .join("");
    // Cost breakdown table
    const breakdownHTML = `
    <div style="margin-top:24px;clear:both;">
      <div style="font-size:14px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
        Resumen economico
      </div>
      <table style="width:50%;min-width:300px;">
        <tbody>
          <tr><td>Materiales</td><td class="num" style="font-weight:600;">${fmt(totals.materials_cost)} &euro;</td></tr>
          <tr><td>Mano de obra</td><td class="num" style="font-weight:600;">${fmt(totals.labor_cost)} &euro;</td></tr>
          <tr><td>Maquinaria</td><td class="num" style="font-weight:600;">${fmt(totals.machinery_cost)} &euro;</td></tr>
          <tr style="border-top:2px solid #e2e8f0;"><td style="font-weight:700;">Coste directo</td><td class="num" style="font-weight:700;">${fmt(totals.direct_cost)} &euro;</td></tr>
          <tr><td>Costes indirectos</td><td class="num">${fmt(totals.indirect_costs)} &euro;</td></tr>
          <tr style="border-top:2px solid #e2e8f0;"><td style="font-weight:700;">Coste total</td><td class="num" style="font-weight:700;">${fmt(totals.total_cost)} &euro;</td></tr>
          <tr><td>PVP (sin IVA)</td><td class="num">${fmt(totals.sale_subtotal)} &euro;</td></tr>
          <tr><td>IVA</td><td class="num">${fmt(totals.tax_amount)} &euro;</td></tr>
          <tr style="border-top:2px solid #00c896;"><td style="font-weight:800;font-size:16px;">TOTAL PVP</td><td class="num" style="font-weight:800;font-size:16px;color:#00c896;">${fmt(totals.sale_total)} &euro;</td></tr>
          <tr><td style="color:#059669;">Beneficio neto</td><td class="num" style="color:#059669;font-weight:700;">${fmt(totals.profit)} &euro;</td></tr>
        </tbody>
      </table>
    </div>`;
    // Footer
    const footerHTML = `
    <div class="footer">
      Escandallo generado con <strong>Enlaze</strong> &middot; enlaze.es<br/>
      <strong style="color:#ef4444;">DOCUMENTO CONFIDENCIAL - USO INTERNO</strong>
    </div>`;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Escandallo interno</title>
  <style>${pageStyles(true)}</style>
</head>
<body>
  ${headerHTML}
  ${summaryHTML}
  ${riskHTML}
  ${chaptersHTML}
  ${breakdownHTML}
  ${footerHTML}
</body>
</html>`;
}
