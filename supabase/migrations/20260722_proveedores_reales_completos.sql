-- ============================================================================
-- MIGRACIÓN: Proveedores reales completos del mercado español 2026
-- + Tabla sync_api_keys para autenticación de n8n
-- + Campo last_synced_at en pb_products
-- + Tabla pb_price_observations para historial de precios
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLA DE API KEYS PARA SINCRONIZACIÓN EXTERNA (n8n, cron, etc.)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sync_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,          -- SHA-256 del API key
  label TEXT NOT NULL,                     -- ej: "n8n-produccion", "cron-precios"
  permissions TEXT[] DEFAULT '{ingest}',   -- permisos: ingest, sync, admin
  sectors TEXT[] DEFAULT '{all}',          -- sectores permitidos: all, construccion, etc.
  is_active BOOLEAN DEFAULT true,
  rate_limit_per_minute INT DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ                  -- NULL = no expira
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. TABLA DE OBSERVACIONES DE PRECIOS (historial diario)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pb_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES pb_products(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES pb_providers(id) ON DELETE CASCADE,
  observed_price NUMERIC(12,4) NOT NULL,
  observed_at TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'n8n',      -- n8n, manual, api, scraper
  source_url TEXT,                          -- URL de donde se extrajo
  currency TEXT DEFAULT 'EUR',
  metadata JSONB DEFAULT '{}',              -- datos extra del scraping
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pb_price_obs_product ON pb_price_observations(product_id);
CREATE INDEX IF NOT EXISTS idx_pb_price_obs_provider ON pb_price_observations(provider_id);
CREATE INDEX IF NOT EXISTS idx_pb_price_obs_date ON pb_price_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pb_price_obs_product_date ON pb_price_observations(product_id, observed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CAMPO last_synced_at EN pb_products
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS price_trend TEXT DEFAULT 'stable'; -- up, down, stable

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PROVEEDORES REALES - CONSTRUCCIÓN Y REFORMAS
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Grandes superficies de bricolaje
  ('Leroy Merlin', 'Leroy Merlin España S.L.U.', 'construccion'),
  ('Bricomart', 'Bricomart Iberia S.A.', 'construccion'),
  ('Bricodepot', 'Brico Depôt Iberia S.L.U.', 'construccion'),
  ('Bauhaus', 'Bauhaus GmbH & Co. KG Sucursal España', 'construccion'),
  ('AKI', 'Adeo Services España S.A.', 'construccion'),
  -- Distribuidores profesionales
  ('BigMat', 'BigMat Iberia S.A.', 'construccion'),
  ('Grupo Comafe', 'Comafe Grupo de Compras S.A.', 'construccion'),
  ('Saltoki', 'Saltoki Distribución S.A.', 'construccion'),
  ('Grupo Coarco', 'Coarco Ferretería S.A.', 'construccion'),
  -- Fabricantes especialistas
  ('Roca', 'Roca Sanitario S.A.', 'construccion'),
  ('Porcelanosa', 'Porcelanosa Grupo S.A.', 'construccion'),
  ('Sika', 'Sika S.A.U.', 'construccion'),
  ('Weber Saint-Gobain', 'Saint-Gobain Weber Cemarksa S.A.', 'construccion'),
  ('Pladur / Uralita', 'Pladur Gypsum S.A.U.', 'construccion'),
  ('Knauf', 'Knauf GmbH Sucursal España', 'construccion'),
  ('Würth', 'Würth España S.A.', 'construccion'),
  ('Hilti', 'Hilti España S.A.', 'construccion'),
  ('Schneider Electric', 'Schneider Electric España S.A.', 'construccion'),
  ('Legrand', 'Legrand Group España S.L.', 'construccion'),
  ('Junkers/Bosch Clima', 'Robert Bosch España S.L.U. - Div. Termotecnia', 'construccion'),
  ('Daikin', 'Daikin AC Spain S.A.', 'construccion'),
  ('Mitsubishi Electric', 'Mitsubishi Electric Europe B.V. Suc. España', 'construccion'),
  ('Uponor', 'Uponor Hispania S.A.U.', 'construccion'),
  ('Roca Calefacción (Baxi)', 'BDR Thermea Group Spain S.L.U.', 'construccion'),
  -- Ferreterías online
  ('Ferreterías Profesionales', 'Ferretería Prof. Asociada S.L.', 'construccion'),
  ('ManoMano', 'Colibri SAS Sucursal España', 'construccion')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'construccion');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PROVEEDORES REALES - COMERCIO LOCAL / RETAIL
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Cash & Carry / Mayoristas alimentación
  ('Makro Cash & Carry', 'Makro Autoservicio Mayorista S.A.', 'comercio_local'),
  ('GM Cash & Carry', 'Miquel Alimentació Grup S.A.', 'comercio_local'),
  ('Gros Mercat', 'Transgourmet Ibérica S.A.U.', 'comercio_local'),
  ('Cash Diplo', 'Grupo Diplomat S.A.', 'comercio_local'),
  ('Cash Ifa', 'IFA Española S.A.', 'comercio_local'),
  ('Coviran', 'Covirán S.C.A.', 'comercio_local'),
  ('HD Covalco', 'Comercial Jesuman S.L. (Covalco)', 'comercio_local'),
  ('Supersol Cash', 'Supersol Spain S.L.', 'comercio_local'),
  -- Distribuidores especializados
  ('Alimerka Distribución', 'Alimerka S.A.', 'comercio_local'),
  ('Gadisa Distribución', 'Gadisa Retail S.L.', 'comercio_local'),
  ('Uvesco', 'Distribuciones Uvesco S.A.', 'comercio_local'),
  ('Musgrave (Dialsur)', 'Dialsur Cash & Carry S.L.', 'comercio_local'),
  -- Productos de limpieza e higiene
  ('Quimxel', 'Químicas Xel S.A.', 'comercio_local'),
  ('Papelmatic', 'Papelmatic S.A.U.', 'comercio_local'),
  -- Packaging y embalaje
  ('Raja Pack', 'RAJA España S.A.U.', 'comercio_local'),
  ('Embalia', 'Embalia Packaging S.L.', 'comercio_local'),
  -- Equipamiento comercial
  ('Expomaquinaria', 'Expomaquinaria S.L.', 'comercio_local'),
  ('Edenox', 'Edenox Industrial S.L.', 'comercio_local')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'comercio_local');

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PROVEEDORES REALES - PELUQUERÍA / ESTÉTICA
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Grandes marcas profesionales
  ('L''Oréal Professionnel', 'L''Oréal España S.A. - Div. Profesional', 'estetica'),
  ('Schwarzkopf Professional', 'Henkel Ibérica S.A. - Div. Professional', 'estetica'),
  ('Wella Professionals', 'Coty Spain S.L. - Div. Professional', 'estetica'),
  ('Revlon Professional', 'Revlon Inc. Suc. España - Professional', 'estetica'),
  ('Montibello', 'Montibel-lo S.A.', 'estetica'),
  ('Salerm Cosmetics', 'Salerm Cosmetics S.L.', 'estetica'),
  ('Tahe', 'Laboratorios Tahe S.L.', 'estetica'),
  ('Kérastase', 'L''Oréal España S.A. - Kérastase', 'estetica'),
  ('Redken', 'L''Oréal España S.A. - Redken', 'estetica'),
  -- Distribuidores de peluquería
  ('Eurostil', 'Eurostil S.A.', 'estetica'),
  ('Bifull', 'Bifull Professional S.L.', 'estetica'),
  ('Sinelco Spain', 'Sinelco Spain S.L.', 'estetica'),
  ('Hairways', 'Hairways Distribution S.L.', 'estetica'),
  -- Equipamiento y mobiliario
  ('Takara Belmont', 'Takara Belmont Europe B.V. Suc. España', 'estetica'),
  ('AGV Mobiliario', 'AGV Grupo S.L.', 'estetica'),
  -- Estética y uñas
  ('OPI Professional', 'Wella Operations US LLC - OPI España', 'estetica'),
  ('CND Shellac', 'Revlon Inc. - CND España', 'estetica'),
  ('Peggy Sage', 'Peggy Sage International España', 'estetica'),
  -- Aparatología estética
  ('Sorisa', 'Sorisa S.A.', 'estetica'),
  ('Zemits', 'Zemits International España S.L.', 'estetica'),
  -- Herramientas eléctricas
  ('GHD', 'Jemella Group Ltd. Suc. España', 'estetica'),
  ('BaByliss PRO', 'BaByliss España S.A.', 'estetica'),
  ('Parlux', 'Parlux S.p.A. Distribución España', 'estetica'),
  ('Moser / Wahl', 'Wahl España S.L.', 'estetica')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'estetica');

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. PROVEEDORES REALES - HOSTELERÍA
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Mayoristas alimentación hostelería
  ('Makro Hostelería', 'Makro Autoservicio Mayorista S.A. - Canal Horeca', 'hosteleria'),
  ('Transgourmet Ibérica', 'Transgourmet Ibérica S.A.U.', 'hosteleria'),
  ('Disbesa-Darnés', 'Disbesa-Darnés S.A.U.', 'hosteleria'),
  ('Grupo IAN', 'Industrias Alimentarias de Navarra S.A.U.', 'hosteleria'),
  ('La Sirena (Congelados)', 'La Sirena Alimentación S.A.', 'hosteleria'),
  ('Frio Aragón', 'Frigoríficos de Aragón S.L.', 'hosteleria'),
  ('Eurofrits', 'Eurofrits S.A.', 'hosteleria'),
  -- Bebidas
  ('Mahou San Miguel', 'Mahou S.A.', 'hosteleria'),
  ('Coca-Cola European Partners', 'Coca-Cola Europacific Partners Iberia S.L.', 'hosteleria'),
  ('Hijos de Rivera (Estrella Galicia)', 'Hijos de Rivera S.A.U.', 'hosteleria'),
  ('Pernod Ricard España', 'Pernod Ricard España S.A.', 'hosteleria'),
  ('Diageo España', 'Diageo España S.A.', 'hosteleria'),
  ('Damm Distribución', 'S.A. Damm', 'hosteleria'),
  -- Equipamiento de cocina profesional
  ('Rational', 'Rational Ibérica Cooking Systems S.L.', 'hosteleria'),
  ('Sammic', 'Sammic S.L.', 'hosteleria'),
  ('Fagor Industrial', 'Fagor Industrial S. Coop.', 'hosteleria'),
  ('Winterhalter', 'Winterhalter España S.L.', 'hosteleria'),
  ('Infrico', 'Industrias Frigoríficas del Condado S.A.', 'hosteleria'),
  ('Edenox Hostelería', 'Edenox Industrial S.L.', 'hosteleria'),
  ('Araven', 'Araven S.L.', 'hosteleria'),
  -- Vajilla y menaje
  ('Arcoroc / Arc International', 'Arc International España S.A.', 'hosteleria'),
  ('RAK Porcelain', 'RAK Porcelain Europe Suc. España', 'hosteleria'),
  -- Textil hostelero
  ('Vayoil Textil', 'Vayoil Textil S.A.', 'hosteleria'),
  -- Mobiliario hostelero
  ('Resol', 'Resol Olot S.A.', 'hosteleria'),
  ('Francisco Segarra', 'Francisco Segarra S.L.', 'hosteleria'),
  -- Software TPV
  ('Agora TPV', 'Agora Software S.L.', 'hosteleria'),
  ('Last.app', 'Last S.L.', 'hosteleria')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'hosteleria');

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PROVEEDORES REALES - AUTOMOCIÓN
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Recambios y distribución
  ('Oscaro', 'Oscaro.es S.L.', 'automocion'),
  ('Recambios Automoción (Endado)', 'Endado Recambios S.L.', 'automocion'),
  ('Recambiosauto.com', 'Recambiosauto Spain S.L.', 'automocion'),
  ('Yakaranda Auto', 'Yakaranda Distribution S.L.', 'automocion'),
  ('AD Parts (Grupo AD)', 'Autodistribución y Servicios S.A.', 'automocion'),
  ('CGA Recambios', 'Comercial Grupo Auto S.A.', 'automocion'),
  ('Grupo Serca', 'Serca S.A.', 'automocion'),
  ('Dipart', 'Dipart S.A.', 'automocion'),
  -- Fabricantes OEM / premium
  ('Bosch Automotive', 'Robert Bosch España S.L.U. - Div. Automotive', 'automocion'),
  ('Valeo', 'Valeo Service España S.A.', 'automocion'),
  ('Continental / VDO', 'Continental Automotive Spain S.A.', 'automocion'),
  ('SKF España', 'SKF Española S.A.', 'automocion'),
  ('Sachs / ZF Aftermarket', 'ZF Aftermarket Ibérica S.L.U.', 'automocion'),
  ('Mann+Hummel', 'Mann+Hummel Ibérica S.A.', 'automocion'),
  ('NGK Spark Plugs', 'NGK Spark Plug Europe GmbH Suc. España', 'automocion'),
  -- Neumáticos
  ('Norauto', 'Norauto España S.A.', 'automocion'),
  ('Aurgi', 'Aurgi Servifast S.A.', 'automocion'),
  ('Feu Vert', 'Feu Vert España S.A.', 'automocion'),
  ('Michelin España', 'Michelin España Portugal S.A.', 'automocion'),
  ('Continental Tires', 'Continental Tires España S.L.', 'automocion'),
  ('Bridgestone España', 'Bridgestone Hispania S.A.', 'automocion'),
  -- Pintura y carrocería
  ('Cromax / Axalta', 'Axalta Coating Systems Spain S.L.', 'automocion'),
  ('Spies Hecker', 'Axalta Coating Systems Spain S.L. - Spies Hecker', 'automocion'),
  ('Glasurit / BASF', 'BASF Coatings S.A.', 'automocion'),
  ('PPG Refinish', 'PPG Ibérica S.A.', 'automocion'),
  ('3M Automoción', '3M España S.L. - Div. Automoción', 'automocion'),
  -- Aceites y lubricantes
  ('Repsol Lubricantes', 'Repsol Lubricantes y Especialidades S.A.', 'automocion'),
  ('Cepsa Lubricantes', 'Cepsa Comercial Petróleo S.A.U.', 'automocion'),
  ('Castrol España', 'BP España S.A.U. - Castrol', 'automocion'),
  ('Motul España', 'Motul S.A. Suc. España', 'automocion'),
  -- Equipamiento taller
  ('Hella Gutmann', 'HELLA GUTMANN Solutions GmbH Suc. España', 'automocion'),
  ('Launch Ibérica', 'Launch Ibérica S.L.', 'automocion'),
  ('Bosch Equipos Taller', 'Robert Bosch España S.L.U. - Div. Equipment', 'automocion')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'automocion');

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. PROVEEDORES REALES - EDUCACIÓN / ACADEMIA
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Editoriales principales
  ('Santillana', 'Grupo Santillana Educación Global S.L.', 'educacion'),
  ('SM Ediciones', 'Ediciones SM S.A.', 'educacion'),
  ('Oxford University Press', 'Oxford University Press España S.A.', 'educacion'),
  ('Cambridge University Press', 'Cambridge University Press Suc. España', 'educacion'),
  ('Anaya Educación', 'Grupo Anaya S.A.', 'educacion'),
  ('Edelvives', 'Editorial Luis Vives S.A.', 'educacion'),
  ('Vicens Vives', 'Editorial Vicens Vives S.A.', 'educacion'),
  ('McGraw-Hill España', 'McGraw-Hill Interamericana de España S.L.', 'educacion'),
  ('Pearson España', 'Pearson Educación S.A.', 'educacion'),
  ('Macmillan Education', 'Macmillan Iberia S.A.U.', 'educacion'),
  ('Burlington Books', 'Burlington Books España S.L.', 'educacion'),
  -- Material escolar y oficina
  ('Staedtler', 'Staedtler Mars GmbH & Co. KG Suc. España', 'educacion'),
  ('Pelikan', 'Pelikan España S.A.', 'educacion'),
  ('Faber-Castell', 'Faber-Castell España S.L.', 'educacion'),
  ('Alpino / Massats', 'Industrias Massats S.A.', 'educacion'),
  ('Liderpapel', 'Liderpapel S.L.', 'educacion'),
  ('Dohe', 'Dohe Papelería S.L.', 'educacion'),
  ('Oxford Hamelin', 'Hamelin Brands S.A.S. Suc. España', 'educacion'),
  -- Mobiliario escolar
  ('Hermex', 'Hermex Ibérica S.L.', 'educacion'),
  ('Rocada', 'Rocada S.A.', 'educacion'),
  ('Mobel Linea', 'Mobel Línea S.L.', 'educacion'),
  -- Tecnología educativa
  ('SMART Technologies', 'SMART Technologies Spain S.L.', 'educacion'),
  ('Promethean', 'Promethean Limited Suc. España', 'educacion'),
  ('Epson Educación', 'Epson Ibérica S.A.U.', 'educacion'),
  -- Plataformas educativas
  ('Blinklearning', 'Blinklearning S.L.', 'educacion'),
  ('Aula Planeta', 'Grupo Planeta - Aula Planeta S.L.U.', 'educacion'),
  ('Academons', 'Cerebriti Edu S.L.', 'educacion'),
  -- Material STEM / laboratorio
  ('Fisher Scientific', 'Thermo Fisher Scientific España S.L.', 'educacion'),
  ('VWR / Avantor', 'VWR International Eurolab S.L.', 'educacion')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND sector = 'educacion');

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. RLS para las nuevas tablas
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE sync_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_price_observations ENABLE ROW LEVEL SECURITY;

-- sync_api_keys: solo accesible via service_role (no hay policy = solo admin)
-- pb_price_observations: lectura para usuarios autenticados
CREATE POLICY "Authenticated users can read price observations"
  ON pb_price_observations FOR SELECT
  TO authenticated
  USING (true);

-- Solo service_role puede insertar observaciones (via API endpoint)
-- No se necesita policy de INSERT para authenticated, n8n usa service_role
