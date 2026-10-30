'use strict';

const KANSLI_EMAIL = 'kansli@funktionsrattvastmanland.se';
const ROLE_OPTIONS = ['Administratör', 'Föreningsadministratör', 'Föreningsmedlem'];
const POSITION_OPTIONS = ['Ordförande', 'Vice Ordförande', 'Sekreterare', 'Kassör', 'Ledamot', 'Revisor', 'Ersättare', 'Personal', 'Kanslist', 'Funktionär', 'Valberedning'];
const SINGLE_HOLDER_POSITIONS = ['ordförande', 'vice ordförande', 'sekreterare', 'kassör'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Samma ordning som HIERARCHY i src/escalation.py – används av
// "Skicka till nästa person"-knappen för att hitta rätt mottagare.
const ESCALATION_HIERARCHY = ['ordförande', 'vice ordförande', 'kassör', 'sekreterare'];
let currentPrefill = [];

const BOARD_FORM_START = '===FRV-STYRELSE-START===';
const BOARD_FORM_END = '===FRV-STYRELSE-SLUT===';

let submitAttempts = 0;

function params() {
  const query = new URLSearchParams(window.location.search);
  return {
    forening: query.get('forening') || '',
    member_id: query.get('member_id') || '',
    inskickat_av: query.get('inskickat_av') || '',
    inskickat_av_id: query.get('inskickat_av_id') || '',
    data: query.get('data') || '',
    brev: query.get('brev') || ''
  };
}

function decodeLinkMessage(raw) {
  // Motsvarar encodeLinkMessage() i mail_list_ui.js: base64url-kodad HTML-sträng
  // med det aktuella följebrevet från kansliets redigerare – ingen statisk text
  // här, formuläret visar alltid det som faktiskt skickades med länken.
  if (!raw) return '';
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch (error) {
    return '';
  }
}

function decodePrefillPeople(raw) {
  // Motsvarar encodePrefillPeople() i mail_list_ui.js / _encode_prefill() i
  // src/board_form_links.py: base64url-kodad JSON, ingen komprimering (listan
  // är alltid liten – en förenings egna funktionärer, inte hela riksregistret).
  if (!raw) return [];
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    const data = JSON.parse(json);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function optionList(values, selected) {
  return ['<option value="">–</option>']
    .concat(values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`))
    .join('');
}

function addRow(person = {}) {
  const tbody = document.querySelector('#rows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="fn" value="${person.first_name || ''}" autocomplete="off" /></td>
    <td><input class="en" value="${person.last_name || ''}" autocomplete="off" /></td>
    <td><select class="roll">${optionList(ROLE_OPTIONS, person.roll || '')}</select></td>
    <td><select class="position">${optionList(POSITION_OPTIONS, person.position || '')}</select></td>
    <td><input class="epost" type="email" value="${person.epost || ''}" autocomplete="off" /></td>
    <td><input class="telefon" value="${person.telefon || ''}" autocomplete="off" /></td>
    <td class="mid"><input class="offentlig" type="checkbox"${person.offentlig ? ' checked' : ''} /></td>
    <td class="mid"><input class="bokning" type="checkbox"${person.bokning ? ' checked' : ''} /></td>
    <td class="mid"><input class="kopiering" type="checkbox"${person.kopiering ? ' checked' : ''} /></td>
    <td class="mid"><button type="button" class="link remove">Ta bort</button></td>
  `;
  tr.querySelector('.remove').addEventListener('click', () => {
    tr.remove();
    if (!tbody.querySelector('tr')) addRow();
  });
  tbody.appendChild(tr);
}

function collectRows() {
  return [...document.querySelectorAll('#rows tr')].map((tr) => ({
    first_name: tr.querySelector('.fn').value.trim(),
    last_name: tr.querySelector('.en').value.trim(),
    roll: tr.querySelector('.roll').value,
    position: tr.querySelector('.position').value,
    epost: tr.querySelector('.epost').value.trim().toLowerCase(),
    telefon: tr.querySelector('.telefon').value.trim(),
    offentlig: tr.querySelector('.offentlig').checked,
    bokning: tr.querySelector('.bokning').checked,
    kopiering: tr.querySelector('.kopiering').checked,
    foreningsmejl: true
  })).filter((row) => row.first_name || row.last_name || row.epost || row.roll);
}

function validate(people, confirmed) {
  const errors = [];
  if (!people.length) errors.push('Minst en funktionär måste anges.');
  if (!confirmed) errors.push('Bocka i bekräftelserutan innan du skickar.');

  const emailCounts = {};
  people.forEach((person, index) => {
    const number = index + 1;
    if (!(person.first_name && person.last_name)) errors.push(`Rad ${number}: för- och efternamn saknas.`);
    if (!person.roll) errors.push(`Rad ${number}: roll saknas.`);
    if (!person.epost) errors.push(`Rad ${number}: e-post saknas.`);
    else if (!EMAIL_RE.test(person.epost)) errors.push(`Rad ${number}: ogiltig e-postadress (${person.epost}).`);
    if (person.epost) emailCounts[person.epost] = (emailCounts[person.epost] || 0) + 1;
  });

  Object.entries(emailCounts).forEach(([email, count]) => {
    if (count > 1) errors.push(`E-postadressen ${email} förekommer ${count} gånger.`);
  });

  const holders = {};
  people.forEach((person) => {
    const key = person.position.toLowerCase();
    if (SINGLE_HOLDER_POSITIONS.includes(key)) {
      (holders[key] = holders[key] || []).push(`${person.first_name} ${person.last_name}`.trim() || person.epost);
    }
  });
  Object.entries(holders).forEach(([position, names]) => {
    if (names.length > 1) {
      const label = position.charAt(0).toUpperCase() + position.slice(1);
      errors.push(`Flera personer har positionen ${label}: ${names.join(', ')}.`);
    }
  });

  return errors;
}

function buildBlock(people) {
  const query = params();
  const payload = {
    forening: document.querySelector('#forening').value.trim(),
    member_id: query.member_id,
    inskickat_av: document.querySelector('#inskickat-av').value.trim(),
    inskickat_av_id: query.inskickat_av_id,
    ar: new Date().getFullYear(),
    skickad: new Date().toISOString().split('T')[0],
    bekraftad: true,
    ny_styrelse: people
  };
  return `${BOARD_FORM_START}\n${JSON.stringify(payload)}\n${BOARD_FORM_END}`;
}

function summary(people) {
  const lines = people.map((person) =>
    `• ${person.first_name} ${person.last_name} – ${person.roll}${person.position ? ' / ' + person.position : ''} – ${person.epost}` +
    `${person.offentlig ? ' – offentlig' : ''}${person.bokning ? ' – bokningsbehörighet' : ''}${person.kopiering ? ' – kopieringskonto' : ''}`);
  return `${people.length} funktionärer\n\n${lines.join('\n')}`;
}

function showErrors(errors) {
  const box = document.querySelector('#fel-box');
  if (!errors.length) { box.hidden = true; box.textContent = ''; return false; }
  box.hidden = false;
  box.innerHTML = '<strong>Kontrollera formuläret:</strong><ul>' +
    errors.map((error) => `<li>${error}</li>`).join('') + '</ul>';
  return true;
}

function emailJsConfigured() {
  return Boolean(window.emailjs && window.FRV_EMAILJS_SERVICE_ID && window.FRV_EMAILJS_TEMPLATE_ID
    && window.FRV_EMAILJS_PUBLIC_KEY);
}

function review() {
  const people = collectRows();
  const confirmed = document.querySelector('#bekrafta').checked;
  if (!document.querySelector('#forening').value.trim()) {
    showErrors(['Föreningens namn saknas.']);
    return;
  }
  const errors = validate(people, confirmed);
  if (showErrors(errors)) return;

  const block = buildBlock(people);
  document.querySelector('#resultat').hidden = false;
  document.querySelector('#sammanfattning').textContent = summary(people);
  document.querySelector('#block').value = block;

  const bridge = window.frvApi && typeof window.frvApi.sendMail === 'function'
    && (typeof window.frvApi.isReady !== 'function' || window.frvApi.isReady());
  document.querySelector('#skicka-m365').hidden = !bridge;

  const emailJsReady = emailJsConfigured();
  const emailJsButton = document.querySelector('#skicka-emailjs');
  emailJsButton.hidden = !emailJsReady;
  emailJsButton.disabled = false;
  emailJsButton.textContent = '✅ Skicka in';

  // Mailto/kopiera/sammanfattning/rå-blocket är bara reserv och teknisk
  // utskrift – döljs när EmailJS faktiskt fungerar så en förening bara ser
  // "Skicka in", inte tre olika sätt att göra samma sak plus en bit rå JSON.
  // Kommer tillbaka automatiskt om EmailJS av någon anledning slutar fungera.
  document.querySelector('#oppna-mail').hidden = emailJsReady;
  document.querySelector('#kopiera').hidden = emailJsReady;
  document.querySelector('#sammanfattning-block').hidden = emailJsReady;
  document.querySelector('#block').hidden = emailJsReady;

  const helpText = document.querySelector('#resultat-hjalptext');
  if (emailJsReady) {
    helpText.textContent = 'Tryck på "Skicka in" nedan – inskicket går direkt till kansliet, inget e-postprogram behöver öppnas.';
  } else if (bridge) {
    helpText.textContent = 'Klart att skickas via Microsoft 365.';
  } else {
    helpText.textContent = 'Skicka in genom att trycka på knappen nedan – ditt e-postprogram öppnas med allt ifyllt, texten nedan ska inte ändras.';
  }
  document.querySelector('#status').textContent = '';
  document.querySelector('#resultat').scrollIntoView?.({ behavior: 'smooth' });
}

async function sendViaEmailJs() {
  const forening = document.querySelector('#forening').value.trim();
  const button = document.querySelector('#skicka-emailjs');
  const status = document.querySelector('#status');
  button.disabled = true;
  button.textContent = 'Skickar…';
  try {
    window.emailjs.init({ publicKey: window.FRV_EMAILJS_PUBLIC_KEY });
    await window.emailjs.send(window.FRV_EMAILJS_SERVICE_ID, window.FRV_EMAILJS_TEMPLATE_ID, {
      forening,
      inskickat_av: document.querySelector('#inskickat-av').value.trim(),
      subject: `Styrelseuppgifter ${forening}`.trim(),
      message: document.querySelector('#block').value,
      to_email: KANSLI_EMAIL,
    });
    status.textContent = 'Skickat till kansliet. Tack!';
    button.textContent = 'Skickat';
  } catch (error) {
    submitAttempts += 1;
    status.textContent = submitAttempts === 1
      ? `Det gick inte att skicka just nu (${(error && error.text) || (error && error.message) || 'okänt fel'}). `
        + 'Vänta en stund och försök igen, eller använd e-postknappen.'
      : `Fortfarande fel efter ${submitAttempts} försök. Kontakta ${KANSLI_EMAIL} eller använd e-postknappen.`;
    button.disabled = false;
    button.textContent = '↺ Försök igen';
  }
}

async function copyBlock() {
  const text = document.querySelector('#block').value;
  try {
    await navigator.clipboard.writeText(text);
    document.querySelector('#status').textContent = 'Kopierat till urklipp.';
  } catch (error) {
    const field = document.querySelector('#block');
    field.select();
    document.execCommand('copy');
    document.querySelector('#status').textContent = 'Kopierat.';
  }
}

function forwardForm() {
  const emailField = document.querySelector('#vidarebefordra-epost');
  const status = document.querySelector('#vidarebefordra-status');
  const email = emailField.value.trim();
  if (!email || !EMAIL_RE.test(email)) {
    status.textContent = 'Ange en giltig e-postadress.';
    return;
  }
  const forening = document.querySelector('#forening').value.trim() || 'er förening';
  const subject = `Vidarebefordrat: styrelseformulär för ${forening}`;
  const body = `Hej!\n\nKan du fylla i det här formuläret om ${forening}s styrelse/funktionärer?\n\n${window.location.href}\n\nMvh`;
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  status.textContent = 'Öppnar e-postprogrammet…';
}

function findNextInHierarchy(people) {
  for (const role of ESCALATION_HIERARCHY) {
    const match = people.find((p) => (p.position || '').trim().toLowerCase() === role
      && p.epost && EMAIL_RE.test(p.epost));
    if (match) return { email: match.epost, role: match.position };
  }
  return null;
}

function sendToNextPerson() {
  const status = document.querySelector('#nasta-person-status');
  const forening = document.querySelector('#forening').value.trim() || 'er förening';

  const next = findNextInHierarchy(currentPrefill);
  if (next) {
    const subject = `Vidarebefordrat: styrelseformulär för ${forening}`;
    const body = `Hej!\n\nDetta formulär har skickats vidare till dig som ${next.role} i ${forening}, `
      + `eftersom föregående mottagare inte visste vem som var rätt person eller inte hade din e-postadress.\n\n`
      + `Kan du fylla i det här formuläret om ${forening}s styrelse/funktionärer?\n\n${window.location.href}\n\nMvh`;
    window.location.href = `mailto:${encodeURIComponent(next.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = `Öppnar e-postprogrammet, adresserat till ${next.role} (${next.email}).`;
    return;
  }

  const allEmails = currentPrefill.map((p) => p.epost).filter((email) => email && EMAIL_RE.test(email));
  if (allEmails.length) {
    const subject = `Vidarebefordrat: styrelseformulär för ${forening}`;
    const body = `Hej!\n\nVi hittar ingen känd e-post till ordförande, vice ordförande, kassör eller sekreterare `
      + `i ${forening}, så formuläret skickas till hela styrelsen i stället.\n\n`
      + `Kan någon av er fylla i det här formuläret om ${forening}s styrelse/funktionärer?\n\n${window.location.href}\n\nMvh`;
    window.location.href = `mailto:${allEmails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = `Ingen i ordförande/vice ordförande/kassör/sekreterare-ordningen hade en känd e-post – `
      + `öppnar e-postprogrammet till hela styrelsen (${allEmails.length} st).`;
    return;
  }

  status.textContent = `Vi har inga fler kontaktuppgifter registrerade för ${forening} – kontakta kansliet direkt på ${KANSLI_EMAIL}.`;
}

function openMail() {
  const forening = document.querySelector('#forening').value.trim();
  const subject = `Styrelseuppgifter ${forening}`.trim();
  const body = document.querySelector('#block').value;
  window.location.href = `mailto:${KANSLI_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function sendViaM365() {
  const forening = document.querySelector('#forening').value.trim();
  const button = document.querySelector('#skicka-m365');
  button.disabled = true;
  button.textContent = 'Skickar…';
  let result;
  try {
    result = await window.frvApi.sendMail({
      from: 'Funktionsrätt Västmanland',
      fromAddress: KANSLI_EMAIL,
      to: KANSLI_EMAIL,
      replyTo: document.querySelector('#inskickat-av').value.trim() || KANSLI_EMAIL,
      subject: `Styrelseuppgifter ${forening}`.trim(),
      body: document.querySelector('#block').value
    });
  } catch (error) {
    result = { ok: false, error: error && error.message };
  }

  if (result && result.ok) {
    document.querySelector('#status').textContent = result.test
      ? 'Skickat i testläge – inget riktigt utskick. Använd e-postknappen för skarpt inskick.'
      : 'Skickat via Microsoft 365. Tack!';
    button.textContent = 'Skickat';
    return;
  }

  submitAttempts += 1;
  document.querySelector('#status').textContent = submitAttempts === 1
    ? `Det gick inte att skicka just nu (${(result && result.error) || 'okänt fel'}). Vänta en stund och försök igen, eller använd e-postknappen.`
    : `Fortfarande fel efter ${submitAttempts} försök. Kontakta ${KANSLI_EMAIL}.`;
  button.disabled = false;
  button.textContent = '↺ Försök igen';
}

document.addEventListener('DOMContentLoaded', () => {
  const query = params();
  document.querySelector('#forening').value = query.forening;
  document.querySelector('#inskickat-av').value = query.inskickat_av;
  if (query.forening) document.querySelector('#rubrik').textContent = query.forening;

  // Länken kan bära på en redigerad version (brev=), annars visas samma
  // standardtext som mejlet alltid skickas med – aldrig tomt.
  const brevHtml = decodeLinkMessage(query.brev) || window.FRV_DEFAULT_LINK_MESSAGE || '';
  if (brevHtml) document.querySelector('#brev-text').innerHTML = brevHtml;

  const prefill = decodePrefillPeople(query.data);
  currentPrefill = prefill;
  const lead = document.querySelector('p.lead');
  if (prefill.length) {
    prefill.forEach((person) => addRow(person));
    if (lead) {
      lead.insertAdjacentHTML('afterend',
        `<p class="muted" id="prefill-info">Vi har fyllt i era ${prefill.length} nuvarande funktionärer nedan. Kontrollera att uppgifterna stämmer, ta bort de som slutat och lägg till nya innan ni skickar in.</p>`);
    }
  } else {
    addRow();
  }
  document.querySelector('#forening').addEventListener('input', (event) => {
    document.querySelector('#rubrik').textContent = event.target.value.trim() || 'Din förening';
  });
  document.querySelector('#lagg-till').addEventListener('click', () => addRow());
  document.querySelector('#vidarebefordra-knapp').addEventListener('click', forwardForm);
  document.querySelector('#nasta-person-knapp').addEventListener('click', sendToNextPerson);
  document.querySelector('#granska').addEventListener('click', review);
  document.querySelector('#kopiera').addEventListener('click', copyBlock);
  document.querySelector('#oppna-mail').addEventListener('click', openMail);
  document.querySelector('#skicka-m365').addEventListener('click', sendViaM365);
  document.querySelector('#skicka-emailjs').addEventListener('click', sendViaEmailJs);
});
