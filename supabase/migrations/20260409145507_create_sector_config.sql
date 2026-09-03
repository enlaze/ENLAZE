
-- Sector configuration table: defines per-sector UI/UX customization
CREATE TABLE sector_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sector_key TEXT NOT NULL UNIQUE,          -- 'construccion', 'servicios', 'comercio', 'instalaciones'
  sector_label TEXT NOT NULL,               -- Display name
  description TEXT,
  
  -- Sidebar modules: which nav items are visible and their labels
  sidebar_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example: [{"key":"projects","label":"Obras","icon":"🏗️","visible":true}, ...]
  
  -- Dynamic labels: override default labels across the app
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"project":"Obra","projects":"Obras","supplier":"Proveedor","order":"Pedido",...}
  
  -- Form fields: which fields appear in forms, per entity
  form_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"project":{"location":true,"plot_number":true,"license_number":true},...}
  
  -- Dropdown options: sector-specific select options
  dropdown_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"trades":["Albañilería","Fontanería",...],"project_types":["Reforma integral",...]}
  
  -- Default fiscal settings
  default_iva_percent NUMERIC(5,2) DEFAULT 21,
  default_irpf_percent NUMERIC(5,2) DEFAULT 0,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User's selected sector
ALTER TABLE fiscal_settings ADD COLUMN IF NOT EXISTS sector_key TEXT DEFAULT 'construccion' REFERENCES sector_config(sector_key);

-- RLS
ALTER TABLE sector_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sector_config_read" ON sector_config FOR SELECT USING (true);

-- Insert preset: Construcción / Reformas
INSERT INTO sector_config (sector_key, sector_label, description, sidebar_modules, labels, form_fields, dropdown_options, default_iva_percent, default_irpf_percent) VALUES (
  'construccion',
  'Construcción / Reformas',
  'Gestión de obras, reformas integrales, rehabilitación y construcción nueva',
  '[
    {"key":"clients","label":"Clientes","icon":"👥","visible":true,"href":"/dashboard"},
    {"key":"messages","label":"WhatsApp","icon":"💬","visible":true,"href":"/dashboard/messages"},
    {"key":"emails","label":"Emails","icon":"📧","visible":true,"href":"/dashboard/emails"},
    {"key":"budgets","label":"Presupuestos","icon":"📋","visible":true,"href":"/dashboard/budgets"},
    {"key":"prices","label":"Banco precios","icon":"💰","visible":true,"href":"/dashboard/prices"},
    {"key":"projects","label":"Obras","icon":"🏗️","visible":true,"href":"/dashboard/projects"},
    {"key":"suppliers","label":"Proveedores","icon":"🔧","visible":true,"href":"/dashboard/suppliers"},
    {"key":"orders","label":"Pedidos","icon":"📦","visible":true,"href":"/dashboard/orders"},
    {"key":"delivery_notes","label":"Albaranes","icon":"📄","visible":true,"href":"/dashboard/delivery-notes"},
    {"key":"received_invoices","label":"Facturas recibidas","icon":"🧾","visible":true,"href":"/dashboard/facturas"},
    {"key":"issued_invoices","label":"Facturas emitidas","icon":"📑","visible":true,"href":"/dashboard/issued-invoices"},
    {"key":"margins","label":"Márgenes","icon":"📊","visible":true,"href":"/dashboard/margins"},
    {"key":"calendar","label":"Calendario","icon":"📅","visible":true,"href":"/dashboard/calendar"},
    {"key":"settings","label":"Ajustes","icon":"⚙️","visible":true,"href":"/dashboard/settings"}
  ]'::jsonb,
  '{
    "project": "Obra",
    "projects": "Obras",
    "supplier": "Proveedor",
    "suppliers": "Proveedores",
    "order": "Pedido",
    "orders": "Pedidos",
    "delivery_note": "Albarán",
    "delivery_notes": "Albaranes",
    "budget": "Presupuesto",
    "budgets": "Presupuestos",
    "client": "Cliente",
    "clients": "Clientes",
    "margin": "Margen",
    "margins": "Márgenes"
  }'::jsonb,
  '{
    "project": {
      "location": true,
      "plot_number": true,
      "license_number": true,
      "construction_type": true,
      "surface_m2": true,
      "start_date": true,
      "end_date": true
    },
    "supplier": {
      "trade": true,
      "rating": true,
      "insurance_expiry": true,
      "rea_number": true
    }
  }'::jsonb,
  '{
    "trades": ["Albañilería","Fontanería","Electricidad","Pintura","Carpintería","Cerrajería","Cristalería","Climatización","Impermeabilización","Demolición","Estructuras","Cubiertas","Pavimentos","Alicatados","Pladur/Escayola","Jardinería","Piscinas","Domótica","Ascensores","Otro"],
    "project_types": ["Reforma integral","Reforma parcial","Obra nueva","Rehabilitación","Ampliación","Demolición","Mantenimiento","Otro"],
    "project_statuses": ["Pendiente","En curso","Pausada","Finalizada","Cancelada"],
    "units": ["ud","m","m²","m³","kg","l","h","ml","global"]
  }'::jsonb,
  21, 0
);

