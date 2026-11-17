// Data to fix and the weekly summary (the owner, 17 Nov 2026). Data to fix lists the gaps of the students a person sees, each team
// only its own kinds, and a gap filled in there is saved and leaves the list; a student who already has the visa is not asked for
// passport details. The weekly summary is for Admin and the Manager and counts each step on its own day. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Data to fix finds the gaps, fills them in place, and the weekly summary counts the week', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-fix-'));
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

  const student = async (first, stage, cols = {}) => {
    const sid = (await admin('POST', '/api/students/new', { stage, fields: { 'FIRST NAME': first, 'LAST NAME': 'Demo' } })).json.id;
    const wb = (await admin('GET', '/api/data')).json;
    wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === sid) Object.assign(r, cols); }));
    assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId })).status, 200);
    return sid;
  };
  const gaps = async (who) => Object.fromEntries((await who('GET', '/api/data-to-fix')).json.groups.map((g) => [g.key, g.students]));
  const has = (list, sid) => (list || []).some((s) => s.id === sid);

  const mock = await student('Mina', 'Mock Stage', { 'LANGUAGE TEST DATE': 'Test Date', 'UNIVERSITY NAME': 'Alpha University' });
  const visa = await student('Vikas', 'Visa Issued', { 'APPLICATION SUBMISSION DATE': '2026-01-05', 'OFFER RECEIVED DATE': '2026-01-20', 'UNIVERSITY NAME': 'Alpha University', 'COURSE NAME': 'MSc Nursing', 'CONTACT NUMBER': '9800000002', EMAIL: 'vikas@example.com', 'STUDENT SOURCE': 'Visitor' });

  // 1. The gaps of a student, each in its own group; the fill-in says what to fill.
  let g = await gaps(admin);
  assert.ok(has(g.langDate, mock), 'Test Date with no day');
  assert.ok(has(g.appDate, mock), 'at Mock Stage with no application day');
  assert.ok(has(g.noUni, mock), 'no course');
  assert.ok(has(g.dob, mock) && has(g.passportNo, mock) && has(g.address, mock), 'passport details');
  assert.ok(has(g.phone, mock), 'no phone number');
  assert.deepStrictEqual(g.langDate.find((s) => s.id === mock).fix, { kind: 'date', on: 'sheet', field: 'LANGUAGE TEST DATE', label: 'Test date' });
  // A student who already has the visa is not asked for passport details or the test day.
  assert.ok(!has(g.dob, visa) && !has(g.passportNo, visa) && !has(g.langDate, visa));
  assert.ok(!has(g.appDate, visa) && !has(g.offerDate, visa) && !has(g.phone, visa) && !has(g.email, visa) && !has(g.noSource, visa));

  // 2. Filled in where it is listed: saved on the sheet and the card, and gone from the list. An empty day is refused.
  assert.strictEqual((await admin('POST', `/api/cards/${mock}/sheet`, { fields: { 'LANGUAGE TEST DATE': '' } })).status, 400, 'never emptied from here');
  assert.strictEqual((await admin('POST', `/api/cards/${mock}/sheet`, { fields: { 'LANGUAGE TEST DATE': '2026-12-12' } })).status, 200);
  assert.strictEqual((await admin('POST', `/api/cards/${mock}/sheet`, { fields: { 'APPLICATION SUBMISSION DATE': today } })).status, 200);
  assert.strictEqual((await admin('POST', `/api/cards/${mock}/profile`, { passportNo: 'PA1234567' })).status, 200);
  const card = (await admin('GET', `/api/cards/${mock}`)).json;
  assert.strictEqual(card.student.row['LANGUAGE TEST DATE'], '2026-12-12');
  assert.strictEqual(card.card.profile.passportNo, 'PA1234567');
  g = await gaps(admin);
  assert.ok(!has(g.langDate, mock) && !has(g.appDate, mock) && !has(g.passportNo, mock));
  assert.ok(has(g.dob, mock), 'the other gaps stay');

  // 3. A team sees only the kinds of gap that are its own work.
  const own = (await app('GET', '/api/data-to-fix')).json;
  const keys = own.groups.map((x) => x.key);
  assert.ok(keys.includes('dob') && keys.includes('noUni'));
  assert.ok(!keys.includes('phone') && !keys.includes('noSource'), 'phone and source are the Follow-up Team\'s');

  // 4. The weekly summary: Admin and the Manager only; the application recorded today counts this week.
  assert.strictEqual((await app('GET', '/api/weekly')).status, 403);
  const wk = (await admin('GET', '/api/weekly')).json;
  assert.strictEqual(wk.to, today);
  assert.strictEqual(wk.steps.find((s) => s.key === 'applications').now, 1);
  assert.ok(wk.people.applications.some((s) => s.id === mock));
  assert.strictEqual(wk.steps.find((s) => s.key === 'visas').now, 0, 'a visa with no day received is not counted in a week');
  const last = (await admin('GET', '/api/weekly?ago=1')).json;
  assert.strictEqual(last.steps.find((s) => s.key === 'applications').now, 0);
  assert.strictEqual(last.steps.find((s) => s.key === 'applications').before, 0);
  assert.strictEqual(wk.toFix, (await admin('GET', '/api/data-to-fix')).json.total);

  // 5. The pages open for whoever may see them.
  assert.strictEqual((await app('GET', '/data-to-fix')).status, 200);
  assert.strictEqual((await app('GET', '/weekly')).status, 302, 'a team is sent home');
  assert.strictEqual((await admin('GET', '/weekly')).status, 200);
});
