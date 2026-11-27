// The NIEC portal sync, part 1 (the owner, 27 Nov 2026): every few minutes the Open list of the official NIEC portal is read, and each
// student on it who is not yet in Student Recruit 360 is added at Inquiry (first name, last name, email, phone, in the current
// intake) by the account "NIEC CTC". It only READS the portal. Nothing is written back to the portal here.
//
// How the portal is read (looked at on 27 Nov 2026): a normal sign-in form with a CSRF token; the list page then loads each tab
// (open, pending, closed, success) by POST to /agent/study-abroad-enquiry-list-data/<tab> with that token, and gets an HTML table
// back. Every row has the portal's own enquiry id, which is what ties the portal's student to ours, so nobody is added twice.
//
// Settings (environment variables on the server, never in code or chat):
//   NIEC_PORTAL_USER, NIEC_PORTAL_PASS   the portal login
//   NIEC_PORTAL_SYNC                     off (default), dry (read and log, add nobody) or on
//   NIEC_PORTAL_URL                      default https://niecportal.ed-net.uk
// State is kept in portal-sync.json in the data folder: portal id -> our student, and how the last run went.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');

const ROBOT = Object.freeze({ id: 'niec-ctc', name: 'NIEC CTC', role: 'admin', departments: [] });
const TABS = ['open', 'pending', 'closed', 'success'];
const MAX_ADD_PER_RUN = 50; // a portal that suddenly lists hundreds as Open never floods the sheet in one run

const decode = (s) => String(s == null ? '' : s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
const strip = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// "Rojina Sapkota" -> first "Rojina", last "Sapkota"; one name only -> first; more than two words -> the last word is the last name.
function splitName(full) {
  const parts = String(full || '').replace(/[^\p{L}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: titleCase(parts[0]), last: '' };
  return { first: titleCase(parts.slice(0, -1).join(' ')), last: titleCase(parts[parts.length - 1]) };
}

// The rows of one tab's HTML table. A row without an enquiry id is skipped (a header, an empty list, a changed page).
function parseList(html, tab) {
  const out = [];
  const body = String(html || '');
  const rows = body.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const tr of rows) {
    const id = /href="\/agent\/getactivities\/(\d+)"/.exec(tr);
    if (!id) continue;
    const nameSpan = /<span[^>]*class="enquiry-name"[^>]*>([\s\S]*?)<\/span>/i.exec(tr);
    const emailAttr = /<span[^>]*class="enquiry-name"[^>]*\btitle="([^"]*)"/i.exec(tr);
    const phoneSpan = /<span[^>]*class="enquiry-phone"[^>]*>([\s\S]*?)<\/span>/i.exec(tr);
    const cells = (re) => { const m = re.exec(tr); return m ? strip(m[1]) : ''; };
    const email = decode(emailAttr ? emailAttr[1] : '').trim().toLowerCase();
    const { first, last } = splitName(nameSpan ? strip(nameSpan[1]) : '');
    out.push({
      portalId: id[1],
      tab: tab || '',
      first, last,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      phone: phoneSpan ? strip(phoneSpan[1]) : '',
      date: cells(/<td class="table-date">([\s\S]*?)<\/td>/i),
      session: cells(/<td class="table-country">\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\S]*?)<\/td>/i),
      enquiryMode: (() => { const m = /<td class="table-assigned-date">\s*(In Person|Online|[A-Za-z ]{3,20})\s*<\/td>/i.exec(tr); return m ? strip(m[1]) : ''; })(),
      note: cells(/<td class="table-note">([\s\S]*?)<\/td>/i),
      status: cells(/<td class="table-status">([\s\S]*?)<\/td>/i),
    });
  }
  return out;
}

