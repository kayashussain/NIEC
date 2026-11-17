// "WhatsApp opens on my phone" (the owner, 17 Nov 2026), the page side (the server side is push.js):
//   - Connect my phone: done once. The computer shows a code; the phone's camera opens it and one tap ("Turn on") connects the
//     phone (pair.html, no login on the phone). A phone that is logged in can also press Turn on in the same window.
//   - Then a click on WhatsApp on the computer sends that phone a notification; one tap on it opens the student's chat in WhatsApp on
//     the phone. On a phone the click opens WhatsApp at once. With no phone connected, the computer shows how to connect one, with
//     "Open it on this computer this time".
// window.PhoneLink = { openChat({ id, number, name, text }), dialog() }. Loaded on every page by header.js.
(function () {
  if (window.PhoneLink) return;
  const say = (t, bad) => (window.NiecUI && window.NiecUI.toast ? window.NiecUI.toast(t, { type: bad ? 'error' : 'success' }) : alert(t));
  const isPhone = () => window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function api(url, body) {
    const r = await fetch(url, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
    return j;
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (cls, text, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? ((/;\s*([^;)]+?)\s+Build\//.exec(u) || [])[1] || 'Android phone') : 'This device'; };
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const web = (number, text) => `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  let status = null; // { key, devices }
  const load = async (fresh) => { if (!status || fresh) status = await api('/api/push'); return status; };

  async function connectHere() {
    if (!canPush()) throw new Error(isIos() && !standalone() ? 'On an iPhone, first add ISR to the Home Screen (the Share button, then Add to Home Screen), open ISR from there, and press Connect again.' : 'This browser cannot get notifications. Use Chrome on Android, or Safari on iPhone with ISR on the Home Screen.');
    const allowed = await Notification.requestPermission();
    if (allowed !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site in the phone\'s settings, then press Connect again.');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const s = await load(true);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(s.key) });
    status = await api('/api/push/connect', { subscription: sub.toJSON(), name: deviceName() });
    return status;
  }

  function loadQr() {
    if (window.IsrQr) return Promise.resolve(window.IsrQr);
    return new Promise((resolve, reject) => { const sc = document.createElement('script'); sc.src = '/qr.js'; sc.onload = () => resolve(window.IsrQr); sc.onerror = reject; document.head.append(sc); });
  }

  // The window to connect a phone (the owner, 17 Nov 2026: simple enough to explain in one sentence). On a computer: a code and two
  // steps ("point your phone's camera at the code, tap Turn on"); the window notices by itself when the phone is connected. On a
  // phone that is logged in: one button. With a phone connected: its name, Disconnect, and a test. `once`: opened from a WhatsApp
  // click with no phone connected yet, with "Open it on this computer this time".
  function dialog(once) {
    const d = el('dialog', 'p-dialog pl-dialog');
    const head = el('div', 'p-dialog-head');
    head.append(el('h2', '', 'WhatsApp on your phone'), btn('p-x', '×', () => d.close()));
    head.lastChild.setAttribute('aria-label', 'Close');
    const body = el('div', 'p-dialog-body');
    d.append(head, body);
    let poll = null;
    d.addEventListener('close', () => { clearInterval(poll); d.remove(); });
    d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    const foot = (...buttons) => { const f = el('div', 'p-dialog-foot'); f.append(...buttons); body.append(f); };
    const hereOnce = () => { if (!once) return null; const a = el('a', 'btn', 'Open it on this computer this time'); a.href = once.href; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', () => setTimeout(() => d.close(), 50)); return a; };

    async function showCode(again) {
      body.replaceChildren(el('p', 'p-muted', 'Making your code...'));
      let made; let qr;
      try { [made, qr] = await Promise.all([api('/api/push/pair-code', {}), loadQr()]); } catch (e) { body.replaceChildren(el('div', 'p-notice bad', e.message || 'Something went wrong.')); return; }
      const before = (status && status.devices.length) || 0;
      const wrap = el('div', 'pl-pair');
      const code = el('div', 'pl-qr');
      code.innerHTML = qr.svg(made.url, { size: 240 });
      code.firstChild.setAttribute('aria-label', 'The code to scan with your phone');
      const steps = el('ol', 'pl-two');
      [['Point your phone\'s camera at this code', 'and tap the link that appears.'], ['On your phone, tap "Turn on"', 'and "Allow". That is all.']].forEach(([b, small]) => { const li = el('li'); li.append(el('b', '', b), el('span', '', small)); steps.append(li); });
      const side = el('div', 'pl-side');
      side.append(steps, el('p', 'p-muted p-small', 'On an iPhone, the phone shows one extra step (Add to Home Screen). The code works for 30 minutes, once.'));
      const waiting = el('p', 'pl-wait', 'Waiting for your phone...');
      side.append(waiting);
      wrap.append(code, side);
      body.replaceChildren(el('p', '', again ? 'Connect another phone:' : 'Connect your phone once. After that, WhatsApp on the computer opens the chat on your phone.'), wrap);
      const h = hereOnce(); if (h) foot(h);
      clearInterval(poll);
      poll = setInterval(async () => {
        try {
          const s2 = await load(true);
          if (s2.devices.length > before) { clearInterval(poll); say('Your phone is connected.'); draw(true); }
        } catch (e) { /* asked again in a moment */ }
      }, 3000);
    }

    async function draw(justConnected) {
      body.replaceChildren(el('p', 'p-muted', 'Loading...'));
      let s;
      try { s = await load(true); } catch (e) { body.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
      if (isPhone()) {
        // A phone that is logged in: one button.
        body.replaceChildren(el('p', '', s.devices.length ? 'WhatsApp opens on your phone. To turn it on for this phone too:' : 'Tap "Turn on": when you press WhatsApp on a student on the computer, the chat opens here.'));
        const msg = el('div', 'p-msg');
        const go = btn('btn btn-primary', 'Turn on', async () => {
          go.disabled = true;
          try { await connectHere(); say('Done. WhatsApp chats will open on this phone.'); draw(true); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; go.disabled = false; }
        });
        const bar = el('div', 'p-bar'); bar.append(go);
        body.append(bar, msg);
        return;
      }
      if (!s.devices.length) { showCode(false); return; }
      body.replaceChildren();
      body.append(el('p', 'pl-ready', justConnected ? '✓ Done. Press WhatsApp on any student: your phone shows a notification, one tap opens the chat.' : '✓ WhatsApp opens on your phone.'));
      const list = el('ul', 'pl-devices');
      s.devices.forEach((x) => {
        const li = el('li');
        li.append(el('span', 'pl-ok', '✓'), el('b', '', x.name), el('span', 'p-muted p-small', `since ${new Date(x.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`));
        li.append(btn('btn btn-sm', 'Disconnect', async () => { await api('/api/push/disconnect', { id: x.id }); say('Disconnected'); draw(); }));
        list.append(li);
      });
      body.append(list);
      foot(btn('btn', 'Send a test to my phone', async () => { try { await api('/api/push/whatsapp', { test: true }); say('Sent. Look at your phone.'); } catch (e) { say(e.message, true); } }),
        btn('btn', 'Connect another phone', () => showCode(true)), btn('btn btn-primary', 'Done', () => d.close()));
    }
    d.showModal();
    draw();
  }

  // The WhatsApp button of a student: the phone when one is connected, else WhatsApp on this device.
  async function openChat({ id, number, name, text }) {
    if (isPhone()) { (window.top || window).location.href = `/wa?n=${number}&name=${encodeURIComponent(name || '')}${text ? `&text=${encodeURIComponent(text)}` : ''}`; return; }
    let s = null;
    try { s = await load(); } catch (e) { s = null; }
    if (s && s.devices.length && id) {
      try {
        await api('/api/push/whatsapp', { id, text: text || '' });
        say(`Sent to your phone. Tap the notification to chat with ${name || 'the student'}.`);
        return;
      } catch (e) {
        if (e.status === 409 || /no longer connected/.test(e.message)) status = null;
        say(`${e.message} Opening WhatsApp here instead.`, true);
      }
      window.open(web(number, text), '_blank', 'noopener');
      return;
    }
    // No phone connected yet: how to connect one, and the chat on this computer this once.
    dialog({ href: web(number, text) });
  }

  window.PhoneLink = { openChat, dialog, connectHere };
})();
