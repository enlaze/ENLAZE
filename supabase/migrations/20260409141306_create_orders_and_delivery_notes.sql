
-- ═══════════════════════════════════════════════════
-- PEDIDOS (orders) — Pedidos a proveedores/subcontratas
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  -- draft | sent | confirmed | partial | received | cancelled
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 21,
  iva_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own orders"
  ON orders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public read orders"
  ON orders FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════
-- LÍNEAS DE PEDIDO (order_lines)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'ud',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own order_lines"
  ON order_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_lines.order_id AND orders.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_lines.order_id AND orders.user_id = auth.uid()));

CREATE POLICY "Public read order_lines"
  ON order_lines FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════
-- ALBARANES (delivery_notes) — Recepción de material/servicio
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  note_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | received | verified | disputed
  reception_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 21,
  iva_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own delivery_notes"
  ON delivery_notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public read delivery_notes"
  ON delivery_notes FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════
-- LÍNEAS DE ALBARÁN (delivery_note_lines)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS delivery_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  order_line_id UUID REFERENCES order_lines(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'ud',
  quantity_expected NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantity_received NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delivery_note_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own delivery_note_lines"
  ON delivery_note_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM delivery_notes WHERE delivery_notes.id = delivery_note_lines.delivery_note_id AND delivery_notes.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM delivery_notes WHERE delivery_notes.id = delivery_note_lines.delivery_note_id AND delivery_notes.user_id = auth.uid()));

CREATE POLICY "Public read delivery_note_lines"
  ON delivery_note_lines FOR SELECT
  USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_project_id ON delivery_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_supplier_id ON delivery_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order_id ON delivery_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice_id ON delivery_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_note_id ON delivery_note_lines(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_order_line_id ON delivery_note_lines(order_line_id);
