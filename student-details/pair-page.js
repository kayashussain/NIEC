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
  const steps = (list) => { $('steps').replaceChildren(...list.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; })); $('steps').hidden = !list.length; };

  // On an iPhone the Home Screen icon must come back to this same page (with its code) to finish.
  const m = document.createElement('link'); m.rel = 'manifest'; m.href = '/manifest.webmanifest' + (/^[\w-]{20,40}$/.test(token) ? '?pair=' + token : ''); document.head.append(m);

  async function start() {
    let state;
    try { state = await (await fetch('/api/push/pair-state?t=' + encodeURIComponent(token), { cache: 'no-store' })).json(); } catch (e) { state = { valid: false }; }
    if (!state.valid) {
      show('This code has run out', 'On the computer, press "Connect my phone" again and scan the new code. (If this phone is already connected, there is nothing more to do.)');
      return;
    }
    const hello = state.name ? `Hello ${state.name}` : 'Hello';
    if (isIos && !standalone) {
      show(hello, 'On an iPhone there is one more step, then it is done:');
      steps(['Tap the Share button at the bottom of Safari (the square with an arrow).', 'Tap "Add to Home Screen", then "Add".', 'Open ISR from the new icon on your Home Screen, and tap "Turn on".']);
      return;
    }
    if (!canPush) {
      show(hello, 'This browser cannot do it. Open this page in Chrome (Android) or Safari (iPhone).');
      return;
    }
    show(hello, 'Tap "Turn on". When you press WhatsApp on a student on the computer, the chat will open here, on this phone.');
    const go = $('go');
    go.hidden = false;
    go.addEventListener('click', async () => {
      go.disabled = true;
      $('msg').textContent = '';
      try {
        const allowed = await Notification.requestPermission();
        if (allowed !== 'granted') throw new Error('Please tap "Allow" when the phone asks. If it did not ask, allow notifications for this website in the phone\'s settings, then tap Turn on again.');
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(state.key) });
        const r = await fetch('/api/push/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, subscription: sub.toJSON(), name: deviceName() }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'It did not work. Please try again.');
        go.hidden = true;
        steps([]);
        document.body.classList.add('is-done');
        show('Done ✓', 'WhatsApp is on for this phone. You can close this page. When you press WhatsApp on the computer, tap the notification here to open the chat.');
      } catch (e) {
        $('msg').textContent = e.message;
        go.disabled = false;
      }
    });
  }
  start();
})();
