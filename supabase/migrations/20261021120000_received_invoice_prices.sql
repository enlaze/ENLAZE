-- Private invoice evidence. No backfill and no change to calculation/save RPCs.
-- price_item_id already transports a historical UUID. Its source discriminates
-- price_items (manual_locked/user_supplied) from received_invoice_lines below.
create table public.received_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.received_invoices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null,
  quantity numeric(18,6),
  unit text,
  unit_price numeric(18,6),
  amount numeric(18,2),
  -- Net invoiced amount includes the customer's discount, excludes VAT.
  -- Unknown units and credit/zero lines are retained but cannot supply prices.
  effective_unit_price numeric generated always as
    (case when quantity>0 and amount>0 and nullif(btrim(unit),'') is not null
      then round(amount/quantity,2) else null end) stored,
  created_at timestamptz not null default now(),
  unique(invoice_id,line_number),
  check (quantity is null or quantity::text not in ('NaN','Infinity','-Infinity')),
  check (unit_price is null or unit_price::text not in ('NaN','Infinity','-Infinity')),
  check (amount is null or amount::text not in ('NaN','Infinity','-Infinity'))
);
create index received_invoice_prices_owner on public.received_invoice_lines(user_id,id)
  where effective_unit_price>0;
alter table public.received_invoice_lines enable row level security;
revoke all on public.received_invoice_lines from public,anon,authenticated;
grant select on public.received_invoice_lines to authenticated;
create policy received_invoice_lines_owner_read on public.received_invoice_lines
  for select to authenticated using (user_id=auth.uid() and exists (
    select 1 from public.received_invoices i where i.id=invoice_id
      and i.user_id=auth.uid() and i.deleted_at is null
  ));

-- The sole write boundary. Lock the parent, verify its owner and active account,
-- and keep identities on retries. No broad client INSERT/UPDATE/DELETE privileges.
create function public.save_received_invoice_lines(p_invoice_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $fn$
declare owner_id uuid; access_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.account_deletion_locks where user_id=auth.uid()) then
    raise exception 'Account deletion in progress' using errcode='42501';
  end if;
  select user_id into owner_id from public.received_invoices
    where id=p_invoice_id and user_id=auth.uid() and deleted_at is null for update;
  if owner_id is null then raise exception 'Invoice owner required' using errcode='42501'; end if;
  -- Same write/paywall boundary as ordinary invoice writes (E5/E6).
  access_result := billing_internal.evaluate(owner_id,null,0,null,false,null);
  if not coalesce((access_result->>'ok')::boolean,false) then
    raise exception 'Account is read only' using errcode='PT402';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>2000 then
    raise exception 'Invoice lines must be an array of at most 2000 rows' using errcode='22023';
  end if;
  insert into public.received_invoice_lines(invoice_id,user_id,line_number,description,quantity,unit,unit_price,amount)
  select p_invoice_id,owner_id,n::integer,coalesce(x->>'description',''),
    nullif(x->>'quantity','')::numeric,nullif(btrim(x->>'unit'),''),
    nullif(x->>'unit_price','')::numeric,nullif(x->>'amount','')::numeric
  from jsonb_array_elements(p_lines) with ordinality as t(x,n)
  on conflict(invoice_id,line_number) do update set description=excluded.description,
    quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,amount=excluded.amount;
  delete from public.received_invoice_lines where invoice_id=p_invoice_id
    and line_number>jsonb_array_length(p_lines);
end $fn$;
revoke all on function public.save_received_invoice_lines(uuid,jsonb) from public,anon;
grant execute on function public.save_received_invoice_lines(uuid,jsonb) to authenticated;

-- Historical identities deliberately have no invoice/budget FK: deleting either
-- must not erase the evidence that a private price was used. Account deletion
-- does remove this user's private telemetry.
create table public.invoice_price_usage_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_line_id uuid not null,
  budget_id uuid not null,
  occurred_at timestamptz not null default now(),
  primary key(user_id,invoice_line_id,budget_id)
);
alter table public.invoice_price_usage_events enable row level security;
revoke all on public.invoice_price_usage_events from public,anon,authenticated;
grant select on public.invoice_price_usage_events to authenticated;
create policy invoice_price_usage_owner_read on public.invoice_price_usage_events
  for select to authenticated using(user_id=auth.uid());

