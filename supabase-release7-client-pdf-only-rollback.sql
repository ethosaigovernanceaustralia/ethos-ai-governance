-- Rollback for supabase-release7-client-pdf-only.sql: restores the release 2
-- client insert policy (any bucket-allowed type: PDF, .doc, .docx).
drop policy if exists client_documents_client_insert on storage.objects;
create policy client_documents_client_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.engagements e
                 where e.client_id = auth.uid() and e.status = 'active')
    and (select u.objects from public.my_client_storage_usage() u(objects, bytes)) < 200
    and (select u.bytes from public.my_client_storage_usage() u(objects, bytes)) < 262144000
  );
