// Finishing a task (the owner, 16 Nov 2026): nothing is filled in by itself. The team answers, the answers are shown back (preview)
// and only confirmed answers are written: an Application task writes Application submitted (only when empty; a second application
// stays in University options and the notes), a NOC task writes NOC (Pending or Submitted) and NOC Number, a Mock task writes the next
// Mock Schedule and gives the team "Write the feedback" on that day, a Medical task books the test (Booked, and on that day the team is
// asked whether the report is received). Every answer is also a note on the student. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('finishing a task writes confirmed answers to the sheet and the notes', { timeout: 120000 }, async (t) => {
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
  const finish = (tid, f) => app('POST', `/api/cards/${id}/tasks/${tid}`, { done: true, finish: { next: 'none', ...f, confirmed: true } });
  const row = async () => (await admin('GET', `/api/cards/${id}`)).json.student.row;
  const notes = async () => (await admin('GET', `/api/cards/${id}`)).json.card.notes.map((n) => n.text);

  // Application: the date goes to the sheet; a second application only to the notes.
  const a1 = await give('Submit to Example University', 'application');
  assert.strictEqual((await finish(a1, { submitted: true, date: add(2) })).status, 400, 'not a day still to come');
  assert.strictEqual((await finish(a1, { submitted: true, date: add(-1), university: 'Example University' })).status, 400, 'the course must be named');
  assert.strictEqual((await finish(a1, { submitted: true, date: add(-1), university: 'Example University', course: 'MSc Data Science', note: 'MSc Data Science, ID 55501' })).status, 200);
  assert.strictEqual((await row())['APPLICATION SUBMISSION DATE'], add(-1));
  assert.match((await notes()).join('\n'), /^On .*: applied to Example University \(MSc Data Science\)\. MSc Data Science, ID 55501\./m);
  const a2 = await give('Submit a backup option', 'application');
  assert.strictEqual((await finish(a2, { submitted: true, date: today, university: 'Backup University', course: 'MSc Backup' })).status, 200);
  assert.strictEqual((await row())['APPLICATION SUBMISSION DATE'], add(-1), 'the first date stays');
  assert.match((await notes()).join('\n'), /^On .*: applied to Backup University \(MSc Backup\)\./m);
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

  // Medical: booked (Booked on the sheet, and "is the report received?" waiting for that day), booked again; never Received by itself.
  const d1 = await give('Book the medical test', 'medical');
  assert.strictEqual((await finish(d1, { medical: 'booked' })).status, 400, 'the day is needed');
  assert.strictEqual((await finish(d1, { medical: 'booked', date: add(5), place: 'IOM Kathmandu' })).status, 200);
  assert.strictEqual((await row())['MEDICAL REPORT'], 'Booked');
  assert.strictEqual((await admin('GET', `/api/cards/${id}`)).json.card.medical.date, add(5));
  const d2 = await give('Book the medical test again', 'medical');
  assert.strictEqual((await finish(d2, { medical: 'booked', date: today, place: 'IOM Kathmandu' })).status, 200, 'booked again, for today');
  assert.strictEqual((await row())['MEDICAL REPORT'], 'Booked', 'never Received by itself, even on the day');
  const ask = (await admin('GET', `/api/cards/${id}`)).json.card.tasks.filter((x) => /is the report received\?/.test(x.text));
  assert.ok(ask.length === 2 && ask.some((x) => x.doOn === add(5)) && ask.some((x) => !x.doOn), 'the team is asked on the day of each booking');
  assert.match((await notes()).join('\n'), /Medical test booked for .* at IOM Kathmandu\./);

  // The team's report: finishing "is the report received?" never makes the same task again (18 Nov 2026), whichever way it is answered.
  const openReports = async () => (await admin('GET', `/api/cards/${id}`)).json.card.tasks.filter((x) => /is the report received\?/.test(x.text) && !x.done);
  const rc5 = ask.find((x) => x.doOn === add(5));
  assert.strictEqual((await finish(rc5.id, { medical: 'booked', date: add(5), place: 'iom kathmandu' })).status, 200, 'booked again for the same day');
  assert.deepStrictEqual((await openReports()).map((x) => x.id), [ask.find((x) => !x.doOn).id], 'no twin of the finished report task');
  const rcToday = ask.find((x) => !x.doOn);
  assert.strictEqual((await finish(rcToday.id, { medical: 'waiting', note: 'Report not out yet.' })).status, 200, 'not received yet');
  assert.deepStrictEqual(await openReports(), [], 'finished means finished: nothing comes back');
  assert.strictEqual((await row())['MEDICAL REPORT'], 'Booked', 'still Booked, never Received by itself');
  assert.match((await notes()).join('\n'), /Medical report not received yet/);
  // A new day is a real new booking and does ask again.
  const d3 = await give('Rebook the medical test', 'medical');
  assert.strictEqual((await finish(d3, { medical: 'booked', date: add(9), place: 'Norvic' })).status, 200);
  const again = (await openReports())[0];
  assert.ok(again && again.doOn === add(9));
  assert.strictEqual((await finish(again.id, { medical: 'booked', date: add(9), place: 'Norvic Hospital' })).status, 200);
  assert.deepStrictEqual(await openReports(), [], 'the same day with another spelling of the place is still the same booking');
  assert.strictEqual((await finish(await give('Check the report', 'medical'), { medical: 'received' })).status, 200);

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
  assert.strictEqual((await app('POST', `/api/cards/${id2}/tasks/${late}`, { done: true, finish: { submitted: true, date: today, confirmed: true } })).status, 400, 'not after the offer');

  // The owner's case (15 Nov 2026): a student applied to one university, with an offer, now applies to three more at once.
  const tId = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Tara', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000073' } })).json.id;
  const wbT = (await admin('GET', '/api/data')).json;
  wbT.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === tId) Object.assign(r, { 'UNIVERSITY NAME': 'First University', 'COURSE NAME': 'BSc Adult Nursing', 'APPLICATION SUBMISSION DATE': add(-30), 'OFFER RECEIVED DATE': add(-5) }); }));
  await admin('POST', '/api/data', { baseRevision: wbT.revision, sheets: wbT.sheets, activeSheetId: wbT.activeSheetId });
  const giveT = async (text, tag) => (await admin('POST', `/api/cards/${tId}/tasks`, { team: 'application', text, tag })).json.card.tasks.find((x) => x.text === text).id;
  const finishT = (tid, f) => app('POST', `/api/cards/${tId}/tasks/${tid}`, { done: true, finish: { next: 'none', ...f, confirmed: true } });
  const rowT = async () => (await admin('GET', `/api/cards/${tId}`)).json.student.row;
  const cardT = async () => (await admin('GET', `/api/cards/${tId}`)).json.card;
  const t1 = await giveT('Apply to three more', 'application');
  assert.strictEqual((await finishT(t1, { app: 'submitted', date: today, unis: [{ university: 'Second University', course: 'BSc Adult Nursing' }, { university: 'Third University', course: 'BSc Adult Nursing' }, { university: 'Fourth University', course: 'BSc Adult Nursing' }], note: 'Backup options' })).status, 200);
  const r = await rowT();
  assert.deepStrictEqual([r['UNIVERSITY NAME'], r['APPLICATION SUBMISSION DATE'], r['OFFER RECEIVED DATE']], ['First University', add(-30), add(-5)], 'the sheet keeps the first application');
  const optsT = (await cardT()).options.map((o) => [o.university, o.course, o.applied]).sort();
  assert.deepStrictEqual(optsT, [['First University', 'BSc Adult Nursing', add(-30)], ['Fourth University', 'BSc Adult Nursing', today], ['Second University', 'BSc Adult Nursing', today], ['Third University', 'BSc Adult Nursing', today]], 'each university its own line, the first one too');
  assert.strictEqual((await cardT()).options.find((o) => o.university === 'First University').offer, add(-5));
  assert.match((await cardT()).notes.map((n) => n.text).join('\n'), /applied to Second University, Third University and Fourth University \(BSc Adult Nursing\)\. Backup options\./);
  // An offer from a backup university: in its option and the notes, the sheet's offer stays.
  const t2 = await giveT('Chase the offers', 'application');
  assert.strictEqual((await finishT(t2, { app: 'offer', date: today, unis: [{ university: 'Third University' }] })).status, 200);
  assert.strictEqual((await rowT())['OFFER RECEIVED DATE'], add(-5));
  assert.strictEqual((await cardT()).options.find((o) => o.university === 'Third University').offer, today);
  const t3 = await giveT('Check the last one', 'application');
  assert.strictEqual((await finishT(t3, { app: 'refused', date: today, unis: [{ university: 'Fourth University' }] })).status, 400, 'a refusal says why');
  assert.strictEqual((await finishT(t3, { app: 'refused', date: today, unis: [{ university: 'Fourth University' }], note: 'Did not meet the entry grade.' })).status, 200);
  assert.strictEqual((await cardT()).options.find((o) => o.university === 'Fourth University').refused, today);
  assert.strictEqual((await finishT(await giveT('No name', 'application'), { app: 'offer', date: today, unis: [] })).status, 400, 'an offer names the university');
  // Needed to track the student (18 Nov 2026): a payment names its amount, a submitted NOC its number, a booked test its place, and every
  // course given to the team gets an answer, a "not submitted" or refusal saying why.
  assert.strictEqual((await finishT(await giveT('Collect', 'payment'), { paid: true, date: today })).status, 400, 'a payment needs its amount');
  assert.strictEqual((await finishT(await giveT('Submit the NOC', 'noc'), { noc: 'Submitted' })).status, 400, 'a submitted NOC needs its number');
  assert.strictEqual((await finishT(await giveT('Book the test', 'medical'), { medical: 'booked', date: add(4) })).status, 400, 'a booked test needs its place');
  const wbA = (await admin('GET', '/api/data')).json;
  assert.ok(wbA.sheets.some((sh) => sh.rows.some((x) => x._id === tId)));
  const optIds = [];
  for (const [u, c] of [['Fifth University', 'BSc Nursing'], ['Sixth University', 'BSc Midwifery']]) { const o = (await admin('POST', `/api/cards/${tId}/options`, { university: u, course: c })).json; optIds.push(o.card.options.find((x) => x.university === u).id); }
  assert.strictEqual((await admin('POST', `/api/cards/${tId}/options/send`, { ids: optIds, partners: Object.fromEntries(optIds.map((i) => [i, 'Direct'])) })).status, 200);
  const tA = await giveT('Apply to the two given', 'application');
  const sentNow = (await cardT()).options.filter((o) => o.sent && !o.applied);
  assert.strictEqual(sentNow.length, 2, 'two courses were given to the team');
  if (sentNow.length) {
    assert.strictEqual((await finishT(tA, { app: 'record', date: today, unis: [{ university: 'Fifth University', course: 'BSc Nursing', what: 'submitted' }] })).status, 400, 'every course given to the team needs an answer');
    assert.strictEqual((await finishT(tA, { app: 'none', note: 'Nothing happened this week.' })).status, 400, 'nothing to record is not an answer while courses wait');
    assert.strictEqual((await finishT(tA, { app: 'record', date: today, unis: [{ university: 'Fifth University', course: 'BSc Nursing', what: 'submitted' }, { university: 'Sixth University', course: 'BSc Midwifery', what: 'notsubmitted' }] })).status, 400, 'not submitted says why');
    assert.strictEqual((await finishT(tA, { app: 'record', date: today, note: 'Not eligible: IELTS below 6.5.', unis: [{ university: 'Fifth University', course: 'BSc Nursing', what: 'submitted' }, { university: 'Sixth University', course: 'BSc Midwifery', what: 'notsubmitted' }] })).status, 200);
    const sixth = (await cardT()).options.find((o) => o.university === 'Sixth University');
    assert.ok(sixth && sixth.skipped && /Not eligible/.test(sixth.reason), 'the not-submitted course is kept with its reason, so it is not given again');
  }
  // Mock: the feedback of a mock held goes to its Feedback column; the Pre-CAS result to Pre-CAS Interview.
  const mT1 = await giveT('Set the mock', 'mock');
  assert.strictEqual((await finishT(mT1, { mock: 'set', date: today, remind: true })).status, 200);
  const fbTask = (await cardT()).tasks.find((x) => /Write the feedback of mock interview 1/.test(x.text));
  assert.ok(fbTask, 'the reminder');
  assert.strictEqual((await finishT(fbTask.id, { mock: 'feedback', slot: 1, feedback: 'Confident answers' })).status, 200);
  assert.strictEqual((await rowT())['FEEDBACK 1'], 'Confident answers');
  const mT2 = await giveT('Pre-CAS interview', 'mock');
  assert.strictEqual((await finishT(mT2, { mock: 'precas', result: 'Maybe' })).status, 400);
  assert.strictEqual((await finishT(mT2, { mock: 'precas', result: 'Passed' })).status, 200);
  assert.strictEqual((await rowT())['PRE CAS INTERVIEW'], 'Passed');
  // Visa refused: the stage goes to Visa Rejected.
  const v3 = await giveT('Visa decision', 'visa');
  assert.strictEqual((await finishT(v3, { step: 'refused', date: today })).status, 400, 'a refusal says why');
  assert.strictEqual((await finishT(v3, { step: 'refused', date: today, note: 'Refused: funds not shown for 28 days.' })).status, 200);
  assert.strictEqual((await rowT())['APPLICATION STATUS'], 'Visa Rejected');

  // A task with no answers is simply done, as before; the Application Team may now fill in the Medical Report on the sheet.
  const o1 = await give('Call the student', 'other');
  assert.strictEqual((await app('POST', `/api/cards/${id}/tasks/${o1}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200);
  const Teams = require('../shared/teams');
  assert.ok(Teams.DEPARTMENTS.application.editable.has('MEDICAL REPORT'));
});
