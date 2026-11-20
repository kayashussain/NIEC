// The weekly summary (the owner, 17 Nov 2026): for Admin and the Manager, counts each step on its own day. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the weekly summary counts the week', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-weekly-'));
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
  const mock = await student('Mina', 'Mock Stage', { 'LANGUAGE TEST DATE': 'Test Date', 'UNIVERSITY NAME': 'Alpha University' });
  const visa = await student('Vikas', 'Visa Issued', { 'APPLICATION SUBMISSION DATE': '2026-01-05', 'OFFER RECEIVED DATE': '2026-01-20', 'UNIVERSITY NAME': 'Alpha University', 'COURSE NAME': 'MSc Nursing', 'CONTACT NUMBER': '9800000002', EMAIL: 'vikas@example.com', 'STUDENT SOURCE': 'Visitor' });

  assert.strictEqual((await admin('POST', `/api/cards/${mock}/sheet`, { fields: { 'APPLICATION SUBMISSION DATE': today } })).status, 200);

  // 1. The weekly summary: Admin and the Manager only; the application recorded today counts this week.
  assert.strictEqual((await app('GET', '/api/weekly')).status, 403);
  const wk = (await admin('GET', '/api/weekly')).json;
  assert.strictEqual(wk.to, today);
  assert.strictEqual(wk.steps.find((s) => s.key === 'applications').now, 1);
  assert.ok(wk.people.applications.some((s) => s.id === mock));
  assert.strictEqual(wk.steps.find((s) => s.key === 'visas').now, 0, 'a visa with no day received is not counted in a week');
  const last = (await admin('GET', '/api/weekly?ago=1')).json;
  assert.strictEqual(last.steps.find((s) => s.key === 'applications').now, 0);
  assert.strictEqual(last.steps.find((s) => s.key === 'applications').before, 0);

  // 2. The page opens for whoever may see it.
  assert.strictEqual((await app('GET', '/weekly')).status, 302, 'a team is sent home');
  assert.strictEqual((await admin('GET', '/weekly')).status, 200);
});
