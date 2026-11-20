// The university pages' pictures kept on our own server (the owner, 20 Nov 2026: no empty slides, a system that lasts). No real
// site is reached here: the answers are made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createMediaCache, pictureAddresses, sizeOf } = require('../student-details/media-cache');

// A real PNG of the given size (one grey row repeated), so the size check reads it.
function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 128); for (let y = 0; y < h; y += 1) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-media-'));
const PIC = 'https://pictures.example.org/campus.png';

test('a picture of a university page is fetched once, kept, and served from the data folder', async () => {
  const dir = tmp();
  let calls = 0;
  const body = png(800, 450);
  const fetchImpl = async () => { calls += 1; return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }); };
  const m = createMediaCache({ dir, allowed: () => new Set([PIC]), fetchImpl });
  const a = await m.get(PIC);
  const b = await m.get(PIC);
  assert.strictEqual(a.type, 'image/png');
  assert.strictEqual(b.buf.length, body.length);
  assert.strictEqual(calls, 1, 'fetched once');
  assert.deepStrictEqual(sizeOf(body), { w: 800, h: 450 });
});

test('only the pictures written on the pages are fetched, and a page, a tiny image or a failure is refused', async () => {
  const dir = tmp();
  const answers = { [PIC]: () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'https://pictures.example.org/dot.png': () => new Response(png(1, 1), { status: 200, headers: { 'content-type': 'image/png' } }) };
  const asked = [];
  const fetchImpl = async (u) => { asked.push(u); return answers[u](); };
  const m = createMediaCache({ dir, allowed: () => new Set(Object.keys(answers)), fetchImpl });
  assert.strictEqual(await m.get('https://elsewhere.example.org/secret.png'), null);
  assert.ok(!asked.includes('https://elsewhere.example.org/secret.png'), 'an address not on a page is never fetched');
  assert.strictEqual(await m.get(PIC), null, 'a web page instead of a picture');
  assert.strictEqual(await m.get('https://pictures.example.org/dot.png'), null, 'a tracking pixel');
  await m.get(PIC);
  assert.strictEqual(asked.filter((u) => u === PIC).length, 1, 'a failure is not asked again the same day');
});

test('the addresses come from the logos, covers, pictures and video stills of the pages', () => {
  const set = pictureAddresses([{ profile: { logo: 'data:image/png;base64,AAAA', banner: 'https://a.example.org/1.jpg', photos: ['https://a.example.org/2.jpg'], video: 'https://www.youtube.com/embed/abcdefghijk' } }, { name: 'no profile' }]);
  assert.deepStrictEqual([...set].sort(), ['https://a.example.org/1.jpg', 'https://a.example.org/2.jpg', 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg']);
});

test('a redirect to our own network is refused, an SVG logo is served as a picture only, and unused pictures are taken away', async () => {
  const dir = tmp();
  const LOGO = 'https://pictures.example.org/logo.svg';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#06c"/><text x="10" y="40">Made-up University</text></svg>';
  const answers = {
    [PIC]: () => new Response(null, { status: 302, headers: { location: 'https://192.168.1.10/inside.png' } }),
    [LOGO]: () => new Response(svg + ' '.repeat(400), { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
  };
  const asked = [];
  let pages = new Set(Object.keys(answers));
  const m = createMediaCache({ dir, allowed: () => pages, fetchImpl: async (u) => { asked.push(u); return answers[u](); } });
  assert.strictEqual(await m.get(PIC), null);
  assert.ok(!asked.includes('https://192.168.1.10/inside.png'), 'never fetched');
  const res = { head: null, body: null, writeHead(code, h) { this.head = { code, ...h }; }, end(b) { this.body = b; } };
  await m.serve({ url: `/api/media?u=${encodeURIComponent(LOGO)}` }, res);
  assert.strictEqual(res.head.code, 200);
  assert.match(res.head['Content-Security-Policy'], /default-src 'none'/);
  pages = new Set([PIC]);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(m.prune() >= 2, 'the logo and its note are taken away once no page uses it');
});
