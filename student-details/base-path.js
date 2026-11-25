// Runs the portal under a folder of a domain (for example https://studentrecruit360.com/niec) when the host setting
// NIEC_BASE_PATH=/niec is set. With the setting empty (the default) nothing here does anything: wrap() returns the handler as it is.
// The server answers /niec/x as /x, and every address that starts at the domain root ("/api/...", "/login") in pages, scripts and
// styles, in redirects and in the cookie's path is moved under the folder on its way out. Nothing is changed on disk.
'use strict';
const zlib = require('zlib');
const crypto = require('crypto');

function normalize(raw) {
  let b = String(raw || '').trim().replace(/\\/g, '/');
  if (!b || b === '/') return '';
  if (!b.startsWith('/')) b = '/' + b;
  return b.replace(/\/+$/, '').replace(/[^A-Za-z0-9_\-./]/g, '');
}

// The portal's own first words after the domain. Only text that starts with one of these (or with a file the browser loads) is an
// address. Everything else that starts with a slash is left alone: a pattern such as /"/g, a name inside the phone, and the end of an
// address that is joined on ('.../' + id + '/delete'). A new page is added here (test/base-path.test.js fails until it is).
const ROUTES = new Set(['activity', 'agents', 'api', 'apply-through', 'b2b-partners', 'book', 'booking', 'bookings', 'bulk', 'bulk-add', 'dashboard',
  'events', 'fact-file', 'fonts', 'followup', 'healthz', 'incentive', 'interview-guidelines', 'login', 'mock-guides', 'mock-interviews',
  'my', 'my-dashboard', 'my-portal', 'pair', 'partner-universities', 'partners', 'student', 'students', 'today', 'users', 'wa']);
const FILE = /\.(?:js|css|png|jpg|svg|html|json|woff2|webmanifest|ico)$/;

// Is the text after a slash the start of one of the portal's addresses?
function isAddress(rest) {
  const first = (/^[A-Za-z0-9_.-]*/.exec(rest) || [''])[0];
  return ROUTES.has(first) || FILE.test(first);
}

