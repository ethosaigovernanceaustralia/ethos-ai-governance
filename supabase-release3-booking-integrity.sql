-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 3: booking integrity (security plan P14 / finding F12)
-- Written 11 October 2026. Live had 0 bookings when this was written, so the
-- new constraint needs no clean-up. Rollback: release3 rollback file.
-- ════════════════════════════════════════════════════════════════════════

-- 1. No two confirmed bookings may overlap in time (the existing unique index
--    only stopped identical start times).
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
  where (status = 'confirmed');

-- 2. Replace the weekly schedule in one transaction, so a failed insert can
--    never leave the calendar empty. Called only by the booking API (service role).
create or replace function public.replace_availability_rules(new_rules jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(new_rules) is distinct from 'array' then
    raise exception 'rules must be an array' using errcode = '22023';
  end if;
  delete from public.availability_rules where true;
  insert into public.availability_rules (day_of_week, start_time, end_time, active)
  select r.day_of_week, r.start_time, r.end_time, true
    from jsonb_to_recordset(new_rules) as r(day_of_week smallint, start_time time, end_time time);
end
$$;
revoke execute on function public.replace_availability_rules(jsonb) from public, anon, authenticated;
grant execute on function public.replace_availability_rules(jsonb) to service_role;

-- 3. Lookups for the booking volume limits.
create index if not exists bookings_email_starts_idx on public.bookings (email, starts_at);  -- the API stores emails lowercased
create index if not exists bookings_created_idx on public.bookings (created_at);
