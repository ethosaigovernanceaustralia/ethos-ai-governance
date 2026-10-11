// ─── Ethos — Revoke Access ────────────────────────────────────────────────────
// Vercel serverless function. Admin-only.
// Sets revoked_at on a product_access row and marks the engagement as 'refunded'.
// Does NOT delete the record — history is preserved.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessId, engagementId } = req.body;
  if (!accessId || !engagementId) {
    return res.status(400).json({ error: 'Missing required fields: accessId, engagementId' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify the caller is a logged-in admin
  const bearerToken = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!bearerToken) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user: callerUser }, error: tokenError } = await supabase.auth.getUser(bearerToken);
  if (tokenError || !callerUser) return res.status(401).json({ error: 'Unauthorized' });

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', callerUser.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const now = new Date().toISOString();

  // Revoke the product access
  const { error: revokeError } = await supabase
    .from('product_access')
    .update({ revoked_at: now })
    .eq('id', accessId)
    .is('revoked_at', null); // Safety: only update if not already revoked

  if (revokeError) {
    console.error('[revoke-access] Product access update failed:', revokeError.message);
    return res.status(500).json({ error: revokeError.message });
  }

  // Update engagement status to 'refunded'
  const { error: engError } = await supabase
    .from('engagements')
    .update({ status: 'refunded' })
    .eq('id', engagementId);

  if (engError) {
    // Non-critical — access is already revoked, this is cosmetic
    console.error('[revoke-access] Engagement status update failed:', engError.message);
  }

  return res.status(200).json({ success: true });
};