// "/x" inside quotes, brackets or url() becomes "/niec/x"; a lone "/" and "//" (comments, protocol-less links) are left alone.
function rewriteText(text, base, kind) {
  const already = base.slice(1);
  // The Incentive page starts every request with its own address (BASE, which already has the folder): its "/api/..." stay as written.
  const ownBase = /const BASE = location\.pathname/.test(text);
  let out = text.replace(/(["'`])\/(?=[A-Za-z_.-])/g, (m, q, off, s) => {
    const rest = s.slice(off + 2, off + 82);
    if (!isAddress(rest) || rest.startsWith(already + '/') || (ownBase && rest.startsWith('api/'))) return m;
    // Joined onto what is before it, it is the end of an address, unless what is before is the site itself.
    const before = s.slice(Math.max(0, off - 40), off);
    if (/\+\s*$/.test(before) && !/\.origin\s*\+\s*$/.test(before)) return m;
    return q + base + '/';
  });
  // A link built from location.origin inside a template has no quote before its slash.
  out = out.replace(/(\.origin\})\/(?=[A-Za-z_.-])/g, (m, o, off, s) => (isAddress(s.slice(off + m.length, off + m.length + 80)) ? o + base + '/' : m));
  out = out.replace(/\burl\(\s*(["']?)\/(?=[A-Za-z_.-])/g, (m, q, off, s) => (s.startsWith(already + '/', off + m.length) ? m : 'url(' + q + base + '/'));
  // The page's own start ("|| '/'", "return '/'", <base href="/">) is the folder itself.
  out = out.replace(/(\|\||\breturn|\?|:)(\s*)(["'])\/\3/g, (m, a, sp, q) => a + sp + q + base + '/' + q);
  out = out.replace(/<base href="\/">/i, '<base href="' + base + '/">');
  if (kind === 'html') {
    // A safety net for addresses a script builds by joining pieces: fetch, XMLHttpRequest and EventSource get the folder added.
    const patch = '<script src="' + base + '/__base-path.js"></script>';
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (h) => h + patch) : patch + out;
  }
  return out;
}

function patchSource(base) {
  return '(function(){var B=' + JSON.stringify(base) + ';function f(u){return typeof u==="string"&&u.charAt(0)==="/"&&u.charAt(1)!=="/"&&u.indexOf(B+"/")!==0&&u!==B?B+u:u}' +
    'var F=window.fetch;if(F)window.fetch=function(u,o){return F.call(this,typeof u==="string"?f(u):u,o)};' +
    'var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=f(u);return O.apply(this,arguments)};' +
    'if(window.EventSource){var E=window.EventSource;window.EventSource=function(u,o){return new E(f(u),o)};window.EventSource.prototype=E.prototype}})();';
}

// The page's security policy only runs inline scripts it has a hash for; the moved addresses change those hashes, so the new ones are added.
function addInlineHashes(csp, html) {
  const hashes = [];
  html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (m, code) => { if (code.trim()) hashes.push("'sha256-" + crypto.createHash('sha256').update(code).digest('base64') + "'"); return m; });
  if (!hashes.length) return csp;
  return csp.replace(/script-src([^;]*)/, (m, rest) => 'script-src' + rest + ' ' + hashes.join(' '));
}

// A redirect's address and the page it should return to after the login ("?next=%2Fstudents") both move under the folder.
function moveLocation(loc, base) {
  const moved = base + loc;
  return moved.replace(/([?&]next=)(%2F|\/)(?!%2F|\/)/i, (m, k, sl) => k + encodeURIComponent(base + '/').replace(/%2F$/i, '') + sl);
}

function kindOf(type) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('text/html')) return 'html';
  if (t.startsWith('text/css')) return 'css';
  if (t.startsWith('application/javascript') || t.startsWith('text/javascript')) return 'js';
  return null;
}

function wrap(handler, rawBase) {
  const base = normalize(rawBase);
  if (!base) return handler;
  return function (req, res) {
    const u = req.url || '/';
    if (u === base || u.startsWith(base + '/') || u.startsWith(base + '?')) req.url = u.slice(base.length) || '/';
    if (req.url === '/__base-path.js') {
      const code = Buffer.from(patchSource(base), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Length': code.length, 'Cache-Control': 'no-cache' });
      return res.end(code);
    }
    const origWriteHead = res.writeHead.bind(res);
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    let pending = null; // { status, message, headers, kind, chunks }
    res.writeHead = function (status, ...rest) {
      let message; let headers = {};
      if (typeof rest[0] === 'string') message = rest.shift();
      if (rest[0] && typeof rest[0] === 'object') headers = Array.isArray(rest[0]) ? Object.fromEntries(rest[0].reduce((a, v, i, arr) => (i % 2 ? a : a.concat([[v, arr[i + 1]]])), [])) : { ...rest[0] };
      const all = { ...res.getHeaders(), ...headers };
      for (const k of Object.keys(all)) {
        const l = k.toLowerCase();
        if (l === 'location' && typeof all[k] === 'string' && all[k].startsWith('/') && !all[k].startsWith('//') && !all[k].startsWith(base + '/')) all[k] = moveLocation(all[k], base);
        if (l === 'set-cookie') all[k] = [].concat(all[k]).map((c) => c.replace(/;\s*Path=\/(?=;|$)/i, '; Path=' + base + '/'));
      }
      const typeKey = Object.keys(all).find((k) => k.toLowerCase() === 'content-type');
      const kind = typeKey ? kindOf(all[typeKey]) : null;
      for (const k of Object.keys(res.getHeaders())) res.removeHeader(k);
      if (!kind) { return message ? origWriteHead(status, message, all) : origWriteHead(status, all); }
      pending = { status, message, headers: all, kind, chunks: [] };
      return res;
    };
    res.write = function (chunk, enc, cb) {
      if (!pending) return origWrite(chunk, enc, cb);
      if (chunk != null) pending.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
      if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb();
      return true;
    };
    res.end = function (chunk, enc, cb) {
      if (!pending) {
        // writeHead was never called: the headers set with setHeader are the ones to look at.
        const h = res.getHeaders();
        const kind = kindOf(h['content-type']);
        if (kind && !res.headersSent) {
          const loc = h.location; if (typeof loc === 'string' && loc.startsWith('/') && !loc.startsWith('//')) res.setHeader('Location', moveLocation(loc, base));
          res.writeHead(res.statusCode);
        } else if (!res.headersSent && typeof h.location === 'string' && h.location.startsWith('/') && !h.location.startsWith('//')) {
          res.setHeader('Location', moveLocation(h.location, base));
        }
        if (!pending) return origEnd(chunk, enc, cb);
      }
      if (chunk != null && typeof chunk !== 'function') pending.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
      const p = pending; pending = null;
      let body = Buffer.concat(p.chunks);
      const encKey = Object.keys(p.headers).find((k) => k.toLowerCase() === 'content-encoding');
      try {
        if (encKey && /gzip/i.test(p.headers[encKey])) { body = zlib.gunzipSync(body); delete p.headers[encKey]; }
        const text = rewriteText(body.toString('utf8'), base, p.kind);
        body = Buffer.from(text, 'utf8');
        if (p.kind === 'html') { const ck = Object.keys(p.headers).find((k) => k.toLowerCase() === 'content-security-policy'); if (ck) p.headers[ck] = addInlineHashes(String(p.headers[ck]), text); }
      } catch (e) { /* send it as it was */ }
      for (const k of Object.keys(p.headers)) { const l = k.toLowerCase(); if (l === 'content-length' || l === 'etag') delete p.headers[k]; }
      p.headers['Content-Length'] = body.length;
      if (p.message) origWriteHead(p.status, p.message, p.headers); else origWriteHead(p.status, p.headers);
      return origEnd(body, typeof enc === 'function' ? undefined : undefined, typeof chunk === 'function' ? chunk : cb);
    };
    return handler(req, res);
  };
}

module.exports = { wrap, normalize, rewriteText, moveLocation, isAddress };
