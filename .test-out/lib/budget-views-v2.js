"use strict";
/**
 * budget-views-v2.ts
 *
 * Builds ClientView and InternalView from BudgetItemV2[] and related data.
 *
 * ClientView: What the client sees — no costs, no margins, no supplier names.
 *   Grouped by chapter, with unit price (PVP) and totals.
 *
 * InternalView: Full escandallo — costs, margins, suppliers, confidence.
 *   Grouped by chapter, with profitability metrics per item and totals.
 *
 * Both views are PURE functions: no DB, no side effects.
 * They receive pre-computed data and produce JSON-serializable output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClientViewV2 = buildClientViewV2;
exports.buildInternalViewV2 = buildInternalViewV2;
// ─── Chapter labels ─────────────────────────────────────────────────────────
const CHAPTER_LABELS = {
    protecciones: "Protecciones y seguridad",
    demoliciones: "Demoliciones y retiradas",
    albanileria: "Albanileria",
    fontaneria: "Fontaneria y saneamiento",
    electricidad: "Electricidad",
    impermeabilizacion: "Impermeabilizacion",
    revestimientos: "Revestimientos",
    pavimentos: "Pavimentos y solados",
    rodapie: "Rodapie",
    pintura: "Pintura y acabados",
    carpinteria_interior: "Carpinteria interior",
    carpinteria_exterior: "Carpinteria exterior",
    sanitarios: "Aparatos sanitarios",
    cocina: "Cocina",
    climatizacion: "Climatizacion",
    falsos_techos: "Falsos techos",
    residuos: "Gestion de residuos",
    limpieza: "Limpieza final",
    seguridad: "Seguridad y salud",
    otros: "Otros",
};
const CHAPTER_ORDER = {
    protecciones: 1,
    demoliciones: 2,
    albanileria: 3,
    fontaneria: 4,
    electricidad: 5,
    impermeabilizacion: 6,
    revestimientos: 7,
    pavimentos: 8,
    rodapie: 9,
    pintura: 10,
    carpinteria_interior: 11,
    carpinteria_exterior: 12,
    sanitarios: 13,
    cocina: 14,
    climatizacion: 15,
    falsos_techos: 16,
    residuos: 17,
    limpieza: 18,
    seguridad: 19,
    otros: 20,
};
const DEFAULT_COMPANY = {
    name: "",
    nif: "",
    address: "",
    phone: "",
    email: "",
};
// ─── Helper: group items by chapter ─────────────────────────────────────────
function groupByChapter(items) {
    const map = new Map();
    for (const item of items) {
        const chapter = item.chapter;
        if (!map.has(chapter)) {
            map.set(chapter, []);
        }
        map.get(chapter).push(item);
    }
    return map;
}
function sortedChapters(chapters) {
    return [...chapters].sort((a, b) => (CHAPTER_ORDER[a] || 99) - (CHAPTER_ORDER[b] || 99));
}
/**
 * Build a client-facing view of the budget.
 * Hides all internal costs, margins, and supplier information.
 * Shows only PVP (precio venta publico) per item.
 */
function buildClientViewV2(input) {
    const { items, scope, preferences, budgetNumber = "", company = DEFAULT_COMPANY, validityDays = 30, paymentTerms = "", conditions = [], exclusions = [], } = input;
    const grouped = groupByChapter(items);
    const chapterCodes = sortedChapters([...grouped.keys()]);
    const chapters = chapterCodes.map((code, idx) => {
        const chapterItems = grouped.get(code) || [];
        const clientItems = chapterItems.map((item) => ({
            code: item.code,
            name: item.name,
            description: item.description,
            unit: item.unit,
            quantity: round2(item.quantity),
            unit_price: round2(item.unit_price_sale),
            subtotal: round2(item.subtotal_sale),
        }));
        return {
            name: CHAPTER_LABELS[code] || code,
            order: idx + 1,
            items: clientItems,
            subtotal: round2(clientItems.reduce((sum, i) => sum + i.subtotal, 0)),
        };
    });
    const subtotal = round2(chapters.reduce((sum, ch) => sum + ch.subtotal, 0));
    const taxPercent = preferences.tax_percent;
    const taxAmount = round2(subtotal * (taxPercent / 100));
    const total = round2(subtotal + taxAmount);
    return {
        company,
        client: scope.client || {
            name: "",
            nif: "",
            address: "",
            email: "",
            phone: "",
        },
        project: {
            description: scope.description || `${scope.project_type} - ${scope.surface_m2}m2`,
            location: scope.location,
            budget_number: budgetNumber,
            date: new Date().toISOString().split("T")[0],
            validity_days: validityDays,
        },
        chapters,
        subtotal,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        total,
        payment_terms: paymentTerms,
        conditions,
        exclusions,
    };
}
/**
 * Build an internal view with full cost breakdown, margins, suppliers,
 * and confidence scores per item and per chapter.
 */
