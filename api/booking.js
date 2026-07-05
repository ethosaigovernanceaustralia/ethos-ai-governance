// ─── Ethos — Booking API (consolidated) ───────────────────────────────────────
// One function for the whole booking system (Vercel Hobby caps functions at 12).
//
//   GET  /api/booking?action=slots&year=2026&month=7   → public: open slots
//   POST /api/booking { action: 'book', ... }          → public: create booking
//   POST /api/booking { action: 'admin', op: ... }     → admin (bearer token):
//        overview | save_settings | save_rules | add_override |
//        delete_override | cancel_booking
//
// Slots are computed server-side from availability_rules − overrides −
// confirmed bookings, inside the min-notice/max-days window, in the host
// timezone (booking_settings.timezone), returned as UTC instants. The
// unique index on bookings makes double booking impossible under a race.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ─── Timezone helpers ──────────────────────────────────────────────────────────

function partsInTz(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const out = {};
  parts.forEach(p => { out[p.type] = p.value; });
  return { y: +out.year, m: +out.month, d: +out.day, h: +out.hour % 24, min: +out.minute };
}

// UTC instant for wall-clock y/m/d h:min in tz (two-pass converge, DST-safe).
function zonedToUtc(y, m, d, h, min, tz) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return new Date(guess);
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; }
  catch (e) { return false; }
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── Slot computation ──────────────────────────────────────────────────────────

async function loadConfig(supabase) {
  const [settings, rules, overrides] = await Promise.all([
    supabase.from('booking_settings').select('*').eq('id', 1).single(),
    supabase.from('availability_rules').select('*').eq('active', true),
    supabase.from('availability_overrides').select('*'),
  ]);
  if (settings.error) throw new Error('booking_settings missing: ' + settings.error.message);
  return {
    settings: settings.data,
    rules: rules.data || [],
    overrides: overrides.data || [],
  };
}

// All open slots (UTC Dates) for one host-timezone calendar date.
function slotsForDate(y, m, d, cfg, bookedRanges) {
  const { settings, rules, overrides } = cfg;
  const tz = settings.timezone;
  const dateKey = `${y}-${pad(m)}-${pad(d)}`;

  const dayOverrides = overrides.filter(o => o.date === dateKey);
  if (dayOverrides.some(o => o.type === 'blocked')) return [];

  let windows;
  const custom = dayOverrides.filter(o => o.type === 'custom');
  if (custom.length) {
    windows = custom;
  } else {
    // Weekday of a calendar date is timezone-independent
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    windows = rules.filter(r => r.day_of_week === dow);
  }

  const now = Date.now();
  const earliest = now + settings.min_notice_hours * 3600 * 1000;
  const latest = now + settings.max_days_ahead * 24 * 3600 * 1000;
  const durMs = settings.meeting_duration_mins * 60 * 1000;
  const stepMins = settings.meeting_duration_mins + settings.buffer_mins;

  const slots = [];
  for (const w of windows) {
    const [sh, sm] = w.start_time.split(':').map(Number);
    const [eh, em] = w.end_time.split(':').map(Number);
    for (let mins = sh * 60 + sm; mins + settings.meeting_duration_mins <= eh * 60 + em; mins += stepMins) {
      const start = zonedToUtc(y, m, d, Math.floor(mins / 60), mins % 60, tz);
      const s = start.getTime();
      if (s < earliest || s > latest) continue;
      if (bookedRanges.some(b => s < b.end && s + durMs > b.start)) continue;
      slots.push(start);
    }
  }
  return slots.sort((a, b) => a - b);
}

async function bookedRangesBetween(supabase, fromIso, toIso) {
  const { data, error } = await supabase
    .from('bookings')
    .select('starts_at, ends_at')
    .eq('status', 'confirmed')
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso);
  if (error) throw new Error(error.message);
  return (data || []).map(b => ({
    start: new Date(b.starts_at).getTime(),
    end: new Date(b.ends_at).getTime(),
  }));
}

// ─── Public: slots for a month ─────────────────────────────────────────────────

