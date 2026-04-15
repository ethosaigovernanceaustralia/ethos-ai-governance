// ─── Ethos AI Governance — Portal JavaScript ─────────────────────────────
// Supabase client + auth + document management + toast notifications
// ─────────────────────────────────────────────────────────────────────────

// ─── Supabase Client ─────────────────────────────────────────
let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || cfg.url.includes('YOUR_PROJECT_REF')) {
    console.warn('Supabase not configured yet. Fill in portal/config.js.');
    return null;
  }
  _supabase = window.supabase.createClient(cfg.url, cfg.anonKey);
  return _supabase;
}

// ─── Auth Helpers ─────────────────────────────────────────────

async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function getProfile(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) { console.error('Profile fetch error:', error); return null; }
  return data;
}

async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  window.location.href = '/portal/login';
}

// ─── Route Guards ─────────────────────────────────────────────

// Call on protected pages — redirects to login if no session
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/portal/login';
    return null;
  }
  return session;
}

// Call on admin-only pages
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;
  const profile = await getProfile(session.user.id);
  if (!profile || profile.role !== 'admin') {
    window.location.href = '/portal/dashboard';
    return null;
  }
  return { session, profile };
}

// ─── Engagements ──────────────────────────────────────────────

async function getEngagements(clientId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('engagements')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Engagements error:', error); return []; }
  return data || [];
}

async function getAllEngagements() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('engagements')
    .select('*, profiles(full_name, company_name, email)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Engagements error:', error); return []; }
  return data || [];
}

async function createEngagement(clientId, engagementType, notes) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('engagements')
    .insert({ client_id: clientId, engagement_type: engagementType, notes, status: 'active' })
    .select()
    .single();
  if (error) { console.error('Create engagement error:', error); return null; }
  return data;
}

async function updateEngagementStatus(engagementId, status) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from('engagements')
    .update({ status })
    .eq('id', engagementId);
  if (error) { console.error('Update engagement error:', error); return false; }
  return true;
}

// ─── Documents ────────────────────────────────────────────────

async function getDocuments(engagementIds) {
  const sb = getSupabase();
  if (!sb) return [];
  const ids = Array.isArray(engagementIds) ? engagementIds : [engagementIds];
  const { data, error } = await sb
    .from('documents')
    .select('*, profiles(full_name)')
    .in('engagement_id', ids)
    .order('created_at', { ascending: false });
  if (error) { console.error('Documents error:', error); return []; }
  return data || [];
}

