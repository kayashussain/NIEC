const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { acquire, STALE_MS } = require('../student-details/instance-lock');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-lock-'));

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

test('only one real server starts on one data folder', { timeout: 60000 }, async () => {
  const { spawn } = require('node:child_process');
  const dir = tmp();
  const run = (port) => spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
  const first = run(45871);
  await new Promise((r) => setTimeout(r, 3000));
  const second = run(45872);
  let err = ''; second.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((r) => second.on('exit', r));
  first.kill();
  assert.strictEqual(code, 1);
  assert.match(err, /already running/);
});