async function handleSlots(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const year = parseInt(url.searchParams.get('year'), 10);
  const month = parseInt(url.searchParams.get('month'), 10); // 1-indexed
  if (!year || !month || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return res.status(400).json({ error: 'Invalid year/month' });
  }

  const supabase = db();
  const cfg = await loadConfig(supabase);
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthStart = zonedToUtc(year, month, 1, 0, 0, cfg.settings.timezone);
  const monthEnd = zonedToUtc(year, month, daysInMonth, 23, 59, cfg.settings.timezone);
  const booked = await bookedRangesBetween(supabase, monthStart.toISOString(), monthEnd.toISOString());

  const days = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const slots = slotsForDate(year, month, d, cfg, booked);
    if (slots.length) days[`${year}-${pad(month)}-${pad(d)}`] = slots.map(s => s.toISOString());
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ days, durationMins: cfg.settings.meeting_duration_mins });
}

// ─── Public: create a booking ──────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtInTz(instant, tz, opts) {
  return instant.toLocaleString('en-AU', Object.assign({ timeZone: tz }, opts));
}

async function sendEmail(payload) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) console.error('[booking] Resend error:', await response.text());
  } catch (err) {
    console.error('[booking] Email send failed:', err);
  }
}

async function sendBookingEmails(booking, hostTz) {
  const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const inviteeTz = booking.timezone && validTz(booking.timezone) ? booking.timezone : hostTz;

  const dateOpts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const timeOpts = { hour: 'numeric', minute: '2-digit', hour12: true };

  // 1. Admin notification (times in host tz)
  if (NOTIFY_EMAIL) {
    const row = (label, value) =>
      `<tr><td style="padding:8px 0;color:#6b7280;width:180px;vertical-align:top">${label}</td><td style="padding:8px 0;color:#111">${value}</td></tr>`;
    await sendEmail({
      from: 'Ethos Website <hello@ethosaigovernance.com.au>',
      to: [NOTIFY_EMAIL],
      subject: `New booking: ${booking.name}${booking.company ? ' (' + booking.company + ')' : ''} on ${fmtInTz(start, hostTz, { weekday: 'short', day: 'numeric', month: 'short' })}`,
      html: `
        <h2 style="font-family:sans-serif;color:#0D1F3C;margin-bottom:8px">New Discovery Call Booked</h2>
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px">
          ${row('When', `<strong>${fmtInTz(start, hostTz, dateOpts)}</strong><br>${fmtInTz(start, hostTz, timeOpts)} to ${fmtInTz(end, hostTz, timeOpts)} (${hostTz.split('/').pop()} time)`)}
          ${row('Name', `<strong>${esc(booking.name)}</strong>`)}
          ${row('Email', `<a href="mailto:${esc(booking.email)}" style="color:#A8833A">${esc(booking.email)}</a>`)}
          ${row('Company', esc(booking.company) || '&mdash;')}
          ${booking.notes ? row('Notes', esc(booking.notes)) : ''}
          ${row('Their timezone', esc(inviteeTz))}
        </table>
        <p style="font-family:sans-serif;font-size:13px;color:#795912;margin-top:20px"><strong>Action:</strong> send the calendar invite for this meeting.</p>
        <p style="font-family:sans-serif;font-size:12px;color:#9ca3af;margin-top:24px">Ethos AI Governance — ethosaigovernance.com.au</p>`,
    });
  }

  // 2. Invitee confirmation (times in their tz)
  const firstName = booking.name.trim().split(/\s+/)[0];
  await sendEmail({
    from: 'Ethos AI Governance <hello@ethosaigovernance.com.au>',
    to: [booking.email],
    reply_to: NOTIFY_EMAIL || undefined,
    subject: 'Your discovery call is booked',
    html: `
      <div style="font-family:sans-serif;max-width:560px;color:#333">
        <p style="font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#A8833A;margin-bottom:4px">Ethos AI Governance</p>
        <h2 style="font-family:Georgia,serif;color:#0D1F3C;margin:0 0 16px">Your discovery call is booked</h2>
        <p style="font-size:14px;line-height:1.6">Hi ${esc(firstName)},</p>
        <p style="font-size:14px;line-height:1.6">Thank you for booking a discovery call with Ethos. Here are the details:</p>
        <div style="border-left:3px solid #A8833A;background:#f8f7f5;padding:14px 18px;margin:16px 0;font-size:14px;line-height:1.7">
          <strong style="color:#0D1F3C">Discovery call, 30 minutes</strong><br>
          ${fmtInTz(start, inviteeTz, dateOpts)}<br>
          ${fmtInTz(start, inviteeTz, timeOpts)} to ${fmtInTz(end, inviteeTz, timeOpts)} (${esc(inviteeTz.split('/').pop().replace(/_/g, ' '))} time)
        </div>
        <p style="font-size:14px;line-height:1.6">A calendar invite for the meeting will follow shortly.</p>
        <p style="font-size:14px;line-height:1.6">If you need to change or cancel, just reply to this email.</p>
        <p style="font-size:14px;line-height:1.6">Talk soon,<br>Ethos AI Governance</p>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px">ethosaigovernance.com.au</p>
      </div>`,
  });
}

