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

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E4-L3-S33C · compensa 20260929140000_projects_drop_access_token.sql
--
-- Este sí compensa de verdad, y merece explicarse porque parece lo contrario.
-- El paso (a) NO tenía compensación: destruía ocho secretos que no se guardaban
-- en ninguna parte. El (c) elimina una columna que ya está vacía, así que
-- reponerla —con su restricción única, su índice y su comentario— devuelve
-- exactamente el estado anterior: ocho filas con el valor a NULL.
--
-- Lo que NO devuelve, porque nunca existió después de (a), son los enlaces.
-- Si hiciera falta dar acceso por el portal, el camino es portal_issue_token.
--
-- Después de este bloque, el camino heredado sigue sin existir en las RPC:
-- eso lo retiró el paso (b) y se compensa por separado con
-- ROLLBACK_E4_L3_S33B, que debe ejecutarse DESPUÉS de este si se quiere
-- volver al comportamiento completo de antes del lote.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_E4_L3_S33C
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if current_setting('enlaze.allow_access_token_column_rollback', true)
     is distinct from 'restore_empty_access_token_column' then
    raise exception 'Set explicit restore_empty_access_token_column acknowledgement; otherwise forward-fix only';
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.projects'::regclass
                and attname = 'access_token' and not attisdropped) then
    raise exception 'projects.access_token already exists; nothing to restore';
  end if;
end $guard$;

-- Se repone tal como estaba tras S3.1: nullable y sin default. Reponerla con
-- el default original volvería a emitir un enlace en cada alta, que es
-- justamente lo que 20260927100000 vino a cortar.
alter table public.projects add column access_token uuid;
alter table public.projects add constraint projects_access_token_key unique (access_token);
create index if not exists idx_projects_access_token on public.projects using btree (access_token);
comment on column public.projects.access_token is
  'Enlace heredado del portal, retirado el 2026-09-28 (S3.3 paso a): los ocho que quedaban se vaciaron y no se emiten nuevos desde 20260927100000. Las RPC del portal todavía lo aceptan por compatibilidad; retirarla es el paso (b) y eliminar la columna el (c). Ver docs/fase2/ESTADO-2F2-E4-L3.md.';
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_E4_L3_S33C

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE E5 · compensa 20261004180000_anon_loses_table_privileges.sql
--
-- Devuelve a `anon` los privilegios de tabla que la migracion retiro, y el
-- defecto del esquema que los concedia a las tablas nuevas.
--
-- Conviene leer lo que eso significa antes de ejecutarlo: reponerlos devuelve
-- el estado en el que una sola politica escrita USING (true) abre una tabla
-- entera a internet, y en el que `anon` tiene TRUNCATE sobre noventa y una
-- tablas sin que RLS lo cubra. No es volver a un estado neutro: es volver a un
-- estado peor, y por eso exige reconocimiento explicito.
--
-- Si lo que fallo fue una superficie anonima concreta, la compensacion
-- proporcionada es conceder a esa tabla y solo a esa, no deshacerlo todo.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- BEGIN ROLLBACK_E5
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if current_setting('enlaze.allow_anon_privileges_rollback', true)
     is distinct from 'restore_anon_table_privileges' then
    raise exception 'Set explicit restore_anon_table_privileges acknowledgement; otherwise forward-fix only';
  end if;
end $guard$;

grant all privileges on all tables in schema public to anon;
alter default privileges in schema public grant all on tables to anon;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_E5




