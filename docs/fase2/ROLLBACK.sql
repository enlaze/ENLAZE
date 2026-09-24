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
-- El BLOQUE 0-2E tampoco toca datos: conserva a propósito los sort_order recuperados
-- por el backfill de FASE 2E-2 y se limita a soltar las restricciones que los protegían.
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
-- BLOQUE 0-2F2-E1 · Revierte 20260914090000_budgets_lock_version.sql
-- Ejecutar SOLO este bloque, antes de publicar clientes/RPC de revisión.
-- Requiere autorización operativa explícita en la misma sesión:
--   SET enlaze.allow_lock_version_rollback = 'before_revision_clients';
-- La declaración NO demuestra que no haya clientes desplegados: comprobarlo fuera
-- de SQL. Tras publicar esos clientes, únicamente corrección hacia delante.
-- Las guardas impiden borrar revisiones usadas o RPC nuevas detectables; sin CASCADE.
-- BEGIN ROLLBACK_2F2_E1
begin;
set local lock_timeout = '5s';
lock table public.budgets in access exclusive mode;
do $rollback_e1$
begin
  if current_setting('enlaze.allow_lock_version_rollback', true)
       is distinct from 'before_revision_clients' then
    raise exception 'E1: falta confirmacion de ausencia de clientes de revision'
      using errcode = '55000';
  end if;
  if exists (select 1 from public.budgets where lock_version is distinct from 1) then
    raise exception 'E1: hay revisiones usadas; solo correccion hacia delante'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_budget_with_items', 'save_budget', 'finalize_budget',
      'change_budget_status', 'duplicate_budget', 'portal_respond_to_budget'
    )
  ) then
    raise exception 'E1: existen RPC de revision; revisar dependencias antes de revertir'
      using errcode = '55000';
  end if;
end;
$rollback_e1$;
alter table public.budgets drop column lock_version restrict;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E1


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 0-2E · Revierte 20260901120000_budget_items_sort_order.sql (FASE 2E-2)
--
-- Va DELANTE del BLOQUE 1 porque este archivo se ejecuta en orden inverso al de
-- aplicación y 20260901120000 es la migración más reciente. Numerado 0-2E, y no 0.5 ni
-- renumerando todo, para no invalidar las referencias a "BLOQUE N" que ya existen en
-- CHECKS.sql y en los informes de fase.
--
-- QUÉ SE REVIERTE Y QUÉ NO
-- Se revierte lo que 2E-2 AÑADIÓ al esquema: la UNIQUE, el CHECK, el NOT NULL y el
-- comentario de columna. NO se revierten:
--
--   · Los valores de sort_order. El backfill RECUPERÓ el orden histórico leyendo
--     wizard_state; volver a poner 807 ceros no restauraría un estado anterior mejor,
--     destruiría información que ya no está en ningún otro sitio (wizard_state se
--     limpia). Con el NOT NULL y la UNIQUE fuera, unos sort_order correctos son
--     inertes para todo lo que había antes de 2E: los cuatro lectores siguen
--     ordenando por created_at hasta la fase 2E-3. Revertir es, por tanto, seguro
--     dejándolos.
--
--   · El DEFAULT 0. Ya existía antes de 2E-2, que se limitó a reafirmarlo en términos
--     absolutos. Quitarlo aquí no revertiría nada: dejaría la columna en un estado en
--     el que nunca estuvo.
--
-- La constraint y el índice implícito se sueltan ANTES que el NOT NULL por legibilidad;
-- el orden entre ellos es indiferente, no hay dependencias.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;
alter table public.budget_items drop constraint if exists uq_budget_items_budget_id_sort_order;
alter table public.budget_items drop constraint if exists ck_budget_items_sort_order_non_negative;
alter table public.budget_items alter column sort_order drop not null;
comment on column public.budget_items.sort_order is null;
commit;

-- Y la RPC. `update_budget_with_items` no se revierte con un DROP: hay que dejarla en la
-- versión anterior, que es la de 20260826103500. Ese archivo es `create or replace` de
-- principio a fin y declara su ACL en términos absolutos, así que volver a ejecutarlo
-- ENTERO y SIN MODIFICAR devuelve exactamente el estado previo, sea cual sea el actual:
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260826103500_update_budget_with_items_canonical.sql
--
-- No copiar aquí el cuerpo de la función: una copia diverge del original en cuanto
-- alguien toque uno de los dos, y entonces el rollback introduce una tercera versión que
-- nunca ha estado en producción.
--
-- CONSECUENCIA INMEDIATA, Y ES LA ESPERADA: la RPC restaurada deja de transportar
-- sort_order, de modo que la primera edición clásica de un presupuesto reinsertará sus
-- partidas al default 0 y perderá el orden recuperado de ese presupuesto. Por eso el
-- NOT NULL y la UNIQUE se sueltan ANTES de restaurar la RPC: al revés, esa primera
-- edición no perdería el orden, fallaría con violación de UNIQUE y dejaría al usuario
-- sin poder guardar.
--
-- Tras restaurar la RPC:
--   notify pgrst, 'reload schema';


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

-- BLOQUE E2 · compensación de 20260915160000_budget_revision_rpcs.sql
-- Ejecutar únicamente antes de publicar clientes que llamen a las RPC nuevas.
-- BEGIN ROLLBACK_2F2_E2
begin;
do $guard$
begin
  if current_setting('enlaze.allow_revision_rpcs_rollback', true) is distinct from 'before_revision_clients' then
    raise exception 'Set explicit before_revision_clients acknowledgement; otherwise forward-fix only';
  end if;
