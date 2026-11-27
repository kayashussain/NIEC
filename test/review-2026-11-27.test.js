// The overnight review of 27 Nov 2026: each problem it found, and that it stays fixed. All students here are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A server of its own on an empty folder, with Admin signed in and a way to add people.
async function setUp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-review27-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, COURSE_WATCH: 'off', PARTNER_REFRESH: 'off', NAVITAS_TOOLKIT: 'off' };
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
  const join = async (username, departments) => {
    const made = (await admin('POST', '/api/users', { username, name: username, email: '', departments })).json;
    const who = person();
    await who('POST', '/api/login', { username, password: made.temporaryPassword });
    await who('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
    return who;
  };
  return { dir, base, admin, join };
}

test('the check for students already on the sheet answers, and pages closed to a team stay closed by their address', { timeout: 120000 }, async (t) => {
  const { admin, join } = await setUp(t);
  await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Mira', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000092', EMAIL: 'mira.demo@example.com', 'STUDENT SOURCE': 'Visitor' } });
  // Add many students asks this before it saves. It failed on every call until 27 Nov 2026.
  const check = await admin('POST', '/api/students/check', { rows: [{ email: 'MIRA.DEMO@example.com', phone: '' }, { email: 'nobody@example.com', phone: '9811111119' }, null] });
  assert.strictEqual(check.status, 200, JSON.stringify(check.json));
  assert.deepStrictEqual(check.json.results.map((r) => r.exists), [true, false, false]);
  assert.strictEqual(check.json.results[0].name, 'Mira Demo');
  assert.strictEqual((await admin('POST', '/api/students/check', null)).status, 200, 'an empty question is answered, never a failure');

  // The Mock Team has no Follow-up and no Add many students (the owner, 22 Nov 2026): not by the page, and not by its data either.
  const mock = await join('bikram', ['mock']);
  assert.strictEqual((await mock('GET', '/bulk')).location, '/today');
  assert.strictEqual((await mock('GET', '/api/bulk/students')).status, 403);
  assert.strictEqual((await mock('POST', '/api/bulk/preview', { ids: ['row-x'], subject: 'a', body: 'b' })).status, 403);
  assert.strictEqual((await mock('POST', '/api/bulk/send-email', { ids: ['row-x'], subject: 'a', body: 'b' })).status, 403);
  assert.strictEqual((await mock('POST', '/api/students/bulk', { rows: [{ first: 'No', last: 'One', phone: '9812345670' }], source: 'Visitor' })).status, 403);

  // Nor do the Follow-up Team and the Application Team add many students (the owner, 27 Nov 2026).
  const fu = await join('sunita', ['followup']);
  const app = await join('asha', ['application']);
  for (const [who, home] of [[fu, '/students'], [app, '/today']]) {
    for (const page of ['/bulk-add', '/bulk-add.html']) assert.strictEqual((await who('GET', page)).location, home, page);
    assert.strictEqual((await who('POST', '/api/students/bulk', { rows: [{ first: 'No', last: 'One', phone: '9812345671' }], source: 'Visitor' })).status, 403);
  }
  assert.strictEqual((await admin('GET', '/bulk-add')).status, 200, 'Admin still adds many');

  // The Follow-up and Bookings page files open by their own address only for those who get their data.
  const branch = await join('chitwan', ['chitwan']);
  for (const [name, who] of [['follow-up', fu], ['admin', admin]]) assert.strictEqual((await who('GET', '/followup.html')).status, 200, name);
  for (const [name, who] of [['application', app], ['mock', mock], ['branch', branch]]) assert.strictEqual((await who('GET', '/followup.html')).status, 302, name);
  for (const [name, who] of [['mock', mock], ['admin', admin]]) assert.strictEqual((await who('GET', '/bookings.html')).status, 200, name);
  for (const [name, who] of [['follow-up', fu], ['application', app], ['branch', branch]]) assert.strictEqual((await who('GET', '/bookings.html')).status, 302, name);
  assert.strictEqual((await fu('GET', '/students')).status, 200, 'the Follow-up Team still has its list at All Students');
});
