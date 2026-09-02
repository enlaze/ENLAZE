-- ============================================================================
-- SEED: Bancos de precios por sector - Espana 2026
-- Sectores: comercio, estetica, hosteleria, automocion, educacion
--
-- Precios en EUR sin IVA, referencia mercado espanol 2026
-- Cada sector tiene sus propios proveedores y productos
-- ============================================================================

DO $$
DECLARE
  -- ── Proveedores compartidos ──
  v_ref_id UUID;

  -- ── Comercio Local ──
  v_clo_makro_id UUID;
  v_clo_gadisa_id UUID;
  v_clo_mercadona_id UUID;

  -- ── Peluqueria / Estetica ──
  v_est_loreal_id UUID;
  v_est_schwarzkopf_id UUID;
  v_est_ref_id UUID;

  -- ── Hosteleria ──
  v_hos_makro_id UUID;
  v_hos_stalgast_id UUID;
  v_hos_ref_id UUID;

  -- ── Automocion ──
  v_aut_bosch_id UUID;
  v_aut_oscaro_id UUID;
  v_aut_ref_id UUID;

  -- ── Educacion ──
  v_edu_ref_id UUID;
  v_edu_oxford_id UUID;
BEGIN

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PROVEEDORES
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO pb_providers (name, legal_name, country, is_active, sector)
SELECT n, l, 'ES', true, s FROM (VALUES
  -- Comercio Local
  ('Referencia comercio ES', 'Referencia precios comercio', 'comercio_local'),
  ('Makro Cash & Carry', 'Makro Autoservicio Mayorista S.A.', 'comercio_local'),
  ('Gadisa', 'Gadisa Retail S.L.', 'comercio_local'),
  ('Mercadona proveedor', 'Hacendado / Mercadona S.A.', 'comercio_local'),
  -- Peluqueria / Estetica
  ('Referencia estetica ES', 'Referencia precios estetica', 'comercio_local'),
  ('L''Oreal Professionnel', 'L''Oreal Espana S.A.', 'comercio_local'),
  ('Schwarzkopf Professional', 'Henkel Iberica S.A.', 'comercio_local'),
  -- Hosteleria
  ('Referencia hosteleria ES', 'Referencia precios hosteleria', 'comercio_local'),
  ('Makro Hosteleria', 'Makro Autoservicio Mayorista S.A.', 'comercio_local'),
  ('Stalgast / Equipamiento', 'Stalgast Hosteleria S.L.', 'comercio_local'),
  -- Automocion
  ('Referencia automocion ES', 'Referencia precios automocion', 'comercio_local'),
  ('Bosch Car Service', 'Robert Bosch Espana S.L.U.', 'comercio_local'),
  ('Oscaro', 'Oscaro.es S.L.', 'comercio_local'),
  -- Educacion
  ('Referencia educacion ES', 'Referencia precios educacion', 'comercio_local'),
  ('Oxford University Press', 'Oxford University Press Espana S.A.', 'comercio_local')
) AS t(n, l, s)
WHERE NOT EXISTS (SELECT 1 FROM pb_providers WHERE name = t.n AND company_id IS NULL);

-- Obtener IDs
SELECT id INTO v_ref_id FROM pb_providers WHERE name = 'Referencia comercio ES' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_clo_makro_id FROM pb_providers WHERE name = 'Makro Cash & Carry' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_clo_gadisa_id FROM pb_providers WHERE name = 'Gadisa' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_clo_mercadona_id FROM pb_providers WHERE name = 'Mercadona proveedor' AND company_id IS NULL LIMIT 1;

SELECT id INTO v_est_ref_id FROM pb_providers WHERE name = 'Referencia estetica ES' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_est_loreal_id FROM pb_providers WHERE name = 'L''Oreal Professionnel' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_est_schwarzkopf_id FROM pb_providers WHERE name = 'Schwarzkopf Professional' AND company_id IS NULL LIMIT 1;

SELECT id INTO v_hos_ref_id FROM pb_providers WHERE name = 'Referencia hosteleria ES' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_hos_makro_id FROM pb_providers WHERE name = 'Makro Hosteleria' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_hos_stalgast_id FROM pb_providers WHERE name = 'Stalgast / Equipamiento' AND company_id IS NULL LIMIT 1;

SELECT id INTO v_aut_ref_id FROM pb_providers WHERE name = 'Referencia automocion ES' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_aut_bosch_id FROM pb_providers WHERE name = 'Bosch Car Service' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_aut_oscaro_id FROM pb_providers WHERE name = 'Oscaro' AND company_id IS NULL LIMIT 1;

