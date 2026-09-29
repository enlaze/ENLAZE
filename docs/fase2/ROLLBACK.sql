-- =====================================================================================
-- FASE 2 · ROLLBACK COMPLETO
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24)
--
-- ESTE ARCHIVO NO SE EJECUTA NUNCA ENTERO, NI DE GOLPE NI DE ARRIBA ABAJO.
-- Cada bloque revierte UNA migración, está delimitado por marcas BEGIN/END y se
-- SELECCIONA EXPRESAMENTE el que toque. Los bloques se fueron añadiendo por lotes
-- (E1, E2, E4-L1, E4-HARDENING…) y el archivo NO está globalmente ordenado como
-- inverso del despliegue: leerlo de arriba abajo no da una secuencia válida.
--
-- Donde sí hay un orden obligatorio es DENTRO de cada par que comparte objetos, y
-- está documentado en su propia cabecera. El único par así hoy es el de E4:
-- ROLLBACK_2F2_E4_HARDENING va antes que ROLLBACK_2F2_E4_L1, y en ese tramo los
-- bloques sí aparecen en el orden correcto. Al revés falla, y falla a propósito.
--
-- En general, ejecutar compensaciones en un orden que rompa dependencias falla, y
-- eso es intencionado: la base de datos impide el desorden en vez de dejar restos.
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

-- ═════════════════════════════════════════════════════════════════════════════════════
-- ORDEN DE LOS TRES BLOQUES DE E4 · se compensa en orden inverso al despliegue
--
-- E4-L2-CUTOVER va primero, E4-HARDENING después y E4-L1 al final. Alterar ese
-- orden falla: E4-L1 hace
-- `drop schema portal_token_internal` (sin CASCADE, a propósito, para no borrar de
-- más sin darse cuenta) y el esquema no está vacío mientras sigan dentro
-- visible_project y su RPC pública portal_list_tokens, que crea el hardening.
-- ═════════════════════════════════════════════════════════════════════════════════════

-- 20260925110000_portal_tokens_least_privilege.sql no tiene rollback operativo.
-- Reabrir REFERENCES/TRIGGER/TRUNCATE o SELECT a anon/authenticated no recupera
-- ninguna función y sí restaura una superficie insegura. Ante una incidencia se
-- corrigen hacia delante las RPC; el rollback excepcional del corte que figura
-- debajo solo reabre SELECT a authenticated con reconocimiento explícito.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-L2-CUTOVER · revierte 20260925100000_portal_token_ui_cutover.sql
--
-- Reabre deliberadamente la lectura directa de portal_tokens para la interfaz
-- antigua. Esto vuelve a permitir que el dueño relea secretos ya emitidos y,
-- por tanto, elimina la garantía de copia única. Solo debe usarse DESPUÉS de
-- retirar la interfaz nueva y con una incidencia que justifique la regresión;
-- para un fallo de la interfaz nueva se prefiere corregir hacia delante.
-- Debe ir antes que ROLLBACK_2F2_E4_HARDENING, porque ese bloque exige que la
-- interfaz antigua conserve alguna vía de lectura.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_2F2_E4_L2_CUTOVER
begin;
do $guard$
begin
  if current_setting('enlaze.allow_portal_ui_cutover_rollback', true)
       is distinct from 'temporarily_restore_direct_secret_read' then
    raise exception 'Set explicit temporarily_restore_direct_secret_read acknowledgement; otherwise forward-fix only';
  end if;
  if to_regprocedure('public.portal_list_tokens(uuid,integer,timestamp with time zone,uuid)') is null then
    raise exception 'portal_list_tokens is absent: restore the reviewed dependency before changing privileges';
  end if;