-- Insert preset: Servicios Profesionales
INSERT INTO sector_config (sector_key, sector_label, description, sidebar_modules, labels, form_fields, dropdown_options, default_iva_percent, default_irpf_percent) VALUES (
  'servicios',
  'Servicios Profesionales',
  'Consultoría, asesoría, diseño, marketing, formación y otros servicios',
  '[
    {"key":"clients","label":"Clientes","icon":"👥","visible":true,"href":"/dashboard"},
    {"key":"messages","label":"WhatsApp","icon":"💬","visible":true,"href":"/dashboard/messages"},
    {"key":"emails","label":"Emails","icon":"📧","visible":true,"href":"/dashboard/emails"},
    {"key":"budgets","label":"Propuestas","icon":"📋","visible":true,"href":"/dashboard/budgets"},
    {"key":"prices","label":"Tarifas","icon":"💰","visible":true,"href":"/dashboard/prices"},
    {"key":"projects","label":"Proyectos","icon":"📁","visible":true,"href":"/dashboard/projects"},
    {"key":"suppliers","label":"Colaboradores","icon":"🤝","visible":true,"href":"/dashboard/suppliers"},
    {"key":"orders","label":"Encargos","icon":"📦","visible":false,"href":"/dashboard/orders"},
    {"key":"delivery_notes","label":"Partes de trabajo","icon":"📄","visible":true,"href":"/dashboard/delivery-notes"},
    {"key":"received_invoices","label":"Facturas recibidas","icon":"🧾","visible":true,"href":"/dashboard/facturas"},
    {"key":"issued_invoices","label":"Facturas emitidas","icon":"📑","visible":true,"href":"/dashboard/issued-invoices"},
    {"key":"margins","label":"Rentabilidad","icon":"📊","visible":true,"href":"/dashboard/margins"},
    {"key":"calendar","label":"Agenda","icon":"📅","visible":true,"href":"/dashboard/calendar"},
    {"key":"settings","label":"Ajustes","icon":"⚙️","visible":true,"href":"/dashboard/settings"}
  ]'::jsonb,
  '{
    "project": "Proyecto",
    "projects": "Proyectos",
    "supplier": "Colaborador",
    "suppliers": "Colaboradores",
    "order": "Encargo",
    "orders": "Encargos",
    "delivery_note": "Parte de trabajo",
    "delivery_notes": "Partes de trabajo",
    "budget": "Propuesta",
    "budgets": "Propuestas",
    "client": "Cliente",
    "clients": "Clientes",
    "margin": "Rentabilidad",
    "margins": "Rentabilidad"
  }'::jsonb,
  '{
    "project": {
      "location": false,
      "plot_number": false,
      "license_number": false,
      "construction_type": false,
      "surface_m2": false,
      "start_date": true,
      "end_date": true,
      "hours_estimated": true,
      "retainer_type": true
    },
    "supplier": {
      "trade": false,
      "specialty": true,
      "rating": true,
      "hourly_rate": true
    }
  }'::jsonb,
  '{
    "specialties": ["Diseño gráfico","Desarrollo web","Marketing digital","Asesoría fiscal","Asesoría laboral","Consultoría estratégica","Formación","Traducción","Fotografía","Arquitectura","Ingeniería","Legal","RRHH","Otro"],
    "project_types": ["Consultoría","Asesoramiento","Diseño","Desarrollo","Formación","Auditoría","Otro"],
    "project_statuses": ["Propuesta","Activo","En pausa","Completado","Cancelado"],
    "units": ["h","ud","mes","sesión","proyecto","global"]
  }'::jsonb,
  21, 15
);

