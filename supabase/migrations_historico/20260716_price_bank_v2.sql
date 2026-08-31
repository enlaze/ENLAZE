-- ============================================================================
-- PRICE BANK V2 — Banco de precios inteligente para construccion
-- 2026-07-16
--
-- Objetivo:
--   Sistema unificado de precios con proveedores, productos normalizados,
--   observaciones de precio historicas y precio actual materializado.
--   Convive con price_items (v1) y technical_price_items.
--
-- Tablas creadas:
--   1. pb_providers             — Proveedores (Leroy Merlin, Obramat, Saltoki...)
--   2. pb_normalized_concepts   — Conceptos normalizados (cemento cola, azulejo...)
--   3. pb_products              — Productos concretos de cada proveedor
--   4. pb_price_sources         — Fuentes de datos (CSV, API, n8n, manual...)
--   5. pb_price_observations    — Cada observacion historica de precio
--   6. pb_price_current         — Precio actual materializado (1 por producto)
--   7. pb_sync_runs             — Ejecuciones de sincronizacion
--   8. pb_sync_run_details      — Detalle por fuente de cada sync run
--
-- Alteraciones:
--   - price_items: ADD is_locked
--   - technical_price_items: ADD company_id
--
-- Principios:
--   - company_id NULL = global Enlaze, UUID = privado de empresa
--   - Todos los importes en EUR sin IVA
--   - Confianza 0.00-1.00
--   - Idempotente: IF NOT EXISTS / OR REPLACE
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. ALTERACIONES EN TABLAS EXISTENTES
-- ────────────────────────────────────────────────────────────────────────────

-- price_items: campo para nivel 1 de cascada v2 (manual_locked)
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;

-- technical_price_items: campo para diferenciar BC3 privados de globales
ALTER TABLE technical_price_items ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES auth.users(id) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_tech_items_company ON technical_price_items(company_id) WHERE company_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. pb_providers — Proveedores
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_providers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES auth.users(id) DEFAULT NULL,

  -- Identidad
  name                TEXT NOT NULL,
  trade_name          TEXT,
  legal_name          TEXT,
  nif                 TEXT,
  website             TEXT,

  -- Ubicacion
  country             TEXT NOT NULL DEFAULT 'ES',
  autonomous_community TEXT,
  province            TEXT,
  supply_zones        TEXT[] DEFAULT '{}',

  -- Costes de envio
  shipping_cost_flat  NUMERIC(10,2) DEFAULT 0,
  shipping_cost_per_kg NUMERIC(10,4) DEFAULT 0,
  free_shipping_min   NUMERIC(10,2),
  minimum_order       NUMERIC(10,2) DEFAULT 0,

  -- Entrega
  delivery_days_min   INTEGER DEFAULT 1,
  delivery_days_max   INTEGER DEFAULT 5,
  payment_terms_days  INTEGER DEFAULT 30,

  -- Estado
  is_preferred        BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_pb_provider_name_company
    UNIQUE NULLS NOT DISTINCT (name, company_id)
);

CREATE INDEX IF NOT EXISTS idx_pb_providers_company ON pb_providers(company_id);
CREATE INDEX IF NOT EXISTS idx_pb_providers_active ON pb_providers(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pb_providers_province ON pb_providers(province) WHERE province IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. pb_normalized_concepts — Conceptos normalizados
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_normalized_concepts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES auth.users(id) DEFAULT NULL,

  -- Identidad
  canonical_name      TEXT NOT NULL,
  description         TEXT DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'materiales',
  subcategory         TEXT DEFAULT '',
  base_unit           TEXT NOT NULL DEFAULT 'ud',

  -- Matching
  synonyms            TEXT[] DEFAULT '{}',
  specifications      JSONB DEFAULT '{}',

  -- Estado
  review_status       TEXT DEFAULT 'draft'
                      CHECK (review_status IN ('draft', 'reviewed', 'approved', 'deprecated')),

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_pb_concept_name_company
    UNIQUE NULLS NOT DISTINCT (canonical_name, category, company_id)
);

CREATE INDEX IF NOT EXISTS idx_pb_concepts_company ON pb_normalized_concepts(company_id);
CREATE INDEX IF NOT EXISTS idx_pb_concepts_category ON pb_normalized_concepts(category);
CREATE INDEX IF NOT EXISTS idx_pb_concepts_name_fts
  ON pb_normalized_concepts USING gin(to_tsvector('spanish', canonical_name));
