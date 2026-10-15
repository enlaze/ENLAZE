-- Dependencies of the real analysis route in the guarded disposable E2 bench.
-- Billing eligibility is a fixture (no Stripe). Budget writers are NEVER stubbed.
grant service_role to e2_authenticator;
create function public.billing_consume(p_user_id uuid, p_resource text, p_amount integer,
  p_feature text, p_source text) returns jsonb language sql as $$
  select '{"ok":true,"access_level":"full","plan":"pro","status":"active"}'::jsonb
$$;
grant execute on function public.billing_consume(uuid,text,integer,text,text) to service_role;
create table public.ai_runs (
  user_id uuid, run_type text, model text, prompt_version text,
  input_hash text, output_hash text, tokens_in integer, tokens_out integer,
  duration_ms integer, entity_type text, entity_id uuid, created_at timestamptz default now()
);
create table public.price_items (
  id uuid, user_id uuid, name text, category text, unit_price numeric, unit text,
  supplier_name text, source_type text, source_url text, description text,
  sector text, is_active boolean, is_manual_override boolean
);
create table public.sector_data (
  title text, value numeric, unit text, source text, category text,
  sector text, data_type text, last_updated timestamptz
);
create table public.technical_price_items (
  name text, item_code text, unit text, unit_price numeric, confidence_score numeric,
  source text, region text, is_active boolean
);
create table public.pb_providers (
  id uuid primary key, company_id uuid, name text, province text, supply_zones text[],
  is_preferred boolean, shipping_cost_flat numeric, minimum_order numeric,
  delivery_days_min integer, delivery_days_max integer
);
create table public.pb_products (
  id uuid primary key, provider_id uuid references public.pb_providers(id),
  commercial_name text, concept_id uuid, brand text, sku text, sale_unit text,
  units_per_package numeric, unit_price numeric, url text, source_url text,
  checked_at timestamptz, is_available boolean, is_active boolean, sector text
);
-- A nonmatching product enables the real V2 resolver without web searches.
-- It cannot supply a price for the painting scope; no resolved price is forged.
insert into public.pb_providers (id,name) values
  ('22222222-2222-4222-8222-222222222222','Proveedor local E2E');
insert into public.pb_products (id,provider_id,commercial_name,unit_price,is_available,is_active,sector)
values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
  'Ascensor industrial hidráulico',10000,true,true,'construccion');
grant select on public.price_items, public.sector_data, public.technical_price_items,
  public.pb_providers, public.pb_products to authenticated, service_role;
grant select, insert on public.ai_runs to authenticated, service_role;
