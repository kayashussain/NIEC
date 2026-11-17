// ISR's service worker, on a phone that was connected for WhatsApp (see push.js and phone-link.js): it shows the notification sent
// when someone presses WhatsApp on a computer, and a tap on it opens the chat. It keeps nothing and changes nothing else.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = {}; }
  e.waitUntil(self.registration.showNotification(m.title || 'ISR', {
    body: m.body || '', tag: m.tag || 'isr', renotify: true, icon: '/apple-touch-icon.png', badge: '/favicon.png', data: { url: m.url || '/today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/today', self.location.origin);
  if (url.origin !== self.location.origin) return; // only ISR's own pages are opened
  e.waitUntil(self.clients.openWindow(url.href));
});
