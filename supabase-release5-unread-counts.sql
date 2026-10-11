-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 5: exact unread-message counts (production plan Stage 7)
-- The admin portal used to download every unread client message and count in
-- the browser, which goes wrong past the 1000-row cap. This counts in the
-- database. SECURITY INVOKER: row-level security still applies, so an admin
-- sees every client's count and a client only ever sees their own.
-- Rollback: drop function public.unread_counts_by_client();
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.unread_counts_by_client()
returns table (client_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.client_id, count(*)
    from public.messages m
   where m.sender_role = 'client' and not m.is_read
   group by m.client_id
$$;
revoke execute on function public.unread_counts_by_client() from public, anon;
grant execute on function public.unread_counts_by_client() to authenticated;

create index if not exists messages_unread_client_idx
  on public.messages (client_id) where sender_role = 'client' and not is_read;
