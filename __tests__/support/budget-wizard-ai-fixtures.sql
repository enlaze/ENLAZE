-- Only additional model fixtures on the guarded real wizard bench.
create table public.ai_runs (
  user_id uuid, run_type text, model text, prompt_version text,
  input_hash text, output_hash text, tokens_in integer, tokens_out integer,
  duration_ms integer, entity_type text, entity_id uuid, created_at timestamptz default now()
);
-- A nonmatching product enables the real V2 resolver without web searches.
-- It cannot supply a price for the painting scope; no resolved price is forged.
insert into public.pb_providers (id,name) values
  ('22222222-2222-4222-8222-222222222222','Proveedor local E2E');
insert into public.pb_products (id,provider_id,commercial_name,unit_price,is_available,is_active,sector)
values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
  'Ascensor industrial hidráulico',10000,true,true,'construccion');
grant select, insert on public.ai_runs to authenticated, service_role;
