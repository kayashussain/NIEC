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
  // Everything the Application Team completes, from the step where it exists (the owner, 22 Nov 2026): an offer, so Student ID, NOC and
  // NOC number. One line names them all. University partner is not missing: it came by itself with the application ("Direct (...)").
  assert.match(lines, /No date of birth, passport number, address, receiving partner, language test, Student ID, NOC or NOC number\./);
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
  // No application or offer yet: only what exists from Application Stage is asked for.
  assert.match(listed.lines.map((l) => l.text).join('\n'), /^No email, date of birth, passport number, address, receiving partner or language test\.$/);
  const cardRes = await app('GET', `/api/cards/${mockId}`);
  assert.strictEqual(cardRes.status, 200, 'Fix it opens the card');
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/profile`, { dob: '2002-01-02', passportNo: 'PA0000002', address: 'Pokhara-8, Kaski' })).status, 200, 'the team fills in the passport details');
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/sheet`, { fields: { EMAIL: 'mina.demo@example.com', 'RECEIVING PARTNER': 'Head Office', 'LANGUAGE TEST DATE': 'Test Date' } })).status, 200);
  assert.match((await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId).lines[0].text, /^No language test date\.$/, 'a test chosen without its day');
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/sheet`, { fields: { 'LANGUAGE TEST DATE': '2026-12-01' } })).status, 200);
  // Pre-CAS passed: the medical report is asked for; Booked: its day too.
  {
    const w = (await admin('GET', '/api/data')).json;
    w.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === mockId) r['PRE CAS INTERVIEW'] = 'Passed'; }));
    assert.strictEqual((await admin('POST', '/api/data', { baseRevision: w.revision, sheets: w.sheets, activeSheetId: w.activeSheetId })).status, 200);
  }
  assert.match((await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId).lines[0].text, /^No medical report\.$/);
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/sheet`, { fields: { 'MEDICAL REPORT': 'Booked' } })).status, 200);
  assert.match((await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId).lines[0].text, /^No medical booking date\.$/);
  assert.strictEqual((await app('POST', `/api/cards/${mockId}/sheet`, { fields: { 'MEDICAL BOOKING DATE': '2026-12-12' } })).status, 200);
  assert.ok(!((await app('GET', '/api/today')).json.missing.find((m) => m.id === mockId)), 'the line leaves once fixed');
  const sheetRows = (await app('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows);
  assert.ok(!sheetRows.some((r) => r._id === mockId), 'All Students does not show the team the Mock Stage student');
  assert.ok(sheetRows.some((r) => r._id === id), 'the Application Stage student is on All Students');
  // A student at another stage stays closed to the team.
  const casId = (await admin('POST', '/api/students/new', { stage: 'CAS Stage', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000083', 'STUDENT SOURCE': 'Visitor' } })).json.id;
  assert.strictEqual((await app('GET', `/api/cards/${casId}`)).status, 404, 'a CAS Stage student is not the team\'s');
  assert.ok(!((await app('GET', '/api/today')).json.missing.find((m) => m.id === casId)));

  // A change saved on the student card is written in the student's notes, old to new, and an Undo says so (the owner, 22 Nov 2026).
  const notesOf = async (sid) => (await admin('GET', `/api/cards/${sid}`)).json.card.notes.map((n) => n.text).join('\n');
  assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { EMAIL: 'sarita.new@example.com' } })).status, 200);
  assert.match(await notesOf(id), /Changed on the student card: Email: "sarita\.demo@example\.com" \u2192 "sarita\.new@example\.com"\./);
  const undone = await app('POST', `/api/cards/${id}/sheet`, { fields: { EMAIL: 'sarita.demo@example.com' }, undo: true });
  assert.deepStrictEqual([undone.status, undone.json && undone.json.changed], [200, ['EMAIL']], JSON.stringify(undone.json));
  assert.match(await notesOf(id), /Undone on the student card: Email: "sarita\.new@example\.com" \u2192 "sarita\.demo@example\.com"\./);
  assert.strictEqual((await app('POST', `/api/cards/${id}/profile`, { address: 'Bharatpur-11, Chitwan' })).status, 200);
  assert.match(await notesOf(id), /Address \(as in the passport\): "Bharatpur-10, Chitwan" \u2192 "Bharatpur-11, Chitwan"/);

  // The sheet: the Application Team's typing is not kept (it changes a student on the card), its row colour is (the owner, 22 Nov 2026).
  const sheetNow = (await app('GET', '/api/data')).json;
  sheetNow.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) { r.EMAIL = 'typed.on.sheet@example.com'; r._color = 'yellow'; } }));
  const saved = await app('POST', '/api/data', { baseRevision: sheetNow.revision, sheets: sheetNow.sheets, activeSheetId: sheetNow.activeSheetId });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  const rowAfter = (await admin('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows).find((r) => r._id === id);
  assert.strictEqual(rowAfter.EMAIL, 'sarita.demo@example.com', 'a value typed on the sheet by the Application Team is not kept');
  assert.strictEqual(rowAfter._color, 'yellow', 'the row colour is kept');
  // Every detail of the application is changed on the student card, never on the sheet (the owner, 22 Nov 2026).
  {
    const rowNow = async () => (await admin('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows).find((r) => r._id === id);
    const s3 = (await app('GET', '/api/data')).json;
    s3.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) Object.assign(r, { 'RECEIVING PARTNER': 'Head Office', 'NOC NUMBER': 'NOC-123', 'STUDENT ID': 'typed' }); }));
    assert.strictEqual((await app('POST', '/api/data', { baseRevision: s3.revision, sheets: s3.sheets, activeSheetId: s3.activeSheetId })).status, 200);
    const row3 = await rowNow();
    assert.deepStrictEqual([row3['RECEIVING PARTNER'], row3['NOC NUMBER'], row3['STUDENT ID']].map((v) => v || ''), ['', '', ''], 'typing on the sheet is not kept');
    // The Application details card: one save, one note, the medical booking date with it.
    const card3 = await app('POST', `/api/cards/${id}/sheet`, { fields: { 'RECEIVING PARTNER': 'Head Office', 'LANGUAGE TEST DATE': 'Waiver', 'STUDENT ID': 'CU-1', NOC: 'Received', 'NOC NUMBER': 'NOC-123', 'MEDICAL REPORT': 'Booked', 'MEDICAL BOOKING DATE': '2026-12-12' } });
    assert.strictEqual(card3.status, 200, JSON.stringify(card3.json));
    const row4 = await rowNow();
    assert.deepStrictEqual([row4['RECEIVING PARTNER'], row4['LANGUAGE TEST DATE'], row4['STUDENT ID'], row4.NOC, row4['NOC NUMBER'], row4['MEDICAL REPORT']], ['Head Office', 'Waiver', 'CU-1', 'Received', 'NOC-123', 'Booked']);
    assert.strictEqual((await admin('GET', `/api/cards/${id}`)).json.card.medical.date, '2026-12-12');
    assert.match(await notesOf(id), /Changed on the student card: .*Student ID: \(empty\) \u2192 "CU-1".*Medical booking date: \(empty\) \u2192 "2026-12-12"\./);
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { NOC: 'Maybe' } })).status, 400, 'only the NOC choices');
    // The Mock interviews card is the Mock Team's: the Application Team only looks.
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'FEEDBACK 1': 'x' } })).status, 403);
    assert.ok(!(await app('GET', `/api/cards/${id}`)).json.can.cols.includes('FEEDBACK 1'));
    // University partner follows the Priority university by itself: a direct application says "Direct (<university>)".
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY PARTNER': 'QA' } })).status, 200);
    assert.notStrictEqual((await rowNow())['UNIVERSITY PARTNER'], 'QA', 'University partner is never typed');
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Coventry University', 'COURSE NAME': 'MSc Data Science and Computational Intelligence' } })).status, 200);
    assert.strictEqual((await rowNow())['UNIVERSITY PARTNER'], 'Direct (Coventry University)');
    // Another Priority university with no partner known: the "Direct (Coventry University)" written before is cleared, never left wrong.
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Roehampton University', 'COURSE NAME': 'MSc Data Science' } })).status, 200);
    assert.strictEqual((await rowNow())['UNIVERSITY PARTNER'] || '', '');
    assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': 'Coventry University', 'COURSE NAME': 'MSc Data Science and Computational Intelligence' } })).status, 200);
    assert.strictEqual((await rowNow())['UNIVERSITY PARTNER'], 'Direct (Coventry University)');
    // Undo puts back a value kept in an older form (an older NOC word, a day written "17/07/2026"), which a normal save would refuse.
    {
      const w = (await admin('GET', '/api/data')).json;
      w.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) { r.NOC = 'Yes'; r['LANGUAGE TEST DATE'] = '17/07/2026'; } }));
      assert.strictEqual((await admin('POST', '/api/data', { baseRevision: w.revision, sheets: w.sheets, activeSheetId: w.activeSheetId })).status, 200);
      assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { NOC: 'Received', 'LANGUAGE TEST DATE': 'Waiver' } })).status, 200);
      assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { NOC: 'Yes' } })).status, 400, 'not as a normal save');
      assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { NOC: 'Yes', 'LANGUAGE TEST DATE': '17/07/2026' }, undo: true })).status, 200);
      const back = await rowNow();
      assert.deepStrictEqual([back.NOC, back['LANGUAGE TEST DATE']], ['Yes', '17/07/2026']);
      // Undo is never a way round the checks: only the value this server just replaced is put back.
      assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { NOC: '<img src=x>' }, undo: true })).status, 400);
      assert.strictEqual((await app('POST', `/api/cards/${id}/sheet`, { fields: { 'OFFER RECEIVED DATE': 'garbage' }, undo: true })).status, 400);
      // A person's note is always a note (stage and "no answer" lines are ISR's own), and a next follow-up day must be a real day.
      const fake = await app('POST', `/api/cards/${id}/notes`, { text: 'Moved to Visa Issued', kind: 'stage' });
      assert.strictEqual(fake.status, 200);
      assert.strictEqual((await admin('GET', `/api/cards/${id}`)).json.card.notes.find((n) => n.text === 'Moved to Visa Issued').kind, 'note');
      assert.strictEqual((await app('POST', `/api/cards/${id}/notes`, { text: 'Call back', next: '2099-99-99' })).status, 400);
      // A Mock Stage student (written outside the team's sheet) gets the same checks as the sheet: never made a branch student.
      const blankSrc = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Ravi', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000089' } })).json.id;
      const merged = await app('POST', '/api/students/merge', { id: blankSrc, fields: { 'STUDENT SOURCE': 'Chitwan Branch' } });
      assert.notStrictEqual(merged.status, 200, JSON.stringify(merged.json));
      assert.notStrictEqual((await admin('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows).find((r) => r._id === blankSrc)['STUDENT SOURCE'], 'Chitwan Branch');
    }
    // The Student Source is changed on the student card.
    const src = await app('POST', `/api/cards/${id}/source`, { source: 'Social Media' });
    assert.strictEqual(src.status, 200, JSON.stringify(src.json));
    assert.strictEqual((await rowNow())['STUDENT SOURCE'], 'Social Media');
    assert.match(await notesOf(id), /Student Source: "Visitor" \u2192 "Social Media"/);
  }
  // Status stays open: the Application Team moves a student on to Mock Stage from the sheet (the card has no stage control).
  const sheet2 = (await app('GET', '/api/data')).json;
  sheet2.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) r['APPLICATION STATUS'] = 'Mock Stage'; }));
  const moved = await app('POST', '/api/data', { baseRevision: sheet2.revision, sheets: sheet2.sheets, activeSheetId: sheet2.activeSheetId });
  assert.strictEqual(moved.status, 200, JSON.stringify(moved.json));
  assert.strictEqual((await admin('GET', '/api/data')).json.sheets.flatMap((sh) => sh.rows).find((r) => r._id === id)['APPLICATION STATUS'], 'Mock Stage', 'the Application Team still moves a student on');

  // The Application Team works from Today, All Students and Universities (the owner, 21 Nov 2026): Dashboard, Partners, Apply through
  // and Mock interviews send it back to Today; Apply now on a university still finds the partner.
  for (const page of ['/my-dashboard', '/dashboard', '/partners', '/partner-universities', '/b2b-partners', '/agents', '/apply-through', '/mock-guides', '/bulk']) {
    assert.strictEqual((await app('GET', page)).status, 302, page);
  }
  assert.strictEqual((await app('GET', '/today')).status, 200);
  assert.strictEqual((await app('GET', '/api/apply-through/find?name=Nowhere')).status, 200, 'Apply now still asks for the partner');
  assert.strictEqual((await admin('GET', '/apply-through')).status, 200, 'Admin keeps Apply through');
  // In both teams: the own team decides (the owner, 21 Nov 2026).
  const both = async (username, taskTeam) => {
    const u = (await admin('POST', '/api/users', { username, name: username, email: '', departments: ['application', 'mock'], taskTeam })).json;
    const p = person();
    await p('POST', '/api/login', { username, password: u.temporaryPassword }); await p('POST', '/api/login/new-password', { password: 'Team-Strong-2026x' });
    return p;
  };
  const ownApp = await both('sanu', 'application');
  assert.strictEqual((await ownApp('GET', '/mock-guides')).status, 302, 'own team Application: no Mock interviews');
  assert.strictEqual((await ownApp('GET', '/partners')).status, 302, 'own team Application: no Partners');
  const ownMock = await both('rita', 'mock');
  assert.strictEqual((await ownMock('GET', '/mock-guides')).status, 200, 'own team Mock: keeps Mock interviews');
  assert.notStrictEqual((await ownMock('GET', '/partners')).location, '/today', 'own team Mock: keeps Partners');
  assert.strictEqual((await admin('GET', '/api/apply-through')).json.canChange, true);
});

