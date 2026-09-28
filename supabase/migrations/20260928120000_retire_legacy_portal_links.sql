-- S3.3 paso (a): retira los ocho enlaces heredados del portal.
--
-- ESTA MIGRACIÓN ESCRIBE DATOS. Es la primera de la serie que lo hace; todas
-- las anteriores solo tocaban esquema o privilegios. Pone
-- projects.access_token a NULL en los proyectos que todavía lo tienen.
--
-- Por qué se puede hacer de una vez y no proyecto a proyecto: los tres
-- propietarios de los ocho proyectos que hoy tienen enlace son el equipo que
-- construye la plataforma, y ninguno envió nunca un enlace a nadie. No hay
-- ningún cliente al que dejar fuera. El plan original —sustituir uno a uno, comunicar al
-- cliente y observar treinta días— estaba pensado para un escenario que no
-- existe.
--
-- NO ES REVERSIBLE, y es deliberado. El valor de cada token no se guarda en
-- ninguna parte: guardarlo sería conservar justo el secreto que se está
-- retirando. Si alguna vez hiciera falta dar acceso a uno de estos proyectos,
-- se emite un enlace moderno con portal_issue_token, que es el camino bueno.
--
-- Lo que NO hace: no borra ninguna fila, no toca portal_tokens, no retira la
-- compatibilidad heredada de las RPC —eso es el paso (b), y su precheck exige
-- que este haya terminado— y no elimina la columna, que es el paso (c).
set local lock_timeout = '5s';

do $guard$
declare
  v_notnull boolean;
  v_default text;
  v_activos integer;
  v_borrados integer;
begin
  if to_regclass('public.projects') is null then
    raise exception 'public.projects is required';
  end if;

  select a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_notnull, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.projects'::regclass and a.attname = 'access_token';

  -- S3.1 tiene que estar aplicada: sin ella la columna no admite NULL y este
  -- update fallaría a mitad, y además cada alta nueva repondría un enlace.
  if v_notnull then
    raise exception 'access_token is still NOT NULL: apply 20260927100000 first';
  end if;
  if v_default is not null then
    raise exception 'access_token still has default %: apply 20260927100000 first', v_default;
  end if;

  select count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null)
    into v_activos, v_borrados
    from public.projects where access_token is not null;

  -- La línea base revisada con los propietarios son ocho enlaces en proyectos
  -- vivos y ninguno en proyectos borrados. Si el número no cuadra, alguien
  -- creó o borró proyectos después de esa conversación y hay que repetirla
  -- antes de vaciar nada: esto no tiene vuelta atrás.
  if v_activos <> 8 then
    raise exception
      'expected the 8 reviewed legacy links, found %. Re-check with the owners before emptying', v_activos;
  end if;
  if v_borrados <> 0 then
    raise exception
      'found % legacy links on deleted projects, which the review did not cover', v_borrados;
  end if;
end $guard$;

update public.projects
   set access_token = null
 where access_token is not null;

comment on column public.projects.access_token is
  'Enlace heredado del portal, retirado el 2026-09-28 (S3.3 paso a): los ocho '
  'que quedaban se vaciaron y no se emiten nuevos desde 20260927100000. Las RPC '
  'del portal todavía lo aceptan por compatibilidad; retirarla es el paso (b) y '
  'eliminar la columna el (c). Ver docs/fase2/ESTADO-2F2-E4-L3.md.';

notify pgrst, 'reload schema';
