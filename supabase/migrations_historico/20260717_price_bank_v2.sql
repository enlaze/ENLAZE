-- ============================================================================
-- Price Bank V2 — Tables for webhook, adapters, and import system
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- ============================================================================

-- 1. pb_providers — Proveedores de materiales/servicios
CREATE TABLE IF NOT EXISTS pb_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid,
  name          text NOT NULL,
  legal_name    text,
  nif           text,
  website       text,
  country       text DEFAULT 'ES',
  autonomous_community text,
  province      text,
  supply_zones  text[] DEFAULT ARRAY['*'],
  shipping_cost_flat    numeric(10,2) DEFAULT 0,
  shipping_cost_per_kg  numeric(10,4) DEFAULT 0,
  minimum_order         numeric(10,2) DEFAULT 0,
  delivery_days_min     int DEFAULT 1,
  delivery_days_max     int DEFAULT 7,
  payment_terms_days    int DEFAULT 30,
  is_preferred  boolean DEFAULT false,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 2. pb_price_sources — Fuentes de precios (webhooks, feeds, scrapers)
CREATE TABLE IF NOT EXISTS pb_price_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid,
  name            text NOT NULL,
  source_type     text NOT NULL DEFAULT 'n8n_webhook',
  provider_id     uuid REFERENCES pb_providers(id) ON DELETE CASCADE,
  country         text DEFAULT 'ES',
  url             text,
  update_frequency text DEFAULT 'daily',
  last_checked_at  timestamptz,
  last_success_at  timestamptz,
  status          text DEFAULT 'active',
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 3. pb_products — Productos del banco de precios
CREATE TABLE IF NOT EXISTS pb_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid REFERENCES pb_providers(id) ON DELETE CASCADE,
  concept_id        uuid,
  concept_match_type text DEFAULT 'none',
  commercial_name   text NOT NULL,
  description       text DEFAULT '',
  brand             text,
  model             text,
  sku               text,
  ean               text,
  sale_unit         text DEFAULT 'ud',
  units_per_package int DEFAULT 1,
  unit_price        numeric(12,4) DEFAULT 0,
  vat_rate          numeric(5,2) DEFAULT 21,
  url               text,
  region            text DEFAULT 'ES',
  is_available      boolean DEFAULT true,
  checked_at        timestamptz,
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 4. pb_price_observations — Histórico de precios observados
CREATE TABLE IF NOT EXISTS pb_price_observations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid REFERENCES pb_products(id) ON DELETE CASCADE,
  provider_id       uuid REFERENCES pb_providers(id) ON DELETE CASCADE,
  source_id         uuid REFERENCES pb_price_sources(id) ON DELETE SET NULL,
  price_excl_vat    numeric(12,4) NOT NULL,
  vat_pct           numeric(5,2) DEFAULT 21,
  shipping_cost     numeric(10,2) DEFAULT 0,
  other_costs       numeric(10,2) DEFAULT 0,
  discount_pct      numeric(5,2) DEFAULT 0,
  discount_amount   numeric(10,2) DEFAULT 0,
  is_available      boolean DEFAULT true,
  region            text DEFAULT 'ES',
  checked_at        timestamptz DEFAULT now(),
  price_changed_at  timestamptz,
  confidence_score  numeric(3,2) DEFAULT 0.80,
  dedup_hash        text,
  created_at        timestamptz DEFAULT now()
);

-- 5. pb_price_current — Precio actual por producto (1 fila por producto)
CREATE TABLE IF NOT EXISTS pb_price_current (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid UNIQUE REFERENCES pb_products(id) ON DELETE CASCADE,
  observation_id    uuid REFERENCES pb_price_observations(id) ON DELETE SET NULL,
  provider_id       uuid REFERENCES pb_providers(id) ON DELETE CASCADE,
  price_excl_vat    numeric(12,4) NOT NULL,
  confidence_score  numeric(3,2) DEFAULT 0.80,
  region            text DEFAULT 'ES',
  is_available      boolean DEFAULT true,
  source_type       text DEFAULT 'n8n_webhook',
  checked_at        timestamptz DEFAULT now(),
  price_changed_at  timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 6. pb_sync_runs — Registro de ejecuciones de sincronización
CREATE TABLE IF NOT EXISTS pb_sync_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   text,
  source_id         uuid REFERENCES pb_price_sources(id) ON DELETE SET NULL,
  provider_id       uuid REFERENCES pb_providers(id) ON DELETE CASCADE,
  scope             text DEFAULT 'provider',
  status            text DEFAULT 'processing',
  started_at        timestamptz DEFAULT now(),
  finished_at       timestamptz,
  records_checked   int DEFAULT 0,
  records_new       int DEFAULT 0,
  records_modified  int DEFAULT 0,
  records_unchanged int DEFAULT 0,
  records_errors    int DEFAULT 0,
  error_log         jsonb DEFAULT '[]'::jsonb,
  summary           jsonb DEFAULT '{}'::jsonb,
  created_at        timestamptz DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pb_providers_company ON pb_providers(company_id);
CREATE INDEX IF NOT EXISTS idx_pb_providers_name ON pb_providers(name);

CREATE INDEX IF NOT EXISTS idx_pb_sources_provider ON pb_price_sources(provider_id);

CREATE INDEX IF NOT EXISTS idx_pb_products_provider ON pb_products(provider_id);
CREATE INDEX IF NOT EXISTS idx_pb_products_sku ON pb_products(provider_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_products_name ON pb_products(provider_id, commercial_name);

CREATE INDEX IF NOT EXISTS idx_pb_observations_product ON pb_price_observations(product_id);
CREATE INDEX IF NOT EXISTS idx_pb_observations_dedup ON pb_price_observations(dedup_hash) WHERE dedup_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pb_current_product ON pb_price_current(product_id);

CREATE INDEX IF NOT EXISTS idx_pb_sync_runs_source ON pb_sync_runs(source_id);
CREATE INDEX IF NOT EXISTS idx_pb_sync_runs_idempotency ON pb_sync_runs(idempotency_key);

-- ─── RLS (Row Level Security) ──────────────────────────────────────────────────
-- Habilitamos RLS pero permitimos acceso via service_role (para el webhook)

ALTER TABLE pb_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_price_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_price_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_sync_runs ENABLE ROW LEVEL SECURITY;

-- Política: service_role tiene acceso total (usado por el webhook)
CREATE POLICY "Service role full access" ON pb_providers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pb_price_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pb_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pb_price_observations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pb_price_current FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pb_sync_runs FOR ALL USING (true) WITH CHECK (true);
