-- Migration: budget_v2_tables
-- Date: 2026-07-13
-- Description: Tables for budget generator v2 (analysis cache + snapshots + budgets columns)

-- ─── budget_analysis_cache ──────────────────────────────────────────────────
-- Cache for FASE 1 (ProjectAnalysis) results. 24h TTL.
-- Avoids re-running Claude analysis when scope hasn't changed.

CREATE TABLE IF NOT EXISTS budget_analysis_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_hash      text NOT NULL,
  analysis        jsonb NOT NULL,
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz NOT NULL,

  CONSTRAINT uq_analysis_cache UNIQUE (user_id, scope_hash)
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_lookup
  ON budget_analysis_cache(user_id, scope_hash)
  WHERE expires_at > now();

-- RLS: users can only access their own cache
ALTER TABLE budget_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own analysis cache"
  ON budget_analysis_cache
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─── budget_snapshots ───────────────────────────────────────────────────────
-- Stores versioned snapshots of budgets (for compare, undo, history).
-- Each snapshot captures the full state at a point in time.

CREATE TABLE IF NOT EXISTS budget_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version         smallint NOT NULL DEFAULT 1,
  snapshot_type   text NOT NULL CHECK (snapshot_type IN ('generated', 'edited', 'repriced')),
  client_view     jsonb NOT NULL,
  internal_view   jsonb NOT NULL,
  economics       jsonb NOT NULL,
  timeline        jsonb,
  validation      jsonb,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_budget_version UNIQUE (budget_id, version)
);

CREATE INDEX IF NOT EXISTS idx_budget_snapshots_budget
  ON budget_snapshots(budget_id, version DESC);

-- RLS: users can only access snapshots of their own budgets
ALTER TABLE budget_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own budget snapshots"
  ON budget_snapshots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM budgets
      WHERE budgets.id = budget_snapshots.budget_id
        AND budgets.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM budgets
      WHERE budgets.id = budget_snapshots.budget_id
        AND budgets.user_id = auth.uid()
    )
  );


-- ─── New columns on budgets table ───────────────────────────────────────────
-- Add v2 fields to existing budgets table.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS analysis       jsonb,
  ADD COLUMN IF NOT EXISTS economics      jsonb,
  ADD COLUMN IF NOT EXISTS timeline       jsonb,
  ADD COLUMN IF NOT EXISTS validation     jsonb,
  ADD COLUMN IF NOT EXISTS version        smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quality_tier   text DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS scope_data     jsonb;