end $guard$;
grant select on table public.portal_tokens to authenticated;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E4_L2_CUTOVER

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-HARDENING · revierte 20260925090000_portal_token_listing.sql
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
-- Firma completa: con `if exists` una firma obsoleta no borra nada y solo lo
-- dice en un NOTICE, así que el rollback parecería correcto y no lo sería.
drop function if exists public.portal_list_tokens(uuid, integer, timestamptz, uuid);
drop function if exists portal_token_internal.visible_project(uuid, uuid);
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E4_HARDENING

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
-- BLOQUE E4-L3 · compensa 20260927100000_projects_access_token_no_default.sql
--
-- ATENCIÓN: esta compensación NO es incondicional, y la migración que revierte
-- tampoco debe describirse como reversible sin más.
--
-- S3.1 quita el DEFAULT de projects.access_token y permite NULL. Mientras no
-- exista ningún proyecto con access_token NULL, deshacerlo es trivial. En cuanto
-- exista uno —y existirá: todo proyecto creado después de S3.1 nace así—,
-- restaurar el NOT NULL es imposible sin inventar un valor para esas filas, y
-- inventarlo significaría EMITIR enlaces portadores nuevos para proyectos que
-- nunca los pidieron. Eso no lo hace este bloque: prefiere abortar.
--
-- Si hay nulos y aun así se quiere volver atrás, es una decisión de producto que
-- exige elegir explícitamente qué recibe cada proyecto afectado, proyecto a
-- proyecto y con conocimiento del dueño. No cabe en un rollback.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_2F2_E4_L3
begin;
do $guard$
declare v_nulos integer;
begin
  if current_setting('enlaze.allow_legacy_token_default_rollback', true)
     is distinct from 'restore_automatic_legacy_links' then
    raise exception 'Set explicit restore_automatic_legacy_links acknowledgement; otherwise forward-fix only';
  end if;

  select count(*) into v_nulos from public.projects where access_token is null;
  if v_nulos > 0 then
    raise exception
      'There are % projects with a NULL access_token. Restoring NOT NULL would require minting bearer links for projects that never asked for one. Decide project by project instead; this rollback refuses.', v_nulos;
  end if;
end $guard$;

-- Solo se llega aquí sin un solo nulo: restaurar es seguro y no emite nada.
alter table public.projects
  alter column access_token set default gen_random_uuid(),
  alter column access_token set not null;

comment on column public.projects.access_token is null;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_2F2_E4_L3

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE MAQUINARIA · compensa 20260927120000_budget_items_allow_maquinaria.sql
--
-- Estrechar un vocabulario no es simétrico a ampliarlo. En cuanto exista una
-- sola partida clasificada como `maquinaria`, volver al CHECK de tres valores
-- falla al crearse, y la única forma de que no fallara sería reclasificar esas
-- partidas —decidir por el usuario dónde va su maquinaria—. Eso no lo hace un
-- rollback: prefiere abortar y decir cuántas hay.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_MAQUINARIA
begin;
do $guard$
declare v_maquinaria integer;
begin
  if current_setting('enlaze.allow_maquinaria_rollback', true)
     is distinct from 'narrow_back_to_three_categories' then
    raise exception 'Set explicit narrow_back_to_three_categories acknowledgement; otherwise forward-fix only';
  end if;

  select count(*) into v_maquinaria from public.budget_items where category = 'maquinaria';
  if v_maquinaria > 0 then
    raise exception
      'There are % budget items classified as maquinaria. Narrowing the vocabulary would mean reclassifying someone else''s work; decide where they go first. This rollback refuses.', v_maquinaria;
  end if;
end $guard$;

alter table public.budget_items drop constraint budget_items_category_check;
alter table public.budget_items
  add constraint budget_items_category_check
  check (category = any (array['material'::text, 'mano_obra'::text, 'otros'::text]));
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_MAQUINARIA

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-L3-S33A · 20260928120000_retire_legacy_portal_links.sql
--
-- NO HAY COMPENSACIÓN, y no es un olvido.
--
-- La migración pone projects.access_token a NULL. El valor anterior no se guarda
-- en ninguna parte, a propósito: conservarlo sería preservar exactamente el
-- secreto que se está retirando. Restaurar «el» enlace es imposible; lo único
-- que se podría hacer es emitir uno nuevo, que no es lo mismo y que además es
-- justo lo que 20260927100000 dejó de hacer automáticamente.
--
-- Si alguna vez hiciera falta dar acceso por el portal a uno de esos proyectos,
-- el camino es portal_issue_token: enlace moderno, con caducidad, revocable y
-- atribuido a su dueño. Ese es el objetivo de todo el lote E4.
--
-- Se deja este bloque escrito, y vacío a propósito, para que nadie busque una
-- compensación que no existe y termine improvisándola.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-L3-S33B · compensa 20260929100000_portal_rpcs_drop_legacy_token.sql
--
-- Este sí tiene compensación, al revés que el paso (a): (b) solo cambia
-- esquema, no borra ningún dato, así que restaurar las definiciones anteriores
-- devuelve el sistema exactamente a donde estaba.
--
-- Restaurarlas reabre el camino heredado: a partir de ese momento un valor en
-- projects.access_token vuelve a abrir el portal. Como el paso (a) dejó la
-- columna a cero, en la práctica no reabre el acceso a nadie —no hay ningún
-- token que reponer, y su valor no se guardó en ninguna parte—. Lo que hace es
-- devolver la capacidad de aceptarlos, que es lo que se compensa.
--
-- No sirve después del paso (c): si la columna ya no existe, estas funciones
-- no compilan. En ese caso hay que deshacer (c) primero.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_E4_L3_S33B
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if current_setting('enlaze.allow_legacy_rpc_rollback', true)
     is distinct from 'restore_legacy_access_token_path' then
    raise exception 'Set explicit restore_legacy_access_token_path acknowledgement; otherwise forward-fix only';
  end if;
  if to_regclass('public.projects') is null
     or not exists (select 1 from pg_attribute
                     where attrelid = 'public.projects'::regclass
                       and attname = 'access_token' and not attisdropped) then
    raise exception 'projects.access_token no longer exists: undo step (c) before restoring the legacy path';
  end if;
