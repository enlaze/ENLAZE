-- ═══════════════════════════════════════════════════════════════════════════
-- AGENTE: fugas de coste y fiabilidad del briefing
--
--   1. Idempotencia de agent_daily_summary: deduplicar el histórico y añadir
--      un índice UNIQUE (user_id, execution_date) para que /api/agent/ingest
--      pueda hacer upsert y un reintento del workflow no genere (ni pague)
--      dos briefings del mismo día.
--   2. agent_eligible_users(): actividad real del usuario para saltar cuentas
--      dormidas sin excluir a los usuarios nuevos.
--   3. agent_summary_cache: caché con TTL para los resúmenes de módulos que
--      pasan por un modelo (Gmail/Haiku), para no reclasificar en cada visita.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Idempotencia del briefing diario
-- ───────────────────────────────────────────────────────────────────────────

-- 1.a Deduplicar lo ya guardado. De cada (user_id, execution_date) se conserva
--     primero la fila que SÍ tiene salida de IA — así ningún día pierde su
--     briefing porque un reintento posterior lo guardara vacío — y entre las
--     empatadas, la más reciente, que es la que habría dejado un upsert.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, execution_date
      ORDER BY
        ((raw_payload -> 'daily_summary' -> 'ai_briefing' ->> 'headline') IS NOT NULL) DESC,
        coalesce(created_at, '-infinity'::timestamptz) DESC,
        id DESC
    ) AS rn
  FROM public.agent_daily_summary
)
DELETE FROM public.agent_daily_summary s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

-- 1.b La restricción que hace posible el upsert.
CREATE UNIQUE INDEX IF NOT EXISTS agent_daily_summary_user_execution_date_key
  ON public.agent_daily_summary (user_id, execution_date);

-- 1.c El índice antiguo tenía exactamente las mismas columnas en el mismo
--     orden, así que el UNIQUE lo cubre por completo.
DROP INDEX IF EXISTS public.idx_agent_summary_date;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Usuarios elegibles para el agente (actividad real, no agent_last_run_at)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Señales de actividad, de más a menos fiable:
--   * auth.users.last_sign_in_at  — último login real (lo mantiene Supabase
--     Auth). Vive en el esquema `auth`, que PostgREST no expone: de ahí que
--     esto tenga que ser una función y no una consulta desde el route.
--   * profiles.last_login_at      — columna propia (hoy sin escritor, se deja
--     por si algún día se rellena).
--   * max(activity_log.created_at) — última acción registrada en la app.
--
-- Un usuario SIN ninguna señal cae a profiles.created_at: una cuenta recién
-- creada nunca se considera dormida. Nunca se mira agent_last_run_at — eso
-- dejaría fuera precisamente a quien aún no ha generado ningún briefing.
--
-- Devuelve TODOS los usuarios con el agente activo del sector, marcados con
-- is_active, para que quien llame pueda contar y registrar a los saltados.

CREATE OR REPLACE FUNCTION public.agent_eligible_users(
  p_sector text,
  p_inactive_days integer DEFAULT 14
)
RETURNS TABLE (
  user_id uuid,
  business_name text,
  business_type text,
  city text,
  agent_status text,
  agent_last_run_at timestamptz,
  last_activity_at timestamptz,
  activity_source text,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
  ),
  resolved AS (
    SELECT
      s.*,
      -- greatest() en Postgres ignora los NULL y sólo devuelve NULL si todos
      -- los argumentos lo son.
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
      -- Umbral <= 0 desactiva el filtro (útil para depurar o forzar una
      -- ejecución completa sin tocar el código).
      p_inactive_days <= 0
      OR coalesce(r.best_activity_at, r.profile_created_at)
           >= now() - make_interval(days => p_inactive_days)
    ) AS is_active
  FROM resolved r
  ORDER BY r.business_name NULLS LAST;
$$;

COMMENT ON FUNCTION public.agent_eligible_users(text, integer) IS
  'Usuarios con agent_enabled del sector dado, con su última actividad real '
  '(login de auth.users, last_login_at o activity_log) y si entran dentro del '
  'umbral de inactividad. SECURITY DEFINER porque lee auth.users; sólo '
  'service_role puede ejecutarla.';

-- SECURITY DEFINER + lectura de auth.users: no puede quedar al alcance de un
-- cliente del navegador. La llama /api/agent/users con la service role key.
REVOKE ALL ON FUNCTION public.agent_eligible_users(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_eligible_users(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.agent_eligible_users(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_eligible_users(text, integer) TO service_role;

-- La función filtra por (agent_enabled, business_sector) y busca la última
-- acción por usuario.
CREATE INDEX IF NOT EXISTS idx_profiles_agent_enabled_sector
  ON public.profiles (business_sector)
  WHERE agent_enabled IS TRUE;

CREATE INDEX IF NOT EXISTS idx_activity_log_user_created
  ON public.activity_log (user_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Caché con TTL para los resúmenes de módulos que pasan por un modelo
-- ───────────────────────────────────────────────────────────────────────────
--
-- Una fila por (user_id, module). El panel de Email montaba
-- /api/agent/gmail/summary en cada visita y eso reclasificaba la bandeja con
-- Haiku cada vez. La caché va en base de datos, no en memoria del proceso,
-- porque en serverless cada instancia tendría su propia copia.

CREATE TABLE IF NOT EXISTS public.agent_summary_cache (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  payload jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, module)
);

COMMENT ON TABLE public.agent_summary_cache IS
  'Caché con TTL de los resúmenes por módulo (Gmail, ...) para no repetir la '
  'clasificación con modelo en cada visita al panel.';

-- Barrido de entradas caducadas.
CREATE INDEX IF NOT EXISTS idx_agent_summary_cache_expires
  ON public.agent_summary_cache (expires_at);

ALTER TABLE public.agent_summary_cache ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para el dueño: la escritura la hace el route con service_role,
-- que no pasa por RLS.
DROP POLICY IF EXISTS "agent_summary_cache_own_select" ON public.agent_summary_cache;
CREATE POLICY "agent_summary_cache_own_select" ON public.agent_summary_cache
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
