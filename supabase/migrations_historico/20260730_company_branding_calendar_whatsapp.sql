-- Company branding and Google Calendar linkage.
-- Safe to run more than once.

alter table public.profiles
  add column if not exists logo_url text;

alter table public.events
  add column if not exists google_event_id text,
  add column if not exists google_html_link text;

create unique index if not exists events_user_google_event_uidx
  on public.events (user_id, google_event_id)
  where google_event_id is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'company-branding',
  'company-branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Company logos are publicly readable" on storage.objects;
create policy "Company logos are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'company-branding');

drop policy if exists "Users upload their own company logo" on storage.objects;
create policy "Users upload their own company logo"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update their own company logo" on storage.objects;
create policy "Users update their own company logo"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their own company logo" on storage.objects;
create policy "Users delete their own company logo"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
