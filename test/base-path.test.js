// The portal under a folder of a domain (NIEC_BASE_PATH=/niec): addresses move under the folder; with the setting empty nothing changes.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { wrap, normalize, rewriteText, moveLocation } = require('../student-details/base-path');

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
