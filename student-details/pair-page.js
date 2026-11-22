// The page the phone's camera opens from the code on the computer (/pair?t=<code>, the owner, 17 Nov 2026: connecting must be
// simple enough to explain in one sentence): "Hello Asha", one big "Turn on" button, and the phone is connected. No login on the
// phone. On an iPhone, Apple allows notifications only for a website kept on the Home Screen, so the page shows that one extra step
// (and, opened again from the Home Screen, finishes by itself with the same button).
(function () {
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('t') || '';
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? ((/;\s*([^;)]+?)\s+Build\//.exec(u) || [])[1] || 'Android phone') : 'Phone'; };
  const show = (title, words) => { $('title').textContent = title; $('words').textContent = words || ''; };
  // The Share button of Safari, drawn small inside the step, so the person knows exactly what to look for.
  const SHARE = '<svg class="ph-share" viewBox="0 0 24 24" aria-label="Share button"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  // Steps: [bold words, smaller words, share icon?]
  const steps = (list) => {
    $('steps').replaceChildren(...list.map(([b, small, share], i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'ph-n'; n.textContent = String(i + 1);
      const t = document.createElement('div');
      const bb = document.createElement('b'); bb.textContent = b;
      if (share) { const ic = document.createElement('span'); ic.innerHTML = SHARE; bb.append(' ', ic.firstChild); }
      t.append(bb);
      if (small) { const sm = document.createElement('span'); sm.textContent = small; t.append(sm); }
      li.append(n, t);
      return li;
    }));
    $('steps').hidden = !list.length;
  };
  // When the phone said no to notifications: exactly where to turn them back on, for this kind of phone.
  const blockedHelp = () => (isIos
    ? [['Open the Settings app', 'Then Notifications, then Vishnu.'], ['Turn on "Allow Notifications"', ''], ['Come back here and tap "Turn on" again', '']]
    : [['Tap the icon left of the address at the top', 'A small lock or settings icon in Chrome.'], ['Tap Permissions (or Notifications), then Allow', ''], ['Tap "Turn on" again', '']]);

  // On an iPhone the Home Screen icon must come back to this same page (with its code) to finish.
  const m = document.createElement('link'); m.rel = 'manifest'; m.href = '/manifest.webmanifest' + (/^[\w-]{20,40}$/.test(token) ? '?pair=' + token : ''); document.head.append(m);

  // This phone's id and secret, kept on the phone for Vishnu's service worker (sw.js), so the phone hands over a new push address by
  // itself and never has to be connected again.
  const STORE = 'isr-device'; const ME = '/__isr-device';
  const mine = async () => { try { const r = await (await caches.open(STORE)).match(ME); return r ? await r.json() : null; } catch (e) { return null; } };
  const keepMine = async (me) => { try { await (await caches.open(STORE)).put(ME, new Response(JSON.stringify(me), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* the phone still works; it only cannot renew by itself */ } };

  async function start() {
    let state;
    try { state = await (await fetch('/api/push/pair-state?t=' + encodeURIComponent(token), { cache: 'no-store' })).json(); } catch (e) { state = { valid: false }; }
    if (!state.valid) {
      document.body.classList.add('is-old');
      show('This code has run out', 'On the computer, open the menu (your name), press "Connect my phone" and scan the new code. If this phone is already connected, there is nothing more to do.');
      return;
    }
    const hello = state.name ? `Hello ${state.name}` : 'Hello';
    if (isIos && !standalone) {
      show(hello, 'On an iPhone, Apple asks for one extra step. It takes ten seconds, once:');
      steps([['Tap the Share button', 'At the bottom of Safari (at the top on an iPad).', true], ['Tap "Add to Home Screen", then "Add"', 'Scroll down the list if you do not see it.'], ['Open Vishnu from your Home Screen', 'Then tap "Turn on" and "Allow". That is all.']]);
      $('note').hidden = false;
      return;
    }
    if (!canPush) {
      show(hello, isIos ? 'Please open this page in Safari: scan the code again with the Camera app.' : 'This browser cannot get notifications. Please open this page in Chrome: scan the code again, or copy the link into Chrome.');
      return;
    }
    show(hello, 'Tap "Turn on", then "Allow". After that, when you press WhatsApp on a student on the computer, this phone shows a notification: one tap opens the chat.');
    const go = $('go');
    go.hidden = false;
    $('note').hidden = false;
    // Notifications blocked on this phone before: show where to turn them back on, before the tap.
    if (Notification.permission === 'denied') { $('words').textContent = 'Notifications are turned off for Vishnu on this phone. Turn them on, then tap "Turn on":'; steps(blockedHelp()); }
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Turning on...';
      $('msg').textContent = '';
      try {
        const allowed = await Notification.requestPermission();
        if (allowed !== 'granted') { steps(blockedHelp()); throw new Error('The phone did not allow notifications. Turn them on as shown, then tap "Turn on" again.'); }
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(state.key) });
        const old = await mine();
        const r = await fetch('/api/push/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, subscription: sub.toJSON(), name: deviceName(), old: old ? { id: old.d, secret: old.k } : undefined }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'It did not work. Please try again.');
        if (j.device) await keepMine({ d: j.device.id, k: j.device.secret, key: state.key, endpoint: sub.endpoint, checkedAt: Date.now() });
        go.hidden = true;
        steps([]);
        $('note').hidden = true;
        document.body.classList.add('is-done');
        show('You are all set', 'This phone is connected. The computer knows it already. From now on, press WhatsApp on any student on the computer and tap the notification here. You can close this page.');
      } catch (e) {
        $('msg').textContent = e.message;
        go.textContent = 'Turn on';
        go.disabled = false;
      }
    });
  }
  start();
})();