SELECT id INTO v_edu_ref_id FROM pb_providers WHERE name = 'Referencia educacion ES' AND company_id IS NULL LIMIT 1;
SELECT id INTO v_edu_oxford_id FROM pb_providers WHERE name = 'Oxford University Press' AND company_id IS NULL LIMIT 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. COMERCIO LOCAL / RETAIL
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Alimentacion seca ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Aceite oliva virgen extra 5 L', 'ud', 28.50, 'producto', 'alimentacion', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Aceite oliva virgen extra 1 L', 'ud', 6.90, 'producto', 'alimentacion', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Aceite girasol 5 L', 'ud', 7.50, 'producto', 'alimentacion', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Arroz redondo saco 5 kg', 'ud', 5.80, 'producto', 'alimentacion', 'arroces', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Arroz basmati 1 kg', 'ud', 2.40, 'producto', 'alimentacion', 'arroces', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pasta espagueti 500 g', 'ud', 0.85, 'producto', 'alimentacion', 'pastas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pasta macarrones 500 g', 'ud', 0.80, 'producto', 'alimentacion', 'pastas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Harina trigo 1 kg', 'ud', 0.75, 'producto', 'alimentacion', 'harinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Azucar blanco 1 kg', 'ud', 0.95, 'producto', 'alimentacion', 'azucares', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Sal fina mesa 1 kg', 'ud', 0.45, 'producto', 'alimentacion', 'condimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Leche entera brick 1 L', 'ud', 0.89, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Leche semidesnatada brick 1 L', 'ud', 0.85, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Mantequilla 250 g', 'ud', 2.10, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Huevos camperos docena L', 'ud', 2.90, 'producto', 'alimentacion', 'huevos', 'comercio_local', 'ES', true, true, NOW()),
  (v_clo_makro_id, 'Tomate triturado lata 2.5 kg', 'ud', 2.20, 'producto', 'alimentacion', 'conservas', 'comercio_local', 'ES', true, true, NOW()),
  (v_clo_makro_id, 'Atun en aceite lata 900 g', 'ud', 6.50, 'producto', 'alimentacion', 'conservas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cafe molido natural 250 g', 'ud', 2.80, 'producto', 'alimentacion', 'cafes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cafe en grano mezcla 1 kg', 'ud', 9.50, 'producto', 'alimentacion', 'cafes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Te negro caja 25 bolsitas', 'ud', 1.60, 'producto', 'alimentacion', 'infusiones', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Galletas Maria paquete 800 g', 'ud', 1.50, 'producto', 'alimentacion', 'galletas', 'comercio_local', 'ES', true, true, NOW()),
  (v_clo_makro_id, 'Chocolate cobertura negro 2.5 kg', 'ud', 12.50, 'producto', 'alimentacion', 'chocolates', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Bebidas ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Agua mineral 1.5 L (pack 6)', 'ud', 1.80, 'producto', 'bebidas', 'aguas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Agua mineral 5 L', 'ud', 0.95, 'producto', 'bebidas', 'aguas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Refresco cola 2 L', 'ud', 1.60, 'producto', 'bebidas', 'refrescos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Refresco naranja 2 L', 'ud', 1.45, 'producto', 'bebidas', 'refrescos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cerveza lager pack 6x330 ml', 'ud', 3.50, 'producto', 'bebidas', 'cervezas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cerveza sin alcohol pack 6x330 ml', 'ud', 3.20, 'producto', 'bebidas', 'cervezas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Vino tinto crianza Rioja 75 cl', 'ud', 5.80, 'producto', 'bebidas', 'vinos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Vino blanco Rueda verdejo 75 cl', 'ud', 4.50, 'producto', 'bebidas', 'vinos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Zumo naranja 1 L', 'ud', 1.85, 'producto', 'bebidas', 'zumos', 'comercio_local', 'ES', true, true, NOW()),
  (v_clo_makro_id, 'Zumo multifrutas 1 L', 'ud', 1.50, 'producto', 'bebidas', 'zumos', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Limpieza y drogueria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Lejia 5 L', 'ud', 2.10, 'producto', 'limpieza', 'lejias', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lavavajillas mano 1 L', 'ud', 1.30, 'producto', 'limpieza', 'vajillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Detergente lavadora 40 lavados', 'ud', 7.50, 'producto', 'limpieza', 'detergentes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Suavizante ropa 2 L', 'ud', 2.80, 'producto', 'limpieza', 'detergentes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Fregasuelos 1.5 L', 'ud', 1.60, 'producto', 'limpieza', 'suelos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Papel higienico pack 12 rollos', 'ud', 3.50, 'producto', 'limpieza', 'papeles', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Papel cocina pack 3 rollos', 'ud', 2.20, 'producto', 'limpieza', 'papeles', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bolsas basura 30 L (15 uds)', 'ud', 1.10, 'producto', 'limpieza', 'bolsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Guantes latex desechables (100 uds)', 'ud', 5.50, 'producto', 'limpieza', 'guantes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Limpiacristales spray 750 ml', 'ud', 1.90, 'producto', 'limpieza', 'cristales', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Packaging y embalaje ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Bolsas plastico asa camiseta 30x40 (100 uds)', 'ud', 2.80, 'consumible', 'packaging', 'bolsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bolsas papel kraft con asa 22x27 (50 uds)', 'ud', 8.50, 'consumible', 'packaging', 'bolsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Film transparente alimentario 300 m', 'ud', 4.50, 'consumible', 'packaging', 'films', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Film estirable paletizar 500 mm', 'ud', 6.50, 'consumible', 'packaging', 'films', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Caja carton 40x30x25 cm (pack 10)', 'ud', 8.00, 'consumible', 'packaging', 'cajas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Precinto embalar transparente 66 m', 'ud', 1.50, 'consumible', 'packaging', 'precintos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Rollo etiquetas precio 26x16 mm (1500 uds)', 'ud', 1.80, 'consumible', 'packaging', 'etiquetas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Papel regalo bobina 70 cm x 100 m', 'ud', 15.00, 'consumible', 'packaging', 'papeles', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Dispensador precinto manual', 'ud', 8.50, 'consumible', 'packaging', 'herramientas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Etiquetadora manual 2 lineas', 'ud', 25.00, 'consumible', 'packaging', 'herramientas', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Equipamiento tienda ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Estanteria metalica 5 baldas 180x90x40 cm', 'ud', 55.00, 'equipamiento', 'mobiliario', 'estanterias', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Mostrador caja madera 150x60x90 cm', 'ud', 280.00, 'equipamiento', 'mobiliario', 'mostradores', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Expositor giratorio sobremesa 4 caras', 'ud', 35.00, 'equipamiento', 'mobiliario', 'expositores', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Vitrina refrigerada 120 cm', 'ud', 950.00, 'equipamiento', 'frio', 'vitrinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Frigorifico comercial 2 puertas', 'ud', 1200.00, 'equipamiento', 'frio', 'frigorificos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Congelador arcon 300 L', 'ud', 380.00, 'equipamiento', 'frio', 'congeladores', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bascula comercial digital 30 kg', 'ud', 85.00, 'equipamiento', 'electronica', 'basculas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'TPV tactil + cajon + impresora tickets', 'ud', 650.00, 'equipamiento', 'electronica', 'tpv', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Datafono contactless', 'ud', 0.00, 'equipamiento', 'electronica', 'cobro', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lector codigo barras USB', 'ud', 45.00, 'equipamiento', 'electronica', 'lectores', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Impresora etiquetas termica', 'ud', 120.00, 'equipamiento', 'electronica', 'impresoras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Rollo papel termico 80 mm (pack 10)', 'ud', 8.00, 'consumible', 'electronica', 'tickets', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Carrito compra supermercado 100 L', 'ud', 75.00, 'equipamiento', 'mobiliario', 'carritos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cesta compra plastico con asas', 'ud', 4.50, 'equipamiento', 'mobiliario', 'cestas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Rotulo luminoso LED fachada 100x30 cm', 'ud', 180.00, 'equipamiento', 'senaletica', 'rotulos', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Servicios comercio ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_ref_id, 'Alquiler local comercial 80 m2 (mensual)', 'mes', 800.00, 'servicio', 'alquileres', 'locales', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Seguro RC comercio (anual)', 'anual', 350.00, 'servicio', 'seguros', 'rc', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Gestoria contabilidad mensual', 'mes', 120.00, 'servicio', 'asesoria', 'contabilidad', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cuota autonomo base (mensual)', 'mes', 294.00, 'servicio', 'impuestos', 'autonomos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Empleado comercio salario bruto/hora', 'h', 9.50, 'servicio', 'personal', 'salarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Limpieza local 80 m2 (mensual)', 'mes', 250.00, 'servicio', 'mantenimiento', 'limpieza', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Alarma + videovigilancia (mensual)', 'mes', 35.00, 'servicio', 'seguridad', 'alarmas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Dominio web + hosting (anual)', 'anual', 60.00, 'servicio', 'digital', 'web', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Google Ads gestion mensual', 'mes', 200.00, 'servicio', 'marketing', 'publicidad', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Diseno grafico flyer A5 (1000 uds)', 'ud', 85.00, 'servicio', 'marketing', 'imprenta', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PELUQUERIA Y ESTETICA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Productos capilares ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_est_loreal_id, 'Champu profesional Serie Expert 1500 ml', 'ud', 18.90, 'producto', 'capilar', 'champus', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Acondicionador Serie Expert 1000 ml', 'ud', 22.50, 'producto', 'capilar', 'acondicionadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Mascarilla reparadora 500 ml', 'ud', 16.80, 'producto', 'capilar', 'mascarillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Tinte Majirel 50 ml', 'ud', 5.90, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Oxidante 30 vol 1000 ml', 'ud', 4.50, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Decolorante Blond Studio 500 g', 'ud', 16.00, 'producto', 'capilar', 'decoloracion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'Champu BC Bonacure Repair 1000 ml', 'ud', 15.50, 'producto', 'capilar', 'champus', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'Tinte Igora Royal 60 ml', 'ud', 5.50, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'Oxidante Igora 6% 1000 ml', 'ud', 4.20, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'Laca Silhouette fijacion fuerte 500 ml', 'ud', 8.90, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Espuma moldeadora 300 ml', 'ud', 5.50, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Cera mate 100 ml', 'ud', 7.80, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Aceite argon tratamiento 100 ml', 'ud', 9.50, 'producto', 'capilar', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Keratina liquida tratamiento 250 ml', 'ud', 14.00, 'producto', 'capilar', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Protector termico spray 250 ml', 'ud', 8.50, 'producto', 'capilar', 'proteccion', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Consumibles peluqueria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_est_ref_id, 'Papel aluminio meches 12 cm x 100 m', 'ud', 6.50, 'consumible', 'consumibles', 'aluminio', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Guantes nitrilo negro (100 uds)', 'ud', 7.50, 'consumible', 'consumibles', 'guantes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Capa corte desechable (100 uds)', 'ud', 12.00, 'consumible', 'consumibles', 'capas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Toallas desechables 40x80 cm (100 uds)', 'ud', 8.50, 'consumible', 'consumibles', 'toallas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Papel cuello protector rollo (100 uds)', 'ud', 2.80, 'consumible', 'consumibles', 'proteccion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Bote aplicador tinte 250 ml', 'ud', 1.50, 'consumible', 'consumibles', 'aplicadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Pinzas pelo plastico (12 uds)', 'ud', 2.50, 'consumible', 'consumibles', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Bigudies permanente surtido (36 uds)', 'ud', 6.00, 'consumible', 'consumibles', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Gorro meches silicona reutilizable', 'ud', 4.50, 'consumible', 'consumibles', 'meches', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Ganchillo meches metalico', 'ud', 3.00, 'consumible', 'consumibles', 'meches', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Equipamiento peluqueria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_est_ref_id, 'Sillon peluqueria hidraulico', 'ud', 350.00, 'equipamiento', 'mobiliario', 'sillones', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Lavacabezas con sillon reclinable', 'ud', 420.00, 'equipamiento', 'mobiliario', 'lavacabezas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tocador espejo con iluminacion LED', 'ud', 280.00, 'equipamiento', 'mobiliario', 'tocadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Carro auxiliar peluqueria 5 bandejas', 'ud', 65.00, 'equipamiento', 'mobiliario', 'carros', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Secador profesional 2200 W', 'ud', 85.00, 'equipamiento', 'herramientas', 'secadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Plancha pelo ceramica profesional', 'ud', 70.00, 'equipamiento', 'herramientas', 'planchas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Maquina cortar pelo profesional', 'ud', 65.00, 'equipamiento', 'herramientas', 'maquinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tijeras corte profesional 6"', 'ud', 45.00, 'equipamiento', 'herramientas', 'tijeras', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tijeras entresacar profesional 6"', 'ud', 40.00, 'equipamiento', 'herramientas', 'tijeras', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Navaja barbero con hojas recambiables', 'ud', 12.00, 'equipamiento', 'herramientas', 'navajas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Esterilizador UV herramientas', 'ud', 45.00, 'equipamiento', 'higiene', 'esterilizadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Difusor universal secador', 'ud', 8.00, 'equipamiento', 'herramientas', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Cepillo termico ceramico 43 mm', 'ud', 12.00, 'equipamiento', 'herramientas', 'cepillos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Peine profesional carbono (set 6)', 'ud', 8.50, 'equipamiento', 'herramientas', 'peines', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Estetica y belleza ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_est_ref_id, 'Cera depilar tibia 800 ml', 'ud', 8.50, 'producto', 'estetica', 'depilacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Bandas depilacion TNT (100 uds)', 'ud', 3.50, 'consumible', 'estetica', 'depilacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Calentador cera 800 ml', 'ud', 28.00, 'equipamiento', 'estetica', 'depilacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Crema facial hidratante profesional 500 ml', 'ud', 18.00, 'producto', 'estetica', 'facial', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Serum vitamina C 30 ml', 'ud', 12.00, 'producto', 'estetica', 'facial', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Mascarilla facial arcilla verde 500 g', 'ud', 9.50, 'producto', 'estetica', 'facial', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Esmalte unas semipermanente 15 ml', 'ud', 7.50, 'producto', 'estetica', 'unas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Lampara UV/LED unas 48W', 'ud', 35.00, 'equipamiento', 'estetica', 'unas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Kit gel unas completo (base+top+colores)', 'ud', 45.00, 'producto', 'estetica', 'unas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Camilla estetica regulable', 'ud', 180.00, 'equipamiento', 'estetica', 'mobiliario', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Vaporizador facial ozono', 'ud', 95.00, 'equipamiento', 'estetica', 'aparatos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Lupa con luz LED brazo articulado', 'ud', 45.00, 'equipamiento', 'estetica', 'aparatos', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Tarifas servicios peluqueria (precios venta recomendados) ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_est_ref_id, 'Corte caballero', 'servicio', 12.00, 'servicio', 'tarifas', 'cortes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Corte senora', 'servicio', 18.00, 'servicio', 'tarifas', 'cortes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Corte nino (hasta 12 anos)', 'servicio', 8.00, 'servicio', 'tarifas', 'cortes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tinte raiz', 'servicio', 25.00, 'servicio', 'tarifas', 'color', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tinte completo pelo largo', 'servicio', 40.00, 'servicio', 'tarifas', 'color', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Mechas papel aluminio', 'servicio', 45.00, 'servicio', 'tarifas', 'color', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Balayage', 'servicio', 55.00, 'servicio', 'tarifas', 'color', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Lavado + secado', 'servicio', 10.00, 'servicio', 'tarifas', 'lavados', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Peinado especial / recogido', 'servicio', 30.00, 'servicio', 'tarifas', 'peinados', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tratamiento keratina', 'servicio', 80.00, 'servicio', 'tarifas', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Permanente clasica', 'servicio', 40.00, 'servicio', 'tarifas', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Manicura basica', 'servicio', 12.00, 'servicio', 'tarifas', 'unas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Manicura semipermanente', 'servicio', 20.00, 'servicio', 'tarifas', 'unas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Depilacion cera piernas enteras', 'servicio', 18.00, 'servicio', 'tarifas', 'depilacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Depilacion cera ingles', 'servicio', 10.00, 'servicio', 'tarifas', 'depilacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Limpieza facial completa', 'servicio', 35.00, 'servicio', 'tarifas', 'facial', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Arreglo barba', 'servicio', 8.00, 'servicio', 'tarifas', 'barberia', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Afeitado clasico navaja', 'servicio', 12.00, 'servicio', 'tarifas', 'barberia', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. HOSTELERIA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Alimentacion profesional ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_hos_makro_id, 'Aceite oliva virgen extra garrafa 5 L', 'ud', 29.50, 'producto', 'alimentacion', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Aceite girasol alto oleico 10 L', 'ud', 14.00, 'producto', 'alimentacion', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Patata nueva saco 25 kg', 'ud', 12.50, 'producto', 'alimentacion', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Cebolla saco 10 kg', 'ud', 4.80, 'producto', 'alimentacion', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Tomate pera caja 6 kg', 'ud', 7.20, 'producto', 'alimentacion', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Lechuga iceberg caja 12 uds', 'ud', 9.60, 'producto', 'alimentacion', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Pollo entero fresco kg', 'kg', 3.80, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Solomillo ternera kg', 'kg', 22.00, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Entrecot ternera kg', 'kg', 16.50, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Cerdo lomo fresco kg', 'kg', 6.50, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Merluza fresca kg', 'kg', 12.00, 'producto', 'alimentacion', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Gambas peladas congeladas 1 kg', 'ud', 14.50, 'producto', 'alimentacion', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Jamon serrano gran reserva pieza 7 kg', 'ud', 52.00, 'producto', 'alimentacion', 'embutidos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Queso manchego curado pieza 3 kg', 'ud', 28.00, 'producto', 'alimentacion', 'quesos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Huevos frescos caja 360 uds', 'ud', 42.00, 'producto', 'alimentacion', 'huevos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Arroz bomba saco 5 kg', 'ud', 14.00, 'producto', 'alimentacion', 'arroces', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Harina trigo fuerza saco 25 kg', 'ud', 14.50, 'producto', 'alimentacion', 'harinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Pan precocido baguette (40 uds)', 'ud', 22.00, 'producto', 'alimentacion', 'panaderia', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Bebidas hosteleria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_hos_makro_id, 'Cerveza grifo barril 30 L', 'ud', 65.00, 'producto', 'bebidas', 'cervezas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Cerveza lager caja 24x330 ml', 'ud', 10.80, 'producto', 'bebidas', 'cervezas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Refresco cola postmix BIB 10 L', 'ud', 22.00, 'producto', 'bebidas', 'refrescos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Agua mineral 50 cl caja 24 uds', 'ud', 5.40, 'producto', 'bebidas', 'aguas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Vino tinto house crianza caja 6x75 cl', 'ud', 24.00, 'producto', 'bebidas', 'vinos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Vino blanco house caja 6x75 cl', 'ud', 18.00, 'producto', 'bebidas', 'vinos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Cafe en grano hosteleria 1 kg', 'ud', 11.00, 'producto', 'bebidas', 'cafes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Ron blanco 1 L', 'ud', 9.50, 'producto', 'bebidas', 'licores', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Ginebra premium 70 cl', 'ud', 16.00, 'producto', 'bebidas', 'licores', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Tonica premium pack 24x200 ml', 'ud', 18.00, 'producto', 'bebidas', 'refrescos', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Equipamiento hosteleria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_hos_stalgast_id, 'Freidora industrial 2 cubas 8+8 L', 'ud', 450.00, 'equipamiento', 'cocina', 'freidoras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Plancha grill lisa 60 cm gas', 'ud', 380.00, 'equipamiento', 'cocina', 'planchas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Cocina industrial 6 fuegos + horno', 'ud', 1800.00, 'equipamiento', 'cocina', 'cocinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Campana extractora industrial 120 cm', 'ud', 850.00, 'equipamiento', 'cocina', 'extraccion', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Lavavajillas industrial cesta 50x50', 'ud', 2200.00, 'equipamiento', 'cocina', 'lavavajillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Mesa refrigerada 3 puertas 180 cm', 'ud', 1600.00, 'equipamiento', 'frio', 'mesas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Camara frigorifica modular 6 m3', 'ud', 3500.00, 'equipamiento', 'frio', 'camaras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_stalgast_id, 'Maquina hielo 40 kg/dia', 'ud', 750.00, 'equipamiento', 'frio', 'hielo', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Cafetera espresso profesional 2 grupos', 'ud', 2800.00, 'equipamiento', 'barra', 'cafeteras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Molinillo cafe profesional', 'ud', 350.00, 'equipamiento', 'barra', 'cafeteras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Tirador cerveza 2 grifos', 'ud', 650.00, 'equipamiento', 'barra', 'tiradores', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Botellero frigorifico barra 3 puertas', 'ud', 750.00, 'equipamiento', 'barra', 'botelleros', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Silla terraza apilable aluminio', 'ud', 35.00, 'equipamiento', 'sala', 'sillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Mesa terraza 70x70 cm aluminio', 'ud', 55.00, 'equipamiento', 'sala', 'mesas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Parasol terraza 3x3 m', 'ud', 120.00, 'equipamiento', 'sala', 'parasoles', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Vajilla porcelana plato llano 27 cm (12 uds)', 'ud', 36.00, 'equipamiento', 'menaje', 'vajilla', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Cuberteria acero inox 12 servicios', 'ud', 48.00, 'equipamiento', 'menaje', 'cuberteria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Copa vino cristal 35 cl (12 uds)', 'ud', 18.00, 'equipamiento', 'menaje', 'cristaleria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Vaso tubo 22 cl (12 uds)', 'ud', 8.50, 'equipamiento', 'menaje', 'cristaleria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Servilletero inox sobremesa', 'ud', 3.50, 'equipamiento', 'menaje', 'accesorios', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Consumibles hosteleria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_hos_ref_id, 'Servilletas papel 1 capa (5000 uds)', 'ud', 12.00, 'consumible', 'consumibles', 'servilletas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Mantel papel 1x1 m (500 uds)', 'ud', 28.00, 'consumible', 'consumibles', 'manteles', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Envase PP takeaway 750 ml (250 uds)', 'ud', 22.00, 'consumible', 'consumibles', 'takeaway', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Vaso PLA transparente 400 ml (1000 uds)', 'ud', 45.00, 'consumible', 'consumibles', 'takeaway', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Bolsa kraft delivery 26+17x29 (250 uds)', 'ud', 18.00, 'consumible', 'consumibles', 'takeaway', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Detergente lavavajillas industrial 5 L', 'ud', 8.50, 'consumible', 'limpieza', 'quimicos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Desengrasante cocina industrial 5 L', 'ud', 9.00, 'consumible', 'limpieza', 'quimicos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Abrillantador lavavajillas 5 L', 'ud', 7.50, 'consumible', 'limpieza', 'quimicos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Rollo cocina industrial (6 uds)', 'ud', 14.00, 'consumible', 'limpieza', 'papeles', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Delantal cocina desechable (100 uds)', 'ud', 12.00, 'consumible', 'uniformes', 'delantales', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. AUTOMOCION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Aceites y liquidos ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_aut_ref_id, 'Aceite motor 5W30 sintetico 5 L', 'ud', 28.00, 'producto', 'aceites', 'motor', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Aceite motor 5W40 sintetico 5 L', 'ud', 30.00, 'producto', 'aceites', 'motor', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Aceite motor 10W40 semi 5 L', 'ud', 22.00, 'producto', 'aceites', 'motor', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Aceite transmision ATF 1 L', 'ud', 9.50, 'producto', 'aceites', 'transmision', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Liquido frenos DOT4 1 L', 'ud', 6.80, 'producto', 'liquidos', 'frenos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Liquido refrigerante G12 5 L', 'ud', 14.00, 'producto', 'liquidos', 'refrigerante', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Liquido direccion asistida 1 L', 'ud', 7.50, 'producto', 'liquidos', 'direccion', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Liquido limpiaparabrisas 5 L', 'ud', 3.50, 'producto', 'liquidos', 'limpieza', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Liquido AdBlue 10 L', 'ud', 8.50, 'producto', 'liquidos', 'adblue', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Recambios y piezas ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_aut_bosch_id, 'Filtro aceite coche medio', 'ud', 6.50, 'recambio', 'filtros', 'aceite', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Filtro aire coche medio', 'ud', 9.00, 'recambio', 'filtros', 'aire', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Filtro habitaculo carbon activo', 'ud', 12.00, 'recambio', 'filtros', 'habitaculo', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Filtro combustible diesel', 'ud', 15.00, 'recambio', 'filtros', 'combustible', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Pastillas freno delanteras (juego)', 'ud', 22.00, 'recambio', 'frenos', 'pastillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Pastillas freno traseras (juego)', 'ud', 18.00, 'recambio', 'frenos', 'pastillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Disco freno delantero ventilado (ud)', 'ud', 28.00, 'recambio', 'frenos', 'discos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Disco freno trasero (ud)', 'ud', 22.00, 'recambio', 'frenos', 'discos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Bujia encendido (ud)', 'ud', 5.50, 'recambio', 'encendido', 'bujias', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Escobilla limpiaparabrisas 600 mm', 'ud', 8.50, 'recambio', 'carroceria', 'escobillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Amortiguador delantero (ud)', 'ud', 45.00, 'recambio', 'suspension', 'amortiguadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Amortiguador trasero (ud)', 'ud', 35.00, 'recambio', 'suspension', 'amortiguadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Kit distribucion + bomba agua', 'ud', 120.00, 'recambio', 'distribucion', 'kits', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Correa poly V', 'ud', 18.00, 'recambio', 'distribucion', 'correas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Kit embrague completo', 'ud', 150.00, 'recambio', 'transmision', 'embrague', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Bateria 12V 60Ah', 'ud', 65.00, 'recambio', 'electrico', 'baterias', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Bateria 12V 74Ah', 'ud', 78.00, 'recambio', 'electrico', 'baterias', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lampara H7 12V 55W (par)', 'ud', 8.00, 'recambio', 'electrico', 'iluminacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lampara LED H7 homologada (par)', 'ud', 35.00, 'recambio', 'electrico', 'iluminacion', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Neumaticos ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_aut_ref_id, 'Neumatico 205/55 R16 economy', 'ud', 45.00, 'recambio', 'neumaticos', 'turismos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Neumatico 205/55 R16 premium', 'ud', 75.00, 'recambio', 'neumaticos', 'turismos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Neumatico 225/45 R17 premium', 'ud', 85.00, 'recambio', 'neumaticos', 'turismos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Neumatico 195/65 R15 economy', 'ud', 38.00, 'recambio', 'neumaticos', 'turismos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Equilibrado + montaje neumatico', 'servicio', 12.00, 'servicio', 'neumaticos', 'servicios', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Alineacion direccion', 'servicio', 35.00, 'servicio', 'neumaticos', 'servicios', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Tarifas mano de obra taller ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_aut_ref_id, 'Hora mano obra mecanica general', 'h', 45.00, 'servicio', 'mano_obra', 'mecanica', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Hora mano obra electricidad auto', 'h', 50.00, 'servicio', 'mano_obra', 'electricidad', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Hora mano obra chapa', 'h', 40.00, 'servicio', 'mano_obra', 'chapa', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Hora mano obra pintura', 'h', 42.00, 'servicio', 'mano_obra', 'pintura', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cambio aceite + filtro', 'servicio', 35.00, 'servicio', 'mantenimiento', 'basico', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Revision pre-ITV completa', 'servicio', 60.00, 'servicio', 'mantenimiento', 'itv', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cambio pastillas freno delanteras (m.o.)', 'servicio', 35.00, 'servicio', 'mantenimiento', 'frenos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cambio kit distribucion (m.o.)', 'servicio', 180.00, 'servicio', 'mantenimiento', 'distribucion', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cambio embrague (m.o.)', 'servicio', 200.00, 'servicio', 'mantenimiento', 'embrague', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Diagnostico electronico OBD', 'servicio', 25.00, 'servicio', 'diagnostico', 'electronico', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Carga aire acondicionado R134a', 'servicio', 55.00, 'servicio', 'climatizacion', 'ac', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lavado exterior manual', 'servicio', 12.00, 'servicio', 'limpieza', 'lavados', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lavado completo interior + exterior', 'servicio', 35.00, 'servicio', 'limpieza', 'lavados', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Equipamiento taller ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_aut_ref_id, 'Elevador 2 columnas 4 T', 'ud', 2800.00, 'equipamiento', 'elevacion', 'elevadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Gato hidraulico carretilla 3 T', 'ud', 85.00, 'equipamiento', 'elevacion', 'gatos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Compresor aire 200 L 3 CV', 'ud', 450.00, 'equipamiento', 'neumatica', 'compresores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Pistola impacto neumatica 1/2"', 'ud', 120.00, 'equipamiento', 'neumatica', 'herramientas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Maquina diagnostico multimarca OBD2', 'ud', 350.00, 'equipamiento', 'diagnostico', 'scanners', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Equilibradora neumaticos', 'ud', 1200.00, 'equipamiento', 'neumaticos', 'maquinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Desmontadora neumaticos automatica', 'ud', 1800.00, 'equipamiento', 'neumaticos', 'maquinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Carro herramientas profesional 7 cajones', 'ud', 280.00, 'equipamiento', 'almacenamiento', 'carros', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Juego llaves vaso 1/2" 24 piezas', 'ud', 65.00, 'equipamiento', 'herramientas', 'llaves', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Juego llaves combinadas 6-32 mm', 'ud', 55.00, 'equipamiento', 'herramientas', 'llaves', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. EDUCACION / ACADEMIA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Material didactico ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_edu_ref_id, 'Pizarra blanca 120x90 cm', 'ud', 45.00, 'equipamiento', 'material_didactico', 'pizarras', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Pizarra digital interactiva 75"', 'ud', 1200.00, 'equipamiento', 'material_didactico', 'pizarras', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Proyector LED 3500 lumenes', 'ud', 350.00, 'equipamiento', 'material_didactico', 'proyectores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Pantalla proyeccion 200x150 cm', 'ud', 85.00, 'equipamiento', 'material_didactico', 'proyectores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Rotuladores pizarra blanca (pack 10)', 'ud', 6.00, 'consumible', 'material_didactico', 'rotuladores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Borrador pizarra magnetico', 'ud', 3.50, 'consumible', 'material_didactico', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Rotafolio + bloc papel 70x100 cm', 'ud', 65.00, 'equipamiento', 'material_didactico', 'rotafolios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Bloc recambio rotafolio (50 hojas)', 'ud', 12.00, 'consumible', 'material_didactico', 'rotafolios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Libro texto ingles B1 alumno', 'ud', 28.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Libro texto ingles B2 alumno', 'ud', 30.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Workbook ejercicios B1', 'ud', 18.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Cuaderno espiral A4 80 hojas (pack 5)', 'ud', 8.50, 'consumible', 'papeleria', 'cuadernos', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Boligrafos azules (caja 50)', 'ud', 8.00, 'consumible', 'papeleria', 'escritura', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Papel A4 80g resma 500 hojas', 'ud', 4.50, 'consumible', 'papeleria', 'papel', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Fotocopias B/N (x1000)', 'ud', 25.00, 'servicio', 'papeleria', 'impresion', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Equipamiento aula ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_edu_ref_id, 'Mesa alumno individual 120x60 cm', 'ud', 55.00, 'equipamiento', 'mobiliario', 'mesas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Silla aula apilable', 'ud', 25.00, 'equipamiento', 'mobiliario', 'sillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Mesa profesor 160x80 cm', 'ud', 120.00, 'equipamiento', 'mobiliario', 'mesas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Silla profesor ergonomica', 'ud', 85.00, 'equipamiento', 'mobiliario', 'sillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Armario archivador 4 cajones', 'ud', 150.00, 'equipamiento', 'mobiliario', 'armarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Estanteria aula 5 baldas 180x80 cm', 'ud', 65.00, 'equipamiento', 'mobiliario', 'estanterias', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Ordenador portatil educativo 15.6"', 'ud', 400.00, 'equipamiento', 'informatica', 'portatiles', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Tablet educativa 10"', 'ud', 220.00, 'equipamiento', 'informatica', 'tablets', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Router WiFi 6 doble banda', 'ud', 65.00, 'equipamiento', 'informatica', 'redes', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Impresora multifuncion laser B/N', 'ud', 180.00, 'equipamiento', 'informatica', 'impresoras', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Webcam HD 1080p con micro', 'ud', 35.00, 'equipamiento', 'informatica', 'video', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Auriculares con microfono USB', 'ud', 15.00, 'equipamiento', 'informatica', 'audio', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Altavoz bluetooth portatil aula', 'ud', 28.00, 'equipamiento', 'informatica', 'audio', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Servicios educacion ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_edu_ref_id, 'Alquiler aula 30 m2 (mensual)', 'mes', 400.00, 'servicio', 'alquileres', 'aulas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Profesor particular (hora)', 'h', 20.00, 'servicio', 'personal', 'profesores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Profesor nativo idiomas (hora)', 'h', 25.00, 'servicio', 'personal', 'profesores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Monitor extraescolares (hora)', 'h', 12.00, 'servicio', 'personal', 'monitores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Plataforma e-learning (mensual/alumno)', 'mes', 5.00, 'servicio', 'digital', 'plataformas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Licencia Zoom Pro (mensual)', 'mes', 13.99, 'servicio', 'digital', 'videoconferencia', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Licencia Microsoft 365 Education (anual/user)', 'anual', 36.00, 'servicio', 'digital', 'software', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Seguro RC academia (anual)', 'anual', 280.00, 'servicio', 'seguros', 'rc', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Certificacion oficial centro examinador', 'anual', 500.00, 'servicio', 'certificaciones', 'oficiales', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Publicidad captacion alumnos (mensual)', 'mes', 150.00, 'servicio', 'marketing', 'publicidad', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Diseno web academia (proyecto)', 'ud', 800.00, 'servicio', 'digital', 'web', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Tarifas clases (precios venta referencia) ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at)
VALUES
  (v_edu_ref_id, 'Clase particular individual 1h', 'servicio', 20.00, 'servicio', 'tarifas', 'clases', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Clase grupo reducido (4 alum) 1h', 'servicio', 12.00, 'servicio', 'tarifas', 'clases', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Clase grupo (8-12 alum) 1h', 'servicio', 8.00, 'servicio', 'tarifas', 'clases', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Bono 10 clases particulares', 'servicio', 180.00, 'servicio', 'tarifas', 'bonos', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Mensualidad academia (2 dias/semana)', 'mes', 60.00, 'servicio', 'tarifas', 'mensualidades', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Mensualidad academia (3 dias/semana)', 'mes', 80.00, 'servicio', 'tarifas', 'mensualidades', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Curso intensivo verano (4 semanas)', 'servicio', 250.00, 'servicio', 'tarifas', 'cursos', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Matricula anual', 'servicio', 30.00, 'servicio', 'tarifas', 'matriculas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Examen oficial Cambridge (tasa)', 'servicio', 195.00, 'servicio', 'tarifas', 'examenes', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Clase online individual 1h', 'servicio', 18.00, 'servicio', 'tarifas', 'online', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


END $$;
