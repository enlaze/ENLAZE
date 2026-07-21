-- ============================================================================
-- PRICE BANK V2 — Ampliacion completa: categorias, tipos de producto
-- 2026-07-21
--
-- Anade:
--   - product_type en pb_products (material, mano_obra, maquinaria, transporte, etc.)
--   - category y subcategory en pb_products
--   - Indice para filtrar por tipo y categoria
-- ============================================================================

-- 1. Anadir product_type a pb_products
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'material';
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT '';

-- Indice para filtrar por tipo de producto
CREATE INDEX IF NOT EXISTS idx_pb_products_type ON pb_products(product_type);
CREATE INDEX IF NOT EXISTS idx_pb_products_category ON pb_products(category);
CREATE INDEX IF NOT EXISTS idx_pb_products_type_cat ON pb_products(product_type, category);

-- Constraint unico para evitar duplicados en seed (proveedor + nombre comercial)
ALTER TABLE pb_products DROP CONSTRAINT IF EXISTS uq_pb_product_provider_name;
ALTER TABLE pb_products ADD CONSTRAINT uq_pb_product_provider_name UNIQUE (provider_id, commercial_name);
