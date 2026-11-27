// No data may be lost when new code goes live (the owner, 27 Nov 2026): see student-details/version-guard.js.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const guard = require('../student-details/version-guard');
const { createFacts } = require('../student-details/facts');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-guard-'));
const write = (dir, name, value) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value)); };
const sheet = (rows) => ({ revision: 3, activeSheetId: 's1', sheets: [{ id: 's1', name: 'Jan', columns: ['FIRST NAME', 'LAST NAME', 'FEEDBACK 1'], rows }] });
const ASHA = { _id: 'r1', 'FIRST NAME': 'Asha', 'LAST NAME': 'Rai', 'FEEDBACK 1': 'Good' };
const BINOD = { _id: 'r2', 'FIRST NAME': 'Binod', 'LAST NAME': 'Karki', 'FEEDBACK 1': '' };
const copies = (dir) => { try { return fs.readdirSync(path.join(dir, guard.FOLDER)); } catch (e) { return []; } };

test('new code copies every data file first, once, and keeps the newest copies only', () => {
  const dir = tmp(); const money = tmp();
  write(dir, 'data.json', sheet([ASHA])); write(dir, 'users.json', { users: [] }); write(dir, 'session-secret', 'k'); write(dir, 'app.js', 'code');
  write(money, 'commissions.json', { a: 1 });
  const run = (print, minute) => guard.copyBeforeNewVersion({ dataDir: dir, incentiveDir: money, fingerprint: print.repeat(64), now: () => new Date(Date.UTC(2026, 10, 27, 1, minute)) });
  const first = run('a', 0);
  assert.deepStrictEqual(fs.readdirSync(first.folder).sort(), ['counselor-incentive', 'data.json', 'session-secret', 'users.json']);
  assert.strictEqual(fs.readFileSync(path.join(first.folder, 'data.json'), 'utf8'), fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(first.folder, 'counselor-incentive', 'commissions.json')));
  assert.strictEqual(run('a', 1), null, 'the same code starting again makes no copy');
  assert.strictEqual(copies(dir).length, 1);
  for (let i = 0; i < guard.KEEP + 3; i += 1) run('bc'[i % 2], i + 2);
  assert.strictEqual(copies(dir).length, guard.KEEP);
});

test('a copy that cannot be made throws and is tried again at the next start', () => {
  const dir = tmp();
  write(dir, 'data.json', sheet([ASHA]));
  write(dir, guard.FOLDER, 'a file where the folder belongs');
  const run = () => guard.copyBeforeNewVersion({ dataDir: dir, incentiveDir: null, fingerprint: 'd'.repeat(64) });
  assert.throws(run);
  fs.rmSync(path.join(dir, guard.FOLDER));
  assert.ok(run().folder);
});

test('what disappeared after a start is listed by name, never by value, and ordinary changes are not', () => {
  const dir = tmp();
  write(dir, 'data.json', sheet([ASHA, BINOD]));
  write(dir, 'cards.json', { cards: { r1: { tasks: [{ id: 't1', title: 'Send offer' }, { id: 't2', title: 'Call' }] } } });
  write(dir, 'users.json', { users: [{ id: 'u1', name: 'Sita', password: 'secret-hash' }] });
  const { folder } = guard.copyBeforeNewVersion({ dataDir: dir, incentiveDir: null, fingerprint: 'e'.repeat(64) });
  const check = () => guard.compareWithCopy(folder, dir, null);
  assert.deepStrictEqual(check(), []);
  const moved = sheet([{ ...ASHA, 'FEEDBACK 1': 'Better' }]);
  moved.sheets.push({ id: 's2', name: 'May', columns: [], rows: [BINOD] });
  write(dir, 'data.json', moved);
  assert.deepStrictEqual(check(), [], 'a changed value and a student moved to another intake are ordinary work');
  write(dir, 'data.json', sheet([{ ...ASHA, 'FEEDBACK 1': '' }]));
  write(dir, 'cards.json', { cards: { r1: { tasks: [{ id: 't1', title: 'Send offer' }] } } });
  write(dir, 'users.json', { users: [{ id: 'u1', name: 'Sita', password: '' }] });
  const lines = check().join('\n');
  assert.match(lines, /Students: 1 removed \(students › Binod Karki\)/);
  assert.match(lines, /students › Asha Rai › FEEDBACK 1/);
  assert.match(lines, /Student cards and tasks: 1 removed \(cards › Asha Rai › tasks › Call\)/);
  assert.match(lines, /Sita › password/);
  assert.ok(!/secret-hash|Good/.test(lines), 'no values');
  fs.rmSync(path.join(dir, 'cards.json'));
  write(dir, 'users.json', '{ broken');
  assert.match(check().join('\n'), /Student cards and tasks: the file is gone/);
  assert.match(check().join('\n'), /Accounts: the file cannot be read now/);
});

