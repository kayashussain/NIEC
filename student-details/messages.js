// The messages sent to many students at once from Follow-up: the words the sender writes, filled in with each student's own
// details, sent by email from the sender's mailbox with their signature, or opened in WhatsApp. There are no saved templates any
// more (the owner, 17 Nov 2026: the student card has Call, WhatsApp and Email, and Follow-up is written each time).
//
// The system only sends. A student's reply goes to the sender's mailbox (or WhatsApp) like any other message; nothing here reads
// replies.
//
// The consultancy's name and the office settings (copy every email to the office) are kept in message-templates.json in the data
// folder (never in git; the name of the file stays, so the live server's file keeps working). Any templates saved there by an
// earlier version are left as they are and no longer used.
//
// A message is plain text: a blank line starts a new paragraph, a line that starts with "- " is a bullet and one that starts with
// "## " is a small heading. {curly} words are filled in from the student (see FIELDS).
// For a marketing email (the owner, 17 Nov 2026) three more kinds of line: "# Title | small line under it" as the very first line
// is a coloured banner across the top of the email; "!! words" is a highlighted box; "[[Label | address]]" is a big button
// (several on one line sit side by side). A button to wa.me or WhatsApp is green, every other one blue; the address may be
// https, http, tel: (a phone call) or mailto:.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic, localDate } = require('../shared/server-utils');
const Fields = require('./card-fields');
const { isoDate } = require('./dashboard-stats');

// The company name of this installation is a setting (the signature, set by Admin); this is only what an installation starts with.
const COMPANY = 'Nepal International Educational Consultancy';
const initialsOf = (name) => String(name || '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|the|\(.*\))$/i.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 8);
const LIMITS = { subject: 200, body: 8000, whatsapp: 3000, short: 200 };

// The words that can be used in a message, and what each stands for.
const FIELDS = [
  ['first_name', "The student's first name"], ['last_name', "The student's last name"], ['full_name', "The student's full name"],
  ['university', 'University name (from the sheet)'], ['course', 'Course name (from the sheet)'], ['intake', 'The intake (the name of the sheet)'],
  ['company_name', 'The name of your consultancy'], ['company_short', 'The short name of your consultancy'],
  ['stage', 'The stage the student is at'], ['counselor', "The student's counselor (the sender when none is set)"], ['sender_name', 'The person sending the message'],
  ['application_date', 'Application submitted day'], ['offer_date', 'Offer received day'], ['mock_date', 'The latest mock interview day'],
  ['payment_date', 'Payment day'], ['cas_date', 'CAS received day'], ['visa_date', 'Visa received day'],
  ['gross_fee', 'Gross fee'], ['scholarship', 'Scholarship'], ['fee_after_scholarship', 'Fee after scholarship'], ['remaining_fee', 'Remaining tuition fee'],
  ['student_id', 'Student ID'], ['today', "Today's date"],
  ['options_table', 'The university options prepared on the card (university, course, fee, scholarship and link), on a line of its own'],
  ['documents_list', 'The checklist of documents needed to apply, on a line of its own'],
];
// The short name of each word, for the note that tells the sender which details are still empty.
// A message that uses a {word} nobody fills in, or a brace that is not closed, would go to the student as it is: refuse it.
function badPlaceholder(...texts) {
  const known = new Set([...FIELDS.map(([k]) => k), 'options_table', 'documents_list', 'university_phrase', 'application_date_phrase', 'offer_date_phrase', 'mock_date_phrase']);
  for (const t of texts) {
    const s = String(t || '');
    const opens = (s.match(/\{/g) || []).length; const closes = (s.match(/\}/g) || []).length;
    if (opens !== closes) return 'A { or } is not closed. Every {word} needs both braces.';
    for (const m of s.matchAll(/\{([^{}]*)\}/g)) {
      // Exactly the word, no spaces inside the braces: "{ first_name }" would go to the student as typed.
      if (!known.has(m[1])) return `{${m[1]}} is not one of the words that can be filled in (write it with no spaces inside the braces). Use the list under the message.`;
    }
    // A list (the options table, the documents) is placed on a line of its own: anywhere else it would go out as the word in braces.
    for (const line of s.split('\n')) {
      const block = ['options_table', 'documents_list'].find((k) => line.includes('{' + k + '}'));
      if (block && line.trim() !== '{' + block + '}') return `{${block}} must be on a line of its own, with nothing else on that line.`;
    }
  }
  return '';
}
const FIELD_LABEL = Object.fromEntries(FIELDS.map(([k, label]) => [k, label.replace(/\s*\(.*\)$/, '')]));
FIELD_LABEL.options_table = 'university options added on the card';
FIELD_LABEL.documents_list = 'document checklist';
const BLOCK_FIELDS = new Set(['options_table', 'documents_list']);


const text = (v) => String(v ?? '').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '');

