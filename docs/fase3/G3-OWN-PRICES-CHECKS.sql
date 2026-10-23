-- Gates de 20261021090000_user_supplied_prices. SOLO LECTURA.
-- Ejecución manual por Álvaro, sin aplicación automática ni acceso de Codex a producción.
-- Ejecutar cada bloque por separado; continuar únicamente con veredicto OK.

-- BEGIN CHECK_G3_OWN_PRECHECK
-- ANTES del push. Anotar price_items_precheck y budget_items_precheck para el AUDIT.
-- La migración usa ADD COLUMN sin IF NOT EXISTS: incluso una columna UUID ya
-- presente exige revisar una aplicación parcial; no se permite empujar encima.
select case
  when registrada <> 0 then 'ABORTAR: 20261021090000 ya esta registrada'
  when columnas_incompatibles > 0 then 'ABORTAR: alguna columna nueva ya existe con otro tipo'
  when columnas_presentes > 0 then 'ABORTAR: columnas nuevas ya presentes; revisar aplicacion parcial'
  when objetos_presentes > 0 then 'ABORTAR: objetos de recogida ya presentes; revisar aplicacion parcial'
  else 'OK' end as veredicto, *
from (select
  (select count(*) from supabase_migrations.schema_migrations where version='20261021090000') as registrada,
  (select count(*) from public.price_items) as price_items_precheck,
  (select count(*) from public.budget_items) as budget_items_precheck,
  (select count(*) from pg_catalog.pg_attribute a
    where not a.attisdropped and a.attnum>0 and
      ((a.attrelid=to_regclass('public.price_items') and a.attname='collection_budget_id') or
       (a.attrelid=to_regclass('public.budget_items') and a.attname='price_item_id'))) as columnas_presentes,
  (select count(*) from pg_catalog.pg_attribute a
    where not a.attisdropped and a.attnum>0 and a.atttypid<>'uuid'::regtype and
      ((a.attrelid=to_regclass('public.price_items') and a.attname='collection_budget_id') or
       (a.attrelid=to_regclass('public.budget_items') and a.attname='price_item_id'))) as columnas_incompatibles,
  (select count(*) from (
    select 1 from pg_catalog.pg_class where oid=to_regclass('public.user_price_collection_events')
    union all select 1 from pg_catalog.pg_proc where oid in
      (to_regprocedure('budget_internal.record_collected_price()'),to_regprocedure('budget_internal.record_own_price_reuse()'),
       to_regprocedure('public.get_user_price_collection_stats(timestamp with time zone)'))
    union all select 1 from pg_catalog.pg_trigger where not tgisinternal and
      ((tgrelid=to_regclass('public.price_items') and tgname='record_collected_price') or
       (tgrelid=to_regclass('public.budget_items') and tgname='record_own_price_reuse'))
  ) parciales) as objetos_presentes) evidencia;
-- END CHECK_G3_OWN_PRECHECK

-- BEGIN CHECK_G3_OWN_AUDIT
-- Inmediatamente DESPUÉS del push, ANTES de habilitar la recogida y de cualquier
-- escritura de la aplicación. Reemplazar AMBOS -1 con los conteos del PRECHECK.
-- No se acepta comparar a ojo: placeholder ausente o filas distintas => ABORTAR.
-- Un ABORTAR por concurrencia exige investigar; no pegar el conteo posterior.
select case
  when registrada <> 1 then 'ABORTAR: 20261021090000 no esta registrada exactamente una vez'
  when price_items_precheck < 0 then 'ABORTAR: pega price_items_precheck del PRECHECK'
  when budget_items_precheck < 0 then 'ABORTAR: pega budget_items_precheck del PRECHECK'
  when price_items_actual <> price_items_precheck then 'ABORTAR: cambio el numero de filas de price_items'
  when budget_items_actual <> budget_items_precheck then 'ABORTAR: cambio el numero de filas de budget_items'
  when columnas_correctas <> 2 then 'ABORTAR: columnas nuevas ausentes o incompatibles'
  when not tabla_eventos or not rls_eventos then 'ABORTAR: falta user_price_collection_events o RLS desactivado'
  when not lectura_eventos_completa then 'ABORTAR: ejecutar como operador que pueda contar todos los eventos, sin filtro RLS'
  when not permisos_eventos then 'ABORTAR: privilegios de user_price_collection_events incompatibles'
  when funciones_correctas <> 2 then 'ABORTAR: funciones ausentes, security definer, search_path o ACL incompatibles'
  when disparadores_correctos <> 2 then 'ABORTAR: disparadores ausentes, desactivados o enlazados incorrectamente'
  when eventos <> 0 then 'ABORTAR: hay eventos; hubo escrituras durante la aplicacion, investigar antes de continuar'
  else 'OK' end as veredicto, *
