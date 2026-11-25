// The Follow-up Team's page, design F1 (the owner, 25 Nov 2026), on the real server. All students and people are made up.
//   - a student another team puts on Hold or Withdraws is listed as Stopped, with why and by whom, and the card opens view only
//   - Bring back needs what changed (and for Inquiry a next follow-up date); only Inquiry or Defer; it is written on the card
//   - a student who moved on shows the university, the step reached and the latest news
//   - a task another team gives to the Follow-up Team reaches the team's task list, wherever the student is
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('design F1: stopped students, Bring back, progress and tasks reach the Follow-up Team', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-f1-'));
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
    return { status: res.status, json, text: tx };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const join = async (username, name, departments) => {
    const made = (await admin('POST', '/api/users', { username, name, email: '', departments })).json;
    const p = person();
    await p('POST', '/api/login', { username, password: made.temporaryPassword });
    await p('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
    return p;
  };
  const fu = await join('ram', 'Ram', ['followup']);
  const app = await join('asha', 'Asha', ['application']);
  const add = async (first, stage) => (await admin('POST', '/api/students/new', { stage, fields: { 'FIRST NAME': first, 'LAST NAME': 'Demo', 'CONTACT NUMBER': `98111${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`, 'UNIVERSITY NAME': 'Made-up University', 'COURSE NAME': 'MSc Business' } })).json.id;
  const held = await add('Manish', 'Application Stage');
  const movedOn = await add('Sunita', 'Application Stage');
  const list = async () => (await fu('GET', '/api/followup')).json.students;
  const of = async (id) => (await list()).find((s) => s.id === id);
  const post = (id, body, who = fu) => who('POST', `/api/followup/${id}`, body);
  const rowOf = async (id) => (await admin('GET', '/api/data')).json.sheets.flatMap((s) => s.rows).find((r) => r._id === id);

  // A task from the Application Team reaches the Follow-up Team, even for a student who is not theirs.
  const task = await app('POST', `/api/cards/${movedOn}/tasks`, { team: 'followup', text: 'Call the family about the deposit' });
  assert.strictEqual(task.status, 200, task.text);
  const mine = (await fu('GET', '/api/tasks')).json.tasks.filter((x) => x.forMe && !x.done);
  assert.ok(mine.some((x) => x.text === 'Call the family about the deposit' && x.studentId === movedOn), 'the task is in the Follow-up list');
  assert.strictEqual((await fu('GET', `/api/cards/${movedOn}`)).status, 200, 'and the card opens');

  // The Application Team puts a student on Hold: the Follow-up Team sees it as Stopped, with by whom, and may bring it back.
  assert.strictEqual(await of(held), undefined, 'an Application Stage student it never had is not listed');
  const data = (await app('GET', '/api/data')).json;
  const sheet = data.sheets[0];
  const saved = await app('POST', '/api/data', { sheets: [{ ...sheet, rows: sheet.rows.map((r) => (r._id === held ? { ...r, 'APPLICATION STATUS': 'Hold' } : r)) }], activeSheetId: data.activeSheetId, baseRevision: data.revision });
  assert.strictEqual(saved.status, 200, saved.text);
  let s = await of(held);
  assert.ok(s, 'the held student is listed');
  assert.strictEqual(s.state, 'out');
  assert.strictEqual(s.canReturn, true);
  assert.strictEqual(s.stopped.by, 'Asha');
  assert.match(s.stopped.team, /Application/);
  assert.strictEqual((await fu('GET', `/api/cards/${held}`)).status, 200, 'the card opens, view only');

  // Bring back: what changed and, for Inquiry, a date after today; never straight to another stage.
  assert.strictEqual((await post(held, { action: 'return', text: '', to: 'Inquiry', next: day(3) })).json.field, 'text');
  assert.strictEqual((await post(held, { action: 'return', text: 'New passport', to: 'Application Stage', next: day(3) })).json.field, 'to');
  assert.strictEqual((await post(held, { action: 'return', text: 'New passport', to: 'Inquiry', next: day(0) })).json.field, 'next');
  assert.strictEqual((await post(held, { action: 'return', text: 'New passport', to: 'Inquiry', next: day(3) }, app)).status, 403, 'only the Follow-up Team');
  assert.strictEqual((await post(held, { action: 'return', text: 'New passport has arrived', to: 'Inquiry', next: day(3) })).status, 200);
  assert.strictEqual((await rowOf(held))['APPLICATION STATUS'], 'Inquiry');
  // The team that stopped the student is told with one task of kind Other, and can open the card.
  const told = (await app('GET', '/api/tasks')).json.tasks.filter((x) => x.forMe && !x.done && x.studentId === held);
  assert.strictEqual(told.length, 1, 'one task, not more');
  assert.strictEqual(told[0].tag, 'other');
  assert.strictEqual(told[0].priority, 'medium');
  assert.match(told[0].text, /^For your information: brought back from Hold to Inquiry\. New passport has arrived/);
  assert.strictEqual((await app('GET', `/api/cards/${held}`)).status, 200);
  s = await of(held);
  assert.strictEqual(s.state, 'ok');
  assert.strictEqual(s.next.date, day(3));
  const notes = (await admin('GET', `/api/cards/${held}`)).json.card.notes;
  assert.ok(notes.some((n) => n.text === 'Brought back from Hold to Inquiry: New passport has arrived'), 'written on the card');
  assert.ok(notes.some((n) => n.kind === 'stage' && /Back from Hold to Inquiry/.test(n.text)), 'and on the timeline');
  assert.strictEqual((await post(held, { action: 'return', text: 'again', to: 'Defer' })).status, 403, 'a student not stopped cannot be brought back');

  // A student who had applied before the Hold keeps the old application day on the sheet, and is still listed after Bring back.
  const applied = await add('Prakash', 'Application Stage');
  const now = (await admin('GET', '/api/data')).json;
  const withDay = { ...now.sheets[0], rows: now.sheets[0].rows.map((r) => (r._id === applied ? { ...r, 'APPLICATION SUBMISSION DATE': day(-10), 'APPLICATION STATUS': 'Hold' } : r)) };
  assert.strictEqual((await admin('POST', '/api/data', { sheets: [withDay, ...now.sheets.slice(1)], activeSheetId: now.activeSheetId, baseRevision: now.revision })).status, 200);
  assert.strictEqual((await of(applied)).state, 'out');
  assert.strictEqual((await post(applied, { action: 'return', text: 'Ready again', to: 'Inquiry', next: day(2) })).status, 200);
  assert.strictEqual((await of(applied)).state, 'ok', 'still in the list, followed up, with the next date');

  // Withdrawn by the Follow-up Team keeps its reason, and Bring back to Defer clears it.
  assert.strictEqual((await post(held, { action: 'withdraw', text: 'Joined another office', reason: 'Chose another consultancy' })).status, 200);
  s = await of(held);
  assert.match(s.stopped.why, /Chose another consultancy/);
  assert.strictEqual((await post(held, { action: 'return', text: 'Came back to us', to: 'Defer' })).status, 200);
  assert.strictEqual((await rowOf(held))['APPLICATION STATUS'], 'Defer');
  assert.strictEqual((await admin('GET', `/api/cards/${held}`)).json.card.profile.lostReason || '', '');
  assert.strictEqual((await app('GET', '/api/tasks')).json.tasks.filter((x) => x.forMe && !x.done && x.studentId === held).length, 1, 'the Follow-up Team\'s own stop tells nobody');
  const Fields = require('../student-details/card-fields');
  assert.strictEqual(Fields.guessTaskTag('Call the family about the deposit', 'followup', 'Payment Stage'), 'other');
  assert.strictEqual(Fields.guessTaskTag('Pay the deposit', 'application', 'Payment Stage'), 'payment', 'other teams as before');

  // A student who moved on shows where they stand.
  const inq = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Bikash', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9811100001' } })).json.id;
  const o = (await fu('POST', `/api/cards/${inq}/options`, { university: 'North Made-up University', course: 'BSc Computing' })).json.option;
  assert.strictEqual((await fu('POST', `/api/cards/${inq}/options/send`, { ids: [o.id], partners: { [o.id]: 'Direct' } })).status, 200);
  s = await of(inq);
  assert.strictEqual(s.state, 'sent');
  assert.strictEqual(s.progress.university, 'North Made-up University');
  assert.strictEqual(s.progress.course, 'BSc Computing');
  assert.strictEqual(s.progress.step, 0);
  assert.match(s.progress.latest.text, /1 course with the Application Team/);
});
