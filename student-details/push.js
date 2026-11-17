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

  const readDevices = () => { try { const d = JSON.parse(fs.readFileSync(devFile, 'utf8')); return d && typeof d.people === 'object' && d.people ? d : { people: {} }; } catch (e) { return { people: {} }; } };
  const devicesOf = (userId) => readDevices().people[userId] || [];
  const saveDevices = (userId, list) => { const d = readDevices(); if (list.length) d.people[userId] = list; else delete d.people[userId]; write(devFile, d); };

  return {
    publicKey: () => vapid().publicKey,
    // What a page may know: how many phones, their names and when they were connected (never the push addresses).
    devices: (userId) => devicesOf(userId).map((x) => ({ id: x.id, name: x.name, at: x.at })),
    connect(userId, sub, name) {
      const endpoint = String(sub && sub.endpoint || '');
      const k = (sub && sub.keys) || {};
      if (!allowedEndpoint(endpoint, allowLocal)) return { error: 'This browser cannot get notifications from ISR. Use Chrome on Android, or Safari on iPhone with ISR added to the Home Screen.' };
      if (unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length !== 16) return { error: 'The phone sent keys that do not look right.' };
      const list = devicesOf(userId).filter((x) => x.endpoint !== endpoint);
      const device = { id: crypto.randomBytes(6).toString('hex'), endpoint, p256dh: String(k.p256dh), auth: String(k.auth), name: String(name || 'Phone').slice(0, 60), at: new Date().toISOString() };
      saveDevices(userId, [...list, device].slice(-5)); // up to five phones or tablets a person
      return { device: { id: device.id, name: device.name, at: device.at } };
    },
    disconnect(userId, id) {
      const list = devicesOf(userId);
      const left = id ? list.filter((x) => x.id !== id) : [];
      saveDevices(userId, left);
      return { removed: list.length - left.length };
    },
    // Sends `message` (an object, kept small) to every phone of the person. A phone whose push address has gone (the person
    // removed ISR or blocked notifications) is forgotten. Resolves { sent, failed }.
    async send(userId, message, subject) {
      const list = devicesOf(userId);
      let sent = 0; let failed = 0; const gone = [];
      const payload = JSON.stringify(message);
      for (const d of list) {
        try {
          const aud = new URL(d.endpoint).origin;
          const res = await fetchImpl(d.endpoint, {
            method: 'POST',
            headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '120', Urgency: 'high', Authorization: `vapid t=${jwt(aud, subject)}, k=${vapid().publicKey}` },
            body: encrypt(payload, d.p256dh, d.auth),
            redirect: 'error',
          });
          if (res.status === 404 || res.status === 410) gone.push(d.id);
          if (res.ok) sent += 1; else failed += 1;
        } catch (e) { failed += 1; }
      }
      if (gone.length) saveDevices(userId, devicesOf(userId).filter((x) => !gone.includes(x.id)));
      return { sent, failed, forgotten: gone.length };
    },
  };
}

module.exports = { createPush, encrypt, allowedEndpoint };
