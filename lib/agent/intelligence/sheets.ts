/**
 * Sheets intelligence — best-effort sales/inventory extraction.
 *
 * Strategy:
 *   1. Pick the configured sheet (or fall back to most recently modified).
 *   2. Fetch the first ~200 rows of the first tab.
 *   3. Detect column roles heuristically: date / product / quantity / price /
 *      revenue. If detection is unclear, return confidence='low' and null
 *      summaries — we do NOT make up numbers.
 *   4. If we have date + at least one numeric column, compute today/yesterday
 *      /this_week/this_month aggregates and a top-products list.
 *   5. Compare to the previous comparable window for trends.
 *
 * NO LLM here.
 */

const LOG = "[agent/intel/sheets]";

const MAX_ROWS = 500;

export type SheetsStatus =
  | "ok"
  | "decrypt_failed"
  | "expired_token"
  | "rate_limited"
  | "auth_expired"
  | "api_error"
  | "not_connected"
  | "no_sheets_found"
  | "empty_sheet";

export type ColumnRole = "date" | "product" | "quantity" | "price" | "revenue" | "unknown";

export interface ColumnSchema {
  name: string;
  type: "string" | "number" | "date" | "mixed";
  role: ColumnRole;
}

export interface SalesWindow {
  revenue: number;
  units: number;
  transactions: number;
}

export interface SalesSummary {
  today: SalesWindow | null;
  yesterday: SalesWindow | null;
  this_week: (SalesWindow & { vs_last_week_pct: number | null }) | null;
  this_month: { revenue: number; units: number; vs_last_month_pct: number | null } | null;
}

export interface TopProduct {
  name: string;
  units: number;
  revenue: number;
  trend: "up" | "down" | "flat";
  vs_previous_pct: number;
}

export interface SheetsAlert {
  type: "product_declining" | "stock_low" | "anomaly_high" | "anomaly_low";
  message: string;
  data: Record<string, unknown>;
}

export interface ActiveSheet {
  id: string;
  name: string;
  last_modified: string | null;
  column_schema_detected: ColumnSchema[];
}

export interface SheetsIntel {
  connected: boolean;
  status: SheetsStatus;
  error_message: string | null;
  active_sheet: ActiveSheet | null;
  sales_summary: SalesSummary | null;
  top_products_7d: TopProduct[] | null;
  alerts: SheetsAlert[];
  rows_analyzed: number;
  detection_confidence: "high" | "medium" | "low";
  is_fallback: boolean;
}

export function emptySheetsIntel(status: SheetsStatus, error: string | null = null): SheetsIntel {
  return {
    connected: status === "ok",
    status,
    error_message: error,
    active_sheet: null,
    sales_summary: null,
    top_products_7d: null,
    alerts: [],
    rows_analyzed: 0,
    detection_confidence: "low",
    is_fallback: false,
  };
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

async function ghttp<T>(
  url: string,
  token: string,
): Promise<{ ok: true; body: T } | { ok: false; status: number; statusText: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText };
  return { ok: true, body: (await res.json()) as T };
}

function parseSpanishDate(value: string): Date | null {
  if (!value) return null;
  const v = value.trim();
  // ISO yyyy-mm-dd or with time
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const m = v.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm - 1, dd);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseEsNumber(value: string): number | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/€|EUR|euros/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function detectSchema(headerRow: string[], dataRows: string[][]): { columns: ColumnSchema[]; confidence: "high" | "medium" | "low" } {
  const cols: ColumnSchema[] = [];
  const sampleSize = Math.min(dataRows.length, 50);

  for (let i = 0; i < headerRow.length; i++) {
    const name = (headerRow[i] || `col_${i}`).trim();
    const lowerName = name.toLowerCase();
    let dateHits = 0;
    let numberHits = 0;
    let stringHits = 0;
    let numericSum = 0;
    let numericCount = 0;
    const distinctStrings = new Set<string>();

    for (let r = 0; r < sampleSize; r++) {
      const cell = (dataRows[r]?.[i] ?? "").toString().trim();
      if (!cell) continue;
      if (parseSpanishDate(cell)) dateHits++;
      const n = parseEsNumber(cell);
      if (n !== null) {
        numberHits++;
        numericSum += n;
        numericCount++;
      } else {
        stringHits++;
        if (distinctStrings.size < 60) distinctStrings.add(cell);
      }
    }
    const total = dateHits + numberHits + stringHits;
    let type: ColumnSchema["type"] = "mixed";
    if (total === 0) type = "string";
    else if (dateHits / Math.max(total, 1) > 0.7) type = "date";
    else if (numberHits / Math.max(total, 1) > 0.7) type = "number";
    else if (stringHits / Math.max(total, 1) > 0.7) type = "string";

    let role: ColumnRole = "unknown";
    const avg = numericCount > 0 ? numericSum / numericCount : 0;

    if (type === "date" || /\b(fecha|date|d[ií]a)\b/.test(lowerName)) {
      role = "date";
    } else if (type === "number") {
      if (/(ingreso|ingresos|total|importe|revenue|venta|ventas|facturaci[oó]n|€)/i.test(lowerName)) role = "revenue";
      else if (/(precio|price|pvp|coste|cost)/i.test(lowerName)) role = "price";
      else if (/(unidades|cantidad|qty|quantity|stock|n|num)/i.test(lowerName) || (avg > 0 && avg < 50 && Number.isInteger(avg))) role = "quantity";
      else if (avg >= 5) role = "revenue";
      else role = "quantity";
    } else if (type === "string") {
      if (/(producto|product|art[ií]culo|item|sku|nombre|description|descripci[oó]n)/i.test(lowerName) || (distinctStrings.size > 1 && distinctStrings.size < sampleSize)) {
        role = "product";
      }
    }

    cols.push({ name, type, role });
  }

  const hasDate = cols.some((c) => c.role === "date");
  const hasProduct = cols.some((c) => c.role === "product");
  const hasNumeric = cols.some((c) => c.role === "quantity" || c.role === "revenue" || c.role === "price");

  let confidence: "high" | "medium" | "low" = "low";
  if (hasDate && hasProduct && hasNumeric) confidence = "high";
  else if (hasDate && hasNumeric) confidence = "medium";
  else if (hasNumeric) confidence = "low";

  return { columns: cols, confidence };
}