end $guard$;

create or replace function public.portal_read_snapshot(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
  v_link public.portal_tokens%rowtype;
  v_project public.projects%rowtype;
  v_modern boolean := false;
  v_now timestamptz := now();
  v_can_changes boolean;
  v_can_budgets boolean;
  v_client_single boolean;
begin
  -- A malformed or unknown link must have the same externally visible result.
  begin
    v_token := p_token::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if v_token is null then return null; end if;

  select * into v_link from public.portal_tokens where token = v_token;
  if found then
    if v_link.is_active is distinct from true or v_link.revoked_at is not null
       or (v_link.expires_at is not null and v_link.expires_at <= v_now) then
      return null;
    end if;
    v_modern := true;
    select * into v_project from public.projects
      where id = v_link.project_id and deleted_at is null;
  else
    -- Links created before portal_tokens existed remain usable. A revoked
    -- portal_tokens row never falls through to this legacy path.
    select * into v_project from public.projects
      where access_token = v_token and deleted_at is null;
  end if;
  if not found then return null; end if;

  -- A budget with no project reaches a portal only by sharing the link's client.
  -- When that client has one project the link can only mean that project; when it
  -- has several there is nothing in the data that says which, and showing it in
  -- all of them attributes the budget to projects it may have nothing to do with.
  -- So it is shown only in the unambiguous case. Approved 2026-09-16; the effect
  -- is measured in docs/fase2/CIERRE-DECISIONES-PR14.md. Once such a budget gets
  -- a project_id it is visible again through the direct branch.
  v_client_single := v_project.client_id is not null
    and (select count(*) from public.projects q
      where q.client_id = v_project.client_id
        and q.user_id = v_project.user_id
        and q.deleted_at is null) = 1;

  -- Capabilities are reported so the portal never offers an action the database
  -- would refuse. A legacy access_token answers changes (it predates the
  -- permission model) but can never answer budgets, which require a token row.
  v_can_changes := case
    when not v_modern then true
    when jsonb_typeof(v_link.permissions) is distinct from 'array' then false
    else v_link.permissions @> '["approve_changes"]'::jsonb end;
  v_can_budgets := v_modern
    and jsonb_typeof(v_link.permissions) is not distinct from 'array'
    and v_link.permissions @> '["approve_budgets"]'::jsonb
    and to_regprocedure('public.portal_respond_to_budget(text,uuid,text,text)') is not null;

  -- Access accounting the reader used to perform through open RLS policies.
  if v_modern then
    update public.portal_tokens
      set last_accessed_at = v_now, access_count = coalesce(access_count, 0) + 1
      where id = v_link.id;
  end if;
  -- "Visualizado" in the acceptance timeline means the client opened a budget we
  -- had already sent; a draft must never be stamped.
  update public.budgets set viewed_at = v_now
    where user_id = v_project.user_id and deleted_at is null and viewed_at is null
      and status in ('enviado','sent')
      -- Same visibility rule as the list below: stamping a budget the client was
      -- never shown would put a false "Visualizado" on the acceptance timeline.
      and (project_id = v_project.id or
        (v_client_single and project_id is null and client_id = v_project.client_id));

  return jsonb_build_object(
    'capabilities', jsonb_build_object(
      'respond_budgets', v_can_budgets, 'respond_changes', v_can_changes),
    'project', jsonb_build_object(
      'id',v_project.id, 'name',v_project.name, 'address',v_project.address,
      'description',v_project.description, 'status',v_project.status,
      'start_date',v_project.start_date, 'end_date',v_project.end_date,
      'budget_amount',v_project.budget_amount, 'notes',v_project.notes,
      'created_at',v_project.created_at, 'client_id',v_project.client_id),
    'client', (select jsonb_build_object(
      'id',c.id,'name',c.name,'email',c.email,'phone',c.phone,'company',c.company)
      from public.clients c where c.id=v_project.client_id and c.user_id=v_project.user_id),
    -- can_respond mirrors every condition portal_respond_to_budget enforces.
    -- The reader also lists budgets linked only by client, which that writer
    -- refuses, so a link-wide capability alone would still offer dead buttons.
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'budget_number',b.budget_number,'title',b.title,
      'service_type',b.service_type,'status',b.status,'subtotal',b.subtotal,
      'iva_amount',b.iva_amount,'total',b.total,'created_at',b.created_at,
      'can_respond', v_can_budgets
        -- is not distinct from: a client-linked budget has a null project_id,
        -- and "=" would make the whole flag null instead of false.
        and b.project_id is not distinct from v_project.id
        and b.status in ('enviado','sent')
        and exists (select 1 from public.document_versions dv
          where dv.entity_type='budget' and dv.entity_id=b.id and dv.version=b.version))
      order by b.created_at desc,b.id),'[]'::jsonb)
      from public.budgets b where b.user_id=v_project.user_id and b.deleted_at is null
      -- Client-facing states only. An allowlist, not "except borrador": status is
      -- nullable and a future state must not reach a client by default.
      and b.status in ('pendiente','pending','enviado','sent',
        'aceptado','accepted','rechazado','rejected')
      and (b.project_id=v_project.id or
        (v_client_single and b.project_id is null and b.client_id=v_project.client_id))),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,
      'base_amount',i.base_amount,'iva_amount',i.iva_amount,
      'total_amount',i.total_amount,'category',i.category,
      'payment_status',i.payment_status)
      order by i.invoice_date desc,i.id),'[]'::jsonb)
      -- Same rule as the budgets above, approved for invoices on 2026-09-16: an
      -- invoice carrying a project belongs to that project alone, and one without
      -- is attributed to the link's project only when the client leaves no doubt.
      from public.invoices i where i.user_id=v_project.user_id and i.deleted_at is null
      and (i.project_id=v_project.id or
        (v_client_single and i.project_id is null and i.client_id=v_project.client_id))),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',pay.id,'amount',pay.amount,'payment_date',pay.payment_date,
      'payment_method',pay.payment_method,'concept',pay.concept)
      order by pay.payment_date desc,pay.id),'[]'::jsonb)
      from public.payments pay where pay.project_id=v_project.id
      and pay.user_id=v_project.user_id),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',ch.id,'title',ch.title,'description',ch.description,
      'economic_impact',ch.economic_impact,'time_impact_days',ch.time_impact_days,
      'status',ch.status,'client_approved',ch.client_approved,
      'notes',ch.notes,'created_at',ch.created_at)
      order by ch.created_at desc,ch.id),'[]'::jsonb)
      from public.project_changes ch where ch.project_id=v_project.id
      and ch.user_id=v_project.user_id),
    'milestones', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'title',m.title,'planned_date',m.planned_date,
      'actual_date',m.actual_date,'status',m.status,
      'sort_order',m.sort_order,'notes',m.notes)
      order by m.sort_order,m.id),'[]'::jsonb)
      from public.project_milestones m where m.project_id=v_project.id)
  );
