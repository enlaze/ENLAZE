-- Fase 2 · 4/8 · Alias canónicos, normalizador y aislamiento multiempresa.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), secciones
-- 3.5, 3.6, 3.7, 4.6 y 5.1.
--
-- DOS NATURALEZAS DISTINTAS:
--   · 'exact'   -> determinista. Confianza 1.00, resuelve automáticamente. La unicidad
--                  se impone en base de datos para que esa promesa sea real.
--   · 'synonym' -> material para el matcher difuso. PUEDE ser ambiguo por naturaleza y el
--                  modelo debe poder representarlo. Caso real: "Cinta de enmascarar y
--                  plastico protector" designa a la vez MAT.PAINT.MASKING.TAPE y
--                  MAT.PAINT.MASKING.FILM, con precios de 0,37 € y 38,40 € en producción.
--                  Elegir uno automáticamente habría sido un error caro. El resolver
--                  devuelve 'ambiguous' con canonical_id NULL.
--
-- TENANT SEPARADO DE PROCEDENCIA:
--   source     = de dónde viene el alias (procedencia).
--   source_ref = qué instancia concreta (cype, public_bc3, enlaze_base, obramat).
--   company_id = de quién es. NULL = global de Enlaze; UUID = privado de una empresa.
--   Se replica la convención ya establecida en pb_providers y pb_price_sources, donde
--   company_id se compara contra auth.uid() y no tiene FK. Ver DT-002 en el diseño.
--
-- NORMALIZACIÓN CON FUENTE ÚNICA: alias_norm es una columna GENERADA por
-- canonical_normalize(). El resolver consulta con
--   where alias_norm = canonical_normalize($1)
-- de modo que la normalización vive en un solo sitio y el seed no puede desincronizarse.
-- Un test de paridad verifica que normalizeForMatching() de lib/normalized-concepts.ts
-- produce el mismo resultado sobre un corpus de cadenas reales.
--
-- NULLS NOT DISTINCT en los índices únicos: sin él, dos aliases globales idénticos
-- (company_id NULL, source_ref NULL) no colisionarían, porque en PostgreSQL NULL no es
-- igual a NULL. Es la trampa silenciosa que este diseño cierra explícitamente.
--
-- Depende de: 20260824095816_canonical_concepts.sql
--             20260824101019_canonical_alias_sources.sql

begin;

-- ── Normalizador. IMMUTABLE porque lo exige la columna generada. ──────────────
create or replace function public.canonical_normalize(txt text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(translate(
          txt,
          'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
        )),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function public.canonical_normalize(text) is
  'Fase 2. Fuente única de normalización de alias. Debe mantenerse en paridad con normalizeForMatching() de lib/normalized-concepts.ts; hay un test que lo verifica.';

-- ── Tabla de alias ────────────────────────────────────────────────────────────
create table if not exists public.canonical_aliases (
  id           uuid primary key default gen_random_uuid(),
  canonical_id text not null references public.canonical_concepts(canonical_id)
                 on delete cascade,

  alias_kind   text not null check (alias_kind in ('exact','synonym')),

  source       text not null default 'curated'
                 references public.canonical_alias_sources(source),
  source_ref   text check (source_ref is null or source_ref ~ '^[a-z0-9][a-z0-9_-]*$'),

  company_id   uuid,

  alias_value  text not null check (btrim(alias_value) <> ''),
  alias_norm   text generated always as (public.canonical_normalize(alias_value)) stored,

  confidence   numeric(3,2) not null default 1.00
                 check (confidence > 0 and confidence <= 1),

  created_at   timestamptz not null default now(),

  -- Contrato único de confianza. La franja [0.85, 1.00) queda vacía por diseño: era la
  -- que permitía que el resolver construyese un estado que budget_items rechazaría.
  constraint ck_confidence_by_kind check (
    case alias_kind
      when 'exact'   then confidence = 1.00
      when 'synonym' then confidence >= 0.50 and confidence < 0.85
      else false
    end
  ),

  -- Fuente concreta obligatoria donde la identidad depende del banco, prohibida donde no
  -- existe sub-espacio ('engine' es uno solo, 'curated' es uno solo, 'manual' ya está
  -- segmentado por company_id). Se escribe con CASE y ELSE false para que la lógica
  -- trivaluada de SQL no deje pasar filas: en PostgreSQL un CHECK que evalúa a NULL se
  -- considera satisfecho.
  constraint ck_source_ref_presence check (
    case
      when source in ('import','provider')          then source_ref is not null
      when source in ('manual','curated','engine')  then source_ref is null
      else false
    end
  ),

  -- El vocabulario base de Enlaze y los literales del generador son código de Enlaze:
  -- no pueden ser privados de una empresa.
  constraint ck_curated_is_global check (source <> 'curated' or company_id is null),
  constraint ck_engine_is_global  check (source <> 'engine'  or company_id is null)
);

comment on table public.canonical_aliases is
  'Fase 2. source = procedencia, source_ref = instancia concreta, company_id = tenant. Los tres ejes son ortogonales a propósito.';
comment on column public.canonical_aliases.alias_norm is
  'Columna generada por canonical_normalize(alias_value). No escribir a mano.';

-- Determinismo de los exactos dentro de (empresa, procedencia, fuente concreta).
drop index if exists public.uq_alias_exact;
create unique index uq_alias_exact
  on public.canonical_aliases (company_id, source, source_ref, alias_norm)
  nulls not distinct
  where alias_kind = 'exact';

-- Ambigüedad permitida entre conceptos, sin filas repetidas.
drop index if exists public.uq_alias_synonym;
create unique index uq_alias_synonym
  on public.canonical_aliases (company_id, source, source_ref, alias_norm, canonical_id)
  nulls not distinct
  where alias_kind = 'synonym';

create index if not exists idx_alias_norm
  on public.canonical_aliases (alias_norm);
create index if not exists idx_alias_company
  on public.canonical_aliases (company_id) where company_id is not null;

-- ── RLS: global o de mi empresa ───────────────────────────────────────────────
-- Predicado idéntico al que ya usa pb_providers. NO es la única defensa: el resolver
-- repite el filtro de tenant explícitamente en cada consulta, porque el backfill corre
-- como service_role y salta la RLS.
alter table public.canonical_aliases enable row level security;

drop policy if exists canonical_aliases_read on public.canonical_aliases;
create policy canonical_aliases_read on public.canonical_aliases
  for select to authenticated
  using (company_id is null or company_id = auth.uid());

drop policy if exists canonical_aliases_insert_own on public.canonical_aliases;
create policy canonical_aliases_insert_own on public.canonical_aliases
  for insert to authenticated
  with check (company_id = auth.uid() and source = 'manual');

drop policy if exists canonical_aliases_update_own on public.canonical_aliases;
create policy canonical_aliases_update_own on public.canonical_aliases
  for update to authenticated
  using      (company_id = auth.uid() and source = 'manual')
  with check (company_id = auth.uid() and source = 'manual');

drop policy if exists canonical_aliases_delete_own on public.canonical_aliases;
create policy canonical_aliases_delete_own on public.canonical_aliases
  for delete to authenticated
  using (company_id = auth.uid() and source = 'manual');

-- Consecuencia: una empresa solo puede crear, editar y borrar sus propios alias
-- manuales. No puede tocar los globales ni suplantar otra procedencia.

commit;
