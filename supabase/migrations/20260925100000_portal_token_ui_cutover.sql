-- E4 lote 2: la interfaz autenticada ya usa exclusivamente las RPC de ciclo
-- de vida y listado. Retira la última vía con la que el navegador podía volver
-- a leer secretos ya emitidos.
--
-- Debe aplicarse DESPUÉS de desplegar la interfaz que acompaña a esta migración
-- y después de 20260925090000_portal_token_listing.sql. El portal público no
-- depende de este grant: valida el portador mediante RPC SECURITY DEFINER.
set local lock_timeout = '5s';

do $guard$
begin
  if to_regprocedure('public.portal_list_tokens(uuid,integer,timestamp with time zone,uuid)') is null then
    raise exception 'portal_list_tokens is required before the UI cutover';
  end if;
  if to_regprocedure('public.portal_issue_token(uuid,jsonb,timestamp with time zone,text)') is null
     or to_regprocedure('public.portal_rotate_token(uuid,timestamp with time zone)') is null
     or to_regprocedure('public.portal_revoke_token(uuid)') is null then
    raise exception 'portal token lifecycle RPCs are required before the UI cutover';
  end if;
end $guard$;

revoke select on table public.portal_tokens from authenticated;

notify pgrst, 'reload schema';
