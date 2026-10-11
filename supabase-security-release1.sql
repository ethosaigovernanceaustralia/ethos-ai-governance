-- ════════════════════════════════════════════════════════════════════════
-- Ethos security release 1: database part (P1, P4 and the database half of P6)
-- Written 11 October 2026 against the live catalog captured that day
-- (upgrade-evidence/2026-10-11-supabase-baseline/catalog-baseline.json).
-- Tested on the isolated replica project only. NOT applied to production.
-- Rollback: supabase-security-release1-rollback.sql
--
-- Legitimate browser writes this keeps working (from portal.js/dashboard.html):
--   profiles      client: full_name, company_name, notification_prefs, updated_at
--   action_items  client: status, updated_at          (admin: any field)
--   messages      client: is_read on admin-sent rows  (admin: any field)
--   messages      insert: client_id, sender_id, sender_role, body, document_id
--   enquiries     insert: the nine form fields; id/status/created_at are server-owned
-- Admins and the service role are not restricted by the guards below.
-- ════════════════════════════════════════════════════════════════════════

-- ─── Shared guard: non-privileged callers may change only listed columns ───
create or replace function public.enforce_client_column_allowlist()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception 'Only these fields can be changed: %', array_to_string(tg_argv, ', ')
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function public.enforce_client_column_allowlist() from public, anon, authenticated;

-- ─── P1: profiles ─────────────────────────────────────────────────────────
-- Keeps the 10 October role/email trigger as a second layer.
create trigger profiles_client_allowlist
  before update on public.profiles
  for each row execute function public.enforce_client_column_allowlist(
    'full_name', 'company_name', 'notification_prefs', 'updated_at');

alter policy profiles_self_update on public.profiles
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Profiles are created by the service role only; nothing in the browser inserts them.
revoke insert, update, delete on public.profiles from anon;

-- ─── P4: action items ────────────────────────────────────────────────────
create trigger action_items_client_allowlist
  before update on public.action_items
  for each row execute function public.enforce_client_column_allowlist('status', 'updated_at');

alter policy action_items_client_update on public.action_items
  using ((client_id = auth.uid()) and (assigned_to = 'client'))
  with check ((client_id = auth.uid()) and (assigned_to = 'client'));

-- ─── P4: messages (update) ───────────────────────────────────────────────
create trigger messages_client_allowlist
  before update on public.messages
  for each row execute function public.enforce_client_column_allowlist('is_read');

-- A client marks only messages it received (admin-sent) in its own thread.
alter policy messages_client_update on public.messages
  using ((client_id = auth.uid()) and (sender_role = 'admin'))
  with check ((client_id = auth.uid()) and (sender_role = 'admin'));

-- ─── P4/P6: messages (insert) ────────────────────────────────────────────
-- id, created_at and is_read become server-owned, so ordering and read state cannot be forged.
revoke insert on public.messages from anon, authenticated;
grant insert (client_id, sender_id, sender_role, body, document_id) on public.messages to authenticated;

alter table public.messages
  add constraint messages_body_length check (body is null or char_length(body) <= 10000);

create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at);

create or replace function public.guard_client_message_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  -- An attached document must belong to this client's own engagement.
  if new.document_id is not null and not exists (
    select 1 from documents d join engagements e on e.id = d.engagement_id
    where d.id = new.document_id and e.client_id = new.client_id
  ) then
    raise exception 'Attached document is not available' using errcode = '42501';
  end if;
  -- Per-sender write volume.
  if (select count(*) from messages
      where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many messages; please wait a minute' using errcode = '54000';
  end if;
  if (select count(*) from messages
      where sender_id = new.sender_id and created_at > now() - interval '1 day') >= 300 then
    raise exception 'Daily message limit reached' using errcode = '54000';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_client_message_insert() from public, anon, authenticated;

create trigger messages_client_insert_guard
  before insert on public.messages
  for each row execute function public.guard_client_message_insert();

-- ─── P6 (database half): enquiries ───────────────────────────────────────
-- Server-owned id/status/created_at; bounded text. Anonymous volume limits and the
-- single API entry point (api/submit-enquiry.js) are the application half of P6.
revoke insert, update, delete on public.enquiries from anon;
revoke insert on public.enquiries from authenticated;
grant insert (name, company, email, company_builds, enquiry_prompt, interested_in,
              team_size, existing_governance, additional_notes)
  on public.enquiries to anon, authenticated;

alter table public.enquiries
  add constraint enquiries_field_lengths check (
        char_length(name) between 1 and 200
    and char_length(company) <= 200
    and char_length(email) between 3 and 320 and position('@' in email) > 1
    and char_length(company_builds) <= 2000
    and char_length(enquiry_prompt) <= 5000
    and cardinality(interested_in) <= 10
    and char_length(array_to_string(interested_in, ',')) <= 1000
    and char_length(team_size) <= 50
    and (existing_governance is null or char_length(existing_governance) <= 500)
    and (additional_notes is null or char_length(additional_notes) <= 5000)
  );
