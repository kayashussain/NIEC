// The Follow-up Team's All Students, the follow-up list (the owner, 21 Nov 2026, design A2). All students are made up.
//   - the team has only All Students (its list) and Universities: Today, the Dashboard and Follow-up send it to the list
//   - a note needs what the student said and the next follow-up date; no automatic days
//   - No answer is written as such, never counts as speaking to the student, and brings the student back the next day
//   - Defer and Withdrawn change the stage by themselves; Withdrawn needs a reason
//   - courses assigned to the Application Team move the student to Application Stage; the team keeps seeing them, view only
//   - every move forward, and every move into or out of Defer, Hold, Withdrawn and Visa Rejected, is written on the timeline;
//     a move back is not; a deferred student moved into the next intake comes back at Inquiry
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const stageLog = require('../student-details/stage-log');
const Teams = require('../shared/teams');

test('stage lines: forward and the side stages are written, a move back is not', () => {
  const L = stageLog.lineFor;
  assert.strictEqual(L('Application Stage', 'Mock Stage'), 'Moved to Mock Stage');
  assert.strictEqual(L('Mock Stage', 'Payment Stage'), 'Moved to Payment Stage');
  assert.strictEqual(L('Mock Stage', 'Application Stage'), '', 'a move back is not written');
  assert.strictEqual(L('Inquiry', 'Defer', 'Jan 2027', 'Jan 2027'), 'Moved to Defer · Deferred from Jan 2027 intake');
  assert.strictEqual(L('Inquiry', 'Withdrawn', '', '', 'Chose another consultancy'), 'Moved to Withdrawn · Why: Chose another consultancy');
  assert.strictEqual(L('Application Stage', 'Hold'), 'Moved to Hold');
  assert.strictEqual(L('Hold', 'Application Stage'), 'Back from Hold to Application Stage', 'coming out of a side stage is written');
  assert.strictEqual(L('Defer', 'Inquiry', 'Jan 2027', 'May 2027'), 'Moved to May 2027 intake, back at Inquiry (deferred from Jan 2027 intake)');
  assert.strictEqual(L('', 'Inquiry'), '', 'a new student writes nothing');
  const wb = (stage, sheet = 'Jan 2027') => ({ sheets: [{ name: sheet, rows: [{ _id: 'a', 'APPLICATION STATUS': stage }] }] });
  assert.deepStrictEqual(stageLog.changes(wb('Inquiry'), wb('Inquiry')), []);
  assert.strictEqual(stageLog.changes(wb('Defer'), wb('Inquiry', 'May 2027'))[0].back, true);
});

