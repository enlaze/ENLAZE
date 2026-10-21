-- G3 phase 4. Pending review, no backfill of prices or budget lines.
alter table public.price_items add column collection_budget_id uuid references public.budgets(id) on delete set null;
alter table public.budget_items add column price_item_id uuid;
comment on column public.budget_items.price_item_id is
  'Historical price_items identity for an adopted own price. Deleting a bank price must not change budget provenance. Reuse metrics validate owner, unit and adopted amount against the bank.';

-- Instrumentation only: price amounts remain in the existing price_items bank.
create table public.user_price_collection_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  price_item_id uuid not null,
  budget_id uuid not null,
  event_kind text not null check (event_kind in ('saved', 'reused')),
  occurred_at timestamptz not null default now(),
  primary key (user_id, price_item_id, budget_id, event_kind)
);
create unique index user_price_collection_saved_once
  on public.user_price_collection_events(user_id, price_item_id) where event_kind='saved';
create index user_price_collection_event_dates
  on public.user_price_collection_events(user_id, occurred_at);
alter table public.user_price_collection_events enable row level security;
revoke all on table public.user_price_collection_events from public, anon, authenticated;
grant select on table public.user_price_collection_events to authenticated;
create policy user_price_collection_owner_read on public.user_price_collection_events
  for select to authenticated using (user_id = auth.uid());

create function budget_internal.record_collected_price()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if new.collection_budget_id is null or not coalesce(new.is_manual_override,false) then return new; end if;
  if new.user_id is distinct from auth.uid() or not exists (
    select 1 from public.budgets b where b.id=new.collection_budget_id and b.user_id=new.user_id
  ) then raise exception 'Own price collection requires the budget owner' using errcode='42501'; end if;
  insert into public.user_price_collection_events(user_id, price_item_id, budget_id, event_kind)
    values(new.user_id,new.id,new.collection_budget_id,'saved') on conflict do nothing;
  return new;
end $fn$;
revoke all on function budget_internal.record_collected_price() from public, anon, authenticated;
create trigger record_collected_price after insert or update on public.price_items
  for each row execute function budget_internal.record_collected_price();

create function budget_internal.record_own_price_reuse()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if new.price_source_type is distinct from 'manual_locked' or new.price_item_id is null then return new; end if;
  -- Same transaction as save_budget. Count each price once per later budget,
  -- never each lookup, rejected candidate, line duplication or autosave.
  insert into public.user_price_collection_events(user_id,price_item_id,budget_id,event_kind)
  select b.user_id,p.id,b.id,'reused'
  from public.budgets b join public.price_items p on p.id=new.price_item_id and p.user_id=b.user_id
  join public.user_price_collection_events saved on saved.user_id=p.user_id
    and saved.price_item_id=p.id and saved.event_kind='saved'
  where b.id=new.budget_id and b.user_id=auth.uid()
    and p.is_manual_override and p.is_active and p.unit=new.unit
    and round(p.unit_price,2)=new.unit_price_cost
    and saved.budget_id<>b.id and new.price_checked_at>=saved.occurred_at
  on conflict do nothing;
  return new;
end $fn$;
revoke all on function budget_internal.record_own_price_reuse() from public, anon, authenticated;
create trigger record_own_price_reuse after insert or update on public.budget_items
  for each row execute function budget_internal.record_own_price_reuse();

create function public.get_user_price_collection_stats(p_since timestamptz default null)
returns jsonb language sql stable security invoker set search_path='' as $fn$
  select jsonb_build_object(
    'saved',count(*) filter (where event_kind='saved'),
    'reused',count(*) filter (where event_kind='reused'))
  from public.user_price_collection_events
  where user_id=auth.uid() and (p_since is null or occurred_at>=p_since)
$fn$;
revoke all on function public.get_user_price_collection_stats(timestamptz) from public, anon;
grant execute on function public.get_user_price_collection_stats(timestamptz) to authenticated;

-- The existing revision writer below carries the bank identity, with the same
-- validation, authorization boundary and ACL as before.

create or replace function budget_internal.replace_items(p_id uuid, p_items jsonb)
returns integer language plpgsql security invoker set search_path = '' as $fn$
declare x jsonb; k text; n numeric; v_count integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or nullif(btrim(x->>'concept'), '') is null then
      raise exception 'Each item needs concept' using errcode = '22023';
    end if;
    foreach k in array array['quantity','unit_price','subtotal','unit_price_cost','subtotal_cost','canonical_confidence'] loop
      if k in ('quantity','unit_price') and nullif(x->>k, '') is null then
        raise exception 'Item requires %', k using errcode = '22023';
      end if;
      if nullif(x->>k, '') is not null then
        begin n := (x->>k)::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'Invalid item %', k using errcode = '22023';
        end;
        if n::text in ('NaN','Infinity','-Infinity') then raise exception 'Item % must be finite', k using errcode = '22023'; end if;
      end if;
    end loop;
  end loop;
  delete from public.budget_items where budget_id = p_id;
  insert into public.budget_items (
    budget_id, sort_order, concept, description, quantity, unit, category, chapter,
    unit_price, subtotal, unit_price_cost, subtotal_cost, canonical_id,
    canonical_status, canonical_confidence, canonical_source, canonical_origin,
    canonical_source_ref, price_type, price_source_type,
    price_confidence, price_checked_at, price_item_id)
  select p_id, (t.ordinality - 1)::integer, btrim(t.item->>'concept'),
    coalesce(t.item->>'description', ''), (t.item->>'quantity')::numeric,
    coalesce(nullif(t.item->>'unit', ''), 'ud'),
    coalesce(nullif(t.item->>'category', ''), 'otros'), nullif(t.item->>'chapter', ''),
    (t.item->>'unit_price')::numeric,
    coalesce(nullif(t.item->>'subtotal', '')::numeric,
      round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)),
    coalesce(nullif(t.item->>'unit_price_cost', '')::numeric, 0),
    coalesce(nullif(t.item->>'subtotal_cost', '')::numeric,
      round((t.item->>'quantity')::numeric * coalesce(nullif(t.item->>'unit_price_cost', '')::numeric, 0), 2)),
    nullif(t.item->>'canonical_id', ''),
    coalesce(nullif(t.item->>'canonical_status', ''), 'unmatched'),
    nullif(t.item->>'canonical_confidence', '')::numeric,
    nullif(t.item->>'canonical_source', ''), nullif(t.item->>'canonical_origin', ''),
    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', ''),
    nullif(t.item->>'price_source_type', ''),
    nullif(t.item->>'price_confidence', '')::numeric,
    nullif(t.item->>'price_checked_at', '')::timestamptz,
    nullif(t.item->>'price_item_id', '')::uuid
  from jsonb_array_elements(p_items) with ordinality t(item, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;

comment on column public.budget_items.price_source_type is
  'G3. Procedencia del precio guardado: nivel elegido por el resolutor, ai_estimate si lo propone la IA sin fuente tecnica (confianza 0.20), user_supplied si la persona aporta su propio precio (confianza 0.95), o user_edited si cambia solo el importe. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited, ai_estimate, user_supplied. NULL en una partida antigua = anterior a G3; no significa que careciera de fuente. NULL en una partida nueva = fallo.';
