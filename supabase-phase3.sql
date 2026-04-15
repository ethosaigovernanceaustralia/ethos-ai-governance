-- ============================================================
-- ETHOS AI GOVERNANCE — Phase 3 Migration
-- Run in Supabase Dashboard > SQL Editor
-- Covers:
--   1. Add notification_prefs JSONB column to profiles
--   2. Create messages table + RLS policies
-- ============================================================


-- ─── 1. Add notification_prefs to profiles ───────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
    "new_message": true,
    "new_action_item": true,
    "action_item_completed": true,
    "progress_update": true,
    "new_document": true
  }';


-- ─── 2. Create messages table ────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_role  TEXT NOT NULL CHECK (sender_role IN ('client', 'admin')),
  body         TEXT,
  document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Client: read all messages in their own thread
CREATE POLICY "messages_client_read" ON messages
  FOR SELECT USING (client_id = auth.uid());

-- Client: insert messages as themselves (client role only)
CREATE POLICY "messages_client_insert" ON messages
  FOR INSERT WITH CHECK (
    client_id   = auth.uid() AND
    sender_id   = auth.uid() AND
    sender_role = 'client'
  );

-- Client: mark messages as read (update is_read)
CREATE POLICY "messages_client_update" ON messages
  FOR UPDATE USING (client_id = auth.uid());

-- Admin: full access to all messages
CREATE POLICY "messages_admin_all" ON messages
  FOR ALL USING (is_admin());
