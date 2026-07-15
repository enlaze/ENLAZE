"use strict";
/**
 * Tests for lib/budget-pdf-v2.ts
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/budget-pdf-v2.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const budget_pdf_v2_1 = require("../../lib/budget-pdf-v2");
// ─── Test data ──────────────────────────────────────────────────────────────
function mockClientView() {
    return {
        company: {
            name: "Reformas Madrid SL",
            nif: "B12345678",
            address: "Calle Mayor 10, Madrid",
            phone: "600111222",
            email: "info@reformasmadrid.es",
        },
        client: {
            name: "Juan Garcia",
            nif: "12345678A",
            address: "Calle Menor 5, Madrid",
            email: "juan@example.com",
            phone: "600333444",
        },
        project: {
            description: "Reforma integral piso 90m2",
            location: "Madrid",
            budget_number: "PRE-TEST001",
            date: "2026-07-14",
            validity_days: 30,
        },
        chapters: [
            {
                name: "Demoliciones",
                order: 1,
                items: [
                    {
                        code: "02.DEM.001",
                        name: "Demolicion tabiqueria",
                        description: "Demolicion de tabiqueria interior",
                        unit: "m2",
                        quantity: 45,
                        unit_price: 12.13,
                        subtotal: 545.85,
                    },
                ],
                subtotal: 545.85,
            },
            {
                name: "Pintura",
                order: 2,
                items: [
                    {
                        code: "10.PIN.001",
                        name: "Pintura plastica blanca",
                        description: "Pintura plastica lisa dos manos",
                        unit: "m2",
                        quantity: 200,
                        unit_price: 8.13,
                        subtotal: 1626.0,
                    },
                ],
                subtotal: 1626.0,
            },
        ],
        subtotal: 2171.85,
        tax_percent: 21,
        tax_amount: 456.09,
        total: 2627.94,
        payment_terms: "50% inicio, 50% finalizacion",
        conditions: [
            "Presupuesto valido 30 dias",
            "No incluye permisos municipales",
        ],
        exclusions: [
            "Climatizacion",
            "Carpinteria exterior",
        ],
    };
}
function mockInternalView() {
    return {
        chapters: [
            {
                chapter: "demoliciones",
                chapter_label: "Demoliciones y retiradas",
                items: [
                    {
                        code: "02.DEM.001",
                        name: "Demolicion tabiqueria",
                        unit: "m2",
                        quantity: 45,
                        material_cost: 0.5,
                        labor_cost: 8.0,
                        labor_hours: 0.35,
                        machinery_cost: 1.2,
                        unit_cost: 9.7,
                        subtotal_cost: 436.5,
                        unit_price_sale: 12.13,
                        subtotal_sale: 545.85,
                        margin_percent: 25,
                        profit: 109.35,
                        supplier: null,
                        price_source: "technical_bank",
                        confidence: 0.85,
                        risk: "bajo",
                    },
                ],
                subtotal_cost: 436.5,
                subtotal_sale: 545.85,
                margin_percent: 25,
                confidence_avg: 0.85,
            },
        ],
        totals: {
            direct_cost: 436.5,
            materials_cost: 22.5,
            labor_cost: 360.0,
            machinery_cost: 54.0,
            waste_cost: 0,
            indirect_costs: 26.19,
            total_cost: 462.69,
            sale_subtotal: 545.85,
            tax_amount: 114.63,
            sale_total: 660.48,
            profit: 109.35,
            margin_percent: 25,
            total_hours: 15.75,
            duration_weeks_estimate: "1-2 semanas",
            workers_recommended: 2,
            high_risk_items: [],
        },
        timeline_summary: {
            duration_weeks: "1-2 semanas",
            workers: 2,
            critical_risks: [],
        },
        confidence: {
            overall: 0.85,
            high_risk_items: [],
        },
    };
}
// ─── generateClientPdfHtml ──────────────────────────────────────────────────
(0, node_test_1.describe)("generateClientPdfHtml", () => {
    (0, node_test_1.it)("generates valid HTML with DOCTYPE", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.startsWith("<!DOCTYPE html>"));
        strict_1.default.ok(html.includes("</html>"));
    });
    (0, node_test_1.it)("includes company info", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("Reformas Madrid SL"));
        strict_1.default.ok(html.includes("B12345678"));
    });
    (0, node_test_1.it)("includes client info", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("Juan Garcia"));
        strict_1.default.ok(html.includes("juan@example.com"));
    });
    (0, node_test_1.it)("includes budget number and project", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("PRE-TEST001"));
        strict_1.default.ok(html.includes("Reforma integral piso 90m2"));
    });
    (0, node_test_1.it)("includes chapter items with prices", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("Demolicion tabiqueria"));
        strict_1.default.ok(html.includes("Pintura plastica blanca"));
        strict_1.default.ok(html.includes("12.13"));
        strict_1.default.ok(html.includes("545.85"));
    });
    (0, node_test_1.it)("includes IVA and total", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("IVA (21%)"));
        strict_1.default.ok(html.includes("2.627.94")); // formatted with dots
    });
    (0, node_test_1.it)("includes conditions and exclusions", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(html.includes("Presupuesto valido 30 dias"));
        strict_1.default.ok(html.includes("Climatizacion"));
        strict_1.default.ok(html.includes("No incluido"));
    });
    (0, node_test_1.it)("does NOT include internal data", () => {
        const html = (0, budget_pdf_v2_1.generateClientPdfHtml)(mockClientView());
        strict_1.default.ok(!html.includes("Coste directo"));
        strict_1.default.ok(!html.includes("USO INTERNO"));
        strict_1.default.ok(!html.includes("escandallo"));
    });
});
// ─── generateInternalPdfHtml ────────────────────────────────────────────────
(0, node_test_1.describe)("generateInternalPdfHtml", () => {
    (0, node_test_1.it)("generates valid HTML", () => {
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(mockInternalView());
        strict_1.default.ok(html.startsWith("<!DOCTYPE html>"));
    });
    (0, node_test_1.it)("includes USO INTERNO badge", () => {
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(mockInternalView());
        strict_1.default.ok(html.includes("USO INTERNO"));
        strict_1.default.ok(html.includes("CONFIDENCIAL"));
    });
    (0, node_test_1.it)("includes cost breakdown", () => {
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(mockInternalView());
        strict_1.default.ok(html.includes("Coste directo"));
        strict_1.default.ok(html.includes("Materiales"));
        strict_1.default.ok(html.includes("Mano de obra"));
    });
    (0, node_test_1.it)("includes margin and confidence metrics", () => {
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(mockInternalView());
        strict_1.default.ok(html.includes("Margen"));
        strict_1.default.ok(html.includes("Fiabilidad"));
        strict_1.default.ok(html.includes("85%")); // confidence
    });
    (0, node_test_1.it)("includes labor hours", () => {
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(mockInternalView());
        strict_1.default.ok(html.includes("15.8") || html.includes("15.75")); // total_hours
        strict_1.default.ok(html.includes("Horas totales"));
    });
    (0, node_test_1.it)("shows high-risk items warning when present", () => {
        const view = mockInternalView();
        view.confidence.high_risk_items = ["Partida estimada sin precio fiable"];
        const html = (0, budget_pdf_v2_1.generateInternalPdfHtml)(view);
        strict_1.default.ok(html.includes("alto riesgo"));
        strict_1.default.ok(html.includes("Partida estimada sin precio fiable"));
    });
});
