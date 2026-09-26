-- Cierre de privilegios directos residual de portal_tokens.
--
-- La interfaz ya opera exclusivamente mediante cuatro RPC SECURITY DEFINER.
-- 20260925100000 retiró SELECT a authenticated, pero la ACL histórica aún
-- conservaba SELECT/REFERENCES/TRIGGER/TRUNCATE para anon y
-- REFERENCES/TRIGGER/TRUNCATE para authenticated. RLS evitaba que anon viera
-- filas, pero esos grants ya no forman parte del contrato y amplían sin motivo
-- la superficie de ataque.
--
-- No toca filas, políticas, service_role ni los ocho enlaces heredados.
set local lock_timeout = '5s';

do $guard$
begin
  if to_regclass('public.portal_tokens') is null then
    raise exception 'public.portal_tokens is required before closing its ACL';
  end if;
  if to_regprocedure('public.portal_list_tokens(uuid,integer,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.portal_issue_token(uuid,jsonb,timestamp with time zone,text)') is null
     or to_regprocedure('public.portal_rotate_token(uuid,timestamp with time zone)') is null
     or to_regprocedure('public.portal_revoke_token(uuid)') is null then
    raise exception 'all four portal token RPCs are required before closing direct table access';
  end if;
  if not has_function_privilege('authenticated',
       'public.portal_list_tokens(uuid,integer,timestamp with time zone,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.portal_issue_token(uuid,jsonb,timestamp with time zone,text)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.portal_rotate_token(uuid,timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.portal_revoke_token(uuid)', 'EXECUTE') then
    raise exception 'authenticated must retain all four portal token RPCs before direct table access is closed';
  end if;
end $guard$;

revoke all privileges on table public.portal_tokens from public, anon, authenticated;

notify pgrst, 'reload schema';
