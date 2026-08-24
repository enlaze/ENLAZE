-- Fase 2 · 6/8 · Seed del catálogo inicial: pintura y residuos.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 6.
--
-- 20 conceptos: 5 partidas de pintura, 8 materiales de pintura, 6 de residuos y 1 de
-- protecciones. Cubren las 5 partidas de pintura y los 4 emisores de residuos de
-- lib/budget-engine.ts, los 2 literales del emisor de protecciones (:691), más las 8
-- MATERIAL_SPECS de pintura y el servicio de contenedor.
--
-- Los alias exactos con source='engine' son los literales EXACTOS que emite hoy
-- budget-engine.ts. Sin ellos la cobertura del backfill sería cero.
--
-- alias_norm NO se inserta: es columna generada por canonical_normalize().
--
-- Idempotente: on conflict do nothing en las tres tablas.
--
-- Depende de: 20260824095335 .. 20260824112605

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONCEPTOS
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.canonical_concepts
  (canonical_id, kind, domain, family, concept, variant,
   display_name_es, definition_es, default_unit,
   default_price_type, allowed_price_types)
values
  -- ── Pintura · obra ──────────────────────────────────────────────────────────
  ('WORK.PAINT.PREP.MASKING', 'WORK', 'PAINT', 'PREP', 'MASKING', null,
   'Protección de superficies y mobiliario',
   'Enmascarado de suelos, carpinterías, mobiliario y elementos conservados antes de pintar.',
   'PA', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL']),

  ('WORK.PAINT.PREP.SURFACE', 'WORK', 'PAINT', 'PREP', 'SURFACE', null,
   'Preparación y reparación de paramentos',
   'Lijado, sellado de fisuras y masillado puntual de paredes y techos previo a la pintura.',
   'm2', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL']),

  ('WORK.PAINT.PRIMER.APPLY', 'WORK', 'PAINT', 'PRIMER', 'APPLY', null,
   'Imprimación de paredes y techos',
   'Aplicación de imprimación o fondo fijador compatible según la absorción del soporte.',
   'm2', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL']),

  ('WORK.PAINT.EMULSION.WALL.2COATS', 'WORK', 'PAINT', 'EMULSION', 'WALL', '2COATS',
   'Pintura plástica en paredes, dos manos',
   'Aplicación de dos manos de pintura plástica lavable sobre paramentos verticales interiores.',
   'm2', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL']),

  ('WORK.PAINT.EMULSION.CEILING.2COATS', 'WORK', 'PAINT', 'EMULSION', 'CEILING', '2COATS',
   'Pintura plástica en techos, dos manos',
   'Aplicación de dos manos de pintura transpirable sobre paramentos horizontales interiores.',
   'm2', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL']),

  -- ── Pintura · materiales ────────────────────────────────────────────────────
  -- El formato de envase NO forma parte de la identidad canónica: vive en pb_products.
  ('MAT.PAINT.EMULSION.INTERIOR_MATT', 'MAT', 'PAINT', 'EMULSION', 'INTERIOR_MATT', null,
   'Pintura plástica mate interior',
   'Pintura plástica lavable de acabado mate para interiores, cualquier formato de envase.',
   'l', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.PRIMER.ACRYLIC', 'MAT', 'PAINT', 'PRIMER', 'ACRYLIC', null,
   'Imprimación / fondo fijador acrílico',
   'Fondo fijador acrílico al agua para sellado y regulación de absorción del soporte.',
   'l', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.FILLER.POWDER', 'MAT', 'PAINT', 'FILLER', 'POWDER', null,
   'Plaste en polvo para renovación',
   'Plaste o masilla en polvo para reparación y alisado de paramentos antes de pintar.',
   'kg', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.MASKING.TAPE', 'MAT', 'PAINT', 'MASKING', 'TAPE', null,
   'Cinta de enmascarar',
   'Cinta adhesiva de pintor para delimitar y proteger cantos y carpinterías.',
   'ud', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.MASKING.FILM', 'MAT', 'PAINT', 'MASKING', 'FILM', null,
   'Plástico cubretodo protector',
   'Film plástico de protección de suelos, mobiliario y superficies conservadas.',
   'ud', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.TOOL.ROLLER', 'MAT', 'PAINT', 'TOOL', 'ROLLER', null,
   'Rodillo de pintura',
   'Rodillo de aplicación de pintura, cualquier ancho y tipo de fibra.',
   'ud', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.TOOL.BRUSH', 'MAT', 'PAINT', 'TOOL', 'BRUSH', null,
   'Brocha de pintura',
   'Brocha de aplicación y repaso de pintura, cualquier tamaño y tipo de fibra.',
   'ud', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  ('MAT.PAINT.TOOL.TRAY', 'MAT', 'PAINT', 'TOOL', 'TRAY', null,
   'Cubeta de pintura con rejilla',
   'Cubeta de carga y escurrido de rodillo, cualquier capacidad.',
   'ud', 'MATERIAL_ONLY', ARRAY['MATERIAL_ONLY']),

  -- ── Residuos ────────────────────────────────────────────────────────────────
  ('WORK.WASTE.MANAGEMENT.FULL', 'WORK', 'WASTE', 'MANAGEMENT', 'FULL', null,
   'Gestión integral de residuos',
   'Concepto agregado que engloba contenedor, transporte a gestor autorizado y tasas de vertido.',
   'ud', 'LABOR_AND_MATERIAL', ARRAY['LABOR_AND_MATERIAL','SERVICE']),

  ('WORK.WASTE.CONTAINER.HAUL', 'WORK', 'WASTE', 'CONTAINER', 'HAUL', null,
   'Contenedor y transporte a gestor autorizado',
   'Partida facturable al cliente por contenedor, carga, retirada y transporte a gestor autorizado.',
   'ud', 'SERVICE', ARRAY['SERVICE','LABOR_AND_MATERIAL']),

  ('WORK.WASTE.CONTAINER.HAUL.6M3', 'WORK', 'WASTE', 'CONTAINER', 'HAUL', '6M3',
   'Contenedor 6 m³ y transporte a gestor',
   'Variante dimensional de 6 m³ de la partida de contenedor y transporte.',
   'ud', 'SERVICE', ARRAY['SERVICE','LABOR_AND_MATERIAL']),

  ('WORK.WASTE.FEE.DISPOSAL', 'WORK', 'WASTE', 'FEE', 'DISPOSAL', null,
   'Tasas, pesaje y justificantes de vertido',
   'Tasas de gestor autorizado, pesaje y emisión de justificantes documentales de entrega.',
   'PA', 'SERVICE', ARRAY['SERVICE']),

  ('SRV.WASTE.CONTAINER.HAUL', 'SRV', 'WASTE', 'CONTAINER', 'HAUL', null,
   'Servicio de contenedor y retirada',
   'Servicio comprado a un gestor externo: alquiler de contenedor, transporte y retirada.',
   'ud', 'SERVICE', ARRAY['SERVICE']),

  ('SRV.WASTE.CONTAINER.HAUL.6M3', 'SRV', 'WASTE', 'CONTAINER', 'HAUL', '6M3',
   'Servicio de contenedor de escombros 6 m³',
   'Variante de 6 m³ del servicio de contenedor comprado a gestor autorizado.',
   'ud', 'SERVICE', ARRAY['SERVICE']),

  -- ── Protecciones ────────────────────────────────────────────────────────────
  ('WORK.PROTECT.SITE.COVERING', 'WORK', 'PROTECT', 'SITE', 'COVERING', null,
   'Protección de zonas conservadas',
   'Protección de suelos, mobiliario y elementos que permanecen durante la ejecución de la obra.',
   'PA', 'LABOR_AND_MATERIAL', ARRAY['LABOR_ONLY','LABOR_AND_MATERIAL'])

on conflict (canonical_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALIAS EXACTOS · source='engine' · literales textuales de lib/budget-engine.ts
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.canonical_aliases
  (canonical_id, alias_kind, source, source_ref, company_id, alias_value, confidence)
values
  -- Partidas de pintura (budget-engine.ts:746-750)
  ('WORK.PAINT.PREP.MASKING',            'exact', 'engine', null, null, 'Protección de superficies y mobiliario', 1.00),
  ('WORK.PAINT.PREP.SURFACE',            'exact', 'engine', null, null, 'Preparación y reparación de paredes',    1.00),
  ('WORK.PAINT.PRIMER.APPLY',            'exact', 'engine', null, null, 'Imprimación de paredes y techos',        1.00),
  ('WORK.PAINT.EMULSION.WALL.2COATS',    'exact', 'engine', null, null, 'Pintura plástica en paredes',            1.00),
  ('WORK.PAINT.EMULSION.CEILING.2COATS', 'exact', 'engine', null, null, 'Pintura de techos',                      1.00),

  -- Los cuatro emisores de residuos. :696 y :779 comparten canonical_id: ES el duplicado
  -- que Fase 2 debe detectar (6 ud × 717,50 = 4.305,02 € en el presupuesto 55082c1b).
  ('WORK.WASTE.MANAGEMENT.FULL',   'exact', 'engine', null, null, 'Gestion de residuos y contenedores',          1.00),
  ('WORK.WASTE.CONTAINER.HAUL',    'exact', 'engine', null, null, 'Contenedor y transporte a gestor autorizado', 1.00),
  ('WORK.WASTE.CONTAINER.HAUL',    'exact', 'engine', null, null, 'Contenedores y transporte',                   1.00),
  ('WORK.WASTE.FEE.DISPOSAL',      'exact', 'engine', null, null, 'Tasas y documentación de residuos',           1.00),
  ('SRV.WASTE.CONTAINER.HAUL.6M3', 'exact', 'engine', null, null, 'Servicio de contenedor de escombros 6 m3',    1.00),

  -- MATERIAL_SPECS de pintura (budget-engine.ts:915-922)
  ('MAT.PAINT.EMULSION.INTERIOR_MATT', 'exact', 'engine', null, null, 'Pintura plástica blanca mate interior 15 L',        1.00),
  ('MAT.PAINT.PRIMER.ACRYLIC',         'exact', 'engine', null, null, 'Fondo fijador acrílico 15 L blanco',               1.00),
  ('MAT.PAINT.FILLER.POWDER',          'exact', 'engine', null, null, 'Plaste en polvo capa gruesa renovación 2h 15 kg',  1.00),
  ('MAT.PAINT.MASKING.TAPE',           'exact', 'engine', null, null, 'Cinta de pintor exterior 50 mm 50 m',              1.00),
  ('MAT.PAINT.MASKING.FILM',           'exact', 'engine', null, null, 'Plástico cubretodo fino reciclado 4x5 m',          1.00),
  ('MAT.PAINT.TOOL.ROLLER',            'exact', 'engine', null, null, 'Rodillo superficies lisas microfibra seda 22 cm',  1.00),
  ('MAT.PAINT.TOOL.BRUSH',             'exact', 'engine', null, null, 'Brocha prensada fibra sintética nº10',             1.00),
  ('MAT.PAINT.TOOL.TRAY',              'exact', 'engine', null, null, 'Cubeta de plástico 16 L con rejilla',              1.00),

  -- Protecciones (budget-engine.ts:691). El emisor es un ternario sobre isExistingBuilding:
  -- los DOS literales son alcanzables y ambos designan el mismo concepto canónico.
  ('WORK.PROTECT.SITE.COVERING', 'exact', 'engine', null, null, 'Protección de elementos que se conservan', 1.00),
  ('WORK.PROTECT.SITE.COVERING', 'exact', 'engine', null, null, 'Implantación y protecciones de obra',      1.00)
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALIAS EXACTOS · source='curated' · vocabulario base de Enlaze
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.canonical_aliases
  (canonical_id, alias_kind, source, source_ref, company_id, alias_value, confidence)
values
  ('WORK.PAINT.EMULSION.WALL.2COATS', 'exact', 'curated', null, null, 'Pintura plástica lavable en paredes',        1.00),
  ('WORK.PAINT.EMULSION.WALL.2COATS', 'exact', 'curated', null, null, 'Pintura interior de paramentos verticales',  1.00),
  ('WORK.PAINT.EMULSION.WALL.2COATS', 'exact', 'curated', null, null, 'Aplicación de pintura lavable, dos manos',   1.00),
  ('WORK.PAINT.EMULSION.CEILING.2COATS', 'exact', 'curated', null, null, 'Pintura interior de paramentos horizontales', 1.00),
  ('WORK.WASTE.CONTAINER.HAUL.6M3', 'exact', 'curated', null, null, 'Contenedor de escombros 6m3 (alquiler+transporte)', 1.00),
  ('WORK.PROTECT.SITE.COVERING',    'exact', 'curated', null, null, 'Protección de zonas conservadas',             1.00)
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SINÓNIMOS · confianza reescalada a [0.50, 0.85)
--   0.80 = coincidencia fuerte del matcher (score crudo 0.95)
--   0.70 = coincidencia por substring     (score crudo 0.88)
-- Los scores crudos de lib/normalized-concepts.ts son puntuaciones del matcher, NO
-- confidences persistibles: la franja [0.85, 1.00) está vacía por diseño.
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.canonical_aliases
  (canonical_id, alias_kind, source, source_ref, company_id, alias_value, confidence)
values
  ('MAT.PAINT.EMULSION.INTERIOR_MATT', 'synonym', 'curated', null, null, 'Pintura plastica blanca mate (cubo 15L)', 0.80),
  ('MAT.PAINT.EMULSION.INTERIOR_MATT', 'synonym', 'curated', null, null, 'Pintura plástica interior',               0.70),
  ('MAT.PAINT.PRIMER.ACRYLIC',         'synonym', 'curated', null, null, 'Imprimacion fijadora (cubo 15L)',         0.80),
  ('MAT.PAINT.PRIMER.ACRYLIC',         'synonym', 'curated', null, null, 'Imprimación fijadora',                    0.70),
  ('MAT.PAINT.FILLER.POWDER',          'synonym', 'curated', null, null, 'Masilla de reparacion interior (saco 15kg)', 0.80),

  -- AMBIGÜEDAD DELIBERADA. Este literal designa a la vez la cinta y el film, con precios
  -- de 0,37 € y 38,40 € en producción. El resolver debe devolver 'ambiguous' y dejar
  -- canonical_id a NULL, nunca elegir. Es el caso que valida la regla del diseño.
  ('MAT.PAINT.MASKING.TAPE', 'synonym', 'curated', null, null, 'Cinta de enmascarar y plastico protector', 0.70),
  ('MAT.PAINT.MASKING.FILM', 'synonym', 'curated', null, null, 'Cinta de enmascarar y plastico protector', 0.70),

  ('WORK.WASTE.CONTAINER.HAUL', 'synonym', 'curated', null, null, 'Retirada de escombros',        0.70),
  ('WORK.WASTE.CONTAINER.HAUL', 'synonym', 'curated', null, null, 'Contenedor de obra',           0.70),
  ('WORK.WASTE.FEE.DISPOSAL',   'synonym', 'curated', null, null, 'Canon de vertido',             0.80),
  ('WORK.PROTECT.SITE.COVERING','synonym', 'curated', null, null, 'Protección de suelos y mobiliario', 0.70)
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RELACIONES
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.canonical_concept_relations
  (from_canonical, to_canonical, relation_type, note_es)
values
  -- El servicio comprado materializa la partida facturada. Mismo hecho físico, dos lados
  -- del margen: 290 € al gestor, 348 € al cliente. No se funden: se relacionan.
  ('SRV.WASTE.CONTAINER.HAUL.6M3', 'WORK.WASTE.CONTAINER.HAUL.6M3', 'provides',
   'technical_price_items 14.001: 290,00 × 1,20 = 348,00'),
  ('SRV.WASTE.CONTAINER.HAUL',     'WORK.WASTE.CONTAINER.HAUL',     'provides', null),

  ('WORK.WASTE.CONTAINER.HAUL.6M3', 'WORK.WASTE.CONTAINER.HAUL', 'variant_of', null),
  ('SRV.WASTE.CONTAINER.HAUL.6M3',  'SRV.WASTE.CONTAINER.HAUL',  'variant_of', null),

  -- El concepto agregado absorbe a sus componentes: base de OVERLAPPING_CANONICAL_SCOPE.
  ('WORK.WASTE.MANAGEMENT.FULL', 'WORK.WASTE.CONTAINER.HAUL', 'includes', null),
  ('WORK.WASTE.MANAGEMENT.FULL', 'WORK.WASTE.FEE.DISPOSAL',   'includes', null),

  -- Base de MATERIAL_DOUBLE_IMPUTATION. Solo es error si la partida se presupuestó con
  -- price_type LABOR_AND_MATERIAL o SERVICE; con LABOR_ONLY el material es complemento
  -- legítimo, no duplicado.
  ('WORK.PAINT.EMULSION.WALL.2COATS',    'MAT.PAINT.EMULSION.INTERIOR_MATT', 'includes', null),
  ('WORK.PAINT.EMULSION.CEILING.2COATS', 'MAT.PAINT.EMULSION.INTERIOR_MATT', 'includes', null),
  ('WORK.PAINT.PRIMER.APPLY',            'MAT.PAINT.PRIMER.ACRYLIC',         'includes', null),
  ('WORK.PAINT.PREP.SURFACE',            'MAT.PAINT.FILLER.POWDER',          'includes', null),
  ('WORK.PAINT.PREP.MASKING',            'MAT.PAINT.MASKING.TAPE',           'includes', null),
  ('WORK.PAINT.PREP.MASKING',            'MAT.PAINT.MASKING.FILM',           'includes', null)
on conflict (from_canonical, to_canonical, relation_type) do nothing;

commit;
