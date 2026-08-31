-- ============================================================================
-- TECHNICAL PRICE BANK — Banco tecnico de precios para construccion
-- 2026-05-26
--
-- Objetivo:
--   Crear la estructura para un banco de precios tecnico independiente
--   del banco de precios del usuario (price_items) y de los proveedores.
--   Preparado para importar BC3/FIEBDC-3 en el futuro.
--
-- Tablas creadas:
--   1. technical_chapters          — Capitulos jerarquicos
--   2. technical_price_items       — Partidas tecnicas con desglose de costes
--   3. technical_price_components  — Descompuestos (labor, material, maquinaria)
--   4. technical_import_logs       — Registro de importaciones
--
-- Principios:
--   - Sin user_id: banco compartido/global
--   - source explicito: enlaze_base | cype | ive | public_bc3 | manual
--   - CYPE NO es proveedor; es fuente tecnica
--   - Idempotente: IF NOT EXISTS en todo
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. technical_chapters
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS technical_chapters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad
  code          text NOT NULL,
  name          text NOT NULL,
  description   text DEFAULT '',
  parent_id     uuid REFERENCES technical_chapters(id) ON DELETE CASCADE,
  level         smallint NOT NULL DEFAULT 1,
  sort_order    smallint NOT NULL DEFAULT 0,

  -- Origen
  source        text NOT NULL DEFAULT 'enlaze_base',
  region        text NOT NULL DEFAULT 'espana',
  edition       text DEFAULT '',

  -- Estado
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  -- Un capitulo unico por codigo + fuente + region
  CONSTRAINT uq_tech_chapter_code_source_region
    UNIQUE (code, source, region)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_tech_chapters_parent
  ON technical_chapters(parent_id);
CREATE INDEX IF NOT EXISTS idx_tech_chapters_source_region
  ON technical_chapters(source, region);
CREATE INDEX IF NOT EXISTS idx_tech_chapters_active
  ON technical_chapters(is_active) WHERE is_active = true;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. technical_price_items
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS technical_price_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Jerarquia
  chapter_id      uuid NOT NULL REFERENCES technical_chapters(id) ON DELETE CASCADE,

  -- Identidad
  item_code       text NOT NULL,
  name            text NOT NULL,
  description     text DEFAULT '',
  long_text       text DEFAULT '',
  unit            text NOT NULL DEFAULT 'ud',

  -- Precio de referencia (coste directo, sin margen)
  unit_price      numeric(12,4) NOT NULL DEFAULT 0,
  labor_cost      numeric(12,4) DEFAULT 0,
  material_cost   numeric(12,4) DEFAULT 0,
  machinery_cost  numeric(12,4) DEFAULT 0,
  indirect_cost   numeric(12,4) DEFAULT 0,
  waste_pct       numeric(5,2)  DEFAULT 0,

  -- Calidad, confianza y clasificacion
  quality_tier      text DEFAULT 'media'
                    CHECK (quality_tier IN ('basica', 'media', 'alta')),
  confidence_score  numeric(3,2) DEFAULT 0.50
                    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  tags              text[] DEFAULT '{}',

  -- Origen y trazabilidad
  source          text NOT NULL DEFAULT 'enlaze_base',
  source_code     text DEFAULT '',
  region          text NOT NULL DEFAULT 'espana',
  edition         text DEFAULT '',

  -- Vigencia
  valid_from      timestamptz DEFAULT now(),
  valid_until     timestamptz,
  is_active       boolean DEFAULT true,

  -- Meta
  imported_at     timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  -- Una partida unica por codigo + fuente + region
  CONSTRAINT uq_tech_item_code_source_region
    UNIQUE (item_code, source, region)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_tech_items_chapter
  ON technical_price_items(chapter_id);
CREATE INDEX IF NOT EXISTS idx_tech_items_code
  ON technical_price_items(item_code);
CREATE INDEX IF NOT EXISTS idx_tech_items_source_region
  ON technical_price_items(source, region);
CREATE INDEX IF NOT EXISTS idx_tech_items_name_fts
  ON technical_price_items USING gin(to_tsvector('spanish', name));
