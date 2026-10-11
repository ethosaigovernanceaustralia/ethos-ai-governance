// Moved out of admin.html so the Content-Security-Policy can forbid inline script (P12).
registerPortalActions({ downloadDocument, handleAdminDeleteDoc, openRevokeModal, handlePermanentDeleteClient, handlePermanentDeleteEnquiry, adminDownloadInvoice });
let _adminProfile = null;
let _allClients = [];
let _selectedClientId = null;
let _selectedEngagementId = null;
let _allEngagements = [];
let _clientProductAccess = [];
let _adminSelectedFile = null;
let _allEnquiries = [];
let _selectedEnquiry = null;
let _pendingRevokeData = null;
let _adminActionItems = [];
let _editingActionItemId = null;
// Messaging state
let _adminMessagesClientId  = null;
let _adminThreadMessages    = [];
let _adminMsgPollTimer      = null;
let _adminMsgFile           = null;
let _adminMsgSending        = false;
let _adminUnreadCounts      = {};

// ─── Init ──────────────────────────────────────────────────────
(async () => {
  const ctx = await requireAdmin();
  if (!ctx) return;

  _adminProfile = ctx.profile;
  document.getElementById('navAdminName').textContent = _adminProfile.full_name;

  await Promise.all([loadClients(), loadEnquiries()]);

  // Load unread message counts to show badge in nav
  getAllThreadUnreadCounts().then(counts => {
    _adminUnreadCounts = counts;
    updateAdminMessagesBadge();
  });

  hideLoader();
})();

// ─── View switcher ─────────────────────────────────────────────
function showView(view) {
  const views = ['clients','enquiries','invoices','archive','bin','messages'];
  views.forEach(v => {
    document.getElementById(`view${v.charAt(0).toUpperCase()+v.slice(1)}`).style.display = v === view ? 'block' : 'none';
    document.getElementById(`nav${v.charAt(0).toUpperCase()+v.slice(1)}`).className = 'admin-nav-item' + (v === view ? ' active' : '');
  });
  if (view === 'archive')  loadArchive();
  if (view === 'bin')      loadBin();
  if (view === 'invoices') loadInvoices();
  if (view === 'messages') loadAdminMessages();
  if (view !== 'messages') stopAdminMessagePoll();
}

function showArchiveTab(tab) {
  document.getElementById('archiveClientsPane').style.display   = tab === 'clients'   ? 'block' : 'none';
  document.getElementById('archiveEnquiriesPane').style.display = tab === 'enquiries' ? 'block' : 'none';
  document.getElementById('archiveTabClientsBtn').className   = tab === 'clients'   ? 'btn-navy'    : 'btn-outline';
  document.getElementById('archiveTabEnquiriesBtn').className = tab === 'enquiries' ? 'btn-navy'    : 'btn-outline';
  document.getElementById('archiveTabClientsBtn').style.fontSize   = '0.8125rem';
  document.getElementById('archiveTabEnquiriesBtn').style.fontSize = '0.8125rem';
}

async function loadArchive() {
  await Promise.all([loadArchivedClients(), loadArchivedEnquiries()]);
}

