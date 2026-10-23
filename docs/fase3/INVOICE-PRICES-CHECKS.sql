-- Gates de 20261021120000_received_invoice_prices. SOLO LECTURA.
-- Operador sin filtro RLS; una migración por push. No ejecutar desde la aplicación.
-- BEGIN CHECK_INVOICE_PRICES_PRECHECK
select case
  when registrada<>0 then 'ABORTAR: migracion ya registrada'
  when parciales then 'ABORTAR: objetos presentes; revisar aplicacion parcial'
  when not lectura_completa then 'ABORTAR: ejecutar sin filtros RLS'
  else 'OK' end as veredicto, *
from (select
  (select count(*) from supabase_migrations.schema_migrations where version='20261021120000') as registrada,
  (select count(*) from public.received_invoices) as received_invoices_precheck,
  (select count(*) from public.budget_items) as budget_items_precheck,
  (select count(*) from public.price_items) as price_items_precheck,
  (to_regclass('public.received_invoice_lines') is not null or to_regclass('public.invoice_price_usage_events') is not null or to_regprocedure('public.save_received_invoice_lines(uuid,jsonb)') is not null or to_regprocedure('budget_internal.record_invoice_price_reuse()') is not null or to_regprocedure('public.get_invoice_price_stats(timestamp with time zone)') is not null or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.budget_items') and tgname='record_invoice_price_reuse')) as parciales,
  not (pg_catalog.row_security_active('public.received_invoices'::regclass)
    or pg_catalog.row_security_active('public.budget_items'::regclass)
    or pg_catalog.row_security_active('public.price_items'::regclass)) as lectura_completa) e;
-- END CHECK_INVOICE_PRICES_PRECHECK

-- BEGIN CHECK_INVOICE_PRICES_AUDIT
-- Inmediatamente tras aplicar/registrar, ANTES de escrituras. Pegar los TRES -1
-- desde PRECHECK. Si cambian por concurrencia, investigar, no copiar el posterior.
select case
  when registrada<>1 then 'ABORTAR: migracion no registrada exactamente una vez'
  when least(received_invoices_precheck,budget_items_precheck,price_items_precheck)<0 then 'ABORTAR: pegar los tres conteos del PRECHECK'
  when received_invoices_actual<>received_invoices_precheck or budget_items_actual<>budget_items_precheck
    or price_items_actual<>price_items_precheck then 'ABORTAR: cuentas de filas distintas'
  when not lectura_completa then 'ABORTAR: ejecutar sin filtros RLS'
  when tablas_correctas<>2 then 'ABORTAR: tabla ausente o RLS desactivado'
  when permisos_correctos<>2 then 'ABORTAR: privilegios incompatibles'
  when politicas_correctas<>2 then 'ABORTAR: politicas de aislamiento incompatibles'
  when columnas_correctas<>15 or not precio_generado then 'ABORTAR: columnas incompatibles'
  when restricciones_correctas<>5 then 'ABORTAR: claves o relaciones incompatibles'
  when funciones_correctas<>3 then 'ABORTAR: funciones, search_path o ACL incompatibles'
  when disparadores_correctos<>1 then 'ABORTAR: disparador ausente, desactivado o mal enlazado'
  when lineas<>0 or eventos<>0 then 'ABORTAR: hubo escrituras; la migracion no debe crear datos'
  else 'OK' end as veredicto,*
from (select
  -1::bigint as received_invoices_precheck,
  -1::bigint as budget_items_precheck,
  -1::bigint as price_items_precheck,
  (select count(*) from supabase_migrations.schema_migrations where version='20261021120000') as registrada,
  (select count(*) from public.received_invoices) as received_invoices_actual,
  (select count(*) from public.budget_items) as budget_items_actual,
  (select count(*) from public.price_items) as price_items_actual,
  not exists(select 1 from pg_class where oid in (to_regclass('public.received_invoices'),to_regclass('public.price_items'),
    to_regclass('public.budget_items'),to_regclass('public.received_invoice_lines'),to_regclass('public.invoice_price_usage_events'))
    and pg_catalog.row_security_active(oid)) as lectura_completa,
  (select count(*) from pg_class where oid in (to_regclass('public.received_invoice_lines'),to_regclass('public.invoice_price_usage_events'))
    and relkind='r' and relrowsecurity) as tablas_correctas,
  (select count(*) from pg_class c where c.oid in (to_regclass('public.received_invoice_lines'),to_regclass('public.invoice_price_usage_events'))
    and has_table_privilege('authenticated',c.oid,'SELECT')
    and not has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE,REFERENCES')
    and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as permisos_correctos,
  (select count(*) from pg_policy p where p.polcmd='r' and p.polroles=array['authenticated'::regrole::oid]
    and ((p.polrelid=to_regclass('public.received_invoice_lines') and p.polname='received_invoice_lines_owner_read'
      and pg_get_expr(p.polqual,p.polrelid) like '%auth.uid()%'
      and pg_get_expr(p.polqual,p.polrelid) like '%received_invoices%')
      or (p.polrelid=to_regclass('public.invoice_price_usage_events') and p.polname='invoice_price_usage_owner_read'
      and pg_get_expr(p.polqual,p.polrelid)='(user_id = auth.uid())'))
    and (select count(*) from pg_policy q where q.polrelid=p.polrelid)=1) as politicas_correctas,
  (select count(*) from pg_attribute a join (values
    ('received_invoice_lines','id','uuid',true),('received_invoice_lines','invoice_id','uuid',true),
    ('received_invoice_lines','user_id','uuid',true),('received_invoice_lines','line_number','integer',true),
    ('received_invoice_lines','description','text',true),('received_invoice_lines','quantity','numeric(18,6)',false),
    ('received_invoice_lines','unit','text',false),('received_invoice_lines','unit_price','numeric(18,6)',false),
    ('received_invoice_lines','amount','numeric(18,2)',false),('received_invoice_lines','effective_unit_price','numeric',false),
    ('received_invoice_lines','created_at','timestamp with time zone',true),
    ('invoice_price_usage_events','user_id','uuid',true),('invoice_price_usage_events','invoice_line_id','uuid',true),
    ('invoice_price_usage_events','budget_id','uuid',true),('invoice_price_usage_events','occurred_at','timestamp with time zone',true)
  ) expected(tbl,col,typ,nn) on a.attrelid=to_regclass('public.'||expected.tbl) and a.attname=expected.col
    where not a.attisdropped and format_type(a.atttypid,a.atttypmod)=expected.typ and a.attnotnull=expected.nn) as columnas_correctas,
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.received_invoice_lines')
    and attname='effective_unit_price' and attgenerated='s') as precio_generado,
  (select count(*) from pg_constraint where
    (conrelid=to_regclass('public.received_invoice_lines') and contype in ('p','u'))
    or (conrelid=to_regclass('public.received_invoice_lines') and contype='f' and confdeltype='c'
      and confrelid in (to_regclass('public.received_invoices'),to_regclass('auth.users')))
    or (conrelid=to_regclass('public.invoice_price_usage_events') and contype='p')) as restricciones_correctas,
  (select count(*) from pg_proc p join (values
    ('public.save_received_invoice_lines(uuid,jsonb)',true,true),
    ('budget_internal.record_invoice_price_reuse()',true,false),
    ('public.get_invoice_price_stats(timestamp with time zone)',false,true)
  ) expected(signature,definer,callable) on p.oid=to_regprocedure(expected.signature)
    where p.prosecdef=expected.definer and p.proconfig=array['search_path=""']::text[]
      and has_function_privilege('authenticated',p.oid,'EXECUTE')=expected.callable
      and not has_function_privilege('anon',p.oid,'EXECUTE')) as funciones_correctas,
  (select count(*) from pg_trigger where tgrelid=to_regclass('public.budget_items') and tgname='record_invoice_price_reuse'
    and tgfoid=to_regprocedure('budget_internal.record_invoice_price_reuse()') and not tgisinternal
    and tgenabled='O' and tgtype=21 and tgnargs=0 and tgqual is null and cardinality(tgattr::smallint[])=0) as disparadores_correctos,
  case when to_regclass('public.received_invoice_lines') is null then -1::bigint else
    ((xpath('/table/row/n/text()',pg_catalog.query_to_xml(
      'select count(*) as n from public.received_invoice_lines',true,false,'')))[1]::text)::bigint end as lineas,
  case when to_regclass('public.invoice_price_usage_events') is null then -1::bigint else
    ((xpath('/table/row/n/text()',pg_catalog.query_to_xml(
      'select count(*) as n from public.invoice_price_usage_events',true,false,'')))[1]::text)::bigint end as eventos
  ) e;
-- END CHECK_INVOICE_PRICES_AUDIT
