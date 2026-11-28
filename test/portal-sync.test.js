// The NIEC portal sync: reading the portal's Open list and adding new students, with a made-up portal (no network, made-up students).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createPortalSync, createPortalClient, parseList, splitName } = require('../student-details/portal-sync');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niec-sync-'));
const row = (id, name, phone, email, mode = 'In Person', status = 'Open') => `
<tr><td>1</td><td class="table-date">2026-11-2${id % 10}</td>
<td class="table-name"><span class="enquiry-name" rel="x" title="${email}">${name} </span><br><span class="enquiry-phone" rel="x" title="${email}"><strong>${phone}</strong></span></td>
<td class="table-country"><div class="progress">20%</div></td><td class="table-country"><img title="UNITED KINGDOM"></td>
<td class="table-country">Nov, 2026</td><td class="table-assigned-date">${mode}</td>
<td class="table-assigned-date table-action"><a href="#">x</a></td><td class="table-note">UK/repe...</td>
<td class="table-status">${status}</td><td>0</td>
<td class="table-action"><a href="/agent/getactivities/${id}" class="progress_action">P</a></td></tr>`;
const table = (...rows) => `<table id="table-entry"><thead><tr><th>S.No.</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;

test('parseList reads name, phone, email, mode and the portal id', () => {
  const [a, b] = parseList(table(row(101, 'Asha Rai', '9800000001', 'ASHA@example.com'), row(102, 'MAYA', '+977 9800000002', 'bad', 'Online')), 'open');
  assert.deepStrictEqual([a.portalId, a.first, a.last, a.email, a.phone, a.enquiryMode, a.status, a.session], ['101', 'Asha', 'Rai', 'asha@example.com', '9800000001', 'In Person', 'Open', 'Nov, 2026']);
  assert.deepStrictEqual([b.first, b.last, b.email, b.enquiryMode], ['Maya', '', '', 'Online']);
  assert.deepStrictEqual(parseList('<table></table>'), []);
  assert.deepStrictEqual(parseList('<tr><td>no id</td></tr>'), []);
});

test('splitName', () => {
  assert.deepStrictEqual(splitName('rojina SAPKOTA'), { first: 'Rojina', last: 'Sapkota' });
  assert.deepStrictEqual(splitName('Ram Bahadur Thapa'), { first: 'Ram Bahadur', last: 'Thapa' });
  assert.deepStrictEqual(splitName(''), { first: '', last: '' });
});

// A made-up portal: the sign-in form, the list page with its token, and the Open tab.
function fakePortal({ openHtml, acceptLogin = true }) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url); calls.push(`${opts.method || 'GET'} ${u.pathname}`);
    const res = (status, body = '', headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null, getSetCookie: () => (headers.cookie ? [headers.cookie] : []) }, text: async () => body });
    if (u.pathname === '/login' && !opts.method) return res(200, '<input type="hidden" name="_csrfToken" value="tok1">', { cookie: 'sess=a; Path=/' });
    if (u.pathname === '/login') return acceptLogin && /password=pw/.test(opts.body) ? res(302, '', { location: '/agent/dashboard', cookie: 'sess=b; Path=/' }) : res(200, 'bad');
    if (u.pathname === '/agent/study-abroad-enquiry-list') return res(200, `<script>headers : {\n 'X-CSRF-Token': "list-token"\n}</script>`);
    if (u.pathname === '/agent/study-abroad-enquiry-list-data/open') {
      assert.strictEqual(opts.headers['X-CSRF-Token'], 'list-token'); assert.strictEqual(opts.headers['X-Requested-With'], 'XMLHttpRequest'); assert.match(opts.headers.cookie, /sess=b/);
      return res(200, openHtml);
    }
    return res(404);
  };
  return { fetchFn, calls };
}

function setup(openHtml, { importStudent, acceptLogin = true, mode = 'on' } = {}) {
  const dir = tmp(); const added = []; const notes = []; const recorded = [];
  const { fetchFn, calls } = fakePortal({ openHtml, acceptLogin });
  const sync = createPortalSync({
    dir, mode, client: createPortalClient({ base: 'https://portal.test', user: 'u@x.com', pass: 'pw', fetchFn }),
    importStudent: importStudent || ((user, body) => { added.push({ user, body }); return { status: 200, json: { ok: true, id: 'row-' + added.length } }; }),
    addNote: (id, input, by) => notes.push({ id, input, by }), record: (r) => recorded.push(r),
  });
  return { sync, added, notes, recorded, calls, dir };
}

test('a new Open student is added once, as an Inquiry, by NIEC CTC', async () => {
  const html = table(row(101, 'Asha Rai', '9800000001', 'asha@example.com'), row(102, 'Maya Gurung', '9800000002', 'maya@example.com', 'Online'));
  const t = setup(html);
  const r1 = await t.sync.tick();
  assert.strictEqual(r1.added, 2); assert.strictEqual(r1.error, '');
  assert.strictEqual(t.added[0].user.name, 'NIEC CTC');
  assert.strictEqual(t.added[0].body.stage, 'Inquiry');
  assert.deepStrictEqual(t.added[0].body.fields, { 'FIRST NAME': 'Asha', 'LAST NAME': 'Rai', EMAIL: 'asha@example.com', 'CONTACT NUMBER': '9800000001', 'STUDENT SOURCE': 'Visitor' });
  assert.strictEqual(t.added[0].body.profile.sourceDetail, 'Walked in');
  assert.strictEqual(t.added[1].body.profile.sourceDetail, 'Website form');
  assert.match(t.added[0].body.note, /enquiry 101/);
  const r2 = await t.sync.tick();
  assert.strictEqual(r2.added, 0); assert.strictEqual(r2.already, 2); assert.strictEqual(t.added.length, 2, 'the second run adds nobody');
  assert.deepStrictEqual(Object.keys(t.sync.links()).sort(), ['101', '102']);
});

test('a student already in the system is matched, not added twice, and gets a note', async () => {
  const t = setup(table(row(101, 'Asha Rai', '9800000001', 'asha@example.com')), { importStudent: () => ({ status: 409, json: { error: 'dup', duplicate: { id: 'row-old', name: 'Asha Rai' } } }) });
  const r = await t.sync.tick();
  assert.strictEqual(r.linked, 1); assert.strictEqual(r.added, 0);
  assert.strictEqual(t.sync.links()['101'].rowId, 'row-old');
  assert.strictEqual(t.notes[0].id, 'row-old');
});

test('someone who may be a different person on a shared phone is left for a person, and tried again', async () => {
  let calls = 0;
  const t = setup(table(row(101, 'Binod Rai', '9800000001', '')), { importStudent: () => { calls += 1; return { status: 409, json: { error: 'maybe', duplicate: { id: 'row-old', maybeOther: true } } }; } });
  const r = await t.sync.tick();
  assert.strictEqual(r.failed, 1); assert.deepStrictEqual(t.sync.links(), {});
  await t.sync.tick(); assert.strictEqual(calls, 2);
});

test('dry mode reads and counts but adds nobody and writes no state', async () => {
  const t = setup(table(row(101, 'Asha Rai', '9800000001', 'a@example.com')), { mode: 'dry' });
  const r = await t.sync.tick();
  assert.strictEqual(r.added, 1); assert.strictEqual(t.added.length, 0); assert.ok(!fs.existsSync(path.join(t.dir, 'portal-sync.json')));
});

test('off mode does nothing, and a refused login is reported without adding anyone', async () => {
  const off = setup(table(row(101, 'A B', '9800000001', 'a@example.com')), { mode: 'off' });
  assert.deepStrictEqual(await off.sync.tick(), { skipped: true }); assert.deepStrictEqual(off.calls, []);
  const bad = setup(table(row(101, 'A B', '9800000001', 'a@example.com')), { acceptLogin: false });
  const r = await bad.sync.tick();
  assert.match(r.error, /did not accept the login/); assert.strictEqual(bad.added.length, 0);
  assert.match(bad.sync.status().error, /did not accept/);
  assert.match(bad.recorded[0].error, /did not accept/);
});

test('never more than 50 added in one run', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(200 + i, 'Name' + String.fromCharCode(97 + (i % 26)) + ' Test', '98000000' + String(10 + i), `s${i}@example.com`));
  const t = setup(table(...rows));
  const r = await t.sync.tick();
  assert.strictEqual(t.added.length, 50); assert.strictEqual(r.added, 50);
});

// The real server, reading a made-up portal on this computer: the student appears once, at Inquiry, and one already on the sheet is matched.
test('the real server adds a new Open student once and matches one it already has', { timeout: 120000 }, async (t) => {
  const http = require('node:http'); const net = require('node:net'); const { spawn } = require('node:child_process');
  const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let listed = 0;
  const html = table(row(901, 'Sita Newcomer', '9811110001', 'sita.new@example.com'), row(902, 'Hari Existing', '9811110002', 'hari.ex@example.com'));
  const portal = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/login' && req.method === 'GET') { res.setHeader('set-cookie', 'sess=a; Path=/'); res.end('<input type="hidden" name="_csrfToken" value="t">'); return; }
      if (req.url === '/login') { if (/password=pw/.test(body)) { res.setHeader('set-cookie', 'sess=b; Path=/'); res.writeHead(302, { location: '/agent/dashboard' }); res.end(); } else res.end('bad'); return; }
      if (req.url === '/agent/study-abroad-enquiry-list') { res.end(`'X-CSRF-Token': "tok"`); return; }
      if (req.url === '/agent/study-abroad-enquiry-list-data/open') { listed += 1; res.end(html); return; }
      if (req.url === '/agent/study-abroad-enquiry-list-data/pending') { res.end(table()); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => portal.listen(0, '127.0.0.1', r)); t.after(() => portal.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-sync-e2e-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, NIEC_PORTAL_SYNC: 'on', NIEC_PORTAL_USER: 'u@x.com', NIEC_PORTAL_PASS: 'pw', NIEC_PORTAL_URL: `http://127.0.0.1:${portal.address().port}`, NIEC_PORTAL_PUSH: 'dry', NIEC_PORTAL_FIRST_MS: '3000', NIEC_PORTAL_EVERY_MS: '1500' };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let json = null; try { json = JSON.parse(await res.text()); } catch (e) { /* not JSON */ }
    return { status: res.status, json };
  };
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await call('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await call('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  // Hari is already on the sheet (added by hand) before the first sync run.
  const hari = await call('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Existing', 'CONTACT NUMBER': '9811110002', EMAIL: 'hari.ex@example.com' } });
  assert.strictEqual(hari.status, 200, JSON.stringify(hari.json));
  let found = [];
  for (let i = 0; i < 40 && !found.length; i += 1) { await wait(500); found = ((await call('GET', '/api/students/search?q=Newcomer')).json || {}).students || []; }
  assert.strictEqual(found.length, 1, 'Sita was added');
  await wait(4000); // at least two more runs
  assert.ok(listed >= 3, 'the portal was read again: ' + listed);
  assert.strictEqual((((await call('GET', '/api/students/search?q=Newcomer')).json || {}).students || []).length, 1, 'Sita is not added twice');
  assert.strictEqual((((await call('GET', '/api/students/search?q=Existing')).json || {}).students || []).length, 1, 'Hari is not added twice');
  const sita = (await call('GET', `/api/cards/${found[0].id}`)).json.card;
  assert.ok(sita.notes.some((n) => /enquiry 901/.test(n.text)), 'the note names the portal enquiry');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'portal-sync.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(saved.links).sort(), ['901', '902']);
  assert.strictEqual(saved.links['902'].how, 'matched'); assert.strictEqual(saved.links['902'].rowId, hari.json.id);
  // A note with a next follow-up date, saved on Sita's card, waits to be sent to the portal; one on Hari's (also a portal student) too; a plain note does not.
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual((await call('POST', `/api/cards/${found[0].id}/notes`, { text: 'Will bring documents.', next: day })).status, 200);
  assert.strictEqual((await call('POST', `/api/cards/${found[0].id}/notes`, { text: 'Just a plain note.' })).status, 200);
  const waiting = JSON.parse(fs.readFileSync(path.join(dir, 'portal-sync.json'), 'utf8')).outbox;
  assert.strictEqual(waiting.length, 1, JSON.stringify(waiting));
  assert.deepStrictEqual([waiting[0].portalId, waiting[0].text, waiting[0].date], ['901', 'Will bring documents.', day]);
  const log = JSON.stringify((await call('GET', '/api/activity?q=NIEC&limit=50')).json);
  assert.match(log, /NIEC CTC/);
});

