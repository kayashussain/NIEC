// Student Recruit 360's service worker, on a phone that was connected for WhatsApp (see push.js and phone-link.js): it shows the notification sent
// when someone presses WhatsApp (or Call) on a computer, and a tap on it opens the chat. It changes nothing else.
//
// Made strong (the owner, 17 Nov 2026):
//   - Instant: the small page a tap opens (/wa, its script, its style, the icon) is kept on the phone, so a tap opens WhatsApp at
//     once instead of waiting for the internet. The kept copy is refreshed quietly in the background.
//   - Never has to be connected again: phones change their push address from time to time. This worker hands the new address to
//     Student Recruit 360 by itself (with the phone's own secret, kept in the "sr360-device" store on this phone), when the phone says it changed,
//     when a notification arrives or is tapped, and whenever Student Recruit 360 is opened on the phone.
//   - The computer is told "arrived" and "opened", so the person sees that their click worked.
const SHELL = 'sr360-phone-v2';
const FILES = ['/wa', '/wa-page.js', '/phone.css', '/apple-touch-icon.png', '/favicon.png'];
const STORE = 'sr360-device';
const ME = '/__sr360-device';

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
async function creds() { try { const r = await (await caches.open(STORE)).match(ME); return r ? await r.json() : null; } catch (e) { return null; } }
async function keep(me) { try { await (await caches.open(STORE)).put(ME, new Response(JSON.stringify(me), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* tried again next time */ } }

// Hands this phone's current push address to Student Recruit 360 when it changed (or, with `always`, to check in). If Student Recruit 360 says the address had
// stopped working, a fresh one is made and handed over.
let healing = null;
function heal(given, always) {
  if (healing) return healing;
  healing = (async () => {
    const me = await creds();
    if (!me || !me.d || !me.k) return;
    const fresh = async () => (me.key ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(me.key) }) : null);
    let sub = given || await self.registration.pushManager.getSubscription();
    if (!sub) sub = await fresh().catch(() => null);
    if (!sub) return;
    if (!always && sub.endpoint === me.endpoint) return;
    if (always && sub.endpoint === me.endpoint && me.checkedAt && Date.now() - me.checkedAt < 10 * 60 * 1000) return;
    let r = await post('/api/push/renew', { d: me.d, k: me.k, subscription: sub.toJSON() });
    if (r.status === 410) { await (await caches.open(STORE)).delete(ME); return; } // disconnected on the computer
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.wasLost && sub.endpoint === me.endpoint) {
      // Student Recruit 360 could not reach this address any more: make a new one.
      await sub.unsubscribe().catch(() => {});
      sub = await fresh().catch(() => null);
      if (!sub) return;
      r = await post('/api/push/renew', { d: me.d, k: me.k, subscription: sub.toJSON() });
    }
    if (r.ok) await keep({ ...me, endpoint: sub.endpoint, checkedAt: Date.now() });
  })().catch(() => {}).finally(() => { healing = null; });
  return healing;
}
async function ack(m, ev) {
  const me = await creds();
  if (!me || !me.d || !m) return;
  await post('/api/push/ack', { d: me.d, k: me.k, m, ev }).catch(() => {});
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map((f) => fetch(f, { cache: 'reload' }).then((r) => (r.ok && !r.redirected ? c.put(f, r) : null)).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== SHELL && n !== STORE).map((n) => caches.delete(n)));
    await self.clients.claim();
    heal(null, true);
  })());
});

// The kept files: answered at once from the phone, then refreshed in the background for next time.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !FILES.includes(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const key = url.pathname;
    const hit = await cache.match(key);
    const net = fetch(new Request(key, { cache: 'no-store' })).then((res) => { if (res.ok && !res.redirected) cache.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => fetch(req));
  })());
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = {}; }
  e.waitUntil((async () => {
    await self.registration.showNotification(m.title || 'Student Recruit 360', {
      body: m.body || '', tag: m.tag || 'sr360', renotify: true, icon: '/apple-touch-icon.png', badge: '/favicon.png', timestamp: m.at || Date.now(), data: { url: m.url || '/today', m: m.m || '' },
    });
    await Promise.all([ack(m.m, 'got'), heal()]);
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = new URL(data.url || '/today', self.location.origin);
  if (url.origin !== self.location.origin) return; // only Student Recruit 360's own pages are opened
  // The window is opened first, straight away (the phone allows it only right after the tap); the rest follows.
  const open = self.clients.openWindow(url.href).catch(() => null);
  e.waitUntil(Promise.all([open, ack(data.m, 'opened'), heal()]));
});

// The phone gave this worker a new push address: hand it to Student Recruit 360 at once.
self.addEventListener('pushsubscriptionchange', (e) => { e.waitUntil(heal(e.newSubscription || null)); });

// A page of Student Recruit 360 opened on this phone asks for a check-in (phone-link.js and wa-page.js).
self.addEventListener('message', (e) => { if (e.data === 'heal') e.waitUntil ? e.waitUntil(heal(null, true)) : heal(null, true); });
