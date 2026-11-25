// A student's own login (the owner, 20 Nov 2026): it opens the student's own portal, and nothing else. Every other page and every
// piece of data (Universities, the sheet, other students, tasks, the Dashboard, partners, Incentive, users) is refused; the portal
// shows only the student's own file. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a student login opens their own portal only', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-student-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir }, stdio: 'ignore' });
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
  const app = person();
  const appMade = (await admin('POST', '/api/users', { username: 'asha', name: 'Asha', email: '', departments: ['application'] })).json;
  await app('POST', '/api/login', { username: 'asha', password: appMade.temporaryPassword }); await app('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });

  const sita = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Sita', 'LAST NAME': 'Demo', EMAIL: 'sita@example.org', 'CONTACT NUMBER': '9800000101' } })).json.id;
  const other = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Other', EMAIL: 'hari@example.org', 'CONTACT NUMBER': '9800000102' } })).json.id;

  // Admin makes the login: it needs the student it is for.
  assert.match((await admin('POST', '/api/users', { username: 'sita', name: 'Sita Demo', email: '', role: 'student' })).json.error, /Choose which student/);
  const made = (await admin('POST', '/api/users', { username: 'sita', name: 'Sita Demo', email: '', role: 'student', studentRow: sita })).json;
  assert.strictEqual(made.user.accessLabel, 'Student (own portal)');
  assert.strictEqual((await admin('GET', '/api/users')).json.find((u) => u.username === 'sita').studentName, 'Sita Demo');
  const stu = person();
  await stu('POST', '/api/login', { username: 'sita', password: made.temporaryPassword });
  assert.strictEqual((await stu('POST', '/api/login/new-password', { password: 'Student-Strong-2026' })).status, 200);

  // Everything but the portal is refused, Universities too.
  for (const page of ['/', '/fact-file', '/fact-file?u=x', '/today', '/students', '/student?id=' + sita, '/dashboard', '/my-dashboard', '/users', '/activity', '/bulk', '/b2b-partners', '/agents', '/partner-universities', '/events', '/incentive/', '/index.html', '/users.html', '/today.html']) {
    const r = await stu('GET', page);
    assert.strictEqual(r.status, 302, `${page} is not for a student`);
    assert.strictEqual(r.location, '/my-portal', `${page} goes to the portal`);
  }
  for (const [method, url] of [['GET', '/api/data'], ['GET', '/api/revision'], ['GET', `/api/cards/${sita}`], ['GET', `/api/cards/${other}`], ['GET', '/api/students/search?q=hari'], ['GET', '/api/tasks'], ['GET', '/api/today'],
    ['GET', '/api/dashboard'], ['GET', '/api/users'], ['GET', '/api/b2b'], ['GET', '/api/direct'], ['GET', '/api/events'], ['GET', '/api/backup/students.json'], ['GET', '/api/bulk/students'], ['GET', '/api/courses?q=nursing'],
    ['POST', '/api/data'], ['POST', '/api/students/new'], ['POST', `/api/cards/${sita}/notes`], ['POST', '/api/facts'], ['POST', '/api/push/whatsapp'], ['GET', '/api/my-mail'], ['GET', '/api/course-watch'],
    ['GET', '/api/facts'], ['GET', '/api/fact-courses?university=x'], ['GET', '/api/shortlist'], ['POST', '/api/shortlist'], ['POST', '/api/eligibility'], ['GET', '/api/mock-guides']]) {
    const r = await stu(method, url, method === 'POST' ? {} : undefined);
    assert.ok([403, 401].includes(r.status), `${method} ${url} is refused (got ${r.status})`);
    assert.ok(!/Hari|9800000102|hari@example/.test(r.text), `${url} says nothing about another student`);
  }
  assert.strictEqual((await stu('GET', '/my-portal')).status, 200);
  assert.strictEqual((await stu('GET', '/api/me')).json.role, 'student');

  // The portal: their own name and file only.
  const mine = (await stu('GET', '/api/my-portal')).json;
  assert.strictEqual(mine.linked, true);
  assert.strictEqual(mine.firstName, 'Sita');
  assert.deepStrictEqual(mine.applications, [], 'nothing applied for yet');
  assert.strictEqual(mine.progress.length, 6);
  assert.ok(!/Hari|9800000102|hari@example/.test(JSON.stringify(mine)), 'nothing about another student');
  assert.strictEqual((await app('GET', '/api/my-portal')).status, 403, 'only for a student login');
  assert.strictEqual((await stu('GET', '/api/my-portal/guide/universityofwestlondon')).status, 404, 'only the guides of their own universities');
});
