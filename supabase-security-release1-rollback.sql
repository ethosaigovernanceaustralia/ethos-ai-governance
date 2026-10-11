-- Rollback for supabase-security-release1.sql.
-- Restores the policies, grants and triggers exactly as captured live on 11 October 2026.
-- The 10 October profiles_protect_privileged_columns trigger is left in place (separately approved).

drop trigger if exists profiles_client_allowlist on public.profiles;
drop trigger if exists action_items_client_allowlist on public.action_items;
drop trigger if exists messages_client_allowlist on public.messages;
drop trigger if exists messages_client_insert_guard on public.messages;
drop function if exists public.enforce_client_column_allowlist();
drop function if exists public.guard_client_message_insert();

-- The originals had no WITH CHECK clause, so recreate them rather than ALTER.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to public using (auth.uid() = id);
drop policy if exists action_items_client_update on public.action_items;
create policy action_items_client_update on public.action_items for update to public
  using ((client_id = auth.uid()) and (assigned_to = 'client'));
drop policy if exists messages_client_update on public.messages;
create policy messages_client_update on public.messages for update to public using (client_id = auth.uid());

alter table public.messages drop constraint if exists messages_body_length;
drop index if exists public.messages_sender_created_idx;
alter table public.enquiries drop constraint if exists enquiries_field_lengths;

grant all on public.profiles, public.messages, public.enquiries to anon, authenticated;
