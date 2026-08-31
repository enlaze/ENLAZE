-- ============================================================================
-- BUDGET SNAPSHOTS — Versiones historicas de presupuestos
-- 2026-07-16
--
-- Cada snapshot guarda el estado completo de un presupuesto en un momento dado.
-- Permite comparar versiones (diff) y restaurar estados anteriores.
--
-- Tipos:
--   - generated:  snapshot automatico tras generar el presupuesto
--   - edited:     snapshot tras edicion manual del usuario
--   - repriced:   snapshot tras re-priced con nuevos precios
--
-- Principios:
--   - user_id para RLS (solo el propietario ve sus snapshots)
--   - version autoincremental por budget_id
--   - items_data es JSONB con el array completo de BudgetItemV2[]
--   - summary_data es JSONB con totales, medias, fuentes
-- ============================================================================

-- ── Table ──

CREATE TABLE IF NOT EXISTS budget_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  snapshot_type   TEXT NOT NULL DEFAULT 'generated'
                  CHECK (snapshot_type IN ('generated', 'edited', 'repriced')),
  label           TEXT,

  -- Payload
  items_data      JSONB NOT NULL DEFAULT '[]',
  summary_data    JSONB NOT NULL DEFAULT '{}',
  analysis_data   JSONB,
  metadata        JSONB DEFAULT '{}',

  -- Tracking
  resolver_used   TEXT DEFAULT 'v1'
                  CHECK (resolver_used IN ('v1', 'v2')),
  total_items     INTEGER DEFAULT 0,
  total_cost      NUMERIC(14,2) DEFAULT 0,
  total_sale      NUMERIC(14,2) DEFAULT 0,
  avg_confidence  NUMERIC(3,2) DEFAULT 0,

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Unique version per budget
  CONSTRAINT uq_budget_snapshot_version UNIQUE (budget_id, version)
);

-- ── Indexes ──

CREATE INDEX IF NOT EXISTS idx_snapshots_budget
  ON budget_snapshots(budget_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_user
  ON budget_snapshots(user_id);

CREATE INDEX IF NOT EXISTS idx_snapshots_type
  ON budget_snapshots(snapshot_type);

-- ── RLS ──

ALTER TABLE budget_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can only see their own snapshots
DROP POLICY IF EXISTS "snapshots_select_own" ON budget_snapshots;
CREATE POLICY "snapshots_select_own" ON budget_snapshots
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "snapshots_insert_own" ON budget_snapshots;
CREATE POLICY "snapshots_insert_own" ON budget_snapshots
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "snapshots_delete_own" ON budget_snapshots;
CREATE POLICY "snapshots_delete_own" ON budget_snapshots
  FOR DELETE USING (user_id = auth.uid());

-- Service role bypass
DROP POLICY IF EXISTS "snapshots_service_all" ON budget_snapshots;
CREATE POLICY "snapshots_service_all" ON budget_snapshots
  FOR ALL USING (auth.role() = 'service_role');