CREATE INDEX IF NOT EXISTS idx_pb_concepts_synonyms
  ON pb_normalized_concepts USING gin(synonyms);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. pb_products — Productos concretos
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES pb_providers(id) ON DELETE CASCADE,
  concept_id          UUID REFERENCES pb_normalized_concepts(id) ON DELETE SET NULL,
  concept_match_type  TEXT DEFAULT 'none'
                      CHECK (concept_match_type IN ('exact', 'high_confidence', 'review_recommended', 'none', 'conflict')),

  -- Identidad
  commercial_name     TEXT NOT NULL,
  description         TEXT DEFAULT '',
  brand               TEXT,
  model               TEXT,
  sku                 TEXT,
  ean                 TEXT,

  -- Precio y unidad
  sale_unit           TEXT NOT NULL DEFAULT 'ud',
  units_per_package   NUMERIC(10,2) DEFAULT 1,
  unit_price          NUMERIC(12,4) DEFAULT 0,
  vat_rate            NUMERIC(5,2) DEFAULT 21,
  url                 TEXT,

  -- Disponibilidad
  region              TEXT DEFAULT 'espana',
  is_available        BOOLEAN DEFAULT TRUE,
  checked_at          TIMESTAMPTZ,
  is_active           BOOLEAN DEFAULT TRUE,

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_products_provider ON pb_products(provider_id);
CREATE INDEX IF NOT EXISTS idx_pb_products_concept ON pb_products(concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_products_active ON pb_products(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pb_products_name_fts
  ON pb_products USING gin(to_tsvector('spanish', commercial_name));
CREATE INDEX IF NOT EXISTS idx_pb_products_sku ON pb_products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_products_ean ON pb_products(ean) WHERE ean IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. pb_price_sources — Fuentes de datos
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_price_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES auth.users(id) DEFAULT NULL,

  -- Identidad
  name                TEXT NOT NULL,
  source_type         TEXT NOT NULL
                      CHECK (source_type IN (
                        'manual', 'private_tariff', 'negotiated', 'excel', 'csv', 'bc3',
                        'provider_catalog', 'api', 'feed', 'n8n_webhook',
                        'technical_bank_global', 'technical_bank_private',
                        'budget_history', 'web_authorized', 'market_estimate', 'ai_estimate'
                      )),
  provider_id         UUID REFERENCES pb_providers(id) ON DELETE SET NULL,

  -- Ubicacion
  country             TEXT DEFAULT 'ES',
  region              TEXT,
  url                 TEXT,

  -- Programacion
  update_frequency    TEXT DEFAULT 'manual'
                      CHECK (update_frequency IN ('manual', 'daily', 'weekly', 'monthly', 'on_demand')),
  last_checked_at     TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  next_run_at         TIMESTAMPTZ,

  -- Estado
  status              TEXT DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'error', 'needs_credentials', 'deprecated')),
  last_error          TEXT,
  credential_ref      TEXT,
  is_active           BOOLEAN DEFAULT TRUE,

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_sources_company ON pb_price_sources(company_id);
CREATE INDEX IF NOT EXISTS idx_pb_sources_provider ON pb_price_sources(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_sources_type ON pb_price_sources(source_type);


-- ────────────────────────────────────────────────────────────────────────────
-- 5. pb_price_observations — Observaciones historicas de precio
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_price_observations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES pb_products(id) ON DELETE CASCADE,
  provider_id         UUID NOT NULL REFERENCES pb_providers(id) ON DELETE CASCADE,
  source_id           UUID REFERENCES pb_price_sources(id) ON DELETE SET NULL,

  -- Precio
  price_excl_vat      NUMERIC(12,4) NOT NULL,
  vat_pct             NUMERIC(5,2) DEFAULT 21,
  price_incl_vat      NUMERIC(12,4),
  shipping_cost       NUMERIC(10,2) DEFAULT 0,
  other_costs         NUMERIC(10,2) DEFAULT 0,
  discount_pct        NUMERIC(5,2) DEFAULT 0,
  discount_amount     NUMERIC(10,2) DEFAULT 0,
  effective_price     NUMERIC(12,4),

  -- Estado
  is_available        BOOLEAN DEFAULT TRUE,
  region              TEXT DEFAULT 'espana',
  checked_at          TIMESTAMPTZ DEFAULT NOW(),
  price_changed_at    TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,

  -- Confianza y trazabilidad
  confidence_score    NUMERIC(3,2) DEFAULT 0.50
                      CHECK (confidence_score >= 0 AND confidence_score <= 1),
  raw_data            JSONB,
  dedup_hash          TEXT,

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_observations_product ON pb_price_observations(product_id);
CREATE INDEX IF NOT EXISTS idx_pb_observations_provider ON pb_price_observations(provider_id);
CREATE INDEX IF NOT EXISTS idx_pb_observations_source ON pb_price_observations(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_observations_checked ON pb_price_observations(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_pb_observations_dedup ON pb_price_observations(dedup_hash) WHERE dedup_hash IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. pb_price_current — Precio actual materializado
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_price_current (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES pb_products(id) ON DELETE CASCADE,
  observation_id      UUID REFERENCES pb_price_observations(id) ON DELETE SET NULL,
  provider_id         UUID NOT NULL REFERENCES pb_providers(id) ON DELETE CASCADE,
  concept_id          UUID REFERENCES pb_normalized_concepts(id) ON DELETE SET NULL,

  -- Precio
  price_excl_vat      NUMERIC(12,4) NOT NULL,
  effective_price     NUMERIC(12,4),
  confidence_score    NUMERIC(3,2) DEFAULT 0.50
                      CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- Estado
  region              TEXT DEFAULT 'espana',
  is_available        BOOLEAN DEFAULT TRUE,
  source_type         TEXT,
  checked_at          TIMESTAMPTZ DEFAULT NOW(),
  price_changed_at    TIMESTAMPTZ,

  -- Meta
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Un precio actual por producto
  CONSTRAINT uq_pb_current_product UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS idx_pb_current_provider ON pb_price_current(provider_id);
CREATE INDEX IF NOT EXISTS idx_pb_current_concept ON pb_price_current(concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pb_current_available ON pb_price_current(is_available) WHERE is_available = TRUE;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. pb_sync_runs — Ejecuciones de sincronizacion
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_sync_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     TEXT,

  source_id           UUID REFERENCES pb_price_sources(id) ON DELETE SET NULL,
  provider_id         UUID REFERENCES pb_providers(id) ON DELETE SET NULL,
  scope               TEXT DEFAULT 'all'
                      CHECK (scope IN ('all', 'source', 'provider')),

  -- Estado
  status              TEXT DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'error', 'needs_review')),
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,

  -- Contadores
  records_checked     INTEGER DEFAULT 0,
  records_new         INTEGER DEFAULT 0,
  records_modified    INTEGER DEFAULT 0,
  records_unchanged   INTEGER DEFAULT 0,
  records_rejected    INTEGER DEFAULT 0,
  records_errors      INTEGER DEFAULT 0,

  -- Detalle
  summary             JSONB DEFAULT '{}',
  error_log           JSONB DEFAULT '[]',

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_sync_runs_status ON pb_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_pb_sync_runs_started ON pb_sync_runs(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_sync_runs_idempotency
  ON pb_sync_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. pb_sync_run_details — Detalle por fuente de cada sync run
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pb_sync_run_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES pb_sync_runs(id) ON DELETE CASCADE,
  source_id           UUID REFERENCES pb_price_sources(id) ON DELETE SET NULL,
  provider_id         UUID REFERENCES pb_providers(id) ON DELETE SET NULL,

  -- Estado
  status              TEXT DEFAULT 'pending',
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,

  -- Contadores
  records_checked     INTEGER DEFAULT 0,
  records_new         INTEGER DEFAULT 0,
  records_modified    INTEGER DEFAULT 0,
  records_unchanged   INTEGER DEFAULT 0,
  records_rejected    INTEGER DEFAULT 0,
  records_errors      INTEGER DEFAULT 0,

  -- Errores
  errors              JSONB DEFAULT '[]',

  -- Meta
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_sync_details_run ON pb_sync_run_details(run_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 9. TRIGGERS — updated_at automatico
-- ────────────────────────────────────────────────────────────────────────────

-- fn_set_updated_at ya existe de migraciones anteriores
-- Solo creamos los triggers para las nuevas tablas

DROP TRIGGER IF EXISTS trg_pb_providers_updated ON pb_providers;
CREATE TRIGGER trg_pb_providers_updated
  BEFORE UPDATE ON pb_providers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_pb_concepts_updated ON pb_normalized_concepts;
CREATE TRIGGER trg_pb_concepts_updated
  BEFORE UPDATE ON pb_normalized_concepts
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_pb_products_updated ON pb_products;
CREATE TRIGGER trg_pb_products_updated
  BEFORE UPDATE ON pb_products
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_pb_sources_updated ON pb_price_sources;
CREATE TRIGGER trg_pb_sources_updated
  BEFORE UPDATE ON pb_price_sources
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_pb_current_updated ON pb_price_current;
CREATE TRIGGER trg_pb_current_updated
  BEFORE UPDATE ON pb_price_current
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 10. RLS POLICIES
-- ────────────────────────────────────────────────────────────────────────────

-- pb_providers: usuario ve globales + propios, escribe propios
ALTER TABLE pb_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_providers_select"
  ON pb_providers FOR SELECT
  USING (company_id IS NULL OR company_id = auth.uid());

CREATE POLICY "pb_providers_insert"
  ON pb_providers FOR INSERT
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "pb_providers_update"
  ON pb_providers FOR UPDATE
  USING (company_id = auth.uid())
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "pb_providers_delete"
  ON pb_providers FOR DELETE
  USING (company_id = auth.uid());

-- pb_normalized_concepts: usuario ve globales + propios
ALTER TABLE pb_normalized_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_concepts_select"
  ON pb_normalized_concepts FOR SELECT
  USING (company_id IS NULL OR company_id = auth.uid());

CREATE POLICY "pb_concepts_insert"
  ON pb_normalized_concepts FOR INSERT
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "pb_concepts_update"
  ON pb_normalized_concepts FOR UPDATE
  USING (company_id = auth.uid())
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "pb_concepts_delete"
  ON pb_normalized_concepts FOR DELETE
  USING (company_id = auth.uid());

-- pb_products: acceso via provider (si puedes ver el provider, puedes ver sus productos)
ALTER TABLE pb_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_products_select"
  ON pb_products FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pb_providers p
      WHERE p.id = pb_products.provider_id
      AND (p.company_id IS NULL OR p.company_id = auth.uid())
    )
  );

CREATE POLICY "pb_products_insert"
  ON pb_products FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pb_providers p
      WHERE p.id = pb_products.provider_id
      AND p.company_id = auth.uid()
    )
  );

CREATE POLICY "pb_products_update"
  ON pb_products FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM pb_providers p
      WHERE p.id = pb_products.provider_id
      AND p.company_id = auth.uid()
    )
  );

