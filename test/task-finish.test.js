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

  // NOC: Pending, then Received (no day and no number needed; an older "Submitted" counts as Received).
  const n1 = await give('Make the NOC account', 'noc');
  assert.strictEqual((await finish(n1, { noc: 'maybe' })).status, 400);
  assert.strictEqual((await finish(n1, { noc: 'Pending', note: 'Account created' })).status, 200);
  assert.strictEqual((await row()).NOC, 'Pending');
  const n2 = await give('Submit the NOC', 'noc');
  assert.strictEqual((await finish(n2, { noc: 'Received' })).status, 200);
  assert.strictEqual((await row()).NOC, 'Received');

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
  // A team records a payment only once there is an offer, and visa steps follow the journey (Payment Stage, then CAS Stage, CAS Issued ...).
  const pEarly = await give('Collect the deposit early', 'payment');
  assert.strictEqual((await finish(pEarly, { paid: true, date: today, amount: '5000' })).status, 400, 'no offer recorded yet');
  const vEarly = await give('Get the CAS too early', 'visa');
  assert.strictEqual((await finish(vEarly, { step: 'casReceived', date: today })).status, 400, 'visa steps start at Payment Stage');
  {
    const wbP = (await admin('GET', '/api/data')).json;
    wbP.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) Object.assign(r, { 'OFFER RECEIVED DATE': add(-3), 'APPLICATION STATUS': 'Payment Stage' }); }));
    assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wbP.revision, sheets: wbP.sheets, activeSheetId: wbP.activeSheetId })).status, 200);
  }
  const p1 = await give('Collect the deposit', 'payment');
  assert.strictEqual((await finish(p1, { paid: true, date: today, amount: '5,000' })).status, 200);
  assert.deepStrictEqual([(await row())['PAYMENT DATE'], (await row())['TUITION FEE DEPOSIT(1st Installment)']], [today, '5000']);
  const p2 = await give('Collect the second payment', 'payment');
  assert.strictEqual((await finish(p2, { paid: true, date: today, amount: '3000' })).status, 200);
  assert.strictEqual((await row())['TUITION FEE DEPOSIT(2nd Installment)'], '3000', 'the next installment');
  const vReq = await give('Ask for the CAS', 'visa');
  assert.strictEqual((await finish(vReq, { step: 'casRequested', date: add(-1) })).status, 200);
  assert.strictEqual((await row())['APPLICATION STATUS'], 'CAS Stage', 'requesting the CAS moves the student to CAS Stage');
  assert.strictEqual((await finish(await give('Visa too soon', 'visa'), { step: 'visa', date: today })).status, 400, 'no jumping over the steps in between');
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
  assert.strictEqual((await row()).NOC, 'Received', 'never back to Pending');
  assert.match((await row()).REMARKS, /NOC received/, 'Remarks shows the latest progress');
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
  // Submitting an application starts its own "Offer request" task (the owner, 18 Nov 2026): once for each university applied to, never twice.
  const tasksOf = async () => (await cardT()).tasks;
  const offerTasks = async () => (await tasksOf()).filter((x) => /^Offer request: has the student received the offer letter from/.test(x.text));
  const before = (await offerTasks()).length;
  const o1T = await giveT('Apply to Offer Test University', 'application');
  const pv = (await app('POST', `/api/cards/${tId}/tasks/${o1T}`, { done: true, preview: true, finish: { next: 'none', app: 'record', date: today, unis: [{ university: 'Offer Test University', course: 'BSc Offer', what: 'submitted' }] } })).json.preview;
  assert.ok(pv.offerTasks && /Offer Test University \(BSc Offer\)/.test(pv.offerTasks[0]), 'the check says the offer request task will be made');
  assert.strictEqual((await finishT(o1T, { app: 'record', date: today, unis: [{ university: 'Offer Test University', course: 'BSc Offer', what: 'submitted' }] })).status, 200);
  const madeOffer = (await offerTasks()).filter((x) => /Offer Test University/.test(x.text));
  assert.strictEqual(madeOffer.length, 1, 'one offer request task');
  assert.deepStrictEqual([madeOffer[0].team, madeOffer[0].done], ['application', false]);
  assert.strictEqual((await offerTasks()).length, before + 1);
  assert.strictEqual(madeOffer[0].tag, 'offer', 'its own category: Offer request');
  // Finishing the Offer request with the university's answer records the offer (no courses given to the team are asked about there).
  assert.strictEqual((await finishT(madeOffer[0].id, { app: 'record', date: today, unis: [{ university: 'Offer Test University', course: 'BSc Offer', what: 'conditional' }] })).status, 200);
  assert.strictEqual((await cardT()).options.find((o) => o.university === 'Offer Test University').offer, today);
  assert.strictEqual((await app('POST', `/api/cards/${tId}/tasks/${madeOffer[0].id}`, { done: false, finish: { revert: true } })).status, 200);
  // Reopening the application task and putting back what it wrote takes the offer request task away again.
  assert.strictEqual((await app('POST', `/api/cards/${tId}/tasks/${o1T}`, { done: false, finish: { revert: true } })).status, 200);
  assert.strictEqual((await offerTasks()).filter((x) => /Offer Test University/.test(x.text)).length, 0, 'put back with the task');
  // Each line has its own day (18 Nov 2026): Middlesex applied today, West London applied weeks ago and already holding an offer. They are not
  // the same day, and the application day of West London is recorded without a second offer request.
  const wlSheet = (await rowT());
  const mT = await giveT('Apply to Middlesex', 'application');
  const wlDay = add(-20);
  assert.strictEqual((await finishT(mT, { app: 'record', unis: [{ university: 'Middlesex University', course: 'BSc Nursing', what: 'submitted', date: today }, { university: 'West London Test University', course: 'BSc Nursing', what: 'submitted', date: wlDay }] })).status, 200);
  const optsDay = Object.fromEntries((await cardT()).options.map((o) => [o.university, o.applied]));
  assert.strictEqual(optsDay['Middlesex University'], today);
  assert.strictEqual(optsDay['West London Test University'], wlDay, 'its own, earlier day');
  assert.match((await cardT()).notes.map((n) => n.text).join('\n'), /applied to Middlesex University \(BSc Nursing\) on .*; applied to West London Test University \(BSc Nursing\) on /i);
  assert.ok(wlSheet);
  // The university that already gave an offer (no application day recorded): its application day is added, before the offer, and no offer
  // request is made for it.
  await admin('POST', `/api/cards/${tId}/options`, { university: 'West London Offer University', course: 'BSc Midwifery', offer: add(-10), offerType: 'Conditional' });
  const mW = await giveT('Record the West London application', 'application');
  assert.strictEqual((await finishT(mW, { app: 'record', unis: [{ university: 'West London Offer University', course: 'BSc Midwifery', what: 'submitted', date: add(-5) }] })).status, 400, 'the application cannot be after its own offer');
  assert.strictEqual((await finishT(mW, { app: 'record', unis: [{ university: 'West London Offer University', course: 'BSc Midwifery', what: 'submitted', date: add(-25) }] })).status, 200);
  const wo = (await cardT()).options.find((o) => o.university === 'West London Offer University');
  assert.deepStrictEqual([wo.applied, wo.offer], [add(-25), add(-10)], 'application day added, offer kept');
  assert.ok(!(await tasksOf()).some((x) => /Offer request: .*West London Offer University/.test(x.text)), 'no offer request for a university that already gave its offer');
  // Needed to track the student (18 Nov 2026): a payment names its amount, a submitted NOC its number, a booked test its place, and every
  // course given to the team gets an answer, a "not submitted" or refusal saying why.
  assert.strictEqual((await finishT(await giveT('Collect', 'payment'), { paid: true, date: today })).status, 400, 'a payment needs its amount');
  assert.strictEqual((await finishT(await giveT('Book the test', 'medical'), { medical: 'booked', date: add(4) })).status, 200, 'a booked test needs only its day');
  assert.strictEqual((await rowT())['MEDICAL REPORT'], 'Booked');
  assert.strictEqual((await finishT(await giveT('Medical not booked', 'medical'), { medical: 'pending' })).status, 200);
  assert.strictEqual((await rowT())['MEDICAL REPORT'], 'Pending');
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
  // A tracking task closed with words only records nothing: the student then needs a next step with a real day, never "Not needed".
  {
    // With other tasks still open for the student, words alone are enough (nobody is left without a next step).
    const g = await giveT('Check on the NOC', 'noc');
    assert.strictEqual((await finishT(g, { note: 'Spoke to the student, ok' })).status, 200, 'other tasks are still open: words only are enough');
    // No follow-up question for any task (the owner, 18 Nov 2026): even the student's last open task closes with words only.
    const solo = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Solo', 'LAST NAME': 'Task', 'CONTACT NUMBER': '9800000099' } })).json.id;
    const soloTask = (await admin('POST', `/api/cards/${solo}/tasks`, { team: 'application', text: 'Check on the NOC', tag: 'noc' })).json.card.tasks[0].id;
    const soloFinish = (f) => app('POST', `/api/cards/${solo}/tasks/${soloTask}`, { done: true, finish: { next: 'none', ...f, confirmed: true } });
    assert.strictEqual((await soloFinish({ note: 'Spoke to the student, ok' })).status, 200, 'the last open task, words only, no next day asked');
    // A Mock task asks no follow-up day: words are enough, even as the last open task, and none is made.
    const solo4 = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Mock', 'LAST NAME': 'Only', 'CONTACT NUMBER': '9800000096' } })).json.id;
    const mockT = (await admin('POST', `/api/cards/${solo4}/tasks`, { team: 'application', text: 'Ask the university for the mock feedback', tag: 'mock' })).json.card.tasks[0].id;
    assert.strictEqual((await app('POST', `/api/cards/${solo4}/tasks/${mockT}`, { finishState: true })).json.state.needsNext, undefined, 'no follow-up question is asked');
    assert.strictEqual((await app('POST', `/api/cards/${solo4}/tasks/${mockT}`, { done: true, finish: { note: 'Asked for the feedback.', confirmed: true } })).status, 200);
    assert.strictEqual((await admin('GET', `/api/cards/${solo4}`)).json.card.tasks.filter((x) => !x.done).length, 0, 'no follow-up task was made');
    // A task tagged Application that is not about an application ("ask the university for the mock feedback"): the person says so, and words are
    // enough, even as the last open task, with no follow-up needed (the owner, 18 Nov 2026).
    const solo2 = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Feedback', 'LAST NAME': 'Task', 'CONTACT NUMBER': '9800000098' } })).json.id;
    const fbTask = (await admin('POST', `/api/cards/${solo2}/tasks`, { team: 'application', text: 'Mock interview given for Roehampton to TOR. Ask for the feedback.', tag: 'application' })).json.card.tasks[0].id;
    const fbFinish = (f) => app('POST', `/api/cards/${solo2}/tasks/${fbTask}`, { done: true, finish: { next: 'none', ...f, confirmed: true } });
    assert.strictEqual((await fbFinish({ note: 'Asked TOR for the feedback.', generic: true })).status, 200, 'said not to be about an application: words are enough');
  }
  // A student who has withdrawn gets no new applications from a team; removing the "Apply for" task puts its courses back on the Shortlist.
  {
    const setStage = async (stage) => { const w = (await admin('GET', '/api/data')).json; w.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === tId) r['APPLICATION STATUS'] = stage; })); assert.strictEqual((await admin('POST', '/api/data', { baseRevision: w.revision, sheets: w.sheets, activeSheetId: w.activeSheetId })).status, 200); };
    const was = (await rowT())['APPLICATION STATUS'];
    await setStage('Withdrawn');
    assert.strictEqual((await finishT(await giveT('Apply after withdrawing', 'application'), { app: 'record', date: today, unis: [{ university: 'Late University', course: 'BSc Late', what: 'submitted' }] })).status, 400, 'no applications for a withdrawn student');
    await setStage(was);
    const o7 = (await admin('POST', `/api/cards/${tId}/options`, { university: 'Seventh University', course: 'BSc Seven' })).json.card.options.find((x) => x.university === 'Seventh University').id;
    assert.strictEqual((await admin('POST', `/api/cards/${tId}/options/send`, { ids: [o7], partners: { [o7]: 'Direct' } })).status, 200);
    const applyTask = (await cardT()).tasks.find((x) => /^Apply to Seventh University/.test(x.text) && !x.done);
    assert.ok(applyTask && (await cardT()).options.find((x) => x.id === o7).sent);
    assert.strictEqual((await admin('POST', `/api/cards/${tId}/tasks/${applyTask.id}/delete`, {})).status, 200);
    assert.ok(!(await cardT()).options.find((x) => x.id === o7).sent, 'its course is back on the Shortlist, not held by a task that no longer exists');
  }
  // One task per course, a simple answer (Applied with its day, or Not applied with the reason), no follow-up question, and the Offer request
  // made by itself; the Offer request is answered with the university's reply, or "not yet" with the day to check again (the owner, 18 Nov 2026).
  {
    const solo3 = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Course', 'LAST NAME': 'Tasks', 'CONTACT NUMBER': '9800000097' } })).json.id;
    const cardS = async () => (await admin('GET', `/api/cards/${solo3}`)).json.card;
    const ids3 = [];
    for (const [u, c] of [['Alpha Course University', 'BSc A'], ['Beta Course University', 'BSc B'], ['Gamma Course University', 'BSc C']]) { const o = (await admin('POST', `/api/cards/${solo3}/options`, { university: u, course: c })).json; ids3.push(o.card.options.find((x) => x.university === u).id); }
    assert.strictEqual((await admin('POST', `/api/cards/${solo3}/options/send`, { ids: ids3, partners: Object.fromEntries(ids3.map((i) => [i, 'Direct'])) })).status, 200);
    const applyTasks = (await cardS()).tasks.filter((x) => /^Apply to .* Course University/.test(x.text));
    assert.strictEqual(applyTasks.length, 3, 'three courses, three tasks');
    const fin3 = (tid, f) => app('POST', `/api/cards/${solo3}/tasks/${tid}`, { done: true, finish: { ...f, confirmed: true } });
    const st = (await app('POST', `/api/cards/${solo3}/tasks/${applyTasks[0].id}`, { finishState: true })).json.state;
    assert.deepStrictEqual([st.courseTask.university, st.courseTask.course, st.needsNext], ['Alpha Course University', 'BSc A', undefined], 'the course comes with the task, and no follow-up is asked');
    const alpha = applyTasks.find((x) => /Alpha/.test(x.text)); const beta = applyTasks.find((x) => /Beta/.test(x.text)); const gamma = applyTasks.find((x) => /Gamma/.test(x.text));
    // Applied: only the day; the other two courses are not asked about in this task.
    assert.strictEqual((await fin3(alpha.id, { app: 'record', date: today, unis: [{ university: 'Alpha Course University', course: 'BSc A', what: 'submitted', date: today }] })).status, 200);
    // Not applied: the reason is needed.
    assert.strictEqual((await fin3(beta.id, { app: 'record', date: today, unis: [{ university: 'Beta Course University', course: 'BSc B', what: 'notsubmitted', date: today }] })).status, 400, 'not applied needs a reason');
    assert.strictEqual((await fin3(beta.id, { app: 'record', date: today, note: 'Not eligible: IELTS below 6.5.', unis: [{ university: 'Beta Course University', course: 'BSc B', what: 'notsubmitted', date: today }] })).status, 200);
    // The Offer request for Alpha was made by itself; Beta (not applied) has none.
    const offerTasks3 = (await cardS()).tasks.filter((x) => x.tag === 'offer');
    assert.deepStrictEqual(offerTasks3.map((x) => /Alpha Course University/.test(x.text)), [true], 'one Offer request, for the university applied to');
    // Not received yet: finished, and a new Offer request waits for the chosen day.
    const offerTask3 = offerTasks3[0];
    const stO = (await app('POST', `/api/cards/${solo3}/tasks/${offerTask3.id}`, { finishState: true })).json.state;
    assert.deepStrictEqual([stO.offerTask.university, stO.offerTask.course], ['Alpha Course University', 'BSc A']);
    assert.strictEqual((await fin3(offerTask3.id, { waiting: true, generic: true, note: 'Offer not received yet.' })).status, 400, 'a day to check again is needed');
    assert.strictEqual((await fin3(offerTask3.id, { waiting: true, generic: true, note: 'Offer not received yet.', next: add(5), nextText: offerTask3.text })).status, 200);
    const again3 = (await cardS()).tasks.filter((x) => x.tag === 'offer' && !x.done);
    assert.strictEqual(again3.length, 1, 'the next Offer request is waiting');
    assert.strictEqual(again3[0].doOn, add(5), 'for the day chosen');
    // The university's reply: no follow-up question.
    assert.strictEqual((await fin3(again3[0].id, { app: 'record', date: today, unis: [{ university: 'Alpha Course University', course: 'BSc A', what: 'conditional', date: today }] })).status, 200);
    assert.strictEqual((await cardS()).options.find((o) => o.university === 'Alpha Course University').offer, today);
    // Gamma is still waiting for its answer, held by its own task.
    assert.ok((await cardS()).options.find((o) => o.university === 'Gamma Course University').sent && !gamma.done);
  }
  // Putting back an application after its offer was recorded keeps the offer (only what that task wrote is taken off).
  {
    const ap = await giveT('Apply to Revert University', 'application');
    assert.strictEqual((await finishT(ap, { app: 'record', date: add(-2), unis: [{ university: 'Revert University', course: 'BSc Revert', what: 'submitted' }] })).status, 200);
    const offerReq = (await cardT()).tasks.find((x) => /^Offer request: .*Revert University/.test(x.text));
    assert.strictEqual((await finishT(offerReq.id, { app: 'record', date: today, unis: [{ university: 'Revert University', course: 'BSc Revert', what: 'conditional' }] })).status, 200);
    assert.strictEqual((await app('POST', `/api/cards/${tId}/tasks/${ap}`, { done: false, finish: { revert: true } })).status, 200);
    const kept = (await cardT()).options.find((x) => x.university === 'Revert University');
    assert.ok(kept && kept.offer === today && !kept.applied, 'the offer stays, only the application day this task wrote is taken off');
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
  {
    const wbV = (await admin('GET', '/api/data')).json;
    wbV.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === tId) r['APPLICATION STATUS'] = 'Visa Lodge'; }));
    assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wbV.revision, sheets: wbV.sheets, activeSheetId: wbV.activeSheetId })).status, 200);
  }
  const v3 = await giveT('Visa decision', 'visa');
  assert.strictEqual((await finishT(v3, { step: 'refused', date: today })).status, 400, 'a refusal says why');
  assert.strictEqual((await finishT(v3, { step: 'refused', date: today, note: 'Refused: funds not shown for 28 days.' })).status, 200);
  assert.strictEqual((await rowT())['APPLICATION STATUS'], 'Visa Rejected');

  // The university refuses the offer All Students shows (Thapamogul, East London, 18 Nov 2026): refusing it on the card takes the Offer
  // received day off All Students too, and the application day stays.
  const firstOpt = (await cardT()).options.find((o) => o.university === 'First University');
  assert.ok(firstOpt && firstOpt.offer, 'the first university holds the offer that All Students shows');
  assert.strictEqual((await admin('POST', `/api/cards/${tId}/options/${firstOpt.id}`, { refused: today, offer: '', offerType: '' })).status, 400, 'a refusal says why');
  assert.strictEqual((await admin('POST', `/api/cards/${tId}/options/${firstOpt.id}`, { refused: today, reason: 'Refused: entry grade not met.', offer: '', offerType: '' })).status, 200);
  const afterRefusal = await rowT();
  assert.strictEqual(afterRefusal['OFFER RECEIVED DATE'], add(-10), 'the refused offer no longer stands on All Students: the earliest offer still held (West London Offer University) is the first offer now');
  assert.strictEqual(afterRefusal['APPLICATION SUBMISSION DATE'], add(-30), 'the application day stays');
  // With no offer left anywhere, the Offer received day is empty on All Students (and the "offer refused" check has nothing to say).
  const thirdOpt = (await cardT()).options.find((o) => o.university === 'Third University');
  assert.strictEqual((await admin('POST', `/api/cards/${tId}/options/${thirdOpt.id}`, { refused: today, reason: 'Refused: course is full.', offer: '', offerType: '' })).status, 200);
  const stillOffer = (await cardT()).options.filter((o) => o.offer && !o.refused);
  if (!stillOffer.length) assert.strictEqual((await rowT())['OFFER RECEIVED DATE'], '', 'no offer stands any more');
  // A task with no answers is simply done, as before; the Application Team may now fill in the Medical Report on the sheet.
  const o1 = await give('Call the student', 'other');
  assert.strictEqual((await app('POST', `/api/cards/${id}/tasks/${o1}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200);
  const Teams = require('../shared/teams');
  assert.ok(Teams.DEPARTMENTS.application.editable.has('MEDICAL REPORT'));
});