-- BEGIN ROLLBACK_G3_L1B
-- Reponer estos cuatro cuerpos ANTES de ROLLBACK_G3_L1A: las funciones de
-- G3 L1b no compilan sin las tres columnas. El orden NO es intercambiable.
begin;
create or replace function public.replace_budget_items(p_budget_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id  uuid;
  v_budget   uuid;
  v_item     jsonb;
  v_pos      bigint;
  v_numero   numeric;
  v_insertadas integer;
begin
  if p_budget_id is null then
    raise exception 'replace_budget_items: p_budget_id es obligatorio'
      using errcode = '22004';
  end if;

  if p_items is null then
    raise exception 'replace_budget_items: p_items es obligatorio'
      using errcode = '22004';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'replace_budget_items: p_items debe ser un array JSON (recibido: %)',
      jsonb_typeof(p_items)
      using errcode = '22023';
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'replace_budget_items: no hay sesión autenticada'
      using errcode = '42501';
  end if;

  select b.id
    into v_budget
    from public.budgets as b
   where b.id = p_budget_id
     and b.user_id = v_user_id
     and b.deleted_at is null
     for update;

  if not found then
    raise exception 'replace_budget_items: el presupuesto no está disponible'
      using errcode = '42501';
  end if;

  for v_item, v_pos in
    select t.item, t.ordinality
      from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'replace_budget_items: el elemento % debe ser un objeto JSON (recibido: %)',
        v_pos - 1, jsonb_typeof(v_item)
        using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(v_item->>'concept', '')), '') is null then
      raise exception 'replace_budget_items: el elemento % no tiene concept',
        v_pos - 1
        using errcode = '22023';
    end if;

    if v_item->>'quantity' is null then
      raise exception 'replace_budget_items: el elemento % no tiene quantity',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'quantity')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un quantity no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene quantity = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;

    if v_item->>'unit_price' is null then
      raise exception 'replace_budget_items: el elemento % no tiene unit_price',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'unit_price')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un unit_price no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene unit_price = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;

    if nullif(v_item->>'subtotal_cost', '') is not null then
      begin
        v_numero := (v_item->>'subtotal_cost')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'replace_budget_items: el elemento % tiene un subtotal_cost no numérico',
            v_pos - 1
            using errcode = '22023';
      end;
      if v_numero = 'NaN'::numeric then
        raise exception 'replace_budget_items: el elemento % tiene subtotal_cost = NaN',
          v_pos - 1
          using errcode = '22023';
      end if;
    end if;

    if nullif(v_item->>'unit_price_cost', '') is not null then
      begin
        v_numero := (v_item->>'unit_price_cost')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'replace_budget_items: el elemento % tiene un unit_price_cost no numérico',
            v_pos - 1
            using errcode = '22023';
      end;
      if v_numero = 'NaN'::numeric then
        raise exception 'replace_budget_items: el elemento % tiene unit_price_cost = NaN',
          v_pos - 1
          using errcode = '22023';
      end if;
    end if;
  end loop;

  delete from public.budget_items
   where budget_id = p_budget_id;

  insert into public.budget_items (
    budget_id,
    sort_order,
    concept,
    description,
    quantity,
    unit,
    category,
    chapter,
    unit_price,
    subtotal,
    unit_price_cost,
    subtotal_cost,
    canonical_id,
    canonical_status,
    canonical_confidence,
    canonical_source,
    canonical_origin,
    canonical_source_ref,
    price_type
  )
  select p_budget_id,
         (t.ordinality - 1)::integer,
         btrim(t.item->>'concept'),
         coalesce(t.item->>'description', ''),
         (t.item->>'quantity')::numeric,
         coalesce(nullif(t.item->>'unit', ''), 'ud'),
         coalesce(nullif(t.item->>'category', ''), 'otros'),
         nullif(t.item->>'chapter', ''),
         (t.item->>'unit_price')::numeric,
         coalesce(
           (nullif(t.item->>'subtotal', ''))::numeric,
           round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)
         ),
         coalesce((nullif(t.item->>'unit_price_cost', ''))::numeric, 0),
         coalesce(
           (nullif(t.item->>'subtotal_cost', ''))::numeric,
           round(
             (t.item->>'quantity')::numeric
               * coalesce((nullif(t.item->>'unit_price_cost', ''))::numeric, 0),
             2
           )
         ),
         nullif(t.item->>'canonical_id', ''),
         coalesce(nullif(t.item->>'canonical_status', ''), 'unmatched'),
         (nullif(t.item->>'canonical_confidence', ''))::numeric,
         nullif(t.item->>'canonical_source', ''),
         nullif(t.item->>'canonical_origin', ''),
         nullif(t.item->>'canonical_source_ref', ''),
         nullif(t.item->>'price_type', '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  get diagnostics v_insertadas = row_count;

  return v_insertadas;
end;
$function$;

create or replace function public.update_budget_with_items(
  p_budget_id uuid,
  p_budget_data jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_budget public.budgets%rowtype;
  v_current_status text;
  v_subtotal numeric(12,2);
  v_iva_percent numeric(5,2);
  v_deposit_percent numeric(5,2);
  v_discount_type text;
  v_discount_percent numeric(5,2);
  v_discount_amount_input numeric(12,2);
  v_discount_amount numeric(12,2);
  v_taxable_base numeric(12,2);
  v_payment_schedule jsonb;
  v_reset_lifecycle boolean;
  v_previous_items jsonb := '[]'::jsonb;
  v_snapshot_version integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_budget_data) <> 'object' then
    raise exception 'Invalid budget data';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one budget item is required';
  end if;

  if nullif(btrim(p_budget_data->>'title'), '') is null then
    raise exception 'Budget title is required';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) as item
     where nullif(btrim(item->>'concept'), '') is null
        or coalesce((item->>'quantity')::numeric, 0) <= 0
        or coalesce((item->>'unit_price')::numeric, 0) <= 0
  ) then
    raise exception 'Every item needs a concept, quantity and valid price';
  end if;

  select *
    into v_budget
    from public.budgets
   where id = p_budget_id
     and user_id = v_user_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'Budget not found';
  end if;

  v_current_status := v_budget.status;
  v_reset_lifecycle := v_current_status in (
    'enviado', 'sent', 'aceptado', 'accepted', 'rechazado', 'rejected'
  );

  -- Este INSERT precede a propósito tanto al UPDATE del presupuesto como al
  -- DELETE de las partidas. Cualquier fallo posterior revierte la RPC entera,
  -- incluido este snapshot.
  if v_reset_lifecycle then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item_row.id,
          'chapter', coalesce(nullif(item_row.chapter, ''), nullif(item_row.category, ''), 'otros'),
          'code', '',
          'name', coalesce(item_row.concept, ''),
          'description', coalesce(item_row.description, ''),
          'unit', coalesce(nullif(item_row.unit, ''), 'ud'),
          'quantity', coalesce(item_row.quantity, 0),
          'quantity_calculation', '',
          'trade', 'subcontrata',
          'estimated_hours', 0,
          'priority', 'obligatoria',
          'dependencies', '[]'::jsonb,
          'material_cost_per_unit', 0,
          'labor_cost_per_unit', 0,
          'labor_hours_per_unit', 0,
          'machinery_cost_per_unit', 0,
          'unit_cost', coalesce(item_row.unit_price, 0),
          'unit_price_sale', coalesce(item_row.unit_price, 0),
          'subtotal_cost', coalesce(item_row.subtotal, 0),
          'subtotal_sale', coalesce(item_row.subtotal, 0),
          'margin_percent', 0,
          'confidence_score', 0,
          'price_source', 'estimated',
          'price_source_detail', 'Preservado desde budget_items',
          'supplier', null,
          'materials', '[]'::jsonb
        )
        order by item_row.created_at, item_row.id
      ),
      '[]'::jsonb
    )
      into v_previous_items
      from public.budget_items as item_row
     where item_row.budget_id = p_budget_id;

    loop
      begin
        select coalesce(max(snapshot.version), 0) + 1
          into v_snapshot_version
          from public.budget_snapshots as snapshot
         where snapshot.budget_id = p_budget_id;

        insert into public.budget_snapshots (
          budget_id,
          user_id,
          version,
          snapshot_type,
          label,
          items_data,
          summary_data,
          metadata,
          total_items,
          total_cost,
          total_sale
        ) values (
          p_budget_id,
          v_user_id,
          v_snapshot_version,
          'edited',
          format(
            'Preservado antes de editar %s (v%s)',
            coalesce(v_budget.status, 'sin estado'),
            coalesce(v_budget.version, 1)
          ),
          v_previous_items,
          jsonb_build_object(
            'subtotal', v_budget.subtotal,
            'iva_percent', v_budget.iva_percent,
            'iva_amount', v_budget.iva_amount,
            'total', v_budget.total
          ),
          jsonb_build_object(
            'preserved_before_lifecycle_edit', true,
            'budget_version', coalesce(v_budget.version, 1),
            'budget_status', v_budget.status,
            'budget_data', to_jsonb(v_budget)
          ),
          jsonb_array_length(v_previous_items),
          coalesce(v_budget.subtotal, 0),
          coalesce(v_budget.subtotal, 0)
        );
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
  end if;

  select round(
    coalesce(
      sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric),
      0
    ),
    2
  )
    into v_subtotal
    from jsonb_array_elements(p_items) as item;

  v_iva_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'iva_percent')::numeric, 21))
  );

  v_deposit_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'deposit_percent')::numeric, v_budget.deposit_percent, 30))
  );

  v_discount_type := case
    when p_budget_data->>'discount_type' in ('percent', 'amount') then p_budget_data->>'discount_type'
    else coalesce(nullif(v_budget.discount_type, ''), 'percent')
  end;

  v_discount_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'discount_percent')::numeric, v_budget.discount_percent, 0))
  );

  v_discount_amount_input := greatest(
    0,
    coalesce((p_budget_data->>'discount_amount')::numeric, v_budget.discount_amount, 0)
  );

  if v_discount_type = 'amount' then
    v_discount_amount := least(v_subtotal, v_discount_amount_input);
  else
    v_discount_amount := round(v_subtotal * v_discount_percent / 100, 2);
  end if;

  v_taxable_base := greatest(0, v_subtotal - v_discount_amount);

  v_payment_schedule := case
    when jsonb_typeof(p_budget_data->'payment_schedule') = 'array' then p_budget_data->'payment_schedule'
    else coalesce(v_budget.payment_schedule, '[]'::jsonb)
  end;

  update public.budgets
     set client_id = nullif(p_budget_data->>'client_id', '')::uuid,
         project_id = nullif(p_budget_data->>'project_id', '')::uuid,
         title = btrim(p_budget_data->>'title'),
         client_name = coalesce(p_budget_data->>'client_name', ''),
         client_email = coalesce(p_budget_data->>'client_email', ''),
         client_phone = coalesce(p_budget_data->>'client_phone', ''),
         client_address = coalesce(p_budget_data->>'client_address', ''),
         service_type = coalesce(nullif(p_budget_data->>'service_type', ''), 'general'),
         subtotal = v_subtotal,
         iva_percent = v_iva_percent,
         discount_type = v_discount_type,
         discount_percent = v_discount_percent,
         discount_amount = v_discount_amount,
         iva_amount = round(v_taxable_base * v_iva_percent / 100, 2),
         total = round(v_taxable_base + (v_taxable_base * v_iva_percent / 100), 2),
         notes = coalesce(p_budget_data->>'notes', ''),
         valid_until = nullif(p_budget_data->>'valid_until', '')::date,
         deposit_percent = v_deposit_percent,
         payment_method = coalesce(nullif(p_budget_data->>'payment_method', ''), 'Transferencia bancaria'),
         payment_iban = coalesce(p_budget_data->>'payment_iban', ''),
         payment_schedule = v_payment_schedule,
         warranty_text = coalesce(p_budget_data->>'warranty_text', ''),
         execution_deadline_text = coalesce(p_budget_data->>'execution_deadline_text', ''),
         observations = coalesce(p_budget_data->>'observations', ''),
         conditions_text = coalesce(p_budget_data->>'conditions_text', ''),
         status = case when v_reset_lifecycle then 'pendiente' else v_current_status end,
         sent_at = case when v_reset_lifecycle then null else sent_at end,
         viewed_at = case when v_reset_lifecycle then null else viewed_at end,
         accepted_at = case when v_reset_lifecycle then null else accepted_at end,
         rejected_at = case when v_reset_lifecycle then null else rejected_at end,
         accepted_by_name = case when v_reset_lifecycle then null else accepted_by_name end,
         accepted_ip = case when v_reset_lifecycle then null else accepted_ip end,
         version = coalesce(version, 1) + 1,
         updated_at = now()
   where id = p_budget_id
     and user_id = v_user_id
  returning * into v_budget;

  delete from public.budget_items
   where budget_id = p_budget_id;

  -- ÚNICO CAMBIO FUNCIONAL DE ESTA MIGRACIÓN SOBRE LA RPC.
  --
  -- Las nueve columnas económicas y las siete canónicas se copian EXACTAMENTE
  -- igual que antes. Lo único que se añade es `sort_order`, tomado de la
  -- posición del elemento dentro de `p_items`.
  --
  -- Antes de este cambio la RPC no nombraba la columna, así que cada edición
  -- desde el formulario clásico devolvía TODAS las partidas del presupuesto al
  -- `default 0` y destruía el orden. Ése es el agujero que se cierra aquí, y es
  -- la razón por la que la UNIQUE no podía entrar sin este INSERT.
  insert into public.budget_items (
    budget_id,
    sort_order,
    concept,
    description,
    quantity,
    unit,
    category,
    chapter,
    unit_price,
    subtotal,
    canonical_id,
    canonical_status,
    canonical_confidence,
    canonical_source,
    canonical_origin,
    canonical_source_ref,
    price_type
  )
  select p_budget_id,
         -- `ordinality` es base 1 y la genera Postgres a partir de la posición
         -- real del elemento en el array. No se lee `item->>'sort_order'`: un
         -- valor enviado por el cliente podría venir repetido o con huecos, y la
         -- UNIQUE lo rechazaría con un error incomprensible para el usuario.
         (ordinality - 1)::integer,
         btrim(item->>'concept'),
         coalesce(item->>'description', ''),
         (item->>'quantity')::numeric,
         coalesce(nullif(item->>'unit', ''), 'ud'),
         coalesce(nullif(item->>'category', ''), 'otros'),
         nullif(item->>'chapter', ''),
         (item->>'unit_price')::numeric,
         round((item->>'quantity')::numeric * (item->>'unit_price')::numeric, 2),
         -- Transporte literal: lo que decida el clasificador es lo que se guarda.
         -- Esta función NO clasifica, no deduce y no corrige. Un segundo sistema
         -- de clasificación dentro de SQL sería justo lo que 2D-3 y 2D-4 se
         -- ocuparon de no tener.
         nullif(item->>'canonical_id', ''),
         -- Réplica explícita del default de la columna: al nombrarla en el
         -- INSERT, el default deja de aplicarse. Ver la nota de compatibilidad.
         coalesce(nullif(item->>'canonical_status', ''), 'unmatched'),
         (nullif(item->>'canonical_confidence', ''))::numeric,
         nullif(item->>'canonical_source', ''),
         nullif(item->>'canonical_origin', ''),
         nullif(item->>'canonical_source_ref', ''),
         nullif(item->>'price_type', '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  return to_jsonb(v_budget);
end;
$$;

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
    canonical_source_ref, price_type)
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
    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', '')
  from jsonb_array_elements(p_items) with ordinality t(item, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;

create or replace function public.duplicate_budget(p_budget_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare b public.budgets%rowtype; v_id uuid; v_owner uuid := auth.uid(); v_number text;
begin
  perform budget_internal.lock_owner(v_owner);
  select * into b from public.budgets where id = p_budget_id and user_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'Budget is not available' using errcode = '42501'; end if;
  v_number := 'PRE-' || to_char(current_date, 'YYYY') || '-' || (10000 + floor(random() * 90000))::integer::text;
  if b.client_id is not null then
    perform 1 from public.clients where id = b.client_id and user_id = v_owner for share;
    if not found then raise exception 'Client is not available' using errcode = '42501'; end if;
  end if;
  if b.project_id is not null then
    perform 1 from public.projects where id = b.project_id and user_id = v_owner for share;
    if not found then raise exception 'Project is not available' using errcode = '42501'; end if;
  end if;
  insert into public.budgets(user_id, title, budget_number, status, version, lock_version)
    values (v_owner, b.title || ' (copia)', v_number, 'borrador', 1, 1) returning id into v_id;
  update public.budgets set
    client_id = b.client_id,
    project_id = b.project_id,
    client_name = b.client_name,
    client_email = b.client_email,
    client_phone = b.client_phone,
    client_address = b.client_address,
    client_nif = b.client_nif,
    service_type = b.service_type,
    subtotal = b.subtotal,
    iva_percent = b.iva_percent,
    iva_amount = b.iva_amount,
    total = b.total,
    notes = b.notes,
    valid_until = b.valid_until,
    deposit_percent = b.deposit_percent,
    payment_method = b.payment_method,
    payment_iban = b.payment_iban,
    discount_type = b.discount_type,
    discount_percent = b.discount_percent,
    discount_amount = b.discount_amount,
    payment_schedule = b.payment_schedule,
    warranty_text = b.warranty_text,
    execution_deadline_text = b.execution_deadline_text,
    observations = b.observations,
    conditions_text = b.conditions_text,
    wizard_state = case when jsonb_typeof(b.wizard_state) = 'object'
      then jsonb_set(b.wizard_state, '{draftId}', to_jsonb(v_id::text), true) else b.wizard_state end
    where id = v_id;
  insert into public.budget_items(
    budget_id, sort_order, concept, description, quantity, unit, category, chapter,
    unit_price, subtotal, unit_price_cost, subtotal_cost, canonical_id, canonical_status,
    canonical_confidence, canonical_source, canonical_origin, canonical_source_ref, price_type)
  select v_id, (row_number() over(order by i.sort_order, i.id) - 1)::integer,
    i.concept, i.description, i.quantity, i.unit, i.category, i.chapter, i.unit_price,
    i.subtotal, i.unit_price_cost, i.subtotal_cost, i.canonical_id, i.canonical_status,
    i.canonical_confidence, i.canonical_source, i.canonical_origin, i.canonical_source_ref, i.price_type
    from public.budget_items i where budget_id = p_budget_id;
  return budget_internal.result(v_id, null);
end $fn$;

comment on column public.budget_items.price_source_type is
  'G3. Nivel que eligio el resolutor para el precio. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated. NULL = partida anterior a G3; no significa que careciera de fuente.';
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_G3_L1B

-- BEGIN ROLLBACK_G3_L1A
-- Compensa solo el esquema de G3 lote 1a. Es destructivo en cuanto el lote 1b
-- escriba procedencia: entonces se perderian los origenes, confianzas y fechas
-- ya recogidos. No ejecutar automaticamente tras desplegar 1b.
begin;
alter table public.budget_items
  drop column if exists price_source_type,
  drop column if exists price_confidence,
  drop column if exists price_checked_at;
notify pgrst, 'reload schema';
commit;
-- END ROLLBACK_G3_L1A
