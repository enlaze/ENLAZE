-- El agente de n8n (workflow comercio local) solo debe ejecutarse para cuentas
-- que pueden usar el briefing diario: plan que incluye 'briefing_diario'
-- (Profesional, Empresa o la prueba) y cuenta con acceso completo (no en solo
-- lectura). Antes se ejecutaba para todos y /api/agent/ingest tiraba el
-- resultado de los que no lo tienen: pagábamos ejecuciones para nada.
--
-- El filtro va aquí y no en n8n: n8n ni siquiera recibe esas cuentas. Usa el
-- mismo plan_catalog (copia de lib/plans.ts) y el mismo cálculo de acceso que
-- el muro de pago (billing_internal.access_level).

create or replace function public.agent_eligible_users(p_sector text, p_inactive_days integer default 14)
returns table(user_id uuid, business_name text, business_type text, city text, agent_status text,
              agent_last_run_at timestamp with time zone, last_activity_at timestamp with time zone,
              activity_source text, is_active boolean)
language sql
stable security definer
set search_path to ''
as $function$
  WITH signals AS (
    SELECT
      p.id,
      p.business_name,
      p.business_type,
      p.city,
      p.agent_status,
      p.agent_last_run_at,
      p.created_at AS profile_created_at,
      u.last_sign_in_at,
      p.last_login_at,
      (
        SELECT max(a.created_at)
        FROM public.activity_log a
        WHERE a.user_id = p.id
      ) AS last_action_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.agent_enabled IS TRUE
      AND p.business_sector = p_sector
      -- Muro de pago: solo cuentas con el briefing diario en su plan y acceso completo.
      AND billing_internal.access_level(p.id) = 'full'
      AND EXISTS (
        SELECT 1
        FROM public.subscriptions s
        JOIN public.plan_catalog c ON c.plan = s.plan
        WHERE s.user_id = p.id
          AND c.features @> array['briefing_diario']
      )
  ),
  resolved AS (
    SELECT
      s.*,
      greatest(s.last_sign_in_at, s.last_login_at, s.last_action_at) AS best_activity_at
    FROM signals s
  )
  SELECT
    r.id,
    r.business_name,
    r.business_type,
    r.city,
    r.agent_status,
    r.agent_last_run_at,
    coalesce(r.best_activity_at, r.profile_created_at) AS last_activity_at,
    CASE
      WHEN r.best_activity_at IS NULL                     THEN 'profile_created'
      WHEN r.best_activity_at = r.last_action_at          THEN 'activity_log'
      WHEN r.best_activity_at = r.last_sign_in_at         THEN 'last_sign_in'
      ELSE 'last_login'
    END AS activity_source,
    (
      p_inactive_days <= 0
      OR coalesce(r.best_activity_at, r.profile_created_at)
           >= now() - make_interval(days => p_inactive_days)
    ) AS is_active
  FROM resolved r
  ORDER BY r.business_name NULLS LAST;
$function$;

revoke all on function public.agent_eligible_users(text, integer) from public, anon, authenticated;
grant execute on function public.agent_eligible_users(text, integer) to service_role;
