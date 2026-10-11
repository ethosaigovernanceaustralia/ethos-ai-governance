-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 4: document access by engagement state (audit lead
-- documents-rls-ignores-client-lifecycle-state). Mike's decision, 11 October
-- 2026: clients keep access in every engagement state except refunded; after a
-- refund they keep only the files they uploaded themselves. Uploading already
-- requires an active engagement (release 2 and documents_client_insert).
-- Rollback: supabase-release4-document-lifecycle-rollback.sql
-- ════════════════════════════════════════════════════════════════════════

alter policy documents_client_read on public.documents
  using (exists (
    select 1 from public.engagements e
     where e.id = documents.engagement_id
       and e.client_id = auth.uid()
       and (e.status <> 'refunded' or documents.uploaded_by = auth.uid())
  ));

alter policy client_documents_client_read on storage.objects
  using (
    bucket_id = 'client-documents'
    and exists (select 1 from public.documents d
                  join public.engagements e on e.id = d.engagement_id
                 where d.file_path = objects.name
                   and e.client_id = auth.uid()
                   and (e.status <> 'refunded' or d.uploaded_by = auth.uid()))
  );
