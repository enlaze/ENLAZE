-- PROPUESTA (no aplicada todavía — confirmar antes de ejecutar en producción)
--
-- Investigación user_id / RLS sobre las tablas que llena el workflow n8n:
--
--   agent_daily_summary, agent_news, agent_signals,
--   agent_reviews, agent_campaigns, agent_leads, agent_tasks
--
-- Hallazgos:
--   1. El endpoint POST /api/agent/ingest inserta SIEMPRE con `user_id` = payload.user_id.
--      Ese user_id proviene de /api/agent/users, que devuelve profiles donde
--      agent_enabled=true. Es el mismo `auth.users.id` que un usuario logeado
--      → la inserción es correcta.
--   2. El frontend (app/dashboard/agent/page.tsx original) hacía
--      `supabase.from("agent_daily_summary").select("*").limit(1)` SIN filtro
--      por user_id. Si RLS está activo en estas tablas pero NO existe una
--      política SELECT para `auth.uid() = user_id`, el cliente browser con
--      anon key obtiene 0 filas → la tarjeta sale vacía aunque exista la fila.
--   3. Si RLS NO está activo, el cliente browser ve filas de TODOS los usuarios,
--      lo cual también es un problema (filtrado por defecto + filtración de datos).
--
-- Soluciones aplicadas en el frontend (commit asociado):
--   - components/dashboard/AgentExperience.tsx añade `.eq("user_id", user.id)` a
--     todas las queries. Es defensivo: funciona con o sin RLS.
--
-- Esta migración cierra el agujero al lado del servidor:
--   - Habilita RLS en cada tabla del agente.
--   - Añade política SELECT (`auth.uid() = user_id`) para que el cliente browser
--     pueda leer SOLO sus propias filas.
--   - INSERT/UPDATE/DELETE quedan sin política — el workflow usa la service-role
--     key (que pasa de largo RLS) y el resto de la app no necesita escribir
--     directamente. Las pocas mutaciones del cliente (marcar leído, acknowledge,
--     etc.) sí necesitan políticas → se añaden también, con `WITH CHECK` que
--     restringe a filas propias.
--
-- Sigue el mismo patrón que supabase/migrations/20260422_agent_connections.sql.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agent_daily_summary',
    'agent_news',
    'agent_signals',
    'agent_reviews',
    'agent_campaigns',
    'agent_leads',
    'agent_tasks'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ENABLE ROW LEVEL SECURITY;', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can view their own %1$s" ON %1$I;',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users can view their own %1$s" ON %1$I FOR SELECT USING (auth.uid() = user_id);',
      tbl
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can update their own %1$s" ON %1$I;',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users can update their own %1$s" ON %1$I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);',
      tbl
    );
  END LOOP;
END $$;
