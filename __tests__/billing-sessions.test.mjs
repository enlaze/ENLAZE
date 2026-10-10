/** Contratos de parámetros: sin red, credenciales ni base de datos. */
import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSessionParams, ensurePortalTaxConfiguration } from "../lib/billing-sessions.ts";
import { BILLING_INTERVALS, PAID_PLAN_IDS, PRICES_INCLUDE_VAT } from "../lib/plans.ts";

test("Checkout añade impuestos a los seis precios sin IVA y conserva la suscripción", () => {
  assert.equal(PRICES_INCLUDE_VAT, false);
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const priceId = `price_${plan}_${interval}`;
      const session = checkoutSessionParams({
        customerId: "cus_existing", userId: "user_1", priceId, plan, interval, siteUrl: "https://enlaze.example",
      });
      assert.deepEqual(session, {
        mode: "subscription",
        customer: "cus_existing",
        client_reference_id: "user_1",
        line_items: [{ price: priceId, quantity: 1 }],
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        customer_update: { address: "auto", name: "auto" },
        tax_id_collection: { enabled: true },
        subscription_data: { metadata: { user_id: "user_1", plan, interval } },
        metadata: { user_id: "user_1", plan, interval },
        integration_identifier: "enlaze-suscripciones-qmxvtrla",
        success_url: "https://enlaze.example/dashboard/settings/plan?billing=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://enlaze.example/dashboard/settings/plan?billing=cancel",
      });
    }
  }
});

function portalConfiguration(customerUpdate) {
  return {
    id: "bpc_default",
    features: {
      customer_update: customerUpdate,
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, products: [{ product: "prod_basico", prices: ["price_basico_month"] }] },
    },
  };
}

function configurationStore(configuration) {
  const updates = [];
  return {
    updates,
    async list(params) {
      assert.deepEqual(params, { active: true, is_default: true, limit: 1 });
      return { data: configuration ? [configuration] : [] };
    },
    async update(id, params) {
      assert.equal(id, configuration.id);
      updates.push(params);
      configuration.features.customer_update = params.features.customer_update;
      return configuration;
    },
  };
}

test("el portal habilita datos fiscales conservando campos y funciones existentes", async () => {
  const configuration = portalConfiguration({ enabled: false, allowed_updates: ["email", "phone", "address"] });
  const previous = structuredClone(configuration.features);
  const store = configurationStore(configuration);

  assert.equal(await ensurePortalTaxConfiguration(store), "bpc_default");
  assert.deepEqual(store.updates, [{
    features: { customer_update: { enabled: true, allowed_updates: ["email", "phone", "address", "name", "tax_id"] } },
  }]);
  for (const feature of ["invoice_history", "payment_method_update", "subscription_cancel", "subscription_update"]) {
    assert.deepEqual(configuration.features[feature], previous[feature]);
  }
  await ensurePortalTaxConfiguration(store);
  assert.equal(store.updates.length, 1, "no vuelve a escribir una configuración ya preparada");
});

test("el portal completa tax_id aunque la edición de cliente ya esté habilitada", async () => {
  const store = configurationStore(portalConfiguration({ enabled: true, allowed_updates: ["name", "address"] }));
  assert.equal(await ensurePortalTaxConfiguration(store), "bpc_default");
  assert.deepEqual(store.updates, [{
    features: { customer_update: { enabled: true, allowed_updates: ["name", "address", "tax_id"] } },
  }]);
});

test("el portal reactiva la edición aunque los tres campos ya estén permitidos", async () => {
  const store = configurationStore(portalConfiguration({ enabled: false, allowed_updates: ["name", "address", "tax_id"] }));
  assert.equal(await ensurePortalTaxConfiguration(store), "bpc_default");
  assert.equal(store.updates[0].features.customer_update.enabled, true);
});

test("sin configuración predeterminada no se inventa ni crea otra", async () => {
  const store = configurationStore(null);
  assert.equal(await ensurePortalTaxConfiguration(store), null);
  assert.deepEqual(store.updates, []);
});

test("si Stripe rechaza la configuración, no se devuelve una configuración incompleta", async () => {
  const store = configurationStore(portalConfiguration({ enabled: false, allowed_updates: [] }));
  store.update = async () => { throw new Error("configuración rechazada"); };
  await assert.rejects(ensurePortalTaxConfiguration(store), /configuración rechazada/);
});
