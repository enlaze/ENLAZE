-- E6 lote 1: `authenticated` pierde los cuatro privilegios que no usa.
--
-- De los ocho que componen `arwdDxtm`, esta aplicación no usa ninguno de
-- estos cuatro en ninguna tabla:
--
--   D  TRUNCATE     vaciar una tabla entera
--   x  REFERENCES   crear claves ajenas
--   t  TRIGGER      crear disparadores
--   m  MAINTAIN     VACUUM, ANALYZE, REINDEX
--
-- Y TRUNCATE es el que importa: **RLS no lo cubre**. Las políticas se aplican a
-- SELECT, INSERT, UPDATE y DELETE; un TRUNCATE no pasa por ellas. Hoy cualquier
-- usuario autenticado con una conexión directa a PostgreSQL podría vaciar
-- cualquiera de las 88 tablas que conceden `D`.
--
-- No es alcanzable con la clave pública, porque PostgREST no expone TRUNCATE
-- —exactamente la misma situación que tenía `anon` antes de 20261004180000— y
-- la respuesta correcta es la misma: si no hace falta, no se concede.
--
-- LO QUE NO HACE: no toca SELECT, INSERT, UPDATE ni DELETE. El panel consulta
-- 78 de las 93 tablas con el JWT del usuario y seguirá pudiendo. Estrechar eso
-- es el lote 2 y exige verificar tabla por tabla.
set local lock_timeout = '5s';

do $guard$
declare
  v_quedarian_sin_nada integer;
begin
  -- Una tabla que solo concediera x, t o m —sin r, a, w ni d— se quedaría sin
  -- ningún privilegio tras esta migración, y eso sería una pérdida silenciosa
  -- en vez de una limpieza. Hoy no hay ninguna; si apareciera, hay que mirarla
  -- antes y no descubrirlo después.
  select count(*) into v_quedarian_sin_nada
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select coalesce((select a from unnest(c.relacl::text[]) a
                        where a like 'authenticated=%'), '') as acl
    ) g
   where n.nspname = 'public' and c.relkind = 'r'
     and g.acl <> ''
     and split_part(split_part(g.acl, '=', 2), '/', 1) ~ '^[xtm]+$';
  if v_quedarian_sin_nada > 0 then
    raise exception
      '% tables would be left with no privileges for authenticated; review them first', v_quedarian_sin_nada;
  end if;
end $guard$;

-- Generado del catálogo y no escrito a mano: una lista de noventa y un nombres
-- se queda vieja a la primera tabla nueva, y quien la lea creerá que está
-- completa.
do $revoke$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and array_to_string(c.relacl, ' ') like '%authenticated=%'
     order by c.relname
  loop
    execute format(
      'revoke truncate, references, trigger, maintain on table public.%I from authenticated',
      t.relname);
  end loop;
end $revoke$;

-- Igual que en E5: sin esto, la siguiente tabla nueva vuelve a concederlos.
alter default privileges in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;

notify pgrst, 'reload schema';
