// The pictures of the university pages, kept on our own server (the owner, 20 Nov 2026: no black, white or empty slides, a system
// that lasts for years). A cover picture, a gallery picture or a logo comes from a partner or a university's website; such a site
// can be slow, limit how often it answers, block other sites from showing its pictures, or remove a picture. So each picture is
// fetched once by the server, checked (a real picture of a sensible size, not a page or a tiny icon) and kept in the data folder
// (media-cache/), then served from there to every browser. A picture the server cannot fetch is left to the browser at its own
// address, and the page leaves that slide out if it fails there too; the server tries it again a day later.
//
// Only the pictures written on the university pages are fetched (never any address a browser asks for), so this is not an open
// door to the internet. The folder is a cache: deleting it only means each picture is fetched again the next time it is shown.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');

const MAX = 8 * 1024 * 1024; // larger than any sensible web picture
const KEEP_MAX = 3 * 1024 * 1024; // a larger picture is not kept (the browser is sent to its own address), so the folder stays small
const RETRY_MS = 24 * 3600 * 1000;
const BUSY_RETRY_MS = 3600 * 1000; // a site that was busy (429, 5xx) is asked again after an hour
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
// An address on our own network or this computer is never fetched (a page's picture can only be on the public internet).
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
// Every address a name points to is checked too (a public name can point inside, and an address can be written many ways).
const BLOCK = new net.BlockList();
[['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8], ['224.0.0.0', 4], ['240.0.0.0', 4]].forEach(([a, n]) => BLOCK.addSubnet(a, n, 'ipv4'));
[['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10]].forEach(([a, n]) => BLOCK.addSubnet(a, n, 'ipv6'));
async function reachable(u, lookup) {
  let host;
  try { host = new URL(u).hostname.replace(/^\[|\]$/g, ''); } catch (e) { return false; }
  if (/^\d+$/.test(host) || /^0x/i.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host)) return false; // 2130706433, 0x7f.0.0.1
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true }); } catch (e) { return false; }
  // An IPv4 address written inside IPv6 (::ffff:127.0.0.1) is checked as the IPv4 address it is.
  const plain = (a) => { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a.address); return m ? { address: m[1], family: 4 } : a; };
  return addrs.length > 0 && addrs.map(plain).every((a) => !BLOCK.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
}
const publicHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !PRIVATE.test(x.hostname) && !/\.(local|internal|lan)$/i.test(x.hostname); } catch (e) { return false; } };

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
function createMediaCache({ dir, allowed, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), lookup = dns.promises.lookup }) {
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
    try { const f = fs.statSync(failFile); const busyFail = /^(429|5\d\d) /.test(fs.readFileSync(failFile, 'utf8')); if (now() - f.mtimeMs < (busyFail ? BUSY_RETRY_MS : RETRY_MS)) return null; } catch (e) { /* never failed */ }
    const fail = (why) => { try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(failFile, why); } catch (e) { /* the next try asks again */ } return null; };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // the whole fetch, the picture's bytes included
    try {
      // Redirects are followed by hand, each new address checked again (never to our own network).
      let at = u; let res = null;
      for (let hop = 0; hop < 4; hop += 1) {
        if (!publicHttps(at) || !(await reachable(at, lookup))) return fail('not a public address');
        res = await fetchImpl(at, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*' }, redirect: 'manual', signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { at = new URL(res.headers.get('location'), at).href; continue; }
        break;
      }
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !TYPES[type]) return fail(`${res.status} ${type}`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > MAX) return fail(`size ${declared}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 300 || buf.length > MAX) return fail(`size ${buf.length}`);
      const size = type === 'image/svg+xml' ? null : sizeOf(buf);
      // A picture smaller than an icon is not a picture to show (a tracking pixel, a broken image); a wide logo (262 x 45) is fine.
      if (size && (size.w * size.h < 48 * 48 || Math.max(size.w, size.h) < 64)) return fail(`tiny ${size.w}x${size.h}`);
      if (buf.length > KEEP_MAX) return fail('too large to keep'); // shown from its own address instead
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, key), buf);
      fs.writeFileSync(path.join(folder, `${key}.json`), JSON.stringify({ url: u, type, w: size && size.w, h: size && size.h, at: new Date(now()).toISOString() }));
      try { fs.unlinkSync(failFile); } catch (e) { /* none */ }
      return { buf, type };
    } catch (e) { return fail(e.name === 'AbortError' ? 'timeout' : e.message); } finally { clearTimeout(timer); }
  }
  // Takes away the kept pictures no page uses any more (run now and then; the folder never grows without end).
  function prune() {
    let names = [];
    try { names = fs.readdirSync(folder); } catch (e) { return 0; }
    const list = [...allowed()];
    if (!list.length) return 0; // the pages could not be read: keep everything rather than empty the folder
    const keep = new Set(list.map(keyOf));
    let removed = 0;
    names.forEach((name) => { const key = name.replace(/\.(json|fail)$/, ''); if (!keep.has(key)) { try { fs.unlinkSync(path.join(folder, name)); removed += 1; } catch (e) { /* already gone */ } } });
    return removed;
  }
  // The picture for an address of a university page: { buf, type } or null.
  async function get(u) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) || !isAllowed(u) || !publicHttps(u)) return null;
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
    if (!got) {
      // Not kept: an address that is not on a page is refused; a picture the server could not fetch is left to the browser at its own
      // address (some sites answer browsers but not servers), and the page drops the slide if that fails too.
      if (/^https:\/\/[^\s"'<>]+$/.test(u) && isAllowed(u) && publicHttps(u)) { res.writeHead(302, { Location: u, 'Cache-Control': 'no-store' }); res.end(); return; }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('No such picture'); return;
    }
    // An SVG logo is a picture only: no script of it may run, opened on its own or not.
    const svg = got.type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", 'Content-Disposition': 'inline' } : {};
    res.writeHead(200, { 'Content-Type': got.type, 'Content-Length': got.buf.length, 'Cache-Control': 'private, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff', ...svg });
    res.end(got.buf);
  }
  return { get, serve, prune, sizeOf };
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

// A server name that points inside (this computer, the office network, the cloud's own addresses), so nothing set up by a person may
// make the server connect there. A name that cannot be looked up is not called inside: connecting to it fails by itself.
async function pointsInside(host, lookup = dns.promises.lookup) {
  const h = String(host || '').trim();
  if (!h) return false;
  if (net.isIP(h)) return !(await reachable(`https://${h.includes(':') ? `[${h}]` : h}/`, lookup));
  let addrs;
  try { addrs = await lookup(h, { all: true, verbatim: true }); } catch (e) { return false; }
  return addrs.length > 0 && !(await reachable(`https://${h}/`, async () => addrs));
}

module.exports = { createMediaCache, pictureAddresses, sizeOf, pointsInside };
