// The deep review of 22 Nov 2026 (the owner asked for many reviewers): each problem it found, and that it stays fixed. All students
// here are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { localDate } = require('../shared/server-utils');
const Fields = require('../student-details/card-fields');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a damaged date never stops a page; a direct partner is counted as its university', () => {
  assert.strictEqual(localDate(new Date('not a day')), '');
  assert.strictEqual(localDate(new Date('2026-11-22T10:00:00Z')), '2026-11-22');
  assert.strictEqual(Fields.plainPartner('Direct (Ulster University)'), 'Ulster University');
  assert.strictEqual(Fields.plainPartner('QA'), 'QA');
});

test('review fixes on the real server', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-review-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json, location: res.headers.get('location') };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = (await admin('POST', '/api/users', { username: 'asha', name: 'Asha', email: '', departments: ['application'] })).json;
  const app = person();
  await app('POST', '/api/login', { username: 'asha', password: made.temporaryPassword }); await app('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
  const rowOf = async (rid) => (await admin('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows).find((r) => r._id === rid);

  // A page closed to the Application Team stays closed by its file's own address too, and so do the bulk messages.
  for (const page of ['/bulk.html', '/my-dashboard.html', '/direct.html', '/b2b.html', '/agents.html', '/apply-through.html', '/dashboard.html']) {
    assert.strictEqual((await app('GET', page)).status, 302, page);
  }
  assert.strictEqual((await app('GET', '/api/bulk/students')).status, 403);

  // Two courses of one university that differ only in brackets are two courses: the partner follows the one chosen.
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Mira', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000091', 'STUDENT SOURCE': 'Visitor', 'UNIVERSITY NAME': 'Old University', 'COURSE NAME': 'BA Old' } })).json.id;
  {
    const w = (await admin('GET', '/api/data')).json;
    w.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) Object.assign(r, { 'UNIVERSITY NAME': 'Old University', 'COURSE NAME': 'BA Old', 'UNIVERSITY PARTNER': 'SI-UK' }); }));
    assert.strictEqual((await admin('POST', '/api/data', { baseRevision: w.revision, sheets: w.sheets, activeSheetId: w.activeSheetId })).status, 200);
  }
  assert.strictEqual((await admin('POST', `/api/cards/${id}/options`, { university: 'Kent University', course: 'BSc Nursing (Adult)', partner: 'Partner One' })).status, 200);
  assert.strictEqual((await admin('POST', `/api/cards/${id}/options`, { university: 'Kent University', course: 'BSc Nursing (Child)', partner: 'Partner Two' })).status, 200);
  const pick = await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Kent University', 'COURSE NAME': 'BSc Nursing (Child)' } });
  assert.strictEqual(pick.status, 200, JSON.stringify(pick.json));
  assert.strictEqual((await rowOf(id))['UNIVERSITY PARTNER'], 'Partner Two');
  // The save says what it replaced, as the server had it, and Undo puts the partner typed by hand back too.
  assert.deepStrictEqual([pick.json.replaced['UNIVERSITY NAME'], pick.json.replaced['UNIVERSITY PARTNER']], ['Old University', 'SI-UK']);
  assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Old University', 'COURSE NAME': 'BA Old' }, undo: true })).status, 200);
  assert.strictEqual((await rowOf(id))['UNIVERSITY PARTNER'], 'SI-UK');

  // A cell the Application Team types on the sheet is left out, and the page is told to reload (never shown as saved).
  const w2 = (await app('GET', '/api/data')).json;
  w2.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) r['STUDENT ID'] = 'typed'; }));
  const dropped = await app('POST', '/api/data', { baseRevision: w2.revision, sheets: w2.sheets, activeSheetId: w2.activeSheetId });
  assert.strictEqual(dropped.status, 200);
  assert.strictEqual(dropped.json.reload, true);
  assert.notStrictEqual((await rowOf(id))['STUDENT ID'], 'typed');

  // Every application gets its own Offer request, also two courses at one university (the owner, 22 Nov 2026).
  {
    const sid = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Two', 'LAST NAME': 'Courses', 'CONTACT NUMBER': '9800000095', 'STUDENT SOURCE': 'Visitor' } })).json.id;
    const a = (await admin('POST', `/api/cards/${sid}/options`, { university: 'Coventry University', course: 'MSc A' })).json.option;
    const b = (await admin('POST', `/api/cards/${sid}/options`, { university: 'Coventry University', course: 'MSc B' })).json.option;
    assert.strictEqual((await admin('POST', `/api/cards/${sid}/options/send`, { ids: [a.id, b.id], partners: { [a.id]: 'Direct', [b.id]: 'Direct' } })).status, 200);
    const today = (await admin('GET', '/api/tasks')).json.today;
    const applyTasks = (await app('GET', '/api/tasks')).json.tasks.filter((x) => x.studentId === sid && x.tag === 'application' && !x.done);
    for (const task of applyTasks) {
      const done = await app('POST', `/api/cards/${sid}/tasks/${task.id}`, { done: true, finish: { app: 'record', date: today, unis: [{ university: 'Coventry University', course: task.course.course, what: 'submitted', date: today }], confirmed: true, next: 'none' } });
      assert.strictEqual(done.status, 200, JSON.stringify(done.json));
    }
    const offers = (await app('GET', '/api/tasks')).json.tasks.filter((x) => x.studentId === sid && x.tag === 'offer' && !x.done).map((x) => x.offerFor.course).sort();
    assert.deepStrictEqual(offers, ['MSc A', 'MSc B']);
  }
  // Assign takes the partner from Apply through, named the owner's way (22 Nov 2026): Direct only with no one in between, Navitas and
  // OIEG by their names, the QA universities as "QA Higher Education"; Change partner offers only that place's partners.
  {
    await admin('POST', '/api/b2b', { name: 'Adventus' }); // an installation of this kind gets the starting Apply through list
    const route = async (u) => (await admin('GET', '/api/application-partners?u=' + encodeURIComponent(u))).json.universities[u];
    const ap = (await admin('GET', '/api/apply-through')).json.choices || [];
    const named = (re) => (ap.find((e) => re.test(e.name)) || {}).name;
    const cases = [[/^Keele University International College/i, 'Navitas'], [/^Health Sciences University$/i, 'Oxford International Education Group'], [/\(QA\)$/i, 'QA Higher Education'], [/^University of West London$/i, 'Direct']];
    for (const [re, want] of cases) {
      const u = named(re);
      assert.ok(u, `${re} is on the starting Apply through list`);
      assert.strictEqual((await route(u)).suggested, want, u);
    }
    const herts = await route('University of Hertfordshire');
    assert.deepStrictEqual(herts.choices.slice().sort(), ['Adventus', 'Apply Board', 'Real Dreams Educational Consultancy']);
  }

  // Many students moved in one save: each gets its stage line (written to the cards file once).
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': `Batch${i}`, 'LAST NAME': 'Demo', 'CONTACT NUMBER': `98000002${i}0`, 'STUDENT SOURCE': 'Visitor' } })).json.id);
  const w3 = (await admin('GET', '/api/data')).json;
  w3.sheets.forEach((sh) => sh.rows.forEach((r) => { if (ids.includes(r._id)) r['APPLICATION STATUS'] = 'Application Stage'; }));
  assert.strictEqual((await admin('POST', '/api/data', { baseRevision: w3.revision, sheets: w3.sheets, activeSheetId: w3.activeSheetId })).status, 200);
  for (const rid of ids) {
    const notes = (await admin('GET', `/api/cards/${rid}`)).json.card.notes;
    assert.ok(notes.some((n) => n.kind === 'stage'), 'a stage line for every student moved');
  }
});