-- Insert preset: Comercio / Retail
INSERT INTO sector_config (sector_key, sector_label, description, sidebar_modules, labels, form_fields, dropdown_options, default_iva_percent, default_irpf_percent) VALUES (
  'comercio',
  'Comercio / Retail',
  'Venta al por mayor y menor, distribución, e-commerce',
  '[
    {"key":"clients","label":"Clientes","icon":"👥","visible":true,"href":"/dashboard"},
    {"key":"messages","label":"WhatsApp","icon":"💬","visible":true,"href":"/dashboard/messages"},
    {"key":"emails","label":"Emails","icon":"📧","visible":true,"href":"/dashboard/emails"},
    {"key":"budgets","label":"Presupuestos","icon":"📋","visible":true,"href":"/dashboard/budgets"},
    {"key":"prices","label":"Catálogo","icon":"💰","visible":true,"href":"/dashboard/prices"},
    {"key":"projects","label":"Operaciones","icon":"📦","visible":false,"href":"/dashboard/projects"},
    {"key":"suppliers","label":"Proveedores","icon":"🔧","visible":true,"href":"/dashboard/suppliers"},
    {"key":"orders","label":"Pedidos","icon":"📦","visible":true,"href":"/dashboard/orders"},
    {"key":"delivery_notes","label":"Albaranes","icon":"📄","visible":true,"href":"/dashboard/delivery-notes"},
    {"key":"received_invoices","label":"Facturas recibidas","icon":"🧾","visible":true,"href":"/dashboard/facturas"},
    {"key":"issued_invoices","label":"Facturas emitidas","icon":"📑","visible":true,"href":"/dashboard/issued-invoices"},
    {"key":"margins","label":"Márgenes","icon":"📊","visible":true,"href":"/dashboard/margins"},
    {"key":"calendar","label":"Calendario","icon":"📅","visible":true,"href":"/dashboard/calendar"},
    {"key":"settings","label":"Ajustes","icon":"⚙️","visible":true,"href":"/dashboard/settings"}
  ]'::jsonb,
  '{
    "project": "Operación",
    "projects": "Operaciones",
    "supplier": "Proveedor",
    "suppliers": "Proveedores",
    "order": "Pedido",
    "orders": "Pedidos",
    "delivery_note": "Albarán",
    "delivery_notes": "Albaranes",
    "budget": "Presupuesto",
    "budgets": "Presupuestos",
    "client": "Cliente",
    "clients": "Clientes",
    "margin": "Margen",
    "margins": "Márgenes"
  }'::jsonb,
  '{
    "project": {
      "location": false,
      "plot_number": false,
      "license_number": false,
      "construction_type": false,
      "surface_m2": false,
      "start_date": true,
      "end_date": true
    },
    "supplier": {
      "trade": false,
      "category": true,
      "rating": true,
      "min_order_amount": true,
      "lead_time_days": true
    }
  }'::jsonb,
  '{
    "categories": ["Alimentación","Electrónica","Textil","Hogar","Belleza","Deportes","Papelería","Ferretería","Juguetes","Otro"],
    "project_types": ["Venta puntual","Pedido recurrente","Distribución","Importación","Exportación","Otro"],
    "project_statuses": ["Pendiente","En proceso","Enviado","Entregado","Cancelado"],
    "units": ["ud","caja","palet","kg","l","m","pack","global"]
  }'::jsonb,
  21, 0
);

