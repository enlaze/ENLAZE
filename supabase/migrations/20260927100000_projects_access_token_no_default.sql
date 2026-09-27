-- S3.1 · Deja de emitir enlaces heredados en cada proyecto nuevo.
--
-- projects.access_token nació como uuid NOT NULL DEFAULT gen_random_uuid(), de
-- modo que TODO proyecto creado desde entonces trae una URL portadora del
-- portal, la pida alguien o no. Los ocho enlaces que quedan no son un resto
-- histórico que se vaya agotando: son ocho porque hay ocho proyectos. El
-- conjunto crece con cada alta.
--
-- Esto corta la fuente y nada más:
--   · fuera el DEFAULT, para que un proyecto nuevo nazca sin enlace;
--   · la columna pasa a admitir NULL, que es la única forma de retirar después
--     un enlace concreto sin borrar el proyecto.
--
-- Lo que NO hace, a propósito:
--   · no toca ninguna de las ocho filas existentes;
--   · no emite, rota, copia ni revoca ningún token;
--   · no retira la columna ni la compatibilidad heredada de las RPC del portal,
--     así que los ocho enlaces actuales siguen abriendo por portal_read_snapshot.
--
-- La compensación NO es incondicional: en cuanto exista un proyecto con
-- access_token NULL, restaurar el NOT NULL falla. Ver ROLLBACK_2F2_E4_L3.
set local lock_timeout = '5s';

do $guard$
declare
  v_default text;
  v_notnull boolean;
begin
  if to_regclass('public.projects') is null then
    raise exception 'public.projects is required before changing access_token';
  end if;

  select a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    into v_notnull, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.projects'::regclass
     and a.attname = 'access_token'
     and a.attnum > 0
     and not a.attisdropped;

  if not found then
    raise exception 'public.projects.access_token does not exist';
  end if;

  -- Se exige el estado de partida exacto. Si alguien ya lo cambió, esta
  -- migración no es la que corresponde y parar es más barato que adivinar.
  if v_default is distinct from 'gen_random_uuid()' then
    raise exception
      'expected access_token default gen_random_uuid(), found %', coalesce(v_default, '(none)');
  end if;
  if not v_notnull then
    raise exception 'expected access_token to be NOT NULL before this migration';
  end if;
end $guard$;

alter table public.projects
  alter column access_token drop default,
  alter column access_token drop not null;

comment on column public.projects.access_token is
  'Enlace heredado del portal. En retirada (S3): ya no se emite en proyectos '
  'nuevos y admite NULL. Las RPC del portal siguen aceptándolo mientras queden '
  'consumidores; ver docs/fase2/ESTADO-2F2-E4-L3.md.';

notify pgrst, 'reload schema';
