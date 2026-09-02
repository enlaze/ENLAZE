-- ============================================================================
-- SEED: Banco tecnico ENLAZE base — Capitulos + Partidas iniciales
-- 2026-05-26
--
-- source       = 'enlaze_base'   (NO cype, NO ive)
-- region       = 'espana'        (precios de referencia generales)
-- quality_tier = 'media'         (gama media, referencia prudente)
--
-- Estos precios vienen de la INTERNAL_PRICE_DB existente en price-resolver.ts
-- y son estimaciones de mercado 2024-2026 para coste de contratista (sin margen).
-- Confianza media: no son precios verificados de un banco oficial.
--
-- Los descompuestos se omiten intencionadamente en este seed.
-- Se cargaran cuando importemos un BC3 real de fuente autorizada.
--
-- IDEMPOTENTE: puede ejecutarse multiples veces sin duplicar datos.
-- Usa ON CONFLICT DO NOTHING en todos los INSERT y subqueries para chapter_id.
-- ============================================================================


-- ──────────────────────────────────────────────────────────────────────────
-- CAPITULOS (15 capitulos principales de construccion residencial)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('01', 'Albanileria y tabiqueria',
   'Trabajos de albanileria, tabiqueria de ladrillo y placa de yeso laminado, trasdosados y cerramientos interiores.',
   1, 1, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('02', 'Fontaneria y saneamiento',
   'Instalaciones de agua fria, agua caliente, evacuacion, aparatos sanitarios basicos y accesorios de fontaneria.',
   1, 2, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('03', 'Electricidad e iluminacion',
   'Instalacion electrica interior, cuadros de proteccion, mecanismos, puntos de luz y tomas de corriente.',
   1, 3, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('04', 'Revestimientos',
   'Alicatados, chapados, revestimientos ceramicos de pared, enfoscados y guarnecidos.',
   1, 4, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('05', 'Pavimentos y solados',
   'Solados ceramicos, laminados, vinilicos, rodapies y nivelaciones de suelo.',
   1, 5, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('06', 'Pintura y acabados',
   'Pintura plastica, esmaltes, imprimaciones, barnices y tratamientos decorativos de superficies.',
   1, 6, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('07', 'Sanitarios y griferia',
   'Aparatos sanitarios, griferias, accesorios de bano, duchas y baneras.',
   1, 7, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('08', 'Carpinteria interior',
   'Puertas de paso, armarios empotrados, molduras y rodapies de madera.',
   1, 8, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('09', 'Carpinteria exterior y cerrajeria',
   'Ventanas, puertas exteriores, persianas, rejas, acristalamientos y elementos de fachada.',
   1, 9, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('10', 'Impermeabilizacion y aislamientos',
   'Laminas impermeabilizantes, aislamientos termicos y acusticos, barreras de vapor.',
   1, 10, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('11', 'Cocina',
   'Mobiliario de cocina, encimeras, electrodomesticos de obra y conexiones.',
   1, 11, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('12', 'Climatizacion',
   'Aire acondicionado, calefaccion, suelo radiante, ventilacion mecanica.',
   1, 12, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('13', 'Falsos techos',
   'Techos de placa de yeso laminado, techos registrables, techos decorativos.',
   1, 13, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('14', 'Gestion de residuos',
   'Contenedores de escombros, transporte a vertedero, gestion de residuos de obra.',
   1, 14, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;

INSERT INTO technical_chapters (code, name, description, level, sort_order, source, region)
VALUES
  ('15', 'Seguridad y salud',
   'Elementos de seguridad y salud en obra, protecciones colectivas e individuales.',
   1, 15, 'enlaze_base', 'espana')
ON CONFLICT (code, source, region) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────────
-- PARTIDAS TECNICAS
-- Precios = coste directo para contratista, SIN margen, calidad media.
-- Fuente = estimacion mercado Espana 2024-2026, confianza media.
-- Sin descompuestos (se cargaran con BC3 real).
--
-- chapter_id se resuelve con subquery directa (code + source + region + LIMIT 1).
-- ──────────────────────────────────────────────────────────────────────────

-- 01 ALBANILERIA
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '01' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '01.001', 'Mortero de cemento M-7.5 saco 25 kg', 'saco', 3.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"mortero","cemento","albanileria","agarre"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '01' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '01.002', 'Placa de yeso laminado 13 mm estandar', 'ud', 5.80, 'media', 0.50, 'enlaze_base', 'espana',
   '{"pladur","yeso laminado","tabiqueria seca","trasdosado"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '01' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '01.003', 'Perfil metalico montante 48 mm para tabiqueria', 'ud', 3.20, 'media', 0.50, 'enlaze_base', 'espana',
   '{"perfil","montante","tabiqueria seca","estructura"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 02 FONTANERIA
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '02' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '02.001', 'Tuberia multicapa 16 mm rollo 50 m', 'rollo', 42.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"tuberia","multicapa","fontaneria","agua"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '02' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '02.002', 'Tuberia PVC evacuacion 110 mm barra 3 m', 'ud', 8.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"tuberia","pvc","evacuacion","saneamiento"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 03 ELECTRICIDAD
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '03' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '03.001', 'Cable H07V-K 2.5 mm2 rollo 100 m', 'rollo', 32.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"cable","electrico","manguera","cableado"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '03' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '03.002', 'Cuadro electrico vivienda con protecciones', 'ud', 220.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"cuadro","electrico","protecciones","diferencial","magnetotermico"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '03' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '03.003', 'Mecanismo electrico empotrado (enchufe o interruptor)', 'ud', 8.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"mecanismo","enchufe","interruptor","toma corriente"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 04 REVESTIMIENTOS
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '04' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '04.001', 'Azulejo porcelanico de pared formato medio', 'm2', 18.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"azulejo","porcelanico","revestimiento","pared","ceramica"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '04' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '04.002', 'Cemento cola para porcelanico saco 25 kg', 'saco', 12.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"cemento cola","adhesivo","porcelanico","colocacion"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 05 PAVIMENTOS
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '05' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '05.001', 'Pavimento ceramico o laminado calidad media', 'm2', 22.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"pavimento","ceramico","laminado","suelo","solado"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '05' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '05.002', 'Rodapie ceramico o laminado', 'ml', 4.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"rodapie","remate","suelo","zocalo"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 06 PINTURA
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '06' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '06.001', 'Pintura plastica blanca mate cubo 15 L', 'cubo', 35.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"pintura","plastica","blanca","mate","interior"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '06' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '06.002', 'Imprimacion fijadora cubo 15 L', 'cubo', 28.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"imprimacion","fijadora","selladora","preparacion"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 07 SANITARIOS
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.001', 'Inodoro compacto con tanque', 'ud', 155.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"inodoro","wc","sanitario","bano"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.002', 'Lavabo con monomando incluido', 'ud', 130.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"lavabo","monomando","bano","sanitario"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.003', 'Plato de ducha de resina', 'ud', 195.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"plato ducha","resina","bano","antideslizante"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.004', 'Mampara de ducha corredera', 'ud', 220.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"mampara","ducha","cristal","corredera"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.005', 'Griferia monomando lavabo', 'ud', 85.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"griferia","monomando","lavabo","bano"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '07' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '07.006', 'Silicona neutra sanitaria cartucho', 'ud', 5.50, 'media', 0.50, 'enlaze_base', 'espana',
   '{"silicona","sanitaria","sellado","junta"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 08 CARPINTERIA INTERIOR
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '08' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '08.001', 'Puerta interior lacada de paso', 'ud', 155.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"puerta","interior","lacada","paso","carpinteria"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 09 CARPINTERIA EXTERIOR
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '09' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '09.001', 'Ventana aluminio con rotura de puente termico', 'ud', 650.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"ventana","aluminio","rpt","carpinteria exterior","acristalamiento"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 10 IMPERMEABILIZACION
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '10' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '10.001', 'Lamina impermeabilizante rollo 20 m2', 'rollo', 42.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"lamina","impermeabilizante","cubierta","terraza","humedad"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 11 COCINA
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '11' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '11.001', 'Mobiliario de cocina completo instalado', 'pa', 5500.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"cocina","mobiliario","muebles","instalacion"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '11' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '11.002', 'Encimera de cocina instalada', 'pa', 1200.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"encimera","cocina","silestone","laminada","granito"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 12 CLIMATIZACION
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '12' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '12.001', 'Split aire acondicionado inverter instalado', 'ud', 1200.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"aire acondicionado","split","inverter","climatizacion","frio"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 13 FALSOS TECHOS
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '13' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '13.001', 'Falso techo de placa de yeso laminado', 'm2', 28.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"falso techo","pladur","yeso laminado","techo","registrable"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 14 RESIDUOS
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '14' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '14.001', 'Contenedor de escombros 6 m3 con transporte', 'ud', 290.00, 'media', 0.50, 'enlaze_base', 'espana',
   '{"contenedor","escombros","residuos","transporte","vertedero"}')
ON CONFLICT (item_code, source, region) DO NOTHING;

-- 15 SEGURIDAD (confianza 0.40 por ser estimacion sin referencia sectorial)
INSERT INTO technical_price_items (chapter_id, item_code, name, unit, unit_price, quality_tier, confidence_score, source, region, tags)
VALUES
  ((SELECT id FROM technical_chapters WHERE code = '15' AND source = 'enlaze_base' AND region = 'espana' LIMIT 1),
   '15.001', 'Partida alzada de seguridad y salud en obra menor', 'pa', 450.00, 'media', 0.40, 'enlaze_base', 'espana',
   '{"seguridad","salud","protecciones","epi","obra"}')
ON CONFLICT (item_code, source, region) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────────
-- REGISTRO DE IMPORTACION (idempotente: solo inserta si no existe ya)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO technical_import_logs (
  source, file_name, region, edition,
  chapters_created, items_created, components_created,
  status, finished_at, metadata
)
SELECT
  'enlaze_base',
  'seed_inicial_v1',
  'espana',
  '2026.1',
  15,
  28,
  0,
  'completed',
  now(),
  '{"type": "initial_seed", "based_on": "INTERNAL_PRICE_DB from price-resolver.ts", "confidence": "medium", "note": "Estimaciones mercado 2024-2026, sin descompuestos"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM technical_import_logs
  WHERE source = 'enlaze_base'
    AND file_name = 'seed_inicial_v1'
    AND region = 'espana'
);
