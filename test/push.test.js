// "WhatsApp opens on my phone" (the owner, 17 Nov 2026, student-details/push.js): a phone is connected once, then a click on WhatsApp
// on the computer sends that phone an encrypted notification that opens the student's chat. Here a pretend push service on this
// computer receives the notification; the test decrypts it as a phone would (RFC 8291) and checks the server's VAPID signature
// (RFC 8292). Only the browsers' own push services are accepted as addresses. All students are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { allowedEndpoint } = require('../student-details/push');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

// What a phone does with what it receives: RFC 8291, aes128gcm.
function decrypt(body, uaEcdh, auth) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPublic = body.subarray(21, 21 + idlen); const data = body.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.strictEqual(plain[plain.length - 1], 2, 'one record, ended as the RFC says');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

test('only the browsers\' push services are ever called', () => {
  assert.ok(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(allowedEndpoint('https://web.push.apple.com/QGx'));
  assert.ok(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!allowedEndpoint('https://evil.example.com/fcm.googleapis.com'));
  assert.ok(!allowedEndpoint('http://fcm.googleapis.com/x'), 'never without https');
  assert.ok(!allowedEndpoint('https://fcm.googleapis.com:8443/x'), 'never another port');
  assert.ok(!allowedEndpoint('http://127.0.0.1:9/x'), 'never this computer, except for the tests');
  assert.ok(allowedEndpoint('http://127.0.0.1:9/x', true));
});

test('a connected phone gets the student\'s chat, encrypted and signed; nobody else\'s students', { timeout: 120000 }, async (t) => {
  // The pretend push service.
  const got = [];
  const pushPort = await freePort();
  let answer = 201;
  const svc = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { got.push({ headers: req.headers, body: Buffer.concat(chunks), url: req.url }); res.writeHead(answer); res.end(); }); }).listen(pushPort);
  t.after(() => svc.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-push-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, SR360_PUSH_LOCAL: '1' }, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = (await admin('POST', '/api/users', { username: 'sunita', name: 'Sunita', email: '', departments: ['followup'] })).json;
  const fu = person();
  await fu('POST', '/api/login', { username: 'sunita', password: made.temporaryPassword }); await fu('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
  const sita = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Sita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000091' } })).json.id;
  const far = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000092' } })).json.id;

  // The phone's own keys, as a browser makes them.
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: `http://127.0.0.1:${pushPort}/push/abc`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };

  assert.strictEqual((await fu('POST', '/api/push/whatsapp', { id: sita })).status, 409, 'no phone yet');
  assert.strictEqual((await fu('POST', '/api/push/connect', { subscription: { ...sub, endpoint: 'https://evil.example.com/x' }, name: 'Phone' })).status, 400);
  const key = (await fu('GET', '/api/push')).json.key;
  const connected = await fu('POST', '/api/push/connect', { subscription: sub, name: 'Android phone' });
  assert.strictEqual(connected.status, 200);
  assert.deepStrictEqual(connected.json.devices.map((d) => d.name), ['Android phone']);
  const me = connected.json.device;
  assert.ok(me && me.id && me.secret, 'the phone is given its own id and secret, to renew by itself');
  assert.ok(!fs.readFileSync(path.join(dir, 'push-devices.json'), 'utf8').includes(me.secret), 'only a hash of the secret is kept');
  assert.ok(!JSON.stringify((await fu('GET', '/api/push')).json).includes('/push/abc'), 'the push address is never sent back to a page');

  const sent = await fu('POST', '/api/push/whatsapp', { id: sita });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
  assert.deepStrictEqual(sent.json.to, ['Android phone'], 'the computer is told which phone got it');
  assert.ok((await fu('GET', '/api/push')).json.devices[0].usedAt, 'the phone remembers when it was last used');
  const msg = got[got.length - 1];
  assert.strictEqual(msg.headers['content-encoding'], 'aes128gcm');
  assert.ok(/^[\w-]{1,32}$/.test(msg.headers.topic), 'a Topic, so a waiting message is replaced, never doubled');
  // Pressed again at once: answered with the first send, and nothing more goes to the phone (the owner, 17 Nov 2026).
  const before = got.length;
  const again = await fu('POST', '/api/push/whatsapp', { id: sita });
  assert.deepStrictEqual([again.status, again.json.again], [200, true]);
  assert.strictEqual(got.length, before, 'two clicks, one notification');
  // The phone says it arrived, then that it was tapped; the computer sees both. Only with the phone's own secret.
  const m = sent.json.m;
  assert.ok(m, 'a message id for the receipt');
  assert.strictEqual((await fu('GET', '/api/push/receipt?m=' + m)).json.state, 'sent');
  const phonePost = (u, b2) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b2) });
  assert.strictEqual((await phonePost('/api/push/ack', { d: me.id, k: 'wrong', m, ev: 'got' })).status, 410);
  assert.strictEqual((await phonePost('/api/push/ack', { d: me.id, k: me.secret, m, ev: 'got' })).status, 200);
  assert.deepStrictEqual((await fu('GET', '/api/push/receipt?m=' + m)).json.state, 'arrived');
  await phonePost('/api/push/ack', { d: me.id, k: me.secret, m, ev: 'opened' });
  assert.deepStrictEqual((await fu('GET', '/api/push/receipt?m=' + m)).json.state, 'opened');
  assert.strictEqual((await admin('GET', '/api/push/receipt?m=' + m)).json.state, 'unknown', 'only the sender sees the receipt');
  assert.ok(!msg.body.includes(Buffer.from('9800000091')), 'the number is not readable on the way');
  const payload = decrypt(msg.body, ua, auth);
  assert.strictEqual(payload.title, 'WhatsApp Sita Demo');
  assert.strictEqual(payload.url, '/wa?n=9779800000091&name=Sita%20Demo');
  // The VAPID signature: made with the key the page was given.
  const [, tok, k] = /^vapid t=([^,]+), k=(.+)$/.exec(msg.headers.authorization);
  assert.strictEqual(k, key);
  const [h, b, sig] = tok.split('.');
  assert.strictEqual(JSON.parse(unb64u(b)).aud, `http://127.0.0.1:${pushPort}`);
  const raw = unb64u(key);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64u(sig)), 'signed by this server');

  // A student the Follow-up Team does not see is never sent; a test reaches the phone; a phone that has gone is forgotten.
  assert.strictEqual((await fu('POST', '/api/push/whatsapp', { id: far })).status, 404);
  assert.strictEqual((await fu('POST', '/api/push/whatsapp', { test: true })).status, 200);
  assert.strictEqual(decrypt(got[got.length - 1].body, ua, auth).title, 'Student Recruit 360 is connected');
  // A phone whose push address stopped working is marked "not answering", never forgotten, and renews itself with its secret.
  answer = 410;
  const lost = await fu('POST', '/api/push/whatsapp', { id: sita, text: 'Hello' });
  assert.strictEqual(lost.status, 409, 'the computer is told at once');
  assert.deepStrictEqual((await fu('GET', '/api/push')).json.devices.map((x) => x.lost), [true], 'kept, marked not answering');
  const told = await fu('POST', '/api/push/whatsapp', { id: sita, text: 'Hello again' });
  assert.strictEqual(told.status, 409);
  assert.match(told.json.error, /not answering.*reconnects by itself/);
  answer = 201;
  const ua3 = crypto.createECDH('prime256v1'); ua3.generateKeys(); const auth3 = crypto.randomBytes(16);
  const sub3 = { endpoint: `http://127.0.0.1:${pushPort}/push/new`, keys: { p256dh: b64u(ua3.getPublicKey()), auth: b64u(auth3) } };
  assert.strictEqual((await phonePost('/api/push/renew', { d: me.id, k: 'wrong', subscription: sub3 })).status, 410);
  const renewed = await (await phonePost('/api/push/renew', { d: me.id, k: me.secret, subscription: sub3 })).json();
  assert.deepStrictEqual([renewed.ok, renewed.wasLost], [true, true]);
  assert.deepStrictEqual((await fu('GET', '/api/push')).json.devices.map((x) => [x.name, Boolean(x.lost)]), [['Android phone', false]], 'back, without connecting again');
  assert.strictEqual((await fu('POST', '/api/push/whatsapp', { id: sita, text: 'Back' })).status, 200);
  assert.strictEqual(got[got.length - 1].url, '/push/new', 'sent to the new address');
  assert.strictEqual((await fu('POST', '/api/push/disconnect', { id: me.id })).status, 200);
  assert.strictEqual((await phonePost('/api/push/renew', { d: me.id, k: me.secret, subscription: sub3 })).status, 410, 'a disconnected phone cannot come back by itself');
  // Pairing, the simple way (the owner, 17 Nov 2026): the computer shows a code; the phone, not logged in, opens it and connects.
  const pc = (await fu('POST', '/api/push/pair-code', {})).json;
  const token = new URL(pc.url).searchParams.get('t');
  assert.ok(/^[\w-]{20,40}$/.test(token));
  assert.strictEqual(pc.token, token);
  // The window on the computer follows the code: waiting, opened on the phone, then done (and on which phone).
  const pairStatus = async (t) => (await fu('GET', '/api/push/pair-status?t=' + encodeURIComponent(t))).json;
  assert.strictEqual((await pairStatus(token)).state, 'waiting');
  assert.strictEqual((await pairStatus('nope-nope-nope-nope-nope')).state, 'expired');
  const phoneGet = (u) => fetch(base + u, { redirect: 'manual' });
  assert.strictEqual((await phoneGet('/pair?t=' + token)).status, 200, 'the pairing page needs no login');
  const st = await (await phoneGet('/api/push/pair-state?t=' + token)).json();
  assert.deepStrictEqual([st.valid, st.name, st.key], [true, 'Sunita', key]);
  assert.strictEqual((await (await phoneGet('/api/push/pair-state?t=nope-nope-nope-nope-nope')).json()).valid, false);
  assert.strictEqual((await pairStatus(token)).state, 'opened', 'the computer sees that the phone opened the code');
  assert.strictEqual((await phoneGet('/api/push/pair-status?t=' + token)).status === 200, false, 'only the logged-in person sees how their code is doing');
  assert.strictEqual(JSON.parse(await (await phoneGet('/manifest.webmanifest?pair=' + token)).text()).start_url, '/pair?t=' + token, 'an iPhone Home Screen icon comes back to finish');
  const ua2 = crypto.createECDH('prime256v1'); ua2.generateKeys(); const auth2 = crypto.randomBytes(16);
  const sub2 = { endpoint: `http://127.0.0.1:${pushPort}/push/def`, keys: { p256dh: b64u(ua2.getPublicKey()), auth: b64u(auth2) } };
  answer = 201;
  const pairPost = (b2) => fetch(base + '/api/push/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b2) });
  assert.strictEqual((await pairPost({ token: 'wrong-wrong-wrong-wrong-wrong', subscription: sub2 })).status, 400);
  const paired = await pairPost({ token, subscription: sub2, name: 'iPhone' });
  assert.strictEqual(paired.status, 200);
  assert.ok((await paired.json()).device.secret, 'the paired phone gets its secret');
  const doneSt = await pairStatus(token);
  assert.deepStrictEqual([doneSt.state, doneSt.device.name], ['done', 'iPhone'], 'the computer sees the phone connected, by name');
  assert.deepStrictEqual((await fu('GET', '/api/push')).json.devices.map((x) => x.name), ['iPhone'], 'the phone belongs to the person who showed the code');
  assert.strictEqual((await pairPost({ token, subscription: sub2, name: 'Again' })).status, 400, 'a code works once');
  await wait(300);
  assert.strictEqual(decrypt(got[got.length - 1].body, ua2, auth2).title, 'WhatsApp is on', 'the phone is told it worked');
  assert.strictEqual((await fu('POST', '/api/push/whatsapp', { id: sita, text: 'From the new phone' })).status, 200);
  assert.strictEqual(decrypt(got[got.length - 1].body, ua2, auth2).title, 'WhatsApp Sita Demo');
  assert.strictEqual((await phoneGet('/api/push/pair-code')).status === 200, false, 'only a logged-in person makes a code');

  // The phone's page and the Home Screen settings.
  assert.strictEqual((await fu('GET', '/wa?n=9779800000091')).status, 200);
  const manifest = await fetch(base + '/manifest.webmanifest');
  assert.strictEqual(manifest.status, 200, 'the Home Screen settings need no login');
  assert.strictEqual((await manifest.json()).start_url, '/today');
  assert.match((await (await fetch(base + '/sw.js', { headers: { cookie: '' } })).text()), /notificationclick|login/);
});
