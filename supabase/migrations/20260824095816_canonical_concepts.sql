-- Fase 2 · 2/8 · Registro canónico de conceptos.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), secciones 2 y 3.
--
-- CLAVE DUAL, deliberada:
--   · id uuid          -> clave técnica. pb_products.concept_id YA es uuid y está a NULL
--                         en las 42.221 filas, así que se reutiliza tal cual con una FK,
--                         sin rename, sin cambio de tipo y sin backfill.
--   · canonical_id text -> clave semántica. budget_items la referencia en texto porque es
--                         el registro económico auditable, donde un identificador legible
--                         permite ver un duplicado a simple vista.
--
-- GLOBAL E INMUTABLE: sin company_id. Un WORK.PAINT.EMULSION.WALL.2COATS significa lo
-- mismo en todas las empresas; si no fuera así el identificador no serviría para comparar
-- precios entre empresas, que es su razón de ser. La personalización vive en aliases.
--
-- SIN requires_any ni excludes: son reglas de alcance y pertenecen al Scope/Rules Engine
-- de Fase 3. Este registro describe QUÉ es un concepto, no CUÁNDO procede usarlo.
--
-- Depende de: 20260824095335_canonical_domains.sql

begin;

create table if not exists public.canonical_concepts (
  id                  uuid primary key default gen_random_uuid(),
  canonical_id        text not null unique,

  kind                text not null check (kind in ('WORK','MAT','SRV')),
  domain              text not null references public.canonical_domains(domain),
  family              text not null,
  concept             text not null,
  variant             text,

  display_name_es     text not null,
  definition_es       text not null,
  default_unit        text not null,

  default_price_type  text not null
                      check (default_price_type in
                        ('LABOR_ONLY','MATERIAL_ONLY','LABOR_AND_MATERIAL','SERVICE')),
  allowed_price_types text[] not null,

  status              text not null default 'active'
                      check (status in ('active','deprecated')),
  superseded_by       text references public.canonical_concepts(canonical_id),
  version             integer not null default 1,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Gramática única para WORK / MAT / SRV: 4 o 5 segmentos.
  -- El primer carácter de cada segmento admite dígito para variantes como 6M3 o 2COATS.
  constraint ck_canonical_grammar check (
    canonical_id ~ '^(WORK|MAT|SRV)(\.[A-Z0-9][A-Z0-9_]*){3,4}$'
  ),

  -- El canonical_id debe reconstruirse exactamente desde sus partes: imposible
  -- desincronizar el identificador de su descomposición.
  constraint ck_canonical_parts check (
    canonical_id = kind || '.' || domain || '.' || family || '.' || concept
                   || coalesce('.' || variant, '')
  ),

  -- El ámbito por defecto debe estar entre los admisibles.
  constraint ck_price_type_default check (
    default_price_type = any(allowed_price_types)
  ),
  constraint ck_price_type_values check (
    allowed_price_types <@ ARRAY['LABOR_ONLY','MATERIAL_ONLY',
                                 'LABOR_AND_MATERIAL','SERVICE']::text[]
    and array_length(allowed_price_types, 1) >= 1
  ),

  constraint ck_deprecated_needs_successor check (
    status = 'active' or superseded_by is not null
  )
);

comment on table public.canonical_concepts is
  'Fase 2. Vocabulario canónico global e inmutable de Enlaze. Sin company_id: la personalización de empresa vive en canonical_aliases.';
comment on column public.canonical_concepts.allowed_price_types is
  'Ámbitos económicos admisibles. El mismo trabajo puede presupuestarse como mano de obra sola o como suministro + ejecución; el ámbito realmente usado se guarda en budget_items.price_type.';

create index if not exists idx_canonical_kind_domain
  on public.canonical_concepts (kind, domain);

alter table public.canonical_concepts enable row level security;

drop policy if exists canonical_concepts_read on public.canonical_concepts;
create policy canonical_concepts_read on public.canonical_concepts
  for select to authenticated using (true);

-- Sin políticas de escritura: solo service_role vía migración. Eso es lo que hace real
-- la inmutabilidad, en vez de dejarla en una convención.

commit;
