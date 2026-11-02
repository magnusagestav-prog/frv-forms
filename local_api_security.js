/* Local API session: affects only this app's same-origin /api requests. */
(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol !== 'http:') return;
  const originalFetch = window.fetch.bind(window);
  let session;
  window.fetch = async function(input, options) {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = String(options?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return originalFetch(input, options);
    }
    session ||= originalFetch('/api/session-token', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Kunde inte öppna lokal session.');
      return (await response.json()).token;
    }).catch(error => { session = null; throw error; });
    const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-FRV-Token', await session);
    headers.set('Content-Type', 'application/json');
    return originalFetch(input, { ...options, headers });
  };
})();
