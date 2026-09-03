-- Fase 2 · 5/8 · Relaciones entre conceptos canónicos.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 3.4.
--
-- SOLO TRES RELACIONES, todas descriptivas:
--   includes    -> el ámbito económico de A absorbe a B. Base de MATERIAL_DOUBLE_IMPUTATION
--                  y de OVERLAPPING_CANONICAL_SCOPE.
--   provides    -> un SRV comprado a un tercero materializa una partida WORK. Es lo que
--                  permite detectar que "Contenedores y transporte" y "Servicio de
--                  contenedor de escombros 6 m³" son el mismo hecho físico a los dos
--                  lados del margen (290 × 1,20 = 348), sin fundirlos y sin destruir la
--                  trazabilidad del margen.
--   variant_of  -> variante dimensional o de acabado del mismo concepto.
--
-- 'excludes' queda FUERA a propósito: "estos dos no pueden coexistir" es una regla de
-- alcance y pertenece al Scope/Rules Engine de Fase 3. La sustitución de conceptos
-- obsoletos se resuelve con canonical_concepts.superseded_by, no con una relación.
--
-- Depende de: 20260824095816_canonical_concepts.sql

begin;

create table if not exists public.canonical_concept_relations (
  id             uuid primary key default gen_random_uuid(),
  from_canonical text not null references public.canonical_concepts(canonical_id)
                   on delete cascade,
  to_canonical   text not null references public.canonical_concepts(canonical_id)
                   on delete cascade,
  relation_type  text not null
                   check (relation_type in ('includes','provides','variant_of')),
  note_es        text,
  created_at     timestamptz not null default now(),

  constraint uq_relation unique (from_canonical, to_canonical, relation_type),
  constraint ck_no_self  check (from_canonical <> to_canonical)
);

comment on table public.canonical_concept_relations is
  'Fase 2. Relaciones descriptivas entre conceptos. No contienen reglas de alcance: eso es Fase 3.';

create index if not exists idx_relation_to
  on public.canonical_concept_relations (to_canonical);

alter table public.canonical_concept_relations enable row level security;

drop policy if exists canonical_relations_read on public.canonical_concept_relations;
create policy canonical_relations_read on public.canonical_concept_relations
  for select to authenticated using (true);

commit;
