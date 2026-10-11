// ─── Ethos — Permanently Delete Client (admin) ───────────────────────────────
// Security plan P10. Removes a binned client completely: their files in the
// client-documents bucket first, then document and action-item rows whose keys
// do not cascade, then their login, which cascades to the profile, engagements,
// messages and consents.
//
// Refuses clients with invoices or purchases: invoices are financial records
// (keep for five years under Australian tax law) and deleting the login would
// cascade-delete them. Each step is safe to re-run: if file removal fails,
// nothing else has been deleted and the admin can simply try again.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { missingEnvironment } = require('../../lib/environment');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return res.status(503).json({ error: 'Service not configured' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { clientId } = req.body || {};
  if (typeof clientId !== 'string' || !UUID.test(clientId)) {
    return res.status(400).json({ error: 'Invalid client' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: { user } = {}, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });
  const { data: caller } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!caller || caller.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { data: client, error: clientError } = await sb.from('profiles')
    .select('id, role, deleted_at').eq('id', clientId).maybeSingle();
  if (clientError) return res.status(503).json({ error: 'Lookup failed. Please try again.' });
  if (!client || client.role !== 'client') return res.status(404).json({ error: 'Client not found' });
  if (!client.deleted_at) return res.status(409).json({ error: 'Move the client to the bin before deleting permanently.' });

  const [invoices, purchases] = await Promise.all([
    sb.from('invoices').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    sb.from('product_access').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
  ]);
  if (invoices.error || purchases.error) return res.status(503).json({ error: 'Lookup failed. Please try again.' });
  if (invoices.count > 0 || purchases.count > 0) {
    return res.status(409).json({ error: 'This client has invoices or purchases, which must be kept as financial records. Leave them archived instead.' });
  }

  // 1. Files in the client's folder.
  let removedFiles = 0;
  for (;;) {
    const { data: files, error: listError } = await sb.storage.from('client-documents')
      .list(clientId, { limit: 100 });
    if (listError) return res.status(503).json({ error: 'Could not list the client files. Nothing was deleted.' });
    if (!files.length) break;
    const { error: removeError } = await sb.storage.from('client-documents')
      .remove(files.map(f => `${clientId}/${f.name}`));
    if (removeError) {
      return res.status(503).json({ error: `Removed ${removedFiles} files, then removal failed. The client was not deleted; please try again.` });
    }
    removedFiles += files.length;
  }

  // 2. Rows whose foreign keys do not cascade from the profile
  //    (documents.uploaded_by, action_items.created_by), then the login.
  const { data: engagements, error: engError } = await sb.from('engagements').select('id').eq('client_id', clientId);
  if (engError) return res.status(503).json({ error: `Files removed (${removedFiles}), but the client records could not be read. Please try again.` });
  const engagementIds = engagements.map(e => e.id);
  const cleanups = [
    sb.from('documents').delete().eq('uploaded_by', clientId),
    sb.from('action_items').delete().eq('client_id', clientId),
    sb.from('action_items').delete().eq('created_by', clientId),
  ];
  if (engagementIds.length) cleanups.push(sb.from('documents').delete().in('engagement_id', engagementIds));
  const cleanupResults = await Promise.all(cleanups);
  if (cleanupResults.some(r => r.error)) {
    return res.status(503).json({ error: `Files removed (${removedFiles}), but some records could not be removed. Please try again.` });
  }

  // 3. The login, which cascades to the profile and every remaining client row.
  const { error: deleteError } = await sb.auth.admin.deleteUser(clientId);
  if (deleteError) {
    return res.status(503).json({ error: `Files removed (${removedFiles}), but the account could not be deleted. Please try again.` });
  }

  return res.status(200).json({ ok: true, removedFiles });
};
