-- ============================================================
-- ETHOS AI GOVERNANCE — Supabase Database Setup
-- Run this entire script in Supabase Dashboard > SQL Editor
-- ============================================================


-- ─── TABLES ──────────────────────────────────────────────────

-- Profiles (extends auth.users — one row per registered user)
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name     TEXT NOT NULL,
  company_name  TEXT,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Engagements (what tier/service each client is on)
CREATE TABLE IF NOT EXISTS engagements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  engagement_type TEXT NOT NULL CHECK (engagement_type IN (
                    'free_audit', 'toolkit_self_service', 'toolkit_consulting',
                    'retainer', 'iso_pathway')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Documents (metadata for files in Supabase Storage)
CREATE TABLE IF NOT EXISTS documents (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id    UUID REFERENCES engagements(id) ON DELETE CASCADE NOT NULL,
  uploaded_by      UUID REFERENCES profiles(id) NOT NULL,
  file_name        TEXT NOT NULL,
  file_path        TEXT NOT NULL,
  file_size_bytes  BIGINT,
  document_type    TEXT NOT NULL CHECK (document_type IN (
                     'client_upload', 'ethos_deliverable', 'shared_working')),
  description      TEXT,
  scan_status      TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (scan_status IN ('pending_review', 'reviewed', 'flagged')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Enquiries (from the public contact form)
CREATE TABLE IF NOT EXISTS enquiries (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  company             TEXT NOT NULL,
  email               TEXT NOT NULL,
  company_builds      TEXT NOT NULL,
  enquiry_prompt      TEXT NOT NULL,
  interested_in       TEXT[] NOT NULL,
  team_size           TEXT NOT NULL,
  existing_governance TEXT,
  additional_notes    TEXT,
  status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ─── ENABLE ROW LEVEL SECURITY ────────────────────────────────

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries   ENABLE ROW LEVEL SECURITY;


-- ─── RLS: PROFILES ────────────────────────────────────────────

-- Users can read their own profile
CREATE POLICY "profiles_self_read" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "profiles_admin_read" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can update their own profile
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Admins can update any profile
CREATE POLICY "profiles_admin_update" ON profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can insert profiles (for client creation via API)
CREATE POLICY "profiles_admin_insert" ON profiles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Service role can insert profiles (used by invite-client API function)
CREATE POLICY "profiles_service_insert" ON profiles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');


-- ─── RLS: ENGAGEMENTS ─────────────────────────────────────────

-- Clients can read their own engagements
CREATE POLICY "engagements_client_read" ON engagements
  FOR SELECT USING (client_id = auth.uid());

-- Admins can read all engagements
CREATE POLICY "engagements_admin_read" ON engagements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can insert/update/delete engagements
CREATE POLICY "engagements_admin_write" ON engagements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Service role full access (for invite-client function)
CREATE POLICY "engagements_service_write" ON engagements
  FOR ALL USING (auth.role() = 'service_role');


-- ─── RLS: DOCUMENTS ───────────────────────────────────────────

-- Clients can read documents linked to their engagements
CREATE POLICY "documents_client_read" ON documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = engagement_id AND e.client_id = auth.uid()
    )
  );

-- Clients can insert their own uploads only
CREATE POLICY "documents_client_insert" ON documents
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND document_type = 'client_upload'
    AND EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = engagement_id AND e.client_id = auth.uid()
    )
  );

-- Clients can delete their own uploads
CREATE POLICY "documents_client_delete" ON documents
  FOR DELETE USING (
    uploaded_by = auth.uid()
    AND document_type = 'client_upload'
  );

-- Admins can do everything with documents
CREATE POLICY "documents_admin_all" ON documents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ─── RLS: ENQUIRIES ───────────────────────────────────────────

-- Anonymous users can insert enquiries (public form)
CREATE POLICY "enquiries_anon_insert" ON enquiries
  FOR INSERT WITH CHECK (true);

-- Admins can read all enquiries
CREATE POLICY "enquiries_admin_read" ON enquiries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can update enquiry status
CREATE POLICY "enquiries_admin_update" ON enquiries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ─── STORAGE BUCKET ───────────────────────────────────────────
-- Run these in the Supabase Dashboard > Storage > Create Bucket:
-- Bucket name: client-documents
-- Public access: OFF (private)
--
-- Then apply these storage policies in Storage > Policies:

-- (Storage policies are configured via the Supabase Dashboard UI or via the
--  Supabase Management API. See SETUP.md for the storage policy instructions.)


-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER engagements_updated_at
  BEFORE UPDATE ON engagements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── YOUR ADMIN USER ──────────────────────────────────────────
-- After creating your account in the portal, run this to make yourself admin:
-- (Replace 'your@email.com' with your actual email)
--
-- UPDATE profiles SET role = 'admin'
-- WHERE email = 'your@email.com';
