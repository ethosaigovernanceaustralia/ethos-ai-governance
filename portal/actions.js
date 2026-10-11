'use strict';

function portalAction(name, ...args) {
  const attribute = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  return `data-portal-action="${attribute(name)}" data-portal-args="${attribute(JSON.stringify(args))}"`;
}

function registerPortalActions(handlers) {
  document.addEventListener('click', event => {
    const element = event.target.closest?.('[data-portal-action]');
    if (!element) return;
    const name = element.dataset.portalAction;
    if (!Object.hasOwn(handlers, name) || typeof handlers[name] !== 'function') return;
    let args;
    try { args = JSON.parse(element.dataset.portalArgs); } catch { return; }
    if (!Array.isArray(args)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      Promise.resolve(handlers[name](...args)).catch(() => showToast('The action could not be completed. Please try again.', 'error'));
    } catch {
      showToast('The action could not be completed. Please try again.', 'error');
    }
  });
}

if (typeof module !== 'undefined') module.exports = { portalAction, registerPortalActions };
