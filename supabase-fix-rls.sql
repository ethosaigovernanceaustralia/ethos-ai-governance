-- ============================================================
-- ETHOS — RLS Fix: drop recursive policies, add is_admin()
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── 1. Drop all existing admin policies ──────────────────────

DROP POLICY IF EXISTS "profiles_admin_read"    ON profiles;
DROP POLICY IF EXISTS "profiles_admin_update"  ON profiles;
DROP POLICY IF EXISTS "profiles_admin_insert"  ON profiles;
DROP POLICY IF EXISTS "engagements_admin_read" ON engagements;
DROP POLICY IF EXISTS "engagements_admin_write" ON engagements;
DROP POLICY IF EXISTS "documents_admin_all"    ON documents;
DROP POLICY IF EXISTS "enquiries_admin_read"   ON enquiries;
DROP POLICY IF EXISTS "enquiries_admin_update" ON enquiries;


-- ─── 2. Create security-definer helper (bypasses RLS) ─────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;


-- ─── 3. Recreate all admin policies using is_admin() ──────────

CREATE POLICY "profiles_admin_read" ON profiles
  FOR SELECT USING (is_admin());

CREATE POLICY "profiles_admin_update" ON profiles
  FOR UPDATE USING (is_admin());

CREATE POLICY "profiles_admin_insert" ON profiles
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "engagements_admin_read" ON engagements
  FOR SELECT USING (is_admin());

CREATE POLICY "engagements_admin_write" ON engagements
  FOR ALL USING (is_admin());

CREATE POLICY "documents_admin_all" ON documents
  FOR ALL USING (is_admin());

CREATE POLICY "enquiries_admin_read" ON enquiries
  FOR SELECT USING (is_admin());

CREATE POLICY "enquiries_admin_update" ON enquiries
  FOR UPDATE USING (is_admin());
