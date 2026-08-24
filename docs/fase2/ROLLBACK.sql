-- =====================================================================================
-- FASE 2 · ROLLBACK COMPLETO
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24)
--
-- ESTE ARCHIVO NO SE EJECUTA NUNCA ENTERO DE GOLPE SIN PENSAR.
-- Cada bloque revierte UNA migración y está delimitado. Se ejecuta de arriba abajo, que
-- es el ORDEN INVERSO al de aplicación. Ejecutar en otro orden falla por dependencias
-- de clave foránea, y eso es intencionado: la base de datos impide el desorden.
--
-- GARANTÍA DE NO DESTRUCCIÓN DE DATOS DE PRODUCCIÓN
-- Ninguna sentencia de este archivo toca un importe, una línea de presupuesto ni un
-- producto. Solo elimina objetos y columnas que Fase 2 ha creado. Concretamente:
--   · budget_items conserva sus 15 columnas originales y sus 807 filas intactas.
--   · pb_products conserva sus 42.221 filas y sus columnas; solo pierde la FK, el CHECK
--     y el índice que Fase 2 añadió.
-- Lo único que se pierde al revertir es el trabajo de clasificación canónica ya hecho:
-- los valores de canonical_* en budget_items y los vínculos concept_id de pb_products.
-- Antes de revertir en un entorno donde el resolver ya haya corrido, hacer el respaldo
-- del bloque 0.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 0 · RESPALDO PREVIO (opcional, pero obligatorio si el resolver ya ha corrido)
-- Guarda la clasificación antes de destruirla, para poder rehacerla sin recalcular.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- create table if not exists public._fase2_backup_budget_items as
--   select id, canonical_id, canonical_status, canonical_confidence,
--          canonical_source, canonical_origin, canonical_source_ref, price_type
--   from public.budget_items
--   where canonical_status <> 'unmatched' or price_type is not null;
--
-- create table if not exists public._fase2_backup_pb_products as
--   select id, concept_id, concept_match_type
--   from public.pb_products
--   where concept_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 · Revierte 20260824120700_pb_products_canonical_fk.sql
-- Deja pb_products exactamente como estaba: concept_id uuid nullable sin FK,
-- concept_match_type text sin CHECK. No se borra ninguna fila.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop index  if exists public.idx_pb_products_concept;
alter table public.pb_products drop constraint if exists ck_pb_concept_match_type;
alter table public.pb_products drop constraint if exists pb_products_concept_id_fkey;
comment on column public.pb_products.concept_id is null;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2 · Revierte 20260824120600_budget_items_canonical.sql
-- Elimina las 7 columnas canónicas. Las 15 columnas originales y las 807 filas quedan
-- intactas. Los CHECK y la FK caen automáticamente con sus columnas, pero se sueltan
-- antes de forma explícita para que el rollback sea legible y para que un DROP COLUMN
-- parcialmente aplicado no deje restricciones huérfanas.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop index  if exists public.idx_budget_items_canonical_status;
drop index  if exists public.idx_budget_items_canonical;

alter table public.budget_items drop constraint if exists ck_origin_source_ref;
alter table public.budget_items drop constraint if exists ck_canonical_coherence;
alter table public.budget_items drop constraint if exists ck_budget_items_confidence_range;
alter table public.budget_items drop constraint if exists ck_budget_items_price_type;
alter table public.budget_items drop constraint if exists ck_budget_items_source_ref_format;
alter table public.budget_items drop constraint if exists ck_budget_items_canonical_origin;
alter table public.budget_items drop constraint if exists ck_budget_items_canonical_source;
alter table public.budget_items drop constraint if exists ck_budget_items_canonical_status;
alter table public.budget_items drop constraint if exists budget_items_canonical_id_fkey;

alter table public.budget_items
  drop column if exists price_type,
  drop column if exists canonical_source_ref,
  drop column if exists canonical_origin,
  drop column if exists canonical_source,
  drop column if exists canonical_confidence,
  drop column if exists canonical_status,
  drop column if exists canonical_id;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 · Revierte 20260824120500_canonical_seed_paint_waste.sql
-- Borra los 20 conceptos del seed. Sus aliases y relaciones caen por ON DELETE CASCADE.
--
-- IMPORTANTE: este DELETE FALLA si alguna fila de budget_items todavía referencia uno de
-- estos canonical_id, porque esa FK es NO ACTION. Si el bloque 2 se ha ejecutado, la
-- columna ya no existe y no hay conflicto posible. Si falla aquí, significa que el
-- bloque 2 no se aplicó: no forzar, volver atrás y aplicarlo.
--
-- Solo borra estos 20. Si en el futuro se han sembrado más conceptos por otras
-- migraciones, NO se tocan. Por eso no hay un TRUNCATE.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
delete from public.canonical_concepts where canonical_id in (
  'WORK.PAINT.PREP.SURFACE',
  'WORK.PAINT.PREP.MASKING',
  'WORK.PAINT.PRIMER.APPLY',
  'WORK.PAINT.EMULSION.WALL.2COATS',
  'WORK.PAINT.EMULSION.CEILING.2COATS',
  'WORK.PROTECT.SITE.COVERING',
  'WORK.WASTE.MANAGEMENT.FULL',
  'WORK.WASTE.CONTAINER.HAUL',
  'WORK.WASTE.CONTAINER.HAUL.6M3',
  'WORK.WASTE.FEE.DISPOSAL',
  'MAT.PAINT.PRIMER.ACRYLIC',
  'MAT.PAINT.EMULSION.INTERIOR_MATT',
  'MAT.PAINT.FILLER.POWDER',
  'MAT.PAINT.MASKING.TAPE',
  'MAT.PAINT.MASKING.FILM',
  'MAT.PAINT.TOOL.ROLLER',
  'MAT.PAINT.TOOL.BRUSH',
  'MAT.PAINT.TOOL.TRAY',
  'SRV.WASTE.CONTAINER.HAUL',
  'SRV.WASTE.CONTAINER.HAUL.6M3'
);
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4 · Revierte 20260824112605_canonical_relations.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop table if exists public.canonical_concept_relations;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5 · Revierte 20260824101548_canonical_aliases.sql
-- La tabla se suelta ANTES que la función: alias_norm es una columna generada que
-- depende de canonical_normalize(), así que el DROP FUNCTION fallaría con la tabla viva.
-- Ese fallo sería correcto, no un estorbo: es la dependencia haciendo su trabajo.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop table    if exists public.canonical_aliases;
drop function if exists public.canonical_normalize(text);
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 6 · Revierte 20260824101019_canonical_alias_sources.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop table if exists public.canonical_alias_sources;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 7 · Revierte 20260824095816_canonical_concepts.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop table if exists public.canonical_concepts;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 8 · Revierte 20260824095335_canonical_domains.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
drop table if exists public.canonical_domains;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN DEL ROLLBACK COMPLETO
-- Las tres consultas deben devolver 0. Si alguna no lo hace, el rollback está a medias.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- select count(*) as tablas_fase2_restantes
--   from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('canonical_domains','canonical_concepts','canonical_alias_sources',
--                       'canonical_aliases','canonical_concept_relations');
--
-- select count(*) as columnas_fase2_restantes
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'budget_items'
--    and column_name in ('canonical_id','canonical_status','canonical_confidence',
--                        'canonical_source','canonical_origin','canonical_source_ref',
--                        'price_type');
--
-- select count(*) as restricciones_fase2_restantes
--   from pg_constraint
--  where conname in ('pb_products_concept_id_fkey','ck_pb_concept_match_type');
