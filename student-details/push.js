// "Open on my phone" (the owner, 17 Nov 2026): a click on WhatsApp on the computer makes the person's own phone show a notification,
// and one tap on it opens that student's WhatsApp chat on the phone. A website cannot open an app on a phone by itself; a
// notification the person allowed on their phone is the way that works on Android and on iPhone (from iOS 16.4, with ISR added to
// the Home Screen).
//
// This is the standard Web Push protocol (RFC 8030, the message encrypted for that phone only with RFC 8291 aes128gcm, the server
// identified with VAPID, RFC 8292), made with Node's own crypto: no outside library, no account with any company. The phone's
// browser gives an address at its own push service (Google, Apple, Mozilla, Microsoft); only those services are ever called.
//
// Kept in the data folder (never in git, never in a backup): push-keys.json (this server's VAPID key pair, made once) and
// push-devices.json (each person's connected phones: the push address and its keys, the name of the device, when connected).
// The notification carries only the student's name and number, encrypted for that phone.
//
// Made strong (the owner, 17 Nov 2026: the phone dropped off and had to be connected again, a notification came late, nothing showed
// that a click had worked, and two clicks sent two notifications):
//   - Each phone gets its own secret when it connects (only its hash is kept here). Phones change their push address from time to
//     time; with the secret the phone hands over its new address by itself (renew), so it never has to be connected again. A phone
//     whose address stops working is marked "not answering", never forgotten, and comes back the next time it opens ISR.
//   - All phones are sent to at the same time, each with a time limit, so a slow or switched-off phone never holds up a click.
//   - Each message has an id; the phone says "arrived" and "opened" (ack), so the computer can show it.
//   - The push service is given a Topic, so a message still waiting for a phone is replaced, never doubled.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('../shared/server-utils');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// The push services of the browsers. Nothing else is ever called, whatever address a page sends.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
function allowedEndpoint(endpoint, allowLocal) {
  let u;
  try { u = new URL(String(endpoint)); } catch (e) { return false; }
  if (allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true; // the tests' own push service only
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// RFC 8291: the message, encrypted for one phone's keys (p256dh: its public key, auth: its secret).
function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('The phone sent keys that do not look right.');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPublic, body]);
}

