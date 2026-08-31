-- Technical project documents used by the AI budget generator.
-- The bucket is private. The server creates a short-lived signed URL only
-- while the selected document is analysed.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-docs',
  'project-docs',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their own project documents" on storage.objects;
create policy "Users upload their own project documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users read their own project documents" on storage.objects;
create policy "Users read their own project documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'project-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update their own project documents" on storage.objects;
create policy "Users update their own project documents"
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'project-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete their own project documents" on storage.objects;
create policy "Users delete their own project documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

alter table public.project_documents
  add column if not exists analysis_status text not null default 'pending',
  add column if not exists analysis_summary text,
  add column if not exists extracted_measurements jsonb not null default '{}'::jsonb;

comment on column public.project_documents.analysis_status is
  'pending, ready, error. Indicates whether the document has been used for technical budget analysis.';
