-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA DEL INGEST — el resto de tablas
--
-- 20260912093000 dejó idempotente agent_daily_summary. Las demás tablas del
-- payload seguían con INSERT puro, así que el reintento que se añadió al nodo
-- "Send to ENLAZE" duplicaba filas en todas ellas.
--
-- Patrón, igual en las cinco tablas que se tocan aquí:
--
--   1. `execution_date date` — la fecha de la ejecución del agente. Ninguna de
--      estas tablas la tenía (solo `created_at`, que es la hora de escritura en
--      la BD, no la del run). Hace falta como columna propia porque un reintento
--      que cruza la medianoche UTC tendría otro `created_at::date` y volvería a
--      duplicar; y porque PostgREST solo admite nombres de columna en
--      `on_conflict`, no expresiones como `created_at::date`.
--
--   2. `dedupe_key text GENERATED ALWAYS AS (md5(...)) STORED` — la identidad
--      del elemento dentro del día. Va como columna generada, no calculada en
--      el route, por tres razones: la regla queda escrita en el esquema y no
--      puede divergir entre los distintos escritores (el ingest y
--      /api/agent/news escriben los dos en agent_news); es NOT NULL por
--      construcción, así que no cae en la trampa de que en un índice único los
--      NULL son todos distintos entre sí y no deduplican nada; y md5 da 32
--      caracteres fijos, sin riesgo de pasarse del tamaño máximo de entrada de
--      un índice btree con un título largo.
--
--   3. Índice UNIQUE (user_id, execution_date, dedupe_key), que es lo que
--      permite el upsert.
--
-- Las columnas que toca el usuario (read, acknowledged, status, completed_at,
-- contacted_at) NO viajan en el payload del ingest, así que el upsert no las
-- pisa: al actualizar solo se escriben las columnas que manda el route.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- agent_news — clave: (user_id, execution_date, url)
--
-- Por qué la URL: `external_id` está a NULL en las 98 filas existentes (el
-- ingest hace `n.id || null` y las noticias no traen id), así que como clave
-- sería inservible. `url`, en cambio, está presente en 98 de 98 y distingue
-- perfectamente: las 98 filas dan 98 combinaciones (user_id, url, día) — cero
-- duplicados del mismo día. `title` vale de respaldo (es NOT NULL) y coincide
-- con la URL en todos los casos medidos (ningún título con dos URLs distintas).
--
-- Por qué la fecha SÍ entra en la clave: 13 URLs aparecen en más de un día de
-- los 10 registrados. Una noticia sigue en el feed varios días y volver a
-- guardarla al día siguiente es legítimo; sin la fecha en la clave, esas 13
-- filas se perderían y las noticias recurrentes no volverían a entrar nunca.
--
-- Sin lower() a propósito: las URLs de Google News son base64, que distingue
-- mayúsculas de minúsculas — normalizar fundiría dos artículos distintos.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_news ADD COLUMN IF NOT EXISTS execution_date date;
UPDATE public.agent_news SET execution_date = created_at::date WHERE execution_date IS NULL;
ALTER TABLE public.agent_news
  ALTER COLUMN execution_date SET DEFAULT current_date,
  ALTER COLUMN execution_date SET NOT NULL;

ALTER TABLE public.agent_news
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (md5(coalesce(nullif(url, ''), title))) STORED;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, execution_date, dedupe_key
    ORDER BY coalesce(created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_news
)
DELETE FROM public.agent_news t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_news_user_date_item_key
  ON public.agent_news (user_id, execution_date, dedupe_key);


-- ───────────────────────────────────────────────────────────────────────────
-- agent_signals — clave: (user_id, execution_date, signal_type + title)
--
-- La tabla está vacía, así que la clave se deduce de cómo la construye el
-- ingest. Las siete familias de señal (regulation, subsidy, competitor,
-- local_event, stock_alert, margin_alert, supplier_alert) solo comparten dos
-- campos siempre presentes y NOT NULL en el esquema: `signal_type` y `title`.
--
-- `source_entity` queda FUERA de la clave aunque parezca el identificador
-- natural, por dos motivos opuestos que se cancelan: en las ayudas es la
-- constante 'ayuda' para todas (dos subvenciones distintas colisionarían y una
-- pisaría a la otra), y en las señales de competencia puede venir vacío
-- (`c.competitor_name || c.name`), lo que en un índice único significa "todas
-- distintas" y no deduplicaría nada. `title` sí distingue en las siete familias:
-- lleva dentro el nombre del producto, del proveedor o del evento.
--
-- Salvedad conocida: el título de margin_alert incluye el porcentaje
-- («Margen bajo: X (12%)»). Un reintento manda el mismo payload y colapsa bien,
-- pero una re-ejecución completa más tarde el mismo día con otro porcentaje
-- creará una segunda fila. Es dato nuevo, no un duplicado de reintento.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_signals ADD COLUMN IF NOT EXISTS execution_date date;
UPDATE public.agent_signals SET execution_date = created_at::date WHERE execution_date IS NULL;
ALTER TABLE public.agent_signals
  ALTER COLUMN execution_date SET DEFAULT current_date,
  ALTER COLUMN execution_date SET NOT NULL;

