/* DOMPurify is vendored in vendor/purify.min.js; update from web-tests lockfile. */
'use strict';
if (window.DOMPurify) {
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function sanitizeRenderedHtml(value) {
  if (!window.DOMPurify) throw new Error('HTML-skyddet kunde inte laddas.');
  return window.DOMPurify.sanitize(String(value ?? ''), { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
}

window.escapeHtml = escapeHtml;
window.sanitizeRenderedHtml = sanitizeRenderedHtml;
