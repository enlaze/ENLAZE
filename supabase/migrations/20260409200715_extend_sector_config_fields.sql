
-- Add new JSONB columns for service types, budget categories, agent prompts, and default prices
ALTER TABLE sector_config
  ADD COLUMN IF NOT EXISTS service_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS agent_prompt TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_prices JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS subcategories JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ═══════ CONSTRUCCION ═══════
UPDATE sector_config SET
  service_types = '[
    {"value":"reforma","label":"Reforma integral"},
    {"value":"fontaneria","label":"Fontanería"},
    {"value":"electricidad","label":"Electricidad"},
    {"value":"climatizacion","label":"Climatización"},
    {"value":"multiservicios","label":"Multiservicios"},
    {"value":"general","label":"General"}
  ]'::jsonb,
  budget_categories = '[
    {"value":"material","label":"Material"},
    {"value":"mano_obra","label":"Mano de obra"},
    {"value":"otros","label":"Otros"}
  ]'::jsonb,
  subcategories = '{
    "material": ["Albañilería","Fontanería","Electricidad","Pintura","Carpintería","Climatización","Cristalería","Cerrajería","Impermeabilización","Otros"],
    "mano_obra": ["Oficial 1ª","Oficial 2ª","Peón","Especialista","Subcontrata","Otros"]
  }'::jsonb,
  default_prices = '[
    {"name":"Azulejo porcelánico m²","category":"material","subcategory":"Albañilería","unit":"m²","price":22.50},
    {"name":"Cemento cola flexible 25kg","category":"material","subcategory":"Albañilería","unit":"ud","price":8.90},
    {"name":"Lechada epoxi","category":"material","subcategory":"Albañilería","unit":"ud","price":14.50},
    {"name":"Plato ducha resina 120x80","category":"material","subcategory":"Fontanería","unit":"ud","price":185.00},
    {"name":"Mampara cristal 8mm","category":"material","subcategory":"Fontanería","unit":"ud","price":320.00},
    {"name":"Grifo monomando lavabo","category":"material","subcategory":"Fontanería","unit":"ud","price":65.00},
    {"name":"Tubería multicapa 20mm (ml)","category":"material","subcategory":"Fontanería","unit":"m","price":3.20},
    {"name":"Cable libre halógenos 2.5mm (100m)","category":"material","subcategory":"Electricidad","unit":"ud","price":42.00},
    {"name":"Mecanismo Schuko empotrable","category":"material","subcategory":"Electricidad","unit":"ud","price":8.50},
    {"name":"Downlight LED 18W empotrable","category":"material","subcategory":"Electricidad","unit":"ud","price":12.90},
    {"name":"Diferencial 40A 30mA","category":"material","subcategory":"Electricidad","unit":"ud","price":35.00},
    {"name":"Pintura plástica mate 15L","category":"material","subcategory":"Pintura","unit":"ud","price":45.00},
    {"name":"Lámina impermeabilizante m²","category":"material","subcategory":"Impermeabilización","unit":"m²","price":9.80},
    {"name":"Oficial albañilería (h)","category":"mano_obra","subcategory":"Oficial 1ª","unit":"h","price":28.00},
    {"name":"Oficial fontanero (h)","category":"mano_obra","subcategory":"Oficial 1ª","unit":"h","price":32.00},
    {"name":"Oficial electricista (h)","category":"mano_obra","subcategory":"Oficial 1ª","unit":"h","price":30.00},
    {"name":"Oficial pintor (h)","category":"mano_obra","subcategory":"Oficial 1ª","unit":"h","price":25.00}
  ]'::jsonb,
  agent_prompt = 'Eres un asistente experto en construcción y reformas en España. Generas presupuestos detallados con partidas de material y mano de obra para reformas integrales, parciales, obra nueva y rehabilitación. Conoces los precios de mercado en España para materiales de albañilería, fontanería, electricidad, pintura, carpintería, climatización, cerrajería e impermeabilización. Siempre desglosas en categorías: Material y Mano de obra. Incluyes unidades estándar del sector (m², m, ud, kg, h, ml). Los precios deben ser realistas para el mercado español actual.'
WHERE sector_key = 'construccion';

