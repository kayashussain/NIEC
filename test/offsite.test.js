// Off-site backup: encrypted before it leaves, sent once, retried after a failure, and never sent without a passphrase.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { createOffsite, settingsFrom, encrypt, decrypt } = require('../student-details/offsite');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-offsite-'));

function fakeBucket() {
  const store = new Map(); let fail = false; const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      if (fail) { res.writeHead(503); return res.end('Slow down'); }
      store.set(decodeURIComponent(req.url), Buffer.concat(chunks)); res.writeHead(200); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ store, seen, setFail: (v) => { fail = v; }, close: () => server.close(), endpoint: `http://127.0.0.1:${server.address().port}` })));
}

test('encrypt and decrypt: only the right passphrase opens it, and a changed byte is noticed', () => {
  const blob = encrypt(Buffer.from('student data'), 'a long secret');
  assert.ok(!blob.includes(Buffer.from('student data')), 'nothing readable leaves the server');
  assert.strictEqual(decrypt(blob, 'a long secret').toString(), 'student data');
  assert.throws(() => decrypt(blob, 'another secret'), /Wrong passphrase/);
  const bad = Buffer.from(blob); bad[bad.length - 1] ^= 1;
  assert.throws(() => decrypt(bad, 'a long secret'), /Wrong passphrase, or the file is damaged/);
  assert.throws(() => decrypt(Buffer.from('nope'), 'x'), /not a Student Recruit 360 backup/);
});

test('without all the settings (above all the passphrase) nothing is switched on', () => {
  const all = { NIEC_OFFSITE_ENDPOINT: 'https://x', NIEC_OFFSITE_BUCKET: 'b', NIEC_OFFSITE_ACCESS_KEY: 'a', NIEC_OFFSITE_SECRET_KEY: 's', NIEC_OFFSITE_PASSPHRASE: 'p' };
  assert.ok(settingsFrom(all));
  Object.keys(all).forEach((k) => { const { [k]: gone, ...rest } = all; assert.strictEqual(settingsFrom(rest), null, k + ' missing'); });
  assert.strictEqual(createOffsite(tmp(), null).enabled(), false);
});

test('every backup is sent encrypted once; a failure is said once and the next check sends it', async (t) => {
  const bucket = await fakeBucket(); t.after(() => bucket.close());
  const dir = tmp(); fs.mkdirSync(path.join(dir, 'daily-backups'));
  const plain = zlib.gzipSync(JSON.stringify({ students: 'REAL STUDENT NAMES' }));
  fs.writeFileSync(path.join(dir, 'daily-backups', 'niec-daily-2026-11-22.json.gz'), plain);
  fs.writeFileSync(path.join(dir, 'daily-backups', 'niec-manual-2026-11-22-101500.json.gz'), plain);
  fs.writeFileSync(path.join(dir, 'daily-backups', 'notes.txt'), 'not a backup');
  const said = [];
  const o = createOffsite(dir, { endpoint: bucket.endpoint, bucket: 'isr', region: 'eu-west-2', accessKey: 'AK', secretKey: 'SK', passphrase: 'pass', prefix: 'isr-backups' }, { record: (x) => said.push(x) });
  assert.strictEqual(o.status().waiting, 2);

  bucket.setFail(true);
  assert.strictEqual((await o.sync()).sent, 0);
  assert.strictEqual((await o.sync()).sent, 0);
  assert.strictEqual(said.length, 1, 'the failure is written once, not at every try');
  assert.match(o.status().lastError, /503/);
  assert.strictEqual(o.status().waiting, 2);

  bucket.setFail(false);
  assert.strictEqual((await o.sync()).sent, 2);
  assert.strictEqual(o.status().waiting, 0);
  assert.strictEqual(o.status().lastError, '');
  const keys = [...bucket.store.keys()].sort();
  assert.deepStrictEqual(keys, ['/isr/isr-backups/niec-daily-2026-11-22.json.gz.enc', '/isr/isr-backups/niec-manual-2026-11-22-101500.json.gz.enc']);
  const sent = bucket.store.get(keys[0]);
  assert.ok(!sent.includes(Buffer.from('REAL STUDENT NAMES')) && !sent.includes(plain), 'encrypted, not the plain copy');
  assert.ok(decrypt(sent, 'pass').equals(plain), 'and it opens to exactly the backup');
  assert.ok(bucket.seen.every((r) => r.method === 'PUT' && /^AWS4-HMAC-SHA256 Credential=AK\//.test(r.auth)));

  const before = bucket.seen.length;
  assert.strictEqual((await o.sync()).sent, 0);
  assert.strictEqual(bucket.seen.length, before, 'a copy already sent is not sent again');
  said.length = 0; bucket.setFail(true);
  fs.writeFileSync(path.join(dir, 'daily-backups', 'niec-daily-2026-11-23.json.gz'), plain);
  await o.sync();
  assert.strictEqual(said.length, 1, 'a later failure is said again');
});

test('the status never holds a key or the passphrase', () => {
  const o = createOffsite(tmp(), { endpoint: 'http://x', bucket: 'isr', region: 'r', accessKey: 'AKSECRET', secretKey: 'SKSECRET', passphrase: 'PPSECRET', prefix: 'p' });
  assert.ok(!/SECRET/.test(JSON.stringify(o.status())));
});
