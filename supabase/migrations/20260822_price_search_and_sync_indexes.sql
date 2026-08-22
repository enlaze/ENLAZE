-- Indices de producción para evitar barridos completos del catálogo durante
-- el recálculo y reducir el coste de la comprobación global del rastreador.

CREATE INDEX IF NOT EXISTS idx_pb_products_name_fts
  ON public.pb_products
  USING gin (to_tsvector('spanish'::regconfig, commercial_name));

CREATE INDEX IF NOT EXISTS idx_tech_items_name_fts
  ON public.technical_price_items
  USING gin (to_tsvector('spanish'::regconfig, name));

CREATE INDEX IF NOT EXISTS idx_n8n_updates_manual_sync_lookup
  ON public.n8n_updates (sector, update_type, status, created_at DESC)
  WHERE update_type = 'manual_price_sync';
