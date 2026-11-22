// The write door for Claude (student-details/advisor-write.js): two steps, one student, four plain details, off unless both settings are
// set, and every rule of the student card still applies. Made-up students only.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createAdvisorWrite } = require('../student-details/advisor-write');
const { hashPassword } = require('../shared/accounts');
const { buildDemo } = require('../scripts/demo-data');

const TOKEN = 'w'.repeat(40);
const text = (r) => JSON.parse(r.content[0].text);

// ---- the door on its own, with a stand-in for the portal ----

function door(over = {}) {
  const calls = [];
  let clock = 1000;
  const change = (args) => {
    calls.push(args);
    if (args.id !== 'row-1') return { error: 'No student with that id.' };
    if (!args.apply) return { id: 'row-1', student: 'Sita Sharma', changes: Object.entries(args.changes).map(([column, after]) => ({ column, before: 'Old', after })), before: Object.fromEntries(Object.keys(args.changes).map((c) => [c, 'Old'])) };
    return { id: 'row-1', student: 'Sita Sharma', changed: Object.entries(args.changes).map(([column, after]) => ({ column, before: 'Old', after })) };
  };
  const d = createAdvisorWrite({ token: TOKEN, change, now: () => clock, log: () => {}, ...over });
  return { d, calls, tick: (ms) => { clock += ms; } };
}
const run = (d, name, args) => d.callTool(name, args);

test('the door is off without the account it acts as, or with a short secret', () => {
  assert.strictEqual(createAdvisorWrite({ token: TOKEN, change: null, log: () => {} }).enabled, false);
  assert.strictEqual(createAdvisorWrite({ token: 'short', change: () => ({}), log: () => {} }).enabled, false);
  assert.strictEqual(door().d.enabled, true);
});

test('it offers two tools of its own and nothing that deletes, sends or reads', () => {
  const names = door().d.TOOLS.map((t) => t.name);
  assert.deepStrictEqual(names, ['preview_student_change', 'apply_student_change']);
});

test('a preview writes nothing; the change is made only by the second step, with the code, once', () => {
  const { d, calls } = door();
  const p = text(run(d, 'preview_student_change', { id: 'row-1', changes: { 'LAST NAME': 'Shrestha' } }));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].apply, false, 'the preview never applies');
  assert.match(p.code, /^[0-9a-f]{8}$/);
  const done = text(run(d, 'apply_student_change', { code: p.code }));
  assert.strictEqual(calls[1].apply, true);
  assert.deepStrictEqual(calls[1].changes, { 'LAST NAME': 'Shrestha' }, 'exactly what was previewed');
  assert.deepStrictEqual(calls[1].expect, { 'LAST NAME': 'Old' }, 'and only if the student is as the preview saw it');
  assert.strictEqual(done.done, true);
  assert.strictEqual(run(d, 'apply_student_change', { code: p.code }).isError, true, 'a code works once');
});

test('a made-up code, an empty code and an old code are refused and nothing is written', () => {
  const { d, calls, tick } = door();
  assert.strictEqual(run(d, 'apply_student_change', { code: 'deadbeef' }).isError, true);
  assert.strictEqual(run(d, 'apply_student_change', {}).isError, true);
  const p = text(run(d, 'preview_student_change', { id: 'row-1', changes: { 'FIRST NAME': 'Sita' } }));
  tick(11 * 60000);
  const late = run(d, 'apply_student_change', { code: p.code });
  assert.strictEqual(late.isError, true);
  assert.match(late.content[0].text, /expired/);
  assert.ok(calls.every((c) => c.apply === false), 'no write happened');
});

test('a preview the portal refuses gives no code', () => {
  const { d } = door();
  const bad = run(d, 'preview_student_change', { id: 'nobody', changes: { 'LAST NAME': 'X' } });
  assert.strictEqual(bad.isError, true);
});

test('no more than 60 changes in an hour, and the next hour starts again', () => {
  const { d, tick } = door();
  for (let i = 0; i < 60; i += 1) {
    const p = text(run(d, 'preview_student_change', { id: 'row-1', changes: { 'STUDENT ID': `S${i}` } }));
    assert.strictEqual(run(d, 'apply_student_change', { code: p.code }).isError, undefined);
  }
  const p = text(run(d, 'preview_student_change', { id: 'row-1', changes: { 'STUDENT ID': 'S99' } }));
  assert.strictEqual(run(d, 'apply_student_change', { code: p.code }).isError, true);
  tick(61 * 60000);
  const q = text(run(d, 'preview_student_change', { id: 'row-1', changes: { 'STUDENT ID': 'S100' } }));
  assert.strictEqual(run(d, 'apply_student_change', { code: q.code }).isError, undefined);
});

