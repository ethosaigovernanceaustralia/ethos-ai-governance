-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 6: append-only audit trail of privileged changes (F19)
-- Records who changed what on sensitive tables: table, operation, row id,
-- the names of the columns that changed, the acting user and database role.
-- No column VALUES are stored, so the log holds no personal data beyond ids.
-- Admins can read it; nobody can edit or delete it through the API (service
-- role and the database owner still can, as with any table).
-- Rollback: supabase-release6-audit-log-rollback.sql
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  actor            uuid,          -- auth.uid() of the caller; null for server/system
  actor_role       text not null, -- database role: authenticated, service_role, postgres
  table_name       text not null,
  op               text not null,
  row_id           text,
  changed_columns  text[]
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed text[];
  rid text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
      from jsonb_each(to_jsonb(new)) n
     where n.value is distinct from (to_jsonb(old) -> n.key);
    -- Ignore no-op updates and pure timestamp refreshes.
    if changed is null or changed <@ array['updated_at'] then
      return null;
    end if;
    rid := to_jsonb(new) ->> 'id';
  elsif tg_op = 'INSERT' then
    rid := to_jsonb(new) ->> 'id';
  else
    rid := to_jsonb(old) ->> 'id';
  end if;
  insert into public.audit_log (actor, actor_role, table_name, op, row_id, changed_columns)
  -- current_user is the function owner here (SECURITY DEFINER); the session's
  -- role setting still names the caller: authenticated, anon or service_role.
  values (auth.uid(), coalesce(nullif(current_setting('role', true), 'none'), session_user),
          tg_table_name, tg_op, rid, changed);
  return null;
end
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'engagements', 'product_access', 'invoices', 'enquiries',
                           'documents', 'bookings', 'availability_rules', 'availability_overrides',
                           'booking_settings', 'consents']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end
$$;