// ---- push-back: Pending follow-ups (a made-up portal that also takes "Add Next Status") ----
function pushSetup({ pushMode = 'on', onOpen = [101], onPending = [], portalName = 'Asha Rai', confirm = true, showNote = true, goPending = true, ourName = 'Asha Rai', mode = 'off' } = {}) {
  const dir = tmp(); const posts = []; const notes = []; const recorded = []; const order = [];
  let last = '';
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    const res = (status, body = '', headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null, getSetCookie: () => (headers.cookie ? [headers.cookie] : []) }, text: async () => body });
    if (u.pathname === '/login' && !opts.method) return res(200, '<input type="hidden" name="_csrfToken" value="t">');
    if (u.pathname === '/login') return res(302, '', { location: '/agent/dashboard', cookie: 'sess=b; Path=/' });
    if (u.pathname === '/agent/study-abroad-enquiry-list') return res(200, `'X-CSRF-Token': "tok"`);
    if (u.pathname === '/agent/study-abroad-enquiry-list-data/open') return res(200, table(...onOpen.map((i) => row(i, 'Asha Rai', '9800000001', 'a@example.com'))));
    if (u.pathname === '/agent/study-abroad-enquiry-list-data/pending') return res(200, table(...[...onPending, ...(posts.length && goPending ? [posts[0].id] : [])].map((i) => row(i, 'Asha Rai', '9800000001', 'a@example.com', 'In Person', 'Pending'))));
    const m = /^\/agent\/getactivities\/(\d+)$/.exec(u.pathname);
    if (m) { assert.strictEqual(opts.headers['X-Requested-With'], 'XMLHttpRequest'); last = m[1]; order.push('open ' + m[1]); return res(200, `<table><tr><td><span>Student Name</span></td><td><span>${portalName}</span></td></tr></table>${posts.length && showNote ? '<td>' + posts[posts.length - 1].note + '</td>' : ''}`); }
    if (u.pathname === '/agent/activities/add') {
      assert.strictEqual(opts.headers['X-CSRF-Token'], 'tok'); assert.match(opts.headers.cookie, /sess=b/);
      const f = Object.fromEntries(new URLSearchParams(opts.body)); order.push('post ' + last);
      posts.push({ id: last, ...f }); return res(200, JSON.stringify({ success: confirm }));
    }
    return res(404);
  };
  const sync = createPortalSync({ dir, mode, pushMode, client: createPortalClient({ base: 'https://portal.test', user: 'u@x.com', pass: 'pw', fetchFn }),
    importStudent: () => ({ status: 200, json: { id: 'row-x' } }), addNote: (id, input) => notes.push({ id, input }), nameOf: () => ourName, record: (r) => recorded.push(r) });
  // The student came from the portal earlier (enquiry 101 is "row-1").
  fs.writeFileSync(path.join(dir, 'portal-sync.json'), JSON.stringify({ links: { 101: { rowId: 'row-1', how: 'added' } } }));
  return { sync, posts, notes, recorded, order, dir };
}

