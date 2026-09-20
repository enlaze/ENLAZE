-- Tenant isolation for portal_tokens.
--
-- 20260410135451 and 20260411114536 (both applied) created FOR ALL policies whose
-- USING clause is "created_by = auth.uid() OR project_id IN (own projects)". A
-- FOR ALL policy with no WITH CHECK reuses its USING clause for INSERT, and the
-- OR makes the created_by branch sufficient on its own: any authenticated user
-- could write a row naming another owner's project, choosing its permissions and
-- leaving it without expiry. Those migrations are applied, so this corrects them
-- forward rather than rewriting them.
--
-- It is numbered before 20260915150000 on purpose: portal_read_snapshot is
-- SECURITY DEFINER and would hand such a row the whole project, so this must be
-- appliable on its own and first.
begin;
set local lock_timeout = '5s';

drop policy if exists "Users manage their portal tokens" on public.portal_tokens;
drop policy if exists portal_tokens_user on public.portal_tokens;

-- These two are permissive SELECT policies with no role restriction, so they also
-- apply to authenticated and OR with anything below: without dropping them here,
-- one owner could still read every active link, including other owners'. They are
-- dropped again by 20260915150000; both statements are idempotent, and this one
-- has to be here so that isolation does not depend on that later migration.
drop policy if exists "Public portal token read" on public.portal_tokens;
drop policy if exists portal_tokens_anon_read on public.portal_tokens;

-- Ownership of project_id decides, in both directions. WITH CHECK is explicit
-- rather than inherited so an INSERT or UPDATE cannot name a foreign project.
create policy portal_tokens_owner on public.portal_tokens
  for all to authenticated
  using      (project_id in (select id from public.projects where user_id = auth.uid()))
  with check (project_id in (select id from public.projects where user_id = auth.uid()));

-- An invariant RLS cannot give us. The issuance RPC will be SECURITY DEFINER and
-- therefore runs with RLS bypassed, so a bug there could still forge a row whose
-- created_by does not own the project. This refuses it at the table, for every
-- role, which is what keeps a forged token from ever becoming a readable snapshot.
create function public.portal_tokens_require_owner()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  -- Access accounting updates last_accessed_at and access_count on every portal
  -- visit. Leave the identity columns alone and there is nothing to re-check.
  if tg_op = 'UPDATE'
     and new.project_id is not distinct from old.project_id
     and new.created_by is not distinct from old.created_by then
    return new;
  end if;
  if new.created_by is null then
    raise exception 'portal_tokens.created_by is required' using errcode = '23502';
  end if;
  if not exists (select 1 from public.projects p
      where p.id = new.project_id and p.user_id = new.created_by) then
    raise exception 'portal_tokens must be issued by the owner of its project'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

revoke all on function public.portal_tokens_require_owner()
  from public, anon, authenticated, service_role;

create trigger portal_tokens_require_owner
  before insert or update on public.portal_tokens
  for each row execute function public.portal_tokens_require_owner();

-- Least privilege: no application path writes this table. The portal reader
-- accounts for accesses through a SECURITY DEFINER function, the dashboard only
-- reads, and account deletion runs as service_role, whose grants are untouched.
-- Issuance will arrive as its own RPC, which is where permissions and expiry get
-- validated. SELECT stays so an owner can still list their own links.
revoke insert, update, delete on public.portal_tokens from anon, authenticated;

notify pgrst, 'reload schema';
commit;
