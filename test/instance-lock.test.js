const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { acquire, STALE_MS } = require('../student-details/instance-lock');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-lock-'));

test('a second copy on the same data folder refuses; a stopped or stale one is taken over', () => {
  const dir = tmp();
  const a = acquire(dir, { pid: 1001, isAlive: () => true });
  assert.ok(!a.error);
  const b = acquire(dir, { pid: 1002, isAlive: () => true });
  assert.match(b.error, /already running/);
  assert.ok(fs.existsSync(path.join(dir, 'server.lock')), 'the refused copy leaves the first one\'s lock alone');
  a.release();
  assert.ok(!fs.existsSync(path.join(dir, 'server.lock')));
  // the first copy crashed: its process is gone
  const c = acquire(dir, { pid: 1003, isAlive: () => true });
  const d = acquire(dir, { pid: 1004, isAlive: () => false });
  assert.ok(!d.error, 'a lock of a process that is gone is taken over');
  d.release(); c.release();
  // a heartbeat older than a minute
  const t0 = Date.now();
  acquire(dir, { pid: 1005, now: () => t0, isAlive: () => true });
  const e = acquire(dir, { pid: 1006, now: () => t0 + STALE_MS + 1, isAlive: () => true });
  assert.ok(!e.error, 'a lock nobody has refreshed for a minute is taken over');
  // the same process number after a restart (a container that always starts as the same number)
  const f = acquire(dir, { pid: 1006, isAlive: () => true });
  assert.ok(!f.error);
  // an unreadable lock file is treated as left over
  fs.writeFileSync(path.join(dir, 'server.lock'), 'garbage');
  assert.ok(!acquire(dir, { pid: 1007 }).error);
});

test('a second real server writes nothing: it passes requests to the first, and stops when the first is gone', { timeout: 90000 }, async (t) => {
  const { spawn } = require('node:child_process');
  const dir = tmp();
  const run = (port) => spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDENT_DETAILS_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  const first = run(45871);
  await new Promise((r) => setTimeout(r, 3000));
  const second = run(45872);
  t.after(() => { first.kill(); second.kill(); });
  await new Promise((r) => setTimeout(r, 2000));
  const owner = () => JSON.parse(fs.readFileSync(path.join(dir, 'server.lock'), 'utf8')).pid;
  assert.strictEqual(owner(), first.pid, 'the lock stays with the first copy');
  // Many requests at once through the second copy, answered by the first.
  const answers = await Promise.all(Array.from({ length: 40 }, () => fetch('http://127.0.0.1:45872/healthz').then(async (r) => r.status + ' ' + await r.text())));
  assert.deepStrictEqual([...new Set(answers)], ['200 {"ok":true}']);
  // The same answer as from the first copy, with a refusal staying a refusal and a posted body arriving.
  assert.strictEqual((await fetch('http://127.0.0.1:45872/api/users')).status, 401);
  const post = (port) => fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nobody', password: 'wrong-password' }) }).then(async (r) => r.status + ' ' + await r.text());
  assert.strictEqual(await post(45872), await post(45871));
  assert.strictEqual(owner(), first.pid);
  // The first copy goes away: the second says so once and stops, so the host can start a fresh one.
  const left = new Promise((r) => second.on('exit', r));
  first.kill('SIGKILL');
  await new Promise((r) => first.on('exit', r));
  const last = await fetch('http://127.0.0.1:45872/healthz').then((r) => r.status, () => 'closed');
  assert.ok(last === 503 || last === 'closed', String(last));
  assert.strictEqual(await left, 1);
});
