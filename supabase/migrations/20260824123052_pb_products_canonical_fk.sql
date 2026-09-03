-- Fase 2 · 8/8 · Enganche de pb_products al registro canónico.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 3.1.
--
-- NO SE RENOMBRA NADA Y NO SE CAMBIA NINGÚN TIPO.
-- pb_products.concept_id ya existe, ya es uuid, ya es nullable y no tiene FK. Es
-- exactamente la forma que necesita la clave técnica de canonical_concepts. Esta es la
-- razón por la que canonical_concepts tiene clave dual: 'id uuid' para que esta columna
-- de 42.221 filas sea reutilizable en su sitio sin migración de datos, y 'canonical_id
-- text' para que budget_items guarde el identificador legible.
--
-- COSTE DE VALIDACIÓN: instantáneo. Las 42.221 filas tienen concept_id NULL, así que la
-- FK no tiene ninguna fila que verificar. Igual con el CHECK: todas las filas tienen
-- concept_match_type = 'none'. Ninguna fila se reescribe.
--
-- on delete set null y no cascade: borrar un concepto canónico no puede borrar el
-- producto de un proveedor. Se pierde el vínculo, no el catálogo.
--
-- NO HAY BACKFILL AQUÍ. Vincular los 42.221 productos es trabajo del resolver y se hace
-- en un paso posterior, medido y reversible. Esta migración solo pone la barandilla.
--
-- Depende de: 20260824095816_canonical_concepts.sql

begin;

-- ── Integridad referencial sobre la columna que ya existía ────────────────────
alter table public.pb_products
  drop constraint if exists pb_products_concept_id_fkey;
alter table public.pb_products
  add  constraint pb_products_concept_id_fkey
       foreign key (concept_id)
       references public.canonical_concepts(id)
       on delete set null;

comment on column public.pb_products.concept_id is
  'Fase 2. Clave técnica del concepto canónico (canonical_concepts.id). NULL = producto sin vincular todavía.';

-- ── Vocabulario cerrado del tipo de vínculo ──────────────────────────────────
-- 'ambiguous' está presente porque el resolver puede terminar sin poder elegir, y ese
-- resultado tiene que poder registrarse. Cuando ocurre, concept_id queda NULL.
alter table public.pb_products drop constraint if exists ck_pb_concept_match_type;
alter table public.pb_products add  constraint ck_pb_concept_match_type check (
  concept_match_type in ('none','exact','synonym','manual','ambiguous')
);

-- NO se añade aquí un CHECK de coherencia entre concept_match_type y concept_id. Sería
-- deseable, pero exige conocer con certeza que ninguna de las 42.221 filas tiene
-- concept_match_type NULL, y esa comprobación se hace en las queries posteriores. Es una
-- restricción sobre el comportamiento del resolver, no sobre la identidad canónica, así
-- que pertenece al paso de vinculación y no a esta migración de barandilla.

-- ── Índice ───────────────────────────────────────────────────────────────────
-- Parcial: hoy indexaría cero filas y crecerá solo con lo vinculado de verdad.
create index if not exists idx_pb_products_concept
  on public.pb_products (concept_id) where concept_id is not null;

commit;
