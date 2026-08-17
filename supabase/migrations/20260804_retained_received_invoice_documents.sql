-- Corrective migration for review-msds3yvm-150hxk.
--
-- OCR originals that become received_invoices.document_url must survive
-- account deletion for the same fiscal-retention period as the invoice row.
-- Account deletion cleans the owner tree with an exact allow-list containing
-- only objects referenced by stable retained received-invoice rows. Normally
-- these are canonical confirmed objects; a promotion fenced by account
-- deletion may leave its referenced source draft as the retained document.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'received-invoice-documents',
  'received-invoice-documents',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read retained received invoice documents" on storage.objects;
create policy "Users read retained received invoice documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'received-invoice-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Uploads use the authenticated OCR route and service role. There is no
-- client-side DELETE policy: a user cannot silently remove the supporting
-- document while the associated fiscal invoice must still be retained.

commit;