interface ParsedRow {
  date: Date | null;
  product: string | null;
  quantity: number | null;
  price: number | null;
  revenue: number | null;
}

function parseRows(cols: ColumnSchema[], rows: string[][]): ParsedRow[] {
  const idxDate = cols.findIndex((c) => c.role === "date");
  const idxProduct = cols.findIndex((c) => c.role === "product");
  const idxQty = cols.findIndex((c) => c.role === "quantity");
  const idxPrice = cols.findIndex((c) => c.role === "price");
  const idxRevenue = cols.findIndex((c) => c.role === "revenue");

  return rows.map((r) => {
    const date = idxDate >= 0 ? parseSpanishDate((r[idxDate] || "").toString()) : null;
    const product = idxProduct >= 0 ? ((r[idxProduct] || "").toString().trim() || null) : null;
    const quantity = idxQty >= 0 ? parseEsNumber((r[idxQty] || "").toString()) : null;
    const price = idxPrice >= 0 ? parseEsNumber((r[idxPrice] || "").toString()) : null;
    let revenue = idxRevenue >= 0 ? parseEsNumber((r[idxRevenue] || "").toString()) : null;
    if (revenue === null && quantity !== null && price !== null) revenue = quantity * price;
    return { date, product, quantity, price, revenue };
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function aggregate(rows: ParsedRow[]): SalesWindow {
  let revenue = 0;
  let units = 0;
  let transactions = 0;
  for (const r of rows) {
    if (r.revenue !== null) revenue += r.revenue;
    if (r.quantity !== null) units += r.quantity;
    transactions += 1;
  }
  return {
    revenue: Number(revenue.toFixed(2)),
    units: Number(units.toFixed(2)),
    transactions,
  };
}

function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

function computeSales(parsed: ParsedRow[]): SalesSummary {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6); // last 7 days incl. today
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const todayRows = parsed.filter((r) => r.date && sameDay(r.date, today));
  const yesterdayRows = parsed.filter((r) => r.date && sameDay(r.date, yesterday));
  const weekRows = parsed.filter((r) => r.date && r.date >= weekStart && r.date <= now);
  const prevWeekRows = parsed.filter((r) => r.date && r.date >= prevWeekStart && r.date < weekStart);
  const monthRows = parsed.filter((r) => r.date && r.date >= monthStart && r.date <= now);
  const prevMonthRows = parsed.filter(
    (r) => r.date && r.date >= prevMonthStart && r.date < monthStart,
  );

  const hasRevSignal = parsed.some((r) => r.revenue !== null);
  if (!hasRevSignal) {
    // can't compute revenue — still expose units if available
    const hasUnits = parsed.some((r) => r.quantity !== null);
    if (!hasUnits) {
      return {
        today: null,
        yesterday: null,
        this_week: null,
        this_month: null,
      };
    }
  }

  const todayAgg = todayRows.length > 0 ? aggregate(todayRows) : null;
  const yesterdayAgg = yesterdayRows.length > 0 ? aggregate(yesterdayRows) : null;

  let thisWeek: SalesSummary["this_week"] = null;
  if (weekRows.length > 0) {
    const w = aggregate(weekRows);
    const pw = prevWeekRows.length > 0 ? aggregate(prevWeekRows) : null;
    thisWeek = {
      ...w,
      vs_last_week_pct: pw ? pctChange(w.revenue, pw.revenue) : null,
    };
  }

  let thisMonth: SalesSummary["this_month"] = null;
  if (monthRows.length > 0) {
    const m = aggregate(monthRows);
    const pm = prevMonthRows.length > 0 ? aggregate(prevMonthRows) : null;
    thisMonth = {
      revenue: m.revenue,
      units: m.units,
      vs_last_month_pct: pm ? pctChange(m.revenue, pm.revenue) : null,
    };
  }

  return {
    today: todayAgg,
    yesterday: yesterdayAgg,
    this_week: thisWeek,
    this_month: thisMonth,
  };
}

function computeTopProducts(parsed: ParsedRow[]): TopProduct[] | null {
  const now = new Date();
  const today = startOfDay(now);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const hasProduct = parsed.some((r) => r.product);
  if (!hasProduct) return null;

  const curMap = new Map<string, { units: number; revenue: number }>();
  const prevMap = new Map<string, { units: number; revenue: number }>();

  for (const r of parsed) {
    if (!r.product || !r.date) continue;
    if (r.date >= weekStart && r.date <= now) {
      const e = curMap.get(r.product) || { units: 0, revenue: 0 };
      if (r.quantity !== null) e.units += r.quantity;
      if (r.revenue !== null) e.revenue += r.revenue;
      curMap.set(r.product, e);
    } else if (r.date >= prevWeekStart && r.date < weekStart) {
      const e = prevMap.get(r.product) || { units: 0, revenue: 0 };
      if (r.quantity !== null) e.units += r.quantity;
      if (r.revenue !== null) e.revenue += r.revenue;
      prevMap.set(r.product, e);
    }
  }

  if (curMap.size === 0) return [];

  const products: TopProduct[] = Array.from(curMap.entries()).map(([name, cur]) => {
    const prev = prevMap.get(name) || { units: 0, revenue: 0 };
    const refCur = cur.revenue || cur.units;
    const refPrev = prev.revenue || prev.units;
    const pct = pctChange(refCur, refPrev);
    let trend: TopProduct["trend"] = "flat";
    if (pct !== null) {
      if (pct >= 10) trend = "up";
      else if (pct <= -10) trend = "down";
    }
    return {
      name,
      units: Number(cur.units.toFixed(2)),
      revenue: Number(cur.revenue.toFixed(2)),
      trend,
      vs_previous_pct: pct ?? 0,
    };
  });

  products.sort((a, b) => (b.revenue || b.units) - (a.revenue || a.units));
  return products.slice(0, 8);
}

function buildAlerts(parsed: ParsedRow[], topProducts: TopProduct[] | null): SheetsAlert[] {
  const alerts: SheetsAlert[] = [];

  if (topProducts) {
    for (const p of topProducts) {
      if (p.trend === "down" && p.vs_previous_pct <= -25) {
        alerts.push({
          type: "product_declining",
          message: `${p.name} cae ${p.vs_previous_pct}% vs semana pasada.`,
          data: { product: p.name, vs_previous_pct: p.vs_previous_pct, revenue: p.revenue, units: p.units },
        });
      }
    }
  }

  // Anomaly: today revenue vs trailing average (when we have at least 7 days)
  const now = new Date();
  const today = startOfDay(now);
  const trailingStart = new Date(today);
  trailingStart.setDate(trailingStart.getDate() - 14);
  const dailyRev = new Map<string, number>();
  for (const r of parsed) {
    if (!r.date || r.revenue === null) continue;
    if (r.date < trailingStart) continue;
    const k = r.date.toISOString().split("T")[0];
    dailyRev.set(k, (dailyRev.get(k) || 0) + r.revenue);
  }
  if (dailyRev.size >= 7) {
    const todayKey = today.toISOString().split("T")[0];
    const todayRev = dailyRev.get(todayKey);
    const otherDays = Array.from(dailyRev.entries()).filter(([k]) => k !== todayKey);
    if (todayRev !== undefined && otherDays.length > 0) {
      const avg = otherDays.reduce((a, [, v]) => a + v, 0) / otherDays.length;
      if (avg > 0) {
        const ratio = todayRev / avg;
        if (ratio >= 1.5) {
          alerts.push({
            type: "anomaly_high",
            message: `Hoy llevas ${todayRev.toFixed(0)}€, ${Math.round((ratio - 1) * 100)}% por encima del promedio reciente.`,
            data: { today: todayRev, avg_trailing: Number(avg.toFixed(2)) },
          });
        } else if (ratio <= 0.5) {
          alerts.push({
            type: "anomaly_low",
            message: `Hoy llevas ${todayRev.toFixed(0)}€, ${Math.round((1 - ratio) * 100)}% por debajo del promedio reciente.`,
            data: { today: todayRev, avg_trailing: Number(avg.toFixed(2)) },
          });
        }
      }
    }
  }

  return alerts;
}

interface ConnectionConfig {
  active_sheet_id?: string;
  active_sheet_name?: string;
  target_spreadsheet_id?: string;
  target_spreadsheet_name?: string;
}

export async function fetchSheetsIntel(args: {
  accessToken: string;
  config: ConnectionConfig | null;
}): Promise<SheetsIntel> {
  const t0 = Date.now();
  const { accessToken, config } = args;

  let spreadsheetId = config?.active_sheet_id || config?.target_spreadsheet_id || null;
  let spreadsheetName = config?.active_sheet_name || config?.target_spreadsheet_name || null;
  let isFallback = false;
  let lastModified: string | null = null;

  if (!spreadsheetId) {
    const driveRes = await ghttp<{ files?: DriveFile[] }>(
      "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&orderBy=modifiedTime+desc&pageSize=1&fields=files(id,name,modifiedTime)",
      accessToken,
    );
    if (!driveRes.ok) {
      if (driveRes.status === 401 || driveRes.status === 403) return emptySheetsIntel("auth_expired", `Drive ${driveRes.status}`);
      if (driveRes.status === 429) return emptySheetsIntel("rate_limited", "Drive 429");
      return emptySheetsIntel("api_error", `Drive ${driveRes.status} ${driveRes.statusText}`);
    }
    const file = (driveRes.body.files || [])[0];
    if (!file) return emptySheetsIntel("no_sheets_found", "No spreadsheets found in user's Drive");
    spreadsheetId = file.id;
    spreadsheetName = file.name;
    lastModified = file.modifiedTime || null;
    isFallback = true;
  }

  // Metadata to find first tab name
  const meta = await ghttp<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
  }>(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`, accessToken);
  if (!meta.ok) {
    if (meta.status === 401 || meta.status === 403) return emptySheetsIntel("auth_expired", `Sheets meta ${meta.status}`);
    if (meta.status === 429) return emptySheetsIntel("rate_limited", "Sheets 429");
    return emptySheetsIntel("api_error", `Sheets meta ${meta.status} ${meta.statusText}`);
  }
  if (!spreadsheetName) spreadsheetName = meta.body.properties?.title || "(sin nombre)";
  const firstTab = meta.body.sheets?.[0]?.properties?.title || "Hoja 1";

  // Fetch a wider range — A1:Z<MAX_ROWS+1>
  const range = encodeURIComponent(`${firstTab}!A1:Z${MAX_ROWS + 1}`);
  const valsRes = await ghttp<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    accessToken,
  );
  if (!valsRes.ok) {
    if (valsRes.status === 401 || valsRes.status === 403) return emptySheetsIntel("auth_expired", `Sheets values ${valsRes.status}`);
    if (valsRes.status === 429) return emptySheetsIntel("rate_limited", "Sheets values 429");
    return emptySheetsIntel("api_error", `Sheets values ${valsRes.status} ${valsRes.statusText}`);
  }
  const rows = valsRes.body.values || [];
  if (rows.length === 0) {
    return {
      ...emptySheetsIntel("empty_sheet", "La hoja activa está vacía"),
      active_sheet: { id: spreadsheetId, name: spreadsheetName, last_modified: lastModified, column_schema_detected: [] },
      is_fallback: isFallback,
    };
  }

  const headerRow = (rows[0] || []).map((c) => (c ?? "").toString());
  const dataRows = rows.slice(1).map((r) => r.map((c) => (c ?? "").toString()));
  const { columns, confidence } = detectSchema(headerRow, dataRows);

  let sales_summary: SalesSummary | null = null;
  let top_products_7d: TopProduct[] | null = null;
  let alerts: SheetsAlert[] = [];

  if (confidence !== "low") {
    const parsed = parseRows(columns, dataRows);
    sales_summary = computeSales(parsed);
    top_products_7d = computeTopProducts(parsed);
    alerts = buildAlerts(parsed, top_products_7d);
  }

  console.log(
    `${LOG} sheet=${spreadsheetId} rows=${dataRows.length} confidence=${confidence} alerts=${alerts.length} fallback=${isFallback} elapsed_ms=${Date.now() - t0}`,
  );

  return {
    connected: true,
    status: "ok",
    error_message: null,
    active_sheet: {
      id: spreadsheetId,
      name: spreadsheetName,
      last_modified: lastModified,
      column_schema_detected: columns,
    },
    sales_summary,
    top_products_7d,
    alerts,
    rows_analyzed: dataRows.length,
    detection_confidence: confidence,
    is_fallback: isFallback,
  };
}
