-- 20260709_user_data_rls_policies.sql
--
-- Arregla el problema SISTÉMICO de RLS incompleto en las tablas de datos de
-- usuario. Varias tablas tienen RLS activo pero les falta alguna política
-- (típicamente INSERT), lo que hace que operaciones del navegador (p.ej.
-- "Crear obra/proyecto" en el wizard de presupuestos) fallen en silencio con
-- el error 42501 ("new row violates row-level security policy").
--
-- DEFENSIVA:
--   * Cada tabla se valida contra information_schema ANTES de crear políticas.
--     Si no existe la tabla / la columna esperada, se hace SKIP (CONTINUE) con
--     un RAISE NOTICE; NO se aborta el bloque entero.
--   * price_items (banco de precios / catálogo) recibe trato especial: puede
--     contener filas semilla compartidas con user_id NULL; su SELECT usa
--     (auth.uid() = user_id OR user_id IS NULL) para no ocultar la semilla,
--     mientras que INSERT/UPDATE/DELETE siguen estrictos.
--
-- Idempotente: nombre de política determinista por tabla + DROP IF EXISTS.
--
-- NO se tocan (decisión revisada):
--   * profiles          -> ya arreglado; usa `id`.
--   * portal_tokens     -> lectura PÚBLICA por token (portal del cliente sin login).
--   * sector_data       -> catálogo compartido por `sector`, escrito por service-role.
--   * document_versions -> polimórfica; dueño en `changed_by` (nullable).
--   * budget_lines      -> solo lecturas en la app.
--
-- fiscal_events -> issued_invoices (invoice_id): CONFIRMADO. recordFiscalEvent()
--   se llama desde issued-invoices/[id] pasando invoice.id de la factura emitida.

-- ===========================================================================
-- A) Tablas con columna user_id directa — política ESTRICTA (auth.uid() = user_id)
-- ===========================================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'clients',
    'projects',
    'budgets',
    'suppliers',
    'received_invoices',
    'supplier_payments',
    'project_suppliers',
    'project_changes',
    'payments',
    'orders',
    'invoices',
    'issued_invoices',
    'delivery_notes',
    'fiscal_settings',
    'messages',
    'events',
    'ai_runs',
    'legal_acceptances',
    'marketing_consents',
    'notifications',
    'notification_settings',
    'notification_preferences',
    'activity_log',
    'agent_news',
    'agent_leads',
    'agent_tasks',
    'agent_signals',
    'agent_reviews',
    'agent_daily_summary',
    'agent_campaigns'
  ]
  LOOP
    -- Guard: la tabla debe existir y tener columna user_id.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'user_id'
    ) THEN
      RAISE NOTICE 'SKIP A) public.% (no existe o sin columna user_id)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_select_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = user_id);', tbl || '_select_own', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_insert_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id);', tbl || '_insert_own', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_update_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);', tbl || '_update_own', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_delete_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (auth.uid() = user_id);', tbl || '_delete_own', tbl);

    RAISE NOTICE 'OK  A) public.% (estricta user_id)', tbl;
  END LOOP;
END $$;

-- ===========================================================================
-- A2) price_items — banco de precios: SELECT tolera semilla compartida (user_id NULL),
--     escrituras estrictas. Guard de existencia igual que en A).
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_items' AND column_name = 'user_id'
  ) THEN
    RAISE NOTICE 'SKIP A2) public.price_items (no existe o sin columna user_id)';
  ELSE
    ALTER TABLE public.price_items ENABLE ROW LEVEL SECURITY;

    -- SELECT: filas propias + semilla compartida (user_id NULL)
    DROP POLICY IF EXISTS price_items_select_own ON public.price_items;
    CREATE POLICY price_items_select_own ON public.price_items
      FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

    -- Escrituras: SOLO filas propias (nadie puede crear/editar/borrar la semilla)
    DROP POLICY IF EXISTS price_items_insert_own ON public.price_items;
    CREATE POLICY price_items_insert_own ON public.price_items
      FOR INSERT WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS price_items_update_own ON public.price_items;
    CREATE POLICY price_items_update_own ON public.price_items
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS price_items_delete_own ON public.price_items;
    CREATE POLICY price_items_delete_own ON public.price_items
      FOR DELETE USING (auth.uid() = user_id);

    RAISE NOTICE 'OK  A2) public.price_items (SELECT incluye user_id IS NULL)';
  END IF;
END $$;

