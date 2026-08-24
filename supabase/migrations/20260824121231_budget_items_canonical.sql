-- Fase 2 · 7/8 · Columnas canónicas en budget_items.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 5.
--
-- SIETE columnas. NO se añaden is_client_line ni parent_item_id: son piezas del rediseño
-- de la persistencia del escandallo y eso es Fase 4. Aquí solo entra lo necesario para
-- identidad, matching, detección de duplicados y procedencia.
--
-- canonical_origin y canonical_source_ref existen porque el diseño exige que una
-- resolución source-specific solo se ejecute si hay EVIDENCIA PERSISTIDA del origen. Sin
-- persistirlo no hay evidencia, solo suposición.
--
-- IMPACTO SOBRE LAS 807 FILAS EXISTENTES: cero. Todas las columnas son nullable o tienen
-- default constante, así que son ADD COLUMN de solo metadatos. Ningún importe se toca.
-- Las 807 filas quedan en la rama 'unmatched' del CHECK de coherencia.
--
-- LOS DOS CHECK SE ESCRIBEN CON CASE ... ELSE false, NO CON 'OR' ENCADENADOS.
-- Motivo: en PostgreSQL un CHECK que evalúa a NULL se considera SATISFECHO. Con
-- disyuntivos, una fila como (canonical_origin NULL, canonical_source_ref 'cype') haría
-- que todas las ramas dieran NULL o false y el CHECK la aceptaría. El CASE lo impide
-- porque siempre devuelve true o false.
--
-- Depende de: 20260824095816_canonical_concepts.sql

begin;

-- ── Columnas ──────────────────────────────────────────────────────────────────
alter table public.budget_items
  add column if not exists canonical_id         text,
  add column if not exists canonical_status     text not null default 'unmatched',
  add column if not exists canonical_confidence numeric(3,2),
  add column if not exists canonical_source     text,
  add column if not exists canonical_origin     text,
  add column if not exists canonical_source_ref text,
  add column if not exists price_type           text;

comment on column public.budget_items.canonical_id is
  'Fase 2. Identificador canónico en texto (no uuid): este es el registro económico auditable y un id legible permite ver un duplicado a simple vista.';
comment on column public.budget_items.canonical_origin is
  'Fase 2. Procedencia REAL de la línea. legacy = histórico sin procedencia demostrable; no se le inventa una.';
comment on column public.budget_items.canonical_source is
  'Fase 2. Qué alias ganó la resolución. Es una afirmación sobre el alias, no sobre la procedencia de la línea: eso es canonical_origin.';

-- ── Integridad referencial ────────────────────────────────────────────────────
alter table public.budget_items
  drop constraint if exists budget_items_canonical_id_fkey;
alter table public.budget_items
  add  constraint budget_items_canonical_id_fkey
       foreign key (canonical_id)
       references public.canonical_concepts(canonical_id);

-- ── Vocabularios cerrados ─────────────────────────────────────────────────────
alter table public.budget_items drop constraint if exists ck_budget_items_canonical_status;
alter table public.budget_items add  constraint ck_budget_items_canonical_status check (
  canonical_status in ('unmatched','resolved','review','ambiguous')
);

alter table public.budget_items drop constraint if exists ck_budget_items_canonical_source;
alter table public.budget_items add  constraint ck_budget_items_canonical_source check (
  canonical_source is null or canonical_source in (
    'override',        -- un humano fijó el canonical_id directamente en la línea
    'generator',       -- el generador lo emitió sin pasar por alias
    'exact_manual',    -- alias exacto, procedencia manual de empresa
    'exact_curated',
    'exact_engine',
    'exact_import',
    'exact_provider',
    'synonym',
    'fingerprint'
  )
);

alter table public.budget_items drop constraint if exists ck_budget_items_canonical_origin;
alter table public.budget_items add  constraint ck_budget_items_canonical_origin check (
  canonical_origin is null
  or canonical_origin in ('engine','import','provider','free_text','legacy')
);

alter table public.budget_items drop constraint if exists ck_budget_items_source_ref_format;
alter table public.budget_items add  constraint ck_budget_items_source_ref_format check (
  canonical_source_ref is null or canonical_source_ref ~ '^[a-z0-9][a-z0-9_-]*$'
);

alter table public.budget_items drop constraint if exists ck_budget_items_price_type;
alter table public.budget_items add  constraint ck_budget_items_price_type check (
  price_type is null
  or price_type in ('LABOR_ONLY','MATERIAL_ONLY','LABOR_AND_MATERIAL','SERVICE')
);

alter table public.budget_items drop constraint if exists ck_budget_items_confidence_range;
alter table public.budget_items add  constraint ck_budget_items_confidence_range check (
  canonical_confidence is null
  or (canonical_confidence >= 0 and canonical_confidence <= 1)
);

-- ── Combinaciones legales de estado (sección 5.2 del diseño) ──────────────────
-- unmatched -> sin id, sin confianza, sin fuente
-- resolved  -> id, confianza EXACTAMENTE 1.00, fuente exacta/humana
-- review    -> id, confianza en [0.50, 0.85), fuente difusa
-- ambiguous -> SIN id (aunque el resolver fallase, la base de datos lo impide)
alter table public.budget_items drop constraint if exists ck_canonical_coherence;
alter table public.budget_items add  constraint ck_canonical_coherence check (
  case canonical_status
    when 'unmatched' then
             canonical_id         is null
         and canonical_confidence is null
         and canonical_source     is null
    when 'resolved' then
             canonical_id         is not null
         and canonical_confidence is not null
         and canonical_confidence = 1.00
         and canonical_source     is not null
         and canonical_source in ('override','generator','exact_manual','exact_curated',
                                  'exact_engine','exact_import','exact_provider')
    when 'review' then
             canonical_id         is not null
         and canonical_confidence is not null
         and canonical_confidence >= 0.50
         and canonical_confidence <  0.85
         and canonical_source     is not null
         and canonical_source in ('synonym','fingerprint')
    when 'ambiguous' then
             canonical_id         is null
         and canonical_confidence is null
         and canonical_source     is not null
         and canonical_source in ('synonym','fingerprint','exact_manual','exact_curated',
                                  'exact_engine','exact_import','exact_provider')
    else false
  end
);

-- ── Origen y fuente concreta (sección 5.3 del diseño) ─────────────────────────
-- import/provider          -> source_ref OBLIGATORIO
-- engine/free_text/legacy  -> source_ref PROHIBIDO
-- NULL (transición)        -> source_ref PROHIBIDO
alter table public.budget_items drop constraint if exists ck_origin_source_ref;
alter table public.budget_items add  constraint ck_origin_source_ref check (
  case
    when canonical_origin in ('import','provider')           then canonical_source_ref is not null
    when canonical_origin in ('engine','free_text','legacy') then canonical_source_ref is null
    when canonical_origin is null                            then canonical_source_ref is null
    else false
  end
);

-- ── Índices ───────────────────────────────────────────────────────────────────
create index if not exists idx_budget_items_canonical
  on public.budget_items (canonical_id) where canonical_id is not null;

create index if not exists idx_budget_items_canonical_status
  on public.budget_items (canonical_status) where canonical_status <> 'unmatched';

commit;
