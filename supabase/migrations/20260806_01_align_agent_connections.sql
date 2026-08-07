-- Corrective migration for review-msgawnqb-0jxc3w / review-msgayf0c-eb70cc.
--
-- agent_connections (20260422_agent_connections.sql) only declares
-- id, user_id, module, status, access_token, refresh_token, expires_at,
-- metadata. The application (lib/services/google-api.ts,
-- app/api/auth/google/callback/route.ts, app/api/agent/reputation/summary,
-- app/dashboard/dev/agent-inspector) reads and writes connected,
-- credentials_ref, error_message, last_sync_at and config, which were
-- evidently added directly against a live database and never captured in a
-- migration. This aligns the schema with what the application actually
-- uses, idempotently.

begin;

alter table public.agent_connections
  add column if not exists connected boolean not null default false,
  add column if not exists credentials_ref text,
  add column if not exists error_message text,
  add column if not exists last_sync_at timestamptz,
  add column if not exists config jsonb not null default '{}'::jsonb;

commit;

notify pgrst, 'reload schema';