test('the menu keeps the own team in its saved copy, so someone in two teams whose own team is Application gets the short menu', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'header.js'), 'utf8');
  const line = src.split('\n').find((l) => /const fresh = JSON\.stringify\(/.test(l)) || '';
  assert.match(line, /taskTeam/, 'the saved copy of the person keeps taskTeam');
});

test('own team Application: one rule for the menu, the pages and Universities (Share instead of Shortlist)', () => {
  const T = require('../shared/teams');
  assert.strictEqual(T.ownTeamApplication({ role: 'staff', departments: ['application'] }), true);
  assert.strictEqual(T.ownTeamApplication({ role: 'staff', departments: ['application', 'mock'], taskTeam: 'application' }), true);
  assert.strictEqual(T.ownTeamApplication({ role: 'staff', departments: ['application', 'mock'], taskTeam: 'mock' }), false);
  assert.strictEqual(T.ownTeamApplication({ role: 'staff', departments: ['application', 'mock'] }), false, 'no own team chosen: not only the Application Team');
  assert.strictEqual(T.ownTeamApplication({ role: 'manager', departments: ['application'] }), false);
  assert.strictEqual(T.ownTeamApplication({ role: 'admin' }), false);
  const finder = fs.readFileSync(path.join(__dirname, '..', 'student-details', 'fact-finder.js'), 'utf8');
  assert.match(finder, /if \(state\.shareOnly\) return shareButton\(o\);/, 'the Application Team gets Share');
  const uni = fs.readFileSync(path.join(__dirname, '..', 'student-details', 'fact-university.js'), 'utf8');
  const apply = uni.slice(uni.indexOf('function applyWindow'), uni.indexOf('function renderProfile')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/ShortlistFor|shortlisted|contacts/.test(apply), 'Apply now shows no student, no shortlist and no contact people');
});
