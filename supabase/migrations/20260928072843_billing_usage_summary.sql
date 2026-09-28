-- Uso del periodo frente a los límites del plan, para Ajustes → Plan y facturación.
--
-- Cuenta con billing_internal.current_usage, la MISMA función que usa el muro
-- (billing_internal.evaluate y el trigger), así que lo que ve el usuario y lo
-- que le bloquea no pueden desalinearse. Solo lectura: no toma el bloqueo
-- consultivo ni registra nada. A diferencia de billing_check, también
-- responde en solo lectura (para enseñar el uso aunque la cuenta esté parada).
--
-- Solo service_role (la llama /api/billing/status con el usuario ya
-- autenticado), igual que billing_check.

create or replace function public.billing_usage_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  s public.subscriptions%rowtype;
  c public.plan_catalog%rowtype;
  v_out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
begin
  select * into s from public.subscriptions where user_id = p_user_id;
  if s.user_id is null then
    return null;
  end if;
  select * into c from public.plan_catalog where plan = s.plan;
  if c.plan is null then
    raise exception 'billing: plan_catalog sin sincronizar para el plan % (ejecuta npm run plans:sync)', s.plan;
  end if;

  for k, v in select * from jsonb_each(c.limits) loop
    v_out := v_out || jsonb_build_object(k, jsonb_build_object(
      'used', billing_internal.current_usage(p_user_id, k, v ->> 'period'),
      'limit', v -> 'max',
      'period', v ->> 'period'));
  end loop;

  return jsonb_build_object(
    'access_level', billing_internal.access_level(p_user_id),
    'usage', v_out);
end;
$$;

revoke all on function public.billing_usage_summary(uuid) from public, anon, authenticated;
grant execute on function public.billing_usage_summary(uuid) to service_role;
