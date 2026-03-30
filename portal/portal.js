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

async function getDocuments(engagementId) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('documents')
    .select('*, profiles(full_name)')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Documents error:', error); return []; }
  return data || [];
}

async function uploadDocument(file, engagementId, clientUserId, description, documentType, onProgress) {
  const sb = getSupabase();
  if (!sb) return null;

  // Validate file type
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are accepted. Please convert your document to PDF and try again.');
  }

  // Validate file size (25MB max)
  const maxSize = 25 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error('File exceeds the 25MB limit. Please reduce the file size and try again.');
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
      contentType: 'application/pdf',
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
    .order('created_at', { ascending: false });
  if (error) { console.error('Clients error:', error); return []; }
  return data || [];
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

function engagementLabel(type) {
  const labels = {
    free_audit:          'Free Governance Audit',
    toolkit_self_service:'Baseline Compliance Toolkit (Self-Service)',
    toolkit_consulting:  'Baseline Compliance Toolkit (Consulting)',
    retainer:            'Governance Retainer',
    iso_pathway:         'ISO 42001 Readiness Pathway'
  };
  return labels[type] || type;
}

function hideLoader() {
  const loader = document.getElementById('pageLoader');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 500);
  }
}
