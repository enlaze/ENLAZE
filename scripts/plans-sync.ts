/**
 * Mantiene public.plan_catalog idéntica a lib/plans.ts (la fuente de verdad)
 * y comprueba que los precios de Stripe cuadran con los de lib/plans.ts.
 *
 *   npm run plans:sync    → escribe plan_catalog y después comprueba
 *   npm run plans:check   → solo comprueba; sale con código 1 si algo no cuadra
 *
 * plans:check se ejecuta solo en `npm run build` (script prebuild), así que un
 * despliegue con límites desincronizados falla en la cara, no cuando a alguien
 * se le ocurra lanzarlo.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  BILLING_INTERVALS,
  PAID_PLAN_IDS,
  planCatalogRows,
  priceCents,
  stripePriceEnvVar,
  type PlanCatalogRow,
} from "../lib/plans";

const mode = process.argv.includes("--write") ? "write" : "check";

function fail(message: string): never {
  console.error(`\n✖ plans:${mode}: ${message}\n`);
  process.exit(1);
}

/** JSON estable (claves ordenadas) para comparar sin falsos positivos. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalize(row: PlanCatalogRow) {
  return stable({
    plan: row.plan,
    trial_days: row.trial_days ?? null,
    limits: row.limits,
    features: [...row.features].sort(),
  });
}

async function checkDatabase(admin: SupabaseClient) {
  const expected = planCatalogRows();
  const { data, error } = await admin.from("plan_catalog").select("plan, trial_days, limits, features");
  if (error) fail(`no se pudo leer plan_catalog: ${error.message}`);

  const actual = new Map((data as PlanCatalogRow[]).map((r) => [r.plan, r]));
  const problems: string[] = [];
  for (const row of expected) {
    const db = actual.get(row.plan);
    if (!db) problems.push(`falta el plan "${row.plan}" en plan_catalog`);
    else if (normalize(db) !== normalize(row)) {
      problems.push(`el plan "${row.plan}" no coincide:\n    lib/plans.ts: ${normalize(row)}\n    base datos:   ${normalize(db)}`);
    }
    actual.delete(row.plan);
  }
  for (const extra of actual.keys()) problems.push(`plan_catalog tiene un plan que no está en lib/plans.ts: "${extra}"`);

  if (problems.length) {
    fail(`plan_catalog no coincide con lib/plans.ts. Ejecuta \`npm run plans:sync\`.\n  - ${problems.join("\n  - ")}`);
  }
  console.log(`✓ plan_catalog coincide con lib/plans.ts (${expected.length} planes)`);
}

async function checkStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn("⚠ STRIPE_SECRET_KEY no definida: no se comprueban los precios de Stripe (el cobro no funcionará).");
    return;
  }
  const stripe = new Stripe(key);
  const problems: string[] = [];
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const envVar = stripePriceEnvVar(plan, interval);
      const priceId = process.env[envVar];
      if (!priceId) {
        problems.push(`${envVar} no está definida`);
        continue;
      }
      try {
        const price = await stripe.prices.retrieve(priceId);
        const want = priceCents(plan, interval);
        if (price.unit_amount !== want) problems.push(`${envVar}: Stripe cobra ${price.unit_amount} céntimos, lib/plans.ts dice ${want}`);
        if (price.currency !== "eur") problems.push(`${envVar}: moneda ${price.currency}, se esperaba eur`);
        if (price.recurring?.interval !== interval || (price.recurring?.interval_count ?? 1) !== 1) {
          problems.push(`${envVar}: periodicidad ${price.recurring?.interval_count}×${price.recurring?.interval}, se esperaba 1×${interval}`);
        }
        if (!price.active) problems.push(`${envVar}: el precio está archivado en Stripe`);
      } catch (e) {
        problems.push(`${envVar}: no se pudo leer ${priceId} en Stripe (${(e as Error).message})`);
      }
    }
  }
  if (problems.length) fail(`los precios de Stripe no cuadran con lib/plans.ts:\n  - ${problems.join("\n  - ")}`);
  console.log(`✓ precios de Stripe coinciden con lib/plans.ts (${key.includes("_test_") ? "modo prueba" : "MODO REAL"})`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: sin ellas no se puede comprobar plan_catalog, y el build no sigue a ciegas.");
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (mode === "write") {
    const rows = planCatalogRows().map((r) => ({ ...r, synced_at: new Date().toISOString() }));
    const { error } = await admin.from("plan_catalog").upsert(rows, { onConflict: "plan" });
    if (error) fail(`no se pudo escribir plan_catalog: ${error.message}`);
    const keep = rows.map((r) => r.plan);
    const { error: delError } = await admin.from("plan_catalog").delete().not("plan", "in", `(${keep.join(",")})`);
    if (delError) fail(`no se pudieron borrar planes obsoletos: ${delError.message}`);
    console.log(`✓ plan_catalog escrita desde lib/plans.ts`);
  }

  await checkDatabase(admin);
  await checkStripe();
}

main().catch((e) => fail((e as Error).stack || String(e)));
