-- ============================================================================
-- Price Alerts & History Enhancement
-- Adds user-configurable price alerts and weekly report support
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. price_alerts — Alertas de precio configuradas por el usuario
CREATE TABLE IF NOT EXISTS price_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES pb_products(id) ON DELETE CASCADE,
  product_name    text NOT NULL,
  provider_name   text,
  alert_type      text NOT NULL DEFAULT 'any_change',
    -- 'any_change' = cualquier cambio
    -- 'threshold_pct' = cambio > X%
    -- 'price_above' = precio sube por encima de X
    -- 'price_below' = precio baja por debajo de X
  threshold_pct   numeric(5,2) DEFAULT 5.00,
  threshold_price numeric(12,4),
  reference_price numeric(12,4),
  last_price      numeric(12,4),
  last_notified_at timestamptz,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 2. price_alert_notifications — Historial de notificaciones enviadas
CREATE TABLE IF NOT EXISTS price_alert_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        uuid REFERENCES price_alerts(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES pb_products(id) ON DELETE SET NULL,
  product_name    text NOT NULL,
  provider_name   text,
  old_price       numeric(12,4),
  new_price       numeric(12,4),
  change_pct      numeric(8,4),
  direction       text NOT NULL DEFAULT 'up', -- 'up' or 'down'
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- 3. price_weekly_reports — Informes semanales de precios
CREATE TABLE IF NOT EXISTS price_weekly_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  week_end        date NOT NULL,
  total_products_tracked int DEFAULT 0,
  products_changed int DEFAULT 0,
  avg_change_pct  numeric(8,4) DEFAULT 0,
  biggest_increase jsonb, -- {product_name, provider, old_price, new_price, change_pct}
  biggest_decrease jsonb,
  summary_data    jsonb DEFAULT '[]'::jsonb, -- array of changes
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_product ON price_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(user_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_price_alert_notif_user ON price_alert_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alert_notif_unread ON price_alert_notifications(user_id, is_read) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_price_weekly_user ON price_weekly_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_price_weekly_week ON price_weekly_reports(user_id, week_start);

-- Add index on pb_price_observations for time-series queries
CREATE INDEX IF NOT EXISTS idx_pb_observations_product_time
  ON pb_price_observations(product_id, checked_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alert_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_weekly_reports ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own alerts
CREATE POLICY "Users manage own alerts"
  ON price_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see own notifications"
  ON price_alert_notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see own reports"
  ON price_weekly_reports FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