ALTER TABLE public.agent_signals
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (md5(signal_type || '|' || title)) STORED;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, execution_date, dedupe_key
    ORDER BY coalesce(created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_signals
)
DELETE FROM public.agent_signals t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_signals_user_date_item_key
  ON public.agent_signals (user_id, execution_date, dedupe_key);


-- ───────────────────────────────────────────────────────────────────────────
-- agent_campaigns — clave: (user_id, execution_date, type + title)
--
-- Es la tabla con más duplicados ya acumulados: 53 filas para solo 26
-- combinaciones (user_id, title, día) — 27 duplicados, con hasta 6 copias de la
-- misma campaña el mismo día, el mismo patrón que tenían los briefings.
--
-- `title` es NOT NULL y es lo que identifica una campaña sugerida. Se añade
-- `type` (coalesce a '' porque es nullable) para que dos campañas con el mismo
-- titular pero distinto tipo no se fundan.
--
-- La fecha entra en la clave porque 4 pares (user_id, title) aparecen en más de
-- un día de los 20 registrados: el agente vuelve a proponer la misma campaña
-- otro día y eso es legítimo.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_campaigns ADD COLUMN IF NOT EXISTS execution_date date;
UPDATE public.agent_campaigns SET execution_date = created_at::date WHERE execution_date IS NULL;
ALTER TABLE public.agent_campaigns
  ALTER COLUMN execution_date SET DEFAULT current_date,
  ALTER COLUMN execution_date SET NOT NULL;

ALTER TABLE public.agent_campaigns
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (md5(coalesce(type, '') || '|' || title)) STORED;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, execution_date, dedupe_key
    ORDER BY coalesce(created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_campaigns
)
DELETE FROM public.agent_campaigns t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_campaigns_user_date_item_key
  ON public.agent_campaigns (user_id, execution_date, dedupe_key);


-- ───────────────────────────────────────────────────────────────────────────
-- agent_tasks — clave: (user_id, execution_date, type + entity_id + title)
--
-- Vacía también; la clave sale del payload. `type` y `title` son NOT NULL.
-- Se añade `entity_id` (coalesce a '' porque es nullable) para afinar: dos
-- tareas del mismo tipo y titular sobre entidades distintas — dos "responde al
-- correo" de remitentes distintos — son tareas distintas.
--
-- La fecha entra en la clave porque las tareas son sugerencias que el agente
-- regenera cada día: la misma tarea mañana es una fila nueva, con su propio
-- `status`. Es el comportamiento actual y se conserva.
--
-- `status` y `completed_at` no viajan en el payload, así que completar una tarea
-- sobrevive a un reintento del mismo día.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS execution_date date;
UPDATE public.agent_tasks SET execution_date = created_at::date WHERE execution_date IS NULL;
ALTER TABLE public.agent_tasks
  ALTER COLUMN execution_date SET DEFAULT current_date,
  ALTER COLUMN execution_date SET NOT NULL;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (md5(type || '|' || coalesce(entity_id, '') || '|' || title)) STORED;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, execution_date, dedupe_key
    ORDER BY coalesce(created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_tasks
)
DELETE FROM public.agent_tasks t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_user_date_item_key
  ON public.agent_tasks (user_id, execution_date, dedupe_key);


-- ───────────────────────────────────────────────────────────────────────────
-- agent_leads — clave: (user_id, place_id), SIN fecha
--
-- Aquí la fecha NO debe entrar. Un lead no es una foto del día: es un negocio
-- concreto identificado por su `place_id` de Google, que persiste y se va
-- actualizando (score, prioridad, estado del contacto). Con la fecha en la
-- clave tendríamos una copia del mismo negocio por cada día que el agente lo
-- vuelve a ver, y el `status` que le pone el usuario se perdería cada mañana.
--
-- El route ya intentaba esto a mano (SELECT por place_id y luego UPDATE o
-- INSERT), con la carrera que eso implica; el índice lo vuelve atómico.
--
-- Índice completo, no parcial: en Postgres los NULL son distintos entre sí, así
-- que los leads sin place_id no se bloquean entre ellos. Y tiene que ser
-- completo porque PostgREST genera `ON CONFLICT (cols)` sin el WHERE, que no
-- encajaría con un índice parcial.
-- ───────────────────────────────────────────────────────────────────────────

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, place_id
    ORDER BY coalesce(updated_at, created_at, '-infinity'::timestamptz) DESC, id DESC
  ) AS rn
  FROM public.agent_leads
  WHERE place_id IS NOT NULL
)
DELETE FROM public.agent_leads t USING ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_leads_user_place_key
  ON public.agent_leads (user_id, place_id);


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