function createPush(dir, { allowLocal = false, fetchImpl = (...a) => fetch(...a) } = {}) {
  const keyFile = path.join(dir, 'push-keys.json');
  const devFile = path.join(dir, 'push-devices.json');
  const write = (file, data) => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileAtomic(file, JSON.stringify(data, null, 1)); try { fs.chmodSync(file, 0o600); } catch (e) { /* not on every system */ } };

  // This server's VAPID key pair, made the first time it is needed.
  let keys = null;
  function vapid() {
    if (keys) return keys;
    try {
      const k = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (k && k.privateJwk && k.publicKey) { keys = k; return keys; }
    } catch (e) { /* made below */ }
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = pair.privateKey.export({ format: 'jwk' });
    keys = { privateJwk: jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), madeAt: new Date().toISOString() };
    write(keyFile, keys);
    return keys;
  }
  function jwt(audience, subject) {
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
    const key = crypto.createPrivateKey({ key: vapid().privateJwk, format: 'jwk' });
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
    return `${head}.${body}.${b64u(sig)}`;
  }

  // The signed VAPID token, made once an hour for each push service rather than for every message.
  const tokens = new Map();
  function jwtFor(audience, subject) {
    const k = `${audience} ${subject}`;
    const hit = tokens.get(k);
    if (hit && hit.until > Date.now()) return hit.t;
    const t = jwt(audience, subject);
    tokens.set(k, { t, until: Date.now() + 3600 * 1000 });
    return t;
  }

  const pairs = new Map(); // pairing code -> { userId, user, until }
  const receipts = new Map(); // message id -> { userId, at, got: [names], opened: name }
  const hash = (secret) => crypto.createHash('sha256').update(String(secret || '')).digest('hex');
  const sameHash = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
  // A phone, found by its id and its secret (the phone is not logged in: the secret says it is that phone).
  function deviceBy(id, secret) {
    const d = readDevices();
    for (const [userId, list] of Object.entries(d.people)) {
      const dev = (list || []).find((x) => x.id === String(id || ''));
      if (dev) return dev.secretHash && sameHash(dev.secretHash, hash(secret)) ? { userId, dev } : null;
    }
    return null;
  }
  const checkSub = (sub) => {
    const endpoint = String(sub && sub.endpoint || '');
    const k = (sub && sub.keys) || {};
    if (!allowedEndpoint(endpoint, allowLocal)) return { error: 'This browser cannot get notifications from ISR. Use Chrome on Android, or Safari on iPhone with ISR added to the Home Screen.' };
    if (unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length !== 16) return { error: 'The phone sent keys that do not look right.' };
    return { endpoint, p256dh: String(k.p256dh), auth: String(k.auth) };
  };
  const readDevices = () => { try { const d = JSON.parse(fs.readFileSync(devFile, 'utf8')); return d && typeof d.people === 'object' && d.people ? d : { people: {} }; } catch (e) { return { people: {} }; } };
  const devicesOf = (userId) => readDevices().people[userId] || [];
  const saveDevices = (userId, list) => { const d = readDevices(); if (list.length) d.people[userId] = list; else delete d.people[userId]; write(devFile, d); };

  return {
    publicKey: () => vapid().publicKey,
    // What a page may know: how many phones, their names and when they were connected (never the push addresses).
    // "lost": the phone stopped answering; it comes back by itself the next time ISR is opened on it.
    devices: (userId) => devicesOf(userId).map((x) => ({ id: x.id, name: x.name, at: x.at, ...(x.usedAt ? { usedAt: x.usedAt } : {}), ...(x.lostAt ? { lost: true } : {}) })),
    // Connects a phone. `secret` (returned once, to that phone only) lets it hand over a new push address later by itself. The same
    // phone connected again (same address, or the old secret it still has) replaces its old entry, never adds a second one.
    connect(userId, sub, name, old) {
      const s = checkSub(sub);
      if (s.error) return s;
      const before = old && old.id ? deviceBy(old.id, old.secret) : null;
      const list = devicesOf(userId).filter((x) => x.endpoint !== s.endpoint && !(before && before.userId === userId && x.id === before.dev.id));
      const secret = crypto.randomBytes(24).toString('base64url');
      const device = { id: crypto.randomBytes(6).toString('hex'), ...s, secretHash: hash(secret), name: String(name || 'Phone').slice(0, 60), at: new Date().toISOString() };
      saveDevices(userId, [...list, device].slice(-5)); // up to five phones or tablets a person
      return { device: { id: device.id, name: device.name, at: device.at }, secret };
    },
    // The phone's new push address, handed over by the phone itself (its service worker), with its secret. Clears "not answering".
    renew(id, secret, sub) {
      const found = deviceBy(id, secret);
      if (!found) return { error: 'This phone is not connected any more. Connect it again from the computer.', gone: true };
      const s = checkSub(sub);
      if (s.error) return s;
      const list = devicesOf(found.userId).filter((x) => x.id === found.dev.id || x.endpoint !== s.endpoint)
        .map((x) => (x.id === found.dev.id ? { ...x, ...s, lostAt: undefined, renewedAt: new Date().toISOString() } : x));
      saveDevices(found.userId, list);
      return { ok: true, wasLost: Boolean(found.dev.lostAt) };
    },
    // The phone says a message arrived ("got") or was tapped ("opened"); the computer that sent it can then show it (receipt).
    ack(id, secret, m, ev) {
      const found = deviceBy(id, secret);
      if (!found) return { error: 'Unknown phone.', gone: true };
      const r = receipts.get(String(m || ''));
      if (r && r.userId === found.userId) {
        if (ev === 'opened') r.opened = found.dev.name;
        else if (!r.got.includes(found.dev.name)) r.got.push(found.dev.name);
      }
      // A phone that answers is plainly reachable again.
      if (found.dev.lostAt) saveDevices(found.userId, devicesOf(found.userId).map((x) => (x.id === found.dev.id ? { ...x, lostAt: undefined } : x)));
      return { ok: true };
    },
    receipt(userId, m) {
      const r = receipts.get(String(m || ''));
      if (!r || r.userId !== userId) return { state: 'unknown' };
      return { state: r.opened ? 'opened' : r.got.length ? 'arrived' : 'sent', got: r.got, opened: r.opened || '' };
    },
    // Pairing (the owner, 17 Nov 2026: connecting must be simple): the computer shows a code; the phone's camera opens it, and one
    // tap turns the notifications on, without logging the phone in. A code is random, belongs to one person, works for 30 minutes
    // and only once. Kept in memory only (a restart simply asks for a new code).
    pairCode(user) {
      const now = Date.now();
      for (const [k, v] of pairs) if (v.until < now) pairs.delete(k);
      const token = crypto.randomBytes(18).toString('base64url');
      pairs.set(token, { userId: user.id, user: { id: user.id, name: user.name, username: user.username, label: user.label }, until: now + 30 * 60 * 1000 });
      return { token, until: new Date(now + 30 * 60 * 1000).toISOString() };
    },
    // A code the phone has opened is marked, so the window on the computer can say "Your phone opened the code" (the owner,
    // 17 Nov 2026: the best, clearest way). A used code is kept, marked done, until it would have run out, so the computer sees it
    // finish; it can never be used again.
    pairOf(token, seen) {
      const p = pairs.get(String(token || ''));
      if (!p || p.until <= Date.now() || p.doneAt) return null;
      if (seen && !p.seenAt) p.seenAt = Date.now();
      return p;
    },
    // What the computer that made the code may know about it: only its own person's code.
    pairStatus(userId, token) {
      const p = pairs.get(String(token || ''));
      if (!p || p.userId !== userId) return { state: 'expired' };
      if (p.doneAt) return { state: 'done', device: p.device };
      if (p.until <= Date.now()) return { state: 'expired' };
      return { state: p.seenAt ? 'opened' : 'waiting', until: new Date(p.until).toISOString() };
    },
    pairWith(token, sub, name, old) {
      const p = this.pairOf(token);
      if (!p) return { error: 'This code has expired or was already used. Press "Connect my phone" on the computer again for a new one.' };
      const out = this.connect(p.userId, sub, name, old);
      if (out.error) return out;
      p.doneAt = Date.now();
      p.device = out.device;
      return { ...out, user: p.user };
    },
    disconnect(userId, id) {
      const list = devicesOf(userId);
      const left = id ? list.filter((x) => x.id !== id) : [];
      saveDevices(userId, left);
      return { removed: list.length - left.length };
    },
    // Sends `message` (an object, kept small) to every phone of the person, all at the same time, each with a time limit (a phone
    // that is off never holds up the click). Every message gets an id (m) for the receipt. A phone whose push address has gone is
    // marked "not answering" (it renews itself the next time ISR opens on it); an old phone with no secret is forgotten as before.
    // `topic`: the push service keeps only the newest waiting message with the same topic. Resolves { sent, failed, forgotten,
    // lost, names, m, track } (track: at least one phone reached can say "arrived").
    async send(userId, message, subject, topic) {
      const list = devicesOf(userId).filter((x) => !x.lostAt);
      const m = crypto.randomBytes(9).toString('base64url');
      const payload = JSON.stringify({ ...message, m, at: Date.now() });
      const outcome = await Promise.all(list.map(async (d) => {
        try {
          const aud = new URL(d.endpoint).origin;
          const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '120', Urgency: 'high', Authorization: `vapid t=${jwtFor(aud, subject)}, k=${vapid().publicKey}` };
          if (topic) headers.Topic = crypto.createHash('sha256').update(String(topic)).digest('base64url').slice(0, 32);
          const res = await fetchImpl(d.endpoint, { method: 'POST', headers, body: encrypt(payload, d.p256dh, d.auth), redirect: 'error', signal: AbortSignal.timeout(8000) });
          if (res.status === 404 || res.status === 410) return 'gone';
          return res.ok ? 'ok' : 'failed';
        } catch (e) { return 'failed'; }
      }));
      const reached = list.filter((d, i) => outcome[i] === 'ok');
      const gone = list.filter((d, i) => outcome[i] === 'gone');
      if (gone.length || reached.length) {
        const now = new Date().toISOString();
        const goneIds = new Set(gone.map((x) => x.id));
        const okIds = new Set(reached.map((x) => x.id));
        saveDevices(userId, devicesOf(userId)
          .filter((x) => !(goneIds.has(x.id) && !x.secretHash))
          .map((x) => (okIds.has(x.id) ? { ...x, usedAt: now } : goneIds.has(x.id) ? { ...x, lostAt: now } : x)));
      }
      if (reached.length) {
        const cut = Date.now() - 10 * 60 * 1000;
        for (const [k, v] of receipts) if (v.at < cut) receipts.delete(k);
        receipts.set(m, { userId, at: Date.now(), got: [], opened: '' });
      }
      return {
        sent: reached.length, failed: list.length - reached.length - gone.length, forgotten: gone.filter((x) => !x.secretHash).length,
        lost: gone.filter((x) => x.secretHash).map((x) => x.name), names: reached.map((x) => x.name), m, track: reached.some((x) => x.secretHash),
      };
    },
  };
}

module.exports = { createPush, encrypt, allowedEndpoint };
