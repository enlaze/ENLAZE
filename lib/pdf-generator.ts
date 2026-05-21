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
  unit_price: number; // For client PDF
  subtotal: number; // For client PDF
  // Internal fields (from wizard Partida)
  subtotal_cost?: number; 
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "#b45309", bg: "#fef3c7" },
  enviado: { label: "Enviado", color: "#1d4ed8", bg: "#dbeafe" },
  aceptado: { label: "Aceptado", color: "#15803d", bg: "#dcfce7" },
  rechazado: { label: "Rechazado", color: "#b91c1c", bg: "#fee2e2" },
  borrador: { label: "Borrador", color: "#475569", bg: "#f1f5f9" }
};

const fallbackServiceLabels: Record<string, string> = {
  reforma: "Reforma integral",
  fontaneria: "Fontanería",
  electricidad: "Electricidad",
  climatizacion: "Climatización",
  multiservicios: "Multiservicios",
  general: "General",
  construccion: "Construcción"
};

const fallbackCategoryLabels: Record<string, string> = {
  material: "Suministro y col.",
  mano_obra: "Mano de obra",
  maquinaria: "Maquinaria",
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
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#64748b;">${cost.toFixed(2)} €</td>
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#059669;">${marginPercent.toFixed(1)}%</td>
        <td style="padding:8px 6px;font-size:12px;text-align:right;color:#059669;font-weight:600;">+${profit.toFixed(2)} €</td>
      `;
    }

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 6px;font-size:13px;">${i + 1}</td>
        <td style="padding:8px 6px;font-size:13px;"><strong>${item.concept}</strong>${item.description ? `<br/><span style="color:#6b7280;font-size:12px;">${item.description}</span>` : ""}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${(categoryLabelsMap && categoryLabelsMap[item.category]) || fallbackCategoryLabels[item.category] || item.category}</td>
        <td style="padding:8px 6px;font-size:13px;text-align:center;">${item.quantity} ${unitLabels[item.unit] || item.unit}</td>
        ${mode === "internal" ? internalColumns : ""}
        <td style="padding:8px 6px;font-size:13px;text-align:right;">${item.unit_price.toFixed(2)} €</td>
        <td style="padding:8px 6px;font-size:13px;text-align:right;font-weight:600;">${item.subtotal.toFixed(2)} €</td>
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

  // Recalculate totals from items to ensure consistency
  const calculatedSubtotal = materialTotal + laborTotal + otherTotal;
  const calculatedIva = calculatedSubtotal * (budget.iva_percent / 100);
  const calculatedTotal = calculatedSubtotal + calculatedIva;

  let internalBreakdown = "";
  if (mode === "internal") {
    const totalCost = items.reduce((s, i) => s + (i.subtotal_cost || 0), 0);
    const totalProfit = budget.subtotal - totalCost;
    const globalMargin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    
    internalBreakdown = `
      <div class="breakdown" style="margin-top:20px; border: 2px dashed #059669; padding: 10px; border-radius: 8px;">
        <div class="breakdown-card" style="background:#ecfdf5;">
          <div class="breakdown-label" style="color:#059669;">Coste Directo Total</div>
          <div class="breakdown-value">${totalCost.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card" style="background:#ecfdf5;">
          <div class="breakdown-label" style="color:#059669;">Beneficio Neto</div>
          <div class="breakdown-value">+${totalProfit.toFixed(2)} €</div>
        </div>
        <div class="breakdown-card" style="background:#ecfdf5;">
          <div class="breakdown-label" style="color:#059669;">Margen Global</div>
          <div class="breakdown-value">${globalMargin.toFixed(1)}%</div>
        </div>
      </div>
    `;
  }

  const sLabel = (serviceLabelsMap && serviceLabelsMap[budget.service_type]) || fallbackServiceLabels[budget.service_type] || budget.service_type;

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <title>${budget.budget_number}${mode === 'internal' ? ' - INTERNO' : ''}</title>
    <style>
      @page { size: A4 landscape; margin: 20mm; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 3px solid ${mode === 'internal' ? '#334155' : '#00c896'}; padding-bottom: 20px; }
      .logo { font-size: 28px; font-weight: 800; color: #0a1628; }
      .logo span { color: #00c896; }
      .budget-info { text-align: right; font-size: 13px; color: #64748b; }
      .budget-number { font-size: 18px; font-weight: 700; color: #0a1628; }
      .section { margin-bottom: 24px; }
      .section-title { font-size: 14px; font-weight: 700; color: ${mode === 'internal' ? '#334155' : '#00c896'}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
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
      ${mode === 'internal' ? '.internal-badge { background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 8px; vertical-align: middle; }' : ''}
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="logo">enl<span>a</span>ze</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">
          Presupuesto profesional
          ${mode === 'internal' ? '<span class="internal-badge">USO INTERNO</span>' : ''}
        </div>
      </div>
      <div class="budget-info">
        <div class="budget-number">${budget.budget_number}</div>
        <div>Fecha: ${new Date(budget.created_at).toLocaleDateString("es-ES")}</div>
        <div>Válido hasta: ${budget.valid_until ? new Date(budget.valid_until).toLocaleDateString("es-ES") : "Sin fecha"}</div>
        <div style="margin-top:6px;">
          <span class="badge" style="background:${statusConfig[budget.status]?.bg || "#f1f5f9"};color:${statusConfig[budget.status]?.color || "#475569"};">
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
      <div class="section-title">${budget.title} — ${sLabel}</div>
      <table>
        <thead>
          <tr>
            <th style="width:30px;text-align:left;">#</th>
            <th style="text-align:left;">Concepto</th>
            <th style="width:90px;text-align:center;">Categoría</th>
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

    ${internalBreakdown}

    <div class="totals">
      <div class="totals-box">
        <div class="total-row"><span>Subtotal</span><span>${calculatedSubtotal.toFixed(2)} €</span></div>
        <div class="total-row"><span>IVA (${budget.iva_percent}%)</span><span>${calculatedIva.toFixed(2)} €</span></div>
        <div class="total-row total-final"><span>TOTAL</span><span>${calculatedTotal.toFixed(2)} €</span></div>
      </div>
    </div>

    ${budget.notes ? `<div class="section" style="margin-top:24px;"><div class="section-title">Notas</div><div class="notes">${budget.notes}</div></div>` : ""}

    <div class="footer">
      Presupuesto generado con <strong>Enlaze</strong> · enlaze.es<br/>
      Este presupuesto tiene validez contractual una vez aceptado por ambas partes.
    </div>
  </body>
  </html>`;
}

export function printPDF(html: string) {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}
