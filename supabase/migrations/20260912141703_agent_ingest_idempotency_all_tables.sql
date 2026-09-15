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