async function uploadDocument(file, engagementId, clientUserId, description, documentType, onProgress, adminMode = false) {
  const sb = getSupabase();
  if (!sb) return null;

  // Validate file type
  const ADMIN_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const CLIENT_TYPES = ['application/pdf'];
  const allowedTypes = adminMode ? ADMIN_TYPES : CLIENT_TYPES;
  if (!allowedTypes.includes(file.type)) {
    throw new Error(adminMode
      ? 'Only PDF and Word documents (.doc, .docx) are accepted.'
      : 'Only PDF files are accepted. Please convert your document to PDF and try again.'
    );
  }

  // Validate file size
  const maxSize = (adminMode ? 50 : 25) * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`File exceeds the ${adminMode ? 50 : 25}MB limit. Please reduce the file size and try again.`);
  }

  // Build storage path: {client_id}/{uuid}_{sanitized_name}
  const fileId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${clientUserId}/${fileId}_${safeName}`;

  // Upload to storage
  const { error: uploadError } = await sb.storage
    .from('client-documents')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
      onUploadProgress: (progress) => {
        if (onProgress) onProgress(Math.round((progress.loaded / progress.total) * 100));
      }
    });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    throw new Error('Upload failed. Please try again.');
  }

  // Get current user for uploaded_by
  const { data: { user } } = await sb.auth.getUser();

  // Insert metadata row
  const { data, error: dbError } = await sb.from('documents').insert({
    engagement_id: engagementId,
    uploaded_by: user.id,
    file_name: file.name,
    file_path: storagePath,
    file_size_bytes: file.size,
    document_type: documentType,
    description: description || null,
    scan_status: 'pending_review'
  }).select().single();

  if (dbError) {
    // Cleanup storage if DB insert fails
    await sb.storage.from('client-documents').remove([storagePath]);
    console.error('Document DB error:', dbError);
    throw new Error('Upload failed while saving. Please try again.');
  }

  return data;
}

async function downloadDocument(filePath, fileName) {
  const sb = getSupabase();
  if (!sb) return;

  const { data, error } = await sb.storage
    .from('client-documents')
    .createSignedUrl(filePath, 3600); // 1-hour link

  if (error) {
    console.error('Signed URL error:', error);
    showToast('Could not generate download link. Please try again.', 'error');
    return;
  }

  // Trigger download
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = fileName;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function deleteDocument(documentId, filePath) {
  const sb = getSupabase();
  if (!sb) return false;

  // Delete from storage
  const { error: storageError } = await sb.storage
    .from('client-documents')
    .remove([filePath]);

  if (storageError) {
    console.error('Storage delete error:', storageError);
    showToast('Could not delete file. Please try again.', 'error');
    return false;
  }

  // Delete metadata row
  const { error: dbError } = await sb.from('documents').delete().eq('id', documentId);
  if (dbError) {
    console.error('Document delete DB error:', dbError);
    return false;
  }

  return true;
}

// ─── Enquiries ────────────────────────────────────────────────

async function submitEnquiry(data) {
  const sb = getSupabase();
  if (!sb) {
    // Supabase not configured — simulate success
    return await new Promise(resolve => setTimeout(resolve, 1400));
  }
  const { error } = await sb.from('enquiries').insert(data);
  if (error) throw error;
}

async function getEnquiries() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('enquiries')
    .select('*')
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('Enquiries error:', error); return []; }
  return data || [];
}

async function updateEnquiryStatus(enquiryId, status) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').update({ status }).eq('id', enquiryId);
  if (error) { console.error('Update enquiry error:', error); return false; }
  return true;
}

// ─── Admin: All Clients ───────────────────────────────────────

async function getAllClients() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('profiles')
    .select('*, engagements(id, engagement_type, status)')
    .eq('role', 'client')
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('Clients error:', error); return []; }
  return data || [];
}

// ─── Archive ──────────────────────────────────────────────────

async function archiveClient(clientId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').update({ archived_at: new Date().toISOString() }).eq('id', clientId);
  if (error) { console.error('Archive client error:', error); return false; }
  return true;
}

async function unarchiveClient(clientId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').update({ archived_at: null }).eq('id', clientId);
  if (error) { console.error('Unarchive client error:', error); return false; }
  return true;
}

async function getArchivedClients() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('profiles')
    .select('*, engagements(id, engagement_type, status)')
    .eq('role', 'client')
    .not('archived_at', 'is', null)
    .is('deleted_at', null)
    .order('archived_at', { ascending: false });
  if (error) { console.error('Archived clients error:', error); return []; }
  return data || [];
}

async function archiveEnquiry(enquiryId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').update({ archived_at: new Date().toISOString() }).eq('id', enquiryId);
  if (error) { console.error('Archive enquiry error:', error); return false; }
  return true;
}

async function unarchiveEnquiry(enquiryId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').update({ archived_at: null }).eq('id', enquiryId);
  if (error) { console.error('Unarchive enquiry error:', error); return false; }
  return true;
}

async function getArchivedEnquiries() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('enquiries')
    .select('*')
    .not('archived_at', 'is', null)
    .is('deleted_at', null)
    .order('archived_at', { ascending: false });
  if (error) { console.error('Archived enquiries error:', error); return []; }
  return data || [];
}

async function deleteEngagement(engagementId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('engagements').delete().eq('id', engagementId);
  if (error) { console.error('Delete engagement error:', error); return false; }
  return true;
}

// Admin: invite new client via Vercel API function
async function inviteClient(fullName, email, companyName, engagementType) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch('/api/invite-client', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ fullName, email, companyName, engagementType })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Invitation failed');
  return json;
}

// ─── Toast Notifications ──────────────────────────────────────

function showToast(message, type = 'default', duration = 4000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const icons = { success: 'check_circle', error: 'error', warning: 'warning', default: 'info' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="material-symbols-outlined toast-icon">${icons[type] || icons.default}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ─── Utility Helpers ──────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '–';
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function getFileTypeLabel(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'doc' || ext === 'docx') return 'DOC';
  return 'PDF';
}

function engagementLabel(type) {
  const labels = {
    free_audit:           'Free AI Governance Audit',
    au_compliance_core:   'AU Compliance Core',
    full_toolkit:         'Full Responsible AI Toolkit',
    retainer:             'Governance Retainer',
    iso_pathway:          'ISO 42001 Certification Pathway',
    // Legacy — kept for graceful display of historical records
    toolkit_self_service: 'Baseline Compliance Toolkit (Self-Service)',
    toolkit_consulting:   'Baseline Compliance Toolkit (Consulting)',
  };
  return labels[type] || type;
}

// ─── Product Templates ────────────────────────────────────────
// Returns shared template files for all product tiers the current client
// has active access to. RLS filters automatically based on auth.uid().

async function getProductTemplates() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('product_templates')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) { console.error('Product templates error:', error); return []; }
  return data || [];
}

// Logs a template download and opens a 15-minute signed URL.
async function downloadTemplate(templateId, filePath, fileName) {
  const sb = getSupabase();
  if (!sb) return;

  // Log the download (non-blocking — don't wait for it)
  getSession().then(session => {
    if (session) {
      sb.from('template_downloads').insert({
        client_id:   session.user.id,
        template_id: templateId,
      }).then(({ error }) => {
        if (error) console.error('Download log error:', error);
      });
    }
  });

  // Generate a 15-minute signed URL from the ethos-assets bucket
  const { data, error } = await sb.storage
    .from('ethos-assets')
    .createSignedUrl(filePath, 900);

  if (error) {
    console.error('Template signed URL error:', error);
    showToast('Could not generate download link. Please try again.', 'error');
    return;
  }

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = fileName;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Resend Invite (admin only) ───────────────────────────────

async function resendInvite(email) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch('/api/resend-invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to resend invite');
  return json;
}

// ─── Bin (Soft-delete / 90-day permanent delete) ──────────────

async function softDeleteClient(clientId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', clientId);
  if (error) { console.error('Soft-delete client error:', error); return false; }
  return true;
}

async function softDeleteEnquiry(enquiryId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').update({ deleted_at: new Date().toISOString() }).eq('id', enquiryId);
  if (error) { console.error('Soft-delete enquiry error:', error); return false; }
  return true;
}

async function restoreDeletedClient(clientId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').update({ deleted_at: null, archived_at: null }).eq('id', clientId);
  if (error) { console.error('Restore deleted client error:', error); return false; }
  return true;
}

async function restoreDeletedEnquiry(enquiryId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').update({ deleted_at: null, archived_at: null }).eq('id', enquiryId);
  if (error) { console.error('Restore deleted enquiry error:', error); return false; }
  return true;
}

async function getDeletedClients() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) { console.error('Deleted clients error:', error); return []; }
  return data || [];
}

async function getDeletedEnquiries() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('enquiries')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) { console.error('Deleted enquiries error:', error); return []; }
  return data || [];
}

async function permanentlyDeleteClient(clientId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').delete().eq('id', clientId);
  if (error) { console.error('Permanent delete client error:', error); return false; }
  return true;
}

async function permanentlyDeleteEnquiry(enquiryId) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('enquiries').delete().eq('id', enquiryId);
  if (error) { console.error('Permanent delete enquiry error:', error); return false; }
  return true;
}

function hideLoader() {
  const loader = document.getElementById('pageLoader');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 500);
  }
}

// ─── Admin: Invoices ──────────────────────────────────────────

async function getAdminInvoices() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('invoices')
    .select('*, profiles(full_name, email)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Admin invoices error:', error); return []; }
  return data || [];
}

async function getClientInvoices(clientId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('invoices')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Client invoices error:', error); return []; }
  return data || [];
}

// ─── Admin: Product Access ────────────────────────────────────

async function getClientProductAccess(clientId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('product_access')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Product access error:', error); return []; }
  return data || [];
}

// ─── Admin: Download from ethos-assets ───────────────────────

async function adminDownloadInvoice(filePath, fileName) {
  const sb = getSupabase();
  if (!sb) return;

  const { data, error } = await sb.storage
    .from('ethos-assets')
    .createSignedUrl(filePath, 900);

  if (error) {
    showToast('Could not generate download link. Please try again.', 'error');
    return;
  }

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = fileName;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Admin: Abandoned Checkouts ───────────────────────────────

async function getAbandonedCheckouts() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('abandoned_checkouts')
    .select('*')
    .order('abandoned_at', { ascending: false });
  if (error) { console.error('Abandoned checkouts error:', error); return []; }
  return data || [];
}

// ─── Admin: Download Activity ─────────────────────────────────

async function getClientDownloadActivity(clientId) {
  const sb = getSupabase();
  if (!sb) return { templates: [], downloads: [] };

  // Get client's active product access tiers
  const { data: access } = await sb
    .from('product_access')
    .select('product_tier')
    .eq('client_id', clientId)
    .is('revoked_at', null);

  if (!access || !access.length) return { templates: [], downloads: [] };

  const tiers = access.map(a => a.product_tier);

  const [templatesRes, downloadsRes] = await Promise.all([
    sb.from('product_templates').select('*').in('product_tier', tiers).order('sort_order'),
    sb.from('template_downloads').select('*').eq('client_id', clientId).order('downloaded_at', { ascending: false }),
  ]);

  return {
    templates: templatesRes.data || [],
    downloads: downloadsRes.data || [],
  };
}

// ─── Client: Own Product Access ───────────────────────────────
// Used for retainer date display on client dashboard.

async function getMyProductAccess() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('product_access')
    .select('*')
    .eq('client_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('My product access error:', error); return []; }
  return data || [];
}

// ─── Client: Own Download Activity ───────────────────────────
// Used for au_compliance_core / full_toolkit progress display.

async function getMyDownloadActivity() {
  const sb = getSupabase();
  if (!sb) return { templates: [], downloads: [] };
  const { data: { user } } = await sb.auth.getUser();
  const [templatesRes, downloadsRes] = await Promise.all([
    sb.from('product_templates').select('*').order('sort_order'),
    sb.from('template_downloads').select('*').eq('client_id', user.id),
  ]);
  return {
    templates: templatesRes.data || [],
    downloads: downloadsRes.data || [],
  };
}

// ─── Action Items ─────────────────────────────────────────────

// Client: get action items assigned to them (RLS filters to client's own)
async function getClientActionItems(engagementId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('action_items')
    .select('*')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: true });
  if (error) { console.error('Action items error:', error); return []; }
  return data || [];
}

// Admin: get all action items for a client (across all engagements)
async function getAdminActionItems(clientId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('action_items')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Admin action items error:', error); return []; }
  return data || [];
}

// Admin: create a new action item
async function createActionItem({ engagementId, clientId, title, status, assignedTo, dueDate, notes }) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('action_items')
    .insert({
      engagement_id: engagementId,
      client_id:     clientId,
      title,
      status:      status      || 'pending',
      assigned_to: assignedTo || 'client',
      due_date:    dueDate    || null,
      notes:       notes      || null,
      created_by:  user.id,
    })
    .select()
    .single();
  if (error) { console.error('Create action item error:', error); return null; }
  return data;
}

// Admin: update any field on an action item
async function updateActionItem(id, updates) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from('action_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { console.error('Update action item error:', error); return false; }
  return true;
}

// Admin: delete an action item
async function deleteActionItem(id) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('action_items').delete().eq('id', id);
  if (error) { console.error('Delete action item error:', error); return false; }
  return true;
}

// Client: mark an action item complete
async function completeActionItem(id) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from('action_items')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { console.error('Complete action item error:', error); return false; }
  return true;
}

// ─── Progress Stage ───────────────────────────────────────────

// Admin: update the progress_stage on an engagement
async function updateProgressStage(engagementId, stage) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from('engagements')
    .update({ progress_stage: stage || null, updated_at: new Date().toISOString() })
    .eq('id', engagementId);
  if (error) { console.error('Update progress stage error:', error); return false; }
  return true;
}

// ─── Progress Milestone Definitions ──────────────────────────
// Shared between client dashboard and admin portal.

const PROGRESS_MILESTONES = {
  iso_pathway: [
    { id: 'gap_analysis',          label: 'Gap Analysis',        sublabel: 'Months 1–2' },
    { id: 'aims_documentation',    label: 'AIMS Documentation',  sublabel: 'Months 3–5' },
    { id: 'internal_audit_prep',   label: 'Internal Audit Prep', sublabel: 'Months 6–7' },
    { id: 'cert_readiness_review', label: 'Cert. Readiness',     sublabel: 'Month 8'    },
    { id: 'certification_ready',   label: 'Certification Ready', sublabel: 'Month 9'    },
  ],
  free_audit: [
    { id: 'questionnaire_submitted', label: 'Questionnaire Submitted' },
    { id: 'under_review',            label: 'Under Review'            },
    { id: 'report_delivered',        label: 'Report Delivered'        },
  ],
  full_toolkit: [
    { id: 'governance_policy',     label: 'Governance Policy'      },
    { id: 'ai_inventory',          label: 'AI System Inventory'    },
    { id: 'risk_register',         label: 'Risk Register'          },
    { id: 'data_governance',       label: 'Data Governance'        },
    { id: 'incident_response',     label: 'Incident Response'      },
    { id: 'procurement_readiness', label: 'Procurement Readiness'  },
    { id: 'stakeholder_comms',     label: 'Stakeholder Comms'      },
    { id: 'ongoing_governance',    label: 'Ongoing Governance'     },
  ],
};

function getProgressStagesForType(type) {
  return PROGRESS_MILESTONES[type] || [];
}

// ─── Messages ─────────────────────────────────────────────────

// Fetch all messages in a client's thread (ordered oldest → newest)
async function getMessages(clientId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('messages')
    .select('*, profiles!sender_id(full_name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) { console.error('Messages error:', error); return []; }
  return data || [];
}

// Send a message (client or admin — pass senderRole explicitly)
async function sendMessage({ clientId, body, documentId, senderRole }) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('messages')
    .insert({
      client_id:   clientId,
      sender_id:   user.id,
      sender_role: senderRole || 'client',
      body:        body || null,
      document_id: documentId || null,
    })
    .select('*, profiles!sender_id(full_name)')
    .single();
  if (error) { console.error('Send message error:', error); return null; }
  return data;
}

// Mark all unread messages in a thread as read
// (marks messages where sender_role ≠ viewerRole — i.e. the ones the viewer receives)
async function markThreadRead(clientId, viewerRole) {
  const sb = getSupabase();
  if (!sb) return;
  const senderRole = viewerRole === 'admin' ? 'client' : 'admin';
  await sb
    .from('messages')
    .update({ is_read: true })
    .eq('client_id', clientId)
    .eq('sender_role', senderRole)
    .eq('is_read', false);
}

// Admin: get unread (from client) count per client as a map { clientId: count }
async function getAllThreadUnreadCounts() {
  const sb = getSupabase();
  if (!sb) return {};
  const { data, error } = await sb
    .from('messages')
    .select('client_id')
    .eq('sender_role', 'client')
    .eq('is_read', false);
  if (error) return {};
  const counts = {};
  (data || []).forEach(m => {
    counts[m.client_id] = (counts[m.client_id] || 0) + 1;
  });
  return counts;
}

// ─── Notification Preferences ─────────────────────────────────

async function getMyNotificationPrefs() {
  const sb = getSupabase();
  if (!sb) return {};
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('profiles')
    .select('notification_prefs')
    .eq('id', user.id)
    .single();
  if (error) return {};
  return data?.notification_prefs || {};
}

async function updateNotificationPrefs(prefs) {
  const sb = getSupabase();
  if (!sb) return false;
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb
    .from('profiles')
    .update({ notification_prefs: prefs })
    .eq('id', user.id);
  if (error) { console.error('Update notif prefs error:', error); return false; }
  return true;
}

// ─── Portal Notifications (fire-and-forget) ───────────────────
// Calls the send-notification API. Silently swallows errors so
// a failed notification never blocks the user action.

async function sendNotification(event, clientId, metadata = {}) {
  const session = await getSession();
  if (!session) return;
  try {
    fetch('/api/send-notification', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event, clientId, metadata }),
    }).catch(err => console.error('Notification send error:', err));
  } catch (err) {
    console.error('Notification send error:', err);
  }
}
