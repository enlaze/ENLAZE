
-- Tabla de proveedores y subcontratas
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  nif text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  address text DEFAULT '',
  contact_person text DEFAULT '',
  trade text DEFAULT '',
  specialty text DEFAULT '',
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  rating integer DEFAULT 0
    CHECK (rating >= 0 AND rating <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own suppliers"
  ON public.suppliers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own suppliers"
  ON public.suppliers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own suppliers"
  ON public.suppliers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own suppliers"
  ON public.suppliers FOR DELETE USING (auth.uid() = user_id);

-- Añadir supplier_id a invoices para vincular facturas a proveedores
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
