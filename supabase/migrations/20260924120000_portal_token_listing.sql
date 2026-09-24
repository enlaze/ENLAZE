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
-- Devuelve una página del historial, de la más reciente a la más antigua.
--
-- Pagina de verdad, no por cortesía: el tope de cinco solo cuenta enlaces
-- VIGENTES, así que rotar y revocar acumula filas sin límite. Un proyecto vivo
-- durante años puede tener cientos, y un listado que las agregue todas crece
-- sin techo justo en la respuesta que la interfaz del lote 2 va a pedir en cada
-- carga. Mejor fijar el contrato ahora que romperlo después.
--
-- Cursor por (created_at, id) y no por OFFSET: con OFFSET, emitir o revocar
-- entre dos páginas desplaza las filas y el usuario ve repetidos o se salta
-- alguno. El desempate por id hace falta porque created_at empata a poco que
-- se emitan dos enlaces en la misma transacción.
--
-- La forma del metadato es portal_token_internal.status, exactamente la misma
-- que ya devuelven revocar y la parte `revoked` de rotar. Reutilizarla en vez
-- de reconstruirla evita que las dos definiciones de "metadato" se separen con
-- el tiempo; el secreto no está en ninguna de las dos.
create function public.portal_list_tokens(
  p_project_id uuid,
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_owner uuid := auth.uid();
  v_items jsonb;
  v_count integer;
begin
  perform portal_token_internal.visible_project(p_project_id, v_owner);

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  -- Medio cursor no es un cursor: pasar solo una de las dos partes daría una
  -- página silenciosamente distinta de la que el llamante cree pedir.
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'p_cursor_created_at and p_cursor_id must be given together'
      using errcode = '22023';
  end if;

  select jsonb_agg(
           portal_token_internal.status(t)
             -- Vigente con la misma definición que usa el tope de cinco.
             || jsonb_build_object('is_live',
                  t.is_active and t.revoked_at is null and t.expires_at > now())
           order by t.created_at desc, t.id desc)
    into v_items
    from (
      select * from public.portal_tokens pt
       where pt.project_id = p_project_id
         and (p_cursor_created_at is null
              or (pt.created_at, pt.id) < (p_cursor_created_at, p_cursor_id))
       order by pt.created_at desc, pt.id desc
       limit p_limit) t;

  v_items := coalesce(v_items, '[]'::jsonb);
  v_count := jsonb_array_length(v_items);

  /* El cursor es la última fila de esta página, sacada del propio resultado en
     vez de con una segunda consulta. Solo se emite si la página salió llena:
     si vino corta, no queda nada detrás y devolver cursor haría que la
     interfaz pidiera una página vacía de más. */
  return jsonb_build_object(
    'items', v_items,
    'next_cursor', case when v_count < p_limit then null else jsonb_build_object(
      'created_at', v_items -> (v_count - 1) -> 'created_at',
      'id', v_items -> (v_count - 1) -> 'id') end);
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ACL
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function portal_token_internal.visible_project(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.portal_list_tokens(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_tokens(uuid, integer, timestamptz, uuid)
  to authenticated;

notify pgrst, 'reload schema';
