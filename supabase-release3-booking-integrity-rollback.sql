-- Rollback for supabase-release3-booking-integrity.sql.
-- Roll the app back first: the booking API calls replace_availability_rules.
alter table public.bookings drop constraint if exists bookings_no_overlap;
drop function if exists public.replace_availability_rules(jsonb);
drop index if exists public.bookings_email_starts_idx;
drop index if exists public.bookings_created_idx;
