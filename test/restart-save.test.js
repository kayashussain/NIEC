// A restart (an upload of new code) no longer refuses the saves of pages that were a few saves behind (the owner, 28 Nov 2026: no
// typed work lost at an upload): the recent revisions are kept on disk when the server stops and read back when it starts.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const S = 'APPLICATION STATUS';

test('a page a few saves behind still saves after the server restarts', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-restart-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let server = null;
  const start = async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, SR360_SKIP_VERSION_BACKUP: '1', PARTNER_REFRESH: 'off', NAVITAS_TOOLKIT: 'off', COURSE_WATCH: 'off' }, stdio: 'ignore',
    });
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(base + '/healthz')).ok) return; } catch (e) { /* not up yet */ } await wait(250); }
    throw new Error('the server did not start');
  };
  const stop = () => new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
  t.after(() => { try { server.kill('SIGKILL'); } catch (e) { /* gone */ } });
  await start();

  let cookie = '';
  const admin = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  assert.strictEqual((await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' })).status, 200);
  assert.strictEqual((await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' })).status, 200);

  let wb = (await admin('GET', '/api/data')).json;
  const blank = Object.fromEntries(wb.sheets[0].columns.map((c) => [c, '']));
  wb.sheets[0].rows = [{ ...blank, _id: 'r1', 'FIRST NAME': 'Asha', [S]: 'Inquiry' }, { ...blank, _id: 'r2', 'FIRST NAME': 'Bina', [S]: 'Inquiry' }];
  assert.strictEqual((await admin('POST', '/api/data', { sheets: wb.sheets, activeSheetId: wb.activeSheetId, baseRevision: wb.revision })).status, 200);

  const behind = (await admin('GET', '/api/data')).json; // a page that then waits with an unsaved edit
  // Three more saves from another tab, so the waiting page is several revisions behind.
  for (const remark of ['one', 'two', 'three']) {
    wb = (await admin('GET', '/api/data')).json;
    wb.sheets[0].rows[0].REMARKS = remark;
    assert.strictEqual((await admin('POST', '/api/data', { sheets: wb.sheets, activeSheetId: wb.activeSheetId, baseRevision: wb.revision })).status, 200);
  }

  await stop(); // the upload
  assert.ok(fs.existsSync(path.join(dir, 'recent-revisions.json.gz')), 'the recent revisions are kept when the server stops');
  await start();
  // (the login survives the restart: sessions are kept on disk)

  // The waiting page saves its edit of the other student, based on the revision from before the three saves.
  const mine = JSON.parse(JSON.stringify(behind));
  mine.sheets[0].rows[1].REMARKS = 'typed before the upload';
  const saved = await admin('POST', '/api/data', { sheets: mine.sheets, activeSheetId: mine.activeSheetId, baseRevision: behind.revision });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  const now = (await admin('GET', '/api/data')).json.sheets[0].rows;
  assert.strictEqual(now[1].REMARKS, 'typed before the upload', 'the waiting edit is saved');
  assert.strictEqual(now[0].REMARKS, 'three', 'the other tab\'s saves stay');
});