async function loadArchivedClients() {
  const clients = await getArchivedClients();
  const tbody = document.getElementById('archivedClientsBody');
  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:2rem">No archived clients.</td></tr>`;
    return;
  }
  tbody.innerHTML = clients.map(c => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="client-avatar" style="width:28px;height:28px;font-size:0.65rem">${getInitials(c.full_name)}</div>
          <span style="font-weight:500">${escHtml(c.full_name)}</span>
        </div>
      </td>
      <td style="color:var(--muted)">${escHtml(c.company_name || '–')}</td>
      <td style="color:var(--muted)">${formatDate(c.archived_at)}</td>
      <td style="display:flex;gap:0.4rem">
        <button class="btn-ghost" data-on-click="handleUnarchiveClient" data-args='["${c.id}"]'>
          <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">unarchive</span> Restore
        </button>
        <button class="btn-ghost" data-on-click="handleSoftDeleteClient" data-args='["${c.id}"]' title="Move to Bin" style="color:var(--muted)">
          <span class="material-symbols-outlined" style="font-size:0.9rem">delete</span>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadArchivedEnquiries() {
  const enqs = await getArchivedEnquiries();
  const tbody = document.getElementById('archivedEnquiriesBody');
  if (!enqs.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:2rem">No archived enquiries.</td></tr>`;
    return;
  }
  tbody.innerHTML = enqs.map(e => `
    <tr>
      <td style="font-weight:500">${escHtml(e.name)}</td>
      <td style="color:var(--muted)">${escHtml(e.company)}</td>
      <td style="color:var(--muted)">${formatDate(e.created_at)}</td>
      <td style="display:flex;gap:0.4rem">
        <button class="btn-ghost" data-on-click="handleUnarchiveEnquiry" data-args='["${e.id}"]'>
          <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">unarchive</span> Restore
        </button>
        <button class="btn-ghost" data-on-click="handleSoftDeleteEnquiry" data-args='["${e.id}"]' title="Move to Bin" style="color:var(--muted)">
          <span class="material-symbols-outlined" style="font-size:0.9rem">delete</span>
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleArchiveClient(clientId) {
  if (!confirm('Archive this client? They will be moved to the Archive bin and can be restored at any time.')) return;
  const ok = await archiveClient(clientId);
  if (ok) {
    showToast('Client archived.', 'success');
    if (_selectedClientId === clientId) closeClientWorkspace();
    await loadClients();
  }
}

async function handleUnarchiveClient(clientId) {
  const ok = await unarchiveClient(clientId);
  if (ok) { showToast('Client restored.', 'success'); await Promise.all([loadClients(), loadArchivedClients()]); }
}

async function handleArchiveEnquiry(enquiryId) {
  if (!confirm('Archive this enquiry? It will be moved to the Archive bin and can be restored at any time.')) return;
  const ok = await archiveEnquiry(enquiryId);
  if (ok) { showToast('Enquiry archived.', 'success'); await loadEnquiries(); }
}

async function handleUnarchiveEnquiry(enquiryId) {
  const ok = await unarchiveEnquiry(enquiryId);
  if (ok) { showToast('Enquiry restored.', 'success'); await Promise.all([loadEnquiries(), loadArchivedEnquiries()]); }
}

// ─── Clients ───────────────────────────────────────────────────
async function loadClients() {
  _allClients = await getAllClients();

  const engagements = await getAllEngagements();
  const engMap = {};
  engagements.forEach(e => { if (!engMap[e.client_id]) engMap[e.client_id] = e; });

  // Stats
  document.getElementById('statClients').textContent = _allClients.length;
  document.getElementById('statEngagements').textContent = engagements.filter(e => e.status === 'active').length;

  // Sidebar client list
  const sidebarList = document.getElementById('clientSidebarList');
  if (!_allClients.length) {
    sidebarList.innerHTML = `<div style="padding:0.75rem;font-size:0.8125rem;color:var(--muted)">No clients yet</div>`;
  } else {
    sidebarList.innerHTML = _allClients.map(c => `
      <button class="client-list-item" id="sidebarClient_${c.id}" data-on-click="selectClient" data-args='["${c.id}"]'>
        <div class="client-avatar">${getInitials(c.full_name)}</div>
        <div class="client-list-info">
          <div class="client-list-name">${escHtml(c.full_name)}</div>
          <div class="client-list-company">${escHtml(c.company_name || '')}</div>
        </div>
      </button>
    `).join('');
  }

  // Main table
  const tbody = document.getElementById('clientsTableBody');
  if (!_allClients.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">No clients yet. Use "Invite Client" to get started.</td></tr>`;
    return;
  }

  tbody.innerHTML = _allClients.map(c => {
    const eng = engMap[c.id];
    return `
      <tr style="cursor:pointer" data-on-click="selectClient" data-args='["${c.id}"]'>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="client-avatar" style="width:28px;height:28px;font-size:0.65rem">${getInitials(c.full_name)}</div>
            <span style="font-weight:500">${escHtml(c.full_name)}</span>
          </div>
        </td>
        <td style="color:var(--muted)">${escHtml(c.company_name || '–')}</td>
        <td>${eng ? escHtml(engagementLabel(eng.engagement_type)) : '<span style="color:var(--muted)">None</span>'}</td>
        <td>${eng ? `<span class="status-badge status-${eng.status}">${eng.status.charAt(0).toUpperCase()+eng.status.slice(1)}</span>` : '–'}</td>
        <td style="color:var(--muted)">${formatDate(c.created_at)}</td>
        <td style="display:flex;gap:0.4rem">
          <button class="btn-ghost" data-on-click="selectClient" data-args='["${c.id}"]' data-stop>View</button>
          <button class="btn-ghost" data-on-click="handleArchiveClient" data-args='["${c.id}"]' data-stop title="Archive" style="color:var(--muted)">
            <span class="material-symbols-outlined" style="font-size:0.9rem">archive</span>
          </button>
          <button class="btn-ghost" data-on-click="handleSoftDeleteClient" data-args='["${c.id}"]' data-stop title="Move to Bin" style="color:var(--muted)">
            <span class="material-symbols-outlined" style="font-size:0.9rem">delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function selectClient(clientId) {
  _selectedClientId = clientId;
  const client = _allClients.find(c => c.id === clientId);
  if (!client) return;

  // Highlight sidebar item
  document.querySelectorAll('.client-list-item').forEach(el => el.classList.remove('active'));
  const sidebarItem = document.getElementById(`sidebarClient_${clientId}`);
  if (sidebarItem) sidebarItem.classList.add('active');

  // Show workspace, hide table
  document.getElementById('clientsTable').style.display = 'none';
  document.getElementById('clientWorkspace').style.display = 'block';

  // Populate header
  document.getElementById('wsClientName').textContent = client.full_name + (client.company_name ? ` - ${client.company_name}` : '');
  document.getElementById('wsClientEmail').textContent = client.email;

  // Load engagements and product access in parallel
  const [engagements, productAccess] = await Promise.all([
    getEngagements(clientId),
    getClientProductAccess(clientId),
  ]);
  _allEngagements = engagements;
  _clientProductAccess = productAccess;
  _selectedEngagementId = engagements.find(e => e.status === 'active')?.id || engagements[0]?.id || null;

  const badge = document.getElementById('wsEngagementBadge');
  if (engagements.length) {
    const active = engagements.filter(e => e.status === 'active').length;
    badge.textContent = `${engagements.length} engagement${engagements.length > 1 ? 's' : ''}`;
    badge.className = `status-badge status-${active ? 'active' : 'paused'}`;
  } else {
    badge.textContent = 'No engagements';
    badge.className = 'status-badge';
  }
  renderEngagements(engagements);

  // Load documents, login status, invoices, download activity, action items in parallel
  const [, statusResult] = await Promise.all([
    refreshWorkspaceDocs(),
    fetchClientLoginStatus(clientId),
    refreshClientInvoices(),
    refreshDownloadActivity(),
    refreshAdminActionItems(),
  ]);

  // Show Resend Invite button only if the client has never logged in
  const resendBtn = document.getElementById('resendInviteBtn');
  resendBtn.style.display = statusResult.hasLoggedIn ? 'none' : 'inline-flex';

  // Show client view
  showView('clients');
}

function closeClientWorkspace() {
  _selectedClientId = null;
  _selectedEngagementId = null;
  _allEngagements = [];
  _clientProductAccess = [];
  _adminActionItems = [];
  _editingActionItemId = null;
  document.getElementById('clientWorkspace').style.display = 'none';
  document.getElementById('clientsTable').style.display = 'block';
  document.querySelectorAll('.client-list-item').forEach(el => el.classList.remove('active'));
}

async function refreshWorkspaceDocs() {
  if (!_allEngagements.length) {
    document.getElementById('wsClientDocList').innerHTML = `<div class="empty-state"><p class="empty-state-text">No engagement set for this client yet.</p></div>`;
    document.getElementById('wsEthosDocList').innerHTML = `<div class="empty-state"><p class="empty-state-text">No engagement set for this client yet.</p></div>`;
    return;
  }
  const allIds = _allEngagements.map(e => e.id);
  const docs = await getDocuments(allIds);
  renderAdminDocList('wsClientDocList', docs.filter(d => d.document_type === 'client_upload'), false);
  renderAdminDocList('wsEthosDocList', docs.filter(d => d.document_type !== 'client_upload'), true);
}

function renderAdminDocList(containerId, docs, showDelete) {
  const el = document.getElementById(containerId);
  if (!docs.length) {
    el.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined empty-state-icon">folder_open</span><p class="empty-state-text">No documents yet.</p></div>`;
    return;
  }
  el.innerHTML = docs.map(doc => `
    <div class="file-item">
      <div class="file-icon">${getFileTypeLabel(doc.file_name)}</div>
      <div class="file-info">
        <div class="file-name" title="${escHtml(doc.file_name)}">${escHtml(doc.file_name)}</div>
        <div class="file-meta">
          <span>${formatFileSize(doc.file_size_bytes)}</span>
          <span style="opacity:0.4">·</span>
          <span>${formatDate(doc.created_at)}</span>
          <span class="status-badge scan-${doc.scan_status}" style="font-size:0.65rem;padding:2px 7px">${doc.scan_status === 'pending_review' ? 'Needs review' : doc.scan_status}</span>
        </div>
        ${doc.description ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:3px">${escHtml(doc.description)}</div>` : ''}
        ${doc.profiles ? `<div style="font-size:0.7rem;color:var(--muted);margin-top:2px">Uploaded by: ${escHtml(doc.profiles.full_name)}</div>` : ''}
      </div>
      <div class="file-actions">
        <button class="file-action-btn" ${portalAction('downloadDocument', doc.file_path, doc.file_name)} title="Download">
          <span class="material-symbols-outlined">download</span>
        </button>
        ${showDelete ? `
        <button class="file-action-btn" data-on-click="markReviewed" data-args='["${doc.id}"]' title="Mark reviewed">
          <span class="material-symbols-outlined">check_circle</span>
        </button>
        <button class="file-action-btn delete" ${portalAction('handleAdminDeleteDoc', doc.id, doc.file_path)} title="Delete">
          <span class="material-symbols-outlined">delete</span>
        </button>` : `
        <button class="file-action-btn delete" ${portalAction('handleAdminDeleteDoc', doc.id, doc.file_path)} title="Delete">
          <span class="material-symbols-outlined">delete</span>
        </button>`}
      </div>
    </div>
  `).join('');
}

async function markReviewed(docId) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('documents').update({ scan_status: 'reviewed' }).eq('id', docId);
  await refreshWorkspaceDocs();
  showToast('Marked as reviewed.', 'success');
}

async function handleAdminDeleteDoc(docId, filePath) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  const ok = await deleteDocument(docId, filePath);
  if (ok) { showToast('Document deleted.', 'success'); await refreshWorkspaceDocs(); }
}

async function handleUpdateEngagementStatus(engId, status) {
  const ok = await updateEngagementStatus(engId, status);
  if (ok) {
    const eng = _allEngagements.find(e => e.id === engId);
    if (eng) eng.status = status;
    _selectedEngagementId = _allEngagements.find(e => e.status === 'active')?.id || _allEngagements[0]?.id || null;
    showToast('Status updated.', 'success');
  }
}

function renderEngagements(engagements) {
  const el = document.getElementById('wsEngagementsList');
  if (!engagements.length) {
    el.innerHTML = `<div style="font-size:0.8125rem;color:var(--muted);padding:0.25rem 0">No engagements yet. Use Add to create one.</div>`;
    return;
  }
  const client = _allClients.find(c => c.id === _selectedClientId);
  const clientName = client ? client.full_name : '';

  el.innerHTML = engagements.map(eng => {
    const productName = engagementLabel(eng.engagement_type);
    // Show Revoke button if there is an active (non-revoked) product_access for this tier
    const activeAccess = (_clientProductAccess || []).find(
      a => a.product_tier === eng.engagement_type && !a.revoked_at
    );
    // Progress stage selector (only for types that have defined stages)
    const stages = getProgressStagesForType(eng.engagement_type);
    const stageSelector = stages.length ? `
      <div style="margin-top:0.875rem;padding-top:0.875rem;border-top:1px solid var(--border)">
        <div style="font-size:0.675rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.4rem">Progress Stage</div>
        <select class="p-select" data-on-change="handleUpdateProgressStage" data-args='["${eng.id}", "$value"]' style="font-size:0.8125rem;padding:0.35rem 0.625rem">
          <option value="">Not started</option>
          ${stages.map(s => `<option value="${s.id}" ${eng.progress_stage === s.id ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}
        </select>
      </div>` : '';
    return `
    <div class="engagement-card" style="margin-bottom:0.75rem;flex-direction:column;align-items:stretch;gap:0">
      <div style="display:flex;align-items:center;gap:1rem">
        <div class="engagement-icon">
          <span class="material-symbols-outlined">verified_user</span>
        </div>
        <div class="engagement-info" style="flex:1">
          <div class="engagement-name">${escHtml(productName)}</div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          ${activeAccess ? `
          <button class="btn-ghost" ${portalAction('openRevokeModal', activeAccess.id, eng.id, clientName, productName)}
            style="color:#dc2626;font-size:0.8rem;padding:0.3rem 0.6rem;display:inline-flex;align-items:center;gap:4px" title="Revoke access">
            <span class="material-symbols-outlined" style="font-size:0.875rem">lock</span>
            Revoke Access
          </button>` : ''}
          <select class="p-select" data-on-change="handleUpdateEngagementStatus" data-args='["${eng.id}", "$value"]' style="width:120px;font-size:0.8125rem;padding:0.35rem 0.625rem">
            <option value="pending"   ${eng.status==='pending'  ?'selected':''}>Pending</option>
            <option value="active"    ${eng.status==='active'   ?'selected':''}>Active</option>
            <option value="paused"    ${eng.status==='paused'   ?'selected':''}>Paused</option>
            <option value="completed" ${eng.status==='completed'?'selected':''}>Completed</option>
            <option value="refunded"  ${eng.status==='refunded' ?'selected':''}>Refunded</option>
            <option value="upgraded"  ${eng.status==='upgraded' ?'selected':''}>Upgraded</option>
          </select>
          <button class="file-action-btn delete" data-on-click="handleRemoveEngagement" data-args='["${eng.id}"]' title="Remove engagement">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>
      ${stageSelector}
    </div>
  `}).join('');
}

async function handleRemoveEngagement(engId) {
  if (!confirm('Remove this engagement? This cannot be undone.')) return;
  const ok = await deleteEngagement(engId);
  if (ok) {
    _allEngagements = _allEngagements.filter(e => e.id !== engId);
    _selectedEngagementId = _allEngagements.find(e => e.status === 'active')?.id || _allEngagements[0]?.id || null;
    renderEngagements(_allEngagements);
    await refreshWorkspaceDocs();
    showToast('Engagement removed.', 'success');
  }
}

function openAddEngagementModal() {
  document.getElementById('addEngagementOverlay').classList.add('open');
}

function closeAddEngagementModal() {
  document.getElementById('addEngagementOverlay').classList.remove('open');
}

async function handleAddEngagement() {
  if (!_selectedClientId) return;
  const type = document.getElementById('addEngagementType').value;
  const eng = await createEngagement(_selectedClientId, type, '');
  if (eng) {
    _allEngagements.unshift(eng);
    _selectedEngagementId = eng.id;
    // Auto-provision product access so templates appear in the client's Documents panel
    if (type === 'au_compliance_core' || type === 'full_toolkit') {
      await grantProductAccess(_selectedClientId, type, eng.id);
      _clientProductAccess = await getClientProductAccess(_selectedClientId);
    }
    renderEngagements(_allEngagements);
    closeAddEngagementModal();
    await refreshWorkspaceDocs();
    showToast('Engagement added.', 'success');
  }
}

// ─── Admin Upload Modal ────────────────────────────────────────
function openAdminUploadModal() {
  if (!_selectedEngagementId) { showToast('No engagement set for this client.', 'error'); return; }
  document.getElementById('adminUploadOverlay').classList.add('open');
}

function closeAdminUploadModal() {
  document.getElementById('adminUploadOverlay').classList.remove('open');
  clearAdminFile();
  document.getElementById('adminUploadDescription').value = '';
  document.getElementById('adminUploadProgress').classList.remove('visible');
}

document.getElementById('adminFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) setAdminFile(file);
});

const adminDZ = document.getElementById('adminDropZone');
adminDZ.addEventListener('dragover', (e) => { e.preventDefault(); adminDZ.classList.add('drag-over'); });
adminDZ.addEventListener('dragleave', () => adminDZ.classList.remove('drag-over'));
adminDZ.addEventListener('drop', (e) => {
  e.preventDefault(); adminDZ.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setAdminFile(file);
});

function setAdminFile(file) {
  _adminSelectedFile = file;
  document.getElementById('adminSelectedFileName').textContent = file.name;
  document.getElementById('adminSelectedFileSize').textContent = formatFileSize(file.size);
  document.getElementById('adminSelectedFile').classList.add('visible');
  document.getElementById('adminUploadBtn').disabled = false;
  const isWord = file.name.match(/\.(doc|docx)$/i);
  const icon = document.getElementById('adminFileTypeIcon');
  icon.textContent = isWord ? 'description' : 'picture_as_pdf';
  icon.style.color = isWord ? '#1d4ed8' : '#dc2626';
}

function clearAdminFile() {
  _adminSelectedFile = null;
  document.getElementById('adminFileInput').value = '';
  document.getElementById('adminSelectedFile').classList.remove('visible');
  document.getElementById('adminUploadBtn').disabled = true;
}

async function handleAdminUpload() {
  if (!_adminSelectedFile || !_selectedEngagementId || !_selectedClientId) return;
  const btn = document.getElementById('adminUploadBtn');
  const desc = document.getElementById('adminUploadDescription').value.trim();
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Uploading...';
  document.getElementById('adminUploadProgress').classList.add('visible');

  try {
    const sharedDoc = await uploadDocument(
      _adminSelectedFile,
      _selectedEngagementId,
      _selectedClientId,
      desc,
      'ethos_deliverable',
      (pct) => {
        document.getElementById('adminUploadFill').style.width = `${pct}%`;
        document.getElementById('adminUploadText').textContent = `Uploading... ${pct}%`;
      },
      true  // adminMode: allow Word docs, 50MB
    );
    showToast('Deliverable uploaded to client workspace.', 'success');
    // Notify client of new document
    sendNotification('document_shared', _selectedClientId, sharedDoc?.id);
    closeAdminUploadModal();
    await refreshWorkspaceDocs();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem">upload</span> Upload to Client Workspace';
  }
}

// ─── Invite Client Modal ───────────────────────────────────────
function openInviteModal() {
  document.getElementById('inviteModalOverlay').classList.add('open');
  document.getElementById('inviteError').style.display = 'none';
}

function closeInviteModal() {
  document.getElementById('inviteModalOverlay').classList.remove('open');
  ['inviteName','inviteCompany','inviteEmail'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inviteEngagement').value = '';
}

async function handleInviteClient() {
  const fullName = document.getElementById('inviteName').value.trim();
  const companyName = document.getElementById('inviteCompany').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();
  const engagementType = document.getElementById('inviteEngagement').value || null;

  if (!fullName || !companyName || !email) {
    document.getElementById('inviteErrorMsg').textContent = 'Please fill in all required fields.';
    document.getElementById('inviteError').style.display = 'flex';
    return;
  }

  const btn = document.getElementById('inviteBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';
  document.getElementById('inviteError').style.display = 'none';

  try {
    await inviteClient(fullName, email, companyName, engagementType);
    showToast(`Invitation sent to ${email}`, 'success');
    closeInviteModal();
    await loadClients();
  } catch (err) {
    document.getElementById('inviteErrorMsg').textContent = err.message;
    document.getElementById('inviteError').style.display = 'flex';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem">send</span> Send Invitation';
  }
}

// ─── Enquiries ─────────────────────────────────────────────────
async function loadEnquiries() {
  _allEnquiries = await getEnquiries();

  const newCount = _allEnquiries.filter(e => e.status === 'new').length;
  document.getElementById('statEnquiries').textContent = newCount;
  document.getElementById('statDocs').textContent = '–';

  const badge = document.getElementById('newEnquiriesBadge');
  if (newCount > 0) {
    badge.textContent = newCount;
    badge.style.display = 'inline-flex';
  }

  const tbody = document.getElementById('enquiriesTableBody');
  if (!_allEnquiries.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">No enquiries yet.</td></tr>`;
    return;
  }

  const promptLabels = {
    enterprise_governance: 'Enterprise governance',
    investor_board: 'Investor / board',
    iso42001: 'ISO 42001 prep',
    procurement: 'Procurement / tender',
    proactive: 'Proactive',
    other: 'Other'
  };

  tbody.innerHTML = _allEnquiries.map(enq => `
    <tr class="enquiry-row" data-on-click="selectEnquiry" data-args='["${enq.id}"]'>
      <td style="font-weight:500">${escHtml(enq.name)}</td>
      <td style="color:var(--muted)">${escHtml(enq.company)}</td>
      <td style="color:var(--muted)">${escHtml(Object.hasOwn(promptLabels, enq.enquiry_prompt) ? promptLabels[enq.enquiry_prompt] : enq.enquiry_prompt)}</td>
      <td><span class="status-badge status-${escHtml(enq.status)}">${escHtml(String(enq.status || '').charAt(0).toUpperCase()+String(enq.status || '').slice(1))}</span></td>
      <td style="color:var(--muted)">${formatDate(enq.created_at)}</td>
      <td data-on-click="domNoop" data-stop style="display:flex;gap:0.4rem">
        <button class="btn-ghost" data-on-click="handleArchiveEnquiry" data-args='["${enq.id}"]' title="Archive" style="color:var(--muted)">
          <span class="material-symbols-outlined" style="font-size:0.9rem">archive</span>
        </button>
        <button class="btn-ghost" data-on-click="handleSoftDeleteEnquiry" data-args='["${enq.id}"]' title="Move to Bin" style="color:var(--muted)">
          <span class="material-symbols-outlined" style="font-size:0.9rem">delete</span>
        </button>
      </td>
    </tr>
  `).join('');
}

function selectEnquiry(enquiryId) {
  _selectedEnquiry = _allEnquiries.find(e => e.id === enquiryId);
  if (!_selectedEnquiry) return;

  const interestLabels = {
    free_audit:        'Free AI Governance Audit',
    au_compliance_core:'AU Compliance Core',
    full_toolkit:      'Full Responsible AI Toolkit',
    retainer:          'Governance Retainer',
    iso_pathway:       'ISO 42001 Certification Pathway',
    toolkit:           'Baseline Compliance Toolkit',  // legacy label
    general:           'General enquiry',
  };

  const enq = _selectedEnquiry;
  document.getElementById('enquiryDetail').innerHTML = `
    <div style="margin-bottom:1.25rem;display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
      <div>
        <div style="font-family:var(--font-headline);font-size:1.125rem;font-weight:700;color:var(--navy)">${escHtml(enq.name)}</div>
        <div style="font-size:0.875rem;color:var(--muted)">${escHtml(enq.company)}</div>
      </div>
      <select class="p-select" data-on-change="handleEnquiryStatusChange" data-args='["${enq.id}", "$value"]' style="width:130px;font-size:0.8rem;padding:0.375rem 0.625rem">
        <option value="new" ${enq.status==='new'?'selected':''}>New</option>
        <option value="contacted" ${enq.status==='contacted'?'selected':''}>Contacted</option>
        <option value="converted" ${enq.status==='converted'?'selected':''}>Converted</option>
        <option value="closed" ${enq.status==='closed'?'selected':''}>Closed</option>
      </select>
    </div>
    <div class="enquiry-field-label">Email</div>
    <div class="enquiry-field-value"><a href="mailto:${escHtml(enq.email)}" style="color:var(--brass)">${escHtml(enq.email)}</a></div>

    <div class="enquiry-field-label">What they build</div>
    <div class="enquiry-field-value">${escHtml(enq.company_builds)}</div>

    <div class="enquiry-field-label">Prompted by</div>
    <div class="enquiry-field-value">${escHtml(enq.enquiry_prompt)}</div>

    <div class="enquiry-field-label">Team size</div>
    <div class="enquiry-field-value">${escHtml(enq.team_size)}</div>

    <div class="enquiry-field-label">Interested in</div>
    <div class="enquiry-field-value" style="display:flex;flex-wrap:wrap;gap:6px">
      ${(Array.isArray(enq.interested_in) ? enq.interested_in : []).map(i => `<span class="status-badge status-new">${escHtml(Object.hasOwn(interestLabels, i) ? interestLabels[i] : i)}</span>`).join('')}
    </div>

    ${enq.existing_governance ? `<div class="enquiry-field-label">Existing governance</div><div class="enquiry-field-value">${escHtml(enq.existing_governance)}</div>` : ''}
    ${enq.additional_notes ? `<div class="enquiry-field-label">Additional notes</div><div class="enquiry-field-value">${escHtml(enq.additional_notes)}</div>` : ''}

    <div class="enquiry-field-label">Received</div>
    <div class="enquiry-field-value" style="color:var(--muted)">${formatDate(enq.created_at)}</div>
  `;
}

async function handleEnquiryStatusChange(enquiryId, status) {
  const ok = await updateEnquiryStatus(enquiryId, status);
  if (ok) {
    showToast('Status updated.', 'success');
    await loadEnquiries();
  }
}

// ─── Bin ───────────────────────────────────────────────────────

function daysRemaining(deletedAt) {
  const purgeDate = new Date(new Date(deletedAt).getTime() + 90 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((purgeDate - Date.now()) / (24 * 60 * 60 * 1000)));
}

function showBinTab(tab) {
  document.getElementById('binClientsPane').style.display   = tab === 'clients'   ? 'block' : 'none';
  document.getElementById('binEnquiriesPane').style.display = tab === 'enquiries' ? 'block' : 'none';
  document.getElementById('binTabClientsBtn').className   = tab === 'clients'   ? 'btn-navy'   : 'btn-outline';
  document.getElementById('binTabEnquiriesBtn').className = tab === 'enquiries' ? 'btn-navy'   : 'btn-outline';
  document.getElementById('binTabClientsBtn').style.fontSize   = '0.8125rem';
  document.getElementById('binTabEnquiriesBtn').style.fontSize = '0.8125rem';
}

async function loadBin() {
  await Promise.all([loadBinClients(), loadBinEnquiries()]);
}

async function loadBinClients() {
  const clients = await getDeletedClients();
  const tbody = document.getElementById('binClientsBody');

  // Auto-purge anything older than 90 days
  const expired = clients.filter(c => daysRemaining(c.deleted_at) === 0);
  await Promise.all(expired.map(c => permanentlyDeleteClient(c.id)));

  const active = clients.filter(c => daysRemaining(c.deleted_at) > 0);
  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Bin is empty.</td></tr>`;
    return;
  }
  tbody.innerHTML = active.map(c => {
    const days = daysRemaining(c.deleted_at);
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="client-avatar" style="width:28px;height:28px;font-size:0.65rem">${getInitials(c.full_name)}</div>
            <span style="font-weight:500">${escHtml(c.full_name)}</span>
          </div>
        </td>
        <td style="color:var(--muted)">${escHtml(c.company_name || '–')}</td>
        <td style="color:var(--muted)">${formatDate(c.deleted_at)}</td>
        <td><span class="status-badge ${days <= 7 ? 'scan-flagged' : 'status-paused'}">${days} day${days !== 1 ? 's' : ''}</span></td>
        <td style="display:flex;gap:0.4rem">
          <button class="btn-ghost" data-on-click="handleRestoreDeletedClient" data-args='["${c.id}"]'>
            <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">restore</span> Restore
          </button>
          <button class="btn-ghost" ${portalAction('handlePermanentDeleteClient', c.id, c.full_name)} style="color:#dc2626" title="Delete forever">
            <span class="material-symbols-outlined" style="font-size:0.9rem">delete_forever</span>
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function loadBinEnquiries() {
  const enqs = await getDeletedEnquiries();
  const tbody = document.getElementById('binEnquiriesBody');

  const expired = enqs.filter(e => daysRemaining(e.deleted_at) === 0);
  await Promise.all(expired.map(e => permanentlyDeleteEnquiry(e.id)));

  const active = enqs.filter(e => daysRemaining(e.deleted_at) > 0);
  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Bin is empty.</td></tr>`;
    return;
  }
  tbody.innerHTML = active.map(e => {
    const days = daysRemaining(e.deleted_at);
    return `
      <tr>
        <td style="font-weight:500">${escHtml(e.name)}</td>
        <td style="color:var(--muted)">${escHtml(e.company)}</td>
        <td style="color:var(--muted)">${formatDate(e.deleted_at)}</td>
        <td><span class="status-badge ${days <= 7 ? 'scan-flagged' : 'status-paused'}">${days} day${days !== 1 ? 's' : ''}</span></td>
        <td style="display:flex;gap:0.4rem">
          <button class="btn-ghost" data-on-click="handleRestoreDeletedEnquiry" data-args='["${e.id}"]'>
            <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">restore</span> Restore
          </button>
          <button class="btn-ghost" ${portalAction('handlePermanentDeleteEnquiry', e.id, e.name)} style="color:#dc2626" title="Delete forever">
            <span class="material-symbols-outlined" style="font-size:0.9rem">delete_forever</span>
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function handleSoftDeleteClient(clientId) {
  if (!confirm('Move this client to the Bin? They will be permanently deleted after 90 days unless restored.')) return;
  const ok = await softDeleteClient(clientId);
  if (ok) {
    showToast('Client moved to Bin.', 'success');
    if (_selectedClientId === clientId) closeClientWorkspace();
    await Promise.all([loadClients(), loadArchivedClients()]);
  }
}

async function handleSoftDeleteEnquiry(enquiryId) {
  if (!confirm('Move this enquiry to the Bin? It will be permanently deleted after 90 days unless restored.')) return;
  const ok = await softDeleteEnquiry(enquiryId);
  if (ok) {
    showToast('Enquiry moved to Bin.', 'success');
    await Promise.all([loadEnquiries(), loadArchivedEnquiries()]);
  }
}

async function handleRestoreDeletedClient(clientId) {
  const ok = await restoreDeletedClient(clientId);
  if (ok) { showToast('Client restored.', 'success'); await Promise.all([loadClients(), loadBinClients()]); }
}

async function handleRestoreDeletedEnquiry(enquiryId) {
  const ok = await restoreDeletedEnquiry(enquiryId);
  if (ok) { showToast('Enquiry restored.', 'success'); await Promise.all([loadEnquiries(), loadBinEnquiries()]); }
}

async function handlePermanentDeleteClient(clientId, name) {
  if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
  const result = await permanentlyDeleteClient(clientId);
  if (result.ok) { showToast('Client permanently deleted.', 'success'); await loadBinClients(); }
  else showToast(result.error, 'error');
}

async function handlePermanentDeleteEnquiry(enquiryId, name) {
  if (!confirm(`Permanently delete enquiry from "${name}"? This cannot be undone.`)) return;
  const ok = await permanentlyDeleteEnquiry(enquiryId);
  if (ok) { showToast('Enquiry permanently deleted.', 'success'); await loadBinEnquiries(); }
  else showToast('The enquiry could not be deleted. Please try again.', 'error');
}

// ─── Resend Invite ─────────────────────────────────────────────

async function fetchClientLoginStatus(clientId) {
  const session = await getSession();
  if (!session) return { hasLoggedIn: true }; // Default: hide button on error
  try {
    const res = await fetch('/api/get-client-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ clientId }),
    });
    if (!res.ok) return { hasLoggedIn: true };
    return await res.json();
  } catch {
    return { hasLoggedIn: true };
  }
}

async function handleResendInvite() {
  const client = _allClients.find(c => c.id === _selectedClientId);
  if (!client) return;

  const btn = document.getElementById('resendInviteBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    await resendInvite(client.email);
    showToast(`Invite resent to ${client.email}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:0.9rem">mark_email_unread</span> Resend Invite';
  }
}

async function handleSendPasswordReset() {
  const client = _allClients.find(c => c.id === _selectedClientId);
  if (!client) return;

  const btn = document.getElementById('sendPasswordResetBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch('/api/send-password-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email: client.email }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to send reset email');
    showToast(`Password reset email sent to ${client.email}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:0.9rem">lock_reset</span> Reset Password';
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Action Items ──────────────────────────────────────────────

async function refreshAdminActionItems() {
  if (!_selectedClientId) return;
  _adminActionItems = await getAdminActionItems(_selectedClientId);
  renderAdminActionItems(_adminActionItems);
}

function renderAdminActionItems(items) {
  const el = document.getElementById('wsActionItemsList');
  if (!items.length) {
    el.innerHTML = `<div style="padding:0.75rem 1rem;font-size:0.8125rem;color:var(--muted)">No action items yet.</div>`;
    return;
  }
  el.innerHTML = items.map(item => {
    const statusClass = `action-status-${item.status}`;
    const statusLabel = item.status === 'pending' ? 'Pending' : item.status === 'in_progress' ? 'In Progress' : 'Complete';
    const assignedLabel = item.assigned_to === 'client' ? 'Client' : 'Ethos';
    return `
    <div class="action-item-row" style="border-bottom:1px solid var(--border);border-radius:0;margin:0">
      <div class="action-item-dot ${item.status}"></div>
      <div class="action-item-body">
        <div class="action-item-title${item.status === 'complete' ? ' complete' : ''}">${escHtml(item.title)}</div>
        <div class="action-item-meta">
          <span class="action-status-badge ${statusClass}">${statusLabel}</span>
          <span style="opacity:0.35">·</span>
          <span>Assigned to: ${assignedLabel}</span>
          ${item.due_date ? `<span style="opacity:0.35">·</span><span>Due ${formatDate(item.due_date)}</span>` : ''}
        </div>
        ${item.notes ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:3px">${escHtml(item.notes)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="file-action-btn" data-on-click="openEditActionItemModal" data-args='["${item.id}"]' title="Edit">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="file-action-btn delete" data-on-click="handleDeleteAdminActionItem" data-args='["${item.id}"]' title="Delete">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`;
  }).join('');
  // Remove bottom border from last item
  const rows = el.querySelectorAll('.action-item-row');
  if (rows.length) rows[rows.length - 1].style.borderBottom = 'none';
}

function openCreateActionItemModal() {
  _editingActionItemId = null;
  document.getElementById('actionItemModalTitle').textContent = 'Add Action Item';
  document.getElementById('saveActionItemBtnLabel').textContent = 'Add Action Item';
  document.getElementById('actionItemTitle').value    = '';
  document.getElementById('actionItemStatus').value  = 'pending';
  document.getElementById('actionItemAssignedTo').value = 'client';
  document.getElementById('actionItemDueDate').value  = '';
  document.getElementById('actionItemNotes').value    = '';
  document.getElementById('createActionItemOverlay').classList.add('open');
  setTimeout(() => document.getElementById('actionItemTitle').focus(), 100);
}

function openEditActionItemModal(id) {
  const item = _adminActionItems.find(i => i.id === id);
  if (!item) return;
  _editingActionItemId = id;
  document.getElementById('actionItemModalTitle').textContent = 'Edit Action Item';
  document.getElementById('saveActionItemBtnLabel').textContent = 'Save Changes';
  document.getElementById('actionItemTitle').value      = item.title;
  document.getElementById('actionItemStatus').value     = item.status;
  document.getElementById('actionItemAssignedTo').value = item.assigned_to;
  document.getElementById('actionItemDueDate').value    = item.due_date || '';
  document.getElementById('actionItemNotes').value      = item.notes || '';
  document.getElementById('createActionItemOverlay').classList.add('open');
}

function closeCreateActionItemModal() {
  document.getElementById('createActionItemOverlay').classList.remove('open');
  _editingActionItemId = null;
}

async function handleSaveActionItem() {
  const title      = document.getElementById('actionItemTitle').value.trim();
  const status     = document.getElementById('actionItemStatus').value;
  const assignedTo = document.getElementById('actionItemAssignedTo').value;
  const dueDate    = document.getElementById('actionItemDueDate').value || null;
  const notes      = document.getElementById('actionItemNotes').value.trim() || null;

  if (!title) { showToast('Please enter a title.', 'error'); return; }

  const btn = document.getElementById('saveActionItemBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    if (_editingActionItemId) {
      // Update existing
      const ok = await updateActionItem(_editingActionItemId, { title, status, assigned_to: assignedTo, due_date: dueDate, notes });
      if (!ok) throw new Error('Update failed');
      showToast('Action item updated.', 'success');
    } else {
      // Create new — use the first/active engagement
      const engId = _selectedEngagementId;
      if (!engId) { showToast('No engagement found for this client.', 'error'); return; }
      const item = await createActionItem({
        engagementId: engId,
        clientId:     _selectedClientId,
        title, status, assignedTo, dueDate, notes,
      });
      if (!item) throw new Error('Create failed');
      // Notify client if assigned to them
      if (assignedTo === 'client') {
        sendNotification('action_item_created', _selectedClientId, item.id);
      }
      showToast('Action item added.', 'success');
    }
    closeCreateActionItemModal();
    await refreshAdminActionItems();
  } catch (err) {
    showToast(err.message || 'Something went wrong.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1rem">add_task</span> <span id="saveActionItemBtnLabel">${_editingActionItemId ? 'Save Changes' : 'Add Action Item'}</span>`;
  }
}

async function handleDeleteAdminActionItem(id) {
  const item = _adminActionItems.find(i => i.id === id);
  if (!confirm(`Delete "${item?.title || 'this action item'}"? This cannot be undone.`)) return;
  const ok = await deleteActionItem(id);
  if (ok) {
    showToast('Action item deleted.', 'success');
    await refreshAdminActionItems();
  }
}

// ─── Progress Stage ────────────────────────────────────────────

async function handleUpdateProgressStage(engId, stage) {
  const ok = await updateProgressStage(engId, stage || null);
  if (ok) {
    const eng = _allEngagements.find(e => e.id === engId);
    if (eng) eng.progress_stage = stage || null;
    showToast('Progress stage updated.', 'success');
    // Notify client if a stage was set (not cleared)
    if (stage && _selectedClientId) {
      sendNotification('progress_updated', _selectedClientId, engId);
    }
  } else {
    showToast('Failed to update progress stage.', 'error');
  }
}

// ─── Invoices ──────────────────────────────────────────────────

async function loadInvoices() {
  const invoices = await getAdminInvoices();
  renderInvoiceTable('invoicesTableBody', invoices, true);
}

async function refreshClientInvoices() {
  if (!_selectedClientId) return;
  const invoices = await getClientInvoices(_selectedClientId);
  const el = document.getElementById('wsInvoicesList');
  if (!invoices.length) {
    el.innerHTML = `<div style="font-size:0.8125rem;color:var(--muted);padding:0.25rem 0">No invoices yet.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="p-table-wrap" style="margin:0;border:none">
      <table class="p-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Product</th>
            <th>Amount</th>
            <th>Date</th>
            <th style="text-align:center">Sent</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="wsInvoicesBody"></tbody>
      </table>
    </div>
  `;
  renderInvoiceTable('wsInvoicesBody', invoices, false);
}

function renderInvoiceTable(tbodyId, invoices, showClient) {
  const tbody = document.getElementById(tbodyId);
  if (!invoices.length) {
    const cols = showClient ? 8 : 6;
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:2rem">No invoices yet.</td></tr>`;
    return;
  }
  const PRODUCT_LABELS = { au_compliance_core: 'AU Compliance Core', full_toolkit: 'Full Responsible AI Toolkit' };
  tbody.innerHTML = invoices.map(inv => {
    const amount       = '$' + (inv.amount_aud_cents / 100).toFixed(2);
    const productLabel = PRODUCT_LABELS[inv.product_tier] || inv.product_tier;
    const clientCell   = showClient
      ? `<td style="font-weight:500">${escHtml(inv.profiles?.full_name || '–')}</td>`
      : '';
    const actions = inv.file_path ? `
      <button class="btn-ghost" data-on-click="handleResendInvoice" data-args='["${inv.id}", "$this"]' title="Resend invoice email" style="font-size:0.8rem;padding:0.25rem 0.5rem">
        <span class="material-symbols-outlined" style="font-size:0.9rem">send</span>
      </button>
      <button class="btn-ghost" ${portalAction('adminDownloadInvoice', inv.file_path, inv.invoice_number + '.pdf')} title="Download PDF" style="font-size:0.8rem;padding:0.25rem 0.5rem">
        <span class="material-symbols-outlined" style="font-size:0.9rem">download</span>
      </button>`
      : `<span style="font-size:0.75rem;color:var(--muted)">No PDF</span>`;
    return `
      <tr>
        <td style="font-family:monospace;font-size:0.8125rem">${escHtml(inv.invoice_number)}</td>
        ${clientCell}
        <td style="color:var(--muted);font-size:0.8125rem">${escHtml(productLabel)}</td>
        <td>${amount}</td>
        <td style="color:var(--muted)">${formatDate(inv.issued_at)}</td>
        ${showClient ? `<td style="color:var(--muted)">${formatDate(inv.last_emailed_at)}</td>` : ''}
        <td style="text-align:center">${inv.email_count || 0}</td>
        <td style="display:flex;gap:0.25rem">${actions}</td>
      </tr>
    `;
  }).join('');
}

async function handleResendInvoice(invoiceId, btn) {
  const session = await getSession();
  if (!session) return;

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';

  try {
    const res = await fetch('/api/resend-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ invoiceId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to resend invoice');
    showToast('Invoice resent successfully.', 'success');
    // Refresh whichever invoice list is visible
    if (_selectedClientId) await refreshClientInvoices();
    else await loadInvoices();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

// ─── Revoke Access ─────────────────────────────────────────────

function openRevokeModal(accessId, engagementId, clientName, productName) {
  _pendingRevokeData = { accessId, engagementId };
  document.getElementById('revokeModalMsg').innerHTML =
    `Are you sure you want to revoke <strong>${escHtml(clientName)}'s</strong> access to <strong>${escHtml(productName)}</strong>? They will no longer be able to download these documents.`;
  document.getElementById('revokeModalOverlay').classList.add('open');
}

function closeRevokeModal() {
  document.getElementById('revokeModalOverlay').classList.remove('open');
  _pendingRevokeData = null;
}

async function confirmRevokeAccess() {
  if (!_pendingRevokeData) return;
  const btn = document.getElementById('revokeConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;border-color:#fff;border-top-color:transparent"></span> Revoking...';

  try {
    const session = await getSession();
    const res = await fetch('/api/revoke-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(_pendingRevokeData),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Revoke failed');

    showToast('Access revoked.', 'success');
    closeRevokeModal();
    // Reload client workspace to reflect updated state
    await selectClient(_selectedClientId);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem">lock</span> Revoke Access';
  }
}

// ─── Download Activity ─────────────────────────────────────────

async function refreshDownloadActivity() {
  if (!_selectedClientId) return;
  const activity = await getClientDownloadActivity(_selectedClientId);
  const el = document.getElementById('wsDownloadActivityList');

  if (!activity.templates.length) {
    el.innerHTML = `<div style="font-size:0.8125rem;color:var(--muted);padding:0.25rem 0">No template access yet.</div>`;
    return;
  }

  // Build a map of template_id → most recent download date
  const downloadMap = {};
  activity.downloads.forEach(d => {
    if (!downloadMap[d.template_id]) downloadMap[d.template_id] = d.downloaded_at;
  });

  const downloadedCount = activity.templates.filter(t => downloadMap[t.id]).length;
  const summary = `<div style="font-size:0.8125rem;color:var(--muted);margin-bottom:0.75rem">
    ${downloadedCount} of ${activity.templates.length} templates downloaded
  </div>`;

  const rows = activity.templates.map(t => {
    const dl = downloadMap[t.id];
    return `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.375rem 0;border-bottom:1px solid var(--border)">
        <span class="material-symbols-outlined"
          style="font-size:1rem;color:${dl ? '#059669' : '#d1d5db'};font-variation-settings:'FILL' 1;flex-shrink:0">
          ${dl ? 'check_circle' : 'radio_button_unchecked'}
        </span>
        <span style="flex:1;font-size:0.875rem;${dl ? '' : 'color:var(--muted)'}">${escHtml(t.display_name)}</span>
        <span style="font-size:0.75rem;color:var(--muted);white-space:nowrap">${dl ? formatDate(dl) : 'Not yet downloaded'}</span>
      </div>
    `;
  }).join('');

  el.innerHTML = summary + rows;
}

// ─── Admin Messages ────────────────────────────────────────────

async function loadAdminMessages() {
  _adminUnreadCounts = await getAllThreadUnreadCounts();
  renderMessagesClientList();
  updateAdminMessagesBadge();
}

function updateAdminMessagesBadge() {
  const total = Object.values(_adminUnreadCounts).reduce((s, n) => s + n, 0);
  const badge = document.getElementById('adminMessagesBadge');
  if (total > 0) { badge.textContent = total; badge.style.display = 'inline-flex'; }
  else           { badge.style.display = 'none'; }
}

function renderMessagesClientList() {
  const el = document.getElementById('messagesClientList');
  if (!_allClients.length) {
    el.innerHTML = `<div style="padding:1rem;font-size:0.8125rem;color:var(--muted)">No clients yet.</div>`;
    return;
  }
  el.innerHTML = _allClients.map(c => {
    const unread = _adminUnreadCounts[c.id] || 0;
    return `
    <button class="messages-client-row${_adminMessagesClientId === c.id ? ' active' : ''}"
      id="msgClientRow_${c.id}"
      data-on-click="openAdminThread" data-args='["${c.id}"]'>
      <div class="client-avatar" style="width:28px;height:28px;font-size:0.65rem;flex-shrink:0">${getInitials(c.full_name)}</div>
      <div class="messages-client-row-info">
        <div class="messages-client-row-name">${escHtml(c.full_name)}</div>
        <div class="messages-client-row-preview">${escHtml(c.company_name || 'No company')}</div>
      </div>
      ${unread ? `<div class="messages-unread-dot" title="${unread} unread"></div>` : ''}
    </button>`;
  }).join('');
}

async function openAdminThread(clientId) {
  _adminMessagesClientId = clientId;
  // Update active state
  document.querySelectorAll('.messages-client-row').forEach(el => el.classList.remove('active'));
  const row = document.getElementById(`msgClientRow_${clientId}`);
  if (row) row.classList.add('active');

  const client = _allClients.find(c => c.id === clientId);
  await loadAdminThread(clientId, client);
  startAdminMessagePoll(clientId, client);
}

async function loadAdminThread(clientId, client) {
  const msgs = await getMessages(clientId);
  _adminThreadMessages = msgs;

  // Mark client messages as read
  const hasUnread = msgs.some(m => m.sender_role === 'client' && !m.is_read);
  if (hasUnread) {
    markThreadRead(clientId, 'admin');
    delete _adminUnreadCounts[clientId];
    updateAdminMessagesBadge();
    // Remove unread dot from sidebar
    renderMessagesClientList();
  }

  renderAdminThread(clientId, client, msgs);
}

function renderAdminThread(clientId, client, msgs) {
  const panel = document.getElementById('messagesThreadPanel');
  const clientName = client ? client.full_name : 'Client';
  const clientEmail = client ? client.email : '';

  panel.innerHTML = `
    <div class="messages-thread-header">
      <div class="client-avatar" style="width:32px;height:32px;font-size:0.7rem;flex-shrink:0">${getInitials(clientName)}</div>
      <div>
        <div class="messages-thread-title">${escHtml(clientName)}</div>
        <div class="messages-thread-sub">${escHtml(clientEmail)}</div>
      </div>
    </div>
    <div class="messages-thread-messages" id="adminThreadMessages">
      ${renderAdminThreadMessages(clientId, msgs)}
    </div>
    <div class="messages-thread-input">
      <div class="chat-file-preview" id="adminMsgFilePreview" style="display:none">
        <span class="material-symbols-outlined">attach_file</span>
        <span id="adminMsgFileName"></span>
        <button data-on-click="clearAdminMsgFile" aria-label="Remove file">
          <span class="material-symbols-outlined" style="font-size:0.9rem">close</span>
        </button>
      </div>
      <div class="chat-input-row">
        <button class="chat-attach-btn" data-on-click="domClickById" data-args='["adminMsgFileInput"]' title="Attach a document">
          <span class="material-symbols-outlined">attach_file</span>
        </button>
        <input type="file" id="adminMsgFileInput" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none" data-on-change="setAdminMsgFile" data-args='["$file"]'/>
        <textarea class="chat-textarea" id="adminMsgInput" placeholder="Message ${escHtml(clientName)}…" rows="1"
          data-on-keydown="handleAdminMsgKeydown" data-args-keydown='["$event"]'
          data-on-input="domAutoGrow" data-args-input='["$this"]'></textarea>
        <button class="chat-send-btn" id="adminMsgSendBtn" data-on-click="handleAdminSendMessage" data-args='["${clientId}"]' title="Send">
          <span class="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>`;

  setTimeout(() => {
    const el = document.getElementById('adminThreadMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }, 0);

  // Wire file input
  const fi = document.getElementById('adminMsgFileInput');
  if (fi) fi.addEventListener('change', e => { if (e.target.files[0]) setAdminMsgFile(e.target.files[0]); });
}

function renderAdminThreadMessages(clientId, msgs) {
  if (!msgs.length) {
    return `<div class="chat-empty"><span class="material-symbols-outlined">chat</span><p>No messages yet. Send the first message.</p></div>`;
  }

  let html = '';
  let lastDate = null;
  msgs.forEach(msg => {
    const msgDate = new Date(msg.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    if (msgDate !== lastDate) {
      html += `<div class="chat-date-divider"><span>${msgDate}</span></div>`;
      lastDate = msgDate;
    }
    const isAdmin = msg.sender_role === 'admin';
    const time = new Date(msg.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const initials = isAdmin ? 'EA' : getInitials(msg.profiles?.full_name || 'C');

    let bodyHtml = '';
    if (msg.body) bodyHtml = `<div>${escHtml(msg.body).replace(/\n/g,'<br>')}</div>`;
    if (msg.document_id) {
      bodyHtml += `
        <div class="chat-file-attachment">
          <span class="material-symbols-outlined">description</span>
          <span class="chat-file-name">Attachment</span>
        </div>`;
    }

    html += `
    <div class="chat-message ${isAdmin ? 'from-client' : 'from-admin'}">
      <div class="chat-avatar">${initials}</div>
      <div>
        <div class="chat-bubble">${bodyHtml}</div>
        <span class="chat-time">${time}</span>
      </div>
    </div>`;
  });
  return html;
}

function setAdminMsgFile(file) {
  _adminMsgFile = file;
  document.getElementById('adminMsgFileName').textContent = file.name;
  document.getElementById('adminMsgFilePreview').style.display = 'flex';
}

function clearAdminMsgFile() {
  _adminMsgFile = null;
  const fi = document.getElementById('adminMsgFileInput');
  if (fi) fi.value = '';
  document.getElementById('adminMsgFilePreview').style.display = 'none';
}

function handleAdminMsgKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAdminSendMessage(_adminMessagesClientId);
  }
}

async function handleAdminSendMessage(clientId) {
  if (_adminMsgSending || !clientId) return;
  const input = document.getElementById('adminMsgInput');
  const body  = input ? input.value.trim() : '';
  if (!body && !_adminMsgFile) return;

  _adminMsgSending = true;
  const sendBtn = document.getElementById('adminMsgSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    let documentId = null;

    // Upload file if attached (admin can upload PDF or Word)
    if (_adminMsgFile) {
      // Find active engagement for this client
      const clientEngagements = await getEngagements(clientId);
      const engagement = clientEngagements.find(e => e.status === 'active') || clientEngagements[0];
      if (!engagement) throw new Error('No engagement found for this client.');

      const doc = await uploadDocument(
        _adminMsgFile,
        engagement.id,
        clientId,
        null,
        'ethos_deliverable',
        null,
        true  // adminMode
      );
      if (!doc) throw new Error('File upload failed.');
      documentId = doc.id;

      // Notify client of new document
      sendNotification('document_shared', clientId, documentId);
      clearAdminMsgFile();
    }

    const msg = await sendMessage({
      clientId,
      body:       body || null,
      documentId,
      senderRole: 'admin',
    });

    if (!msg) throw new Error('Failed to send message.');

    // Notify client of new admin message
    sendNotification('new_message_from_admin', clientId, msg.id);

    if (input) { input.value = ''; input.style.height = 'auto'; }

    // Reload thread
    const client = _allClients.find(c => c.id === clientId);
    await loadAdminThread(clientId, client);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    _adminMsgSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function startAdminMessagePoll(clientId, client) {
  stopAdminMessagePoll();
  _adminMsgPollTimer = setInterval(async () => {
    if (_adminMessagesClientId !== clientId) return;
    const msgs = await getMessages(clientId);
    if (msgs.length !== _adminThreadMessages.length) {
      _adminThreadMessages = msgs;
      // Mark client messages as read
      markThreadRead(clientId, 'admin');
      delete _adminUnreadCounts[clientId];
      updateAdminMessagesBadge();

      // Re-render thread messages (preserve scroll)
      const threadEl = document.getElementById('adminThreadMessages');
      if (threadEl) {
        const atBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 60;
        threadEl.innerHTML = renderAdminThreadMessages(clientId, msgs);
        if (atBottom) threadEl.scrollTop = threadEl.scrollHeight;
      }
    }
  }, 15000);
}

function stopAdminMessagePoll() {
  if (_adminMsgPollTimer) { clearInterval(_adminMsgPollTimer); _adminMsgPollTimer = null; }
}

// ─── Enquiry Tab ───────────────────────────────────────────────

function showEnquiryTab(tab) {
  document.getElementById('enqPaneEnquiries').style.display = tab === 'enquiries' ? 'block' : 'none';
  document.getElementById('enqPaneAbandoned').style.display = tab === 'abandoned' ? 'block' : 'none';
  document.getElementById('enqTabEnquiriesBtn').className = tab === 'enquiries' ? 'btn-navy' : 'btn-outline';
  document.getElementById('enqTabAbandonedBtn').className = tab === 'abandoned' ? 'btn-navy' : 'btn-outline';
  document.getElementById('enqTabEnquiriesBtn').style.fontSize = '0.8125rem';
  document.getElementById('enqTabAbandonedBtn').style.fontSize = '0.8125rem';
  if (tab === 'abandoned') loadAbandonedCheckouts();
}

async function loadAbandonedCheckouts() {
  const checkouts = await getAbandonedCheckouts();
  const tbody = document.getElementById('abandonedCheckoutsBody');
  if (!checkouts.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">No abandoned checkouts yet.</td></tr>`;
    return;
  }
  const PRODUCT_LABELS = { au_compliance_core: 'AU Compliance Core', full_toolkit: 'Full Responsible AI Toolkit' };
  tbody.innerHTML = checkouts.map(c => `
    <tr>
      <td>${c.customer_email
        ? `<a href="mailto:${escHtml(c.customer_email)}" style="color:var(--brass)">${escHtml(c.customer_email)}</a>`
        : '<span style="color:var(--muted)">—</span>'}
      </td>
      <td style="color:var(--muted);font-size:0.8125rem">${escHtml(PRODUCT_LABELS[c.product_tier] || c.product_tier)}</td>
      <td style="color:var(--muted)">${formatDate(c.abandoned_at)}</td>
      <td>${c.recovery_email_sent_at
        ? `<span class="status-badge status-active">Sent ${formatDate(c.recovery_email_sent_at)}</span>`
        : `<span class="status-badge status-paused">Not sent</span>`}
      </td>
      <td>${c.completed_at
        ? `<span class="status-badge status-active">Recovered</span>`
        : `<span class="status-badge">No</span>`}
      </td>
    </tr>
  `).join('');
}