async function handleBook(req, res) {
  const { starts_at, name, email, company, notes, tz } = req.body || {};

  const cleanName = String(name || '').trim().slice(0, 200);
  const cleanEmail = String(email || '').trim().slice(0, 320);
  if (!cleanName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide your name and a valid email address.' });
  }
  const start = new Date(starts_at);
  if (isNaN(start.getTime())) {
    return res.status(400).json({ error: 'Invalid slot time.' });
  }

  const supabase = db();
  const cfg = await loadConfig(supabase);

  // Re-validate server-side: the requested instant must be one of the
  // currently open slots for its host-timezone date.
  const p = partsInTz(start, cfg.settings.timezone);
  const dayStart = zonedToUtc(p.y, p.m, p.d, 0, 0, cfg.settings.timezone);
  const dayEnd = zonedToUtc(p.y, p.m, p.d, 23, 59, cfg.settings.timezone);
  const booked = await bookedRangesBetween(supabase, dayStart.toISOString(), dayEnd.toISOString());
  const open = slotsForDate(p.y, p.m, p.d, cfg, booked);
  if (!open.some(s => s.getTime() === start.getTime())) {
    return res.status(409).json({ error: 'slot_taken' });
  }

  const row = {
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + cfg.settings.meeting_duration_mins * 60000).toISOString(),
    name: cleanName,
    email: cleanEmail,
    company: String(company || '').trim().slice(0, 200) || null,
    notes: String(notes || '').trim().slice(0, 2000) || null,
    timezone: tz && validTz(tz) ? tz : null,
    status: 'confirmed',
  };

  const { data, error } = await supabase.from('bookings').insert(row).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'slot_taken' }); // unique index race
    console.error('[booking] Insert failed:', error.message);
    return res.status(500).json({ error: 'Could not save the booking. Please try again.' });
  }

  // Emails are best-effort: never fail a saved booking over a mail error
  await sendBookingEmails(data, cfg.settings.timezone);

  return res.status(200).json({ ok: true, id: data.id });
}

// ─── Admin operations ──────────────────────────────────────────────────────────

async function requireAdmin(req, supabase) {
  const bearerToken = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!bearerToken) return null;
  const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  return profile && profile.role === 'admin' ? user : null;
}