test('an empty data folder is refused while the folder used before still holds the students', () => {
  const app = tmp(); const real = tmp(); const empty = tmp();
  const code = path.join(app, 'student-details');
  fs.mkdirSync(code);
  const markerFile = path.join(code, '.data-folder');
  write(real, 'data.json', sheet([ASHA])); write(app, 'demo-data/data.json', sheet([ASHA]));
  const tmpElsewhere = path.join(app, 'nowhere'); // the test's folders stand for real ones
  const wrong = (dataDir) => guard.wrongDataFolder({ dataDir, markerFile, tmp: tmpElsewhere });
  assert.strictEqual(wrong(empty), '', 'a first installation starts');
  assert.strictEqual(guard.rememberDataFolder({ dataDir: path.join(app, 'demo-data'), markerFile, tmp: tmpElsewhere }), false, 'demo data inside the app folder is not remembered');
  assert.strictEqual(guard.rememberDataFolder({ dataDir: real, markerFile }), false, 'a throwaway folder is not remembered');
  assert.strictEqual(guard.rememberDataFolder({ dataDir: real, markerFile, tmp: tmpElsewhere }), true);
  assert.match(wrong(empty), /STUDENT_DETAILS_DATA_DIR/);
  assert.match(wrong(code), /STUDENT_DETAILS_DATA_DIR/, 'the setting is lost: the code folder has no students');
  assert.strictEqual(wrong(real), '');
  assert.strictEqual(guard.wrongDataFolder({ dataDir: empty, markerFile }), '', 'a throwaway folder, as the tests use, always starts');
  write(empty, 'data.json', sheet([]));
  assert.strictEqual(wrong(empty), '', 'a folder with its own students is allowed');
});

test('a temporary folder named another way is still a temporary one', () => {
  const app = tmp(); const real = tmp(); const system = tmp();
  const markerFile = path.join(app, 'student-details', '.data-folder');
  const other = path.join(tmp(), 'other-name'); // a second name for one folder, as KAYAS_~1 is on Windows
  fs.symlinkSync(system, other, 'junction');
  write(real, 'data.json', sheet([ASHA])); write(system, 'demo/data.json', sheet([ASHA])); write(app, 'student-details/.data-folder', real);
  for (const [dataDir, tmpDir] of [[path.join(system, 'demo'), other], [path.join(other, 'demo'), system]]) {
    assert.strictEqual(guard.rememberDataFolder({ dataDir, markerFile, tmp: tmpDir }), false);
  }
  assert.strictEqual(guard.wrongDataFolder({ dataDir: path.join(other, 'not-made-yet'), markerFile, tmp: system }), '');
  assert.strictEqual(guard.wrongDataFolder({ dataDir: path.join(system, 'not-made-yet'), markerFile, tmp: other }), '');
  assert.strictEqual(fs.readFileSync(markerFile, 'utf8'), real);
});

test('the code fingerprint follows the code, not the data beside it', () => {
  const root = tmp();
  write(root, 'student-details/server.js', 'one'); write(root, 'student-details/data.json', '{}');
  const first = guard.codeFingerprint(root);
  write(root, 'student-details/data.json', '{"a":1}');
  assert.strictEqual(guard.codeFingerprint(root), first);
  write(root, 'student-details/server.js', 'two');
  assert.notStrictEqual(guard.codeFingerprint(root), first);
});

test('new university details in the code never replace a newer weekly reading on the live server', () => {
  const dir = tmp(); const file = path.join(dir, 'fact-file.json');
  createFacts(dir).list();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [fresh, old] = data.universities.filter((u) => u.profile && !u.profile.own && u.profile.courses.length);
  const mine = [{ ...fresh.profile.courses[0], name: 'Read on the live server' }];
  fresh.profile = { ...fresh.profile, courses: mine, readAt: '2099-01-01T00:00:00.000Z' };
  old.profile = { ...old.profile, courses: mine, readAt: '2000-01-01T00:00:00.000Z' };
  data.partnersApplied = 'an earlier version';
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  const after = createFacts(dir);
  assert.deepStrictEqual(after.get(fresh.id).profile.courses.map((c) => c.name), ['Read on the live server']);
  assert.strictEqual(after.get(fresh.id).profile.readAt, '2099-01-01T00:00:00.000Z');
  assert.notStrictEqual(after.get(old.id).profile.courses[0].name, 'Read on the live server', 'an older reading gives way to the newer details');
});

test('the real server copies the data before a new version starts, and refuses to start when it cannot', { timeout: 90000 }, async (t) => {
  const run = (dir, port) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDENT_DETAILS_DATA_DIR: dir, COURSE_WATCH: 'off', PARTNER_REFRESH: 'off', NAVITAS_TOOLKIT: 'off' } });
    child.said = '';
    child.stdout.on('data', (d) => { child.said += d; }); child.stderr.on('data', (d) => { child.said += d; });
    child.ended = new Promise((r) => child.on('exit', r));
    t.after(() => child.kill());
    return child;
  };
  const up = async (child) => { for (let i = 0; i < 200 && !/running at/.test(child.said); i += 1) await new Promise((r) => setTimeout(r, 100)); assert.match(child.said, /running at/, child.said); };

  const dir = tmp();
  const before = JSON.stringify(sheet([ASHA]));
  write(dir, 'data.json', before);
  const good = run(dir, 45881);
  await up(good);
  const [copy] = copies(dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, guard.FOLDER, copy, 'data.json'), 'utf8'), before, 'the copy is the data as it was before anything ran');
  assert.match(fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8'), /Copy made before the new version/);
  good.kill(); await good.ended;

  const blocked = tmp();
  write(blocked, 'data.json', before); write(blocked, guard.FOLDER, 'in the way');
  const bad = run(blocked, 45882);
  assert.strictEqual(await bad.ended, 1);
  assert.match(bad.said, /not started/);
  assert.strictEqual(fs.readFileSync(path.join(blocked, 'data.json'), 'utf8'), before, 'nothing was changed');
});
