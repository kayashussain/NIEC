// Today for the Application Team, "Option A" (the owner, 21 Nov 2026): every task carries the course it was made for and how to reach
// the student, a course is never given to the team twice, an Offer request keeps the application it chases, the done window lists the
// student's other applications only for Admin, and Missing details lists what the team can fix. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Fields = require('../student-details/card-fields');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the Pre-CAS interview is guessed as a mock, not the visa', () => {
  assert.strictEqual(Fields.guessTaskTag('Prepare the student for the Pre-CAS interview', 'mock', ''), 'mock');
  assert.strictEqual(Fields.guessTaskTag('Book the VFS appointment', 'application', ''), 'visa');
});

test('Today, Option A: course and contact on each task, no course twice, Offer requests, Missing details', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-option-a-'));
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
    return { status: res.status, json };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = (await admin('POST', '/api/users', { username: 'asha', name: 'Asha', email: '', departments: ['application'] })).json;
  const app = person();
  await app('POST', '/api/login', { username: 'asha', password: made.temporaryPassword }); await app('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });

  // A student who already holds an offer from another university (Roehampton) on All Students.
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Sarita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000081', EMAIL: 'sarita.demo@example.com', 'STUDENT SOURCE': 'Visitor', 'UNIVERSITY NAME': 'Roehampton University', 'COURSE NAME': 'MSc Data Science' } })).json.id;
  const today = (await admin('GET', '/api/tasks')).json.today;
  const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const wb = (await admin('GET', '/api/data')).json;
  wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) { r['APPLICATION SUBMISSION DATE'] = add(-20); r['OFFER RECEIVED DATE'] = add(-30); } }));
  assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId })).status, 200);

  // Shortlist Coventry and give it to the Application Team: one Apply task carrying the course.
  const opt = (await admin('POST', `/api/cards/${id}/options`, { university: 'Coventry University', course: 'MSc Data Science and Computational Intelligence', level: 'Postgraduate', intake: 'May 2027' })).json.card.options.find((o) => o.university === 'Coventry University');
  assert.strictEqual((await admin('POST', `/api/cards/${id}/options/send`, { ids: [opt.id], partners: { [opt.id]: 'Direct' }, note: 'Apply for May.' })).status, 200);
  const again = await admin('POST', `/api/cards/${id}/options/send`, { ids: [opt.id], partners: { [opt.id]: 'Direct' } });
  assert.strictEqual(again.status, 400, 'a course already with the team is not given twice');
  assert.match(again.json.error, /already with the Application Team/);

  const mine = (await app('GET', '/api/tasks')).json.tasks.filter((x) => x.studentId === id);
  assert.strictEqual(mine.length, 1, 'one Apply task');
  const apply = mine[0];
  assert.strictEqual(apply.tag, 'application');
  assert.deepStrictEqual(apply.course, { university: 'Coventry University', course: 'MSc Data Science and Computational Intelligence', level: 'Postgraduate', intake: 'May 2027' }, 'the course it was made for, never All Students\' Roehampton');
  assert.strictEqual(apply.contact.wa, '9779800000081', 'the WhatsApp number as WhatsApp wants it');
  assert.strictEqual(apply.contact.email, 'sarita.demo@example.com');
  assert.strictEqual(apply.contact.source, 'Visitor');

  // The done window: only that course for the team; the other applications only for Admin.
  const teamState = (await app('POST', `/api/cards/${id}/tasks/${apply.id}`, { finishState: true })).json.state;
  assert.strictEqual(teamState.showSoFar, false);
  const adminState = (await admin('POST', `/api/cards/${id}/tasks/${apply.id}`, { finishState: true })).json.state;
  assert.strictEqual(adminState.showSoFar, true);

  // Submitted: an Offer request that keeps the application it chases.
  const done = await app('POST', `/api/cards/${id}/tasks/${apply.id}`, { done: true, finish: { app: 'record', date: today, unis: [{ university: 'Coventry University', course: 'MSc Data Science and Computational Intelligence', what: 'submitted', date: today }], confirmed: true, next: 'none' } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const offer = (await app('GET', '/api/tasks')).json.tasks.find((x) => x.studentId === id && x.tag === 'offer' && !x.done);
  assert.ok(offer, 'an Offer request is made');
  assert.deepStrictEqual(offer.offerFor, { university: 'Coventry University', course: 'MSc Data Science and Computational Intelligence', intake: 'May 2027', applied: today });
  assert.strictEqual(offer.course.university, 'Coventry University');
  assert.strictEqual(offer.course.applied, today);
  // Its words edited: it still knows what it chases.
  await admin('POST', `/api/cards/${id}/tasks/${offer.id}`, { text: 'Chase Coventry for the offer', tag: 'offer' });
  const st = (await app('POST', `/api/cards/${id}/tasks/${offer.id}`, { finishState: true })).json.state;
  assert.strictEqual(st.offerTask.university, 'Coventry University');

  // Missing details: the Application Team's own list; Admin has none. The offer before the application is listed, the passport too.
  const td = (await app('GET', '/api/today')).json;
  assert.ok(Array.isArray(td.missing));
  const me = td.missing.find((m) => m.id === id);
  assert.ok(me, 'the student is listed');
  const lines = me.lines.map((l) => l.text).join('\n');
  assert.match(lines, /is before the application/);
  assert.match(lines, /No date of birth, passport number or address\./);
  assert.strictEqual((await admin('GET', '/api/today')).json.missing, null, 'Admin keeps Needs attention');
  // Fixed: the passport line leaves by itself.
  await admin('POST', `/api/cards/${id}/profile`, { dob: '2001-03-14', passportNo: 'PA0000001', address: 'Bharatpur-10, Chitwan' });
  const after = (await app('GET', '/api/today')).json.missing.find((m) => m.id === id);
  assert.ok(!after || !after.lines.some((l) => /passport/.test(l.text)));

  // A Mock Stage student (the owner, 21 Nov 2026): listed in the team's Missing details, the card opens and the team fixes the details
  // there, but All Students still shows the team only Application Stage students.
  const mockId = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Mina', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000082', 'STUDENT SOURCE': 'Visitor' } })).json.id;
  const listed = (await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId);
  assert.ok(listed, 'a Mock Stage student is in Missing details');
  assert.match(listed.lines.map((l) => l.text).join('\n'), /No date of birth, passport number or address\./);
  const cardRes = await app('GET', `/api/cards/${mockId}`);
  assert.strictEqual(cardRes.status, 200, 'Fix it opens the card');
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/profile`, { dob: '2002-01-02', passportNo: 'PA0000002', address: 'Pokhara-8, Kaski' })).status, 200, 'the team fills in the passport details');
  assert.ok(!((await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId)), 'the line leaves once fixed');
  const sheetRows = (await app('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows);
  assert.ok(!sheetRows.some((r) => r._id === mockId), 'All Students does not show the team the Mock Stage student');
  assert.ok(sheetRows.some((r) => r._id === id), 'the Application Stage student is on All Students');
  // A student at another stage stays closed to the team.
  const casId = (await admin('POST', '/api/students/new', { stage: 'CAS Stage', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000083', 'STUDENT SOURCE': 'Visitor' } })).json.id;
  assert.strictEqual((await app('GET', `/api/cards/${casId}`)).status, 404, 'a CAS Stage student is not the team\'s');
  assert.ok(!((await app('GET', '/api/today')).json.missing.find((m) => m.id === casId)));
});