-- ═══════ SERVICIOS PROFESIONALES ═══════
UPDATE sector_config SET
  service_types = '[
    {"value":"consultoria","label":"Consultoría"},
    {"value":"asesoria","label":"Asesoría"},
    {"value":"diseno","label":"Diseño"},
    {"value":"desarrollo","label":"Desarrollo"},
    {"value":"formacion","label":"Formación"},
    {"value":"marketing","label":"Marketing digital"},
    {"value":"general","label":"General"}
  ]'::jsonb,
  budget_categories = '[
    {"value":"servicio","label":"Servicio"},
    {"value":"horas","label":"Horas profesionales"},
    {"value":"licencias","label":"Licencias / Software"},
    {"value":"otros","label":"Otros"}
  ]'::jsonb,
  subcategories = '{
    "servicio": ["Consultoría","Asesoría fiscal","Asesoría laboral","Diseño gráfico","Diseño web","Desarrollo web","Marketing","SEO/SEM","Redes sociales","Formación","Traducción","Legal","Otros"],
    "horas": ["Junior","Senior","Director","Especialista","Freelance","Otros"],
    "licencias": ["Software","Hosting","Dominio","Herramientas","Suscripciones","Otros"]
  }'::jsonb,
  default_prices = '[
    {"name":"Hora consultoría senior","category":"horas","subcategory":"Senior","unit":"h","price":75.00},
    {"name":"Hora consultoría junior","category":"horas","subcategory":"Junior","unit":"h","price":40.00},
    {"name":"Hora dirección de proyecto","category":"horas","subcategory":"Director","unit":"h","price":95.00},
    {"name":"Sesión formación (2h)","category":"servicio","subcategory":"Formación","unit":"sesión","price":150.00},
    {"name":"Diseño logotipo","category":"servicio","subcategory":"Diseño gráfico","unit":"ud","price":350.00},
    {"name":"Diseño identidad corporativa","category":"servicio","subcategory":"Diseño gráfico","unit":"ud","price":800.00},
    {"name":"Página web corporativa","category":"servicio","subcategory":"Diseño web","unit":"ud","price":1500.00},
    {"name":"Landing page","category":"servicio","subcategory":"Diseño web","unit":"ud","price":500.00},
    {"name":"Gestión redes sociales (mes)","category":"servicio","subcategory":"Redes sociales","unit":"mes","price":300.00},
    {"name":"Campaña Google Ads (mes)","category":"servicio","subcategory":"SEO/SEM","unit":"mes","price":250.00},
    {"name":"Asesoría fiscal trimestral","category":"servicio","subcategory":"Asesoría fiscal","unit":"ud","price":120.00},
    {"name":"Hosting anual","category":"licencias","subcategory":"Hosting","unit":"ud","price":80.00},
    {"name":"Dominio .es (año)","category":"licencias","subcategory":"Dominio","unit":"ud","price":12.00}
  ]'::jsonb,
  agent_prompt = 'Eres un asistente experto en servicios profesionales en España. Generas propuestas y presupuestos detallados para consultoría, asesoría, diseño, desarrollo web, marketing digital y formación. Conoces las tarifas de mercado en España para profesionales junior, senior y directores de proyecto. Desglosas en: Servicios, Horas profesionales y Licencias/Software. Incluyes unidades como horas (h), sesiones, meses y unidades. Los precios deben ser competitivos para el mercado español de servicios profesionales.'
WHERE sector_key = 'servicios';

-- ═══════ COMERCIO / RETAIL ═══════
UPDATE sector_config SET
  service_types = '[
    {"value":"venta_directa","label":"Venta directa"},
    {"value":"distribucion","label":"Distribución"},
    {"value":"importacion","label":"Importación"},
    {"value":"ecommerce","label":"E-commerce"},
    {"value":"mayorista","label":"Mayorista"},
    {"value":"general","label":"General"}
  ]'::jsonb,
  budget_categories = '[
    {"value":"producto","label":"Producto"},
    {"value":"logistica","label":"Logística"},
    {"value":"packaging","label":"Packaging"},
    {"value":"otros","label":"Otros"}
  ]'::jsonb,
  subcategories = '{
    "producto": ["Alimentación","Electrónica","Textil","Hogar","Belleza","Deportes","Papelería","Ferretería","Juguetes","Otros"],
    "logistica": ["Transporte nacional","Transporte internacional","Almacenaje","Picking","Última milla","Otros"],
    "packaging": ["Cajas","Embalaje","Etiquetado","Paletizado","Otros"]
  }'::jsonb,
  default_prices = '[
    {"name":"Envío nacional estándar","category":"logistica","subcategory":"Transporte nacional","unit":"ud","price":5.50},
    {"name":"Envío express 24h","category":"logistica","subcategory":"Transporte nacional","unit":"ud","price":8.90},
    {"name":"Envío internacional EU","category":"logistica","subcategory":"Transporte internacional","unit":"ud","price":12.00},
    {"name":"Almacenaje palet (mes)","category":"logistica","subcategory":"Almacenaje","unit":"palet","price":25.00},
    {"name":"Caja cartón 40x30x20","category":"packaging","subcategory":"Cajas","unit":"ud","price":0.85},
    {"name":"Sobre acolchado","category":"packaging","subcategory":"Embalaje","unit":"ud","price":0.35},
    {"name":"Etiquetas adhesivas (rollo 500)","category":"packaging","subcategory":"Etiquetado","unit":"ud","price":12.00},
    {"name":"Film estirable (rollo)","category":"packaging","subcategory":"Embalaje","unit":"ud","price":6.50}
  ]'::jsonb,
  agent_prompt = 'Eres un asistente experto en comercio y retail en España. Generas presupuestos y propuestas para operaciones de venta, distribución, importación y e-commerce. Conoces los costes logísticos, de packaging y márgenes comerciales típicos del mercado español. Desglosas en: Producto, Logística y Packaging. Incluyes unidades como unidades (ud), cajas, palets, kg. Los precios deben reflejar el mercado español actual.'
