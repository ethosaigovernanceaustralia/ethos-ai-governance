// ─── Ethos AI Governance — Supabase Configuration ─────────────────────────
//
// Fill in your Supabase project details below.
// Get these values from: Supabase Dashboard > Project Settings > API
//
// The anon key is safe to include here — security is enforced via Row Level
// Security (RLS) on every table and storage bucket.
//
// NEVER put the service role key in this file. It lives in Vercel env vars only.
// ────────────────────────────────────────────────────────────────────────────

window.SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_ANON_KEY_HERE'
};
