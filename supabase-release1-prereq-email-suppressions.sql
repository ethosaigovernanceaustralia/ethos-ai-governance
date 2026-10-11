-- ════════════════════════════════════════════════════════════════════════
-- Ethos release 1 prerequisite: email suppression list
-- supabase-email-suppressions.sql was committed (38b9847) but the table does
-- not exist in the live database (catalog captured 11 October 2026). The
-- unreleased unsubscribe route and recovery cron both need it: without it
-- unsubscribes fail (Spam Act 2003) and the cron stops with an error.
-- Same definition as supabase-email-suppressions.sql, plus no browser grants.
-- Apply before the app deploy. Rollback: drop table public.email_suppressions;
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.email_suppressions (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  source           text not null default 'checkout_recovery',
  unsubscribed_at  timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

drop policy if exists "email_suppressions_admin" on public.email_suppressions;
create policy "email_suppressions_admin" on public.email_suppressions
  for all using (is_admin());

-- Public access goes only through /api/unsubscribe (service key).
revoke all on public.email_suppressions from anon;