create function budget_internal.record_invoice_price_reuse()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if new.price_source_type is distinct from 'received_invoice' or new.price_item_id is null then return new; end if;
  insert into public.invoice_price_usage_events(user_id,invoice_line_id,budget_id)
  select b.user_id,l.id,b.id from public.budgets b
  join public.received_invoice_lines l on l.id=new.price_item_id and l.user_id=b.user_id
  join public.received_invoices i on i.id=l.invoice_id and i.user_id=b.user_id
  where b.id=new.budget_id and b.user_id=auth.uid() and i.deleted_at is null
    and i.status<>'rejected' and i.issue_date<=current_date
    and l.effective_unit_price>0 and new.unit is not null
    -- Same normalization as b1, including m/ml and u/un/ud. Apply to BOTH
    -- sides: the authenticated RPC also accepts explicitly supplied raw units.
    and 1=(select count(distinct case lower(btrim(u))
      when 'm²' then 'm2'
      when 'metros cuadrados' then 'm2'
      when 'metro cuadrado' then 'm2'
      when 'ml' then 'ml'
      when 'metros lineales' then 'ml'
      when 'metro lineal' then 'ml'
      when 'm³' then 'm3'
      when 'metros cubicos' then 'm3'
      when 'ud' then 'ud'
      when 'uds' then 'ud'
      when 'unidad' then 'ud'
      when 'unidades' then 'ud'
      when 'saco' then 'saco'
      when 'sacos' then 'saco'
      when 'rollo' then 'rollo'
      when 'rollos' then 'rollo'
      when 'cubo' then 'cubo'
      when 'cubos' then 'cubo'
      when 'bidon' then 'cubo'
      when 'lote' then 'lote'
      when 'kit' then 'lote'
      when 'conjunto' then 'lote'
      when 'pa' then 'pa'
      when 'partida alzada' then 'pa'
      when 'global' then 'pa'
      when 'kg' then 'kg'
      when 'kilogramo' then 'kg'
      when 'l' then 'l'
      when 'litro' then 'l'
      when 'litros' then 'l'
      when 'h' then 'h'
      when 'hora' then 'h'
      when 'horas' then 'h'
      when 'jornada' then 'jornada'
      when 'jornadas' then 'jornada'
      when 'punto' then 'punto'
      when 'puntos' then 'punto'
      when 'm' then 'ml'
      when 'u' then 'ud'
      when 'un' then 'ud'
      else lower(btrim(u)) end) from unnest(array[l.unit,new.unit]) units(u))
    and round(l.effective_unit_price,2)=new.unit_price_cost
    and new.price_checked_at::date=i.issue_date
  on conflict do nothing;
  return new;
end $fn$;
revoke all on function budget_internal.record_invoice_price_reuse() from public,anon,authenticated;
create trigger record_invoice_price_reuse after insert or update on public.budget_items
  for each row execute function budget_internal.record_invoice_price_reuse();

create function public.get_invoice_price_stats(p_since timestamptz default null)
returns jsonb language sql stable security invoker set search_path='' as $fn$
  select jsonb_build_object(
    'prices',(select count(*) from public.received_invoice_lines l
      join public.received_invoices i on i.id=l.invoice_id and i.user_id=auth.uid()
      where l.user_id=auth.uid() and l.effective_unit_price>0 and i.deleted_at is null
        and i.status<>'rejected' and i.issue_date<=current_date
        and (p_since is null or l.created_at>=p_since)),
    'reused',(select count(*) from public.invoice_price_usage_events
      where user_id=auth.uid() and (p_since is null or occurred_at>=p_since)))
$fn$;
revoke all on function public.get_invoice_price_stats(timestamptz) from public,anon;
grant execute on function public.get_invoice_price_stats(timestamptz) to authenticated;

comment on column public.budget_items.price_item_id is
  'Historical private source identity, discriminated by price_source_type: price_items for manual_locked/user_supplied; received_invoice_lines for received_invoice. No FK: deletion must not change budget provenance. Reuse validates owner, unit and adopted cost.';
comment on column public.budget_items.price_source_type is
  'G3. Procedencia del precio guardado. Valores esperados: manual_locked, received_invoice, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited, ai_estimate, user_supplied. received_invoice: precio neto de una factura propia, privado por usuario y con confianza que decae como historical_approved. NULL en una partida antigua = anterior a G3. NULL en una partida nueva = fallo.';
