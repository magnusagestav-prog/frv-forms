'use strict';

/**
 * FRV app-brygga för utskick.
 *
 * Definierar window.frvApi.sendMail() som admin-GUI:t och styrelseformuläret anropar.
 * Transporten är utbytbar:
 *   - mode 'disabled' (standard): inga utskick, sendMail returnerar { ok: false }.
 *   - mode 'mock': loggar och låtsas skicka (för demo/test) – markeras tydligt som testläge.
 *   - mode 'graph': skickar via Microsoft Graph /users/{avsändare}/sendMail.
 *
 * sendMail returnerar ALLTID ett resultatobjekt (kastar aldrig):
 *   { ok, id?, attempts, mode, error?, test? }
 *
 * Konfigurera från värdappen (Electron/webb) innan användning:
 *   frvApi.configure({ mode: 'graph', sender: 'kansli@funktionsrattvastmanland.se',
 *                      tokenProvider: async () => '<access token>' });
 */
(function initFrvApiBridge(global) {
  const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
  const LOG_KEY = 'frvSendLog';
  const MAX_LOG = 200;

  const state = {
    mode: 'disabled',
    sender: '',
    defaultFrom: 'Funktionsrätt Västmanland',
    defaultReplyTo: '',
    maxAttempts: 3,
    baseDelayMs: 800,
    saveToSentItems: true,
    labMode: false,
    labRecipient: '',
    tokenProvider: null,
    transport: null, // (payload, ctx) => Promise<{ id?: string }>
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
  };

  function configure(partial = {}) {
    Object.assign(state, partial);
    return getConfig();
  }

  function getConfig() {
    const { tokenProvider, transport, sleep, now, ...rest } = state;
    return { ...rest, hasTokenProvider: typeof tokenProvider === 'function', hasCustomTransport: typeof transport === 'function' };
  }

  function isReady() {
    if (state.mode === 'disabled') return false;
    if (state.mode === 'mock') return true;
    if (state.mode === 'graph') {
      return Boolean(state.sender) && (typeof state.transport === 'function' || typeof state.tokenProvider === 'function');
    }
    return false;
  }

  function readLog() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function appendLog(entry) {
    const log = readLog();
    log.push(entry);
    while (log.length > MAX_LOG) log.shift();
    try {
      if (global.localStorage) global.localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (error) {
      /* localStorage kan saknas – logg blir då bara i minnet via returvärdet */
    }
    return entry;
  }

  function getLog() { return readLog(); }
  function clearLog() {
    try { if (global.localStorage) global.localStorage.removeItem(LOG_KEY); } catch (error) { /* noop */ }
  }

  function toRecipientList(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : String(value).split(',');
    return items
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // Graphs direktbilagor (utan uppladdningssession) bör hållas under ~3 MB

  function buildAttachments(attachments) {
    if (!Array.isArray(attachments)) return [];
    return attachments
      .filter((item) => item && item.name && item.contentBytes)
      .map((item) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: item.name,
        contentType: item.contentType || 'application/octet-stream',
        contentBytes: item.contentBytes,
      }));
  }

  function buildGraphPayload(message) {
    const replyTo = message.replyTo || state.defaultReplyTo;
    const payload = {
      message: {
        subject: message.subject || '',
        body: {
          contentType: message.html ? 'HTML' : 'Text',
          content: message.html || message.body || '',
        },
        toRecipients: toRecipientList(message.to),
        ccRecipients: toRecipientList(message.cc),
        bccRecipients: toRecipientList(message.bcc),
      },
      saveToSentItems: message.saveToSentItems != null ? message.saveToSentItems : state.saveToSentItems,
    };
    if (replyTo) payload.message.replyTo = toRecipientList(replyTo);
    if (message.fromAddress || state.sender) {
      payload.message.from = { emailAddress: { address: message.fromAddress || state.sender, name: message.from || state.defaultFrom } };
    }
    const attachments = buildAttachments(message.attachments);
    if (attachments.length) payload.message.attachments = attachments;
    return payload;
  }

  function validateMessage(message) {
    const errors = [];
    const to = toRecipientList(message.to);
    if (!to.length) errors.push('Ingen mottagare angiven.');
    to.concat(toRecipientList(message.cc), toRecipientList(message.bcc)).forEach((recipient) => {
      if (!isValidEmail(recipient.emailAddress.address)) {
        errors.push(`Ogiltig e-postadress: ${recipient.emailAddress.address}`);
      }
    });
    if (!String(message.subject || '').trim()) errors.push('Ämne saknas.');
    if (!String(message.html || message.body || '').trim()) errors.push('Meddelandetext saknas.');
    (message.attachments || []).forEach((item) => {
      const bytes = item && item.contentBytes ? Math.ceil((item.contentBytes.length * 3) / 4) : 0;
      if (bytes > MAX_ATTACHMENT_BYTES) {
        errors.push(`Bilagan "${item.name}" är för stor (max 3 MB per fil).`);
      }
    });
    return errors;
  }

  async function defaultGraphTransport(payload) {
    if (typeof state.tokenProvider !== 'function') {
      throw Object.assign(new Error('Ingen tokenProvider konfigurerad för Graph-läget.'), { permanent: true });
    }
    const token = await state.tokenProvider();
    if (!token) throw Object.assign(new Error('tokenProvider returnerade ingen access token.'), { permanent: true });
    if (typeof fetch !== 'function') {
      throw Object.assign(new Error('fetch är inte tillgängligt i den här miljön.'), { permanent: true });
    }
    const response = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(state.sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 202) return { id: response.headers.get('request-id') || null };
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch (error) { /* ignore */ }
    const err = new Error(`Graph svarade ${response.status}. ${detail}`);
    err.status = response.status;
    err.permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    err.retryAfterMs = Number(response.headers.get('retry-after') || 0) * 1000 || null;
    throw err;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  // Lab-läge: omdirigerar utskick till en testadress i stället för de riktiga
  // mottagarna – för att kunna testa utskicksflödet utan att mejla skarpt.
  function applyLabRedirect(message) {
    if (!state.labMode || !state.labRecipient) return message;
    const originalTo = Array.isArray(message.to) ? message.to.join(', ') : String(message.to || '');
    const note = `[Lab-läge: skulle egentligen ha gått till: ${originalTo}]`;
    return {
      ...message,
      to: state.labRecipient,
      cc: '',
      bcc: '',
      subject: `[LAB] ${message.subject || ''}`,
      body: message.body ? `${note}\n\n${message.body}` : message.body,
      html: message.html ? `<p><em>${escapeHtml(note)}</em></p>${message.html}` : message.html,
    };
  }

  async function sendMail(rawMessage = {}) {
    const message = applyLabRedirect(rawMessage);
    const started = state.now();
    const summary = {
      timestamp: started,
      to: (Array.isArray(message.to) ? message.to.join(', ') : String(message.to || '')),
      // Bcc syns nu i loggen – annars är det osynligt i efterhand vilka som
      // faktiskt fick ett massutskick. Upptäckt 2026-09-08: en styrelse-
      // påminnelse gick ut med över 100 adresser synliga i Till-fältet i
      // stället för Bcc, och det märktes bara för att en mottagare svarade.
      bcc: (Array.isArray(message.bcc) ? message.bcc.join(', ') : String(message.bcc || '')),
      subject: message.subject || '',
      mode: state.mode,
    };

    if (state.mode === 'disabled') {
      appendLog({ ...summary, ok: false, attempts: 0, error: 'Utskick är inte konfigurerat (mode: disabled).' });
      return { ok: false, attempts: 0, mode: state.mode, error: 'Utskick är inte konfigurerat.' };
    }

    const validationErrors = validateMessage(message);
    if (validationErrors.length) {
      appendLog({ ...summary, ok: false, attempts: 0, error: validationErrors.join(' ') });
      return { ok: false, attempts: 0, mode: state.mode, error: validationErrors.join(' ') };
    }

    if (state.mode === 'mock') {
      const id = `mock-${Date.now()}`;
      appendLog({ ...summary, ok: true, attempts: 1, id, test: true });
      return { ok: true, id, attempts: 1, mode: 'mock', test: true };
    }

    const transport = typeof state.transport === 'function' ? state.transport : defaultGraphTransport;
    const payload = buildGraphPayload(message);
    let lastError = null;

    for (let attempt = 1; attempt <= Math.max(1, state.maxAttempts); attempt += 1) {
      try {
        const result = await transport(payload, { attempt, message });
        appendLog({ ...summary, ok: true, attempts: attempt, id: (result && result.id) || null });
        return { ok: true, id: (result && result.id) || null, attempts: attempt, mode: state.mode };
      } catch (error) {
        lastError = error;
        if (error && error.permanent) break;
        if (attempt < state.maxAttempts) {
          const wait = (error && error.retryAfterMs) || state.baseDelayMs * (2 ** (attempt - 1));
          await state.sleep(wait);
        }
      }
    }

    const errorText = (lastError && lastError.message) || 'Okänt fel vid utskick.';
    appendLog({ ...summary, ok: false, attempts: Math.max(1, state.maxAttempts), error: errorText });
    return { ok: false, attempts: Math.max(1, state.maxAttempts), mode: state.mode, error: errorText };
  }

  global.frvApi = {
    configure,
    getConfig,
    isReady,
    sendMail,
    getLog,
    clearLog,
    _state: state, // exponeras för tester
  };
}(typeof window !== 'undefined' ? window : globalThis));
