// ─── Ethos — Portal Email Notification Handler ────────────────────────────────
// Sends email notifications for key portal events.
//
// Events (caller sets `event` field):
//   new_message_from_client   → notify admin
//   new_message_from_admin    → notify client  (respects new_message pref)
//   document_uploaded_by_client → notify admin  (30-min debounce enforced in caller)
//   action_item_completed      → notify admin
//   action_item_created        → notify client  (respects new_action_item pref)
//   progress_updated           → notify client  (respects progress_update pref)
//   document_shared            → notify client  (respects new_document pref)
//
// Always returns 200 — notification failures must never surface to the user.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY      = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL        = process.env.NOTIFY_EMAIL;
  const PORTAL_URL          = process.env.PORTAL_URL || 'https://ethosaigovernance.com.au';

  // If Resend not configured, succeed silently
  if (!RESEND_API_KEY) return res.status(200).json({ ok: true });

  // Verify caller is authenticated
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { event, clientId, metadata = {} } = req.body;
  if (!event || !clientId) {
    return res.status(400).json({ error: 'event and clientId are required' });
  }

  // Fetch the client's profile (notification prefs + contact info)
  const { data: client } = await sb
    .from('profiles')
    .select('full_name, email, notification_prefs')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(200).json({ ok: true }); // fail silently

  const prefs = client.notification_prefs || {};

  // ─── Email helpers ────────────────────────────────────────────

  async function sendEmail(to, subject, html) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    'Ethos AI Governance <hello@ethosaigovernance.com.au>',
          to:      [to],
          subject,
          html,
        }),
      });
      if (!resp.ok) console.error('Resend error:', await resp.text());
    } catch (err) {
      console.error('Email send error:', err);
    }
  }

  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  const NAVY    = '#0D2545';
  const BRASS   = '#A8833A';
  const MUTED   = '#6b7280';
  const BASE    = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";

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

  function cta(href, label) {
    return `<a href="${esc(href)}" style="display:inline-block;margin-top:20px;padding:11px 22px;background:${NAVY};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${label}</a>`;
  }

  function highlight(text, color = '#f8f7f5') {
    return `<div style="margin:12px 0;background:${color};border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;font-size:14px;color:${NAVY}">${text}</div>`;
  }

  const adminPortalUrl  = `${PORTAL_URL}/portal/admin`;
  const clientPortalUrl = `${PORTAL_URL}/portal/dashboard`;

  // ─── Event dispatch ───────────────────────────────────────────

  try {
    switch (event) {

      case 'new_message_from_client': {
        if (!NOTIFY_EMAIL) break;
        const preview = metadata.preview ? `"${esc(metadata.preview)}"` : '(file attached)';
        await sendEmail(
          NOTIFY_EMAIL,
          `New message from ${esc(client.full_name)}`,
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">New message from ${esc(client.full_name)}</h2>
            <p style="font-size:13px;color:${MUTED};margin:0 0 16px">${esc(client.email)}</p>
            <div style="background:#f8f7f5;border-left:3px solid ${BRASS};padding:12px 16px;border-radius:0 6px 6px 0;font-size:14px;color:#374151;font-style:italic">${preview}</div>
            ${cta(adminPortalUrl, 'Open Admin Portal')}
          `),
        );
        break;
      }

      case 'document_uploaded_by_client': {
        if (!NOTIFY_EMAIL) break;
        const count = metadata.count || 1;
        const countLabel = count === 1 ? 'a document' : `${count} documents`;
        await sendEmail(
          NOTIFY_EMAIL,
          `New document${count > 1 ? 's' : ''} from ${esc(client.full_name)}`,
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">New document${count > 1 ? 's' : ''} uploaded</h2>
            <p style="font-size:13px;color:${MUTED};margin:0 0 16px">${esc(client.full_name)} &middot; ${esc(client.email)}</p>
            <p style="font-size:14px;color:#374151;margin:0">${esc(client.full_name)} has uploaded ${countLabel} to their workspace${count > 1 ? ', including via the messaging chat' : ''}.</p>
            ${cta(adminPortalUrl, 'Open Admin Portal')}
          `),
        );
        break;
      }

      case 'action_item_completed': {
        if (!NOTIFY_EMAIL) break;
        const title = metadata.title || 'an action item';
        await sendEmail(
          NOTIFY_EMAIL,
          `Action item completed by ${esc(client.full_name)}`,
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">Action item completed</h2>
            <p style="font-size:13px;color:${MUTED};margin:0 0 16px">${esc(client.full_name)} &middot; ${esc(client.email)}</p>
            <p style="font-size:14px;color:#374151;margin:0">The following action item has been marked complete:</p>
            <div style="margin:12px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:14px;font-weight:600;color:#166534">${esc(title)}</div>
            ${cta(adminPortalUrl, 'Open Admin Portal')}
          `),
        );
        break;
      }

      case 'new_message_from_admin': {
        if (prefs.new_message === false) break;
        const preview = metadata.preview || '';
        await sendEmail(
          client.email,
          'New message from your Ethos advisor',
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">You have a new message</h2>
            <p style="font-size:14px;color:#374151;margin:0 0 16px">Your Ethos advisor has sent you a message.</p>
            ${preview ? `<div style="background:#f8f7f5;border-left:3px solid ${BRASS};padding:12px 16px;border-radius:0 6px 6px 0;font-size:14px;color:#374151;font-style:italic">"${esc(preview)}"</div>` : ''}
            ${cta(clientPortalUrl, 'View in Your Portal')}
            <p style="font-size:12px;color:${MUTED};margin-top:20px">You can manage your notification preferences in your portal settings.</p>
          `),
        );
        break;
      }

      case 'action_item_created': {
        if (prefs.new_action_item === false) break;
        const title   = metadata.title    || 'a new task';
        const dueText = metadata.due_date ? ` &mdash; due ${esc(metadata.due_date)}` : '';
        await sendEmail(
          client.email,
          'New action item — Ethos AI Governance',
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">New action item in your workspace</h2>
            <p style="font-size:14px;color:#374151;margin:0 0 16px">Your Ethos advisor has added a task for you to complete.</p>
            ${highlight(`<strong>${esc(title)}</strong>${dueText ? `<span style="font-weight:400;color:${MUTED}">${dueText}</span>` : ''}`)}
            ${cta(clientPortalUrl, 'View in Your Portal')}
            <p style="font-size:12px;color:${MUTED};margin-top:20px">You can manage your notification preferences in your portal settings.</p>
          `),
        );
        break;
      }

      case 'progress_updated': {
        if (prefs.progress_update === false) break;
        const stageName = metadata.stage_label || 'a new stage';
        await sendEmail(
          client.email,
          'Progress update — Ethos AI Governance',
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">Your engagement has progressed</h2>
            <p style="font-size:14px;color:#374151;margin:0 0 16px">Your Ethos advisor has updated your progress to a new stage.</p>
            ${highlight(`Current stage: <strong>${esc(stageName)}</strong>`)}
            ${cta(clientPortalUrl, 'View Your Progress')}
            <p style="font-size:12px;color:${MUTED};margin-top:20px">You can manage your notification preferences in your portal settings.</p>
          `),
        );
        break;
      }

      case 'document_shared': {
        if (prefs.new_document === false) break;
        const docName = metadata.doc_name || 'a document';
        await sendEmail(
          client.email,
          'New document shared — Ethos AI Governance',
          wrap(`
            <h2 style="font-size:17px;font-weight:700;color:${NAVY};margin:0 0 4px">New document in your workspace</h2>
            <p style="font-size:14px;color:#374151;margin:0 0 16px">Your Ethos advisor has shared a document with you.</p>
            ${highlight(esc(docName))}
            ${cta(clientPortalUrl, 'View in Your Portal')}
            <p style="font-size:12px;color:${MUTED};margin-top:20px">You can manage your notification preferences in your portal settings.</p>
          `),
        );
        break;
      }

      default:
        console.warn('send-notification: unknown event', event);
    }
  } catch (err) {
    console.error('Notification handler error:', err);
  }

  // Always return 200 — notification failure must never surface to the user
  return res.status(200).json({ ok: true });
};
