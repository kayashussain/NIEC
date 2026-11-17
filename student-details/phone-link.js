// "WhatsApp opens on my phone" (the owner, 17 Nov 2026), the page side (the server side is push.js):
//   - Connect my phone: done once, on the phone itself (ISR opened in the phone's browser, or from the Home Screen on an iPhone):
//     the phone allows ISR's notifications and is remembered for this person.
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

  // The window to connect or disconnect a phone: on a phone, one button; on a computer, the three steps to do on the phone.
  function dialog(once) {
    const d = el('dialog', 'p-dialog pl-dialog');
    const head = el('div', 'p-dialog-head');
    head.append(el('h2', '', 'Open WhatsApp chats on my phone'), btn('p-x', '×', () => d.close()));
    head.lastChild.setAttribute('aria-label', 'Close');
    const body = el('div', 'p-dialog-body');
    d.append(head, body);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    const draw = async () => {
      body.replaceChildren(el('p', 'p-muted', 'Loading...'));
      let s;
      try { s = await load(true); } catch (e) { body.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
      body.replaceChildren(el('p', '', 'Connect your phone once. Then, when you press WhatsApp on a student here on the computer, your phone shows a notification: one tap opens that student\'s chat in WhatsApp on your phone.'));
      if (s.devices.length) {
        const list = el('ul', 'pl-devices');
        s.devices.forEach((x) => {
          const li = el('li');
          li.append(el('span', 'pl-ok', '✓'), el('b', '', x.name), el('span', 'p-muted p-small', `connected ${new Date(x.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`));
          li.append(btn('btn btn-sm', 'Disconnect', async () => { await api('/api/push/disconnect', { id: x.id }); say('Disconnected'); draw(); }));
          list.append(li);
        });
        body.append(el('p', 'pl-ready', 'Your phone is connected.'), list);
      }
      if (isPhone()) {
        const go = btn('btn btn-primary', s.devices.length ? 'Connect this phone again' : 'Connect this phone', async () => {
          go.disabled = true;
          try { await connectHere(); say('This phone is connected. WhatsApp chats will open here.'); draw(); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; go.disabled = false; }
        });
        const msg = el('div', 'p-msg');
        body.append(el('div', 'p-bar'), msg);
        body.querySelector('.p-bar').append(go);
        if (isIos() && !standalone()) body.append(el('p', 'p-muted p-small', 'On an iPhone: first press the Share button, then Add to Home Screen, and open ISR from the new icon. Then press Connect this phone.'));
      } else {
        const steps = el('ol', 'pl-steps');
        ['On your phone, open this website and log in.', 'On an iPhone: press Share, then Add to Home Screen, and open ISR from that icon. On Android: Chrome is enough.', 'Open the menu (your name at the bottom), choose "Connect my phone", press Connect this phone and allow notifications.']
          .forEach((t) => steps.append(el('li', '', t)));
        body.append(el('p', 'p-label', 'On your phone, one time:'), steps);
      }
      // From a WhatsApp click with no phone connected yet: the chat can still be opened here this once.
      if (once && !s.devices.length) {
        body.append(el('div', 'p-dialog-foot'));
        const here = el('a', 'btn', 'Open it on this computer this time');
        here.href = once.href; here.target = '_blank'; here.rel = 'noopener';
        here.addEventListener('click', () => setTimeout(() => d.close(), 50));
        body.lastChild.append(here);
      }
      if (s.devices.length) {
        body.append(el('div', 'p-dialog-foot'));
        body.lastChild.append(btn('btn', 'Send a test to my phone', async () => {
          try { await api('/api/push/whatsapp', { test: true }); say('Sent. Look at your phone.'); } catch (e) { say(e.message, true); }
        }), btn('btn btn-primary', 'Done', () => d.close()));
      }
    };
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
