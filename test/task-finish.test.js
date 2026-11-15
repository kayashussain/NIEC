// Finishing a task fills in the student by itself (the owner, 15 Nov 2026): an Application task writes Application submitted (only
// when empty; a second application stays in the notes), a NOC task writes NOC (Pending or Submitted) and NOC Number, a Mock task
// writes the next Mock Schedule and gives the team "Write the feedback" on that day, a Medical task books the test (Booked, then
// Received on the day by itself, unless booked again). Every answer is also a note on the student. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('finishing a task fills in the sheet and the notes', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-finish-'));
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

  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Gita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000071', 'UNIVERSITY NAME': 'Example University' } })).json.id;
  const today = (await admin('GET', '/api/tasks')).json.today;
  const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const give = async (text, tag) => (await admin('POST', `/api/cards/${id}/tasks`, { team: 'application', text, tag })).json.card.tasks.find((x) => x.text === text).id;
  const finish = (tid, f) => app('POST', `/api/cards/${id}/tasks/${tid}`, { done: true, finish: f });
  const row = async () => (await admin('GET', `/api/cards/${id}`)).json.student.row;
  const notes = async () => (await admin('GET', `/api/cards/${id}`)).json.card.notes.map((n) => n.text);

  // Application: the date goes to the sheet; a second application only to the notes.
  const a1 = await give('Submit to Example University', 'application');
  assert.strictEqual((await finish(a1, { submitted: true, date: add(2) })).status, 400, 'not a day still to come');
  assert.strictEqual((await finish(a1, { submitted: true, date: add(-1), university: 'Example University', note: 'MSc Data Science, ID 55501' })).status, 200);
  assert.strictEqual((await row())['APPLICATION SUBMISSION DATE'], add(-1));
  assert.match((await notes()).join('\n'), /Application submitted on .* to Example University\. MSc Data Science, ID 55501\./);
  const a2 = await give('Submit a backup option', 'application');
  assert.strictEqual((await finish(a2, { submitted: true, date: today, university: 'Backup University' })).status, 200);
  assert.strictEqual((await row())['APPLICATION SUBMISSION DATE'], add(-1), 'the first date stays');
  assert.match((await notes()).join('\n'), /to Backup University\. \(Another application: the first was submitted on/);
  // Both applications are in the student's University options with their own dates.
  const opts = (await admin('GET', `/api/cards/${id}`)).json.card.options.map((o) => [o.university, o.applied]);
  assert.deepStrictEqual(opts.sort(), [['Backup University', today], ['Example University', add(-1)]]);

  // NOC: Pending, then Submitted with its number.
  const n1 = await give('Make the NOC account', 'noc');
  assert.strictEqual((await finish(n1, { noc: 'maybe' })).status, 400);
  assert.strictEqual((await finish(n1, { noc: 'Pending', note: 'Account created' })).status, 200);
  assert.strictEqual((await row()).NOC, 'Pending');
  const n2 = await give('Submit the NOC', 'noc');
  assert.strictEqual((await finish(n2, { noc: 'Submitted', nocNumber: 'NOC-778' })).status, 200);
  assert.deepStrictEqual([(await row()).NOC, (await row())['NOC NUMBER']], ['Submitted', 'NOC-778']);

  // Mock: the next empty Mock Schedule, and the feedback reminder waiting for that day.
  const m1 = await give('Set the first mock', 'mock');
  assert.strictEqual((await finish(m1, { scheduled: true, date: add(3), remind: true })).status, 200);
  assert.strictEqual((await row())['MOCK SCHEDULE 1'], add(3));
  const rem = (await admin('GET', `/api/cards/${id}`)).json.card.tasks.find((x) => /Write the feedback of mock interview 1/.test(x.text));
  assert.ok(rem && rem.doOn === add(3) && rem.team === 'application' && !rem.done, 'the reminder waits for the day');

  // Medical: booked (Booked on the sheet), booked again for another day, then received by itself on the day.
  const d1 = await give('Book the medical test', 'medical');
  assert.strictEqual((await finish(d1, { medical: 'booked' })).status, 400, 'the day is needed');
  assert.strictEqual((await finish(d1, { medical: 'booked', date: add(5), place: 'IOM Kathmandu' })).status, 200);
  assert.strictEqual((await row())['MEDICAL REPORT'], 'Booked');
  assert.strictEqual((await admin('GET', `/api/cards/${id}`)).json.card.medical.date, add(5));
  const d2 = await give('Book the medical test again', 'medical');
  assert.strictEqual((await finish(d2, { medical: 'booked', date: today, place: 'IOM Kathmandu' })).status, 200, 'booked again, for today');
  assert.strictEqual((await row())['MEDICAL REPORT'], 'Received', 'a test on a day already come counts as received');
  assert.match((await notes()).join('\n'), /Medical test booked for .* at IOM Kathmandu\./);

  // Payment: Payment Date and the first empty deposit; Visa and CAS: the step's date, and the stage moves on (never back).
  const p1 = await give('Collect the deposit', 'payment');
  assert.strictEqual((await finish(p1, { paid: true, date: today, amount: '5,000' })).status, 200);
  assert.deepStrictEqual([(await row())['PAYMENT DATE'], (await row())['TUITION FEE DEPOSIT(1st Installment)']], [today, '5000']);
  const p2 = await give('Collect the second payment', 'payment');
  assert.strictEqual((await finish(p2, { paid: true, date: today, amount: '3000' })).status, 200);
  assert.strictEqual((await row())['TUITION FEE DEPOSIT(2nd Installment)'], '3000', 'the next installment');
  const v1 = await give('Get the CAS', 'visa');
  assert.strictEqual((await finish(v1, { step: 'casReceived', date: today })).status, 200);
  assert.deepStrictEqual([(await row())['CAS RECEIVED DATE'], (await row())['APPLICATION STATUS']], [today, 'CAS Issued']);
  const v2 = await give('Ask for the CAS again', 'visa');
  assert.strictEqual((await finish(v2, { step: 'casRequested', date: today })).status, 200);
  assert.strictEqual((await row())['APPLICATION STATUS'], 'CAS Issued', 'the stage never moves back');
  assert.match((await notes()).join('\n'), /CAS received on .*\. Stage moved to CAS Issued\./);

  // Guards: a NOC already Submitted never goes back to Pending; the sheet's Remarks shows the latest progress line, but a remark a
  // person typed is never overwritten.
  const n3 = await give('Check the NOC', 'noc');
  assert.strictEqual((await finish(n3, { noc: 'Pending' })).status, 200);
  assert.strictEqual((await row()).NOC, 'Submitted', 'never back to Pending');
  assert.match((await row()).REMARKS, /NOC submitted/, 'Remarks shows the latest progress');
  const wb = (await admin('GET', '/api/data')).json;
  wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) r.REMARKS = 'Typed by the counsellor'; }));
  assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId })).status, 200);
  const o2 = await give('Send the checklist', 'documents');
  assert.strictEqual((await finish(o2, { note: 'Checklist sent on WhatsApp' })).status, 200);
  assert.strictEqual((await row()).REMARKS, 'Typed by the counsellor', 'a typed remark stays');
  assert.match((await notes()).join('\n'), /Checklist sent on WhatsApp/);
  // An application cannot be submitted after the offer on the sheet.
  const id2 = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000072' } })).json.id;
  const wb2 = (await admin('GET', '/api/data')).json;
  wb2.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id2) r['OFFER RECEIVED DATE'] = add(-5); }));
  await admin('POST', '/api/data', { baseRevision: wb2.revision, sheets: wb2.sheets, activeSheetId: wb2.activeSheetId });
  const late = (await admin('POST', `/api/cards/${id2}/tasks`, { team: 'application', text: 'Submit late', tag: 'application' })).json.card.tasks[0].id;
  assert.strictEqual((await app('POST', `/api/cards/${id2}/tasks/${late}`, { done: true, finish: { submitted: true, date: today } })).status, 400, 'not after the offer');

  // A task with no answers is simply done, as before; the Application Team may now fill in the Medical Report on the sheet.
  const o1 = await give('Call the student', 'other');
  assert.strictEqual((await app('POST', `/api/cards/${id}/tasks/${o1}`, { done: true })).status, 200);
  const Teams = require('../shared/teams');
  assert.ok(Teams.DEPARTMENTS.application.editable.has('MEDICAL REPORT'));
});
