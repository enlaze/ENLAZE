-- ============================================================
-- FASE 1 – Retail Price Bank: data model
-- 2026-04-20
--
-- Goals:
--   1. Extend price_items with retail-specific columns (all nullable → construction untouched).
--   2. Create price_history to track every price change.
--   3. Create supplier_catalogs to link suppliers ↔ price items.
--   4. Create price_sync_logs for n8n / import auditing.
--   5. Add useful indexes and a trigger for automatic history logging.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. EXTEND price_items
-- ────────────────────────────────────────────────────────────
-- All new columns are nullable so existing construction rows keep working.

-- Retail product identity
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS brand              text;
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS format             text;          -- "500g", "pack 6", "talla M"
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS sku                text;          -- internal or supplier SKU
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS barcode            text;          -- EAN / UPC
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS business_subsector text;          -- "alimentación", "moda", "electrónica"…
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS family             text;          -- product family / line

-- Pricing dual model (compra / venta)
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS purchase_price         numeric(12,4);  -- coste de compra (sin IVA)
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS recommended_sale_price numeric(12,4);  -- PVP recomendado (sin IVA)
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS vat_rate               numeric(5,2) DEFAULT 21;  -- % IVA (Spain default)
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS gross_margin_pct       numeric(5,2);  -- margen bruto %

-- Supplier link
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS supplier_id   uuid REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS supplier_name text;           -- denormalized for display speed
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS supplier_ref  text;           -- ref. in supplier catalog

-- Source / confidence
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS source_type       text DEFAULT 'manual';  -- manual | n8n_sync | import_csv | api | default
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS source_url        text;
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS confidence_score  numeric(3,2) DEFAULT 1.00;  -- 0.00–1.00
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS is_manual_override boolean DEFAULT false;

-- Lifecycle
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS captured_at  timestamptz DEFAULT now();
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS valid_from   timestamptz DEFAULT now();
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS valid_until  timestamptz;        -- NULL = still valid
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS is_active    boolean DEFAULT true;

-- Scope
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS price_scope text DEFAULT 'local';  -- local | regional | national

-- ────────────────────────────────────────────────────────────
-- 2. INDEXES on price_items
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_price_items_supplier   ON price_items (supplier_id)   WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_items_brand      ON price_items (brand)          WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_items_subsector  ON price_items (business_subsector) WHERE business_subsector IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_items_source     ON price_items (source_type);
CREATE INDEX IF NOT EXISTS idx_price_items_active     ON price_items (user_id, sector, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_price_items_family     ON price_items (family)         WHERE family IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. price_history  – automatic log of every price change
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_item_id   uuid NOT NULL REFERENCES price_items(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  -- snapshot of the prices at that moment
  old_unit_price           numeric(12,4),
  new_unit_price           numeric(12,4),
  old_purchase_price       numeric(12,4),
  new_purchase_price       numeric(12,4),
  old_sale_price           numeric(12,4),
  new_sale_price           numeric(12,4),
  old_margin_pct           numeric(5,2),
  new_margin_pct           numeric(5,2),
  -- meta
  change_source   text DEFAULT 'manual',  -- manual | n8n_sync | import | api
  change_reason   text,
  changed_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history (price_item_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────
-- 4. supplier_catalogs – a supplier's product offer snapshot
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_catalogs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  -- product data
  product_name    text NOT NULL,
  brand           text,
  sku             text,
  barcode         text,
  format          text,
  category        text,
  subcategory     text,
  -- pricing
  cost_price      numeric(12,4),
  list_price      numeric(12,4),
  vat_rate        numeric(5,2) DEFAULT 21,
  currency        text DEFAULT 'EUR',
  min_order_qty   integer DEFAULT 1,
  -- validity
  valid_from      timestamptz DEFAULT now(),
  valid_until     timestamptz,
  is_active       boolean DEFAULT true,
  -- import meta
  catalog_source  text,        -- "csv_import", "api_sync", "manual"
  raw_data        jsonb,       -- original row for traceability
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_supplier ON supplier_catalogs (supplier_id, is_active);
CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_user     ON supplier_catalogs (user_id);
CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_sku      ON supplier_catalogs (sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_barcode  ON supplier_catalogs (barcode) WHERE barcode IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5. price_sync_logs – audit trail for n8n & import operations
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_sync_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  sync_source     text NOT NULL,       -- "n8n_workflow", "csv_import", "api_batch", "manual_bulk"
  sector          text,
  -- stats
  items_received  integer DEFAULT 0,
  items_created   integer DEFAULT 0,
  items_updated   integer DEFAULT 0,
  items_skipped   integer DEFAULT 0,
  items_failed    integer DEFAULT 0,
  -- detail
  errors          jsonb,               -- [{item, error}, …]
  metadata        jsonb,               -- workflow id, file name, etc.
  started_at      timestamptz DEFAULT now(),
  finished_at     timestamptz,
  status          text DEFAULT 'running' -- running | completed | failed | partial
);

CREATE INDEX IF NOT EXISTS idx_price_sync_logs_user ON price_sync_logs (user_id, started_at DESC);

-- ────────────────────────────────────────────────────────────
-- 6. TRIGGER: auto-log price changes into price_history
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_log_price_change()
RETURNS trigger AS $$
BEGIN
  -- Only log if any price-related field actually changed
  IF (
    OLD.unit_price IS DISTINCT FROM NEW.unit_price OR
    OLD.purchase_price IS DISTINCT FROM NEW.purchase_price OR
    OLD.recommended_sale_price IS DISTINCT FROM NEW.recommended_sale_price OR
    OLD.gross_margin_pct IS DISTINCT FROM NEW.gross_margin_pct
  ) THEN
    INSERT INTO price_history (
      price_item_id, user_id,
      old_unit_price, new_unit_price,
      old_purchase_price, new_purchase_price,
      old_sale_price, new_sale_price,
      old_margin_pct, new_margin_pct,
      change_source
    ) VALUES (
      NEW.id, NEW.user_id,
      OLD.unit_price, NEW.unit_price,
      OLD.purchase_price, NEW.purchase_price,
      OLD.recommended_sale_price, NEW.recommended_sale_price,
      OLD.gross_margin_pct, NEW.gross_margin_pct,
      COALESCE(NEW.source_type, 'manual')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop first to be idempotent
DROP TRIGGER IF EXISTS trg_price_items_history ON price_items;
CREATE TRIGGER trg_price_items_history
  AFTER UPDATE ON price_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_price_change();

-- ────────────────────────────────────────────────────────────
-- 7. RLS policies (match existing price_items pattern)
-- ────────────────────────────────────────────────────────────
ALTER TABLE price_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_sync_logs   ENABLE ROW LEVEL SECURITY;

-- price_history
CREATE POLICY "Users can view own price history"
  ON price_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own price history"
  ON price_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- supplier_catalogs
CREATE POLICY "Users can view own supplier catalogs"
  ON supplier_catalogs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own supplier catalogs"
  ON supplier_catalogs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- price_sync_logs
CREATE POLICY "Users can view own sync logs"
  ON price_sync_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync logs"
  ON price_sync_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Done. Construction sector is untouched — all new columns are
-- nullable and defaulted. Retail gets a professional price bank.
-- ============================================================
