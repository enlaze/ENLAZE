-- E5: centinela de privilegios de tabla concedidos a anon.
-- La consulta es idéntica al bloque CHECK_E5_CENTINELA de CHECKS.sql;
-- __tests__/anon-privileges-sentinel.test.mjs impide que diverjan.
set local lock_timeout = '5s';

create function public.anon_privileges_sentinel()
returns table(veredicto text, reaparecidas bigint, nombres text)
language sql security invoker set search_path = ''
as $sentinel$
-- Periodico, no de despliegue. ESPERADO: veredicto = 'OK' siempre.
-- Existe porque el defecto de supabase_admin puede seguir concediendo: una
-- tabla creada desde el panel de Supabase nacera con anon=arwdDxtm y nadie se
-- enterara hasta que alguien la mire. migraciones-check compara versiones de
-- migracion, no privilegios, asi que esto no lo ve.
select case
         when reaparecidas = 0 then 'OK'
         else 'REVISAR: ' || reaparecidas || ' tablas conceden privilegios a anon: ' || nombres
       end as veredicto, *
from (
  select count(*) as reaparecidas,
         coalesce(string_agg(relname, ', ' order by relname), '') as nombres
    from (select c.relname
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and array_to_string(c.relacl, ' ') like '%anon=%') t
) as evidencia;
$sentinel$;

-- E5 cambió el defecto de TABLAS, no el de FUNCIONES: sin esta revocación
-- la función recién creada sería invocable por anon a través de PUBLIC.
revoke all on function public.anon_privileges_sentinel() from public, anon, authenticated;
grant execute on function public.anon_privileges_sentinel() to service_role;

notify pgrst, 'reload schema';
