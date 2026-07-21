-- ============================================================================
-- SEED COMPLETO: Banco de precios de construccion Espana 2026
-- Fuentes de referencia: CYPE, BEDEC, precios de mercado
--
-- Categorias:
--   material, mano_obra, maquinaria, transporte, residuos, subcontrata, epi, herramienta
--
-- Todos los precios en EUR sin IVA, referencia mercado espanol 2026
-- ============================================================================

-- ── Prerequisitos: columnas ────────────────────────────────────────────────────
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'material';
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE pb_products ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_pb_products_type ON pb_products(product_type);
CREATE INDEX IF NOT EXISTS idx_pb_products_category ON pb_products(category);
CREATE INDEX IF NOT EXISTS idx_pb_products_type_cat ON pb_products(product_type, category);

-- ── Todo dentro de un bloque PL/pgSQL ─────────────────────────────────────────

DO $$
DECLARE
  v_ref_id UUID;
  v_cype_id UUID;
  v_leroy_id UUID;
  v_obramat_id UUID;
  v_bigmat_id UUID;
  v_bauhaus_id UUID;
  v_saltoki_id UUID;
  v_roca_id UUID;
  v_porcelanosa_id UUID;
  v_saintgobain_id UUID;
  v_sika_id UUID;
  v_weber_id UUID;
  v_pladur_id UUID;
  v_knauf_id UUID;
  v_mo_id UUID;
  v_maq_id UUID;
  v_trans_id UUID;