-- ===========================================================================
-- B) Tablas hijas: propiedad derivada del padre vía FK.
--    Guard: el hijo debe tener la columna fk y el padre debe tener user_id.
-- ===========================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('budget_items',         'budget_id',        'budgets'),
      ('invoice_items',        'invoice_id',       'invoices'),
      ('issued_invoice_lines', 'invoice_id',       'issued_invoices'),
      ('delivery_note_lines',  'delivery_note_id', 'delivery_notes'),
      ('order_lines',          'order_id',         'orders'),
      ('project_milestones',   'project_id',       'projects'),
      ('fiscal_events',        'invoice_id',       'issued_invoices')
    ) AS t(child, fk, parent)
  LOOP
    -- Guard 1: el hijo existe y tiene la columna fk.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.child AND column_name = r.fk
    ) THEN
      RAISE NOTICE 'SKIP B) public.% (no existe o sin columna %)', r.child, r.fk;
      CONTINUE;
    END IF;

    -- Guard 2: el padre existe y tiene user_id.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.parent AND column_name = 'user_id'
    ) THEN
      RAISE NOTICE 'SKIP B) public.% (padre public.% no existe o sin user_id)', r.child, r.parent;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.child);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.child || '_select_own', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND p.user_id = auth.uid()));',
      r.child || '_select_own', r.child, r.parent, r.child, r.fk);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.child || '_insert_own', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND p.user_id = auth.uid()));',
      r.child || '_insert_own', r.child, r.parent, r.child, r.fk);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.child || '_update_own', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND p.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND p.user_id = auth.uid()));',
      r.child || '_update_own', r.child, r.parent, r.child, r.fk, r.parent, r.child, r.fk);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.child || '_delete_own', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND p.user_id = auth.uid()));',
      r.child || '_delete_own', r.child, r.parent, r.child, r.fk);

    RAISE NOTICE 'OK  B) public.% (vía public.%)', r.child, r.parent;
  END LOOP;
END $$;

-- ===========================================================================
-- Pre-flight opcional (ejecútalo ANTES): cuenta filas con user_id NULL en TODAS
-- las tablas del array A) + price_items. En las tablas estrictas debería ser 0;
-- si alguna sale > 0 tiene semilla/datos compartidos y hay que darle el mismo
-- trato que a price_items (SELECT con OR user_id IS NULL) o excluirla.
-- price_items SÍ puede salir > 0 (banco base compartido) — por eso su SELECT ya
-- tolera user_id NULL en esta migración.
-- NOTA: este UNION ALL fallará si alguna tabla no existe todavía; en ese caso
--       usa la variante dinámica del final.
--
--   SELECT 'clients' AS tabla, count(*) FILTER (WHERE user_id IS NULL) AS nulos, count(*) AS total FROM public.clients
--   UNION ALL SELECT 'projects',                 count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.projects
--   UNION ALL SELECT 'budgets',                  count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.budgets
--   UNION ALL SELECT 'suppliers',                count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.suppliers
--   UNION ALL SELECT 'received_invoices',        count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.received_invoices
--   UNION ALL SELECT 'supplier_payments',        count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.supplier_payments
--   UNION ALL SELECT 'project_suppliers',        count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.project_suppliers
--   UNION ALL SELECT 'project_changes',          count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.project_changes
--   UNION ALL SELECT 'payments',                 count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.payments
--   UNION ALL SELECT 'orders',                   count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.orders
--   UNION ALL SELECT 'invoices',                 count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.invoices
--   UNION ALL SELECT 'issued_invoices',          count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.issued_invoices
--   UNION ALL SELECT 'delivery_notes',           count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.delivery_notes
--   UNION ALL SELECT 'fiscal_settings',          count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.fiscal_settings
--   UNION ALL SELECT 'messages',                 count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.messages
--   UNION ALL SELECT 'events',                   count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.events
--   UNION ALL SELECT 'ai_runs',                  count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.ai_runs
--   UNION ALL SELECT 'legal_acceptances',        count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.legal_acceptances
--   UNION ALL SELECT 'marketing_consents',       count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.marketing_consents
--   UNION ALL SELECT 'notifications',            count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.notifications
--   UNION ALL SELECT 'notification_settings',    count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.notification_settings
--   UNION ALL SELECT 'notification_preferences', count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.notification_preferences
--   UNION ALL SELECT 'activity_log',             count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.activity_log
--   UNION ALL SELECT 'agent_news',               count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_news
--   UNION ALL SELECT 'agent_leads',              count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_leads
--   UNION ALL SELECT 'agent_tasks',              count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_tasks
--   UNION ALL SELECT 'agent_signals',            count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_signals
--   UNION ALL SELECT 'agent_reviews',            count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_reviews
--   UNION ALL SELECT 'agent_daily_summary',      count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_daily_summary
--   UNION ALL SELECT 'agent_campaigns',          count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.agent_campaigns
--   UNION ALL SELECT 'price_items',              count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.price_items
--   ORDER BY nulos DESC;
--
-- Variante dinámica robusta (no falla si falta alguna tabla):
--   DO $$
--   DECLARE t text; n bigint; tot bigint;
--   BEGIN
--     FOR t IN SELECT unnest(ARRAY[
--       'clients','projects','budgets','suppliers','received_invoices','supplier_payments',
--       'project_suppliers','project_changes','payments','orders','invoices','issued_invoices',
--       'delivery_notes','fiscal_settings','messages','events','ai_runs','legal_acceptances',
--       'marketing_consents','notifications','notification_settings','notification_preferences',
--       'activity_log','agent_news','agent_leads','agent_tasks','agent_signals','agent_reviews',
--       'agent_daily_summary','agent_campaigns','price_items'])
--     LOOP
--       IF EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_schema='public' AND table_name=t AND column_name='user_id') THEN
--         EXECUTE format('SELECT count(*) FILTER (WHERE user_id IS NULL), count(*) FROM public.%I', t)
--           INTO n, tot;
--         RAISE NOTICE '% -> nulos=% total=%', rpad(t,26), n, tot;
--       ELSE
--         RAISE NOTICE '% -> (no existe o sin user_id)', rpad(t,26);
--       END IF;
--     END LOOP;
--   END $$;
--
-- Verificación posterior — políticas creadas por esta migración:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%\_own' ORDER BY tablename, cmd;
