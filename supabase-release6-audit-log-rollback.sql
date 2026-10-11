-- Rollback for supabase-release6-audit-log.sql. Dropping the table discards the
-- audit history; export it first if it may be needed.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'engagements', 'product_access', 'invoices', 'enquiries',
                           'documents', 'bookings', 'availability_rules', 'availability_overrides',
                           'booking_settings', 'consents']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
  end loop;
end
$$;
drop function if exists public.audit_row_change();
-- drop table public.audit_log;  -- only deliberately