CREATE INDEX IF NOT EXISTS idx_tech_items_tags
  ON technical_price_items USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_tech_items_active
  ON technical_price_items(is_active, source, region)
  WHERE is_active = true;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. technical_price_components
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS technical_price_components (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Partida padre
  price_item_id     uuid NOT NULL REFERENCES technical_price_items(id) ON DELETE CASCADE,

  -- Componente
  component_type    text NOT NULL
                    CHECK (component_type IN (
                      'labor', 'material', 'machinery', 'auxiliary', 'subcontract'
                    )),
  code              text DEFAULT '',
  name              text NOT NULL,
  description       text DEFAULT '',
  unit              text NOT NULL DEFAULT 'ud',

  -- Rendimiento y coste
  yield             numeric(12,6) NOT NULL DEFAULT 1.0,
  unit_cost         numeric(12,4) NOT NULL DEFAULT 0,
  total_cost        numeric(12,4) GENERATED ALWAYS AS (yield * unit_cost) STORED,

  -- Origen
  source            text DEFAULT 'enlaze_base',
  sort_order        smallint DEFAULT 0,

  created_at        timestamptz DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_tech_components_item
  ON technical_price_components(price_item_id);
CREATE INDEX IF NOT EXISTS idx_tech_components_type
  ON technical_price_components(component_type);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. technical_import_logs
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS technical_import_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Que se importo
  source              text NOT NULL,
  file_name           text DEFAULT '',
  region              text DEFAULT 'espana',
  edition             text DEFAULT '',

  -- Contadores
  chapters_created    integer DEFAULT 0,
  chapters_updated    integer DEFAULT 0,
  items_created       integer DEFAULT 0,
  items_updated       integer DEFAULT 0,
  components_created  integer DEFAULT 0,
  items_skipped       integer DEFAULT 0,

  -- Detalle
  errors              jsonb DEFAULT '[]',
  metadata            jsonb DEFAULT '{}',

  -- Timestamps
  started_at          timestamptz DEFAULT now(),
  finished_at         timestamptz,
  status              text DEFAULT 'running'
                      CHECK (status IN ('running', 'completed', 'failed', 'partial')),

  -- Quien importo (null si proceso automatico)
  imported_by         uuid
);

CREATE INDEX IF NOT EXISTS idx_tech_import_logs_source
  ON technical_import_logs(source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_import_logs_status
  ON technical_import_logs(status);


-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS — Lectura publica para usuarios autenticados, escritura solo admin
-- ────────────────────────────────────────────────────────────────────────────

-- technical_chapters
ALTER TABLE technical_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technical chapters"
  ON technical_chapters FOR SELECT
  USING (auth.role() = 'authenticated');

-- technical_price_items
ALTER TABLE technical_price_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technical price items"
  ON technical_price_items FOR SELECT
  USING (auth.role() = 'authenticated');

-- technical_price_components
ALTER TABLE technical_price_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technical price components"
  ON technical_price_components FOR SELECT
  USING (auth.role() = 'authenticated');

-- technical_import_logs
ALTER TABLE technical_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technical import logs"
  ON technical_import_logs FOR SELECT
  USING (auth.role() = 'authenticated');

-- Nota: las operaciones de escritura (INSERT/UPDATE/DELETE) en estas tablas
-- se haran via service_role key desde el endpoint de importacion o seeds.
-- Los usuarios normales solo pueden leer.


-- ────────────────────────────────────────────────────────────────────────────
-- 6. updated_at trigger
--    CREATE OR REPLACE: safe if function already exists from another migration.
--    If it doesn't exist, it gets created here. If it does, it's a no-op
--    (same body). This migration NEVER depends on prior migrations for
--    this function.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tech_chapters_updated ON technical_chapters;
CREATE TRIGGER trg_tech_chapters_updated
  BEFORE UPDATE ON technical_chapters
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_tech_items_updated ON technical_price_items;
CREATE TRIGGER trg_tech_items_updated
  BEFORE UPDATE ON technical_price_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_updated_at();


-- ============================================================================
-- FIN — Estructura del banco tecnico de precios lista.
-- Seed en migracion separada: 20260526_technical_price_bank_seed.sql
-- ============================================================================
