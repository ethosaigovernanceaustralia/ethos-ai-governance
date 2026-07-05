-- ─── Ethos — Self-Hosted Booking System ──────────────────────────────────────
-- Run in the Supabase SQL editor after supabase-setup.sql (needs is_admin()).
-- Tables: booking_settings, availability_rules, availability_overrides, bookings.
-- Public access goes exclusively through /api/booking (service key). No anon
-- policies: the browser can never read availability rules or other bookings.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── GLOBAL RULES (single row) ────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_settings (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  meeting_duration_mins INT  NOT NULL DEFAULT 30  CHECK (meeting_duration_mins BETWEEN 5 AND 240),
  buffer_mins           INT  NOT NULL DEFAULT 0   CHECK (buffer_mins BETWEEN 0 AND 120),
  min_notice_hours      INT  NOT NULL DEFAULT 24  CHECK (min_notice_hours BETWEEN 0 AND 336),
  max_days_ahead        INT  NOT NULL DEFAULT 30  CHECK (max_days_ahead BETWEEN 1 AND 365),
  timezone              TEXT NOT NULL DEFAULT 'Australia/Sydney',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO booking_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── RECURRING WEEKLY HOURS ───────────────────────────────────
-- day_of_week: 0 = Sunday … 6 = Saturday (matches JS Date.getDay()).
-- Multiple rows per day allowed (e.g. 10:00–12:00 and 14:00–16:00).
CREATE TABLE IF NOT EXISTS availability_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time < end_time)
);

-- Default availability: Monday to Friday, 10:00–16:00 Sydney time.
-- Edit in the admin portal (or here) once live.
INSERT INTO availability_rules (day_of_week, start_time, end_time)
SELECT d, '10:00'::time, '16:00'::time FROM generate_series(1, 5) AS d
WHERE NOT EXISTS (SELECT 1 FROM availability_rules);

-- ─── PER-DATE OVERRIDES ───────────────────────────────────────
-- 'blocked' removes the whole day; 'custom' replaces the weekly
-- rules for that date with start_time–end_time.
CREATE TABLE IF NOT EXISTS availability_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('blocked', 'custom')),
  start_time TIME,
  end_time   TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (type = 'blocked' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))
);

CREATE INDEX IF NOT EXISTS availability_overrides_date_idx ON availability_overrides (date);

-- ─── BOOKINGS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  company      TEXT,
  notes        TEXT,
  timezone     TEXT,                -- invitee's IANA timezone at booking time
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  CHECK (starts_at < ends_at)
);

-- The database itself prevents double booking, even under a race:
-- two simultaneous inserts for the same slot cannot both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
  ON bookings (starts_at) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON bookings (starts_at);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
-- Admin (via portal session) may manage everything. There are no
-- anon/client policies: public traffic uses /api/booking, which
-- runs on the service key and validates every request itself.
ALTER TABLE booking_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings               ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_settings_admin"       ON booking_settings       FOR ALL USING (is_admin());
CREATE POLICY "availability_rules_admin"     ON availability_rules     FOR ALL USING (is_admin());
CREATE POLICY "availability_overrides_admin" ON availability_overrides FOR ALL USING (is_admin());
CREATE POLICY "bookings_admin"               ON bookings               FOR ALL USING (is_admin());
