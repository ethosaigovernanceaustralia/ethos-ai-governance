-- Rollback for supabase-release4-document-lifecycle.sql (restores release 2 / original rules).
alter policy documents_client_read on public.documents
  using (exists (
    select 1 from public.engagements e
     where e.id = documents.engagement_id and e.client_id = auth.uid()
  ));

alter policy client_documents_client_read on storage.objects
  using (
    bucket_id = 'client-documents'
    and exists (select 1 from public.documents d
                  join public.engagements e on e.id = d.engagement_id
                 where d.file_path = objects.name and e.client_id = auth.uid())
  );
