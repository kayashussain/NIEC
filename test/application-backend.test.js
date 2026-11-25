// The Application Team's back end under pressure: the same request twice at once, old pages, and rules that must hold.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-appback-'));
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
  const login = async (username, departments) => {
    const made = (await admin('POST', '/api/users', { username, name: username, email: '', departments })).json;
    const c = person();
    await c('POST', '/api/login', { username, password: made.temporaryPassword });
    await c('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
    return c;
  };
  return { dir, admin, login, person };
}

test('the same task finished twice at once is written once', { timeout: 120000 }, async (t) => {
  const { admin, login } = await start(t);
  const app = await login('asha', ['application']);
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Gita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000071', 'UNIVERSITY NAME': 'Example University' } })).json.id;
  const tid = (await admin('POST', `/api/cards/${id}/tasks`, { team: 'application', text: 'Make the NOC account', tag: 'noc' })).json.card.tasks[0].id;
  const send = () => app('POST', `/api/cards/${id}/tasks/${tid}`, { done: true, finish: { next: 'none', noc: 'Pending', note: 'Account created', confirmed: true } });
  const results = await Promise.all([send(), send(), send()]);
  const card = (await admin('GET', `/api/cards/${id}`)).json.card;
  const finishedNotes = card.notes.filter((n) => /Account created|NOC/.test(n.text) && !/marked the task/.test(n.text));
  assert.ok(results.some((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.every((r) => r.status === 200), 'a repeated press is answered, not refused: ' + JSON.stringify(results.map((r) => [r.status, r.json && r.json.error])));
  assert.strictEqual(card.tasks[0].done, true);
  const log = (await admin('GET', '/api/activity?q=' + encodeURIComponent('marked the task') + '&limit=50')).json;
  const entries = (log.events || log.entries || []).filter((e) => JSON.stringify(e).includes('marked the task'));
  assert.strictEqual(entries.length, 1, 'Activity says it once, not ' + entries.length);
  assert.strictEqual(finishedNotes.length, 1, 'one note, not ' + finishedNotes.length + ': ' + finishedNotes.map((n) => n.text).join(' || '));
});

test('the Application Team: who it can reach, what it can change, and every refusal holds', { timeout: 120000 }, async (t) => {
  const { admin, login } = await start(t);
  const app = await login('asha', ['application']);
  const mk = async (name, stage, fields = {}) => (await admin('POST', '/api/students/new', { stage, fields: { 'FIRST NAME': name, 'LAST NAME': 'Demo', 'CONTACT NUMBER': '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), ...fields } })).json.id;
  const inApp = await mk('Anu', 'Application Stage', { 'UNIVERSITY NAME': 'Example University', 'COURSE NAME': 'BSc X' });
  const inMock = await mk('Bina', 'Mock Stage');
  const inPay = await mk('Cara', 'Payment Stage');
  const inInq = await mk('Dina', 'Inquiry');
  const card = (c, id) => c('GET', `/api/cards/${id}`);
  const save = (c, id, fields, extra = {}) => c('POST', `/api/cards/${id}/sheet`, { fields, ...extra });

  // Reach: Application Stage and Mock Stage yes; Payment and Inquiry students (with no task for the team) are not found.
  assert.strictEqual((await card(app, inApp)).status, 200);
  assert.strictEqual((await card(app, inMock)).status, 200, 'a Mock Stage student can be completed by the team');
  assert.strictEqual((await card(app, inPay)).status, 404);
  assert.strictEqual((await card(app, inInq)).status, 404);
  assert.strictEqual((await save(app, inPay, { 'COURSE NAME': 'Hacked' })).status, 404);
  assert.strictEqual((await save(app, inInq, { 'COURSE NAME': 'Hacked' })).status, 404);

  // What it may change on the card: application columns yes (also on a Mock Stage student), mock columns no, nonsense never.
  assert.strictEqual((await save(app, inApp, { 'COURSE NAME': 'BSc Y', 'NOC': 'Pending' })).status, 200);
  assert.strictEqual((await save(app, inMock, { 'COURSE NAME': 'BSc Z' })).status, 200);
  assert.strictEqual((await save(app, inMock, { 'FEEDBACK 1': 'nice' })).status, 403, 'mock columns are the Mock Team\'s');
  assert.strictEqual((await save(app, inApp, { 'PRE CAS INTERVIEW': 'Passed' })).status, 403);
  await save(app, inApp, { 'PAYMENT DATE': '2026-10-01' }); // not a card detail at all: ignored
  assert.strictEqual(((await admin('GET', `/api/cards/${inApp}`)).json.student.row['PAYMENT DATE'] || ''), '', 'a column that is not the team\'s is never written');
  assert.strictEqual((await save(app, inApp, { 'OFFER RECEIVED DATE': '2026-02-31' })).status, 400, 'not a real day');
  assert.strictEqual((await save(app, inApp, { 'EMAIL': 'not-an-email' })).status, 400);
  assert.strictEqual((await save(app, inApp, { 'FIRST NAME': '', 'LAST NAME': '' })).status, 400, 'a student keeps a name');
  assert.strictEqual((await save(app, inApp, { 'APPLICATION SUBMISSION DATE': '2026-09-10', 'OFFER RECEIVED DATE': '2026-09-01' })).status, 400, 'offer before application');
  assert.strictEqual((await save(app, inApp, { 'COURSE NAME': { x: 1 } })).status, 200, 'an object is turned into text, never stored as an object');
  const row = async (id) => (await admin('GET', `/api/cards/${id}`)).json.student.row;
  assert.strictEqual(typeof (await row(inApp))['COURSE NAME'], 'string');
  assert.ok((await row(inApp))['COURSE NAME'].length <= 240);

  // Student Source: a listed source yes, a branch never, a made-up one never.
  const src = (c, id, v) => c('POST', `/api/cards/${id}/source`, { source: v });
  assert.strictEqual((await src(app, inApp, 'Chitwan Branch')).status, 403);
  assert.strictEqual((await src(app, inApp, 'Made Up Source')).status, 400);
  assert.strictEqual((await src(app, inApp, 'Social Media')).status, 200);
  assert.strictEqual((await row(inApp))['STUDENT SOURCE'], 'Social Media');
  assert.strictEqual((await src(admin, inApp, 'Chitwan Branch')).status, 200, 'Admin gives a branch');
  assert.strictEqual((await src(app, inApp, 'Agent')).status, 403, 'a branch student\'s source stays Admin\'s');
  assert.strictEqual((await row(inApp))['STUDENT SOURCE'], 'Chitwan Branch');

  // The notes keep every change with who did it.
  const notes = (await card(admin, inMock)).json.card.notes.map((n) => n.text).join('\n');
  assert.match(notes, /Course name: \(empty\) \u2192 "BSc Z"/);

  // Moving on: Application to Mock needs university, course, application day and offer; the sheet's own save refuses without them.
  const sheet = async () => (await app('GET', '/api/data')).json;
  const moveTo = async (id, to) => { const d = await sheet(); const r = d.sheets[0].rows.find((x) => x._id === id); r['APPLICATION STATUS'] = to; return app('POST', '/api/data', { sheets: d.sheets, activeSheetId: d.activeSheetId, baseRevision: d.revision }); };
  const dd = await mk('Esha', 'Application Stage', { 'UNIVERSITY NAME': 'U', 'COURSE NAME': 'C' });
  const refused = await moveTo(dd, 'Mock Stage');
  assert.ok([403, 409].includes(refused.status), 'cannot leave Application without the application and offer days: ' + refused.status);
  assert.strictEqual((await row(dd))['APPLICATION STATUS'], 'Application Stage');
  assert.strictEqual((await save(app, dd, { 'UNIVERSITY NAME': 'Example University', 'COURSE NAME': 'BSc X', 'APPLICATION SUBMISSION DATE': '2026-09-01', 'OFFER RECEIVED DATE': '2026-09-20' })).status, 200);
  const mv = await moveTo(dd, 'Mock Stage'); assert.strictEqual(mv.status, 200, JSON.stringify(mv.json));
  assert.strictEqual((await row(dd))['APPLICATION STATUS'], 'Mock Stage');
  // A forged save that puts the Mock Stage student back on the team's sheet with a later stage changes nothing.
  const full = (await admin('GET', '/api/data')).json;
  const forged = await sheet();
  const theirs = full.sheets[0].rows.find((x) => x._id === dd);
  forged.sheets[0].rows.push({ ...theirs, 'APPLICATION STATUS': 'Visa Issued' });
  await app('POST', '/api/data', { sheets: forged.sheets, activeSheetId: forged.activeSheetId, baseRevision: forged.revision });
  assert.strictEqual((await row(dd))['APPLICATION STATUS'], 'Mock Stage', 'a forged save cannot move a student the team does not have');

  // The sheet is not where the team types: a changed cell is dropped, never written.
  const d = await sheet();
  const r = d.sheets[0].rows.find((x) => x._id === inApp || x._id === inMock);
  if (r) { r['COURSE NAME'] = 'TYPED ON SHEET'; await app('POST', '/api/data', { sheets: d.sheets, activeSheetId: d.activeSheetId, baseRevision: d.revision }); }
  assert.notStrictEqual((await row(inMock))['COURSE NAME'], 'TYPED ON SHEET');
});

test('a task for a student who has moved on (Payment Stage) still writes the sheet and the notes, like the Medical step', { timeout: 120000 }, async (t) => {
  const { admin, login } = await start(t);
  const app = await login('asha', ['application']);
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Mina', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000099' } })).json.id;
  const tid = (await admin('POST', `/api/cards/${id}/tasks`, { team: 'application', text: 'Book the medical test', tag: 'medical' })).json.card.tasks[0].id;
  // The student moves on to Payment Stage (Admin), the task stays with the Application Team.
  const d = (await admin('GET', '/api/data')).json;
  d.sheets[0].rows.find((r) => r._id === id)['APPLICATION STATUS'] = 'Payment Stage';
  assert.strictEqual((await admin('POST', '/api/data', { sheets: d.sheets, activeSheetId: d.activeSheetId, baseRevision: d.revision })).status, 200);
  const today = (await admin('GET', '/api/tasks')).json.today;
  const day = new Date(Date.parse(today + 'T00:00:00Z') + 5 * 86400000).toISOString().slice(0, 10);
  const done = await app('POST', `/api/cards/${id}/tasks/${tid}`, { done: true, finish: { next: 'none', medical: 'booked', date: day, place: 'IOM Kathmandu', confirmed: true } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const got = (await admin('GET', `/api/cards/${id}`)).json;
  assert.strictEqual(got.student.row['MEDICAL REPORT'], 'Booked', 'the sheet is written');
  assert.match(got.card.notes.map((n) => n.text).join('\n'), /Medical test booked/, 'and the notes');
  assert.strictEqual(got.student.row['APPLICATION STATUS'], 'Payment Stage', 'the stage is not touched');
});

test('task workflow end to end: give, see, comment, move the day, hand on, finish, reopen, remove; and who may do what', { timeout: 120000 }, async (t) => {
  const { admin, login } = await start(t);
  const app = await login('asha', ['application']);
  const mock = await login('mina', ['mock']);
  const other = await login('olga', ['application']);
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Tara', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000123' } })).json.id;
  const url = (tid, rest = '') => `/api/cards/${id}/tasks${tid ? '/' + tid : ''}${rest}`;
  const card = async () => (await admin('GET', `/api/cards/${id}`)).json.card;
  const today = (await admin('GET', '/api/tasks')).json.today;
  const day = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // Give: Admin gives; the Application Team cannot give tasks to others unless allowed; a made-up team is refused; nonsense text is refused.
  assert.strictEqual((await admin('POST', url(''), { team: 'nobody', text: 'x' })).status, 400);
  assert.strictEqual((await admin('POST', url(''), { team: 'application', text: '' })).status >= 400, true, 'an empty task is refused');
  const made = await admin('POST', url(''), { team: 'application', text: 'Check the passport copy', tag: 'application' });
  assert.strictEqual(made.status, 200);
  const tid = made.json.card.tasks.find((x) => x.text === 'Check the passport copy').id;

  // Seen: the team has it in its list; the Mock Team cannot touch it.
  const list = (await app('GET', '/api/tasks')).json;
  assert.ok(JSON.stringify(list).includes(tid), 'the Application Team sees the task');
  assert.ok([403, 404].includes((await mock('POST', url(tid), { comment: 'hello' })).status), 'another team cannot comment');
  assert.ok([403, 404].includes((await mock('POST', url(tid), { done: true, finish: { note: 'I did it, honest.', confirmed: true } })).status), 'another team cannot finish it');
  assert.ok([403, 404].includes((await mock('POST', url(tid, '/delete'), {})).status), 'another team cannot remove it');

  // Comment and move the day.
  assert.strictEqual((await app('POST', url(tid), { comment: 'Passport page 2 is blurred, asked the student.' })).status, 200);
  assert.strictEqual((await app('POST', url(tid), { schedule: day(-1) })).status >= 400, true, 'not a day in the past');
  assert.strictEqual((await app('POST', url(tid), { schedule: day(3), reason: 'Student away until then' })).status, 200);
  assert.strictEqual((await card()).tasks.find((x) => x.id === tid).doOn, day(3));

  // Done needs words; then done writes; done again changes nothing; reopen works; a finished task is not "moved".
  assert.strictEqual((await app('POST', url(tid), { done: true })).status, 400, 'done needs what happened');
  assert.strictEqual((await app('POST', url(tid), { done: true, finish: { note: 'ok', confirmed: true } })).status, 400, 'a few words, not "ok"');
  assert.strictEqual((await app('POST', url(tid), { done: true, finish: { note: 'Passport copy is clear now, checked page 2.', confirmed: true } })).status, 200);
  assert.strictEqual((await card()).tasks.find((x) => x.id === tid).done, true);
  assert.strictEqual((await app('POST', url(tid), { schedule: day(5) })).status, 400, 'a done task cannot be moved');
  assert.strictEqual((await app('POST', url(tid), { done: false })).status, 200);
  assert.strictEqual((await card()).tasks.find((x) => x.id === tid).done, false, 'reopened');

  // Hand on: to a team that has someone; refused to an empty team and to a made-up one; another person of the same team may still finish it.
  assert.strictEqual((await app('POST', url(tid), { handTo: 'nobody', reason: 'x' })).status, 400);
  const handed = await app('POST', url(tid), { handTo: 'mock', reason: 'Needs the mock team to confirm the course' });
  assert.ok([200, 403].includes(handed.status), 'hand on answers clearly: ' + handed.status);
  if (handed.status === 200) {
    assert.strictEqual((await card()).tasks.find((x) => x.id === tid).team, 'mock');
    assert.strictEqual((await mock('POST', url(tid), { comment: 'Got it.' })).status, 200, 'now the Mock Team can talk about it');
  }

  // Remove: only Admin, the Manager or whoever gave it; the Application Team (not the giver) cannot.
  const t2 = (await admin('POST', url(''), { team: 'application', text: 'Second task', tag: 'application' })).json.card.tasks.find((x) => x.text === 'Second task').id;
  assert.strictEqual((await other('POST', url(t2, '/delete'), {})).status, 403);
  assert.strictEqual((await app('POST', url(t2, '/delete'), {})).status, 403);
  assert.strictEqual((await admin('POST', url(t2, '/delete'), {})).status, 200);
  assert.ok(!(await card()).tasks.some((x) => x.id === t2));

  // The shortlist to the Application Team: nothing goes without a partner; the same course is never sent twice.
  const opt = await admin('POST', `/api/cards/${id}/options`, { university: 'Test University', course: 'BSc Test', level: 'Undergraduate', intake: 'Sep 2027' });
  assert.strictEqual(opt.status, 200, JSON.stringify(opt.json));
  const oid = opt.json.option ? opt.json.option.id : opt.json.card.options[0].id;
  assert.strictEqual((await admin('POST', `/api/cards/${id}/options/send`, { ids: [oid] })).status, 400, 'a partner must be chosen');
  const sent = await admin('POST', `/api/cards/${id}/options/send`, { ids: [oid], partners: { [oid]: 'Direct' } });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
  assert.strictEqual((await admin('POST', `/api/cards/${id}/options/send`, { ids: [oid], partners: { [oid]: 'Direct' } })).status, 400, 'never sent twice');
  const applyTasks = (await card()).tasks.filter((x) => /Apply to Test University/.test(x.text));
  assert.strictEqual(applyTasks.length, 1);
  // Removing that Apply task puts the course back on the Shortlist, so nobody is left holding it.
  assert.strictEqual((await admin('POST', url(applyTasks[0].id, '/delete'), {})).status, 200);
  const back = (await card()).options.find((x) => x.id === oid);
  assert.ok(back && !back.taskId && !back.sent, 'the course is back on the shortlist');
});

