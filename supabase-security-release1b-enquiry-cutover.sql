-- ════════════════════════════════════════════════════════════════════════
-- Ethos security release 1b: close the direct browser path into enquiries (P6)
-- Apply ONLY after the app release containing api/submit-enquiry.js is live,
-- because that route (service role) becomes the single way enquiries are saved.
-- Before this release no enquiry was saved through the browser path anyway: the
-- contact form sent a non-existent enquiry_type column and omitted required fields.
-- Rollback: recreate the policy and column grants shown at the bottom.
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists enquiries_anon_insert on public.enquiries;
revoke insert on public.enquiries from anon, authenticated;

-- Rollback:
-- create policy enquiries_anon_insert on public.enquiries for insert to public with check (true);
-- grant insert (name, company, email, company_builds, enquiry_prompt, interested_in,
--               team_size, existing_governance, additional_notes) on public.enquiries to anon, authenticated;