// "2026-11-12" or "11/12/2026" (month first, as the sheet stores imported dates) as "12 November 2026"; '' when it is no date.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(v) {
  const iso = isoDate(v);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const money = (v) => { const s = text(v); return !s ? '' : (/^[\d,.\s]+$/.test(s) ? `£${s}` : s); };

// The values of every {word} for one student. `row`: the student's row of the sheet; `card`: the student card.
function valuesFor({ row = {}, sheetName = '', card = {}, sender = '', today = new Date(), company = COMPANY, short = '' }) {
  // A name typed all in capitals (or all small) reads "Sanjip Kumar" in a message, not "SANJIP KUMAR"; the sheet keeps it as typed.
  const nameCase = (s) => (s && (s === s.toUpperCase() || s === s.toLowerCase()) ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s);
  const first = nameCase(text(row['FIRST NAME']));
  const last = nameCase(text(row['LAST NAME']));
  const mock = [4, 3, 2, 1].map((n) => longDate(row[`MOCK SCHEDULE ${n}`])).find(Boolean) || '';
  const v = {
    company_name: company, company_short: short || initialsOf(company),
    first_name: first || last, last_name: last, full_name: [first, last].filter(Boolean).join(' '),
    university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']), intake: text(sheetName),
    stage: text(row['APPLICATION STATUS']), counselor: text(card.profile && card.profile.counselor) || text(sender), sender_name: text(sender),
    application_date: longDate(row['APPLICATION SUBMISSION DATE']), offer_date: longDate(row['OFFER RECEIVED DATE']), mock_date: mock,
    payment_date: longDate(row['PAYMENT DATE']), cas_date: longDate(row['CAS RECEIVED DATE']), visa_date: longDate(row['VISA RECEIVED DATE']),
    gross_fee: money(row['GROSS FEE']), scholarship: text(row.SCHOLARSHIP), fee_after_scholarship: money(row['FEE AFTER SCHOLARSHIP']),
    remaining_fee: money(row['REMAINING TUITION FEE']), student_id: text(row['STUDENT ID']),
    today: longDate(localDate(today)),
  };
  // Small joining phrases, so a sentence still reads well when a detail is not filled in yet ("submitted on 3 May 2026" or just "submitted").
  v.application_date_phrase = v.application_date ? ` on ${v.application_date}` : '';
  v.offer_date_phrase = v.offer_date ? ` (offer dated ${v.offer_date})` : '';
  v.mock_date_phrase = v.mock_date ? ` on ${v.mock_date}` : '';
  v.cas_date_phrase = v.cas_date ? ` on ${v.cas_date}` : '';
  v.university_phrase = v.university ? ` to ${v.university}` : '';
  return v;
}

