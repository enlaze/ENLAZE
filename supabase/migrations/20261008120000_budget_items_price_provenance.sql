-- G3 lote 1a: espacio para la procedencia del precio de cada partida.
-- Solo esquema. El lote 1b conectará los escritores; aquí no se altera ningún importe.

alter table public.budget_items
  add column if not exists price_source_type text,
  add column if not exists price_confidence numeric(3,2),
  add column if not exists price_checked_at timestamptz;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budget_items'::regclass
      and conname = 'ck_budget_items_price_confidence_range'
  ) then
    alter table public.budget_items
      add constraint ck_budget_items_price_confidence_range check (
        price_confidence is null
        or (price_confidence >= 0 and price_confidence <= 1)
      );
  end if;
end;
$constraint$;

comment on column public.budget_items.price_source_type is
  'G3. Nivel que eligio el resolutor para el precio. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated. NULL = partida anterior a G3; no significa que careciera de fuente.';
comment on column public.budget_items.price_confidence is
  'G3. Confianza del precio resuelto entre 0 y 1. NULL = partida anterior a G3; no significa confianza desconocida en una partida nueva.';
comment on column public.budget_items.price_checked_at is
  'G3. Fecha de comprobacion de la fuente del precio. NULL = partida anterior a G3; no significa que la fuente no tuviera fecha.';

notify pgrst, 'reload schema';
