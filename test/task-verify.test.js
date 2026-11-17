// Finishing a task is asked, shown back and confirmed before anything is written (the owner, 16 Nov 2026: an offer date was written
// for a student who never had an offer). Answers that were not confirmed are refused; the preview writes nothing; a wrong answer is
// put back by reopening the task; one task records any number of universities, each with its own outcome; dates out of order are
// refused or pointed out; and "Details to check" finds what does not add up. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('answers are checked and confirmed before they are written, and can be put back', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-verify-'));
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
  const today = (await admin('GET', '/api/tasks')).json.today;
  const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  const student = async (first, stage, cols = {}) => {
    const sid = (await admin('POST', '/api/students/new', { stage, fields: { 'FIRST NAME': first, 'LAST NAME': 'Demo', 'CONTACT NUMBER': `98000001${String(first.length).padStart(2, '0')}${first.charCodeAt(0) % 10}` } })).json.id;
    if (Object.keys(cols).length) {
      const wb = (await admin('GET', '/api/data')).json;
      wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === sid) Object.assign(r, cols); }));
      assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId })).status, 200);
    }
    const give = async (text, tag) => (await admin('POST', `/api/cards/${sid}/tasks`, { team: 'application', text, tag })).json.card.tasks.find((x) => x.text === text).id;
    const call = (tid, body) => app('POST', `/api/cards/${sid}/tasks/${tid}`, body && body.finish ? { ...body, finish: { next: 'none', ...body.finish } } : body);
    const card = async () => (await admin('GET', `/api/cards/${sid}`)).json;
    return { sid, give, call, card, row: async () => (await card()).student.row };
  };

  // 1. Answers that were not confirmed are refused, and the preview writes nothing.
  const a = await student('Anu', 'Application Stage', { 'UNIVERSITY NAME': 'Alpha University', 'COURSE NAME': 'MSc Nursing', 'APPLICATION SUBMISSION DATE': add(-20) });
  const t1 = await a.give('Chase the offer', 'application');
  const offer = { app: 'record', date: add(-2), unis: [{ university: 'Alpha University', course: 'MSc Nursing', what: 'conditional' }] };
  assert.strictEqual((await a.call(t1, { done: true, finish: offer })).status, 400, 'not confirmed: refused');
  assert.strictEqual((await a.row())['OFFER RECEIVED DATE'], '', 'nothing written');
  const state = (await a.call(t1, { finishState: true })).json.state;
  assert.strictEqual(state.kind, 'application');
  assert.deepStrictEqual(state.applications.map((x) => [x.university, x.applied, x.onSheet]), [['Alpha University', add(-20), true]], 'the dialog sees the applications so far');
  const pv = (await a.call(t1, { done: true, finish: offer, preview: true })).json.preview;
  assert.deepStrictEqual(pv.changes.find((c) => c.column === 'OFFER RECEIVED DATE').from, '(empty)');
  assert.match(pv.options.join('\n'), /Alpha University \(MSc Nursing\): conditional offer/);
  assert.strictEqual((await a.row())['OFFER RECEIVED DATE'], '', 'the preview writes nothing');
  assert.strictEqual((await a.card()).card.tasks.find((x) => x.id === t1).done, false);

  // 2. Confirmed: written. Reopened with "put it back": the offer date, the option and the Remarks line go back.
  assert.strictEqual((await a.call(t1, { done: true, finish: { ...offer, confirmed: true } })).status, 200);
  assert.strictEqual((await a.row())['OFFER RECEIVED DATE'], add(-2));
  assert.strictEqual((await a.card()).card.options.find((o) => o.university === 'Alpha University').offerType, 'Conditional');
  const back = await a.call(t1, { done: false, finish: { revert: true } });
  assert.strictEqual(back.status, 200);
  assert.match(back.json.undone.join('\n'), /Offer received: back to \(empty\)/);
  const r1 = await a.row();
  assert.deepStrictEqual([r1['OFFER RECEIVED DATE'], r1.REMARKS], ['', ''], 'the offer and the remark are gone');
  assert.ok(!(await a.card()).card.options.some((o) => o.university === 'Alpha University'), 'the option it added is gone');
  assert.match((await a.card()).card.notes.map((n) => n.text).join('\n'), /reopened and what it recorded was put back/);
  // A column changed by hand since is left as it is.
  assert.strictEqual((await a.call(t1, { done: true, finish: { ...offer, confirmed: true } })).status, 200);
  const wb = (await admin('GET', '/api/data')).json;
  wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === a.sid) r['OFFER RECEIVED DATE'] = add(-1); }));
  await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId });
  const back2 = await a.call(t1, { done: false, finish: { revert: true } });
  assert.match(back2.json.undone.concat(back2.json.left).join('\n'), /Offer received was changed since/);
  assert.strictEqual((await a.row())['OFFER RECEIVED DATE'], add(-1));

  // 3. One task, many universities, each with its own outcome; the first offer from any university is the student's Offer received
  // (the owner, 17 Nov 2026: the days are kept per university, the hidden column holds the first offer).
  const b = await student('Bina', 'Application Stage', { 'UNIVERSITY NAME': 'Beta University', 'COURSE NAME': 'BSc Business', 'APPLICATION SUBMISSION DATE': add(-30) });
  const t2 = await b.give('Record the news', 'application');
  const mixed = { app: 'record', date: add(-1), unis: [{ university: 'Gamma University', course: 'BSc Business', what: 'submitted' }, { university: 'Delta University', course: 'BSc Business', what: 'refused' }, { university: 'Epsilon University', what: 'unconditional' }] };
  const pv2 = (await b.call(t2, { done: true, finish: mixed, preview: true })).json.preview;
  assert.ok(pv2.changes.some((c) => c.column === 'OFFER RECEIVED DATE'), 'the first offer, whichever university gave it');
  assert.match(pv2.warnings.join('\n'), /No application to Epsilon University is recorded/);
  assert.match(pv2.warnings.join('\n'), /No application to Delta University is recorded/);
  assert.strictEqual((await b.call(t2, { done: true, finish: { ...mixed, confirmed: true } })).status, 200);
  const opts = Object.fromEntries((await b.card()).card.options.map((o) => [o.university, o]));
  assert.strictEqual(opts['Gamma University'].applied, add(-1));
  assert.strictEqual(opts['Delta University'].refused, add(-1));
  assert.deepStrictEqual([opts['Epsilon University'].offer, opts['Epsilon University'].offerType], [add(-1), 'Unconditional']);
  assert.strictEqual(opts['Beta University'].applied, add(-30), 'the first application joins University options');
  assert.strictEqual((await b.row())['OFFER RECEIVED DATE'], add(-1));
  assert.match((await b.card()).card.notes.map((n) => n.text).join('\n'), /applied to Gamma University \(BSc Business\); |applied to Gamma University \(BSc Business\), unconditional|applied to Gamma University/);

  // 4. Dates out of order are refused; a step already recorded is not overwritten.
  const t3 = await b.give('Offer before the application', 'application');
  assert.strictEqual((await b.call(t3, { done: true, finish: { app: 'record', date: add(-40), unis: [{ university: 'Beta University', what: 'conditional' }], confirmed: true } })).status, 400, 'an offer before its application');
  assert.strictEqual((await b.call(t3, { done: true, finish: { app: 'record', date: add(-2), unis: [{ university: 'Beta University' }], confirmed: true } })).status, 400, 'what happened must be chosen');
  assert.strictEqual((await b.call(t3, { done: true, finish: { app: 'record', date: add(1), unis: [{ university: 'Beta University', what: 'conditional' }], confirmed: true } })).status, 400, 'not a day still to come');
  const c = await student('Chandra', 'CAS Stage', { 'CAS RECEIVED DATE': add(-3), 'VISA LODGE DATE': add(-2) });
  const v1 = await c.give('Lodge the visa', 'visa');
  assert.strictEqual((await c.call(v1, { done: true, finish: { step: 'lodged', date: add(-5), confirmed: true } })).status, 400, 'visa lodged before the CAS');
  const pv3 = (await c.call(v1, { done: true, finish: { step: 'lodged', date: add(-1) }, preview: true })).json.preview;
  assert.match(pv3.kept.join('\n'), /Visa lodge date already says/);
  const p1 = await c.give('Collect the deposit', 'payment');
  assert.strictEqual((await c.call(p1, { done: true, finish: { paid: true, date: today, amount: 'five', confirmed: true } })).status, 400, 'the amount in numbers');
  const pv4 = (await c.call(p1, { done: true, finish: { paid: true, date: today, amount: '5000' }, preview: true })).json.preview;
  assert.match(pv4.warnings.join('\n'), /No offer is recorded/);
  const m1 = await c.give('Feedback of mock interview 1', 'mock');
  const wbm = (await admin('GET', '/api/data')).json;
  wbm.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === c.sid) r['MOCK SCHEDULE 1'] = add(3); }));
  await admin('POST', '/api/data', { baseRevision: wbm.revision, sheets: wbm.sheets, activeSheetId: wbm.activeSheetId });
  assert.strictEqual((await c.call(m1, { done: true, finish: { mock: 'feedback', slot: 1, feedback: 'Good', confirmed: true } })).status, 400, 'no feedback before the mock is held');

  // 5. Details to check: an offer with no application is listed (on the card and Today), until it is corrected or confirmed.
  const d = await student('Dipa', 'Application Stage', { 'OFFER RECEIVED DATE': add(-4) });
  const checks = (await d.card()).checks;
  assert.deepStrictEqual(checks.map((x) => x.key), [`offer-no-app:${add(-4)}`]);
  const todayList = (await admin('GET', '/api/today')).json;
  const sec = (todayList.sections || []).find((x) => x.key === 'check');
  assert.ok(sec && sec.students.some((s) => s.id === d.sid), 'on Today under Details to check');
  assert.strictEqual((await admin('POST', `/api/cards/${d.sid}/checks`, { key: 'made-up' })).status, 400);
  assert.strictEqual((await admin('POST', `/api/cards/${d.sid}/checks`, { key: checks[0].key })).status, 200);
  assert.deepStrictEqual((await d.card()).checks, [], 'checked and correct: off the list');
  assert.match((await d.card()).card.notes.map((n) => n.text).join('\n'), /Checked and correct: Offer received/);

  // 6. Days kept per university on the card (the owner, 17 Nov 2026): each one is a note in the Timeline, All Students' hidden
  // columns hold the first application and the first offer, and the sheet's own earlier application joins the card first.
  const e = await student('Esha', 'Application Stage', { 'UNIVERSITY NAME': 'Old University', 'APPLICATION SUBMISSION DATE': add(-50) });
  const o1 = (await admin('POST', `/api/cards/${e.sid}/options`, { university: 'New University', course: 'MSc Data' })).json.option;
  assert.strictEqual((await app('POST', `/api/cards/${e.sid}/options/${o1.id}`, { applied: add(-20) })).status, 200);
  assert.strictEqual((await app('POST', `/api/cards/${e.sid}/options/${o1.id}`, { applied: add(-20), offer: add(-5), offerType: 'Conditional' })).status, 200);
  const ec = await e.card();
  assert.deepStrictEqual(ec.card.options.map((o) => o.university).sort(), ['New University', 'Old University'], 'the earlier application is kept');
  assert.strictEqual(ec.student.row['APPLICATION SUBMISSION DATE'], add(-50), 'the first application');
  assert.strictEqual(ec.student.row['OFFER RECEIVED DATE'], add(-5), 'the first offer');
  assert.match(ec.card.notes.map((n) => n.text).join('\n'), /Application submitted to New University, MSc Data on .*Conditional offer received from New University/s);
  // Assigned but not submitted, with the reason; and taken off the shortlist even after it was given to the team.
  const o2 = (await admin('POST', `/api/cards/${e.sid}/options`, { university: 'Third University', course: 'MSc AI' })).json.option;
  assert.strictEqual((await app('POST', `/api/cards/${e.sid}/options/${o2.id}`, { skipped: add(-1), reason: 'Not eligible: grades' })).status, 200);
  assert.match((await e.card()).card.notes.map((n) => n.text).join('\n'), /Not submitted to Third University, MSc AI: Not eligible: grades/);
  const o3 = (await admin('POST', `/api/cards/${e.sid}/options`, { university: 'Fourth University', course: 'MSc AI' })).json.option;
  assert.strictEqual((await admin('POST', `/api/cards/${e.sid}/options/send`, { ids: [o3.id], partners: { [o3.id]: 'Direct' } })).status, 200);
  assert.strictEqual((await admin('POST', `/api/cards/${e.sid}/options/${o3.id}/delete`, {})).status, 200);
});
