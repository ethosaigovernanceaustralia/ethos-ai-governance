-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 2: client document storage (P7) and archive/bin columns (P10)
-- Written 11 October 2026 against the live catalog captured that day.
-- Rollback: supabase-release2-storage-and-lifecycle-rollback.sql
--
-- P10: the admin portal filters and updates archived_at/deleted_at on profiles
-- and enquiries, but those columns never existed, so the admin client and
-- enquiry lists returned errors (empty lists) and archive/bin did nothing.
-- Clients cannot change these columns: the release 1 allowlist trigger only
-- lets clients edit full_name, company_name, notification_prefs and updated_at.
--
-- P7: the private client-documents bucket had no storage policies, so clients
-- could neither upload nor download. These policies follow the portal's path
-- layout {client_id}/{uuid}_{name}.
-- ════════════════════════════════════════════════════════════════════════

-- ─── P10: lifecycle columns ──────────────────────────────────────────────
alter table public.profiles
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;
alter table public.enquiries
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- Admin permanent delete of an enquiry (from the bin).
drop policy if exists enquiries_admin_delete on public.enquiries;
create policy enquiries_admin_delete on public.enquiries
  for delete to authenticated using (is_admin());

-- ─── P7: bucket limits ───────────────────────────────────────────────────
update storage.buckets
   set file_size_limit = 52428800,  -- 50 MB, the admin maximum in portal.js
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
 where id = 'client-documents';

-- Caller's own usage in their folder. SECURITY DEFINER so the insert policy can
-- count objects without recursing through storage.objects policies; it only
-- ever reports on auth.uid()'s own folder.
create or replace function public.my_client_storage_usage()
returns table (objects bigint, bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
   where o.bucket_id = 'client-documents'
     and (storage.foldername(o.name))[1] = auth.uid()::text
$$;
revoke execute on function public.my_client_storage_usage() from public, anon;
grant execute on function public.my_client_storage_usage() to authenticated;

-- ─── P7: storage policies ────────────────────────────────────────────────
drop policy if exists client_documents_admin_all on storage.objects;
create policy client_documents_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'client-documents' and public.is_admin())
  with check (bucket_id = 'client-documents' and public.is_admin());

-- Clients upload only into their own folder, with an active engagement, and
-- within 200 files / 250 MB per client (Free plan storage is 1 GB in total).
drop policy if exists client_documents_client_insert on storage.objects;
create policy client_documents_client_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.engagements e
                 where e.client_id = auth.uid() and e.status = 'active')
    and (select u.objects from public.my_client_storage_usage() u) < 200
    and (select u.bytes from public.my_client_storage_usage() u) < 262144000
  );

-- Clients read only files recorded against their own engagements.
drop policy if exists client_documents_client_read on storage.objects;
create policy client_documents_client_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-documents'
    and exists (select 1 from public.documents d
                  join public.engagements e on e.id = d.engagement_id
                 where d.file_path = objects.name and e.client_id = auth.uid())
  );

-- Clients delete only their own uploads (or their own unrecorded leftovers),
-- never Ethos deliverables. No UPDATE policy: nothing can be overwritten.
drop policy if exists client_documents_client_delete on storage.objects;
create policy client_documents_client_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (select 1 from public.documents d
               where d.file_path = objects.name
                 and d.uploaded_by = auth.uid()
                 and d.document_type = 'client_upload')
      or not exists (select 1 from public.documents d where d.file_path = objects.name)
    )
  );
