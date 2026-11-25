// The portal under a folder of a domain (NIEC_BASE_PATH=/niec): addresses move under the folder; with the setting empty nothing changes.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { wrap, normalize, rewriteText, moveLocation, isAddress } = require('../student-details/base-path');

test('normalize', () => {
  assert.strictEqual(normalize(''), '');
  assert.strictEqual(normalize('/'), '');
  assert.strictEqual(normalize('niec'), '/niec');
  assert.strictEqual(normalize('\\niec\\'), '/niec');
});

test('rewrite moves root addresses, leaves the rest', () => {
  const out = rewriteText("fetch('/api/x'); a = x || '/'; s.split('/'); u = '//cdn.example'; b = '/niec/api/y'; css = url(/f.woff2)", '/niec', 'js');
  assert.ok(out.includes("'/niec/api/x'") && out.includes("|| '/niec/'") && out.includes("split('/')") && out.includes("'//cdn.example'"));
  assert.ok(out.includes("'/niec/api/y'") && !out.includes('/niec/niec') && out.includes('url(/niec/f.woff2)'));
});

test('redirects and next move under the folder', () => {
  assert.strictEqual(moveLocation('/login?next=%2Fstudents', '/niec'), '/niec/login?next=%2Fniec%2Fstudents');
  assert.strictEqual(moveLocation('/today', '/niec'), '/niec/today');
});

test('empty setting returns the handler itself', () => {
  const h = () => {};
  assert.strictEqual(wrap(h, ''), h);
});

test('a request under /niec is answered as /, and the answer is moved', async () => {
  const seen = [];
  const server = http.createServer(wrap((req, res) => {
    seen.push(req.url);
    if (req.url === '/go') { res.writeHead(302, { Location: '/today' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=1; Path=/; HttpOnly' });
    res.end('<html><head></head><body><a href="/students">x</a></body></html>');
  }, '/niec'));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const get = (p) => new Promise((resolve) => http.get({ port, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ r, b })); }));
  const page = await get('/niec/');
  assert.deepStrictEqual(seen, ['/']);
  assert.ok(page.b.includes('href="/niec/students"') && page.b.includes('/niec/__base-path.js'));
  assert.ok(/Path=\/niec\//.test(page.r.headers['set-cookie'][0]));
  assert.strictEqual(page.r.headers['content-length'], String(Buffer.byteLength(page.b)));
  const go = await get('/niec/go');
  assert.strictEqual(go.r.headers.location, '/niec/today');
  const patch = await get('/niec/__base-path.js');
  assert.ok(patch.b.includes('"/niec"'));
  server.close();
});

// Every file a browser loads, as it is on disk.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
function browserFiles() {
  const server = fs.readFileSync(path.join(root, 'student-details', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const { SHARED_FILES } = require('../shared/server-utils');
  const from = server.indexOf('const STATIC_FILES = {');
  const mine = [...server.slice(from, server.indexOf('};', from)).matchAll(/^\s*'\/([^']+)'\s*:/gm)].map((m) => 'student-details/' + m[1]);
  return [...mine, ...Object.keys(SHARED_FILES).map((k) => 'shared' + k), 'shared/login.html', 'counselor-incentive/index.html', 'counselor-incentive/unlock.html']
    .filter((f) => /\.(js|html|css)$/.test(f) && fs.existsSync(path.join(root, f))).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n')]);
}
const scripts = (f, text) => (f.endsWith('.js') ? [text] : f.endsWith('.html') ? [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]) : []);

test('every browser script still loads after its addresses are moved', () => {
  const files = browserFiles();
  assert.ok(files.length > 60, 'found the browser files');
  for (const [f, text] of files) {
    const moved = scripts(f, rewriteText(text, '/niec', f.split('.').pop()));
    const before = scripts(f, text);
    assert.strictEqual(moved.length, before.length, f);
    before.forEach((code, i) => {
      try { new vm.Script(code); } catch (e) { return; } // not a plain script (nothing the move could break)
      assert.doesNotThrow(() => new vm.Script(moved[i]), f + ' after the move');
    });
  }
});

test('text that is not an address is never changed', () => {
  const kept = ['s.replace(/"/g, \'&quot;\')', '(/<sheet\\b[^>]*\\br:id="([^"]+)"/.exec(x))', "save('notes/' + n.id + '/delete')",
    "y + '/data'", "x + '/partners'", "const ME = '/__device';"];
  for (const k of kept) assert.strictEqual(rewriteText(k, '/niec', 'js'), k);
  const own = "const BASE = location.pathname; fetch(BASE + p); p = '/api/data'";
  assert.strictEqual(rewriteText(own, '/niec', 'js'), own);
  assert.strictEqual(rewriteText('`${location.origin}/book/${slug}`', '/niec', 'js'), '`${location.origin}/niec/book/${slug}`');
  assert.strictEqual(rewriteText("location.origin + '/today'", '/niec', 'js'), "location.origin + '/niec/today'");
});

test('every address in the browser files is one the move knows', () => {
  // Starts that are not addresses: ends joined onto an address, a pattern, and a name kept inside the phone.
  const notAddresses = new Set(['data', 'delete', 'facts', 'g', '.exec', '__sr360-device']);
  const unknown = new Set();
  for (const [f, text] of browserFiles()) {
    for (const m of text.matchAll(/(["'`])\/(?=[A-Za-z_.-])/g)) {
      const rest = text.slice(m.index + 2, m.index + 82);
      const first = /^[A-Za-z0-9_.-]*/.exec(rest)[0];
      if (!isAddress(rest) && !notAddresses.has(first)) unknown.add(f + ': /' + first);
    }
  }
  assert.deepStrictEqual([...unknown], [], 'add a new page to ROUTES in student-details/base-path.js');
});
