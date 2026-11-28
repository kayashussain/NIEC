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
//   NIEC_PORTAL_CLOSE                    off (default), dry or on: closing a student on the portal when the student withdraws here (needs PUSH on)
//   NIEC_PORTAL_PUSH                     off (default), dry (log what would be sent) or on: the push-back of follow-ups (see below)
//
// Push-back, part 2 (the owner, 28 Nov 2026): when a note with a next follow-up date is saved for a student who came from the portal, the same
// follow-up is entered on the portal as "Add Next Status": status Pending, the note, the next follow-up day (with the time of day it was saved) and mode Phone, exactly
// as it is done by hand. Only Pending for now (Closed and Success are not sent). Safety: the portal's progress screen is opened first and
// the student's name there must be the same as ours; the student must be Open or Pending on the portal; afterwards the progress screen is read
// again: one more row, newest, Pending, with our day, time and the whole note. Anything unexpected stops every push (pushHalted) and is written in Activity; nothing is
// ever sent twice.
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
function createPortalClient({ base = 'https://niecportal.ed-net.uk', user, pass, fetchFn = globalThis.fetch, retryWaitMs = 1500 }) {
  const jar = new Map();
  const remember = (res) => {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    list.forEach((c) => { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); });
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  // The portal is slow and sometimes drops the first connection: a read is tried up to 3 times. A write (`once`) is never repeated.
  const call = async (url, { once = false, ...opts } = {}) => {
    let lastErr;
    for (let i = 0; i < (once ? 1 : 3); i += 1) {
      try {
        const res = await fetchFn(url.startsWith('http') ? url : base + url, { redirect: 'manual', ...opts, headers: { 'user-agent': 'StudentRecruit360-sync', cookie: cookie(), ...(opts.headers || {}) } });
        remember(res);
        return res;
      } catch (e) { lastErr = e; if (i < 2 && !once) await new Promise((r) => setTimeout(r, retryWaitMs)); }
    }
    throw lastErr;
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
  // One tab, every page (the portal shows 20 at a time: "?page=2" after the address, with the same request).
  async function listTab(tab) {
    if (!TABS.includes(tab)) throw new Error('Unknown tab.');
    const get = async (n) => {
      const res = await call(`/agent/study-abroad-enquiry-list-data/${tab}${n > 1 ? `?page=${n}` : ''}`, { method: 'POST', headers: { 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' } });
      if (res.status !== 200) throw new Error(`The portal answered ${res.status} for the ${tab} list.`);
      return res.text();
    };
    // The page links show only a window of page numbers, so the "next" arrow is followed until there is none.
    let all = ''; let n = 1; let html = await get(1);
    for (;;) {
      all += html;
      if (!/rel="next"/.test(html) || n >= 60) break;
      n += 1; html = await get(n);
    }
    return all;
  }
  // The student's progress screen, opened the way the portal's own page opens it (the portal ties the next status to this student).
  async function activities(portalId) {
    if (!/^\d{1,12}$/.test(String(portalId))) throw new Error('Bad portal id.');
    const res = await call(`/agent/getactivities/${portalId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (res.status !== 200) throw new Error(`The portal answered ${res.status} for the progress screen.`);
    return res.text();
  }
  // "Add Next Status", Pending: the same request the portal's own page sends (checked on 28 Nov 2026 by filling the form and stopping
  // the send): POST /agent/activities/add/<enquiry id>, with the time as the browser writes it (2026-12-01T10:00).
  async function addPending({ portalId, note, datetime, mode = '1' }) {
    if (!/^\d{1,12}$/.test(String(portalId))) throw new Error('Bad portal id.');
    const body = new URLSearchParams({ form_mode: 'add', enquiry_activity_id: '', status: '4', note, 'EnquiryPendingActivity[datetime]': datetime, 'EnquiryPendingActivity[note]': note, 'EnquiryPendingActivity[followup_mode]': mode }).toString();
    const res = await call(`/agent/activities/add/${portalId}`, { once: true, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' }, body });
    let json = null; try { json = JSON.parse(await res.text()); } catch (e) { /* not JSON */ }
    return { status: res.status, success: Boolean(json && json.success) };
  }
  // Closed (the student withdraws): the same request with status 2 and a note; the follow-up fields stay empty, as the portal's page leaves
  // them when Closed is chosen (checked on 28 Nov 2026 by filling the form and stopping the send).
  async function addClosed({ portalId, note }) {
    if (!/^\d{1,12}$/.test(String(portalId))) throw new Error('Bad portal id.');
    const body = new URLSearchParams({ form_mode: 'add', enquiry_activity_id: '', status: '2', note, 'EnquiryPendingActivity[datetime]': '', 'EnquiryPendingActivity[note]': '', 'EnquiryPendingActivity[followup_mode]': '' }).toString();
    const res = await call(`/agent/activities/add/${portalId}`, { once: true, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' }, body });
    let json = null; try { json = JSON.parse(await res.text()); } catch (e) { /* not JSON */ }
    return { status: res.status, success: Boolean(json && json.success) };
  }
  return { login, listTab, activities, addPending, addClosed };
}

// The "Enquiry Process" table of a progress screen, newest row first: status, follow-up day and time, the whole note (kept in the title).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseProgress(html) {
  const tbl = (String(html || '').match(/Enquiry Process[\s\S]*?<\/table>/) || [''])[0];
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(tbl);
  const rows = body ? body[1].match(/<tr[\s\S]*?<\/tr>/g) || [] : [];
  return rows.map((tr) => {
    const tds = tr.match(/<td[\s\S]*?<\/td>/g) || [];
    const when = /([0-9]{1,2}),\s*([A-Za-z]{3}),\s*([0-9]{4})\s*\|?\s*([0-9]{1,2}:[0-9]{2})?/.exec(strip(tds[2] || ''));
    const title = /<span[^>]*\btitle="([^"]*)"/.exec(tds[3] || '');
    return { status: strip(tds[1] || ''), day: when ? `${Number(when[1])} ${when[2]} ${when[3]}` : '', time: when && when[4] ? when[4].padStart(5, '0') : '', note: title ? decode(title[1]).replace(/\s+/g, ' ').trim() : '', by: strip(tds[4] || '') };
  }).filter((r) => r.status);
}
const dayWords = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };
const letters = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// The name on a progress screen ("Student Name" row).
function studentNameOn(html) { const m = /Student Name<\/span>\s*<\/td>\s*<td[^>]*>\s*<span>([\s\S]*?)<\/span>/i.exec(String(html || '')); return m ? strip(m[1]) : ''; }

function createPortalSync({ dir, mode = 'off', pushMode = 'off', closeMode = 'off', importStudent, findStudent = () => null, addNote, nameOf = () => '', record = () => {}, client, now = () => new Date() }) {
  const file = path.join(dir, 'portal-sync.json');
  const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? { links: j.links || {}, last: j.last || null, outbox: Array.isArray(j.outbox) ? j.outbox : [], pushHalted: j.pushHalted || '' } : { links: {}, last: null, outbox: [], pushHalted: '' }; } catch (e) { return { links: {}, last: null, outbox: [], pushHalted: '' }; } };
  const save = (s) => writeFileAtomic(file, JSON.stringify(s));
  let running = false;
  let lastLine = '';

  const enabled = () => ['on', 'dry'].some((m) => [mode, pushMode, closeMode].includes(m));
  const pullOn = () => mode === 'on' || mode === 'dry';
  const sourceFor = (row) => ({ source: 'Visitor', detail: /online/i.test(row.enquiryMode) ? 'Website form' : 'Walked in' });


  // A follow-up saved here for a student who came from the portal waits in the outbox (kept on disk) until the next run sends it.
  function queueFollowUp({ rowId, text, date }) {
    if (pushMode === 'off') return false;
    const day = String(date || '');
    const words = String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, 1500);
    if (!rowId || !words || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const state = load();
    const portalId = Object.keys(state.links).find((id) => state.links[id].rowId === rowId);
    if (!portalId) return false; // not a portal student
    const kathmandu = new Date(now().getTime() + (5 * 60 + 45) * 60000); // office time
    const time = `${String(kathmandu.getUTCHours()).padStart(2, '0')}:${String(kathmandu.getUTCMinutes()).padStart(2, '0')}`;
    state.outbox.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, rowId, portalId, text: words, date: day, time, at: now().toISOString() });
    state.outbox = state.outbox.slice(-200);
    save(state);
    return true;
  }

  // A student who withdraws here (Follow-up list, Withdrawn, with the reason and what was said) is closed on the portal, from Open or Pending.
  // Off unless NIEC_PORTAL_CLOSE is dry or on. The wording is the person's own remarks and the reason, nothing else.
  function queueClose({ rowId, text, reason }) {
    if (closeMode === 'off' || pushMode === 'off') return false;
    const words = [String(reason || '').trim() && `Withdrawn: ${String(reason).trim()}.`, String(text || '').replace(/\s+\n/g, '\n').trim()].filter(Boolean).join(' ').slice(0, 1500);
    if (!rowId || !words) return false;
    const state = load();
    const portalId = Object.keys(state.links).find((id) => state.links[id].rowId === rowId);
    if (!portalId) return false;
    state.outbox.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'close', rowId, portalId, text: words, at: now().toISOString() });
    state.outbox = state.outbox.slice(-200);
    save(state);
    return true;
  }

  // Sends what waits, one at a time, with the checks described at the top. Returns { sent, skipped, would }.
  async function pushRun(out) {
    const state = load();
    const res = { sent: 0, skipped: 0, would: 0 };
    const todo = state.outbox.filter((x) => !x.sent && !x.skipped);
    if (!todo.length || pushMode === 'off') return res;
    if (state.pushHalted) { out.pushHalted = state.pushHalted; return res; }
    let batch = 0;
    for (const item of todo) {
      if (batch >= 10) break;
      batch += 1;
      const halt = (why) => { state.pushHalted = `${why} (student ${item.portalId})`.slice(0, 300); out.pushHalted = state.pushHalted; };
      const before = await client.activities(item.portalId);
      const rowsBefore = parseProgress(before);
      // Only a student who is Open or Pending on the portal right now (the newest row of the progress screen); never Closed or Success.
      if (!rowsBefore.length || !['Open', 'Pending'].includes(rowsBefore[0].status)) { item.skipped = `the portal shows the student as ${(rowsBefore[0] && rowsBefore[0].status) || 'unknown'}`; res.skipped += 1; continue; }
      const closing = item.kind === 'close';
      if ((closing ? closeMode : pushMode) !== 'on' || pushMode !== 'on') { if (!item.dry) { item.dry = true; res.would += 1; } continue; }
      const mine = nameOf(item.rowId);
      const theirs = studentNameOn(before);
      if (!letters(mine) || letters(mine) !== letters(theirs)) { halt('The name on the portal does not match the student here, nothing was sent'); break; }
      const time = /^\d{2}:\d{2}$/.test(item.time || '') ? item.time : '10:00';
      const sent = closing ? await client.addClosed({ portalId: item.portalId, note: item.text }) : await client.addPending({ portalId: item.portalId, note: item.text, datetime: `${item.date}T${time}`, mode: '1' });
      item.sent = true; item.sentAt = now().toISOString(); // marked at once: a run that stops now never sends it again
      if (!(sent.status === 200 && sent.success)) { halt(`The portal did not confirm the ${closing ? 'closing' : 'follow-up'} (answer ${sent.status})`); save(state); break; }
      // Read it back: one more row, newest, with our status and the whole note (and, for Pending, our day and time).
      const rowsAfter = parseProgress(await client.activities(item.portalId));
      const top = rowsAfter[0] || {};
      const flat = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const ok = rowsAfter.length === rowsBefore.length + 1 && top.status === (closing ? 'Closed' : 'Pending') && flat(top.note) === flat(item.text) && (closing || (top.day === dayWords(item.date) && top.time === time));
      if (!ok) { halt(`Sent, but the portal does not show it as expected (${top.status || 'no row'} ${top.day || ''} ${top.time || ''})`); save(state); break; }
      item.verified = true; res.sent += 1;
      try { addNote(item.rowId, { text: closing ? 'Closed on the NIEC portal (the student withdrew).' : `Follow-up sent to the NIEC portal: Pending, next follow-up ${item.date} ${time}, by phone.`, kind: 'note' }, ROBOT.name); } catch (e) { /* the portal has it */ }
    }
    state.outbox = state.outbox.filter((x) => !(x.verified || x.skipped) || Date.parse(x.at) > Date.now() - 14 * 86400000).slice(-200);
    save(state);
    return res;
  }

  // One run: sign in, read Open, add the new ones. Returns what happened; never throws (the last run is kept for Admin to see).
  async function tick() {
    if (!enabled() || running) return { skipped: true };
    running = true;
    const out = { at: now().toISOString(), mode, push: pushMode, sent: 0, skipped: 0, seen: 0, added: 0, linked: 0, already: 0, failed: 0, error: '' };
    try {
      await client.login();
      if (!pullOn()) { const r = await pushRun(out); out.sent = r.sent; out.skipped = r.skipped; out.would = r.would; return finishRun(out); }
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
      if (mode !== 'dry') {
        // Students already on the portal's Pending list who are already here are tied to their cards too (never added from Pending), so
        // a follow-up saved for them reaches the portal. A lookalike on a shared phone is not tied.
        try {
          for (const row of parseList(await client.listTab('pending'), 'pending')) {
            if (state.links[row.portalId]) continue;
            const found = findStudent(row.email, row.phone, `${row.first} ${row.last}`);
            if (found && found.id) { state.links[row.portalId] = { rowId: found.id, at: out.at, how: 'matched-pending' }; out.linked += 1; }
          }
        } catch (e) { out.error = String(e && e.message || e).slice(0, 300); }
        const keep = load(); keep.links = state.links; keep.last = out; save(keep);
      }
      const r = await pushRun(out); out.sent = r.sent; out.skipped = r.skipped; out.would = r.would;
      if (mode !== 'dry' || pushMode !== 'off') { const keep = load(); keep.last = out; save(keep); }
    } catch (e) {
      out.error = String(e && e.message || e).slice(0, 300);
      try { const s = load(); s.last = out; save(s); } catch (e2) { /* nothing more to do */ }
    } finally { running = false; }
    return finishRun(out);
  }
  function finishRun(out) {
    running = false;
    // Activity hears about a run only when something happened, or the same thing is not simply repeating.
    const line = JSON.stringify([out.added, out.linked, out.failed, out.sent, out.would, out.error, out.pushHalted || '']);
    const quiet = !out.added && !out.linked && !out.failed && !out.sent && !out.would && !out.error && !out.pushHalted;
    if (!quiet && line !== lastLine) { try { record(out); } catch (e) { /* the run itself is done */ } }
    lastLine = quiet ? '' : line;
    return out;
  }

  return { tick, enabled, queueFollowUp, queueClose, outbox: () => load().outbox, resume: () => { const s2 = load(); s2.pushHalted = ''; save(s2); }, status: () => ({ mode, ...(load().last || {}) }), links: () => load().links };
}

module.exports = { createPortalSync, createPortalClient, parseList, parseProgress, splitName, studentNameOn, ROBOT, TABS };
