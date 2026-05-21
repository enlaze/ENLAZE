-- ============================================================================
-- resolved_prices: Cache de precios resueltos via web search / fuentes externas
-- TTL: 48 horas por defecto. Solo se escribe cuando hay una fuente real.
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolved_prices (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identidad del material
  material_name   text NOT NULL,
  normalized_name text NOT NULL,
  category        text NOT NULL DEFAULT '',
  unit            text NOT NULL DEFAULT 'ud',
  quality_tier    text NOT NULL DEFAULT 'media'
                  CHECK (quality_tier IN ('basica', 'media', 'alta')),
  location        text NOT NULL DEFAULT '',

  -- Precio seleccionado y rango
  selected_price    numeric NOT NULL DEFAULT 0,
  price_min         numeric,
  price_median      numeric,
  price_max         numeric,

  -- Fuente
  selected_supplier text DEFAULT '',
  source_url        text DEFAULT '',
  source_type       text NOT NULL DEFAULT 'estimated'
                    CHECK (source_type IN (
                      'user_catalog','enlaze_base','n8n_market',
                      'authorized_supplier','web_search','estimated'
                    )),
  confidence_score  numeric DEFAULT 0.4,

  -- Alternativas encontradas (JSON array)
  alternatives      jsonb DEFAULT '[]'::jsonb,

  -- Timestamps
  captured_at       timestamptz DEFAULT now(),
  expires_at        timestamptz DEFAULT (now() + interval '48 hours'),
  created_at        timestamptz DEFAULT now(),

  -- Indice compuesto para cache lookups rapidos
  CONSTRAINT uq_resolved_price_lookup
    UNIQUE (user_id, normalized_name, unit, quality_tier, location)
);

-- Indices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_resolved_prices_user
  ON resolved_prices(user_id);
CREATE INDEX IF NOT EXISTS idx_resolved_prices_expires
  ON resolved_prices(expires_at);
CREATE INDEX IF NOT EXISTS idx_resolved_prices_source
  ON resolved_prices(source_type);

-- RLS: cada usuario solo ve/escribe sus propios precios resueltos
ALTER TABLE resolved_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own resolved prices"
  ON resolved_prices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resolved prices"
  ON resolved_prices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own resolved prices"
  ON resolved_prices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own resolved prices"
  ON resolved_prices FOR DELETE
  USING (auth.uid() = user_id);