test('push: a follow-up is entered as Pending, by phone, with the note and the next day, and checked afterwards', async () => {
  const t = pushSetup();
  assert.strictEqual(t.sync.queueFollowUp({ rowId: 'row-1', text: 'Will send documents on Sunday.', date: '2026-11-30' }), true);
  const r = await t.sync.tick();
  assert.strictEqual(r.sent, 1, JSON.stringify(r));
  assert.deepStrictEqual(t.posts[0], { id: '101', form_mode: 'add', enquiry_activity_id: '', status: '4', note: 'Will send documents on Sunday.', 'EnquiryPendingActivity[datetime]': '2026-11-30T10:00:00', 'EnquiryPendingActivity[note]': 'Will send documents on Sunday.', 'EnquiryPendingActivity[followup_mode]': '1' });
  assert.deepStrictEqual(t.order.slice(0, 3), ['open 101', 'post 101', 'open 101'], 'the screen is opened before and checked after');
  assert.match(t.notes[0].input.text, /sent to the NIEC portal/);
  await t.sync.tick(); assert.strictEqual(t.posts.length, 1, 'never sent twice');
});

test('push: a student who is not from the portal, or a bad date, is not queued', () => {
  const t = pushSetup();
  assert.strictEqual(t.sync.queueFollowUp({ rowId: 'row-other', text: 'x', date: '2026-11-30' }), false);
  assert.strictEqual(t.sync.queueFollowUp({ rowId: 'row-1', text: 'x', date: 'soon' }), false);
  assert.strictEqual(t.sync.queueFollowUp({ rowId: 'row-1', text: '', date: '2026-11-30' }), false);
  const off = pushSetup({ pushMode: 'off' });
  assert.strictEqual(off.sync.queueFollowUp({ rowId: 'row-1', text: 'x', date: '2026-11-30' }), false);
});