-- Insert preset: Instalaciones / Mantenimiento
INSERT INTO sector_config (sector_key, sector_label, description, sidebar_modules, labels, form_fields, dropdown_options, default_iva_percent, default_irpf_percent) VALUES (
  'instalaciones',
  'Instalaciones / Mantenimiento',
  'Climatización, electricidad, fontanería, telecomunicaciones, mantenimiento industrial',
  '[
    {"key":"clients","label":"Clientes","icon":"👥","visible":true,"href":"/dashboard"},
    {"key":"messages","label":"WhatsApp","icon":"💬","visible":true,"href":"/dashboard/messages"},
    {"key":"emails","label":"Emails","icon":"📧","visible":true,"href":"/dashboard/emails"},
    {"key":"budgets","label":"Presupuestos","icon":"📋","visible":true,"href":"/dashboard/budgets"},
    {"key":"prices","label":"Banco precios","icon":"💰","visible":true,"href":"/dashboard/prices"},
    {"key":"projects","label":"Instalaciones","icon":"🔌","visible":true,"href":"/dashboard/projects"},
    {"key":"suppliers","label":"Proveedores","icon":"🔧","visible":true,"href":"/dashboard/suppliers"},
    {"key":"orders","label":"Pedidos","icon":"📦","visible":true,"href":"/dashboard/orders"},
    {"key":"delivery_notes","label":"Albaranes","icon":"📄","visible":true,"href":"/dashboard/delivery-notes"},
    {"key":"received_invoices","label":"Facturas recibidas","icon":"🧾","visible":true,"href":"/dashboard/facturas"},
    {"key":"issued_invoices","label":"Facturas emitidas","icon":"📑","visible":true,"href":"/dashboard/issued-invoices"},
    {"key":"margins","label":"Márgenes","icon":"📊","visible":true,"href":"/dashboard/margins"},
    {"key":"calendar","label":"Calendario","icon":"📅","visible":true,"href":"/dashboard/calendar"},
    {"key":"settings","label":"Ajustes","icon":"⚙️","visible":true,"href":"/dashboard/settings"}
  ]'::jsonb,
  '{
    "project": "Instalación",
    "projects": "Instalaciones",
    "supplier": "Proveedor",
    "suppliers": "Proveedores",
    "order": "Pedido",
    "orders": "Pedidos",
    "delivery_note": "Albarán",
    "delivery_notes": "Albaranes",
    "budget": "Presupuesto",
    "budgets": "Presupuestos",
    "client": "Cliente",
    "clients": "Clientes",
    "margin": "Margen",
    "margins": "Márgenes"
  }'::jsonb,
  '{
    "project": {
      "location": true,
      "plot_number": false,
      "license_number": true,
      "construction_type": false,
      "surface_m2": true,
      "start_date": true,
      "end_date": true,
      "installation_type": true,
      "warranty_months": true
    },
    "supplier": {
      "trade": true,
      "rating": true,
      "insurance_expiry": true,
      "certification": true
    }
  }'::jsonb,
  '{
    "trades": ["Climatización","Electricidad","Fontanería","Gas","Telecomunicaciones","Seguridad","Energía solar","Domótica","Ascensores","Contraincendios","Mantenimiento industrial","Otro"],
    "project_types": ["Instalación nueva","Mantenimiento preventivo","Mantenimiento correctivo","Reparación","Ampliación","Certificación","Otro"],
    "project_statuses": ["Pendiente","En curso","En pausa","Finalizada","En garantía","Cancelada"],
    "units": ["ud","m","m²","kg","l","h","ml","global"]
  }'::jsonb,
  10, 0
);