WHERE sector_key = 'comercio';

-- ═══════ INSTALACIONES / MANTENIMIENTO ═══════
UPDATE sector_config SET
  service_types = '[
    {"value":"instalacion_nueva","label":"Instalación nueva"},
    {"value":"mantenimiento_preventivo","label":"Mantenimiento preventivo"},
    {"value":"mantenimiento_correctivo","label":"Mantenimiento correctivo"},
    {"value":"reparacion","label":"Reparación"},
    {"value":"certificacion","label":"Certificación"},
    {"value":"general","label":"General"}
  ]'::jsonb,
  budget_categories = '[
    {"value":"material","label":"Material"},
    {"value":"mano_obra","label":"Mano de obra"},
    {"value":"equipos","label":"Equipos"},
    {"value":"otros","label":"Otros"}
  ]'::jsonb,
  subcategories = '{
    "material": ["Climatización","Electricidad","Fontanería","Gas","Telecomunicaciones","Seguridad","Energía solar","Domótica","Contraincendios","Otros"],
    "mano_obra": ["Técnico instalador","Oficial 1ª","Oficial 2ª","Ayudante","Ingeniero","Otros"],
    "equipos": ["Aire acondicionado","Caldera","Bomba de calor","Paneles solares","Cuadro eléctrico","Grupo electrógeno","Otros"]
  }'::jsonb,
  default_prices = '[
    {"name":"Split aire acondicionado 3000fg","category":"equipos","subcategory":"Aire acondicionado","unit":"ud","price":650.00},
    {"name":"Caldera condensación 24kW","category":"equipos","subcategory":"Caldera","unit":"ud","price":1200.00},
    {"name":"Bomba de calor ACS","category":"equipos","subcategory":"Bomba de calor","unit":"ud","price":1800.00},
    {"name":"Panel solar fotovoltaico 450W","category":"equipos","subcategory":"Paneles solares","unit":"ud","price":180.00},
    {"name":"Inversor solar 5kW","category":"equipos","subcategory":"Paneles solares","unit":"ud","price":950.00},
    {"name":"Tubo cobre 22mm (m)","category":"material","subcategory":"Climatización","unit":"m","price":8.50},
    {"name":"Cable RZ1-K 3x2.5mm (m)","category":"material","subcategory":"Electricidad","unit":"m","price":2.80},
    {"name":"Cuadro eléctrico 12 módulos","category":"equipos","subcategory":"Cuadro eléctrico","unit":"ud","price":85.00},
    {"name":"Detector de humos","category":"material","subcategory":"Contraincendios","unit":"ud","price":18.00},
    {"name":"Técnico instalador (h)","category":"mano_obra","subcategory":"Técnico instalador","unit":"h","price":35.00},
    {"name":"Oficial electricista (h)","category":"mano_obra","subcategory":"Oficial 1ª","unit":"h","price":30.00},
    {"name":"Ingeniero certificador (h)","category":"mano_obra","subcategory":"Ingeniero","unit":"h","price":55.00}
  ]'::jsonb,
  agent_prompt = 'Eres un asistente experto en instalaciones y mantenimiento en España. Generas presupuestos detallados para instalaciones de climatización, electricidad, fontanería, gas, telecomunicaciones, energía solar, domótica y seguridad. Conoces precios de equipos y materiales del mercado español. Desglosas en: Material, Mano de obra y Equipos. Incluyes garantías y certificaciones cuando aplica. Los precios deben ser realistas para el mercado español de instalaciones.'
WHERE sector_key = 'instalaciones';
