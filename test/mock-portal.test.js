// A student's own portal (the owner, 20 Nov 2026): their applications, the progress line and the mocks with feedback, and a
// student's login opens nothing else. The Mock interview guides were taken out (the owner, 28 Nov 2026): no page, no API, for anyone.
// All names and details here are made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createMockApi } = require('../student-details/mock-api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-mock-'));

test('a student\'s portal: their applications with the decision, the progress line and the mocks with feedback, no guides', () => {
  const row = { _id: 'row-1', 'FIRST NAME': 'Sita', 'UNIVERSITY NAME': 'University of West London', 'MOCK SCHEDULE 1': '2026-11-10', 'FEEDBACK 1': 'Good, work on money answers.' };
  const apps = [
    { university: 'University of West London', course: 'MSc Cyber Security', applied: '2026-11-01', offer: '2026-11-05', offerType: 'Conditional' },
    { university: 'Bangor University', course: 'MSc Business', applied: '2026-11-02', refused: '2026-11-08', reason: 'Gap not explained' },
  ];
  const portal = { rowIndex: () => new Map([['row-1', { row, sheet: { name: 'Jan Intake 2027' } }]]), applicationsOf: () => apps };
  const api = createMockApi({ portal, cards: { get: () => ({ options: [] }) }, facts: { list: () => [] }, isoDate: (v) => v });
  const me = api.studentView({ role: 'student', studentRow: 'row-1', name: 'Sita Example' });
  assert.strictEqual(me.firstName, 'Sita');
  assert.strictEqual(me.intake, 'Jan Intake 2027');
  assert.deepStrictEqual(me.applications.map((a) => [a.university, a.decision, a.main]), [
    ['University of West London', 'Conditional offer', true],
    ['Bangor University', 'Refused', false],
  ]);
  assert.ok(me.applications.every((a) => !('guide' in a)), 'no guide on an application');
  assert.ok(!('coreGuide' in me) && !('phases' in me), 'nothing about guides in the portal');
  assert.deepStrictEqual(me.progress.map((s) => s.state), ['done', 'done', 'now', 'next', 'next', 'next']);
  assert.deepStrictEqual(me.mocks, [{ n: 1, date: '2026-11-10', feedback: 'Good, work on money answers.' }]);
  const none = api.studentView({ role: 'student', studentRow: 'row-x', name: 'Nobody' });
  assert.strictEqual(none.linked, false);
});

test('the guides\' code is gone from the project', () => {
  for (const f of ['mock-guides.js', 'mock-guides-seed.js', 'mock-guides-page.js', 'mock-guides.html', 'guide-view.js']) {
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'student-details', f)), `${f} is deleted`);
  }
  const header = fs.readFileSync(path.join(__dirname, '..', 'shared', 'header.js'), 'utf8');
  assert.ok(!/\/mock-guides/.test(header), 'no menu link to Mock interview guides');
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a student\'s login opens their portal and nothing else; Mock interview guides open for nobody', { timeout: 120000 }, async (t) => {
  const dir = tmp();
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
    return { status: res.status, json, location: res.headers.get('location'), text: tx };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = async (body) => { const m = (await admin('POST', '/api/users', body)).json; const p = person(); await p('POST', '/api/login', { username: body.username, password: m.temporaryPassword }); await p('POST', '/api/login/new-password', { password: 'Other-Strong-2026' }); return p; };
  const student = await made({ username: 'sita', name: 'Sita Example', email: '', role: 'student', studentRow: 'row-made-up' });
  const bikram = await made({ username: 'bikram', name: 'Bikram', email: '', departments: ['mock'] });
  const branch = await made({ username: 'chitwan1', name: 'Chitwan Person', email: '', departments: ['chitwan'] });

  for (const page of ['/today', '/students', '/fact-file', '/users']) assert.strictEqual((await student('GET', page)).location, '/my-portal', `${page} goes to the portal`);
  const portalPage = await student('GET', '/my-portal');
  assert.strictEqual(portalPage.status, 200);
  assert.ok(!/guide-view\.js|Your interview guide/.test(portalPage.text), 'the portal has no guide section');
  for (const url of ['/api/facts', '/api/workbook', '/api/shortlist']) assert.strictEqual((await student('GET', url)).status, 403, `${url} is refused`);
  assert.strictEqual((await student('GET', '/api/my-portal')).json.linked, false, 'a login not linked to a student on the sheet says so');
  assert.notStrictEqual((await student('GET', '/api/my-portal/guide/core')).status, 200, 'no guide for a student');

  for (const [who, p] of [['Admin', admin], ['the Mock Team', bikram], ['a branch', branch]]) {
    assert.notStrictEqual((await p('GET', '/mock-guides')).status, 200, `${who}: no Mock interview guides page`);
    assert.notStrictEqual((await p('GET', '/mock-guides.html')).status, 200, `${who}: no page by its file name`);
    assert.strictEqual((await p('GET', '/api/mock-guides')).status, 404, `${who}: no guides API`);
    assert.notStrictEqual((await p('GET', '/guide-view.js')).status, 200, `${who}: no guide reader`);
  }
});
