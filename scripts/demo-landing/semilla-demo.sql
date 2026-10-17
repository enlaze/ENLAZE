-- b13 · Datos INVENTADOS de la cuenta demo de la landing (Reformas Alcor).
-- Autorizado por Daniil el 2026-10-17: solo la cuenta idkdu37+demo@gmail.com,
-- marcada is_internal. Nombres, NIF, teléfonos y emails son ficticios.
--
-- Solo siembra lo que la app no deja crear de forma cómoda o lo que necesita
-- una fuente externa: perfil, ajustes fiscales, proveedores, precios fijados a
-- mano y las alertas de precio. Clientes, facturas emitidas y presupuestos NO
-- se siembran: se crean desde la app (ver informes/2026-10-17-b13-landing.md),
-- para que el resumen diario se calcule con datos que ha generado el programa.
--
-- Los avisos de subida (price_alert_notifications) tampoco: solo los genera
-- /api/prices/process-alerts cuando el rastreo cambia un precio.
do $$
declare
  uid uuid := (select id from auth.users where email = 'idkdu37+demo@gmail.com');
  s_vinalopo uuid := gen_random_uuid(); s_ceramicas uuid := gen_random_uuid(); s_electro uuid := gen_random_uuid();
  a_cemento uuid := gen_random_uuid(); a_tubo uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'no existe la cuenta demo'; end if;
  if not exists (select 1 from subscriptions where user_id = uid and is_internal) then
    raise exception 'la cuenta demo no está marcada como interna';
  end if;

  delete from price_alerts where user_id = uid;
  delete from price_items where user_id = uid and is_manual_override;
  delete from suppliers where user_id = uid and nif in ('B00000001', 'B00000002', 'B00000003');

  update profiles set full_name = 'Lucía Ferrer', business_name = 'Reformas Alcor',
    company_name = 'Reformas Alcor', city = 'Elche', province = 'Alicante'
  where id = uid;

  insert into fiscal_settings (user_id, business_name, nif, address, city, postal_code, province,
    country_code, email, phone, default_iva_percent, invoice_series, invoice_next_number)
  values (uid, 'Reformas Alcor', 'B00000000', 'Calle Ejemplo 12', 'Elche', '03200', 'Alicante',
    'ES', 'hola@reformas-alcor.example', '600 000 000', 21, 'F', 9)
  on conflict (user_id) do update set business_name = excluded.business_name;

  insert into suppliers (id, user_id, name, nif, email, phone, trade, status, type) values
    (s_vinalopo, uid, 'Almacenes Vinalopó', 'B00000001', 'pedidos@vinalopo.example', '600 000 201', 'Materiales de obra', 'active', 'proveedor'),
    (s_ceramicas, uid, 'Cerámicas Levante', 'B00000002', 'ventas@ceramicas.example', '600 000 202', 'Cerámica y baño', 'active', 'proveedor'),
    (s_electro, uid, 'Electro Baix', 'B00000003', 'tienda@electrobaix.example', '600 000 203', 'Electricidad y fontanería', 'active', 'proveedor');

  -- Precios fijados por la usuaria: mandan sobre cualquier otro (b1).
  insert into price_items (user_id, name, category, unit, unit_price, sector, supplier_name, source_type, is_manual_override, is_active, captured_at) values
    (uid, 'Plato de ducha resina rectangular blanco 80x120 cm', 'material', 'ud', 245, 'construccion', 'Cerámicas Levante', 'manual', true, true, now() - interval '20 days'),
    (uid, 'Suelo porcelánico 60x60 cm', 'material', 'm2', 24.5, 'construccion', 'Cerámicas Levante', 'manual', true, true, now() - interval '20 days'),
    (uid, 'Mano de obra oficial de primera', 'mano_obra', 'h', 28, 'construccion', null, 'manual', true, true, now() - interval '20 days'),
    (uid, 'Adhesivo cementoso flexible C2TE gris saco 25 kg', 'material', 'sacos', 12.9, 'construccion', 'Almacenes Vinalopó', 'manual', true, true, now() - interval '20 days');

  insert into price_alerts (id, user_id, product_name, provider_name, alert_type, threshold_pct, reference_price, last_price, is_active) values
    (a_cemento, uid, 'Cemento cola C2TE 25 kg', 'Almacenes Vinalopó', 'threshold_pct', 5, 12.90, 14.06, true),
    (a_tubo, uid, 'Tubo multicapa 16 mm (rollo 100 m)', 'Electro Baix', 'threshold_pct', 5, 118.00, 125.10, true);
end $$;
