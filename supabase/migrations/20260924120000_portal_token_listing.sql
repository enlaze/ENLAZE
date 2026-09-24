-- Endurecimiento previo a E4-L1: listado seguro de enlaces del portal.
--
-- Posterior y aditiva respecto a 20260923120000_portal_token_lifecycle.sql, que
-- no se toca. Amplía su contrato con la única operación que faltaba: mirar qué
-- enlaces hay sin volver a ver el secreto.
--
-- El problema que resuelve: hoy la pantalla del proyecto hace
-- `.from("portal_tokens").select("token")`, de modo que el secreto vuelve al
-- navegador cada vez que se abre la ficha. `portal_issue_token` y
-- `portal_rotate_token` lo devuelven una vez, que es cuando hay que copiarlo;
-- todo lo demás debería ser metadato.
--
-- ATENCIÓN: esta migración **no** retira el SELECT directo de `authenticated`
-- sobre `portal_tokens`. Retirarlo aquí rompería esa pantalla antes de que el
-- lote 2 la sustituya. La retirada va en el mismo despliegue que la interfaz
-- nueva; hasta entonces NO puede afirmarse que el secreto se muestre una sola
-- vez. Ver docs/fase2/ESTADO-2F2-E4-HARDENING.md.
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Auxiliar privado
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma validación de propiedad que el resto del lote y misma respuesta para
-- un proyecto ajeno, inexistente o borrado: nada que permita deducir que existe.
--
-- A diferencia de `owned_project`, aquí NO se bloquea la fila: esto es una
-- lectura, y tomar FOR UPDATE haría que abrir la ficha de un proyecto
-- serializase las emisiones de ese proyecto sin ninguna razón.
create function portal_token_internal.visible_project(p_project_id uuid, p_owner uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  if p_owner is null or p_project_id is null then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  perform 1 from public.projects
    where id = p_project_id and user_id = p_owner and deleted_at is null;
  if not found then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC pública
-- ─────────────────────────────────────────────────────────────────────────────
-- Devuelve un array, del más reciente al más antiguo, con lo justo para pintar
-- la lista: qué enlaces hay, cuáles siguen vivos y cuándo caducan.
--
-- La forma del metadato es `portal_token_internal.status`, exactamente la misma
-- que ya devuelven revocar y la parte `revoked` de rotar. Reutilizarla en vez de
-- reconstruirla evita que las dos definiciones de "metadato" se separen con el
-- tiempo; el secreto no está en ninguna de las dos.
create function public.portal_list_tokens(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_owner uuid := auth.uid();
begin
  perform portal_token_internal.visible_project(p_project_id, v_owner);
  return coalesce(
    (select jsonb_agg(
       portal_token_internal.status(t)
         -- Vigente con la misma definición que usa el tope de cinco.
         || jsonb_build_object('is_live',
              t.is_active and t.revoked_at is null and t.expires_at > now())
       order by t.created_at desc, t.id desc)
     from public.portal_tokens t
     where t.project_id = p_project_id),
    '[]'::jsonb);
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ACL
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function portal_token_internal.visible_project(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.portal_list_tokens(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_tokens(uuid) to authenticated;

notify pgrst, 'reload schema';
