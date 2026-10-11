'use strict';
// ─── Ethos — Declarative event handlers (security plan P12) ──────────────────
// Pages declare handlers as data attributes instead of inline on*="…" code, so
// a Content-Security-Policy can forbid inline script:
//
//   <button data-on-click="toggleFaq" data-args='["$this"]'>
//
// data-args is a JSON array (data-args-<event> when an element has several
// handlers); "$this" is the element, "$event" the event,
// "$value" element.value and "$file" element.files[0]. data-prevent and
// data-stop call preventDefault / stopPropagation. Handlers run from the
// clicked element outwards, as inline handlers did, until one has data-stop.
// Only the allow-listed global functions below can be called, so injected
// markup cannot invoke arbitrary code.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const ALLOWED = new Set([
    'autoGrowTextarea', 'clearAdminFile', 'clearAdminMsgFile', 'clearChatFile',
    'clearSelectedFile', 'closeAddEngagementModal', 'closeAdminUploadModal',
    'closeClientWorkspace', 'closeCreateActionItemModal', 'closeInviteModal', 'closeMobileNav',
    'closeRevokeModal', 'closeUploadModal', 'confirmRevokeAccess', 'focusPCard',
    'handleAddEngagement', 'handleAdminMsgKeydown', 'handleAdminSendMessage',
    'handleAdminUpload', 'handleArchiveClient', 'handleArchiveEnquiry', 'handleChatKeydown',
    'handleClientCompleteAction', 'handleConsentContinue', 'handleDeleteAdminActionItem',
    'handleEnquiryStatusChange', 'handleInviteClient', 'handlePathFormSubmit',
    'handleRemoveEngagement', 'handleResendInvite', 'handleResendInvoice',
    'handleRestoreDeletedClient', 'handleRestoreDeletedEnquiry', 'handleSaveActionItem',
    'handleSaveNotifPrefs', 'handleSaveSettings', 'handleSendMessage',
    'handleSendPasswordReset', 'handleSoftDeleteClient', 'handleSoftDeleteEnquiry',
    'handleUnarchiveClient', 'handleUnarchiveEnquiry', 'handleUpdateEngagementStatus',
    'handleUpdateProgressStage', 'handleUpload', 'markReviewed', 'openAddEngagementModal',
    'openAdminThread', 'openAdminUploadModal', 'openCreateActionItemModal',
    'openEditActionItemModal', 'openInviteModal', 'openUploadModal', 'scrollToSection',
    'selectClient', 'selectEnquiry', 'setAdminMsgFile', 'showArchiveTab', 'showBinTab',
    'showClientView', 'showEnquiryTab', 'showView', 'signOut', 'startCheckout',
    'toggleBonusSecondary', 'toggleFaq', 'toggleGeneralEnquiry', 'toggleMobileNav',
  ]);

  const helpers = {
    domNoop() {},
    domClickById(id) { const el = document.getElementById(id); if (el) el.click(); },
    domScrollToId(id) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); },
    domAutoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; },
    domCloseWindow() { window.close(); },
  };

  function resolve(arg, el, event) {
    if (arg === '$this') return el;
    if (arg === '$event') return event;
    if (arg === '$value') return el.value;
    if (arg === '$file') return el.files && el.files[0];
    return arg;
  }

  function run(el, event) {
    const name = el.getAttribute('data-on-' + event.type);
    if (el.hasAttribute('data-prevent')) event.preventDefault();
    const fn = Object.hasOwn(helpers, name) ? helpers[name]
      : (ALLOWED.has(name) && typeof window[name] === 'function' ? window[name] : null);
    if (!fn) return;
    // An element with several handlers gives each its own data-args-<event>.
    const raw = el.getAttribute('data-args-' + event.type) ?? el.getAttribute('data-args');
    let args = [];
    if (raw) {
      try { args = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(args)) return;
    }
    fn(...args.map(a => resolve(a, el, event)));  // called plainly, like an inline handler
  }

  function dispatch(event) {
    const selector = '[data-on-' + event.type + ']';
    let el = event.target instanceof Element ? event.target.closest(selector) : null;
    while (el) {
      run(el, event);
      if (el.hasAttribute('data-stop')) { event.stopPropagation(); break; }
      el = el.parentElement ? el.parentElement.closest(selector) : null;
    }
  }

  ['click', 'change', 'input', 'keydown', 'submit'].forEach(type =>
    document.addEventListener(type, dispatch));
})();
