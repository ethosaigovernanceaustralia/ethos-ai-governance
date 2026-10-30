// ─── Ethos — Portal Email Notification Handler ────────────────────────────────
// Sends email notifications for portal events (security plan P5).
//
// The caller names an event and the persisted record it concerns (`ref`).
// Email content is read from that record, never from caller-supplied text.
//
//   Client events (caller must be that client)  → notify admin (NOTIFY_EMAIL)
//     new_message_from_client      ref = messages.id
//     document_uploaded_by_client  ref = documents.id   (30-min debounce per client)
//     action_item_completed        ref = action_items.id
//   Admin events (caller must be an admin)       → notify client (respects prefs)
//     new_message_from_admin       ref = messages.id
//     action_item_created          ref = action_items.id
//     progress_updated             ref = engagements.id
//     document_shared              ref = documents.id
//
// Each (event, record) is claimed in notification_log before sending, so it
// can be emailed at most once. Responses never reveal other clients' data.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { escapeHtml: esc } = require('../../lib/html');
const { missingEnvironment } = require('../../lib/environment');
const { stageLabel } = require('../../lib/progress-stages');

const CLIENT_EVENTS = ['new_message_from_client', 'document_uploaded_by_client', 'action_item_completed'];
const ADMIN_EVENTS = ['new_message_from_admin', 'action_item_created', 'progress_updated', 'document_shared'];
const PREF_FOR_EVENT = {
  new_message_from_admin: 'new_message', action_item_created: 'new_action_item',
  progress_updated: 'progress_update', document_shared: 'new_document',
};
const RECENT_MS = 15 * 60 * 1000;
const UPLOAD_DEBOUNCE_MS = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const recent = value => Boolean(value) && Date.now() - new Date(value).getTime() <= RECENT_MS;

async function byId(sb, table, columns, id) {
  const { data, error } = await sb.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw new Error(`lookup failed: ${table}`);
  return data;
}

async function documentForClient(sb, ref, clientId) {
  const doc = await byId(sb, 'documents', 'id, engagement_id, uploaded_by, document_type, file_name, created_at', ref);
  if (!doc || !recent(doc.created_at)) return null;
  const eng = await byId(sb, 'engagements', 'id, client_id', doc.engagement_id);
  return eng && eng.client_id === clientId ? doc : null;
}

// Returns { refKey, details } when the record exists, belongs to this client,
// matches the event and the caller, and is recent enough; otherwise null.
async function resolveEvent(sb, event, ref, clientId, callerId) {
  switch (event) {
    case 'new_message_from_client':
    case 'new_message_from_admin': {
      const msg = await byId(sb, 'messages', 'id, client_id, sender_id, sender_role, body, document_id, created_at', ref);
      const role = event === 'new_message_from_client' ? 'client' : 'admin';
      if (!msg || msg.client_id !== clientId || msg.sender_role !== role || msg.sender_id !== callerId || !recent(msg.created_at)) return null;
      return { refKey: msg.id, details: { preview: msg.body ? msg.body.slice(0, 120) : '', hasFile: Boolean(msg.document_id) } };
    }
    case 'document_uploaded_by_client': {
      const doc = await documentForClient(sb, ref, clientId);
      if (!doc || doc.uploaded_by !== callerId || doc.document_type !== 'client_upload') return null;
      return { refKey: doc.id, details: {} };
    }
    case 'document_shared': {
      const doc = await documentForClient(sb, ref, clientId);
      if (!doc || doc.document_type === 'client_upload') return null;
      return { refKey: doc.id, details: { docName: doc.file_name } };
    }
    case 'action_item_completed':
    case 'action_item_created': {
      const item = await byId(sb, 'action_items', 'id, client_id, title, status, assigned_to, due_date, created_at', ref);
      if (!item || item.client_id !== clientId || item.assigned_to !== 'client') return null;
      if (event === 'action_item_completed' && item.status !== 'complete') return null;
      if (event === 'action_item_created' && !recent(item.created_at)) return null;
      return { refKey: item.id, details: { title: item.title, dueDate: item.due_date } };
    }
    case 'progress_updated': {
      const eng = await byId(sb, 'engagements', 'id, client_id, engagement_type, progress_stage, updated_at', ref);
      if (!eng || eng.client_id !== clientId || !eng.progress_stage || !recent(eng.updated_at)) return null;
      return { refKey: `${eng.id}:${eng.progress_stage}`, details: { stage: stageLabel(eng.engagement_type, eng.progress_stage) } };
    }
    default:
      return null;
  }
}