async function handleAdmin(req, res) {
  const supabase = db();
  const admin = await requireAdmin(req, supabase);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { op } = req.body;

  switch (op) {
    case 'overview': {
      const cfg = await loadConfig(supabase);
      const nowIso = new Date().toISOString();
      const [upcoming, past] = await Promise.all([
        supabase.from('bookings').select('*').gte('starts_at', nowIso).order('starts_at', { ascending: true }),
        supabase.from('bookings').select('*').lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(50),
      ]);
      return res.status(200).json({
        settings: cfg.settings,
        rules: cfg.rules,
        overrides: cfg.overrides,
        upcoming: upcoming.data || [],
        past: past.data || [],
      });
    }

    case 'save_settings': {
      const s = req.body.settings || {};
      const patch = {};
      ['meeting_duration_mins', 'buffer_mins', 'min_notice_hours', 'max_days_ahead'].forEach(k => {
        if (Number.isInteger(s[k])) patch[k] = s[k];
      });
      if (s.timezone && validTz(s.timezone)) patch.timezone = s.timezone;
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from('booking_settings').update(patch).eq('id', 1);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    case 'save_rules': {
      // Full replace: the admin UI sends the complete weekly schedule
      const rules = Array.isArray(req.body.rules) ? req.body.rules : [];
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      const clean = rules
        .filter(r => Number.isInteger(r.day_of_week) && r.day_of_week >= 0 && r.day_of_week <= 6
          && timeRe.test(r.start_time) && timeRe.test(r.end_time) && r.start_time < r.end_time)
        .map(r => ({ day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time, active: true }));
      const del = await supabase.from('availability_rules').delete().gte('day_of_week', 0);
      if (del.error) return res.status(500).json({ error: del.error.message });
      if (clean.length) {
        const ins = await supabase.from('availability_rules').insert(clean);
        if (ins.error) return res.status(500).json({ error: ins.error.message });
      }
      return res.status(200).json({ ok: true });
    }

    case 'add_override': {
      const { date, type, start_time, end_time } = req.body;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || ['blocked', 'custom'].indexOf(type) === -1) {
        return res.status(400).json({ error: 'Invalid override' });
      }
      const row = { date, type };
      if (type === 'custom') { row.start_time = start_time; row.end_time = end_time; }
      const { error } = await supabase.from('availability_overrides').insert(row);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    case 'delete_override': {
      const { error } = await supabase.from('availability_overrides').delete().eq('id', req.body.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    case 'cancel_booking': {
      const { data: booking, error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', req.body.id)
        .eq('status', 'confirmed')
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      if (req.body.notify && booking) {
        const cfg = await loadConfig(supabase);
        const inviteeTz = booking.timezone && validTz(booking.timezone) ? booking.timezone : cfg.settings.timezone;
        const start = new Date(booking.starts_at);
        await sendEmail({
          from: 'Ethos AI Governance <hello@ethosaigovernance.com.au>',
          to: [booking.email],
          reply_to: process.env.NOTIFY_EMAIL || undefined,
          subject: 'Your discovery call has been cancelled',
          html: `
            <div style="font-family:sans-serif;max-width:560px;color:#333">
              <p style="font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#A8833A;margin-bottom:4px">Ethos AI Governance</p>
              <h2 style="font-family:Georgia,serif;color:#0D1F3C;margin:0 0 16px">Your discovery call has been cancelled</h2>
              <p style="font-size:14px;line-height:1.6">Hi ${esc(booking.name.trim().split(/\s+/)[0])},</p>
              <p style="font-size:14px;line-height:1.6">Your discovery call on ${fmtInTz(start, inviteeTz, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtInTz(start, inviteeTz, { hour: 'numeric', minute: '2-digit', hour12: true })} (${esc(inviteeTz.split('/').pop().replace(/_/g, ' '))} time) has been cancelled.</p>
              <p style="font-size:14px;line-height:1.6">If you would like to rebook, you can pick a new time at <a href="https://ethosaigovernance.com.au/contact" style="color:#A8833A">ethosaigovernance.com.au/contact</a>, or just reply to this email.</p>
              <p style="font-size:14px;line-height:1.6">Ethos AI Governance</p>
            </div>`,
        });
      }
      return res.status(200).json({ ok: true });
    }

    default:
      return res.status(400).json({ error: 'Unknown op' });
  }
}

// ─── Router ────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      if (url.searchParams.get('action') === 'slots') return await handleSlots(req, res);
      return res.status(400).json({ error: 'Unknown action' });
    }
    if (req.method === 'POST') {
      const action = (req.body || {}).action;
      if (action === 'book') return await handleBook(req, res);
      if (action === 'admin') return await handleAdmin(req, res);
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[booking] Unhandled error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
