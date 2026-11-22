// Events and marketing (the owner, 17 Nov 2026): the figures of an event agree everywhere and are true.
//   - the inquiries of an event on the list, in its own view and in its follow-up are the same number;
//   - the note an uploaded list writes by itself is not a contact: a list just uploaded is "Not contacted", not "Followed up";
//   - only one count-up runs on the big figures (two of them stopped each other half way: 4 inquiries were shown for 106).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('one count-up only on the big figures', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'shared', 'ui.js'), 'utf8');
  assert.strictEqual((ui.match(/\.ev-band b/g) || []).length, 1, 'the figures of Events and marketing are counted up by one script only');
  assert.strictEqual((ui.match(/\.md-kpi b|\.md-kpi > b/g) || []).length, 1, 'the dashboards too');
});

test('an event: the same inquiries everywhere, and a list upload is not a contact', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-evfig-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  let cookie = '';
  const api = async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return res.json().catch(() => null);
  };
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await api('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await api('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });

  // Made-up students: two already applying, one organic social media inquiry, then a campaign list of 30.
  for (let i = 0; i < 2; i += 1) await api('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': `Early${i}`, 'LAST NAME': 'Demo', 'CONTACT NUMBER': `98000000${10 + i}`, 'STUDENT SOURCE': 'Social Media' }, profile: { sourceDetail: 'Facebook page' } });
  await api('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Organic', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000099', 'STUDENT SOURCE': 'Social Media' }, profile: { sourceDetail: 'Facebook page', sourceWay: 'Organic' } });
  await api('POST', '/api/planning/events', { name: 'Demo campaign', channel: 'Social media', date: '2026-11-06', cost: '30000' });
  const id = (await api('GET', '/api/activities')).activities[0].id;
  const rows = [{ first: 'Early0', last: 'Demo', phone: '9800000010' }, { first: 'Early1', last: 'Demo', phone: '9800000011' }];
  for (let i = 0; i < 28; i += 1) rows.push({ first: `New${i}`, last: 'Demo', phone: `9811${100000 + i}` });
  const done = await api('POST', `/api/activities/${id}/students`, { rows });
  assert.deepStrictEqual([done.added, done.linked], [28, 2]);

  const acts = await api('GET', '/api/activities');
  const a = acts.activities[0];
  const people = await api('GET', `/api/activities/${id}/students`);
  assert.deepStrictEqual([a.leads, a.applied, a.visas, a.costPerLead], [30, 2, 0, 1000]);
  assert.strictEqual(people.students.length, a.leads, 'the follow-up lists as many students as the event counts');
  assert.strictEqual(people.students.filter((s) => s.follow === 'new').length, 28, 'the note an uploaded list writes is not a contact');
  assert.strictEqual(a.follow.new, 28);
  assert.strictEqual(people.team.length, 0, 'nobody is shown as having followed up just by uploading the list');
  assert.strictEqual(acts.unlinkedSocial, 0, 'an organic social media inquiry belongs to no campaign');

  // Today agrees: the uploaded inquiries wait for a first contact.
  const today = await api('GET', '/api/today');
  const inq = (today.sections || []).find((x) => x.key === 'inquiries');
  if (inq) assert.ok(inq.count >= 28, 'Today lists the uploaded inquiries as waiting');

  // A real note makes the student contacted; with no next follow-up date it is still to follow up (the owner, 21 Nov 2026: the date
  // is always chosen), and the note from the follow-up list with its date makes the student followed up.
  const one = people.students.find((s) => s.follow === 'new');
  await api('POST', `/api/cards/${one.id}/notes`, { kind: 'note', text: 'Called, interested in January' });
  let after = await api('GET', `/api/activities/${id}/students`);
  assert.strictEqual(after.students.find((s) => s.id === one.id).follow, 'due', 'a note with no next follow-up date asks for one');
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const saved = await api('POST', `/api/followup/${one.id}`, { action: 'note', text: 'Called again, will decide by Friday', next: later });
  assert.ok(saved && saved.ok, JSON.stringify(saved));
  after = await api('GET', `/api/activities/${id}/students`);
  assert.strictEqual(after.students.find((s) => s.id === one.id).follow, 'ok');

  // Intake by intake (the owner, 17 Nov 2026). A second intake tab, made-up.
  const wb = await api('GET', '/api/data');
  const first = wb.sheets[0];
  const second = { id: 'sheet-demo-two', name: 'Demo Intake Two', columns: first.columns, rows: [], createdAt: new Date().toISOString() };
  const savedWb = await api('POST', '/api/data', { sheets: [...wb.sheets, second], activeSheetId: wb.activeSheetId, baseRevision: wb.revision });
  assert.ok(savedWb && !savedWb.error, 'the second intake is saved');
  let got = await api('GET', '/api/activities');
  assert.ok(got.intakes.some((x) => x.id === second.id) && got.currentIntake, 'the intakes and the current one are sent');
  let ev = got.activities.find((x) => x.id === id);
  assert.deepStrictEqual([ev.intake, ev.intakeHow, ev.chosenIntake], [first.id, 'students', ''], 'not chosen: the intake of its students');
  // An event with no students and no intake belongs to no intake.
  await api('POST', '/api/planning/events', { name: 'Empty fair', channel: 'Our office', date: '2026-12-01' });
  ev = (await api('GET', '/api/activities')).activities.find((x) => x.name === 'Empty fair');
  assert.deepStrictEqual([ev.intake, ev.intakeHow], ['', 'none']);
  // Chosen: it moves to that intake, whatever its students; the figures stay the whole event's.
  const camp = (await api('GET', '/api/activities')).activities.find((x) => x.id === id);
  assert.ok((await api('POST', '/api/planning/events', { id, name: camp.name, channel: camp.channel, date: camp.date, cost: '30000', intake: second.id })).ok);
  ev = (await api('GET', '/api/activities')).activities.find((x) => x.id === id);
  assert.deepStrictEqual([ev.intake, ev.intakeHow, ev.chosenIntake, ev.leads], [second.id, 'chosen', second.id, 30]);
  // A save from a page that does not send the intake keeps it.
  await api('POST', '/api/planning/events', { id, name: camp.name, channel: camp.channel, date: camp.date, cost: '30000' });
  assert.strictEqual((await api('GET', '/api/activities')).activities.find((x) => x.id === id).intake, second.id, 'kept');
  // An intake that does not exist is refused, nothing changes.
  const bad = await api('POST', '/api/planning/events', { id, name: camp.name, channel: camp.channel, date: camp.date, cost: '30000', intake: 'sheet-not-there' });
  assert.match(bad.error, /intake/);
  // The intake tab deleted: the event goes back to the intake of its students.
  const wb2 = await api('GET', '/api/data');
  await api('POST', '/api/data', { sheets: wb2.sheets.filter((x) => x.id !== second.id), activeSheetId: wb2.activeSheetId, baseRevision: wb2.revision });
  ev = (await api('GET', '/api/activities')).activities.find((x) => x.id === id);
  assert.deepStrictEqual([ev.intake, ev.intakeHow], [first.id, 'students']);
});