end;
$$;

create or replace function public.portal_respond_to_change(
  p_token text, p_change_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
  v_link public.portal_tokens%rowtype;
  v_project public.projects%rowtype;
  v_change public.project_changes%rowtype;
begin
  if p_change_id is null or p_approve is null then return null; end if;
  begin
    v_token := p_token::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if v_token is null then return null; end if;

  select * into v_link from public.portal_tokens where token=v_token for share;
  if found then
    if v_link.is_active is distinct from true or v_link.revoked_at is not null
      or (v_link.expires_at is not null and v_link.expires_at <= now()) then
      return null;
    end if;
    if jsonb_typeof(v_link.permissions) is distinct from 'array'
      or not (v_link.permissions @> '["approve_changes"]'::jsonb) then
      return null;
    end if;
    select * into v_project from public.projects
      where id=v_link.project_id and deleted_at is null for share;
  else
    select * into v_project from public.projects
      where access_token=v_token and deleted_at is null for share;
  end if;
  if not found then return null; end if;

  select * into v_change from public.project_changes
    where id=p_change_id and project_id=v_project.id and user_id=v_project.user_id
    for update;
  if not found or v_change.status <> 'proposed' then return null; end if;

  update public.project_changes
  set status=case when p_approve then 'approved' else 'rejected' end,
      client_approved=p_approve,
      approved_date=case when p_approve then current_date else null end,
      updated_at=clock_timestamp()
  where id=v_change.id;
  return jsonb_build_object('id',v_change.id,
    'status',case when p_approve then 'approved' else 'rejected' end,
    'client_approved',p_approve);
end;
$$;

notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_E4_L3_S33B
