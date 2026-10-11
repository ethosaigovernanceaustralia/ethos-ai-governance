-- ════════════════════════════════════════════════════════════════════════
-- Ethos security release 1c: persisted notification claims (P5)
-- api/send-notification.js records each (event, record) here before emailing,
-- so a notification can be sent at most once per persisted record and upload
-- notifications can be debounced server-side. Service role only: no browser
-- access (RLS on, no policies, grants revoked).
-- Apply before the app release that contains the new send-notification.js.
-- Rollback: drop table public.notification_log;
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_log (
  event      text not null,
  ref_key    text not null,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event, ref_key)
);

alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;

create index if not exists notification_log_client_event_idx
  on public.notification_log (client_id, event, created_at);