// Fills the {words} of a line. A word with nothing to show is left out and its name is added to `missing`.
function fill(line, values, missing) {
  return String(line).replace(/\{([a-z_]+)\}/g, (whole, key) => {
    if (BLOCK_FIELDS.has(key)) return whole; // handled as a block by the caller
    if (!Object.prototype.hasOwnProperty.call(values, key)) return whole; // not one of ours: left as typed
    const v = values[key];
    if (!v && FIELD_LABEL[key]) missing.add(key);
    return v || '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:])/g, '$1');
}

const optionFee = (o) => text(o.fee) || 'To be confirmed';
const optionScholarship = (o) => text(o.scholarship) || 'To be confirmed';

// The blocks ({options_table}, {documents_list}, {missing_documents}) as plain text lines.
function blockText(key, ctx) {
  if (key === 'options_table') {
    if (!ctx.options.length) return ['(no university option has been added on the card yet)'];
    return ctx.options.flatMap((o, i) => [
      `${i + 1}. ${[o.university, o.course].filter(Boolean).join(': ')}${o.intake ? ` (${o.intake})` : ''}`,
      `   Tuition fee: ${optionFee(o)}`,
      ...(o.deposit ? [`   Minimum cash deposit: ${o.deposit}`] : []),
      `   Scholarship: ${optionScholarship(o)}`,
      ...(o.link ? [`   Course page: ${o.link}`] : []),
      ...(o.note ? [`   Note: ${o.note}`] : []),
    ]);
  }
  return ctx.documents.map((d) => `- ${d}`);
}

function blockHtml(key, ctx) {
  if (key === 'options_table') {
    if (!ctx.options.length) return '<p style="margin:0 0 14px;color:#8a2b25">(no university option has been added on the card yet)</p>';
    const th = (t) => `<th align="left" style="padding:9px 10px;border-bottom:2px solid #00adef;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#3b4757">${t}</th>`;
    const td = (t, extra = '') => `<td valign="top" style="padding:10px;border-bottom:1px solid #e3e8ee;font-size:14px;line-height:1.45;${extra}">${t}</td>`;
    const small = (t) => `<br><span style="color:#5b6472;font-size:12px">${esc(t)}</span>`;
    // A column for the minimum cash deposit is added when any option carries one (asked for in the remarks of the options box).
    const withDeposit = ctx.options.some((o) => o.deposit);
    const rows = ctx.options.map((o) => {
      const cells = [
        td(`<b>${esc(o.university)}</b>${o.intake ? small(o.intake) : ''}`),
        td(`${esc(o.course)}${o.level ? small(o.level) : ''}${o.note ? small(o.note) : ''}`),
        td(esc(optionFee(o)).replace(/\n/g, '<br>')),
        ...(withDeposit ? [td(esc(o.deposit || 'Ask us').replace(/\n/g, '<br>'))] : []),
        td(esc(optionScholarship(o)).replace(/\n/g, '<br>')),
        td(o.link ? `<a href="${esc(o.link)}" style="color:#066a97">View course</a>` : '<span style="color:#5b6472">Ask us</span>', 'white-space:nowrap'),
      ];
      return `<tr>${cells.join('')}</tr>`;
    }).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 18px;border:1px solid #e3e8ee;border-radius:8px">`
      + `<tr style="background:#eef7fc">${th('University')}${th('Course')}${th('Tuition fee')}${withDeposit ? th('Minimum cash deposit') : ''}${th('Scholarship')}${th('Link')}</tr>${rows}</table>`;
  }
  return `<ul style="margin:0 0 14px;padding-left:22px">${ctx.documents.map((d) => `<li style="margin:4px 0">${esc(d)}</li>`).join('')}</ul>`;
}

// The buttons of a "[[Label | address]]" line, or null when the line is not one. Only safe addresses are taken.
const BUTTON_LINE = /^(\[\[[^\[\]]+\]\]\s*)+$/;
function buttonsOf(line) {
  if (!BUTTON_LINE.test(line)) return null;
  const out = [];
  for (const m of line.matchAll(/\[\[([^\[\]|]+)\|([^\[\]]+)\]\]/g)) {
    const label = m[1].trim(); const href = m[2].trim().replace(/\s+/g, '');
    if (label && /^(https?:\/\/|tel:\+?[0-9]|mailto:)/i.test(href)) out.push({ label, href });
  }
  return out.length ? out : null;
}
const isWhatsApp = (href) => /^https?:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href);
/* 🔴 CSS CHANGED (2026-11-17): marketing email parts (new): banner, highlighted box, big buttons | from: none, an email was plain paragraphs, small headings and bullets | to: a navy-to-blue banner with a large white title, a soft amber box with an orange left edge, and big rounded buttons (WhatsApp green #25d366, others blue #0071e3) */
/* 🔴 CSS CHANGED (2026-11-17): marketing email banner and buttons back to the first design | from: banner in the logo's blue with the consultancy's name and an orange band, Call button orange | to: the navy-to-blue banner with only the title, Call and other buttons blue #0071e3 (the owner preferred it) */
function bannerHtml(title, sub) {
  return `<tr><td style="background:#0b2e59;background-image:linear-gradient(135deg,#0b2e59 0%,#0071e3 100%);border-radius:12px 12px 0 0;padding:38px 28px 34px;text-align:center;color:#ffffff">`
    + `<div style="font-size:28px;line-height:1.25;font-weight:800;color:#ffffff">${esc(title)}</div>`
    + (sub ? `<div style="margin-top:10px;font-size:16px;line-height:1.5;color:#dbe9ff">${esc(sub)}</div>` : '')
    + '</td></tr>';
}
const calloutHtml = (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="background:#fff6e5;border-left:5px solid #fc6e1f;border-radius:8px;padding:14px 18px;font-size:16px;line-height:1.55;font-weight:600;color:#5a3300">${linkify(esc(t))}</td></tr></table>`;
function buttonsHtml(buttons) {
  const cell = (b) => `<td align="center" style="padding:6px"><a href="${esc(b.href)}" style="display:block;background:${isWhatsApp(b.href) ? '#25d366' : '#0071e3'};color:#ffffff;text-decoration:none;font-weight:700;font-size:18px;line-height:1.2;padding:18px 22px;border-radius:40px;text-align:center">${esc(b.label)}</a></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr>${buttons.map(cell).join('')}</tr></table>`;
}

// Web addresses in a paragraph become links (only http and https ones).
const linkify = (escaped) => escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:#066a97">${url}</a>`);

// The signature block as lines of text: name, title, company, then the ways to reach the office.
function signatureLines(sig) {
  const s = sig || {};
  return [
    text(s.name), text(s.title), text(s.company) || COMPANY,
    text(s.phone) ? `Phone: ${text(s.phone)}` : '', text(s.whatsapp) ? `WhatsApp: ${text(s.whatsapp)}` : '',
    text(s.email) ? `Email: ${text(s.email)}` : '', text(s.website), text(s.address),
  ].filter(Boolean);
}

// One message, ready to send: the subject, the plain text and the HTML, with the signature. `missing` lists the
// {words} that had nothing to show, by their names, so the sender can fill the gap before sending.
function renderEmail({ subject, body, values, signature, options = [], documents = [], siteUrl = '', signatureSrc = 'cid:niec-signature' }) {
  const missing = new Set();
  const ctx = { options, documents };
  const subj = fill(str(subject, LIMITS.subject), values, missing).replace(/\s+/g, ' ').trim();
  const textOut = [];
  const html = [];
  let list = null; // bullet lines being collected
  const closeList = () => { if (list) { html.push(`<ul style="margin:0 0 14px;padding-left:22px">${list.join('')}</ul>`); list = null; } };
  let banner = '';
  let first = true;
  str(body, LIMITS.body).split('\n').forEach((raw) => {
    const line = raw.trim();
    const wasFirst = first && line;
    if (line) first = false;
    const top = wasFirst ? /^#\s+(.*)$/.exec(line) : null;
    if (top) {
      const [t, ...rest] = fill(top[1], values, missing).split('|');
      const sub = rest.join('|').trim();
      textOut.push(t.trim().toUpperCase(), ...(sub ? [sub] : []), '');
      banner = bannerHtml(t.trim(), sub);
      return;
    }
    const buttons = buttonsOf(line);
    if (buttons) {
      closeList();
      const filled = buttons.map((b) => ({ label: fill(b.label, values, missing), href: b.href }));
      textOut.push(...filled.map((b) => `${b.label}: ${b.href.replace(/^(tel|mailto):/i, '')}`));
      html.push(buttonsHtml(filled));
      return;
    }
    const callout = /^!!\s+(.*)$/.exec(line);
    if (callout) {
      closeList();
      const c = fill(callout[1], values, missing);
      textOut.push(c);
      html.push(calloutHtml(c));
      return;
    }
    const block = /^\{(options_table|documents_list)\}$/.exec(line);
    if (block) {
      closeList();
      if (block[1] === 'options_table' && !ctx.options.length) missing.add('options_table');
      textOut.push(...blockText(block[1], ctx));
      html.push(blockHtml(block[1], ctx));
      return;
    }
    if (!line) { closeList(); textOut.push(''); return; }
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const h = fill(heading[1], values, missing);
      textOut.push(h.toUpperCase());
      html.push(`<p style="margin:18px 0 8px;font-weight:700;font-size:15px;color:#17324d">${esc(h)}</p>`);
      return;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const b = fill(bullet[1], values, missing);
      textOut.push(`- ${b}`);
      (list = list || []).push(`<li style="margin:4px 0">${linkify(esc(b))}</li>`);
      return;
    }
    closeList();
    const p = fill(line, values, missing);
    textOut.push(p);
    html.push(`<p style="margin:0 0 14px">${linkify(esc(p))}</p>`);
  });
  closeList();
  const sig = signatureLines(signature);
  // No automatic "Kind regards" line (the owner, 17 Nov 2026: the sender's own signature picture already ends the email, and the
  // sender writes their own closing). With a signature picture the email ends with that picture only; without one, with the
  // sender's name, team and contact lines as text.
  const message = textOut.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const plain = signatureSrc ? `${message}\n` : `${message}\n\n${sig.join('\n')}\n`;
  const logo = ''; // a student's email carries the consultancy's own signature picture, not the product logo
  const sigHtml = sig.map((l, i) => (i === 0 && text(signature && signature.name)
    ? `<div style="font-weight:700;color:#17324d;font-size:15px">${esc(l)}</div>` : `<div>${linkify(esc(l))}</div>`)).join('');
  const page = `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 12px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;border-top:4px solid #00adef">
${banner}${logo}<tr><td style="padding:${logo ? '12px' : '26px'} 28px 6px;font-size:15px;line-height:1.6">
${html.join('\n')}
${signatureSrc ? `<p style="margin:22px 0 0"><img src="${esc(signatureSrc)}" alt="${esc(text(signature && signature.name) || COMPANY)}" width="600" style="display:block;border:0;max-width:100%;height:auto"></p>` : `<div style="margin:18px 0 18px;padding:12px 0 0 14px;border-left:3px solid #fc6e1f;font-size:13px;line-height:1.55;color:#4f5b69">${sigHtml}</div>`}
</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: subj, text: plain, html: page, missing: [...missing].map((k) => FIELD_LABEL[k] || k) };
}

// The WhatsApp version: short plain text (WhatsApp shows *stars* as bold).
function renderWhatsApp({ body, values, options = [], documents = [] }) {
  const missing = new Set();
  const ctx = { options, documents };
  const out = [];
  str(body, LIMITS.whatsapp).split('\n').forEach((raw) => {
    const line = raw.trim();
    const block = /^\{(options_table|documents_list)\}$/.exec(line);
    if (block) { if (block[1] === 'options_table' && !ctx.options.length) missing.add('options_table'); out.push(...blockText(block[1], ctx)); return; }
    out.push(fill(line.replace(/^##\s+/, ''), values, missing));
  });
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), missing: [...missing].map((k) => FIELD_LABEL[k] || k) };
}

function cleanSignature(input, old = {}) {
  const pick = (k) => (input && Object.prototype.hasOwnProperty.call(input, k) ? str(input[k], LIMITS.short).trim() : (old[k] || ''));
  return {
    name: pick('name'), title: pick('title'), company: pick('company') || COMPANY, short: pick('short') || initialsOf(pick('company') || COMPANY), phone: pick('phone'), whatsapp: pick('whatsapp'),
    email: pick('email'), website: pick('website'), address: pick('address'),
  };
}

function createMessages(dir, { now = () => new Date() } = {}) {
  const file = path.join(dir, 'message-templates.json');
  let cache = null;

  function read() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return null; }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) { cache = { mtimeMs: stat.mtimeMs, size: stat.size, data }; return data; }
    } catch (e) { /* unreadable: set aside below */ }
    try { fs.renameSync(file, path.join(dir, `message-templates.damaged-${now().toISOString().replace(/[:.]/g, '-')}.json`)); } catch (e) { /* ignore */ }
    return null;
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify(data, null, 2));
    const stat = fs.statSync(file);
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
  }
  const stored = () => read() || { signature: cleanSignature({}) };

  return {
    signature: () => cleanSignature(stored().signature || {}),
    // The settings as they are kept (for the backup), and putting them back from one. Whatever else the file holds is kept.
    stored,
    restoreAll(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'The backup has no email settings in it.' };
      write({ ...data, signature: cleanSignature(data.signature || {}) });
      return { ok: true };
    },
    saveSignature(input) {
      const old = stored();
      const cleaned = cleanSignature(input, cleanSignature(old.signature || {}));
      write({ ...old, signature: cleaned });
      return { signature: cleaned };
    },
  };
}

// The checklist of documents to apply, for a student of a study level.
function documentLists(card) {
  const level = card && card.profile ? card.profile.studyLevel : '';
  return { documents: Fields.documentsFor(level).map((d) => d.text) };
}

module.exports = {
  createMessages, renderEmail, renderWhatsApp, valuesFor, documentLists, cleanSignature, badPlaceholder, longDate, FIELDS, COMPANY,
};
