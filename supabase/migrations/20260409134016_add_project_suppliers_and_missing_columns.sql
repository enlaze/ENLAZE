
-- Añadir columnas que faltan en suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'proveedor';
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS hourly_rate numeric DEFAULT 0;

-- Habilitar RLS en suppliers si no lo está
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para suppliers (solo si no existen)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Users can view own suppliers') THEN
    CREATE POLICY "Users can view own suppliers" ON public.suppliers FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Users can insert own suppliers') THEN
    CREATE POLICY "Users can insert own suppliers" ON public.suppliers FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Users can update own suppliers') THEN
    CREATE POLICY "Users can update own suppliers" ON public.suppliers FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Users can delete own suppliers') THEN
    CREATE POLICY "Users can delete own suppliers" ON public.suppliers FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Tabla de asignaciones proveedor ↔ obra
CREATE TABLE public.project_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text DEFAULT '',
  agreed_price numeric DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, supplier_id)
);

ALTER TABLE public.project_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project_suppliers"
  ON public.project_suppliers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own project_suppliers"
  ON public.project_suppliers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own project_suppliers"
  ON public.project_suppliers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own project_suppliers"
  ON public.project_suppliers FOR DELETE USING (auth.uid() = user_id);

-- Vincular facturas a proveedores
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
