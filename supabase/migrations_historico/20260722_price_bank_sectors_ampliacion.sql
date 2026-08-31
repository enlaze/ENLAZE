-- ============================================================================
-- AMPLIACION: Bancos de precios por sector - Espana 2026
-- Productos adicionales para completar cada sector
-- ============================================================================

DO $$
DECLARE
  v_ref_id UUID;
  v_clo_makro_id UUID;
  v_clo_gadisa_id UUID;
  v_clo_mercadona_id UUID;
  v_est_loreal_id UUID;
  v_est_schwarzkopf_id UUID;
  v_est_ref_id UUID;
  v_hos_makro_id UUID;
  v_hos_stalgast_id UUID;
  v_hos_ref_id UUID;
  v_aut_bosch_id UUID;
  v_aut_oscaro_id UUID;
  v_aut_ref_id UUID;
  v_edu_ref_id UUID;
  v_edu_oxford_id UUID;
BEGIN

-- Obtener IDs existentes
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
-- COMERCIO LOCAL — AMPLIACION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Productos frescos ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Pechuga pollo entera kg', 'kg', 5.90, 'producto', 'frescos', 'aves', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Muslo pollo kg', 'kg', 3.20, 'producto', 'frescos', 'aves', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Ternera para guisar kg', 'kg', 11.50, 'producto', 'frescos', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Carne picada mixta kg', 'kg', 6.80, 'producto', 'frescos', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Chuletas cerdo kg', 'kg', 5.50, 'producto', 'frescos', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Costillas cerdo kg', 'kg', 4.80, 'producto', 'frescos', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Solomillo cerdo kg', 'kg', 7.90, 'producto', 'frescos', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lomo embuchado pieza 400 g', 'ud', 6.50, 'producto', 'frescos', 'embutidos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Chorizo extra pieza 350 g', 'ud', 3.80, 'producto', 'frescos', 'embutidos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Jamon cocido extra lonchas 200 g', 'ud', 2.50, 'producto', 'frescos', 'embutidos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Salchichon iberico pieza 400 g', 'ud', 5.20, 'producto', 'frescos', 'embutidos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Merluza fresca rodajas kg', 'kg', 9.80, 'producto', 'frescos', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Salmon fresco kg', 'kg', 11.50, 'producto', 'frescos', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Gambas frescas kg', 'kg', 14.00, 'producto', 'frescos', 'mariscos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Mejillones frescos kg', 'kg', 2.80, 'producto', 'frescos', 'mariscos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Tomate rama kg', 'kg', 2.20, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Patata kg', 'kg', 0.90, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cebolla kg', 'kg', 0.85, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Zanahoria kg', 'kg', 0.95, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pimiento rojo kg', 'kg', 2.50, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pimiento verde kg', 'kg', 1.80, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Calabacin kg', 'kg', 1.50, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Berenjena kg', 'kg', 1.70, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lechuga romana ud', 'ud', 0.85, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Ajo cabeza', 'ud', 0.50, 'producto', 'frescos', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Platano canarias kg', 'kg', 1.90, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Manzana golden kg', 'kg', 1.80, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Naranja zumo kg', 'kg', 1.20, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pera conferencia kg', 'kg', 2.00, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Sandia kg', 'kg', 0.65, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Melon piel sapo kg', 'kg', 1.10, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Fresa tarrina 500 g', 'ud', 2.50, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Limon kg', 'kg', 1.60, 'producto', 'frescos', 'frutas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Queso manchego semicurado cuna 300 g', 'ud', 4.50, 'producto', 'frescos', 'quesos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Queso fresco burgos 250 g', 'ud', 1.50, 'producto', 'frescos', 'quesos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Yogur natural pack 4', 'ud', 0.95, 'producto', 'frescos', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Nata liquida cocina 500 ml', 'ud', 1.40, 'producto', 'frescos', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pan barra normal', 'ud', 0.65, 'producto', 'frescos', 'panaderia', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pan molde integral 450 g', 'ud', 1.30, 'producto', 'frescos', 'panaderia', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Croissant mantequilla (6 uds)', 'ud', 2.20, 'producto', 'frescos', 'bolleria', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Congelados ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Guisantes congelados 1 kg', 'ud', 1.50, 'producto', 'congelados', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Menestra congelada 1 kg', 'ud', 1.80, 'producto', 'congelados', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Espinacas congeladas 1 kg', 'ud', 1.40, 'producto', 'congelados', 'verduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Croquetas jamon 500 g', 'ud', 2.50, 'producto', 'congelados', 'precocinados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pizza congelada margarita', 'ud', 2.20, 'producto', 'congelados', 'precocinados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Merluza congelada filetes 400 g', 'ud', 3.50, 'producto', 'congelados', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Langostinos congelados 800 g', 'ud', 8.50, 'producto', 'congelados', 'mariscos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Helado vainilla tarrina 1 L', 'ud', 3.20, 'producto', 'congelados', 'helados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'San Jacobo jamon queso (4 uds)', 'ud', 2.80, 'producto', 'congelados', 'precocinados', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Patatas fritas congeladas 1 kg', 'ud', 1.60, 'producto', 'congelados', 'patatas', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Higiene personal ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Gel ducha 750 ml', 'ud', 2.30, 'producto', 'higiene', 'corporal', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Champu anticaspa 400 ml', 'ud', 3.50, 'producto', 'higiene', 'capilar', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Desodorante roll-on 50 ml', 'ud', 2.10, 'producto', 'higiene', 'desodorantes', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pasta dientes 75 ml', 'ud', 1.80, 'producto', 'higiene', 'dental', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cepillo dientes medio', 'ud', 1.20, 'producto', 'higiene', 'dental', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Crema manos 75 ml', 'ud', 2.50, 'producto', 'higiene', 'corporal', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Jabon manos liquido 500 ml', 'ud', 1.90, 'producto', 'higiene', 'jabones', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Panales bebe talla 4 (40 uds)', 'ud', 9.50, 'producto', 'higiene', 'bebe', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Toallitas humedas bebe (72 uds)', 'ud', 1.80, 'producto', 'higiene', 'bebe', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Compresas normales (14 uds)', 'ud', 1.90, 'producto', 'higiene', 'femenina', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Maquinilla afeitar desechable (5 uds)', 'ud', 2.80, 'producto', 'higiene', 'afeitado', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Colonia agua fresca 200 ml', 'ud', 5.50, 'producto', 'higiene', 'perfumeria', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Bazar y hogar ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Pilas alcalinas AA (4 uds)', 'ud', 2.50, 'producto', 'bazar', 'pilas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pilas alcalinas AAA (4 uds)', 'ud', 2.50, 'producto', 'bazar', 'pilas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bombilla LED E27 10W', 'ud', 2.80, 'producto', 'bazar', 'iluminacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Velas cilindricas blancas (6 uds)', 'ud', 2.00, 'producto', 'bazar', 'velas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Paraguas plegable automatico', 'ud', 6.50, 'producto', 'bazar', 'complementos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Percha madera natural (5 uds)', 'ud', 3.50, 'producto', 'bazar', 'hogar', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cubo basura pedal 25 L', 'ud', 8.50, 'producto', 'bazar', 'hogar', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Escoba con recogedor', 'ud', 4.50, 'producto', 'bazar', 'limpieza', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Fregona microfibra con cubo', 'ud', 8.00, 'producto', 'bazar', 'limpieza', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Tendedero alas aluminio', 'ud', 15.00, 'producto', 'bazar', 'hogar', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Tabla planchar regulable', 'ud', 18.00, 'producto', 'bazar', 'hogar', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Juego sabanas 90 cm', 'ud', 12.00, 'producto', 'bazar', 'textil', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Toalla bano 70x140 cm', 'ud', 6.50, 'producto', 'bazar', 'textil', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Sarten antiadherente 26 cm', 'ud', 8.50, 'producto', 'bazar', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Olla acero inox 24 cm con tapa', 'ud', 15.00, 'producto', 'bazar', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Juego cuchillos cocina (6 piezas)', 'ud', 12.00, 'producto', 'bazar', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Tabla cortar bambu 35x25 cm', 'ud', 5.50, 'producto', 'bazar', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Fiambrera hermetica set 3 uds', 'ud', 4.50, 'producto', 'bazar', 'cocina', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Alimentacion especial y snacks ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Aceitunas rellenas anchoa 350 g', 'ud', 1.60, 'producto', 'alimentacion', 'aperitivos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Patatas fritas bolsa 150 g', 'ud', 1.40, 'producto', 'alimentacion', 'snacks', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Frutos secos variados 200 g', 'ud', 2.80, 'producto', 'alimentacion', 'snacks', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Vinagre de manzana 500 ml', 'ud', 1.50, 'producto', 'alimentacion', 'condimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Mayonesa bote 450 ml', 'ud', 1.80, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Ketchup bote 450 g', 'ud', 1.50, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Miel natural 500 g', 'ud', 4.50, 'producto', 'alimentacion', 'dulces', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Mermelada fresa 350 g', 'ud', 1.80, 'producto', 'alimentacion', 'dulces', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Cereales desayuno 500 g', 'ud', 2.50, 'producto', 'alimentacion', 'cereales', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Leche condensada 370 g', 'ud', 1.60, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lentejas cocidas tarro 570 g', 'ud', 1.20, 'producto', 'alimentacion', 'legumbres', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Garbanzos cocidos tarro 570 g', 'ud', 1.10, 'producto', 'alimentacion', 'legumbres', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bebida soja 1 L', 'ud', 1.50, 'producto', 'alimentacion', 'vegetal', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Bebida avena 1 L', 'ud', 1.60, 'producto', 'alimentacion', 'vegetal', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Caldo pollo brick 1 L', 'ud', 1.20, 'producto', 'alimentacion', 'caldos', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Gazpacho fresco 1 L', 'ud', 2.20, 'producto', 'alimentacion', 'sopas', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Mascotas ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_ref_id, 'Pienso perro adulto 15 kg', 'ud', 22.00, 'producto', 'mascotas', 'alimentacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Pienso gato adulto 4 kg', 'ud', 12.00, 'producto', 'mascotas', 'alimentacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Lata comida humeda perro 400 g', 'ud', 1.50, 'producto', 'mascotas', 'alimentacion', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Arena gatos aglomerante 10 L', 'ud', 4.50, 'producto', 'mascotas', 'higiene', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Snacks perro dental (7 uds)', 'ud', 2.80, 'producto', 'mascotas', 'snacks', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Collar perro nylon ajustable', 'ud', 4.50, 'producto', 'mascotas', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Correa perro 1.5 m', 'ud', 5.50, 'producto', 'mascotas', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_ref_id, 'Juguete perro pelota resistente', 'ud', 3.00, 'producto', 'mascotas', 'juguetes', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PELUQUERIA Y ESTETICA — AMPLIACION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Barberia ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_est_ref_id, 'Aceite barba 30 ml', 'ud', 8.50, 'producto', 'barberia', 'aceites', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Balsamo barba 60 ml', 'ud', 9.00, 'producto', 'barberia', 'balsamos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Cera bigote 15 ml', 'ud', 5.50, 'producto', 'barberia', 'ceras', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Champu barba 200 ml', 'ud', 7.50, 'producto', 'barberia', 'champus', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Cepillo barba madera jabali', 'ud', 12.00, 'equipamiento', 'barberia', 'cepillos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Peine barba madera sandalo', 'ud', 6.00, 'equipamiento', 'barberia', 'peines', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Maquina recortadora barba profesional', 'ud', 55.00, 'equipamiento', 'barberia', 'maquinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Hojas navaja barbero (100 uds)', 'ud', 8.00, 'consumible', 'barberia', 'navajas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Brocha afeitar pelo tejón', 'ud', 15.00, 'equipamiento', 'barberia', 'accesorios', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Jabon afeitar pastilla 100 g', 'ud', 6.50, 'producto', 'barberia', 'afeitado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'After shave balsamo 150 ml', 'ud', 8.00, 'producto', 'barberia', 'afeitado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Piedra alumbre despues afeitado', 'ud', 4.50, 'producto', 'barberia', 'afeitado', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Mas productos capilares y marcas ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_est_loreal_id, 'Tinte Inoa sin amoniaco 60 ml', 'ud', 8.50, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Oxidante Inoa 20 vol 1000 ml', 'ud', 6.80, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Spray fijador Elnett 400 ml', 'ud', 7.50, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Serum reparador Absolut Repair 50 ml', 'ud', 14.00, 'producto', 'capilar', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_loreal_id, 'Ampolla tratamiento intensivo (10 ml)', 'ud', 4.50, 'producto', 'capilar', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'BlondMe decoloracion premium 450 g', 'ud', 18.00, 'producto', 'capilar', 'decoloracion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'Gliss mascarilla reparadora 300 ml', 'ud', 5.50, 'producto', 'capilar', 'mascarillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_schwarzkopf_id, 'OSiS+ spray texturizante 300 ml', 'ud', 10.00, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Champu matizador violeta 1000 ml', 'ud', 12.00, 'producto', 'capilar', 'champus', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tinte vegetal henna 100 g', 'ud', 6.00, 'producto', 'capilar', 'tintes', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Liquido permanente 1000 ml', 'ud', 8.50, 'producto', 'capilar', 'permanente', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Neutralizante permanente 1000 ml', 'ud', 7.00, 'producto', 'capilar', 'permanente', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Queratina alisado brasileno kit 250 ml', 'ud', 45.00, 'producto', 'capilar', 'alisado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Gel fijacion extra fuerte 500 ml', 'ud', 4.50, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Polvo volumen cabello 10 g', 'ud', 8.00, 'producto', 'capilar', 'acabado', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Champu anticaspa profesional 1000 ml', 'ud', 11.00, 'producto', 'capilar', 'champus', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Serum puntas abiertas 100 ml', 'ud', 7.50, 'producto', 'capilar', 'tratamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Spray desenredante 250 ml', 'ud', 6.00, 'producto', 'capilar', 'acondicionadores', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Unas profesional ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_est_ref_id, 'Gel constructor UV rosa 30 ml', 'ud', 12.00, 'producto', 'unas', 'geles', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Gel constructor UV transparente 30 ml', 'ud', 11.00, 'producto', 'unas', 'geles', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Base coat semipermanente 15 ml', 'ud', 6.50, 'producto', 'unas', 'bases', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Top coat brillo semipermanente 15 ml', 'ud', 7.00, 'producto', 'unas', 'tops', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Polvo acrilico transparente 30 g', 'ud', 8.00, 'producto', 'unas', 'acrilicos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Liquido monomero acrilico 100 ml', 'ud', 9.50, 'producto', 'unas', 'acrilicos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Tips unas transparentes (500 uds)', 'ud', 8.00, 'consumible', 'unas', 'tips', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Lima unas profesional 100/180 (10 uds)', 'ud', 4.50, 'consumible', 'unas', 'limas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Pulidor unas bloque 4 caras (5 uds)', 'ud', 3.50, 'consumible', 'unas', 'pulidores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Aceite cuticulas 15 ml', 'ud', 4.00, 'producto', 'unas', 'cuticulas', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Removedor semipermanente 250 ml', 'ud', 5.50, 'producto', 'unas', 'removedores', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Decoracion unas strass (1000 uds)', 'ud', 3.50, 'consumible', 'unas', 'decoracion', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Pincel nail art set fino (5 uds)', 'ud', 6.00, 'equipamiento', 'unas', 'pinceles', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Torno unas electrico profesional', 'ud', 55.00, 'equipamiento', 'unas', 'tornos', 'comercio_local', 'ES', true, true, NOW()),
  (v_est_ref_id, 'Aspirador polvo unas sobremesa', 'ud', 35.00, 'equipamiento', 'unas', 'aspiradores', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- HOSTELERIA — AMPLIACION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Mas alimentacion ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_hos_makro_id, 'Bacon ahumado lonchas 2 kg', 'ud', 12.00, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Hamburguesa ternera 100 g (40 uds)', 'ud', 28.00, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Secreto iberico kg', 'kg', 12.50, 'producto', 'alimentacion', 'carnes', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Calamares limpios congelados 1 kg', 'ud', 8.50, 'producto', 'alimentacion', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Pulpo congelado pieza 2 kg', 'ud', 18.00, 'producto', 'alimentacion', 'pescados', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Mejillon gallego fresco kg', 'kg', 3.50, 'producto', 'alimentacion', 'mariscos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Queso parmesano rallado 1 kg', 'ud', 14.00, 'producto', 'alimentacion', 'quesos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Nata cocina 35% MG 1 L', 'ud', 2.80, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_makro_id, 'Mantequilla bloque 2.5 kg', 'ud', 14.00, 'producto', 'alimentacion', 'lacteos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Chocolate cobertura negro 70% 2.5 kg', 'ud', 16.00, 'producto', 'alimentacion', 'reposteria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Azucar glass 1 kg', 'ud', 1.80, 'producto', 'alimentacion', 'reposteria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Levadura fresca 500 g', 'ud', 1.50, 'producto', 'alimentacion', 'reposteria', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Salsa soja 1 L', 'ud', 3.50, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Mayonesa bote hosteleria 3.6 kg', 'ud', 8.50, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Ketchup garrafa 5 kg', 'ud', 6.50, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Mostaza bote 1 kg', 'ud', 3.20, 'producto', 'alimentacion', 'salsas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Vinagre balsamico Modena 500 ml', 'ud', 3.80, 'producto', 'alimentacion', 'condimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Especias surtidas (oregano, pimienta, pimenton...)', 'ud', 2.50, 'producto', 'alimentacion', 'condimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Azucar blanco saco 25 kg', 'ud', 18.00, 'producto', 'alimentacion', 'azucares', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Sobres azucar individual (1000 uds)', 'ud', 6.50, 'consumible', 'alimentacion', 'azucares', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Uniformes y textil hosteleria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_hos_ref_id, 'Chaqueta cocina blanca manga corta', 'ud', 18.00, 'equipamiento', 'uniformes', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Pantalon cocina cuadros', 'ud', 14.00, 'equipamiento', 'uniformes', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Delantal largo cocina con peto', 'ud', 8.00, 'equipamiento', 'uniformes', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Gorro cocinero desechable (100 uds)', 'ud', 6.00, 'consumible', 'uniformes', 'cocina', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Zapato cocina antideslizante', 'ud', 35.00, 'equipamiento', 'uniformes', 'calzado', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Camisa camarero manga corta', 'ud', 15.00, 'equipamiento', 'uniformes', 'sala', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Delantal camarero corto', 'ud', 6.00, 'equipamiento', 'uniformes', 'sala', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Mantel tela blanco 150x150 cm', 'ud', 8.50, 'equipamiento', 'textil', 'manteles', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Pano cocina rizo (pack 12)', 'ud', 12.00, 'consumible', 'textil', 'panos', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Servilleta tela blanca (pack 12)', 'ud', 14.00, 'equipamiento', 'textil', 'servilletas', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Tarifas mano de obra hosteleria ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_hos_ref_id, 'Cocinero jefe salario bruto/hora', 'h', 14.00, 'servicio', 'personal', 'salarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Cocinero ayudante salario bruto/hora', 'h', 10.50, 'servicio', 'personal', 'salarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Camarero salario bruto/hora', 'h', 9.50, 'servicio', 'personal', 'salarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Friegaplatos salario bruto/hora', 'h', 8.50, 'servicio', 'personal', 'salarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Extra camarero evento (jornada)', 'servicio', 85.00, 'servicio', 'personal', 'extras', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Limpieza campana extractora profesional', 'servicio', 180.00, 'servicio', 'mantenimiento', 'limpieza', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Revision gas anual', 'servicio', 80.00, 'servicio', 'mantenimiento', 'revisiones', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Desinsectacion local (trimestral)', 'servicio', 55.00, 'servicio', 'mantenimiento', 'plagas', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Carnet manipulador alimentos (curso)', 'servicio', 25.00, 'servicio', 'formacion', 'certificados', 'comercio_local', 'ES', true, true, NOW()),
  (v_hos_ref_id, 'Licencia terraza ayuntamiento (anual)', 'anual', 1200.00, 'servicio', 'licencias', 'terraza', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- AUTOMOCION — AMPLIACION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Pintura y chapa ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_aut_ref_id, 'Pintura base bicapa 1 L', 'ud', 35.00, 'producto', 'pintura', 'bases', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Barniz acrilico HS 2K 1 L', 'ud', 22.00, 'producto', 'pintura', 'barnices', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Catalizador barniz 500 ml', 'ud', 10.00, 'producto', 'pintura', 'catalizadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Imprimacion epoxi 2K 1 L', 'ud', 18.00, 'producto', 'pintura', 'imprimaciones', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Aparejo gris alto espesor 1 L', 'ud', 14.00, 'producto', 'pintura', 'aparejos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Masilla poliester reparacion 2 kg', 'ud', 8.50, 'producto', 'pintura', 'masillas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lija agua P800 (pack 50)', 'ud', 12.00, 'consumible', 'pintura', 'lijas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Lija agua P1500 (pack 50)', 'ud', 14.00, 'consumible', 'pintura', 'lijas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cinta carrocero 48 mm x 50 m', 'ud', 3.50, 'consumible', 'pintura', 'cintas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Plastico proteccion pintura rollo 4x150 m', 'ud', 6.00, 'consumible', 'pintura', 'proteccion', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Pistola pintar HVLP 1.3 mm', 'ud', 120.00, 'equipamiento', 'pintura', 'pistolas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cabina pintura inflable portatil', 'ud', 450.00, 'equipamiento', 'pintura', 'cabinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Pulimento corte 1 L', 'ud', 12.00, 'producto', 'pintura', 'pulimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Pulimento acabado 1 L', 'ud', 14.00, 'producto', 'pintura', 'pulimentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Pulidora rotorbital electrica', 'ud', 180.00, 'equipamiento', 'pintura', 'pulidoras', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Mas recambios y consumibles ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_aut_oscaro_id, 'Rotula direccion (ud)', 'ud', 25.00, 'recambio', 'direccion', 'rotulas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Bieleta estabilizadora (ud)', 'ud', 15.00, 'recambio', 'suspension', 'bieletas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Rodamiento rueda delantero', 'ud', 28.00, 'recambio', 'suspension', 'rodamientos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Cilindro freno rueda trasero', 'ud', 18.00, 'recambio', 'frenos', 'cilindros', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Bomba agua motor', 'ud', 35.00, 'recambio', 'refrigeracion', 'bombas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Termostato motor', 'ud', 12.00, 'recambio', 'refrigeracion', 'termostatos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Radiador motor aluminio', 'ud', 95.00, 'recambio', 'refrigeracion', 'radiadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Alternador reconstruido', 'ud', 120.00, 'recambio', 'electrico', 'alternadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_oscaro_id, 'Motor arranque reconstruido', 'ud', 110.00, 'recambio', 'electrico', 'arranque', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Sensor lambda universal', 'ud', 35.00, 'recambio', 'electrico', 'sensores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Bobina encendido', 'ud', 28.00, 'recambio', 'encendido', 'bobinas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_bosch_id, 'Bujia precalentamiento diesel', 'ud', 8.00, 'recambio', 'encendido', 'bujias', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Retrovisor exterior electrico derecho', 'ud', 45.00, 'recambio', 'carroceria', 'retrovisores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Parabrisas delantero (montaje incluido)', 'ud', 220.00, 'recambio', 'carroceria', 'lunas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Paragolpes delantero pintado', 'ud', 180.00, 'recambio', 'carroceria', 'paragolpes', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Faro delantero halogeno (ud)', 'ud', 65.00, 'recambio', 'carroceria', 'faros', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Piloto trasero (ud)', 'ud', 35.00, 'recambio', 'carroceria', 'pilotos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Cerradura puerta mecanismo', 'ud', 28.00, 'recambio', 'carroceria', 'cerraduras', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Elevalunas electrico delantero', 'ud', 55.00, 'recambio', 'carroceria', 'elevalunas', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Silencioso escape trasero', 'ud', 75.00, 'recambio', 'escape', 'silenciosos', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Catalizador escape homologado', 'ud', 250.00, 'recambio', 'escape', 'catalizadores', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Gas refrigerante R134a botella 900 g', 'ud', 18.00, 'producto', 'climatizacion', 'gases', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Filtro antipolen habitaculo', 'ud', 8.00, 'recambio', 'climatizacion', 'filtros', 'comercio_local', 'ES', true, true, NOW()),
  (v_aut_ref_id, 'Compresor AC reconstruido', 'ud', 250.00, 'recambio', 'climatizacion', 'compresores', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- EDUCACION — AMPLIACION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Mas libros y material por materia ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_edu_oxford_id, 'Libro texto ingles A1 alumno', 'ud', 22.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Libro texto ingles A2 alumno', 'ud', 24.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Libro texto ingles C1 alumno', 'ud', 32.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_oxford_id, 'Grammar in Use (Advanced)', 'ud', 28.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Libro texto frances A1-A2', 'ud', 25.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Libro texto aleman A1-A2', 'ud', 26.00, 'producto', 'libros', 'idiomas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Libro matematicas ESO', 'ud', 32.00, 'producto', 'libros', 'academico', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Libro fisica quimica Bachillerato', 'ud', 35.00, 'producto', 'libros', 'academico', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Libro lengua castellana ESO', 'ud', 30.00, 'producto', 'libros', 'academico', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Temario oposiciones maestro primaria', 'ud', 65.00, 'producto', 'libros', 'oposiciones', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Temario oposiciones auxiliar administrativo', 'ud', 55.00, 'producto', 'libros', 'oposiciones', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Temario oposiciones policia local', 'ud', 48.00, 'producto', 'libros', 'oposiciones', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Test oposiciones Constitucion 1000 preguntas', 'ud', 18.00, 'producto', 'libros', 'oposiciones', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Diccionario ingles-espanol Oxford', 'ud', 22.00, 'producto', 'libros', 'diccionarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Atlas geografico escolar', 'ud', 15.00, 'producto', 'libros', 'complementarios', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Calculadora cientifica', 'ud', 12.00, 'equipamiento', 'material_didactico', 'calculadoras', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Globo terraqueo 30 cm iluminado', 'ud', 25.00, 'equipamiento', 'material_didactico', 'geografia', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Kit anatomia cuerpo humano maqueta', 'ud', 35.00, 'equipamiento', 'material_didactico', 'ciencias', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Juego letras magneticas infantil', 'ud', 12.00, 'equipamiento', 'material_didactico', 'infantil', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Flash cards vocabulario ingles (200 uds)', 'ud', 8.00, 'producto', 'material_didactico', 'idiomas', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;

-- ── Mas servicios educacion ──
INSERT INTO pb_products (provider_id, commercial_name, sale_unit, unit_price, product_type, category, subcategory, sector, region, is_active, is_available, checked_at) VALUES
  (v_edu_ref_id, 'Profesor oposiciones (hora)', 'h', 30.00, 'servicio', 'personal', 'profesores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Logopeda (sesion 45 min)', 'servicio', 35.00, 'servicio', 'personal', 'especialistas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Psicologo educativo (sesion)', 'servicio', 45.00, 'servicio', 'personal', 'especialistas', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Profesor robotica/programacion (hora)', 'h', 22.00, 'servicio', 'personal', 'profesores', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Mensualidad oposiciones (3 dias/semana)', 'mes', 120.00, 'servicio', 'tarifas', 'mensualidades', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Clase refuerzo ESO grupo (hora)', 'servicio', 10.00, 'servicio', 'tarifas', 'clases', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Campamento urbano semana', 'servicio', 120.00, 'servicio', 'tarifas', 'campamentos', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Excursion escolar autobus (jornada)', 'servicio', 250.00, 'servicio', 'actividades', 'excursiones', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Tasa examen DELE (B2)', 'servicio', 196.00, 'servicio', 'tarifas', 'examenes', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Tasa examen Trinity (ISE II)', 'servicio', 178.00, 'servicio', 'tarifas', 'examenes', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Servicio guarderia (mensual)', 'mes', 350.00, 'servicio', 'tarifas', 'guarderia', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Actividad extraescolar (mensual 2h/sem)', 'mes', 40.00, 'servicio', 'tarifas', 'extraescolares', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Simulacro examen oposiciones', 'servicio', 15.00, 'servicio', 'tarifas', 'examenes', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Correccion y tutoria TFG/TFM', 'servicio', 200.00, 'servicio', 'tarifas', 'universidad', 'comercio_local', 'ES', true, true, NOW()),
  (v_edu_ref_id, 'Curso certificado Google Workspace (20h)', 'servicio', 150.00, 'servicio', 'tarifas', 'cursos', 'comercio_local', 'ES', true, true, NOW())
ON CONFLICT (provider_id, commercial_name) DO NOTHING;


END $$;
