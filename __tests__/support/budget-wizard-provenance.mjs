// Relevant source tables and actual deployed migrations; no stored provenance
// is seeded. The resolver must produce it and the browser must transport it.
import { read } from '../lib/budget-revision-rpcs-bench.mjs';
import { originalBodies } from '../../scripts/g3-l1b-generate.mjs';
import { buildDeterministicBudgetItems, buildScopeMaterials } from '../../lib/budget-engine.ts';
import { planCatalogRows } from '../../lib/plans.ts';

export const provenanceScope = {
  superficie_m2: 40, num_banos: 0, incluye_cocina: false, incluye_ventanas: false,
  incluye_climatizacion: false, estancias: ['salon'], actuaciones: ['pintura'],
  calidad: 'media', ubicacion: 'Madrid', project_context: 'existing_renovation',
  existing_condition: 'good', conservation_strategy: 'balanced',
  occupied_during_works: false, building_age_band: 'post_2006',
};
export const provenanceClient = '33333333-3333-4333-8333-333333333333';

export async function prepareWizardProvenance(db) {
  await db.query(read('supabase/migrations/20261008120000_budget_items_price_provenance.sql'));
  await db.query(originalBodies().update);
  await db.query(read('supabase/migrations/20261008130000_budget_items_price_provenance_writers.sql'));
  await db.query(`
    alter table public.clients add column name text, add column email text,
      add column phone text, add column company text;
    alter table public.projects add column name text;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
    create table public.issued_invoices(id uuid primary key, user_id uuid);
    create table public.invoices(id uuid primary key, user_id uuid);
    create table public.messages(id uuid primary key, user_id uuid);
    create table public.scheduled_messages(id uuid primary key, user_id uuid);
    create table public.price_alerts(id uuid primary key, user_id uuid);
    create table public.price_items(id uuid primary key default gen_random_uuid(), user_id uuid,
      name text, unit text, unit_price numeric, supplier_name text, source_type text,
      is_manual_override boolean, is_active boolean, sector text, category text,
      source_url text, description text);
    create table public.n8n_updates(id uuid primary key, status text, created_at timestamptz,
      processed_at timestamptz, data jsonb, sector text, update_type text);
    create table public.technical_price_items(name text, item_code text, unit text,
      unit_price numeric, confidence_score numeric, source text, region text, is_active boolean);
    create table public.sector_data(title text, value numeric, unit text, source text,
      category text, sector text, data_type text, last_updated timestamptz);
    create table public.pb_providers(id uuid primary key, company_id uuid, name text,
      province text, supply_zones text[], is_preferred boolean, shipping_cost_flat numeric,
      minimum_order numeric, delivery_days_min integer, delivery_days_max integer);
    create table public.pb_products(id uuid primary key, provider_id uuid references public.pb_providers,
      sector text, is_active boolean, is_available boolean, unit_price numeric,
      commercial_name text, concept_id uuid, brand text, sku text, sale_unit text,
      units_per_package numeric, url text, source_url text, checked_at timestamptz);
    alter table public.price_items enable row level security;
    create policy price_items_owner_read on public.price_items for select to authenticated using(user_id=auth.uid());
    grant select on public.price_items,public.technical_price_items,public.sector_data,
      public.pb_providers,public.pb_products,public.clients,public.projects to authenticated;
    grant service_role to e2_authenticator;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `);
  await db.query('drop schema if exists billing_internal cascade');
  await db.query(read('supabase/migrations/20260924102515_billing_subscriptions_and_paywall.sql'));
  await db.query(read('supabase/migrations/20260928072843_billing_usage_summary.sql'));
  await db.query('grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role');
  for (const row of planCatalogRows()) await db.query(
    'insert into public.plan_catalog(plan,trial_days,limits,features) values($1,$2,$3,$4)',
    [row.plan, row.trial_days, row.limits, row.features]);
}

export async function seedWizardPriceSources(db, owner) {
  await db.query('insert into public.clients(id,user_id,name) values($1,$2,$3)',
    [provenanceClient, owner, 'Cliente de procedencia E2E']);
  const lines = [
    ...buildDeterministicBudgetItems(provenanceScope, 1).map(item => ({ name: item.concept, unit: item.unit, price: item.unit_price })),
    ...buildScopeMaterials(provenanceScope).map(item => ({ name: item.name, unit: item.unit, price: item.unit_price })),
  ];
  for (const line of lines) await db.query(`insert into public.price_items
    (user_id,name,unit,unit_price,supplier_name,source_type,is_manual_override,is_active,sector,category)
    values($1,$2,$3,$4,'Tarifa sintética E2E','manual',true,true,'construccion','otros')`,
    [owner, line.name, line.unit, line.price]);
}
