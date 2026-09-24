import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  LIMITED_RESOURCES,
  LIMITS,
  PAID_PLAN_IDS,
  PAY_PER_USE_RESOURCES,
  PLAN_IDS,
  TRIAL_DAYS,
  limitPeriod,
  planCatalogRows,
  planHasFeature,
  planLimit,
  priceCents,
  stripePriceEnvVar,
} from "../lib/plans.ts";

test("lo que nos cuesta dinero por uso NUNCA es ilimitado en ningún plan", () => {
  for (const plan of PLAN_IDS) {
    for (const resource of PAY_PER_USE_RESOURCES) {
      const limit = planLimit(plan, resource);
      assert.ok(
        Number.isInteger(limit) && limit > 0,
        `${plan}.${resource} es ${limit}: WhatsApp, emails e IA deben tener tope`,
      );
    }
  }
});

test("precios: 29/59/179 al mes y anual con un 20% de descuento sobre 12 meses", () => {
  assert.equal(priceCents("basico", "month"), 2900);
  assert.equal(priceCents("profesional", "month"), 5900);
  assert.equal(priceCents("empresa", "month"), 17900);
  assert.equal(priceCents("basico", "year"), 27840);
  assert.equal(priceCents("profesional", "year"), 56640);
  assert.equal(priceCents("empresa", "year"), 171840);
});

test("prueba: 5 días y todo el total de la prueba, no por mes", () => {
  assert.equal(TRIAL_DAYS, 5);
  assert.deepEqual(LIMITS.prueba, {
    clientes: 10, presupuestos: 5, facturas: 5, whatsapp: 20, emails: 50, escaneos_ocr: 10, mensajes_asistente: 30,
  });
  assert.equal(limitPeriod("prueba", "presupuestos"), "trial");
  assert.equal(limitPeriod("prueba", "whatsapp"), "trial");
});

test("planes de pago: por mes natural, salvo clientes que es un stock", () => {
  for (const plan of PAID_PLAN_IDS) {
    assert.equal(limitPeriod(plan, "clientes"), "stock");
    for (const r of LIMITED_RESOURCES.filter((r) => r !== "clientes")) {
      assert.equal(limitPeriod(plan, r), "month", `${plan}.${r}`);
    }
  }
  assert.equal(limitPeriod("prueba", "clientes"), "stock");
});

test("OCR y asistente: contadores propios con sus números (no cuentan contra facturas ni presupuestos)", () => {
  const expect = {
    prueba: [10, 30], basico: [30, 100], profesional: [150, 500], empresa: [500, 2000],
  };
  for (const [plan, [ocr, asis]] of Object.entries(expect)) {
    assert.equal(planLimit(plan, "escaneos_ocr"), ocr, `${plan} escaneos_ocr`);
    assert.equal(planLimit(plan, "mensajes_asistente"), asis, `${plan} mensajes_asistente`);
  }
  assert.ok(PAY_PER_USE_RESOURCES.includes("escaneos_ocr"));
  assert.ok(PAY_PER_USE_RESOURCES.includes("mensajes_asistente"));
  assert.equal(limitPeriod("basico", "escaneos_ocr"), "month");
  assert.equal(limitPeriod("prueba", "mensajes_asistente"), "trial");
});

test("las generaciones con IA llevan el mismo tope que los presupuestos", () => {
  for (const plan of PLAN_IDS) {
    assert.equal(planLimit(plan, "generaciones_ia"), planLimit(plan, "presupuestos"));
  }
});

test("usuarios no es un límite del producto", () => {
  for (const plan of PLAN_IDS) {
    assert.ok(!("usuarios" in LIMITS[plan]));
  }
});

test("funciones: la prueba lo tiene todo; básico no tiene briefing, precios ni programación", () => {
  for (const f of FEATURES) assert.ok(planHasFeature("prueba", f), `prueba sin ${f}`);
  for (const f of ["briefing_diario", "seguimiento_precios", "programacion_envios"]) {
    assert.equal(planHasFeature("basico", f), false, `basico con ${f}`);
    assert.ok(planHasFeature("profesional", f));
    assert.ok(planHasFeature("empresa", f));
  }
  for (const f of ["clientes", "presupuestos", "facturas", "firma", "portal_cliente"]) {
    for (const plan of PLAN_IDS) assert.ok(planHasFeature(plan, f), `${plan} sin ${f}`);
  }
});

test("price IDs solo por variable de entorno, una por plan y periodicidad", () => {
  assert.equal(stripePriceEnvVar("basico", "month"), "STRIPE_PRICE_BASICO_MONTHLY");
  assert.equal(stripePriceEnvVar("empresa", "year"), "STRIPE_PRICE_EMPRESA_YEARLY");
});

test("planCatalogRows refleja exactamente los límites (lo que se copia a la BD)", () => {
  const rows = planCatalogRows();
  assert.deepEqual(rows.map((r) => r.plan), [...PLAN_IDS]);
  const empresa = rows.find((r) => r.plan === "empresa");
  assert.deepEqual(empresa.limits.clientes, { max: null, period: "stock" });
  assert.deepEqual(empresa.limits.whatsapp, { max: 1500, period: "month" });
  assert.equal(rows.find((r) => r.plan === "prueba").trial_days, 5);
  assert.equal(empresa.trial_days, null);
});