// ─── Email layout ─────────────────────────────────────────────

const NAVY  = '#0D2545';
const BRASS = '#A8833A';
const MUTED = '#6b7280';
const BASE  = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";

function wrap(content) {
  return `
<div style="${BASE}max-width:520px;margin:0 auto;padding:32px 16px;background:#f8f7f5">
  <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(13,37,69,0.08)">
    <div style="background:${NAVY};padding:18px 28px">
      <span style="font-size:13px;font-weight:700;color:#fff;letter-spacing:0.08em">ETHOS</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.55);margin-left:8px">AI Governance</span>
    </div>
    <div style="padding:28px">
      ${content}
    </div>
    <div style="padding:14px 28px;border-top:1px solid #e5e7eb;background:#f9fafb">
      <p style="font-size:11px;color:${MUTED};margin:0">
        Ethos AI Governance &middot;
        <a href="https://ethosaigovernance.com.au" style="color:${BRASS}">ethosaigovernance.com.au</a>
      </p>
    </div>
  </div>
</div>`;
}

const cta = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;margin-top:20px;padding:11px 22px;background:${NAVY};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${label}</a>`;
const highlight = text =>
  `<div style="margin:12px 0;background:#f8f7f5;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;font-size:14px;color:${NAVY}">${text}</div>`;
const quote = text =>
  `<div style="background:#f8f7f5;border-left:3px solid ${BRASS};padding:12px 16px;border-radius:0 6px 6px 0;font-size:14px;color:#374151;font-style:italic">${text}</div>`;
const prefsNote = `<p style="font-size:12px;color:${MUTED};margin-top:20px">You can manage your notification preferences in your portal settings.</p>`;
const oneLine = value => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 100);

// Returns { subject, html } for the event. Every dynamic value is escaped.
function buildEmail(event, client, details, portalUrl) {
  const admin = cta(`${portalUrl}/portal/admin`, 'Open Admin Portal');
  const portal = label => cta(`${portalUrl}/portal/dashboard`, label);
  const who = `<p style="font-size:13px;color:${MUTED};margin:0 0 16px">${esc(client.full_name)} &middot; ${esc(client.email)}</p>`;
  const h2 = text => `<h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">${text}</h2>`;
  const p = text => `<p style="font-size:14px;color:#374151;margin:0 0 16px">${text}</p>`;
  switch (event) {
    case 'new_message_from_client':
      return { subject: `New message from ${oneLine(client.full_name)}`, html: wrap(
        h2(`New message from ${esc(client.full_name)}`) + who +
        quote(details.preview ? `"${esc(details.preview)}"` : '(file attached)') + admin) };
    case 'document_uploaded_by_client':
      return { subject: `New document from ${oneLine(client.full_name)}`, html: wrap(
        h2('New document uploaded') + who +
        p(`${esc(client.full_name)} has uploaded a document to their workspace.`) + admin) };
    case 'action_item_completed':
      return { subject: `Action item completed by ${oneLine(client.full_name)}`, html: wrap(
        h2('Action item completed') + who +
        p('The following action item has been marked complete:') +
        `<div style="margin:12px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:14px;font-weight:600;color:#166534">${esc(details.title)}</div>` + admin) };
    case 'new_message_from_admin':
      return { subject: 'New message from your Ethos advisor', html: wrap(
        h2('You have a new message') + p('Your Ethos advisor has sent you a message.') +
        (details.preview ? quote(`"${esc(details.preview)}"`) : '') + portal('View in Your Portal') + prefsNote) };
    case 'action_item_created':
      return { subject: 'New action item: Ethos AI Governance', html: wrap(
        h2('New action item in your workspace') + p('Your Ethos advisor has added a task for you to complete.') +
        highlight(`<strong>${esc(details.title)}</strong>${details.dueDate ? `<span style="font-weight:400;color:${MUTED}">, due ${esc(details.dueDate)}</span>` : ''}`) +
        portal('View in Your Portal') + prefsNote) };
    case 'progress_updated':
      return { subject: 'Progress update: Ethos AI Governance', html: wrap(
        h2('Your engagement has progressed') + p('Your Ethos advisor has updated your progress to a new stage.') +
        highlight(`Current stage: <strong>${esc(details.stage)}</strong>`) + portal('View Your Progress') + prefsNote) };
    case 'document_shared':
      return { subject: 'New document shared: Ethos AI Governance', html: wrap(
        h2('New document in your workspace') + p('Your Ethos advisor has shared a document with you.') +
        highlight(esc(details.docName)) + portal('View in Your Portal') + prefsNote) };
    default:
      return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return res.status(503).json({ error: 'Notifications not configured' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { event, clientId, ref } = req.body || {};
  const known = CLIENT_EVENTS.includes(event) || ADMIN_EVENTS.includes(event);
  if (!known || typeof clientId !== 'string' || !UUID.test(clientId) || typeof ref !== 'string' || !UUID.test(ref)) {
    return res.status(400).json({ error: 'Invalid notification request' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const { data: { user } = {}, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const caller = await byId(sb, 'profiles', 'id, role', user.id);
    const allowed = caller && (CLIENT_EVENTS.includes(event)
      ? caller.role === 'client' && clientId === user.id
      : caller.role === 'admin');
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const client = await byId(sb, 'profiles', 'id, role, full_name, email, notification_prefs', clientId);
    const resolved = client && client.role === 'client'
      ? await resolveEvent(sb, event, ref, clientId, user.id) : null;
    if (!resolved) return res.status(404).json({ error: 'Not found' });

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const recipient = CLIENT_EVENTS.includes(event) ? process.env.NOTIFY_EMAIL : client.email;
    const prefs = client.notification_prefs || {};
    if (!RESEND_API_KEY || !recipient || (PREF_FOR_EVENT[event] && prefs[PREF_FOR_EVENT[event]] === false)) {
      return res.status(200).json({ ok: true, sent: false });
    }

    if (event === 'document_uploaded_by_client') {
      const since = new Date(Date.now() - UPLOAD_DEBOUNCE_MS).toISOString();
      const { count, error } = await sb.from('notification_log').select('event', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('event', event).gte('created_at', since);
      if (error) throw new Error('debounce check failed');
      if (count > 0) return res.status(200).json({ ok: true, sent: false });
    }

    // Claim before sending: a repeated request for the same record sends nothing.
    const { error: claimError } = await sb.from('notification_log')
      .insert({ event, ref_key: resolved.refKey, client_id: clientId });
    if (claimError) {
      if (claimError.code === '23505') return res.status(200).json({ ok: true, sent: false });
      throw new Error('claim failed');
    }

    const email = buildEmail(event, client, resolved.details, process.env.PORTAL_URL || 'https://ethosaigovernance.com.au');
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Ethos AI Governance <mike@ethosaigovernance.com.au>', to: [recipient], subject: email.subject, html: email.html }),
    });
    if (!resp.ok) console.error('Notification email failed:', resp.status);
    return res.status(200).json({ ok: true, sent: resp.ok });
  } catch (err) {
    console.error('Notification handler error:', err.message);
    return res.status(503).json({ error: 'Notification failed' });
  }
};