CREATE POLICY "pb_products_delete"
  ON pb_products FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pb_providers p
      WHERE p.id = pb_products.provider_id
      AND p.company_id = auth.uid()
    )
  );

-- pb_price_sources: usuario ve globales + propios
ALTER TABLE pb_price_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_sources_select"
  ON pb_price_sources FOR SELECT
  USING (company_id IS NULL OR company_id = auth.uid());

CREATE POLICY "pb_sources_insert"
  ON pb_price_sources FOR INSERT
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "pb_sources_update"
  ON pb_price_sources FOR UPDATE
  USING (company_id = auth.uid())
  WITH CHECK (company_id = auth.uid());

-- pb_price_observations: acceso via product (hereda del provider)
ALTER TABLE pb_price_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_observations_select"
  ON pb_price_observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pb_products prod
      JOIN pb_providers prov ON prov.id = prod.provider_id
      WHERE prod.id = pb_price_observations.product_id
      AND (prov.company_id IS NULL OR prov.company_id = auth.uid())
    )
  );

CREATE POLICY "pb_observations_insert"
  ON pb_price_observations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pb_products prod
      JOIN pb_providers prov ON prov.id = prod.provider_id
      WHERE prod.id = pb_price_observations.product_id
      AND prov.company_id = auth.uid()
    )
  );

