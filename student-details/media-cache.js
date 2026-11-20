// The pictures of the university pages, kept on our own server (the owner, 21 Nov 2026: no black, white or empty slides, a system
// that lasts for years). A cover picture, a gallery picture or a logo comes from a partner or a university's website; such a site
// can be slow, limit how often it answers, block other sites from showing its pictures, or remove a picture. So each picture is
// fetched once by the server, checked (a real picture of a sensible size, not a page or a tiny icon) and kept in the data folder
// (media-cache/), then served from there to every browser. A picture that cannot be fetched is answered with "not found", and the
// page leaves that slide out; it is tried again a day later.
//
// Only the pictures written on the university pages are fetched (never any address a browser asks for), so this is not an open
// door to the internet. The folder is a cache: deleting it only means each picture is fetched again the next time it is shown.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 8 * 1024 * 1024; // larger than any sensible web picture
const RETRY_MS = 24 * 3600 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

// The width and height written in a picture's first bytes (PNG, JPEG, GIF, WebP), or null.
function sizeOf(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const m = buf[i + 1];
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (e) { /* not readable: no size */ }
  return null;
}

// `allowed()`: the picture addresses on the university pages (a Set). `fetchImpl`: fetch, replaced in tests.
function createMediaCache({ dir, allowed, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const folder = path.join(dir, 'media-cache');
  const keyOf = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 32);
  const busy = new Map();
  let allowCache = { at: 0, set: new Set() };
  const isAllowed = (u) => {
    if (now() - allowCache.at > 60000) allowCache = { at: now(), set: allowed() };
    return allowCache.set.has(u);
  };
  async function fetchOne(u, key) {
    const failFile = path.join(folder, `${key}.fail`);
    try { if (now() - fs.statSync(failFile).mtimeMs < RETRY_MS) return null; } catch (e) { /* never failed */ }
    const fail = (why) => { try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(failFile, why); } catch (e) { /* the next try asks again */ } return null; };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetchImpl(u, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' }, redirect: 'follow', signal: ctrl.signal });
      clearTimeout(timer);
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !TYPES[type]) return fail(`${res.status} ${type}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 600 || buf.length > MAX) return fail(`size ${buf.length}`);
      const size = sizeOf(buf);
      // A picture smaller than an icon is not a picture to show (a tracking pixel, a broken image).
      if (size && (size.w < 48 || size.h < 48)) return fail(`tiny ${size.w}x${size.h}`);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, key), buf);
      fs.writeFileSync(path.join(folder, `${key}.json`), JSON.stringify({ url: u, type, w: size && size.w, h: size && size.h, at: new Date(now()).toISOString() }));
      try { fs.unlinkSync(failFile); } catch (e) { /* none */ }
      return { buf, type };
    } catch (e) { return fail(e.name === 'AbortError' ? 'timeout' : e.message); }
  }
  // The picture for an address of a university page: { buf, type } or null.
  async function get(u) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) || !isAllowed(u)) return null;
    const key = keyOf(u);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(folder, `${key}.json`), 'utf8'));
      return { buf: fs.readFileSync(path.join(folder, key)), type: meta.type };
    } catch (e) { /* not kept yet */ }
    if (!busy.has(key)) busy.set(key, fetchOne(u, key).finally(() => busy.delete(key)));
    return busy.get(key);
  }
  // GET /api/media?u=<address>
  async function serve(req, res) {
    const u = new URL(req.url, 'http://x').searchParams.get('u') || '';
    const got = await get(u);
    if (!got) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('No such picture'); return; }
    res.writeHead(200, { 'Content-Type': got.type, 'Content-Length': got.buf.length, 'Cache-Control': 'private, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(got.buf);
  }
  return { get, serve, sizeOf };
}

// Every picture address written on the university pages.
function pictureAddresses(universities) {
  const set = new Set();
  (universities || []).forEach((u) => {
    const p = u && u.profile;
    if (!p) return;
    [p.logo, p.banner, ...(p.photos || [])].forEach((x) => { if (/^https:\/\//.test(String(x || ''))) set.add(x); });
    // the still picture of its YouTube video, shown before the video is played
    const vid = (/embed\/([\w-]{11})/.exec(String(p.video || '')) || [])[1];
    if (vid) set.add(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`);
  });
  return set;
}

module.exports = { createMediaCache, pictureAddresses, sizeOf };