test('push: a different name on the portal sends nothing and stops every push', async () => {
  const t = pushSetup({ portalName: 'Someone Else' });
  t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note one', date: '2026-11-30' });
  const r = await t.sync.tick();
  assert.strictEqual(t.posts.length, 0); assert.match(r.pushHalted, /does not match/);
  t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note two', date: '2026-12-01' });
  await t.sync.tick(); assert.strictEqual(t.posts.length, 0, 'stays stopped');
  assert.match(t.recorded[0].pushHalted, /does not match/);
  t.sync.resume(); // after a person has looked
});

test('push: a student no longer on the Open or Pending list is skipped', async () => {
  const t = pushSetup({ onOpen: [] });
  t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  const r = await t.sync.tick();
  assert.strictEqual(t.posts.length, 0); assert.strictEqual(r.skipped, 1);
});

test('push: the portal does not confirm, or the check afterwards fails: stopped, and not sent again', async () => {
  const a = pushSetup({ confirm: false });
  a.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  assert.match((await a.sync.tick()).pushHalted, /did not confirm/);
  await a.sync.tick(); assert.strictEqual(a.posts.length, 1);
  const b = pushSetup({ goPending: false });
  b.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  assert.match((await b.sync.tick()).pushHalted, /could not check/);
  await b.sync.tick(); assert.strictEqual(b.posts.length, 1);
});

test('push: dry mode sends nothing and says what would be sent', async () => {
  const t = pushSetup({ pushMode: 'dry' });
  t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  const r = await t.sync.tick();
  assert.strictEqual(r.would, 1); assert.strictEqual(t.posts.length, 0);
});