end $guard$;
drop function if exists public.portal_respond_to_budget(text, uuid, text, text);
drop function if exists public.duplicate_budget(uuid);
drop function if exists public.change_budget_status(uuid, integer, text);
drop function if exists public.finalize_budget(uuid, integer, jsonb, jsonb);
drop function if exists public.save_budget(uuid, integer, jsonb, jsonb);
drop function if exists public.create_budget_with_items(jsonb, jsonb);
drop function if exists budget_internal.save_core(uuid, integer, jsonb, jsonb, boolean);
drop function if exists budget_internal.replace_items(uuid, jsonb);
drop function if exists budget_internal.result(uuid, text);
drop function if exists budget_internal.document_version(uuid, uuid);
drop function if exists budget_internal.apply_header(uuid, jsonb);
drop function if exists budget_internal.validate_payload(jsonb, boolean);
drop function if exists budget_internal.owned_budget(uuid, integer);
drop function if exists budget_internal.lock_owner(uuid);
alter default privileges for role postgres in schema budget_internal grant execute on functions to public;
drop schema if exists budget_internal;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E2

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-L1 · revierte 20260923120000_portal_token_lifecycle.sql
-- Retira las tres RPC de gestión, sus auxiliares, los dos CHECK y las invariantes
-- de caducidad (NOT NULL y DEFAULT de expires_at).
-- NO borra ninguna fila de portal_tokens: los enlaces ya emitidos siguen existiendo y
-- el portal los sigue aceptando, pero dejan de poder emitirse, rotarse o revocarse
-- desde la aplicación hasta que el lote vuelva a aplicarse.
-- NO toca projects.access_token ni ningún enlace heredado.
--
-- Asimetría deliberada: se retira el DEFAULT de expires_at, que este lote introdujo,
-- pero NO el de created_at, porque no consta que la columna no lo tuviera ya y
-- quitarlo rompería inserciones que hoy lo dan por hecho.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_2F2_E4_L1
begin;
do $guard$
begin
  if current_setting('enlaze.allow_portal_lifecycle_rollback', true) is distinct from 'before_issuing_links' then
    raise exception 'Set explicit before_issuing_links acknowledgement; otherwise forward-fix only';
  end if;
  -- Vigente con la misma definición que usan las RPC: activo, sin revocar y sin caducar.
  if exists (select 1 from public.portal_tokens
               where is_active and revoked_at is null and expires_at > now()) then
    raise exception 'There are live modern portal links: revoke them deliberately before removing their lifecycle';
  end if;
end $guard$;
drop function if exists public.portal_revoke_token(uuid);
drop function if exists public.portal_rotate_token(uuid, timestamptz);
drop function if exists public.portal_issue_token(uuid, jsonb, timestamptz, text);
drop function if exists portal_token_internal.lock_own_token(uuid, uuid);
drop function if exists portal_token_internal.status(public.portal_tokens);
drop function if exists portal_token_internal.issued(public.portal_tokens);
drop function if exists portal_token_internal.assert_live_link_cap(uuid);
drop function if exists portal_token_internal.resolve_expiry(timestamptz);
drop function if exists portal_token_internal.validate_permissions(jsonb);
drop function if exists portal_token_internal.owned_project(uuid, uuid);
alter default privileges for role postgres in schema portal_token_internal grant execute on functions to public;
drop schema if exists portal_token_internal;
-- El DEFAULT se retira antes que la función a la que apunta; si no, el DROP falla
-- por dependencia. Ninguna de estas sentencias toca una sola fila.
alter table public.portal_tokens
  drop constraint if exists portal_tokens_expiry_window_check,
  drop constraint if exists portal_tokens_permissions_check,
  alter column expires_at drop default,
  alter column expires_at drop not null,
  alter column created_at drop not null;
drop function if exists public.portal_token_max_lifetime();
drop function if exists public.portal_token_default_lifetime();
drop function if exists public.portal_token_permissions_valid(jsonb);
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E4_L1

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-HARDENING · revierte 20260924120000_portal_token_listing.sql
-- Retira la RPC de listado y su auxiliar privado. Nada más: no toca la tabla, ni
-- las restricciones, ni los privilegios que dejó E4-L1, ni una sola fila.
--
-- No hay guarda de "enlaces vigentes" como en E4-L1: quitar un listado de solo
-- lectura no puede dejar ningún enlace huérfano ni inaccesible. Lo que sí hace es
-- devolver a la pantalla del proyecto a su única vía actual, el SELECT directo
-- sobre portal_tokens, que en este punto todavía sigue concedido.
--
-- Si este rollback se ejecuta DESPUÉS de que el lote 2 haya retirado ese SELECT,
-- la pantalla se queda sin forma de listar enlaces: en ese escenario hay que
-- revertir también el lote 2, o no revertir esto.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_2F2_E4_HARDENING
begin;
do $guard$
begin
  if current_setting('enlaze.allow_portal_listing_rollback', true) is distinct from 'back_to_direct_select' then
    raise exception 'Set explicit back_to_direct_select acknowledgement; otherwise forward-fix only';
  end if;
  if not has_table_privilege('authenticated', 'public.portal_tokens', 'SELECT') then
    raise exception 'authenticated no longer has direct SELECT: removing the listing RPC would leave the screen blind. Revert lote 2 first';
  end if;
end $guard$;
drop function if exists public.portal_list_tokens(uuid);
drop function if exists portal_token_internal.visible_project(uuid, uuid);
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E4_HARDENING
