
-- ═══════════════════════════════════════════════════════
-- PHASE 10: Agent Comercio Local — Tables
-- ═══════════════════════════════════════════════════════

-- 1. Daily summary
CREATE TABLE IF NOT EXISTS agent_daily_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid,
  execution_date date NOT NULL DEFAULT CURRENT_DATE,
  headline text,
  priority_actions jsonb DEFAULT '[]',
  opportunities_count int DEFAULT 0,
  risks_count int DEFAULT 0,
  score int DEFAULT 0,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_daily_summary ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_daily_summary" ON agent_daily_summary
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. News
CREATE TABLE IF NOT EXISTS agent_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text,
  title text NOT NULL,
  summary text,
  source text,
  url text,
  published_date date,
  category text,
  relevance int DEFAULT 5,
  tags text[] DEFAULT '{}',
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_news ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_news" ON agent_news
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Signals (competencia, stock, márgenes, etc.)
CREATE TABLE IF NOT EXISTS agent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  source_entity text,
  title text NOT NULL,
  detail text,
  severity text DEFAULT 'info',
  opportunity text,
  action_suggested text,
  acknowledged boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_signals" ON agent_signals
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Reviews
CREATE TABLE IF NOT EXISTS agent_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text DEFAULT 'google',
  author text,
  rating int,
  text_content text,
  review_date date,
  sentiment text,
  themes text[] DEFAULT '{}',
  responded boolean DEFAULT false,
  suggested_response text,
  urgent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_reviews" ON agent_reviews
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Campaigns / Marketing ideas
CREATE TABLE IF NOT EXISTS agent_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  type text,
  channel text[] DEFAULT '{}',
  target_audience text,
  suggested_date date,
  message_draft text,
  reason text,
  status text DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'active', 'completed', 'dismissed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_campaigns" ON agent_campaigns
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Leads (prospección automática)
CREATE TABLE IF NOT EXISTS agent_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  business_type text,
  city text,
  zone text,
  place_id text,
  score int DEFAULT 0,
  priority text DEFAULT 'cold' CHECK (priority IN ('hot', 'warm', 'cold')),
  issues text[] DEFAULT '{}',
  opportunity text,
  recommendation text,
  status text DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'converted', 'lost', 'dismissed')),
  contacted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE agent_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_leads" ON agent_leads
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Agent tasks (tareas generadas por el agente)
CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  entity_type text,
  entity_id text,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users own agent_tasks" ON agent_tasks
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_agent_summary_date ON agent_daily_summary(user_id, execution_date);
CREATE INDEX IF NOT EXISTS idx_agent_news_user ON agent_news(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_signals_user ON agent_signals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_user ON agent_reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_campaigns_user ON agent_campaigns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_leads_user ON agent_leads(user_id, priority);
CREATE INDEX IF NOT EXISTS idx_agent_leads_place ON agent_leads(place_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id, status);
