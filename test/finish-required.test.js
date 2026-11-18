// What must be said when a task is done (the owner, 17 Nov 2026): a few words of what was done when the task records nothing else,
// and, when it was the student's last open task and the student is still on the way, the day someone gets back to the student (a task
// for the same team, waiting for that day) or "Not needed". Also: a person's WhatsApp number is saved on its own (Follow-up setup), and
// a Follow-up message with a misspelt {word} is refused before it reaches anyone. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a done task says what was done and what comes next; the setup and the words of a message are checked', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-required-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir };
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json, location: res.headers.get('location') };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = (await admin('POST', '/api/users', { username: 'sunita', name: 'Sunita', email: '', departments: ['followup'] })).json;
  const fu = person();
  await fu('POST', '/api/login', { username: 'sunita', password: made.temporaryPassword }); await fu('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
  const today = (await admin('GET', '/api/tasks')).json.today;
  const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  const id = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Rina', 'LAST NAME': 'Demo', EMAIL: 'rina@example.org', 'CONTACT NUMBER': '9800000081' } })).json.id;
  const give = async (text) => (await admin('POST', `/api/cards/${id}/tasks`, { team: 'followup', text, tag: 'other' })).json.card.tasks.find((x) => x.text === text).id;
  const tick = (tid, finish) => fu('POST', `/api/cards/${id}/tasks/${tid}`, { done: true, ...(finish ? { finish } : {}) });
  const tasks = async () => (await admin('GET', `/api/cards/${id}`)).json.card.tasks;

  // 1. What was done.
  const t1 = await give('Call about the scholarship');
  assert.strictEqual((await tick(t1)).status, 400, 'nothing said: refused');
  assert.match((await tick(t1, { note: 'ok', next: 'none' })).json.error, /few words/, 'a word or two is not enough');
  // 2. No follow-up question is asked (the owner, 18 Nov 2026: removed from every task): words are enough, even as the last open task of a
  // student still on the way. A next day given on purpose through the API still makes a task for the same team.
  const state = (await fu('POST', `/api/cards/${id}/tasks/${t1}`, { finishState: true })).json.state;
  assert.ok(!state.needsNext, 'nothing about a follow-up is asked');
  assert.strictEqual((await tick(t1, { note: 'Called, she will decide by Friday.' })).status, 200);
  assert.strictEqual((await tasks()).filter((x) => !x.done).length, 0, 'no follow-up task was made by itself');
  assert.ok((await admin('GET', `/api/cards/${id}`)).json.card.notes.some((n) => /decide by Friday/.test(n.text)), 'what was done is a note');
  const t1b = await give('Call about the intake');
  assert.strictEqual((await tick(t1b, { note: 'Called, she will decide by Friday.', next: add(3), nextText: 'Ask for her decision' })).status, 200);
  const follow = (await tasks()).find((x) => x.text === 'Ask for her decision');
  assert.ok(follow && !follow.done && follow.team === 'followup' && follow.doOn === add(3), 'a day given on purpose: a task for the same team, waiting for that day');
  // With another task still open, nothing more is asked.
  const t2 = await give('Send the fee list');
    assert.strictEqual((await tick(t2, { note: 'Sent the fee list on WhatsApp.' })).status, 200);
  // "Not needed" is an answer too; a student who has left is never asked.
  assert.strictEqual((await tick(follow.id, { note: 'She chose to study in Australia.', next: 'none' })).status, 200);
  const wb = (await admin('GET', '/api/data')).json;
  wb.sheets.forEach((sh) => sh.rows.forEach((r) => { if (r._id === id) r['APPLICATION STATUS'] = 'Withdrawn'; }));
  assert.strictEqual((await admin('POST', '/api/data', { baseRevision: wb.revision, sheets: wb.sheets, activeSheetId: wb.activeSheetId })).status, 200);
  const t3 = await give('Return the documents');
  assert.strictEqual((await tick(t3, { note: 'Documents handed back.' })).status, 200, 'a withdrawn student needs no next step');

  // 3. The WhatsApp number of the sender, saved on its own.
  assert.match((await fu('POST', '/api/my-mail/phone', { phone: 'call me' })).json.error, /does not look right/);
  assert.strictEqual((await fu('POST', '/api/my-mail/phone', { phone: '+977 9800000099' })).json.phone, '+977 9800000099');
  assert.strictEqual((await fu('GET', '/api/my-mail')).json.phone, '+977 9800000099');
  assert.strictEqual((await fu('POST', '/api/my-mail/phone', { phone: '' })).json.phone, '');

  // 4. Follow-up refuses a misspelt {word}; the old pages lead to Follow-up's setup.
  const bad = await fu('POST', '/api/bulk/preview', { ids: [id], subject: 'Hello', body: 'Dear {frist_name},' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /not one of the words/);
  assert.ok((await admin('POST', '/api/bulk/preview', { ids: [id], subject: 'Hello', body: 'Dear {first_name},' })).json.items[0].text.startsWith('Dear Rina,'));
  assert.strictEqual((await fu('GET', '/my-email')).location, '/bulk#setup');
  assert.strictEqual((await fu('GET', '/compose?id=' + id)).location, '/student?id=' + id);
});