function buildInternalViewV2(input) {
    const { items, economics, timeline, preferences } = input;
    const grouped = groupByChapter(items);
    const chapterCodes = sortedChapters([...grouped.keys()]);
    const chapters = chapterCodes.map((code) => {
        const chapterItems = grouped.get(code) || [];
        const internalItems = chapterItems.map((item) => {
            const profit = item.subtotal_sale - item.subtotal_cost;
            const marginPct = item.subtotal_sale > 0
                ? ((profit / item.subtotal_sale) * 100)
                : 0;
            return {
                code: item.code,
                name: item.name,
                unit: item.unit,
                quantity: round2(item.quantity),
                // Costs
                material_cost: round2(item.material_cost_per_unit * item.quantity),
                labor_cost: round2(item.labor_cost_per_unit * item.quantity),
                labor_hours: round2(item.labor_hours_per_unit * item.quantity),
                machinery_cost: round2(item.machinery_cost_per_unit * item.quantity),
                unit_cost: round2(item.unit_cost),
                subtotal_cost: round2(item.subtotal_cost),
                // Sale
                unit_price_sale: round2(item.unit_price_sale),
                subtotal_sale: round2(item.subtotal_sale),
                // Profitability
                margin_percent: round2(marginPct),
                profit: round2(profit),
                // Source
                supplier: item.supplier,
                price_source: item.price_source,
                confidence: round2(item.confidence_score),
                // Risk
                risk: item.confidence_score >= 0.8
                    ? "bajo"
                    : item.confidence_score >= 0.5
                        ? "medio"
                        : "alto",
            };
        });
        const subtotalCost = internalItems.reduce((s, i) => s + i.subtotal_cost, 0);
        const subtotalSale = internalItems.reduce((s, i) => s + i.subtotal_sale, 0);
        const marginPct = subtotalSale > 0
            ? ((subtotalSale - subtotalCost) / subtotalSale) * 100
            : 0;
        const confidenceAvg = internalItems.length > 0
            ? internalItems.reduce((s, i) => s + i.confidence, 0) / internalItems.length
            : 0;
        return {
            chapter: code,
            chapter_label: CHAPTER_LABELS[code] || code,
            items: internalItems,
            subtotal_cost: round2(subtotalCost),
            subtotal_sale: round2(subtotalSale),
            margin_percent: round2(marginPct),
            confidence_avg: round2(confidenceAvg),
        };
    });
    // Totals
    const materialsCost = items.reduce((s, i) => s + i.material_cost_per_unit * i.quantity, 0);
    const laborCost = items.reduce((s, i) => s + i.labor_cost_per_unit * i.quantity, 0);
    const machineryCost = items.reduce((s, i) => s + i.machinery_cost_per_unit * i.quantity, 0);
    const totalHours = items.reduce((s, i) => s + i.labor_hours_per_unit * i.quantity, 0);
    const directCost = items.reduce((s, i) => s + i.subtotal_cost, 0);
    const wasteCost = economics?.cost_breakdown.waste_management ?? 0;
    const indirectCosts = economics?.cost_breakdown.indirect_costs ?? 0;
    const totalCost = directCost + indirectCosts + wasteCost;
    const saleSubtotal = items.reduce((s, i) => s + i.subtotal_sale, 0);
    const taxAmount = saleSubtotal * (preferences.tax_percent / 100);
    const saleTotal = saleSubtotal + taxAmount;
    const profit = saleSubtotal - totalCost;
    const marginPct = saleSubtotal > 0 ? (profit / saleSubtotal) * 100 : 0;
    // High-risk items: confidence < 0.5
    const highRiskItems = items
        .filter((i) => i.confidence_score < 0.5)
        .map((i) => `${i.code} ${i.name}`);
    // Duration
    const durationWeeks = timeline
        ? `${timeline.estimated_duration.weeks_min}-${timeline.estimated_duration.weeks_max}`
        : "N/D";
    const workersRecommended = timeline?.recommended_crew.workers_total ?? 0;
    const totals = {
        direct_cost: round2(directCost),
        materials_cost: round2(materialsCost),
        labor_cost: round2(laborCost),
        machinery_cost: round2(machineryCost),
        waste_cost: round2(wasteCost),
        indirect_costs: round2(indirectCosts),
        total_cost: round2(totalCost),
        sale_subtotal: round2(saleSubtotal),
        tax_amount: round2(taxAmount),
        sale_total: round2(saleTotal),
        profit: round2(profit),
        margin_percent: round2(marginPct),
        total_hours: round2(totalHours),
        duration_weeks_estimate: durationWeeks,
        workers_recommended: workersRecommended,
        high_risk_items: highRiskItems,
    };
    const overallConfidence = items.length > 0
        ? items.reduce((s, i) => s + i.confidence_score, 0) / items.length
        : 0;
    return {
        chapters,
        totals,
        timeline_summary: {
            duration_weeks: durationWeeks,
            workers: workersRecommended,
            critical_risks: timeline?.risks?.slice(0, 5) || [],
        },
        confidence: {
            overall: round2(overallConfidence),
            high_risk_items: highRiskItems,
        },
    };
}
// ─── Utility ────────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
