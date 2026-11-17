// A student's own login (the owner, 17 Nov 2026): it reads the Fact File and keeps a shortlist, and nothing else. Every other page
// and every piece of data (the sheet, other students, tasks, the Dashboard, partners, Incentive, users) is refused; the Fact File
// is sent without its internal notes and application steps; what the student chooses goes to their own card's University options
// and gives the Application Team one task. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a student login sees the Fact File only, and the courses it chooses reach the team', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-student-'));
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
  assert.strictEqual(made.user.accessLabel, 'Student (Fact File only)');
  assert.strictEqual((await admin('GET', '/api/users')).json.find((u) => u.username === 'sita').studentName, 'Sita Demo');
  const stu = person();
  await stu('POST', '/api/login', { username: 'sita', password: made.temporaryPassword });
  assert.strictEqual((await stu('POST', '/api/login/new-password', { password: 'Student-Strong-2026' })).status, 200);

  // Everything but the Fact File is refused.
  for (const page of ['/', '/today', '/students', '/student?id=' + sita, '/dashboard', '/my-dashboard', '/users', '/activity', '/bulk', '/b2b-partners', '/agents', '/partner-universities', '/events', '/data-to-fix', '/weekly', '/incentive/', '/wa?n=9779800000101', '/index.html', '/users.html', '/today.html']) {
    const r = await stu('GET', page);
    assert.strictEqual(r.status, 302, `${page} is not for a student`);
    assert.strictEqual(r.location, '/fact-file', `${page} goes to the Fact File`);
  }
  for (const [method, url] of [['GET', '/api/data'], ['GET', '/api/revision'], ['GET', `/api/cards/${sita}`], ['GET', `/api/cards/${other}`], ['GET', '/api/students/search?q=hari'], ['GET', '/api/tasks'], ['GET', '/api/today'],
    ['GET', '/api/dashboard'], ['GET', '/api/users'], ['GET', '/api/b2b'], ['GET', '/api/direct'], ['GET', '/api/events'], ['GET', '/api/backup/students.json'], ['GET', '/api/bulk/students'], ['GET', '/api/courses?q=nursing'],
    ['POST', '/api/data'], ['POST', '/api/students/new'], ['POST', `/api/cards/${sita}/notes`], ['POST', '/api/facts'], ['POST', '/api/push/whatsapp'], ['GET', '/api/my-mail'], ['GET', '/api/course-watch']]) {
    const r = await stu(method, url, method === 'POST' ? {} : undefined);
    assert.ok([403, 401].includes(r.status), `${method} ${url} is refused (got ${r.status})`);
    assert.ok(!/Hari|9800000102|hari@example/.test(r.text), `${url} says nothing about another student`);
  }
  assert.strictEqual((await stu('GET', '/fact-file')).status, 200);
  const list = (await stu('GET', '/api/facts')).json;
  assert.ok(list.length > 10, 'every university of the Fact File');
  const withNotes = (await admin('GET', '/api/facts')).json.map((u) => u.id).find((id) => true);
  const full = (await admin('GET', `/api/facts/${withNotes}`)).json;
  const seen = (await stu('GET', `/api/facts/${withNotes}`)).json;
  assert.strictEqual(seen.name, full.name);
  assert.ok(seen.notes === '' && seen.process.length === 0 && seen.updatedBy === '', 'no internal notes, application steps or editor');
  assert.ok((seen.intakes || []).every((i) => i.notes === ''));
  assert.ok(full.notes || full.process.length, 'the team still sees them');
  assert.strictEqual((await stu('GET', `/api/fact-courses?university=${withNotes}`)).json.canFind, false);
  assert.strictEqual((await stu('GET', '/api/me')).json.role, 'student');

  // The shortlist: on the student's own card, with one task for the Application Team.
  assert.deepStrictEqual((await stu('GET', '/api/shortlist')).json, { linked: true, name: 'Sita', items: [] });
  assert.strictEqual((await app('GET', '/api/shortlist')).status, 403, 'only for a student login');
  assert.strictEqual((await stu('POST', '/api/shortlist', { universityId: 'ffffffffffff', course: 'MSc X' })).status, 400, 'only a university of the Fact File');
  const one = await stu('POST', '/api/shortlist', { universityId: full.id, course: 'MSc Nursing', intake: 'January 2027' });
  assert.strictEqual(one.status, 200);
  assert.strictEqual((await stu('POST', '/api/shortlist', { universityId: full.id, course: 'MSc Nursing', intake: 'January 2027' })).status, 409, 'once only');
  await stu('POST', '/api/shortlist', { universityId: full.id, course: 'MBA' });
  const card = (await admin('GET', `/api/cards/${sita}`)).json.card;
  assert.deepStrictEqual(card.options.filter((o) => o.byStudent).map((o) => o.course).sort(), ['MBA', 'MSc Nursing']);
  const tasks = card.tasks.filter((x) => x.team === 'application' && /chose courses on the Fact File/.test(x.text));
  assert.strictEqual(tasks.length, 1, 'one task for the Application Team');
  assert.ok(tasks[0].comments.some((c) => /Also chose MBA/.test(c.text)), 'a later choice is an update on it');
  assert.ok((await app('GET', '/api/tasks')).json.tasks.some((x) => /chose courses on the Fact File/.test(x.text)), 'the Application Team sees it');
  assert.ok(!(await admin('GET', `/api/cards/${other}`)).json.card.options.length, 'nothing on another student');
  const mba = (await stu('GET', '/api/shortlist')).json.items.find((o) => o.course === 'MBA');
  assert.strictEqual((await stu('POST', `/api/shortlist/${mba.id}/delete`, {})).status, 200);
  const teamOption = (await admin('POST', `/api/cards/${sita}/options`, { university: 'Team University', course: 'BSc Team Pick' })).json;
  const teamId = (teamOption.card || (await admin('GET', `/api/cards/${sita}`)).json.card).options.find((o) => o.course === 'BSc Team Pick').id;
  assert.strictEqual((await stu('POST', `/api/shortlist/${teamId}/delete`, {})).status, 404, 'the team\'s own options are not the student\'s to take off');
});
