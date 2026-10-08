create or replace function pg_temp.fallo(p_sql text, p_etiqueta text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'NO RECHAZADO (mal): ' || p_etiqueta;
exception when others then
  return 'rechazado ok (' || sqlstate || '): ' || p_etiqueta;
end $$;

\echo '--- A. Portal: el caso ambiguo no filtra la factura sin obra ---'
-- Obra 7 es del Cliente 1, que tiene cuatro obras. Su factura heredada, ahora
-- en el hub y sin obra asignada, NO debe asomar por ese enlace.
select jsonb_array_length(public.portal_read_snapshot('aaaa2222-0000-4000-8000-000000000001') -> 'invoices') as facturas_visibles_obra7,
       (select count(*) from public.projects where client_id='27682fab-427a-4bf3-89aa-75bddc2247f4' and deleted_at is null) as obras_del_cliente1;

\echo '--- B. Portal: el caso inequivoco si la muestra ---'
-- Cliente 13 tiene una sola obra: una factura suya sin obra se le atribuye.
insert into public.received_invoices (id,user_id,client_id,invoice_number,supplier_name,issue_date,subtotal,iva_amount,total,category,status)
values ('aaaa5555-0000-4000-8000-000000000001','53918141-519a-4397-95bb-b61321021479',
        'aaaa3333-0000-4000-8000-000000000001','SINT-1','Proveedor sintetico','2026-10-01',100,21,121,'material','pending');
select jsonb_array_length(public.portal_read_snapshot('aaaa2222-0000-4000-8000-000000000002') -> 'invoices') as facturas_visibles_obra9,
       public.portal_read_snapshot('aaaa2222-0000-4000-8000-000000000002') -> 'invoices' -> 0 -> 'invoice_number' as cual;

\echo '--- C. Portal: un enlace revocado de verdad sigue sin devolver nada ---'
select public.portal_read_snapshot('6e20d7c2-bd44-425c-99c6-143d99cf566f') is null as enlace_revocado_no_devuelve_nada,
       public.portal_read_snapshot('no-es-un-uuid') is null as token_malformado_tampoco;

\echo '--- D. Resumen fiscal por trimestre, sobre los datos reales de cada usuario ---'
select left(user_id::text,8) as usuario,
       extract(year from issue_date)::int as anio,
       'T' || extract(quarter from issue_date)::int as trimestre,
       count(*) as facturas, sum(subtotal) as base, sum(iva_amount) as iva, sum(total) as total
from public.received_invoices
where deleted_at is null and id <> 'aaaa5555-0000-4000-8000-000000000001'
group by 1,2,3 order by 1,2,3;

\echo '--- E. Editar una factura real con cliente y obra reales de su dueno ---'
set test.uid = '53918141-519a-4397-95bb-b61321021479';
select public.update_received_invoice_and_reconcile(
  'a4e7365f-4ca9-4bcc-bd80-6ef02efe4712','031-0011-983717',NULL,'Proveedor heredada 1','B30000001',
  '2025-11-28',NULL,51.66,21,10.85,0,0,62.51,'transferencia','Nota heredada 1',
  '27682fab-427a-4bf3-89aa-75bddc2247f4','1701fb3d-6ded-4c82-811b-5a3048e173f0','material',
  'A','2025-11-27','Domicilio 1','Material de obra', NULL) is not null as devuelve_fila;
select invoice_series as serie, operation_date as f_operacion, description as descripcion,
       left(project_id::text,8) as obra, category as categoria
from public.received_invoices where id='a4e7365f-4ca9-4bcc-bd80-6ef02efe4712';

\echo '--- F. El desglose por tipos, sobre esa misma factura real ---'
select public.update_received_invoice_and_reconcile(
  'a4e7365f-4ca9-4bcc-bd80-6ef02efe4712','031-0011-983717',NULL,'Proveedor heredada 1','B30000001',
  '2025-11-28',NULL,51.66,NULL,7.37,0,0,59.03,'transferencia','Nota heredada 1',
  '27682fab-427a-4bf3-89aa-75bddc2247f4','1701fb3d-6ded-4c82-811b-5a3048e173f0','material',
  'A','2025-11-27','Domicilio 1','Material de obra',
  '[{"base":21.66,"rate":21,"quota":4.55},{"base":30.00,"rate":9.4,"quota":2.82}]'::jsonb) is not null as devuelve_fila;
select subtotal, iva_percent, iva_amount, vat_breakdown from public.received_invoices where id='a4e7365f-4ca9-4bcc-bd80-6ef02efe4712';

select pg_temp.fallo($q$ select public.update_received_invoice_and_reconcile(
  'a4e7365f-4ca9-4bcc-bd80-6ef02efe4712','031-0011-983717',NULL,'P','B',
  '2025-11-28',NULL,51.66,NULL,7.37,0,0,59.03,NULL,NULL,
  NULL,NULL,'material',NULL,NULL,NULL,NULL,
  '[{"base":10,"rate":21,"quota":2.10}]'::jsonb) $q$,
  'desglose que no cuadra con la base de la factura') as resultado;

select pg_temp.fallo($q$ select public.update_received_invoice_and_reconcile(
  'a4e7365f-4ca9-4bcc-bd80-6ef02efe4712','X',NULL,'P','B','2025-11-28',NULL,10,21,2.1,0,0,12.1,NULL,NULL,
  'c6852e63-d57e-4f19-8000-6f02ac58ca9f',NULL,'material',NULL,NULL,NULL,NULL,NULL) $q$,
  'cliente de otro usuario sobre una factura real') as resultado;

\echo '--- G. La tabla heredada queda sellada para los roles del navegador ---'
select has_table_privilege('authenticated','public.invoices','INSERT') as auth_insert,
       has_table_privilege('authenticated','public.invoices','UPDATE') as auth_update,
       has_table_privilege('authenticated','public.invoices','SELECT') as auth_select,
       has_table_privilege('anon','public.invoice_items','INSERT') as anon_insert_lineas;

\echo '--- H. Albaranes: ahora si acepta una factura del hub ---'
update public.delivery_notes set invoice_id='b7920586-e743-40c1-8c6f-f81785624ea6'
 where id='d7ceac79-11be-48f3-a522-59bb7b091fea';
select left(invoice_id::text,8) as albaran_apunta_a from public.delivery_notes where id='d7ceac79-11be-48f3-a522-59bb7b091fea';
select pg_temp.fallo($q$ update public.delivery_notes set invoice_id='a4e7365f-4ca9-4bcc-bd80-6ef02efe4713'
  where id='d7ceac79-11be-48f3-a522-59bb7b091fea' $q$, 'albaran apuntando a una factura inexistente') as resultado;
