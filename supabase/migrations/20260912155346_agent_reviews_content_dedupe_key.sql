-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA DEL INGEST — agent_reviews
--
-- Cierra lo que dejó pendiente 20260912141703: era la única tabla del payload
-- sin clave, y un reintento del workflow le duplicaba las reseñas.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- agent_reviews — clave: (user_id, platform, author, review_date, texto)
--                 SIN fecha de ejecución
--
-- Es la única tabla sin identificador externo: no llega ningún review id de
-- Google, y el `id` que trae el payload es circular
-- (/api/agent/reputation/summary LEE de agent_reviews y reemite el uuid de
-- nuestra propia fila, no un id de Google). Así que la identidad se toma del
-- contenido, que para una reseña es lo que la define: quién, cuándo y qué dijo.
-- Dos reseñas con el mismo autor, la misma fecha y el mismo texto son la misma
-- reseña.
--
-- `author` y `review_date` son nullable y el ingest los pasa tal cual
-- (`r.date || null`). En un índice único los NULL cuentan como distintos entre
-- sí y no deduplicarían nada, y por eso la clave va en una columna generada con
-- coalesce: el resultado nunca es NULL.
--
-- La fecha de ejecución NO entra en la clave: una reseña es un objeto externo
-- fijo, no una foto del día. Con la fecha dentro, la misma reseña negativa
-- acumularía una fila por cada día que siguiera sin responder. Una fila por
-- reseña, que se va actualizando.
--
-- Nota: `responded` sí viaja en el payload, así que el agente es la fuente de
-- verdad de ese campo. Hoy no hay nada en la app que lo escriba, pero si algún
-- día se añade un botón de «respondida» habrá que sacarlo del payload para que
-- el upsert no lo pise.
-- ───────────────────────────────────────────────────────────────────────────

-- La fecha va como días desde epoch, no como `review_date::text`: el cast de
-- date a text es STABLE (depende de DateStyle), no IMMUTABLE, y Postgres
-- rechaza una columna generada que no lo sea. Restar dos date da un integer,
-- y el cast de integer a text sí es inmutable.
ALTER TABLE public.agent_reviews
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (
    md5(
      coalesce(platform, '') || '|' ||
      coalesce(author, '') || '|' ||
      coalesce((review_date - DATE '1970-01-01')::text, '') || '|' ||
      coalesce(text_content, '')
    )
  ) STORED;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, dedupe_key
    ORDER BY coalesce(created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_reviews
)
DELETE FROM public.agent_reviews t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_reviews_user_item_key
  ON public.agent_reviews (user_id, dedupe_key);
