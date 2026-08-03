-- Allow authenticated budget users to read the shared price tracker.
-- Writes remain restricted to the ingestion/service-role endpoints.

alter table public.pb_providers enable row level security;
alter table public.pb_products enable row level security;
alter table public.pb_price_current enable row level security;

drop policy if exists "budget_users_read_market_providers" on public.pb_providers;
create policy "budget_users_read_market_providers"
on public.pb_providers
for select
to authenticated
using (
  company_id is null
  or company_id = auth.uid()
);

drop policy if exists "budget_users_read_market_products" on public.pb_products;
create policy "budget_users_read_market_products"
on public.pb_products
for select
to authenticated
using (
  exists (
    select 1
    from public.pb_providers provider
    where provider.id = pb_products.provider_id
      and (
        provider.company_id is null
        or provider.company_id = auth.uid()
      )
  )
);

drop policy if exists "budget_users_read_current_prices" on public.pb_price_current;
create policy "budget_users_read_current_prices"
on public.pb_price_current
for select
to authenticated
using (
  exists (
    select 1
    from public.pb_products product
    join public.pb_providers provider on provider.id = product.provider_id
    where product.id = pb_price_current.product_id
      and (
        provider.company_id is null
        or provider.company_id = auth.uid()
      )
  )
);
