// Under a folder of the domain (NIEC_BASE_PATH=/niec, the live server), the phone's Home Screen app and a tapped notification open
// the portal's own pages inside the folder, never the domain's root (review, 28 Nov 2026).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the Home Screen app starts, stays and finds its icons inside /niec', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-basepath-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, NIEC_BASE_PATH: '/niec', SR360_SKIP_VERSION_BACKUP: '1', PARTNER_REFRESH: 'off', NAVITAS_TOOLKIT: 'off', COURSE_WATCH: 'off' }, stdio: 'ignore',
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(base + '/niec/healthz')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const m = await (await fetch(base + '/niec/manifest.webmanifest')).json();
  assert.strictEqual(m.start_url, '/niec/today');
  assert.strictEqual(m.scope, '/niec/');
  assert.deepStrictEqual(m.icons.map((i) => i.src), ['/niec/apple-touch-icon.png', '/niec/favicon.png']);
  const pairing = await (await fetch(base + '/niec/manifest.webmanifest?pair=abcdefghijklmnopqrstuvwx')).json();
  assert.strictEqual(pairing.start_url, '/niec/pair?t=abcdefghijklmnopqrstuvwx');
});

test('a tapped notification opens its page inside the folder the service worker was installed from', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'student-details', 'sw.js'), 'utf8');
  const tap = async (scope, url) => {
    const handlers = {};
    const opened = [];
    const self = {
      registration: { scope, pushManager: { getSubscription: async () => null } },
      location: { origin: new URL(scope).origin },
      clients: { openWindow: async (u) => { opened.push(u); return null; } },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: () => {},
    };
    const ctx = { self, URL, Promise, JSON, fetch: async () => ({ ok: true, json: async () => ({}) }), caches: { open: async () => ({ put: async () => {}, match: async () => null }) }, console, setTimeout, indexedDB: undefined };
    vm.runInNewContext(source, ctx);
    const waits = [];
    handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p) => waits.push(p) });
    await Promise.allSettled(waits);
    return opened[0];
  };
  assert.strictEqual(await tap('https://example.com/niec/', '/wa?n=9779800000000&name=Asha'), 'https://example.com/niec/wa?n=9779800000000&name=Asha');
  assert.strictEqual(await tap('https://example.com/niec/', '/niec/today'), 'https://example.com/niec/today', 'never twice');
  assert.strictEqual(await tap('https://example.com/', '/today'), 'https://example.com/today', 'at the domain root nothing changes');
});
