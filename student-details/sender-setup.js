// Your setup for sending (on Follow-up, the owner, 17 Nov 2026): the person's own email (checked with a test email, the password kept
// encrypted on the server), their signature picture and their WhatsApp number, each one row that says whether it is ready, with the
// form to set it up right under it. Message templates and the My email page are gone: this is the one place to set up sending.
//
//   window.SenderSetup.mount(box, { open, onChange }) draws it into `box`; `onChange(info)` runs after every change.
(function () {
  const { el, h, api, field } = window.Portal;
  const say = (t, bad) => window.NiecUI.toast(t, { type: bad ? 'error' : 'success' });

  function emailForm(d, done) {
    const wrap = el('div', 'ss-form');
    const from = field('Your email address', { value: d.from || '', placeholder: 'e.g. asha@niecedu.com.np', max: 254 });
    from.input.type = 'email'; from.input.autocomplete = 'email';
    const pass = field('The password of that mailbox', { placeholder: d.set ? 'Type it again to change anything' : '', max: 300 });
    pass.input.type = 'password'; pass.input.autocomplete = 'new-password';
    const host = field('Mail server', { value: d.host || d.defaults.host, max: 200 });
    const port = field('Port', { value: String(d.port || d.defaults.port || 465), max: 5 });
    const security = field('Security', { kind: 'select', choices: [['ssl', 'SSL (port 465)'], ['starttls', 'STARTTLS (port 587)']], value: d.security || d.defaults.security || 'ssl' });
    const more = el('details', 'ss-more');
    more.append(el('summary', '', 'Mail server settings (only if your email is not on the office mail server)'));
    const g2 = el('div', 'p-form p-form-2'); g2.append(host.wrap, port.wrap, security.wrap); more.append(g2);
    const g = el('div', 'p-form p-form-2'); g.append(from.wrap, pass.wrap);
    const msg = el('div', 'p-msg');
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Check and save');
    save.addEventListener('click', async () => {
      if (!from.input.value.trim()) { from.input.focus(); return; }
      if (!pass.input.value) { pass.input.focus(); return; }
      save.disabled = true; msg.textContent = 'Sending a test email to your address...'; msg.className = 'p-msg';
      try {
        await api('/api/my-mail', { from: from.input.value, password: pass.input.value, host: host.input.value, port: port.input.value, security: security.input.value });
        say('Your email works and is saved. A test email is in your inbox.');
        done();
      } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; save.disabled = false; }
    });
    const bar = el('div', 'p-bar'); bar.append(save);
    if (d.set) {
      bar.append(h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await window.NiecUI.confirm('Remove your mailbox from ISR? You will not be able to send emails until you set it up again.', { danger: true, confirmText: 'Remove' }))) return;
        await api('/api/my-mail/delete', {}); say('Removed'); done();
      } }, 'Remove my mailbox'));
    }
    wrap.append(g, more, el('p', 'p-muted p-small', 'A test email is sent to you first; nothing is saved if it does not arrive. Your password is stored encrypted.'), bar, msg);
    return wrap;
  }

  function signatureForm(d, done) {
    const wrap = el('div', 'ss-form');
    const show = el('div', 'p-sig');
    if (d.signature) show.append(h('img', { src: '/api/my-mail/signature?t=' + Date.now(), alt: 'Your email signature' }));
    else show.append(el('div', 'p-sig-empty', 'No signature picture yet. Until you upload one, your emails end with your name, team and email as text.'));
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
    const pick = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => file.click() }, d.signature ? 'Change the picture' : 'Upload a signature picture');
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      pick.disabled = true;
      try {
        const r = await fetch('/api/my-mail/signature', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'It could not be uploaded.');
        say('Your signature is saved.');
        done();
      } catch (e) { say(e.message, true); pick.disabled = false; }
    });
    const bar = el('div', 'p-bar'); bar.append(pick, file);
    if (d.signature) bar.append(h('button', { class: 'btn', type: 'button', onclick: async () => { await api('/api/my-mail/signature/delete', {}); say('Removed'); done(); } }, 'Remove'));
    wrap.append(el('p', 'p-muted p-small', 'A PNG or JPG, up to 1 MB, as wide as you like it to show (about 600 pixels is ideal). It ends every email you send.'), show, bar);
    return wrap;
  }

  function whatsappForm(d, done) {
    const wrap = el('div', 'ss-form');
    const phone = field('Your WhatsApp number', { value: d.phone || '', placeholder: 'e.g. +977 9800000001', max: 40 });
    phone.input.type = 'tel'; phone.input.autocomplete = 'tel';
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
    const msg = el('div', 'p-msg');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await api('/api/my-mail/phone', { phone: phone.input.value }); say(phone.input.value.trim() ? 'Your WhatsApp number is saved.' : 'Removed'); done(); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; save.disabled = false; }
    });
    phone.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    const g = el('div', 'p-form p-form-2'); g.append(phone.wrap);
    const bar = el('div', 'p-bar'); bar.append(save);
    const steps = el('ol', 'ss-steps');
    ['WhatsApp messages go from the WhatsApp you use on this computer: the WhatsApp Desktop app, or WhatsApp Web.',
      'Link it once: on your phone open WhatsApp, Settings, Linked devices, Link a device, and scan the code shown on this computer.',
      'On a phone, the WhatsApp buttons open the WhatsApp app itself.'].forEach((t) => steps.append(el('li', '', t)));
    wrap.append(g, el('p', 'p-muted p-small', 'Shown in the signature of your emails, so students can reach you.'), bar, msg, steps,
      h('a', { class: 'btn btn-sm', href: 'https://web.whatsapp.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Open WhatsApp Web'));
    return wrap;
  }

  // Admin's office settings: a copy of every email to the office mailbox (was on Message templates).
  function officeRow(t) {
    const box = el('label', 'p-check ss-office');
    const c = el('input'); c.type = 'checkbox'; c.checked = t.signature.copyToOffice !== false;
    box.append(c, el('span', '', 'Send a copy of every email to the office mailbox, so the replies and the sent emails are found in one place'));
    c.addEventListener('change', async () => {
      try { await api('/api/templates/signature', { copyToOffice: c.checked }); say('Saved'); } catch (e) { c.checked = !c.checked; say(e.message, true); }
    });
    return box;
  }

  async function mount(box, { open = false, onChange } = {}) {
    const [d, t] = await Promise.all([api('/api/my-mail'), api('/api/templates')]);
    const ready = { email: Boolean(t.mail.ready), signature: Boolean(d.signature || d.admin), whatsapp: Boolean(d.phone) };
    const openRow = box.dataset.openRow || '';
    const reload = async (row) => { box.dataset.openRow = row || ''; const info = await mount(box, { open: true, onChange }); if (onChange) onChange(info); };
    const rows = [
      {
        key: 'email', title: 'Your email',
        state: ready.email ? (d.set ? `Emails go from ${d.from}` : `Emails go from the office mailbox (${t.mail.from})`) : 'Not set up: emails cannot be sent yet',
        action: ready.email ? 'Change' : 'Set up', form: () => emailForm(d, () => reload('')),
      },
      {
        key: 'signature', title: 'Your signature',
        state: d.admin ? 'Your emails end with the office signature' : d.signature ? 'Your picture ends every email' : 'No picture yet: your name and team are written instead',
        action: d.admin ? '' : d.signature ? 'Change' : 'Upload', form: () => signatureForm(d, () => reload('')), soft: !d.admin && !d.signature,
      },
      {
        key: 'whatsapp', title: 'Your WhatsApp',
        state: d.phone ? `Your number: ${d.phone}` : 'Add your number, so students know it is you',
        action: d.phone ? 'Change' : 'Add', form: () => whatsappForm(d, () => reload('')), soft: !d.phone,
      },
    ];
    const allReady = ready.email && ready.whatsapp;
    const card = el('section', 'p-card ss-card' + (allReady ? ' is-ready' : ''));
    card.id = 'setup';
    const head = el('div', 'ss-head');
    const words = el('div');
    words.append(el('h2', '', 'Your setup for sending'), el('p', 'p-muted p-small', allReady ? 'Everything is ready.' : 'Set these up once. They are yours: nobody else sends from them.'));
    head.append(words);
    card.append(head);
    const list = el('div', 'ss-rows');
    rows.forEach((r) => {
      const row = el('div', 'ss-row');
      const ok = r.key === 'signature' ? (d.admin || d.signature) : ready[r.key];
      const dot = el('span', 'ss-dot ' + (ok ? 'is-ok' : r.soft ? 'is-soft' : 'is-bad'), ok ? '✓' : '!');
      dot.setAttribute('aria-hidden', 'true');
      const text = el('div', 'ss-text');
      text.append(el('b', '', r.title), el('span', '', r.state));
      row.append(dot, text);
      const formBox = el('div', 'ss-form-box');
      const shown = openRow === r.key || (open && !openRow && !ok && r.key === 'email');
      if (r.action) {
        const btn = h('button', { class: 'btn btn-sm' + (ok ? '' : ' btn-primary'), type: 'button', 'aria-expanded': String(shown) }, shown ? 'Close' : r.action);
        btn.addEventListener('click', () => {
          const now = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', String(now));
          btn.textContent = now ? 'Close' : r.action;
          formBox.replaceChildren(...(now ? [r.form()] : []));
          if (now) { const f = formBox.querySelector('input:not([type=file]):not([type=checkbox])'); if (f) f.focus(); }
        });
        row.append(btn);
      }
      if (shown) formBox.append(r.form());
      const item = el('div', 'ss-item');
      item.append(row, formBox);
      list.append(item);
    });
    card.append(list);
    if (t.canEdit) card.append(officeRow(t));
    box.replaceChildren(card);
    box.dataset.openRow = '';
    return { ready, mail: t.mail, fields: t.fields, phone: d.phone || '' };
  }

  window.SenderSetup = { mount };
})();