// ---- on the real server: the portal's own rules, the card note, the backup ----

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(t, env) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-awrite-'));
  const dir = path.join(root, 'student-details');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'counselor-incentive'));
  const demo = buildDemo({ today: '2026-11-22' });
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write('data.json', demo.workbook); write('cards.json', { cards: demo.cards }); write('planning.json', demo.planning);
  write('b2b-partners.json', { universities: demo.b2b }); write('agents.json', { universities: demo.agents });
  const hash = hashPassword('Made-Up-Password-2026');
  const person = (username, name, role, departments) => ({ id: crypto.randomBytes(8).toString('hex'), username, name, email: '', role, departments, passwordHash: hash, mustChangePassword: false, disabled: false });
  write('users.json', { users: [person('owner', 'Owner Demo', 'admin', []), person('asha', 'Asha Demo', 'staff', ['application']), person('chitwan', 'Chitwan Demo', 'staff', ['chitwan'])] });
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'student-details'), stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, COUNSELOR_DATA_DIR: path.join(root, 'counselor-incentive'), ...env },
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { await wait(250); } }
  return { dir, base };
}
const rpc = async (base, name, args, token = TOKEN) => {
  const res = await fetch(`${base}/advisor-write/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return res.status === 200 ? (await res.json()).result : { status: res.status };
};

test('on the real server: preview shows the change, apply writes it with the card note, and the rules of the card still hold', { timeout: 120000 }, async (t) => {
  const { dir, base } = await startServer(t, { NIEC_ADVISOR_WRITE_TOKEN: TOKEN, NIEC_ADVISOR_WRITE_AS: 'owner' });
  const sheetRow = () => JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).sheets[0].rows[0];
  const id = sheetRow()._id;
  const first = sheetRow()['FIRST NAME'];
  const lastBefore = sheetRow()['LAST NAME'];
  // Preview: shows before and after, writes nothing.
  const p = text(await rpc(base, 'preview_student_change', { id, changes: { 'LAST NAME': 'Testname' } }));
  assert.deepStrictEqual(p.changes, [{ column: 'LAST NAME', before: lastBefore, after: 'Testname' }]);
  assert.strictEqual(sheetRow()['LAST NAME'], lastBefore, 'a preview changes nothing');
  // Only the four plain details: e-mail, status and the rest are refused.
  for (const col of ['EMAIL', 'APPLICATION STATUS', 'CONTACT NUMBER', 'UNIVERSITY NAME']) {
    assert.strictEqual((await rpc(base, 'preview_student_change', { id, changes: { [col]: 'x' } })).isError, true, `${col} is not for this door`);
  }
  // A value the card would refuse is refused too (too long is cut by the card, so use an empty object and a wrong type).
  assert.strictEqual((await rpc(base, 'preview_student_change', { id, changes: {} })).isError, true);
  assert.strictEqual((await rpc(base, 'preview_student_change', { id: 'nobody', changes: { 'LAST NAME': 'X' } })).isError, true);
  // Apply: the sheet changes, the first name stays, the card gets a note by "(Claude)".
  const done = text(await rpc(base, 'apply_student_change', { code: p.code }));
  assert.strictEqual(done.done, true);
  assert.strictEqual(sheetRow()['LAST NAME'], 'Testname');
  assert.strictEqual(sheetRow()['FIRST NAME'], first);
  const cards = JSON.parse(fs.readFileSync(path.join(dir, 'cards.json'), 'utf8')).cards;
  const notes = (cards[id] || {}).notes || [];
  assert.ok(notes.some((n) => /LAST NAME|Last name/i.test(n.text) && /Testname/.test(n.text) && /\(Claude\)/.test(n.by || '')), 'the change is on the student card, by the account with "(Claude)"');
  // The rolling backup of the version before the change exists.
  assert.ok(fs.existsSync(path.join(dir, 'data.backup.json')), 'the server kept its backup');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data.backup.json'), 'utf8')).sheets[0].rows[0]['LAST NAME'], lastBefore);
  // The code works once, and a wrong secret looks like a page that does not exist.
  assert.strictEqual((await rpc(base, 'apply_student_change', { code: p.code })).isError, true);
  assert.strictEqual((await rpc(base, 'preview_student_change', { id, changes: { 'LAST NAME': 'X' } }, 'wrong')).status, 404);
});

test('a team account acts only inside what that team may do on the card', { timeout: 120000 }, async (t) => {
  const { dir, base } = await startServer(t, { NIEC_ADVISOR_WRITE_TOKEN: TOKEN, NIEC_ADVISOR_WRITE_AS: 'chitwan' });
  const wb = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  // A student of another branch or of no branch: the Chitwan Branch account may not change it.
  const other = wb.sheets[0].rows.find((r) => !/chitwan/i.test(String(r['STUDENT SOURCE'] || '')));
  assert.ok(other, 'the demo has a student that is not a Chitwan student');
  const r = await rpc(base, 'preview_student_change', { id: other._id, changes: { 'LAST NAME': 'Nope' } });
  assert.strictEqual(r.isError, true, 'the account cannot change a student it cannot change on the card');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).sheets[0].rows.find((x) => x._id === other._id)['LAST NAME'], other['LAST NAME']);
});

test('the door answers as a page that does not exist while it is switched off', { timeout: 120000 }, async (t) => {
  const { base } = await startServer(t, { NIEC_ADVISOR_WRITE_TOKEN: TOKEN }); // no account named: off
  assert.strictEqual((await rpc(base, 'preview_student_change', { id: 'x', changes: { 'LAST NAME': 'X' } })).status, 404);
});
