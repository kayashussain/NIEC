// "WhatsApp opens on my phone" (the owner, 17 Nov 2026), the page side (the server side is push.js):
//   - Connect my phone: done once. The computer shows a code; the phone's camera opens it and one tap ("Turn on") connects the
//     phone (pair.html, no login on the phone). A phone that is logged in can also press Turn on in the same window.
//   - Then a click on WhatsApp on the computer sends that phone a notification; one tap on it opens the student's chat in WhatsApp on
//     the phone. Call works the same way (the owner, 17 Nov 2026): a click on Call sends a notification and one tap on it rings the
//     student from the phone (a phone always asks for that one tap: a web page may not start a call by itself). On a phone the click opens WhatsApp at once. With no phone connected, the computer shows how to connect one, with
//     "Open it on this computer this time".
// window.PhoneLink = { openChat({ id, number, name, text }), call({ id, number, name }), dialog() }. Loaded on every page by header.js.
(function () {
  if (window.PhoneLink) return;
  // One notice at a time for a click (the owner, 17 Nov 2026: a click must show at once that it worked): each new notice replaces
  // the one before, so "Sending...", "Sent" and "On your phone" follow each other in the same place.
  let lastNotice = null;
  const say = (t, bad, opts) => {
    if (lastNotice) { try { lastNotice(); } catch (e) { /* gone already */ } lastNotice = null; }
    if (!(window.NiecUI && window.NiecUI.toast)) { if (bad) alert(t); return; }
    lastNotice = window.NiecUI.toast(t, { type: bad ? 'error' : (opts && opts.type) || 'success', ...(opts && opts.duration ? { duration: opts.duration } : {}) });
  };
  const isPhone = () => window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // Every call has a time limit, so a click is never left without an answer.
  async function api(url, body) {
    const opts = body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    if (window.AbortSignal && AbortSignal.timeout) opts.signal = AbortSignal.timeout(15000);
    let r;
    try { r = await fetch(url, opts); } catch (e) { const err = new Error(e && e.name === 'TimeoutError' ? 'ISR did not answer in time. Check the internet and try again.' : 'No connection to ISR. Check the internet and try again.'); err.status = 0; throw err; }
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

  // This phone's id and secret, kept on the phone for ISR's service worker (sw.js), so it renews its push address by itself.
  const STORE = 'isr-device'; const ME = '/__isr-device';
  const mine = async () => { try { const r = await (await caches.open(STORE)).match(ME); return r ? await r.json() : null; } catch (e) { return null; } };
  const keepMine = async (me) => { try { await (await caches.open(STORE)).put(ME, new Response(JSON.stringify(me), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* still works */ } };
  // Any page of ISR opened on a connected phone checks in quietly, so the phone stays connected (sw.js heal).
  try { if (isPhone() && navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('heal'); } catch (e) { /* fine */ }

  async function connectHere() {
    if (!canPush()) throw new Error(isIos() && !standalone() ? 'On an iPhone, first add ISR to the Home Screen (the Share button, then Add to Home Screen), open ISR from there, and press Connect again.' : 'This browser cannot get notifications. Use Chrome on Android, or Safari on iPhone with ISR on the Home Screen.');
    const allowed = await Notification.requestPermission();
    if (allowed !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site in the phone\'s settings, then press Connect again.');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const s = await load(true);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(s.key) });
    const old = await mine();
    const out = await api('/api/push/connect', { subscription: sub.toJSON(), name: deviceName(), old: old ? { id: old.d, secret: old.k } : undefined });
    if (out.device) await keepMine({ d: out.device.id, k: out.device.secret, key: s.key, endpoint: sub.endpoint, checkedAt: Date.now() });
    status = out;
    return status;
  }

  function loadQr() {
    if (window.IsrQr) return Promise.resolve(window.IsrQr);
    return new Promise((resolve, reject) => { const sc = document.createElement('script'); sc.src = '/qr.js'; sc.onload = () => resolve(window.IsrQr); sc.onerror = reject; document.head.append(sc); });
  }

  // Small line icons, drawn here (nothing to download): a phone, and a phone with a chat bubble.
  const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 18.6h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_CHAT = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="13" y="5" width="22" height="38" rx="5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 38.5h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24.5 13.5h9.5a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-4.2l-4.3 3.6v-3.6h-1a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4z" fill="#25d366"/><circle cx="26" cy="20" r="1.2" fill="#fff"/><circle cx="29.8" cy="20" r="1.2" fill="#fff"/><circle cx="33.6" cy="20" r="1.2" fill="#fff"/></svg>';
  const icon = (cls, svg) => { const s = el('span', cls); s.innerHTML = svg; return s; };
  const day = (iso) => { const t = new Date(iso); if (Number.isNaN(t.getTime())) return ''; const n = new Date(); const d0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const diff = Math.round((d0(n) - d0(t)) / 864e5); return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const OS_KEY = 'isr-phone-kind';
  const STEPS = {
    android: [['Open the camera', 'Point it at the code and tap the link that appears. (If the camera shows no link, open Chrome and tap the camera icon in the search bar.)'], ['Tap "Turn on", then "Allow"', 'That is all. No login on the phone.']],
    iphone: [['Open the Camera', 'Point it at the code and tap the link that appears.'], ['Add ISR to the Home Screen', 'Tap the Share button, then "Add to Home Screen". Apple asks for this once.'], ['Open ISR from the Home Screen', 'Tap "Turn on", then "Allow". That is all.']],
  };

  // The window to connect a phone (the owner, 17 Nov 2026: simple enough to explain in one sentence, and as clear and professional
  // as Apple's own set-up screens). On a computer: the code, the steps for Android or iPhone, and a live line that follows the phone
  // (waiting, opened on the phone, connected), with how long the code still works. On a phone that is logged in: one button. With a
  // phone connected: a tick, the phones (when connected, when last used), Disconnect (asked twice), a test and another phone. `once`:
  // opened from a WhatsApp click with no phone connected yet, with "Open it on this computer this time".
  function dialog(once) {
    const d = el('dialog', 'p-dialog pc-dialog');
    const head = el('div', 'p-dialog-head');
    head.append(el('h2', '', 'WhatsApp on your phone'), btn('p-x', '×', () => d.close()));
    head.lastChild.setAttribute('aria-label', 'Close');
    const body = el('div', 'p-dialog-body');
    d.append(head, body);
    let poll = null; let tick = null;
    const stop = () => { clearInterval(poll); clearInterval(tick); poll = null; tick = null; };
    d.addEventListener('close', () => { stop(); d.remove(); });
    d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    const foot = (...buttons) => { const f = el('div', 'p-dialog-foot pc-foot'); f.append(...buttons.filter(Boolean)); body.append(f); };
    const hereOnce = () => { if (!once) return null; const a = el('a', 'btn', 'Open it on this computer this time'); a.href = once.href; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', () => setTimeout(() => d.close(), 50)); return a; };
    const hero = (svg, title, words) => { const h = el('div', 'pc-hero'); const t = el('div', 'pc-hero-text'); t.append(el('h3', '', title), el('p', '', words)); h.append(icon('pc-hero-icon', svg), t); return h; };

    async function showCode(again) {
      stop();
      body.replaceChildren(el('p', 'pc-loading', 'Making your code...'));
      let made; let qr;
      try { [made, qr] = await Promise.all([api('/api/push/pair-code', {}), loadQr()]); } catch (e) { body.replaceChildren(el('div', 'p-notice bad', e.message || 'Something went wrong.')); return; }
      const top = again
        ? hero(ICON_CHAT, 'Connect another phone', 'Do the same on the other phone. Both will get the WhatsApp chats you open here.')
        : hero(ICON_CHAT, 'Open student chats on your own phone', 'Set it up once. Then press WhatsApp on any student here, tap the notification on your phone, and the chat opens. Nothing is saved on your phone, and your WhatsApp never touches this computer.');

      const card = el('div', 'pc-qr-card');
      const code = el('div', 'pc-qr');
      code.innerHTML = qr.svg(made.url, { size: 232 });
      code.firstChild.setAttribute('aria-label', 'The code to scan with your phone');
      code.firstChild.setAttribute('role', 'img');
      const timer = el('p', 'pc-timer');
      card.append(code, timer);

      const side = el('div', 'pc-side');
      const seg = el('div', 'pc-os');
      seg.setAttribute('role', 'tablist');
      seg.setAttribute('aria-label', 'Your phone');
      const steps = el('ol', 'pc-steps');
      let kind = 'android';
      try { if (localStorage.getItem(OS_KEY) === 'iphone') kind = 'iphone'; } catch (e) { /* private window */ }
      const drawSteps = () => {
        steps.replaceChildren(...STEPS[kind].map(([b, small], i) => { const li = el('li'); li.append(el('span', 'pc-n', String(i + 1))); const t = el('div'); t.append(el('b', '', b), el('span', '', small)); li.append(t); return li; }));
        [...seg.children].forEach((x) => { const on = x.dataset.kind === kind; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
      };
      [['android', 'Android'], ['iphone', 'iPhone']].forEach(([k, label]) => {
        const b = btn('', label, () => { kind = k; try { localStorage.setItem(OS_KEY, k); } catch (e) { /* fine */ } drawSteps(); });
        b.dataset.kind = k; b.setAttribute('role', 'tab'); seg.append(b);
      });
      drawSteps();
      const state = el('div', 'pc-status');
      state.setAttribute('role', 'status');
      const setState = (cls, text) => { state.className = `pc-status ${cls}`; state.replaceChildren(el('span', 'pc-dot'), el('span', '', text)); };
      setState('is-waiting', 'Waiting for your phone...');
      side.append(seg, steps, state);

      const pair = el('div', 'pc-pair');
      pair.append(card, side);
      body.replaceChildren(top, pair);
      foot(hereOnce(), again ? btn('btn', 'Back', () => draw()) : null);

      const until = new Date(made.until).getTime();
      let over = false;
      const expired = () => {
        stop();
        if (over) return;
        over = true;
        card.classList.add('is-old');
        timer.textContent = 'This code has run out';
        setState('is-bad', 'The code has run out.');
        state.after(btn('btn btn-primary', 'Make a new code', () => showCode(again)));
      };
      const showTime = () => {
        const left = Math.max(0, Math.round((until - Date.now()) / 1000));
        if (!left) { expired(); return; }
        timer.textContent = `Works for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more, once`;
      };
      showTime();
      tick = setInterval(showTime, 1000);
      let seen = false;
      poll = setInterval(async () => {
        let st;
        try { st = await api('/api/push/pair-status?t=' + encodeURIComponent(made.token)); } catch (e) { return; } // asked again in a moment
        if (st.state === 'opened' && !seen) { seen = true; card.classList.add('is-seen'); setState('is-seen', kind === 'iphone' ? 'Your phone has the code. Finish the steps on the phone.' : 'Your phone has the code. Tap "Turn on", then "Allow".'); }
        if (st.state === 'done') { stop(); status = null; draw(st.device ? st.device.name : 'Your phone'); }
        if (st.state === 'expired') expired();
      }, 2000);
    }

    async function draw(justConnected) {
      stop();
      body.replaceChildren(el('p', 'pc-loading', 'Loading...'));
      let s;
      try { s = await load(true); } catch (e) { body.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
      if (isPhone()) {
        // A phone that is logged in: one button.
        body.replaceChildren(hero(ICON_CHAT, s.devices.length ? 'Turn it on for this phone too' : 'Open student chats on this phone', 'When you press WhatsApp on a student on the computer, this phone shows a notification. Tap it and the chat opens. Nothing is saved on the phone.'));
        const msg = el('div', 'p-msg');
        const go = btn('btn btn-primary pc-big', 'Turn on', async () => {
          go.disabled = true;
          try { await connectHere(); say('Done. WhatsApp chats will open on this phone.'); draw(deviceName()); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; go.disabled = false; }
        });
        body.append(go, msg);
        return;
      }
      if (!s.devices.length) { showCode(false); return; }
      const done = el('div', 'pc-done' + (justConnected ? ' is-new' : ''));
      done.append(el('span', 'pc-check', '✓'), el('h3', '', justConnected ? `${justConnected} is connected` : 'WhatsApp opens on your phone'),
        el('p', '', 'Press WhatsApp on any student. Your phone shows a notification: tap it and the chat opens.'));
      const list = el('ul', 'pc-devices');
      s.devices.forEach((x) => {
        const li = el('li');
        const t = el('div', 'pc-dev-text');
        t.append(el('b', '', x.name), el('span', '', x.lost ? 'Not answering. Open ISR on it once and it reconnects by itself.' : `Connected ${day(x.at)}${x.usedAt ? ` · Last used ${day(x.usedAt)}` : ''}`));
        let sure = null;
        const off = btn('btn btn-sm pc-off', 'Disconnect', async () => {
          if (!sure) { off.textContent = 'Disconnect?'; off.classList.add('is-sure'); sure = setTimeout(() => { sure = null; off.textContent = 'Disconnect'; off.classList.remove('is-sure'); }, 3500); return; }
          clearTimeout(sure); off.disabled = true;
          try { await api('/api/push/disconnect', { id: x.id }); status = null; say(`${x.name} is disconnected`); draw(); } catch (e) { say(e.message, true); off.disabled = false; }
        });
        li.append(icon('pc-dev-icon', ICON_PHONE), t, off);
        list.append(li);
      });
      body.replaceChildren(done, list);
      const test = btn('btn', 'Send a test', async () => {
        test.disabled = true;
        say('Sending a test to your phone...', false, { type: 'info', duration: 15000 });
        try { const r = await api('/api/push/whatsapp', { test: true }); const to = (r.to && r.to[0]) || 'phone'; say(`Sent. Look at your ${to}.`); follow(r.m, to, 'the test'); } catch (e) { say(e.message, true); }
        test.disabled = false;
      });
      foot(test, btn('btn', 'Connect another phone', () => showCode(true)), btn('btn btn-primary', 'Done', () => d.close()));
    }
    d.showModal();
    draw();
  }

  // After a send: ISR's service worker on the phone says when the notification has arrived and when it was tapped, so the person
  // knows their click worked (the owner, 17 Nov 2026). Asked every second for up to 25 seconds; a phone connected before this
  // (no receipt) simply keeps the "Sent" notice.
  let following = 0;
  async function follow(m, to, what) {
    if (!m) return;
    const mine = ++following;
    let arrived = false;
    for (let i = 0; i < 25 && mine === following; i += 1) {
      await new Promise((r) => setTimeout(r, i < 5 ? 600 : 1000));
      if (mine !== following) return;
      let r;
      try { r = await api('/api/push/receipt?m=' + encodeURIComponent(m)); } catch (e) { continue; }
      if (r.state === 'opened') { say(`Opened on your ${r.opened || to}.`); return; }
      if (r.state === 'arrived' && !arrived) { arrived = true; say(`On your ${(r.got && r.got[0]) || to} now. Tap the notification to open ${what}.`, false, { duration: 12000 }); }
      if (r.state === 'unknown') return;
    }
    if (!arrived && mine === following) say(`Not on your ${to} yet. Check that the phone is online (Wi-Fi or mobile data), then press again.`, true);
  }

  // Pressed again for the same student while it is still being sent, or just after: nothing more is sent (the owner, 17 Nov 2026:
  // two clicks sent two notifications). The server says the same (15 seconds).
  const busy = new Map(); // "wa|call number" -> time pressed
  function once(key) {
    const t = busy.get(key);
    if (t && Date.now() - t < 15000) return false;
    busy.set(key, Date.now());
    return true;
  }

  // Sends a WhatsApp chat or a call to the person's phone. Shows "Sending..." at once, then "Sent", then "On your phone".
  async function toPhone(kind, { id, number, name, text }, fallback) {
    const key = `${kind} ${number} ${text || ''}`;
    const who = name || 'the student';
    if (!once(key)) { say(`Already sent to your phone. Look for "${kind === 'call' ? 'Call' : 'WhatsApp'} ${who}".`, false, { type: 'info' }); return; }
    say('Sending to your phone...', false, { type: 'info', duration: 15000 });
    try {
      const r = await api('/api/push/whatsapp', kind === 'call' ? { id, call: true } : { id, text: text || '' });
      if (r.pending) { say(`Already being sent to your phone. Look for "${kind === 'call' ? 'Call' : 'WhatsApp'} ${who}".`, false, { type: 'info' }); return; }
      const to = r.to && r.to.length === 1 ? r.to[0] : 'phone';
      const what = kind === 'call' ? `the call to ${who}` : `the chat with ${who}`;
      say(r.again ? `Already sent to your ${to} ${r.secondsAgo || 0}s ago. Tap the notification to open ${what}.` : `Sent to your ${to}. Tap the notification to open ${what}.`, false, { duration: 12000 });
      if (!r.again) follow(r.m, to, what);
    } catch (e) {
      busy.delete(key);
      // The phone was removed, or is not answering: show how to connect it, with this computer for this once.
      if (e.status === 409) { status = null; say(e.message, true); dialog({ href: fallback }); return; }
      if (kind === 'wa') { say(`${e.message} Opening WhatsApp here instead.`, true); window.open(fallback, '_blank', 'noopener'); return; }
      say(e.message, true);
    }
  }

  // The WhatsApp button of a student: the phone when one is connected, else WhatsApp on this device.
  async function openChat({ id, number, name, text }) {
    if (isPhone()) { (window.top || window).location.href = `/wa?n=${number}&name=${encodeURIComponent(name || '')}${text ? `&text=${encodeURIComponent(text)}` : ''}`; return; }
    let s = null;
    try { s = await load(); } catch (e) { s = null; }
    if (s && s.devices.length && id) { toPhone('wa', { id, number, name, text }, web(number, text)); return; }
    // No phone connected yet: how to connect one, and the chat on this computer this once.
    dialog({ href: web(number, text) });
  }

  // Call a student: on a phone the call starts at once; on a computer with a phone connected, the phone gets "Call <name>" and one tap
  // rings the student; with no phone connected, how to connect one, with "Open it on this computer this time" (a computer's own
  // calling program, if it has one).
  async function call({ id, number, name }) {
    const tel = 'tel:+' + String(number || '').replace(/\D/g, '');
    if (isPhone()) { (window.top || window).location.href = tel; return; }
    let s = null;
    try { s = await load(); } catch (e) { s = null; }
    if (s && s.devices.length && id) { toPhone('call', { id, number, name }, tel); return; }
    dialog({ href: tel });
  }

  window.PhoneLink = { openChat, call, dialog, connectHere };
})();
