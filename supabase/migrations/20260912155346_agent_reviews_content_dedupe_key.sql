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
