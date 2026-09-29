-- S3.3 paso (c): elimina projects.access_token.
--
-- Cierra el lote 3. La columna nació como `uuid not null default gen_random_uuid()`,
-- de modo que cada proyecto recibía un enlace portador del portal, sin caducidad
-- y sin forma de revocarlo. El paso (a) vació los ocho que quedaban, el (b)
-- retiró de las RPC la compatibilidad que aún los aceptaba, y aquí desaparece
-- la columna.
--
-- SÍ ES REVERSIBLE, y conviene decirlo porque parece lo contrario. El paso (a)
-- no lo era: destruía valores que no se guardaban en ninguna parte. Este
-- elimina una columna que ya está vacía en las ocho filas, así que restaurarla
-- —columna, restricción única e índice— devuelve exactamente el mismo estado.
-- ROLLBACK_E4_L3_S33C lo hace.
--
-- Dependencias, inventariadas antes de escribir esto:
--   · projects_access_token_key — restricción UNIQUE con su índice
--   · idx_projects_access_token — índice suelto, redundante con el anterior
--   · el comentario de la columna
-- Las tres caen con el `drop column`; no hay que retirarlas a mano y por eso
-- no se nombran en el statement. Ninguna vista, política ni disparador la
-- referencia, y ningún fichero de app/, lib/ o components/ la nombra: los
-- `access_token` que hay en el código son los de Google OAuth y WhatsApp, que
-- son otra cosa.
set local lock_timeout = '5s';

do $guard$
declare
  v_existe boolean;
  v_con_valor integer;
  v_funciones integer;
begin
  select exists (select 1 from pg_attribute
                  where attrelid = 'public.projects'::regclass
                    and attname = 'access_token' and not attisdropped)
    into v_existe;

  -- Si ya no está, no hay nada que hacer y volver a ejecutarla no debe romper.
  if not v_existe then return; end if;

  -- La columna tiene que estar vacía, y este es el guard que de verdad importa:
  -- sobre una columna vacía el drop es reversible, sobre una con valores
  -- destruye secretos que no están guardados en ningún otro sitio. Va antes que
  -- la comprobación de las funciones a propósito: si quedan enlaces, eso es lo
  -- grave, y es lo que el operador tiene que leer primero.
  select count(*) into v_con_valor
    from public.projects where access_token is not null;
  if v_con_valor > 0 then
    raise exception
      'there are % projects with a legacy link; dropping the column would destroy them irrecoverably', v_con_valor;
  end if;

  -- Y el paso (b) tiene que haber terminado. Con una sola función que todavía
  -- nombre la columna, el drop falla a mitad o la deja sin compilar.
  select count(*) into v_funciones
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%access_token%';
  if v_funciones > 0 then
    raise exception
      '% functions still reference access_token; apply 20260929100000 first', v_funciones;
  end if;
end $guard$;

alter table public.projects drop column if exists access_token;

notify pgrst, 'reload schema';