test('whose own team is the Follow-up Team', () => {
  assert.strictEqual(Teams.ownTeamFollowup({ role: 'staff', departments: ['followup'] }), true);
  assert.strictEqual(Teams.ownTeamFollowup({ role: 'staff', departments: ['followup', 'mock'], taskTeam: 'followup' }), true);
  assert.strictEqual(Teams.ownTeamFollowup({ role: 'staff', departments: ['followup', 'mock'] }), false, 'no own team chosen');
  assert.strictEqual(Teams.ownTeamFollowup({ role: 'admin' }), false);
  assert.strictEqual(Teams.ownTeamFollowup({ role: 'manager', departments: ['followup'] }), false);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('the follow-up list on the real server', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-followup-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json, text: tx, location: res.headers.get('location') };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = (await admin('POST', '/api/users', { username: 'ram', name: 'Ram', email: '', departments: ['followup'] })).json;
  const fu = person();
  await fu('POST', '/api/login', { username: 'ram', password: made.temporaryPassword });
  await fu('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
  const add = async (first, stage = 'Inquiry') => (await admin('POST', '/api/students/new', { stage, fields: { 'FIRST NAME': first, 'LAST NAME': 'Demo', 'CONTACT NUMBER': `98000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}` } })).json.id;
  const a = await add('Aarati'); const b = await add('Bikash'); const c = await add('Kiran'); const d = await add('Suman'); const other = await add('Gita', 'Mock Stage');

  // Pages: All Students is the list; Today, the Dashboard and Follow-up lead there; Admin keeps the sheet.
  assert.match((await fu('GET', '/students')).text, /followup-page\.js/);
  assert.doesNotMatch((await admin('GET', '/students')).text, /followup-page\.js/);
  for (const p of ['/', '/today', '/dashboard', '/my-dashboard', '/bulk']) assert.strictEqual((await fu('GET', p)).location, '/students', p);
  assert.strictEqual((await fu('POST', '/api/bulk/preview', { ids: [a], subject: 'x', body: 'y' })).status, 403, 'no messages to many students');

  const list = async () => (await fu('GET', '/api/followup')).json.students;
  const of = async (id) => (await list()).find((s) => s.id === id);
  let l = await list();
  assert.deepStrictEqual(l.map((s) => s.id).sort(), [a, b, c, d].sort(), 'Inquiry students only; Mock Stage is not the team\'s');
  assert.ok(!l.some((s) => s.id === other));
  assert.strictEqual((await of(a)).state, 'new');
  assert.ok((await of(a)).no >= 1);

  // A note needs the words and the next follow-up date.
  const post = (id, body, who = fu) => who('POST', `/api/followup/${id}`, body);
  assert.strictEqual((await post(a, { action: 'note', text: '', next: day(3) })).json.field, 'text');
  assert.strictEqual((await post(a, { action: 'note', text: 'Likes Business', next: '' })).json.field, 'next');
  assert.strictEqual((await post(a, { action: 'note', text: 'Likes Business', next: day(0) })).json.field, 'next', 'the date is after today');
  assert.strictEqual((await post(a, { action: 'note', text: 'Likes Business, sends transcripts', next: day(3) })).status, 200);
  let s = await of(a);
  assert.strictEqual(s.state, 'ok'); assert.strictEqual(s.next.date, day(3)); assert.match(s.words, /transcripts/);

  // The tag, one at a time.
  assert.strictEqual((await post(a, { action: 'tag', tag: 'Hot' })).status, 400);
  await post(a, { action: 'tag', tag: 'Interested' });
  assert.strictEqual((await of(a)).tag, 'Interested');
  await post(a, { action: 'tag', tag: 'Cold' });
  assert.strictEqual((await of(a)).tag, 'Cold');

  // No answer: orange, at the bottom today, never a contact.
  assert.strictEqual((await post(b, { action: 'try' })).status, 200);
  s = await of(b);
  assert.strictEqual(s.state, 'tried'); assert.strictEqual(s.tries, 1); assert.strictEqual(s.last, null, 'an unanswered call is not a contact');
  const bCard = (await admin('GET', `/api/cards/${b}`)).json.card;
  assert.ok(bCard.notes.some((n) => n.kind === 'try' && n.text === 'Called, no answer'));

  // Defer: the words only; the stage moves and the timeline says from which intake.
  assert.strictEqual((await post(c, { action: 'defer', text: '' })).json.field, 'text');
  assert.strictEqual((await post(c, { action: 'defer', text: 'Funds not ready, wants May' })).status, 200);
  const intake = (await fu('GET', '/api/followup')).json.intake;
  s = await of(c);
  assert.strictEqual(s.stage, 'Defer'); assert.strictEqual(s.state, 'defer');
  const cNotes = (await admin('GET', `/api/cards/${c}`)).json.card.notes;
  assert.ok(cNotes.some((n) => n.kind === 'stage' && n.text === `Moved to Defer · Deferred from ${/intake/i.test(intake) ? intake : `${intake} intake`}`), JSON.stringify(cNotes));

  // Withdrawn: a reason is needed; the stage moves, the timeline says why, and the team still sees the student.
  assert.strictEqual((await post(d, { action: 'withdraw', text: 'Joined another office' })).json.field, 'reason');
  assert.strictEqual((await post(d, { action: 'withdraw', text: 'Joined another office', reason: 'Chose another consultancy' })).status, 200);
  s = await of(d);
  assert.strictEqual(s.stage, 'Withdrawn'); assert.strictEqual(s.state, 'out'); assert.match(s.words, /Chose another consultancy/);
  assert.ok((await admin('GET', `/api/cards/${d}`)).json.card.notes.some((n) => n.text === 'Moved to Withdrawn · Why: Chose another consultancy'));
  assert.strictEqual((await fu('GET', `/api/cards/${d}`)).status, 200, 'the team opens the card of a student it withdrew');

  // Courses assigned to the Application Team move the student to Application Stage; the team keeps the student, view only.
  const o = (await fu('POST', `/api/cards/${a}/options`, { university: 'Made-up University', course: 'MSc Business' })).json.option;
  assert.ok(o, 'the team shortlists a course');
  const sent = await fu('POST', `/api/cards/${a}/options/send`, { ids: [o.id], partners: { [o.id]: 'Direct' } });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
  const row = (await admin('GET', '/api/data')).json.sheets[0].rows.find((r) => r._id === a);
  assert.strictEqual(row['APPLICATION STATUS'], 'Application Stage');
  s = await of(a);
  assert.strictEqual(s.state, 'sent'); assert.strictEqual(s.canNote, false); assert.strictEqual(s.canTag, false);
  assert.strictEqual((await fu('GET', `/api/cards/${a}`)).status, 200, 'the card opens');
  assert.strictEqual((await post(a, { action: 'note', text: 'x', next: day(2) })).status, 403, 'view only');
  assert.ok((await admin('GET', `/api/cards/${a}`)).json.card.notes.some((n) => n.kind === 'stage' && n.text === 'Moved to Application Stage'));

  // Events and Today use the same rule: a plain card note with no date asks for one.
  await admin('POST', `/api/cards/${b}/notes`, { kind: 'note', text: 'Spoke at last' });
  s = await of(b);
  assert.strictEqual(s.state, 'due'); assert.strictEqual(s.next, null);

  // The next intake: a deferred student moved into it comes back at Inquiry, and the timeline says so.
  const wb = (await admin('GET', '/api/data')).json;
  const first = wb.sheets[0];
  const moved = first.rows.find((r) => r._id === c);
  const second = { id: 'sheet-demo-may', name: 'May 2099', columns: first.columns, rows: [{ ...moved, 'APPLICATION STATUS': 'Inquiry' }], createdAt: new Date().toISOString() };
  const saved = await admin('POST', '/api/data', { sheets: [{ ...first, rows: first.rows.filter((r) => r._id !== c) }, second], activeSheetId: wb.activeSheetId, baseRevision: wb.revision });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  const card = (await admin('GET', `/api/cards/${c}`)).json.card;
  assert.ok(card.notes.some((n) => n.text.startsWith('Moved to May 2099 intake, back at Inquiry')), JSON.stringify(card.notes.map((n) => n.text)));
  assert.strictEqual(card.follow.from, first.name);
});
