-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 7: clients may upload PDFs only (security F07/P7)
-- The portal already offers clients PDF only, but the client-documents bucket
-- also accepts Word for admin deliverables, so a client calling Storage
-- directly could upload a .doc/.docx (the macro-capable formats). The client
-- insert policy now also requires a .pdf object name and, where Storage has
-- recorded one, a PDF content type. Admin uploads (client_documents_admin_all)
-- are unchanged, so Mike can still share editable Word files.
-- Rollback: supabase-release7-client-pdf-only-rollback.sql
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists client_documents_client_insert on storage.objects;
create policy client_documents_client_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(storage.extension(name)) = 'pdf'
    and coalesce(metadata->>'mimetype', 'application/pdf') = 'application/pdf'
    and exists (select 1 from public.engagements e
                 where e.client_id = auth.uid() and e.status = 'active')
    and (select u.objects from public.my_client_storage_usage() u(objects, bytes)) < 200
    and (select u.bytes from public.my_client_storage_usage() u(objects, bytes)) < 262144000
  );
