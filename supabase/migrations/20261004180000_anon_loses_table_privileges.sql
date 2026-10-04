-- E5: `anon` deja de tener privilegios de tabla en `public`.
--
-- Generaliza lo que 20260925110000 hizo para portal_tokens. Hoy `anon` tiene
-- arwdDxtm —INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN— sobre 88 tablas, incluida sync_api_keys. Nadie lo concedió: es el
-- comportamiento de fábrica de los privilegios por defecto del esquema.
--
-- NO HAY FUGA HOY. RLS está activo y las políticas se apoyan en auth.uid(),
-- que para un anónimo es NULL. Lo que hay es una sola capa de protección: una
-- política escrita USING (true) en cualquiera de esas tablas la abre entera a
-- internet. Ese error ya se cometió aquí —20260915150000 tuvo que eliminar
-- tres políticas públicas— y con los privilegios retirados no habría expuesto
-- nada, porque no habría permiso debajo.
--
-- Dos matices que conviene tener escritos: RLS NO cubre TRUNCATE, así que ese
-- permiso no está mitigado por ninguna política; y no es alcanzable con la
-- clave anónima porque PostgREST no expone TRUNCATE.
--
-- POR QUÉ SE PUEDE AHORA Y NO LA SEMANA PASADA: hasta el lote 3 el portal era
-- anónimo y leía tablas. Desde 20260929100000 habla con la base por exactamente
-- tres RPC SECURITY DEFINER, que se ejecutan como su propietario y no necesitan
-- que `anon` tenga ningún privilegio de tabla. Verificado además que ninguna
-- otra superficie anónima consulta la base: la landing y la página de precios
-- no consultan —los planes van compilados en lib/plans.ts—, y login consulta
-- profiles ya autenticado.
--
-- `authenticated` NO SE TOCA, y es deliberado. El panel consulta tablas con el
-- JWT del usuario y ahí RLS sí funciona con auth.uid() real. Revocarle
-- privilegios rompería el producto; merece un análisis tabla por tabla y su
-- propio lote.
set local lock_timeout = '5s';

do $guard$
declare
  v_rpcs integer;
begin
  -- Las tres RPC del portal son la única vía anónima que queda. Si alguna no
  -- existe, no es SECURITY DEFINER o `anon` no puede ejecutarla, retirar los
  -- privilegios de tabla dejaría el portal incomunicado.
  select count(*) into v_rpcs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('portal_read_snapshot','portal_respond_to_change','portal_respond_to_budget')
     and p.prosecdef
     and array_to_string(p.proacl, ' ') like '%anon=X%';
  if v_rpcs <> 3 then
    raise exception
      'expected the 3 portal RPCs to be SECURITY DEFINER and executable by anon, found %', v_rpcs;
  end if;
end $guard$;

-- No hay guard sobre funciones INVOKER ejecutables por anon, y se explica por
-- qué: hay ocho, y ninguna es una vía de lectura. Tres son puras
-- —canonical_normalize, portal_token_default_lifetime, portal_token_max_lifetime—
-- más un validador, portal_token_permissions_valid. Las otras cuatro son
-- funciones de disparador sin argumentos: invocadas directamente reciben NEW
-- nulo y fallan, y como disparadores solo corren dentro de una escritura que
-- `anon` ya no podrá hacer. Un guard que las detectara por el texto de su
-- cuerpo abortaría por falsos positivos, que es peor que no tenerlo.

-- La lista se genera del catálogo, no se escribe a mano: una lista de ochenta
-- y ocho nombres se queda vieja a la primera tabla nueva, y quien la lea creerá
-- que está completa.
do $revoke$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and array_to_string(c.relacl, ' ') like '%anon=%'
     order by c.relname
  loop
    execute format('revoke all privileges on table public.%I from anon', t.relname);
  end loop;
end $revoke$;

-- La causa raíz: sin esto, la siguiente migración que cree una tabla vuelve a
-- conceder arwdDxtm a anon y en unos meses estaríamos igual sin que nadie
-- hubiera hecho nada mal.
alter default privileges in schema public revoke all on tables from anon;

-- Disparador de alta de usuario. No tiene motivo para ser invocable por un
-- anónimo: llamado directamente recibiría NEW nulo, pero es superficie que no
-- hace falta.
--
-- Condicional a propósito: es una limpieza incidental, no el objetivo de la
-- migración. Que aborte entera porque esta función no exista en un entorno
-- concreto seria dejar sin retirar ochenta y ocho tablas por un detalle.
do $limpieza$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke execute on function public.handle_new_user() from anon';
  end if;
end $limpieza$;

notify pgrst, 'reload schema';
