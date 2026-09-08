-- Seguridad: get_expense_summary es SECURITY DEFINER (ignora RLS) y aceptaba
-- cualquier p_user_id, con EXECUTE concedido a anon. Cualquiera con la anon key
-- podía obtener el resumen financiero (pendiente, vencido, proveedores) de
-- CUALQUIER usuario pasando su uuid. Es la misma fuga que las políticas abiertas,
-- pero por vía RPC.
--
-- Los dos únicos llamantes de la app (lib/suppliers.ts) pasan siempre el id del
-- usuario de la sesión, así que forzar el propietario no cambia el comportamiento.
--
-- Nota: get_treasury_summary es SECURITY INVOKER, así que RLS ya lo protege.

create or replace function public.get_expense_summary(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
DECLARE
  result json;
  v_caller uuid := auth.uid();
BEGIN
  -- service_role (rutas de servidor) mantiene acceso completo; cualquier otro
  -- llamante sólo puede pedir su propio resumen.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF v_caller IS NULL OR p_user_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'forbidden: cannot read another user''s expense summary'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT json_build_object(
    'total_pending', COALESCE((SELECT SUM(total - amount_paid) FROM received_invoices WHERE user_id = p_user_id AND payment_status != 'paid'), 0),
    'total_paid_month', COALESCE((SELECT SUM(amount_paid) FROM received_invoices WHERE user_id = p_user_id AND payment_date >= date_trunc('month', CURRENT_DATE)), 0),
    'total_overdue', COALESCE((SELECT SUM(total - amount_paid) FROM received_invoices WHERE user_id = p_user_id AND due_date < CURRENT_DATE AND payment_status != 'paid'), 0),
    'invoices_pending', (SELECT COUNT(*) FROM received_invoices WHERE user_id = p_user_id AND payment_status != 'paid'),
    'invoices_overdue', (SELECT COUNT(*) FROM received_invoices WHERE user_id = p_user_id AND due_date < CURRENT_DATE AND payment_status != 'paid'),
    'suppliers_active', (SELECT COUNT(*) FROM suppliers WHERE user_id = p_user_id AND status = 'active')
  ) INTO result;
  RETURN result;
END;
$function$;

-- La app sólo la llama con sesión iniciada: anon no la necesita.
revoke execute on function public.get_expense_summary(uuid) from anon;