// The card carries the mock bookings (read only) for its Mock interviews box (the owner, 24 Nov 2026).
test('The card carries the mock bookings, read only, for the Application Team', { timeout: 120000 }, async (t) => {
  const { admin, login } = await start(t);
  const app = await login('asha', ['application']);
  const mock = await login('mina', ['mock']);
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Gita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000081', 'UNIVERSITY NAME': 'Example University', 'COURSE NAME': 'BSc Example' } })).json.id;
  assert.ok(id, 'a student to list');
  assert.ok((await admin('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Example University', 'COURSE NAME': 'BSc Example' } })).json, 'the university on All Students');
  await admin('POST', `/api/cards/${id}/tasks`, { team: 'application', text: 'Apply to Example University', tag: 'application' });
  // The card carries the mock bookings, an empty list when there are none.
  const card = (await app('GET', `/api/cards/${id}`)).json;
  assert.ok(Array.isArray(card.mockInfo), 'mockInfo is a list');
  assert.strictEqual(card.mockInfo.length, 0);
  // The Application Team still cannot write a mock column (it only looks).
  const w = await app('POST', `/api/cards/${id}/sheet`, { fields: { 'FEEDBACK 1': 'x' } });
  assert.ok(w.status === 403 || (w.json && w.json.error), 'the mock columns stay closed to the Application Team');
});