from (select
  -1::bigint as price_items_precheck, -- <<< PEGA AQUI price_items_precheck
  -1::bigint as budget_items_precheck, -- <<< PEGA AQUI budget_items_precheck
  (select count(*) from supabase_migrations.schema_migrations where version='20261021090000') as registrada,
  (select count(*) from public.price_items) as price_items_actual,
  (select count(*) from public.budget_items) as budget_items_actual,
  (select count(*) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d
    on d.adrelid=a.attrelid and d.adnum=a.attnum
    where not a.attisdropped and a.attnum>0 and a.atttypid='uuid'::regtype and not a.attnotnull and d.oid is null and
      ((a.attrelid=to_regclass('public.price_items') and a.attname='collection_budget_id') or
       (a.attrelid=to_regclass('public.budget_items') and a.attname='price_item_id'))) as columnas_correctas,
  exists(select 1 from pg_catalog.pg_class where oid=to_regclass('public.user_price_collection_events') and relkind='r') as tabla_eventos,
  exists(select 1 from pg_catalog.pg_class where oid=to_regclass('public.user_price_collection_events') and relrowsecurity) as rls_eventos,
  not coalesce(pg_catalog.row_security_active(to_regclass('public.user_price_collection_events')),true) as lectura_eventos_completa,
  coalesce(has_table_privilege('authenticated',to_regclass('public.user_price_collection_events'),'SELECT')
    and not has_table_privilege('authenticated',to_regclass('public.user_price_collection_events'),'INSERT')
    and not has_table_privilege('authenticated',to_regclass('public.user_price_collection_events'),'UPDATE')
    and not has_table_privilege('authenticated',to_regclass('public.user_price_collection_events'),'DELETE')
    and not has_any_column_privilege('authenticated',to_regclass('public.user_price_collection_events'),'INSERT,UPDATE')
    and not has_table_privilege('anon',to_regclass('public.user_price_collection_events'),'SELECT,INSERT,UPDATE,DELETE'),false) as permisos_eventos,
  (select count(*) from pg_catalog.pg_proc p
    where p.oid in (to_regprocedure('budget_internal.record_collected_price()'),to_regprocedure('budget_internal.record_own_price_reuse()'))
      and p.prorettype='trigger'::regtype and p.prosecdef and p.pronargs=0
      and p.proconfig=array['search_path=""']::text[]
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')) as funciones_correctas,
  (select count(*) from pg_catalog.pg_trigger t
    where not t.tgisinternal and t.tgenabled='O' and t.tgtype=21 and t.tgnargs=0
      and t.tgqual is null and cardinality(t.tgattr::smallint[])=0 and
      ((t.tgrelid=to_regclass('public.price_items') and t.tgname='record_collected_price'
        and t.tgfoid=to_regprocedure('budget_internal.record_collected_price()')) or
       (t.tgrelid=to_regclass('public.budget_items') and t.tgname='record_own_price_reuse'
        and t.tgfoid=to_regprocedure('budget_internal.record_own_price_reuse()')))) as disparadores_correctos,
  -- SQL dinámico de SOLO LECTURA con texto fijo, para que una tabla ausente
  -- devuelva ABORTAR en vez de fallar al analizar una referencia inexistente.
  case when not exists(select 1 from pg_catalog.pg_class where oid=to_regclass('public.user_price_collection_events') and relkind='r') then -1::bigint else
    ((xpath('/table/row/n/text()',pg_catalog.query_to_xml(
      'select count(*) as n from public.user_price_collection_events',true,false,'')))[1]::text)::bigint
  end as eventos) evidencia;
-- END CHECK_G3_OWN_AUDIT
