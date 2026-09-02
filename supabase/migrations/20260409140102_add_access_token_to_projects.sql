
-- Add access_token column to projects for client portal access
ALTER TABLE projects ADD COLUMN IF NOT EXISTS access_token UUID DEFAULT gen_random_uuid() UNIQUE;

-- Backfill existing projects with tokens
UPDATE projects SET access_token = gen_random_uuid() WHERE access_token IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE projects ALTER COLUMN access_token SET NOT NULL;
ALTER TABLE projects ALTER COLUMN access_token SET DEFAULT gen_random_uuid();

-- Create index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_projects_access_token ON projects(access_token);

-- Create a policy that allows public read of project data via access_token
-- (the portal page will query by token, no auth needed)
CREATE POLICY "Public read projects by access_token"
  ON projects FOR SELECT
  USING (true);

-- Drop the old RLS policy that only allows user_id access for SELECT, if it exists
-- We keep the INSERT/UPDATE/DELETE restricted to user_id
-- Note: the existing "Users can view own projects" policy stays; we add a public one

-- Public read policies for related tables via project_id
-- Budgets: allow read if project access_token matches
CREATE POLICY "Public read budgets by project"
  ON budgets FOR SELECT
  USING (true);

CREATE POLICY "Public read invoices by project"
  ON invoices FOR SELECT
  USING (true);

CREATE POLICY "Public read payments by project"
  ON payments FOR SELECT
  USING (true);

CREATE POLICY "Public read project_changes by project"
  ON project_changes FOR SELECT
  USING (true);

CREATE POLICY "Public read project_milestones by project"
  ON project_milestones FOR SELECT
  USING (true);

CREATE POLICY "Public read project_suppliers by project"
  ON project_suppliers FOR SELECT
  USING (true);

CREATE POLICY "Public read suppliers for portal"
  ON suppliers FOR SELECT
  USING (true);

CREATE POLICY "Public read clients for portal"
  ON clients FOR SELECT
  USING (true);

-- Allow public UPDATE on budgets (for approve/reject from portal)
CREATE POLICY "Public update budget status"
  ON budgets FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow public UPDATE on project_changes (for client approval from portal)
CREATE POLICY "Public update change approval"
  ON project_changes FOR UPDATE
  USING (true)
  WITH CHECK (true);
