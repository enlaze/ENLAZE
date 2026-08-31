-- ═══════════════════════════════════════════════════════════════
-- Add sector column to pb_products and pb_providers
-- This allows filtering the price bank per user sector
-- ═══════════════════════════════════════════════════════════════

-- 1. Add sector to pb_providers
ALTER TABLE pb_providers ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'construccion';

-- 2. Add sector to pb_products
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'construccion';

-- 3. Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_pb_products_sector ON pb_products(sector);
CREATE INDEX IF NOT EXISTS idx_pb_providers_sector ON pb_providers(sector);
CREATE INDEX IF NOT EXISTS idx_pb_products_sector_active ON pb_products(sector, is_active, is_available);

-- 4. Mark all existing data as construccion (they are all construction materials)
UPDATE pb_products SET sector = 'construccion' WHERE sector IS NULL OR sector = '';
UPDATE pb_providers SET sector = 'construccion' WHERE sector IS NULL OR sector = '';
