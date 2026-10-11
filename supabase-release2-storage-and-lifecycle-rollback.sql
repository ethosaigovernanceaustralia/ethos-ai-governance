-- Rollback for supabase-release2-storage-and-lifecycle.sql.
-- Restores the storage and enquiry policies captured live on 11 October 2026.
-- The lifecycle columns are kept: dropping them would lose archive/bin state
-- and break the admin lists again. Drop them only deliberately:
--   alter table public.profiles drop column archived_at, drop column deleted_at;
--   alter table public.enquiries drop column archived_at, drop column deleted_at;

drop policy if exists client_documents_admin_all on storage.objects;
drop policy if exists client_documents_client_insert on storage.objects;
drop policy if exists client_documents_client_read on storage.objects;
drop policy if exists client_documents_client_delete on storage.objects;
drop function if exists public.my_client_storage_usage();
drop policy if exists enquiries_admin_delete on public.enquiries;
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'client-documents';