BEGIN
  -- Crear proveedores si no existen
  INSERT INTO pb_providers (name, legal_name, country, is_active)
  SELECT n, l, 'ES', true FROM (VALUES
    ('Referencia mercado ES', 'Referencia mercado ES'),
    ('CYPE / Banco de precios', 'CYPE Ingenieros S.A.'),
    ('Leroy Merlin', 'Leroy Merlin Espana S.L.U.'),
    ('OBRAMAT', 'OBRAMAT S.L.'),
    ('BigMat', 'BigMat Iberia S.A.'),
    ('Bauhaus', 'Bauhaus Espana S.L.U.'),
    ('Saltoki', 'Saltoki Distribuidora S.A.'),
    ('Grupo Comafe', 'Grupo Comafe S.Coop.'),
    ('Roca', 'Roca Sanitario S.A.'),
    ('Porcelanosa', 'Porcelanosa Grupo A.I.E.'),
    ('Saint-Gobain', 'Saint-Gobain Placo Iberia S.A.'),
    ('Sika', 'Sika S.A.U.'),
    ('Weber', 'Saint-Gobain Weber S.A.'),
    ('Pladur', 'Pladur S.A.'),
    ('Knauf', 'Knauf GmbH Sucursal Espana'),
    ('Bricoking', 'Bricoking S.A.'),
    ('Mano de obra mercado', 'Referencia costes laborales'),
    ('Maquinaria mercado', 'Referencia alquiler maquinaria'),
    ('Transporte mercado', 'Referencia costes transporte')
  ) AS t(n, l)
  WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND company_id IS NULL);

  -- Limpiar duplicados en pb_products antes de insertar
  DELETE FROM pb_products a
  USING pb_products b
  WHERE a.provider_id = b.provider_id
    AND a.commercial_name = b.commercial_name
    AND a.id < b.id;

  -- Crear constraint unico si no existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_pb_product_provider_name'
  ) THEN
    ALTER TABLE pb_products ADD CONSTRAINT uq_pb_product_provider_name UNIQUE (provider_id, commercial_name);
  END IF;

  SELECT id INTO v_ref_id FROM pb_providers WHERE name = 'Referencia mercado ES' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_cype_id FROM pb_providers WHERE name = 'CYPE / Banco de precios' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_leroy_id FROM pb_providers WHERE name = 'Leroy Merlin' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_obramat_id FROM pb_providers WHERE name = 'OBRAMAT' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_bigmat_id FROM pb_providers WHERE name = 'BigMat' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_bauhaus_id FROM pb_providers WHERE name = 'Bauhaus' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_saltoki_id FROM pb_providers WHERE name = 'Saltoki' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_roca_id FROM pb_providers WHERE name = 'Roca' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_porcelanosa_id FROM pb_providers WHERE name = 'Porcelanosa' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_saintgobain_id FROM pb_providers WHERE name = 'Saint-Gobain' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_sika_id FROM pb_providers WHERE name = 'Sika' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_weber_id FROM pb_providers WHERE name = 'Weber' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_pladur_id FROM pb_providers WHERE name = 'Pladur' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_knauf_id FROM pb_providers WHERE name = 'Knauf' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_mo_id FROM pb_providers WHERE name = 'Mano de obra mercado' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_maq_id FROM pb_providers WHERE name = 'Maquinaria mercado' AND company_id IS NULL LIMIT 1;
  SELECT id INTO v_trans_id FROM pb_providers WHERE name = 'Transporte mercado' AND company_id IS NULL LIMIT 1;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Albanileria
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    -- Ladrillos
    (v_ref_id, 'Ladrillo hueco doble 24x11.5x8 cm', 'ud', 0.14, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    (v_ref_id, 'Ladrillo hueco sencillo 24x11.5x4 cm', 'ud', 0.09, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    (v_ref_id, 'Ladrillo perforado cara vista 24x11.5x5 cm', 'ud', 0.32, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    (v_ref_id, 'Ladrillo macizo tosco 24x11.5x5 cm', 'ud', 0.22, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    (v_obramat_id, 'Ladrillo hueco doble 24x11.5x8 cm', 'ud', 0.15, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    (v_bigmat_id, 'Ladrillo hueco doble 24x11.5x8 cm', 'ud', 0.13, 'material', 'albanileria', 'ladrillos', 'ES', true, true, NOW()),
    -- Bloques
    (v_ref_id, 'Bloque hormigon 40x20x20 cm', 'ud', 0.85, 'material', 'albanileria', 'bloques', 'ES', true, true, NOW()),
    (v_ref_id, 'Bloque hormigon 40x20x15 cm', 'ud', 0.72, 'material', 'albanileria', 'bloques', 'ES', true, true, NOW()),
    (v_ref_id, 'Bloque hormigon 40x20x10 cm', 'ud', 0.58, 'material', 'albanileria', 'bloques', 'ES', true, true, NOW()),
    (v_ref_id, 'Rasillon ceramico 100x25x4 cm', 'ud', 1.20, 'material', 'albanileria', 'bloques', 'ES', true, true, NOW()),
    (v_obramat_id, 'Bloque hormigon 40x20x20 cm', 'ud', 0.89, 'material', 'albanileria', 'bloques', 'ES', true, true, NOW()),
    -- Mortero y cemento
    (v_ref_id, 'Cemento gris CEM II/B-L 32.5 R saco 25 kg', 'ud', 4.20, 'material', 'albanileria', 'cementos', 'ES', true, true, NOW()),
    (v_ref_id, 'Cemento blanco BL II/B-LL 42.5 R saco 25 kg', 'ud', 8.90, 'material', 'albanileria', 'cementos', 'ES', true, true, NOW()),
    (v_ref_id, 'Mortero de cemento M-5 saco 25 kg', 'ud', 2.85, 'material', 'albanileria', 'morteros', 'ES', true, true, NOW()),
    (v_ref_id, 'Mortero de cemento M-10 saco 25 kg', 'ud', 3.15, 'material', 'albanileria', 'morteros', 'ES', true, true, NOW()),
    (v_weber_id, 'Weber.col flex cemento cola flexible 25 kg', 'ud', 12.50, 'material', 'albanileria', 'morteros', 'ES', true, true, NOW()),
    (v_leroy_id, 'Cemento gris CEM II 32.5 saco 25 kg', 'ud', 4.49, 'material', 'albanileria', 'cementos', 'ES', true, true, NOW()),
    (v_obramat_id, 'Cemento gris Portland 25 kg', 'ud', 3.95, 'material', 'albanileria', 'cementos', 'ES', true, true, NOW()),
    -- Yeso
    (v_ref_id, 'Yeso controlado YG saco 18 kg', 'ud', 2.80, 'material', 'albanileria', 'yesos', 'ES', true, true, NOW()),
    (v_ref_id, 'Yeso proyectar maquina 750 kg', 'ud', 95.00, 'material', 'albanileria', 'yesos', 'ES', true, true, NOW()),
    (v_ref_id, 'Escayola E-30 saco 18 kg', 'ud', 3.40, 'material', 'albanileria', 'yesos', 'ES', true, true, NOW()),
    -- Arena y grava
    (v_ref_id, 'Arena lavada 0/4 mm', 't', 12.50, 'material', 'albanileria', 'aridos', 'ES', true, true, NOW()),
    (v_ref_id, 'Grava 6/12 mm', 't', 14.00, 'material', 'albanileria', 'aridos', 'ES', true, true, NOW()),
    (v_ref_id, 'Gravilla 12/20 mm', 't', 13.50, 'material', 'albanileria', 'aridos', 'ES', true, true, NOW()),
    (v_ref_id, 'Zahorra artificial ZA-25', 't', 8.50, 'material', 'albanileria', 'aridos', 'ES', true, true, NOW()),
    (v_ref_id, 'Hormigon HA-25/B/20/IIa central', 'm3', 78.00, 'material', 'albanileria', 'hormigones', 'ES', true, true, NOW()),
    (v_ref_id, 'Hormigon HA-30/B/20/IIa central', 'm3', 84.00, 'material', 'albanileria', 'hormigones', 'ES', true, true, NOW()),
    (v_ref_id, 'Hormigon HM-20/P/20/I central', 'm3', 68.00, 'material', 'albanileria', 'hormigones', 'ES', true, true, NOW()),
    (v_ref_id, 'Hormigon de limpieza HM-10', 'm3', 58.00, 'material', 'albanileria', 'hormigones', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Estructura y acero
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Acero corrugado B 500 SD barras', 'kg', 1.15, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Acero corrugado B 500 SD elaborado', 'kg', 1.35, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Malla electrosoldada ME 15x15 diam 6 mm', 'm2', 3.80, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Malla electrosoldada ME 15x15 diam 8 mm', 'm2', 5.90, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Perfil IPE-200 acero S275JR', 'kg', 1.45, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Perfil HEB-200 acero S275JR', 'kg', 1.50, 'material', 'estructura', 'acero', 'ES', true, true, NOW()),
    (v_ref_id, 'Vigueta pretensada T-18', 'ml', 6.20, 'material', 'estructura', 'forjados', 'ES', true, true, NOW()),
    (v_ref_id, 'Bovedilla ceramica 60x25x22 cm', 'ud', 1.05, 'material', 'estructura', 'forjados', 'ES', true, true, NOW()),
    (v_ref_id, 'Bovedilla hormigon 60x25x22 cm', 'ud', 0.95, 'material', 'estructura', 'forjados', 'ES', true, true, NOW()),
    (v_ref_id, 'Encofrado metalico muro h<3m', 'm2', 22.00, 'material', 'estructura', 'encofrados', 'ES', true, true, NOW()),
    (v_ref_id, 'Puntales metalicos 3 m', 'ud', 2.80, 'material', 'estructura', 'encofrados', 'ES', true, true, NOW()),
    (v_ref_id, 'Tablero fenolico encofrar 244x122 cm', 'ud', 32.00, 'material', 'estructura', 'encofrados', 'ES', true, true, NOW()),
    (v_ref_id, 'Madera pino encofrar tablon 15x5 cm', 'ml', 2.10, 'material', 'estructura', 'encofrados', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Cubiertas e impermeabilizacion
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Teja mixta ceramica roja', 'ud', 0.55, 'material', 'cubiertas', 'tejas', 'ES', true, true, NOW()),
    (v_ref_id, 'Teja plana ceramica', 'ud', 0.85, 'material', 'cubiertas', 'tejas', 'ES', true, true, NOW()),
    (v_ref_id, 'Teja curva arabe', 'ud', 0.42, 'material', 'cubiertas', 'tejas', 'ES', true, true, NOW()),
    (v_ref_id, 'Lamina impermeabilizante EPDM 1.5 mm', 'm2', 9.80, 'material', 'cubiertas', 'impermeabilizacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Lamina asfaltica LBM-40-FV', 'm2', 5.60, 'material', 'cubiertas', 'impermeabilizacion', 'ES', true, true, NOW()),
    (v_sika_id, 'Sika Monotop impermeabilizante 25 kg', 'ud', 28.50, 'material', 'cubiertas', 'impermeabilizacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Panel sandwich cubierta 30 mm', 'm2', 18.50, 'material', 'cubiertas', 'paneles', 'ES', true, true, NOW()),
    (v_ref_id, 'Panel sandwich cubierta 50 mm', 'm2', 24.00, 'material', 'cubiertas', 'paneles', 'ES', true, true, NOW()),
    (v_ref_id, 'Canalon aluminio lacado 250 mm', 'ml', 12.00, 'material', 'cubiertas', 'evacuacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Bajante PVC 110 mm', 'ml', 4.80, 'material', 'cubiertas', 'evacuacion', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Aislamiento
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Poliestireno extruido XPS 40 mm', 'm2', 5.80, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Poliestireno extruido XPS 60 mm', 'm2', 8.20, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Poliestireno expandido EPS 40 mm', 'm2', 2.90, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Lana de roca 40 mm panel rigido', 'm2', 5.50, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Lana de roca 60 mm panel rigido', 'm2', 7.80, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Lana mineral 45 mm rollo', 'm2', 3.20, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Espuma poliuretano proyectado 30 mm', 'm2', 8.50, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_leroy_id, 'Panel XPS extruido 40 mm 1250x600', 'm2', 6.29, 'material', 'aislamiento', 'termico', 'ES', true, true, NOW()),
    (v_ref_id, 'Lamina acustica suelo flotante 5 mm', 'm2', 3.40, 'material', 'aislamiento', 'acustico', 'ES', true, true, NOW()),
    (v_ref_id, 'Panel acustico lana mineral 40 mm', 'm2', 6.20, 'material', 'aislamiento', 'acustico', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Pavimentos y revestimientos
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Azulejo ceramico 20x20 cm blanco', 'm2', 8.50, 'material', 'revestimientos', 'azulejos', 'ES', true, true, NOW()),
    (v_ref_id, 'Azulejo ceramico 30x60 cm', 'm2', 14.00, 'material', 'revestimientos', 'azulejos', 'ES', true, true, NOW()),
    (v_porcelanosa_id, 'Porcelanico rectificado 60x60 cm', 'm2', 28.00, 'material', 'revestimientos', 'porcelanicos', 'ES', true, true, NOW()),
    (v_porcelanosa_id, 'Porcelanico rectificado 120x60 cm', 'm2', 38.00, 'material', 'revestimientos', 'porcelanicos', 'ES', true, true, NOW()),
    (v_ref_id, 'Gres porcelanico antideslizante exterior 33x33', 'm2', 16.50, 'material', 'revestimientos', 'porcelanicos', 'ES', true, true, NOW()),
    (v_leroy_id, 'Porcelanico imitacion madera 120x20 cm', 'm2', 19.90, 'material', 'revestimientos', 'porcelanicos', 'ES', true, true, NOW()),
    (v_ref_id, 'Baldosa hidraulica 20x20 cm', 'm2', 22.00, 'material', 'revestimientos', 'baldosas', 'ES', true, true, NOW()),
    (v_ref_id, 'Solera hormigon pulido con cuarzo', 'm2', 28.00, 'material', 'revestimientos', 'pavimentos', 'ES', true, true, NOW()),
    (v_ref_id, 'Tarima flotante AC4 8 mm roble', 'm2', 12.50, 'material', 'revestimientos', 'pavimentos', 'ES', true, true, NOW()),
    (v_leroy_id, 'Suelo vinilico SPC click 5 mm', 'm2', 16.90, 'material', 'revestimientos', 'pavimentos', 'ES', true, true, NOW()),
    (v_ref_id, 'Rodapie MDF blanco 7 cm', 'ml', 1.80, 'material', 'revestimientos', 'pavimentos', 'ES', true, true, NOW()),
    (v_weber_id, 'Weber.floor autonivelante 25 kg', 'ud', 14.50, 'material', 'revestimientos', 'pavimentos', 'ES', true, true, NOW()),
    (v_ref_id, 'Cemento cola C1 gris 25 kg', 'ud', 4.80, 'material', 'revestimientos', 'adhesivos', 'ES', true, true, NOW()),
    (v_ref_id, 'Cemento cola C2 flexible blanco 25 kg', 'ud', 9.50, 'material', 'revestimientos', 'adhesivos', 'ES', true, true, NOW()),
    (v_ref_id, 'Rejuntado CG2 gris 5 kg', 'ud', 5.20, 'material', 'revestimientos', 'adhesivos', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Tabiqueria seca (pladur/knauf)
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_pladur_id, 'Placa Pladur N 13 mm (1200x2600)', 'ud', 6.90, 'material', 'tabiqueria_seca', 'placas', 'ES', true, true, NOW()),
    (v_pladur_id, 'Placa Pladur WA 13 mm hidrófuga', 'ud', 9.50, 'material', 'tabiqueria_seca', 'placas', 'ES', true, true, NOW()),
    (v_pladur_id, 'Placa Pladur FOC 15 mm cortafuego', 'ud', 11.20, 'material', 'tabiqueria_seca', 'placas', 'ES', true, true, NOW()),
    (v_knauf_id, 'Placa Knauf Standard A 13 mm', 'ud', 6.50, 'material', 'tabiqueria_seca', 'placas', 'ES', true, true, NOW()),
    (v_knauf_id, 'Placa Knauf Diamant 12.5 mm', 'ud', 10.80, 'material', 'tabiqueria_seca', 'placas', 'ES', true, true, NOW()),
    (v_ref_id, 'Montante metalico 48 mm (3 m)', 'ud', 1.90, 'material', 'tabiqueria_seca', 'perfileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Canal metalico 48 mm (3 m)', 'ud', 1.70, 'material', 'tabiqueria_seca', 'perfileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Montante metalico 70 mm (3 m)', 'ud', 2.30, 'material', 'tabiqueria_seca', 'perfileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Pasta de juntas lista 20 kg', 'ud', 12.50, 'material', 'tabiqueria_seca', 'acabados', 'ES', true, true, NOW()),
    (v_ref_id, 'Cinta de juntas papel 150 m', 'ud', 5.80, 'material', 'tabiqueria_seca', 'acabados', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Fontaneria
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Tubo multicapa PEX/AL/PEX 16 mm', 'ml', 1.80, 'material', 'fontaneria', 'tuberias', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo multicapa PEX/AL/PEX 20 mm', 'ml', 2.40, 'material', 'fontaneria', 'tuberias', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo cobre 15 mm', 'ml', 4.20, 'material', 'fontaneria', 'tuberias', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo cobre 22 mm', 'ml', 7.50, 'material', 'fontaneria', 'tuberias', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo PVC evacuacion 110 mm', 'ml', 4.50, 'material', 'fontaneria', 'evacuacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo PVC evacuacion 50 mm', 'ml', 2.20, 'material', 'fontaneria', 'evacuacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo PVC evacuacion 40 mm', 'ml', 1.80, 'material', 'fontaneria', 'evacuacion', 'ES', true, true, NOW()),
    (v_saltoki_id, 'Grifo monomando fregadero cromado', 'ud', 45.00, 'material', 'fontaneria', 'griferia', 'ES', true, true, NOW()),
    (v_saltoki_id, 'Grifo monomando lavabo cromado', 'ud', 38.00, 'material', 'fontaneria', 'griferia', 'ES', true, true, NOW()),
    (v_saltoki_id, 'Grifo termostatico ducha', 'ud', 85.00, 'material', 'fontaneria', 'griferia', 'ES', true, true, NOW()),
    (v_roca_id, 'Inodoro compacto Roca The Gap', 'ud', 165.00, 'material', 'fontaneria', 'sanitarios', 'ES', true, true, NOW()),
    (v_roca_id, 'Lavabo Roca The Gap 56 cm', 'ud', 78.00, 'material', 'fontaneria', 'sanitarios', 'ES', true, true, NOW()),
    (v_roca_id, 'Plato ducha acrilico 80x80 cm', 'ud', 120.00, 'material', 'fontaneria', 'sanitarios', 'ES', true, true, NOW()),
    (v_roca_id, 'Banera acrilica 170x70 cm', 'ud', 185.00, 'material', 'fontaneria', 'sanitarios', 'ES', true, true, NOW()),
    (v_ref_id, 'Calentador ACS gas 11 litros', 'ud', 320.00, 'material', 'fontaneria', 'acs', 'ES', true, true, NOW()),
    (v_ref_id, 'Termo electrico 80 litros', 'ud', 195.00, 'material', 'fontaneria', 'acs', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Electricidad
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Cable H07V-K 1.5 mm2 rollo 100 m', 'ud', 18.50, 'material', 'electricidad', 'cables', 'ES', true, true, NOW()),
    (v_ref_id, 'Cable H07V-K 2.5 mm2 rollo 100 m', 'ud', 28.00, 'material', 'electricidad', 'cables', 'ES', true, true, NOW()),
    (v_ref_id, 'Cable H07V-K 4 mm2 rollo 100 m', 'ud', 44.00, 'material', 'electricidad', 'cables', 'ES', true, true, NOW()),
    (v_ref_id, 'Cable H07V-K 6 mm2 rollo 100 m', 'ud', 65.00, 'material', 'electricidad', 'cables', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo corrugado 20 mm rollo 100 m', 'ud', 12.00, 'material', 'electricidad', 'canalizaciones', 'ES', true, true, NOW()),
    (v_ref_id, 'Tubo corrugado 25 mm rollo 50 m', 'ud', 9.50, 'material', 'electricidad', 'canalizaciones', 'ES', true, true, NOW()),
    (v_ref_id, 'Caja empotrar universal enlace', 'ud', 0.35, 'material', 'electricidad', 'mecanismos', 'ES', true, true, NOW()),
    (v_ref_id, 'Mecanismo interruptor empotrar blanco', 'ud', 4.50, 'material', 'electricidad', 'mecanismos', 'ES', true, true, NOW()),
    (v_ref_id, 'Mecanismo base enchufe 16A empotrar', 'ud', 4.80, 'material', 'electricidad', 'mecanismos', 'ES', true, true, NOW()),
    (v_ref_id, 'Cuadro electrico empotrar 12 modulos', 'ud', 22.00, 'material', 'electricidad', 'cuadros', 'ES', true, true, NOW()),
    (v_ref_id, 'Diferencial 2P 40A 30mA', 'ud', 45.00, 'material', 'electricidad', 'proteccion', 'ES', true, true, NOW()),
    (v_ref_id, 'Magnetotermico 2P 20A curva C', 'ud', 12.50, 'material', 'electricidad', 'proteccion', 'ES', true, true, NOW()),
    (v_ref_id, 'Downlight LED empotrar 18W 4000K', 'ud', 8.50, 'material', 'electricidad', 'iluminacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Foco LED GU10 7W 4000K', 'ud', 3.20, 'material', 'electricidad', 'iluminacion', 'ES', true, true, NOW()),
    (v_leroy_id, 'Downlight LED empotrar 20W', 'ud', 9.99, 'material', 'electricidad', 'iluminacion', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Carpinteria y cerrajeria
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Puerta interior hueca 72.5x203 cm', 'ud', 55.00, 'material', 'carpinteria', 'puertas', 'ES', true, true, NOW()),
    (v_ref_id, 'Puerta interior maciza 72.5x203 cm', 'ud', 120.00, 'material', 'carpinteria', 'puertas', 'ES', true, true, NOW()),
    (v_ref_id, 'Puerta blindada exterior 92x210 cm', 'ud', 450.00, 'material', 'carpinteria', 'puertas', 'ES', true, true, NOW()),
    (v_ref_id, 'Cerco puerta pino 7x3.5 cm', 'ud', 18.00, 'material', 'carpinteria', 'puertas', 'ES', true, true, NOW()),
    (v_ref_id, 'Ventana aluminio RPT oscilobatiente 120x120', 'ud', 280.00, 'material', 'carpinteria', 'ventanas', 'ES', true, true, NOW()),
    (v_ref_id, 'Ventana PVC 2 hojas oscilobatiente 120x120', 'ud', 320.00, 'material', 'carpinteria', 'ventanas', 'ES', true, true, NOW()),
    (v_ref_id, 'Puerta corredera aluminio 200x210 cm', 'ud', 480.00, 'material', 'carpinteria', 'ventanas', 'ES', true, true, NOW()),
    (v_ref_id, 'Persiana aluminio inyectada 150 cm', 'ud', 95.00, 'material', 'carpinteria', 'persianas', 'ES', true, true, NOW()),
    (v_ref_id, 'Vidrio doble 4+12+4 mm', 'm2', 28.00, 'material', 'carpinteria', 'vidrios', 'ES', true, true, NOW()),
    (v_ref_id, 'Vidrio doble bajo emisivo 4+16+4 mm', 'm2', 42.00, 'material', 'carpinteria', 'vidrios', 'ES', true, true, NOW()),
    (v_leroy_id, 'Puerta interior lisa blanca 72.5x203', 'ud', 59.99, 'material', 'carpinteria', 'puertas', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Pintura y acabados
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Pintura plastica blanca mate interior 15 L', 'ud', 42.00, 'material', 'pintura', 'pinturas', 'ES', true, true, NOW()),
    (v_ref_id, 'Pintura plastica blanca satinada 15 L', 'ud', 55.00, 'material', 'pintura', 'pinturas', 'ES', true, true, NOW()),
    (v_ref_id, 'Esmalte sintetico blanco satinado 4 L', 'ud', 38.00, 'material', 'pintura', 'pinturas', 'ES', true, true, NOW()),
    (v_ref_id, 'Imprimacion fijadora al agua 15 L', 'ud', 35.00, 'material', 'pintura', 'imprimaciones', 'ES', true, true, NOW()),
    (v_ref_id, 'Masilla plastica reparar paredes 5 kg', 'ud', 8.50, 'material', 'pintura', 'masillas', 'ES', true, true, NOW()),
    (v_leroy_id, 'Pintura plastica blanca premium 15 L', 'ud', 49.90, 'material', 'pintura', 'pinturas', 'ES', true, true, NOW()),
    (v_ref_id, 'Pintura fachada exterior blanca 15 L', 'ud', 65.00, 'material', 'pintura', 'pinturas', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MATERIALES — Climatizacion
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Split aire acondicionado 3000 frig inverter', 'ud', 650.00, 'material', 'climatizacion', 'equipos_frio', 'ES', true, true, NOW()),
    (v_ref_id, 'Split aire acondicionado 4500 frig inverter', 'ud', 850.00, 'material', 'climatizacion', 'equipos_frio', 'ES', true, true, NOW()),
    (v_ref_id, 'Caldera gas condensacion 24 kW', 'ud', 1200.00, 'material', 'climatizacion', 'calefaccion', 'ES', true, true, NOW()),
    (v_ref_id, 'Radiador aluminio 10 elementos 600 mm', 'ud', 95.00, 'material', 'climatizacion', 'calefaccion', 'ES', true, true, NOW()),
    (v_ref_id, 'Suelo radiante tubo PEX 16 mm', 'm2', 28.00, 'material', 'climatizacion', 'calefaccion', 'ES', true, true, NOW()),
    (v_ref_id, 'Bomba de calor aerotermia 8 kW', 'ud', 3800.00, 'material', 'climatizacion', 'aerotermia', 'ES', true, true, NOW()),
    (v_ref_id, 'Conducto fibra climatizacion 250 mm', 'ml', 8.50, 'material', 'climatizacion', 'conductos', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MANO DE OBRA — Costes por hora/jornada referencia Espana 2026
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    -- Oficiales
    (v_mo_id, 'Oficial 1a albanil', 'h', 22.50, 'mano_obra', 'mano_obra', 'albanileria', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon ordinario albanileria', 'h', 17.80, 'mano_obra', 'mano_obra', 'albanileria', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon especializado albanileria', 'h', 18.90, 'mano_obra', 'mano_obra', 'albanileria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a encofrador', 'h', 23.00, 'mano_obra', 'mano_obra', 'estructura', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a ferrallista', 'h', 23.00, 'mano_obra', 'mano_obra', 'estructura', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon ferrallista', 'h', 18.20, 'mano_obra', 'mano_obra', 'estructura', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a fontanero', 'h', 24.00, 'mano_obra', 'mano_obra', 'fontaneria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 2a fontanero', 'h', 20.50, 'mano_obra', 'mano_obra', 'fontaneria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a electricista', 'h', 24.00, 'mano_obra', 'mano_obra', 'electricidad', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 2a electricista', 'h', 20.50, 'mano_obra', 'mano_obra', 'electricidad', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a pintor', 'h', 22.00, 'mano_obra', 'mano_obra', 'pintura', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon pintura', 'h', 17.50, 'mano_obra', 'mano_obra', 'pintura', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a solador/alicatador', 'h', 23.50, 'mano_obra', 'mano_obra', 'revestimientos', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon solador', 'h', 18.00, 'mano_obra', 'mano_obra', 'revestimientos', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a carpintero', 'h', 23.00, 'mano_obra', 'mano_obra', 'carpinteria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a cerrajero', 'h', 23.50, 'mano_obra', 'mano_obra', 'carpinteria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a instalador climatizacion', 'h', 25.00, 'mano_obra', 'mano_obra', 'climatizacion', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a yesero/escayolista', 'h', 22.50, 'mano_obra', 'mano_obra', 'albanileria', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a montador tabiqueria seca', 'h', 23.00, 'mano_obra', 'mano_obra', 'tabiqueria_seca', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a impermeabilizador', 'h', 23.50, 'mano_obra', 'mano_obra', 'cubiertas', 'ES', true, true, NOW()),
    (v_mo_id, 'Oficial 1a cristalero', 'h', 23.00, 'mano_obra', 'mano_obra', 'carpinteria', 'ES', true, true, NOW()),
    (v_mo_id, 'Gruista/operador grua torre', 'h', 24.50, 'mano_obra', 'mano_obra', 'maquinaria', 'ES', true, true, NOW()),
    (v_mo_id, 'Encargado de obra', 'h', 28.00, 'mano_obra', 'mano_obra', 'direccion', 'ES', true, true, NOW()),
    (v_mo_id, 'Jefe de obra', 'h', 35.00, 'mano_obra', 'mano_obra', 'direccion', 'ES', true, true, NOW()),
    (v_mo_id, 'Tecnico PRL (prevencion riesgos)', 'h', 30.00, 'mano_obra', 'mano_obra', 'seguridad', 'ES', true, true, NOW()),
    (v_mo_id, 'Peon limpieza obra', 'h', 16.50, 'mano_obra', 'mano_obra', 'limpieza', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MAQUINARIA — Alquiler diario referencia Espana 2026
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_maq_id, 'Retroexcavadora mixta JCB/Cat', 'dia', 280.00, 'maquinaria', 'maquinaria', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_maq_id, 'Mini excavadora 1.5 t', 'dia', 150.00, 'maquinaria', 'maquinaria', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_maq_id, 'Excavadora hidraulica 20 t', 'dia', 450.00, 'maquinaria', 'maquinaria', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_maq_id, 'Pala cargadora sobre ruedas', 'dia', 320.00, 'maquinaria', 'maquinaria', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_maq_id, 'Camion dumper articulado 14 m3', 'dia', 380.00, 'maquinaria', 'maquinaria', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_maq_id, 'Compactador vibratorio rodillo', 'dia', 200.00, 'maquinaria', 'maquinaria', 'compactacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Bandeja vibrante compactadora 90 kg', 'dia', 35.00, 'maquinaria', 'maquinaria', 'compactacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Grua torre 40 m pluma', 'mes', 1800.00, 'maquinaria', 'maquinaria', 'elevacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Grua autopropulsada 50 t', 'dia', 850.00, 'maquinaria', 'maquinaria', 'elevacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Plataforma elevadora tijera 10 m', 'dia', 95.00, 'maquinaria', 'maquinaria', 'elevacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Plataforma elevadora articulada 16 m', 'dia', 180.00, 'maquinaria', 'maquinaria', 'elevacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Hormigonera 250 litros electrica', 'dia', 25.00, 'maquinaria', 'maquinaria', 'hormigon', 'ES', true, true, NOW()),
    (v_maq_id, 'Camion bomba hormigon 36 m', 'h', 150.00, 'maquinaria', 'maquinaria', 'hormigon', 'ES', true, true, NOW()),
    (v_maq_id, 'Vibrador hormigon aguja 50 mm', 'dia', 18.00, 'maquinaria', 'maquinaria', 'hormigon', 'ES', true, true, NOW()),
    (v_maq_id, 'Andamio tubular europeo (montar+desmontar)', 'm2/mes', 8.50, 'maquinaria', 'maquinaria', 'andamios', 'ES', true, true, NOW()),
    (v_maq_id, 'Andamio movil torre 6 m', 'dia', 28.00, 'maquinaria', 'maquinaria', 'andamios', 'ES', true, true, NOW()),
    (v_maq_id, 'Dumper autocargable 1.5 t', 'dia', 65.00, 'maquinaria', 'maquinaria', 'transporte_obra', 'ES', true, true, NOW()),
    (v_maq_id, 'Montacargas obra 500 kg', 'mes', 650.00, 'maquinaria', 'maquinaria', 'elevacion', 'ES', true, true, NOW()),
    (v_maq_id, 'Martillo demoledor electrico 15 kg', 'dia', 35.00, 'maquinaria', 'maquinaria', 'demolicion', 'ES', true, true, NOW()),
    (v_maq_id, 'Cortadora de asfalto disco 350 mm', 'dia', 55.00, 'maquinaria', 'maquinaria', 'corte', 'ES', true, true, NOW()),
    (v_maq_id, 'Grupo electrogeno 20 kVA', 'dia', 65.00, 'maquinaria', 'maquinaria', 'energia', 'ES', true, true, NOW()),
    (v_maq_id, 'Compresor de aire 2000 l/min', 'dia', 55.00, 'maquinaria', 'maquinaria', 'neumática', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TRANSPORTE — Costes referencia Espana 2026
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_trans_id, 'Camion basculante 12 t (ida+vuelta <30 km)', 'viaje', 180.00, 'transporte', 'transporte', 'camiones', 'ES', true, true, NOW()),
    (v_trans_id, 'Camion basculante 20 t (ida+vuelta <30 km)', 'viaje', 250.00, 'transporte', 'transporte', 'camiones', 'ES', true, true, NOW()),
    (v_trans_id, 'Camion gondola transporte maquinaria', 'viaje', 350.00, 'transporte', 'transporte', 'especial', 'ES', true, true, NOW()),
    (v_trans_id, 'Camion grua 12 t/m', 'h', 55.00, 'transporte', 'transporte', 'grua', 'ES', true, true, NOW()),
    (v_trans_id, 'Furgoneta reparto material <3.5 t', 'dia', 65.00, 'transporte', 'transporte', 'furgonetas', 'ES', true, true, NOW()),
    (v_trans_id, 'Porte hormigon cuba 8 m3', 'viaje', 45.00, 'transporte', 'transporte', 'hormigon', 'ES', true, true, NOW()),
    (v_trans_id, 'Transporte aridos <20 km', 't', 6.50, 'transporte', 'transporte', 'aridos', 'ES', true, true, NOW()),
    (v_trans_id, 'Suplemento km adicional camion', 'km', 2.80, 'transporte', 'transporte', 'suplementos', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- RESIDUOS — Gestion de residuos de construccion
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Contenedor escombro 5 m3 (alquiler+retirada)', 'ud', 180.00, 'residuos', 'residuos', 'contenedores', 'ES', true, true, NOW()),
    (v_ref_id, 'Contenedor escombro 8 m3 (alquiler+retirada)', 'ud', 280.00, 'residuos', 'residuos', 'contenedores', 'ES', true, true, NOW()),
    (v_ref_id, 'Contenedor escombro 12 m3 (alquiler+retirada)', 'ud', 380.00, 'residuos', 'residuos', 'contenedores', 'ES', true, true, NOW()),
    (v_ref_id, 'Saco big bag escombro 1 m3 (recogida incluida)', 'ud', 85.00, 'residuos', 'residuos', 'sacos', 'ES', true, true, NOW()),
    (v_ref_id, 'Canon vertedero RCD limpio', 't', 12.00, 'residuos', 'residuos', 'canon_vertedero', 'ES', true, true, NOW()),
    (v_ref_id, 'Canon vertedero RCD mixto', 't', 25.00, 'residuos', 'residuos', 'canon_vertedero', 'ES', true, true, NOW()),
    (v_ref_id, 'Canon vertedero residuos peligrosos', 't', 120.00, 'residuos', 'residuos', 'canon_vertedero', 'ES', true, true, NOW()),
    (v_ref_id, 'Gestion residuos amianto/fibrocemento', 't', 450.00, 'residuos', 'residuos', 'peligrosos', 'ES', true, true, NOW()),
    (v_ref_id, 'Recogida selectiva madera obra', 'm3', 45.00, 'residuos', 'residuos', 'selectiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Recogida selectiva plasticos obra', 'm3', 55.00, 'residuos', 'residuos', 'selectiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Recogida selectiva metales obra', 'm3', 35.00, 'residuos', 'residuos', 'selectiva', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EPIs y SEGURIDAD — Equipos de proteccion individual
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Casco seguridad obra con barbuquejo', 'ud', 8.50, 'epi', 'seguridad', 'proteccion_cabeza', 'ES', true, true, NOW()),
    (v_ref_id, 'Gafas proteccion antiproyecciones', 'ud', 4.50, 'epi', 'seguridad', 'proteccion_ocular', 'ES', true, true, NOW()),
    (v_ref_id, 'Guantes obra nitrilo/latex', 'par', 2.80, 'epi', 'seguridad', 'proteccion_manos', 'ES', true, true, NOW()),
    (v_ref_id, 'Guantes anticorte nivel 5', 'par', 6.50, 'epi', 'seguridad', 'proteccion_manos', 'ES', true, true, NOW()),
    (v_ref_id, 'Botas seguridad S3 puntera acero', 'par', 32.00, 'epi', 'seguridad', 'calzado', 'ES', true, true, NOW()),
    (v_ref_id, 'Chaleco reflectante alta visibilidad', 'ud', 3.50, 'epi', 'seguridad', 'ropa', 'ES', true, true, NOW()),
    (v_ref_id, 'Arnes anticaidas completo', 'ud', 45.00, 'epi', 'seguridad', 'anticaidas', 'ES', true, true, NOW()),
    (v_ref_id, 'Linea de vida temporal 20 m', 'ud', 85.00, 'epi', 'seguridad', 'anticaidas', 'ES', true, true, NOW()),
    (v_ref_id, 'Protector auditivo tapones', 'par', 0.80, 'epi', 'seguridad', 'proteccion_auditiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Protector auditivo orejera', 'ud', 12.00, 'epi', 'seguridad', 'proteccion_auditiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Mascarilla FFP2 con valvula', 'ud', 2.50, 'epi', 'seguridad', 'proteccion_respiratoria', 'ES', true, true, NOW()),
    (v_ref_id, 'Mascarilla FFP3', 'ud', 4.50, 'epi', 'seguridad', 'proteccion_respiratoria', 'ES', true, true, NOW()),
    (v_ref_id, 'Red seguridad horizontal (bajo forjado)', 'm2', 3.80, 'epi', 'seguridad', 'proteccion_colectiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Barandilla proteccion bordes 1 m', 'ml', 6.50, 'epi', 'seguridad', 'proteccion_colectiva', 'ES', true, true, NOW()),
    (v_ref_id, 'Senal seguridad obra (varias)', 'ud', 8.00, 'epi', 'seguridad', 'senalizacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Extintor polvo ABC 6 kg', 'ud', 28.00, 'epi', 'seguridad', 'contra_incendios', 'ES', true, true, NOW()),
    (v_ref_id, 'Botiquin primeros auxilios obra', 'ud', 35.00, 'epi', 'seguridad', 'primeros_auxilios', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SUBCONTRATAS — Precios unitarios referencia
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Excavacion zanjas tierra blanda', 'm3', 8.50, 'subcontrata', 'subcontratas', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_ref_id, 'Excavacion zanjas roca blanda', 'm3', 18.00, 'subcontrata', 'subcontratas', 'movimiento_tierras', 'ES', true, true, NOW()),
    (v_ref_id, 'Demolicion tabiques ladrillo', 'm2', 6.50, 'subcontrata', 'subcontratas', 'demoliciones', 'ES', true, true, NOW()),
    (v_ref_id, 'Demolicion solera hormigon 15 cm', 'm2', 12.00, 'subcontrata', 'subcontratas', 'demoliciones', 'ES', true, true, NOW()),
    (v_ref_id, 'Fabrica ladrillo hueco doble (material+MO)', 'm2', 28.00, 'subcontrata', 'subcontratas', 'albanileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Enfoscado mortero M-5 maestreado (material+MO)', 'm2', 14.50, 'subcontrata', 'subcontratas', 'albanileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Alicatado ceramico (material basico+MO)', 'm2', 32.00, 'subcontrata', 'subcontratas', 'revestimientos', 'ES', true, true, NOW()),
    (v_ref_id, 'Solado gres porcelanico (material basico+MO)', 'm2', 35.00, 'subcontrata', 'subcontratas', 'revestimientos', 'ES', true, true, NOW()),
    (v_ref_id, 'Pintura interior 2 manos (material+MO)', 'm2', 6.80, 'subcontrata', 'subcontratas', 'pintura', 'ES', true, true, NOW()),
    (v_ref_id, 'Tabique Pladur sencillo 78 mm (material+MO)', 'm2', 28.00, 'subcontrata', 'subcontratas', 'tabiqueria_seca', 'ES', true, true, NOW()),
    (v_ref_id, 'Falso techo Pladur continuo (material+MO)', 'm2', 24.00, 'subcontrata', 'subcontratas', 'tabiqueria_seca', 'ES', true, true, NOW()),
    (v_ref_id, 'Instalacion electrica vivienda completa', 'ud', 3500.00, 'subcontrata', 'subcontratas', 'electricidad', 'ES', true, true, NOW()),
    (v_ref_id, 'Instalacion fontaneria vivienda completa', 'ud', 2800.00, 'subcontrata', 'subcontratas', 'fontaneria', 'ES', true, true, NOW()),
    (v_ref_id, 'Instalacion climatizacion split (1 unidad)', 'ud', 450.00, 'subcontrata', 'subcontratas', 'climatizacion', 'ES', true, true, NOW()),
    (v_ref_id, 'Colocacion carpinteria interior (por puerta)', 'ud', 65.00, 'subcontrata', 'subcontratas', 'carpinteria', 'ES', true, true, NOW()),
    (v_ref_id, 'Colocacion ventana aluminio RPT', 'ud', 85.00, 'subcontrata', 'subcontratas', 'carpinteria', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- HERRAMIENTAS — Consumibles y herramientas
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, region, is_active, is_available, checked_at)
  VALUES
    (v_ref_id, 'Disco diamante cortar ceramica 230 mm', 'ud', 18.00, 'herramienta', 'herramientas', 'discos', 'ES', true, true, NOW()),
    (v_ref_id, 'Disco diamante hormigon 230 mm', 'ud', 22.00, 'herramienta', 'herramientas', 'discos', 'ES', true, true, NOW()),
    (v_ref_id, 'Broca SDS-Plus hormigon 8x160 mm', 'ud', 3.50, 'herramienta', 'herramientas', 'brocas', 'ES', true, true, NOW()),
    (v_ref_id, 'Broca SDS-Plus hormigon 10x210 mm', 'ud', 4.80, 'herramienta', 'herramientas', 'brocas', 'ES', true, true, NOW()),
    (v_ref_id, 'Hoja sierra calar madera (pack 5)', 'ud', 6.50, 'herramienta', 'herramientas', 'hojas', 'ES', true, true, NOW()),
    (v_ref_id, 'Nivel laser autonivelante linea verde', 'ud', 85.00, 'herramienta', 'herramientas', 'medicion', 'ES', true, true, NOW()),
    (v_ref_id, 'Flexometro 5 m', 'ud', 8.50, 'herramienta', 'herramientas', 'medicion', 'ES', true, true, NOW()),
    (v_ref_id, 'Llana acero inoxidable 28 cm', 'ud', 9.00, 'herramienta', 'herramientas', 'albanileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Paleta albanil 20 cm', 'ud', 7.50, 'herramienta', 'herramientas', 'albanileria', 'ES', true, true, NOW()),
    (v_ref_id, 'Espuma poliuretano canula 750 ml', 'ud', 5.50, 'herramienta', 'herramientas', 'sellado', 'ES', true, true, NOW()),
    (v_ref_id, 'Silicona acida transparente 300 ml', 'ud', 3.80, 'herramienta', 'herramientas', 'sellado', 'ES', true, true, NOW()),
    (v_ref_id, 'Silicona neutra blanca 300 ml', 'ud', 5.20, 'herramienta', 'herramientas', 'sellado', 'ES', true, true, NOW())
  ON CONFLICT (provider_id, commercial_name) DO NOTHING;

END $$;
