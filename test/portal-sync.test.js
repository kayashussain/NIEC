// The NIEC portal sync: reading the portal's Open list and adding new students, with a made-up portal (no network, made-up students).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createPortalSync, createPortalClient, parseList, parseProgress, studentNameOn, splitName } = require('../student-details/portal-sync');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niec-sync-'));
const row = (id, name, phone, email, mode = 'In Person', status = 'Open') => `
<tr><td>1</td><td class="table-date">2026-11-2${id % 10}</td>
<td class="table-name"><span class="enquiry-name" rel="x" title="${email}">${name} </span><br><span class="enquiry-phone" rel="x" title="${email}"><strong>${phone}</strong></span></td>
<td class="table-country"><div class="progress">20%</div></td><td class="table-country"><img title="UNITED KINGDOM"></td>
<td class="table-country">Nov, 2026</td><td class="table-assigned-date">${mode}</td>
<td class="table-assigned-date table-action"><a href="#">x</a></td><td class="table-note">UK/repe...</td>
<td class="table-status">${status}</td><td>0</td>
<td class="table-action"><a href="/agent/getactivities/${id}" class="progress_action">P</a></td></tr>`;
// A progress screen as the portal writes it (the table copied from a real one, names and notes made up). Newest row first.
const progress = (name, rows) => `<table><tr><td width="200px"><span>Student Name</span></td>
<td><span>${name}</span></td></tr></table><p>Enquiry Process</p>
<table id="table-entry"><thead><tr><th>S. No.</th><th>Status</th><th>Follow Up</th><th>Note</th><th>Created By</th><th>Actions</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td><span>${rows.length - i}</span></td><td><span>${r.status}</span></td>
<td> <span> ${r.day || '27, Nov, 2026'} | ${r.time || '11:09'} | <i class="fa fa-sticky-note"></i> </span> </td>
<td> <span title="${(r.note || '').replace(/"/g, '&quot;')}">${(r.note || '').slice(0, 17)}${(r.note || '').length > 17 ? '...' : ''}</span> </td>
<td> <span>${r.by || 'frontdesk'}</span> </td><td> </td></tr>`).join('')}</tbody></table>`;
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
      if (req.url.startsWith('/agent/study-abroad-enquiry-list-data/pending')) { res.end(table()); return; }
      if (/^\/agent\/getactivities\/(901|902)$/.test(req.url)) { res.end(progress(req.url.endsWith('901') ? 'Sita Newcomer' : 'Hari Existing', [{ status: 'Open' }])); return; }
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
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pushSetup({ pushMode = 'on', startStatus = 'Open', portalName = 'Asha Rai', confirm = true, showAs = 'Pending', dropNote = false, ourName = 'Asha Rai', mode = 'off', clock = '2026-11-28T04:39:00Z' } = {}) {
  const dir = tmp(); const posts = []; const notes = []; const recorded = []; const order = [];
  const rows = [{ status: startStatus }];
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    const res = (status, body = '', headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null, getSetCookie: () => (headers.cookie ? [headers.cookie] : []) }, text: async () => body });
    if (u.pathname === '/login' && !opts.method) return res(200, '<input type="hidden" name="_csrfToken" value="t">');
    if (u.pathname === '/login') return res(302, '', { location: '/agent/dashboard', cookie: 'sess=b; Path=/' });
    if (u.pathname === '/agent/study-abroad-enquiry-list') return res(200, `'X-CSRF-Token': "tok"`);
    if (u.pathname.startsWith('/agent/study-abroad-enquiry-list-data/')) return res(200, table());
    const m = /^\/agent\/getactivities\/(\d+)$/.exec(u.pathname);
    if (m) { assert.strictEqual(opts.headers['X-Requested-With'], 'XMLHttpRequest'); order.push('open ' + m[1]); return res(200, progress(portalName, [...rows].reverse())); }
    const add = /^\/agent\/activities\/add\/(\d+)$/.exec(u.pathname);
    if (add) {
      assert.strictEqual(opts.method, 'POST'); assert.strictEqual(opts.headers['X-Requested-With'], 'XMLHttpRequest'); assert.match(opts.headers.cookie, /sess=b/);
      const f = Object.fromEntries(new URLSearchParams(opts.body)); order.push('post ' + add[1]);
      posts.push({ id: add[1], ...f });
      const [, y, mo, d, hm] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(f['EnquiryPendingActivity[datetime]']);
      if (confirm && !dropNote) rows.push({ status: showAs, day: `${Number(d)}, ${MON[Number(mo) - 1]}, ${y}`, time: hm, note: f.note, by: 'kayas' });
      return res(200, JSON.stringify({ success: confirm }));
    }
    return res(404);
  };
  const sync = createPortalSync({ dir, mode, pushMode, now: () => new Date(clock), client: createPortalClient({ base: 'https://portal.test', user: 'u@x.com', pass: 'pw', fetchFn, retryWaitMs: 1 }),
    importStudent: () => ({ status: 200, json: { id: 'row-x' } }), addNote: (id, input) => notes.push({ id, input }), nameOf: () => ourName, record: (r) => recorded.push(r) });
  // The student came from the portal earlier (enquiry 101 is "row-1").
  fs.writeFileSync(path.join(dir, 'portal-sync.json'), JSON.stringify({ links: { 101: { rowId: 'row-1', how: 'added' } } }));
  return { sync, posts, notes, recorded, order, dir };
}

test('parseProgress reads the real table: newest first, status, day, time and the whole note', () => {
  const rows = parseProgress(progress('Maya Test', [{ status: 'Pending', day: '27, Nov, 2026', time: '9:05', note: 'Will apply for March April Intake only. Will attend our class.', by: 'sapana' }, { status: 'Open' }]));
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], { status: 'Pending', day: '27 Nov 2026', time: '09:05', note: 'Will apply for March April Intake only. Will attend our class.', by: 'sapana' });
  assert.strictEqual(rows[1].status, 'Open'); assert.strictEqual(rows[1].note, '');
  assert.deepStrictEqual(parseProgress('<p>nothing</p>'), []);
  assert.strictEqual(studentNameOn(progress('Maya Test', [])), 'Maya Test');
});

test('lists are read page after page (the portal shows 20 at a time)', async () => {
  const seen = [];
  // The links show only a window of page numbers (here just 2), so it is the "next" arrow that says there is more.
  const nxt = (n) => `<a href="/agent/study-abroad-enquiry-list-data/pending?page=${n}">${n}</a><a rel="next" href="/agent/study-abroad-enquiry-list-data/pending?page=${n}">&raquo;</a>`;
  const pagesHtml = { 1: table(row(1, 'A One', '9800000001', 'a1@example.com')) + nxt(2), 2: table(row(2, 'A Two', '9800000002', 'a2@example.com')) + nxt(3), 3: table(row(3, 'A Three', '9800000003', 'a3@example.com')) };
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url); const res = (status, body = '', headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null, getSetCookie: () => [] }, text: async () => body });
    if (u.pathname === '/login' && !opts.method) return res(200, '<input name="_csrfToken" value="t">');
    if (u.pathname === '/login') return res(302, '', { location: '/x' });
    if (u.pathname === '/agent/study-abroad-enquiry-list') return res(200, `'X-CSRF-Token': "tok"`);
    const page = Number(u.searchParams.get('page') || 1); seen.push(page); return res(200, pagesHtml[page]);
  };
  const c = createPortalClient({ base: 'https://p.test', user: 'u', pass: 'p', fetchFn });
  await c.login();
  assert.deepStrictEqual(parseList(await c.listTab('pending'), 'pending').map((r) => r.portalId), ['1', '2', '3']);
  assert.deepStrictEqual(seen, [1, 2, 3]);
});

test('a read that fails the first time is tried again, a write never is', async () => {
  let n = 0; let writes = 0;
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url); const res = (status, body = '') => ({ status, headers: { get: () => null, getSetCookie: () => [] }, text: async () => body });
    if (u.pathname === '/login' && !opts.method) { n += 1; if (n < 3) throw new Error('fetch failed'); return res(200, '<input name="_csrfToken" value="t">'); }
    if (u.pathname === '/login') return res(302, '', { location: '/x' });
    if (u.pathname === '/agent/study-abroad-enquiry-list') return res(200, `'X-CSRF-Token': "tok"`);
    if (u.pathname.startsWith('/agent/activities/add/')) { writes += 1; throw new Error('dropped'); }
    return res(404);
  };
  const c = createPortalClient({ base: 'https://p.test', user: 'u', pass: 'p', fetchFn, retryWaitMs: 1 });
  await c.login(); assert.strictEqual(n, 3);
  await assert.rejects(c.addPending({ portalId: '5', note: 'x', datetime: '2026-12-01T10:00' }), /dropped/);
  assert.strictEqual(writes, 1, 'the write was tried once');
});

test('push: Pending, by phone, to the student\'s own address, with the note, the day and the office time, then read back', async () => {
  const t = pushSetup(); // 04:39 UTC is 10:24 in Kathmandu
  assert.strictEqual(t.sync.queueFollowUp({ rowId: 'row-1', text: 'Will send documents on Sunday.', date: '2026-11-30' }), true);
  const r = await t.sync.tick();
  assert.strictEqual(r.sent, 1, JSON.stringify(r));
  assert.deepStrictEqual(t.posts[0], { id: '101', form_mode: 'add', enquiry_activity_id: '', status: '4', note: 'Will send documents on Sunday.', 'EnquiryPendingActivity[datetime]': '2026-11-30T10:24', 'EnquiryPendingActivity[note]': 'Will send documents on Sunday.', 'EnquiryPendingActivity[followup_mode]': '1' });
  assert.deepStrictEqual(t.order.slice(0, 3), ['open 101', 'post 101', 'open 101'], 'the screen is opened before and read back after');
  assert.match(t.notes[0].input.text, /sent to the NIEC portal.*2026-11-30 10:24/);
  await t.sync.tick(); assert.strictEqual(t.posts.length, 1, 'never sent twice');
});

test('push: a student already Pending can have another follow-up; a Closed or Success one gets nothing', async () => {
  const p = pushSetup({ startStatus: 'Pending' });
  p.sync.queueFollowUp({ rowId: 'row-1', text: 'Second call.', date: '2026-12-02' });
  assert.strictEqual((await p.sync.tick()).sent, 1);
  for (const status of ['Closed', 'Success']) {
    const t = pushSetup({ startStatus: status });
    t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
    const r = await t.sync.tick();
    assert.strictEqual(t.posts.length, 0); assert.strictEqual(r.skipped, 1); assert.ok(!r.pushHalted);
  }
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
  await t.sync.tick(); assert.strictEqual(t.posts.length, 0, 'the name still does not match');
});

test('push: the portal does not confirm, or the read-back is not what was sent: stopped, and not sent again', async () => {
  const a = pushSetup({ confirm: false });
  a.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  assert.match((await a.sync.tick()).pushHalted, /did not confirm/);
  await a.sync.tick(); assert.strictEqual(a.posts.length, 1);
  const b = pushSetup({ dropNote: true });
  b.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  assert.match((await b.sync.tick()).pushHalted, /does not show it as expected/);
  await b.sync.tick(); assert.strictEqual(b.posts.length, 1);
  const c = pushSetup({ showAs: 'Closed' });
  c.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  assert.match((await c.sync.tick()).pushHalted, /does not show it as expected/);
});

test('push: dry mode sends nothing and says what would be sent, once', async () => {
  const t = pushSetup({ pushMode: 'dry' });
  t.sync.queueFollowUp({ rowId: 'row-1', text: 'Note', date: '2026-11-30' });
  const r = await t.sync.tick();
  assert.strictEqual(r.would, 1); assert.strictEqual(t.posts.length, 0);
  assert.strictEqual((await t.sync.tick()).would, 0, 'the same one is not announced every run');
});

test('Activity hears about a run only when something happened', async () => {
  const t = pushSetup({ pushMode: 'dry', mode: 'on' });
  await t.sync.tick(); await t.sync.tick();
  assert.strictEqual(t.recorded.length, 0, 'two quiet runs write nothing');
});