-- pb_price_current: acceso via product
ALTER TABLE pb_price_current ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_current_select"
  ON pb_price_current FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pb_products prod
      JOIN pb_providers prov ON prov.id = prod.provider_id
      WHERE prod.id = pb_price_current.product_id
      AND (prov.company_id IS NULL OR prov.company_id = auth.uid())
    )
  );

CREATE POLICY "pb_current_insert"
  ON pb_price_current FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pb_products prod
      JOIN pb_providers prov ON prov.id = prod.provider_id
      WHERE prod.id = pb_price_current.product_id
      AND prov.company_id = auth.uid()
    )
  );

CREATE POLICY "pb_current_update"
  ON pb_price_current FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM pb_products prod
      JOIN pb_providers prov ON prov.id = prod.provider_id
      WHERE prod.id = pb_price_current.product_id
      AND prov.company_id = auth.uid()
    )
  );

-- pb_sync_runs: lectura para autenticados
ALTER TABLE pb_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_sync_runs_select"
  ON pb_sync_runs FOR SELECT
  USING (auth.role() = 'authenticated');

-- pb_sync_run_details: lectura para autenticados
ALTER TABLE pb_sync_run_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_sync_details_select"
  ON pb_sync_run_details FOR SELECT
  USING (auth.role() = 'authenticated');


-- ============================================================================
-- FIN — Price Bank V2 listo.
-- Siguiente paso: crear modulos TS y CRUD API routes.
-- ============================================================================