// The portal, over plain HTTPS. `fetchFn` is replaceable so the tests never touch the network.
function createPortalClient({ base = 'https://niecportal.ed-net.uk', user, pass, fetchFn = globalThis.fetch }) {
  const jar = new Map();
  const remember = (res) => {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    list.forEach((c) => { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); });
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (url, opts = {}) => {
    const res = await fetchFn(url.startsWith('http') ? url : base + url, { redirect: 'manual', ...opts, headers: { 'user-agent': 'StudentRecruit360-sync', cookie: cookie(), ...(opts.headers || {}) } });
    remember(res);
    return res;
  };
  let token = '';
  async function login() {
    jar.clear();
    const page = await (await call('/login')).text();
    const csrf = /name="_csrfToken"[^>]*value="([^"]+)"/.exec(page) || /value="([^"]+)"[^>]*name="_csrfToken"/.exec(page);
    if (!csrf) throw new Error('The portal sign-in page has changed (no security token found).');
    const res = await call('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrfToken: decode(csrf[1]), email: user, password: pass }).toString() });
    const to = res.headers.get('location') || '';
    if (!(res.status >= 300 && res.status < 400) || /login/i.test(to)) throw new Error('The portal did not accept the login. Check NIEC_PORTAL_USER and NIEC_PORTAL_PASS.');
    const list = await (await call('/agent/study-abroad-enquiry-list')).text();
    const t = /X-CSRF-Token'?"?:\s*"([^"]+)"/.exec(list);
    if (!t) throw new Error('The portal list page has changed (no token found).');
    token = t[1];
    return list;
  }
  async function listTab(tab) {
    if (!TABS.includes(tab)) throw new Error('Unknown tab.');
    const res = await call(`/agent/study-abroad-enquiry-list-data/${tab}`, { method: 'POST', headers: { 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' } });
    if (res.status !== 200) throw new Error(`The portal answered ${res.status} for the ${tab} list.`);
    return res.text();
  }
  return { login, listTab };
}

function createPortalSync({ dir, mode = 'off', importStudent, addNote, record = () => {}, client, now = () => new Date() }) {
  const file = path.join(dir, 'portal-sync.json');
  const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? { links: j.links || {}, last: j.last || null } : { links: {}, last: null }; } catch (e) { return { links: {}, last: null }; } };
  const save = (s) => writeFileAtomic(file, JSON.stringify(s));
  let running = false;

  const enabled = () => mode === 'on' || mode === 'dry';
  const sourceFor = (row) => ({ source: 'Visitor', detail: /online/i.test(row.enquiryMode) ? 'Website form' : 'Walked in' });

  // One run: sign in, read Open, add the new ones. Returns what happened; never throws (the last run is kept for Admin to see).
  async function tick() {
    if (!enabled() || running) return { skipped: true };
    running = true;
    const out = { at: now().toISOString(), mode, seen: 0, added: 0, linked: 0, already: 0, failed: 0, error: '' };
    try {
      await client.login();
      const rows = parseList(await client.listTab('open'), 'open');
      out.seen = rows.length;
      if (!rows.length) { /* an empty Open list is normal */ }
      const state = load();
      let adds = 0;
      for (const row of rows) {
        if (state.links[row.portalId]) { out.already += 1; continue; }
        if (!row.first && !row.last) { out.failed += 1; continue; }
        if (mode === 'dry') { out.added += 1; continue; }
        if (adds >= MAX_ADD_PER_RUN) break;
        const src = sourceFor(row);
        const res = importStudent(ROBOT, {
          fields: { 'FIRST NAME': row.first, 'LAST NAME': row.last, EMAIL: row.email, 'CONTACT NUMBER': row.phone, 'STUDENT SOURCE': src.source },
          profile: { sourceDetail: src.detail, sourceRemarks: `NIEC portal enquiry ${row.portalId}` },
          stage: 'Inquiry',
          note: `Added from the NIEC portal (enquiry ${row.portalId}, Open${row.date ? `, enquiry day ${row.date}` : ''}${row.session ? `, session ${row.session}` : ''}).${row.note ? ` Portal note: ${row.note}` : ''}`,
        });
        if (res.status === 200 && res.json && res.json.id) { state.links[row.portalId] = { rowId: res.json.id, at: out.at, how: 'added' }; out.added += 1; adds += 1; }
        else if (res.status === 409 && res.json && res.json.duplicate && res.json.duplicate.id && !res.json.duplicate.maybeOther && !res.json.duplicate.sameName) {
          // Already in Student Recruit 360 (same email or phone): tied to that student, and a note says so. Nobody is changed.
          state.links[row.portalId] = { rowId: res.json.duplicate.id, at: out.at, how: 'matched' };
          try { addNote(res.json.duplicate.id, { text: `This student is also on the NIEC portal Open list (enquiry ${row.portalId}).`, kind: 'note' }, ROBOT.name); } catch (e) { /* the link is kept anyway */ }
          out.linked += 1;
        } else {
          // Not added (for example a clearly different person on a shared phone, or a number that does not look right): left for a person, tried again next run.
          out.failed += 1;
          out.lastProblem = `${row.first} ${row.last}: ${(res.json && res.json.error) || res.status}`.slice(0, 200);
        }
      }
      if (mode !== 'dry') { state.last = out; save(state); }
    } catch (e) {
      out.error = String(e && e.message || e).slice(0, 300);
      try { const s = load(); s.last = out; save(s); } catch (e2) { /* nothing more to do */ }
    } finally { running = false; }
    try { record({ mode: out.mode, seen: out.seen, added: out.added, linked: out.linked, failed: out.failed, error: out.error }); } catch (e) { /* the run itself is done */ }
    return out;
  }

  return { tick, enabled, status: () => ({ mode, ...(load().last || {}) }), links: () => load().links };
}

module.exports = { createPortalSync, createPortalClient, parseList, splitName, ROBOT, TABS };
