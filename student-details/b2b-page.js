// B2B Partners and Agents (one page script for both, chosen by data-kind on the body). Admin edits them; the Manager (with the
// commission) and the Mock Team (without the commission and the portal login) look at them; the Application Team sets B2B partners
// up without the commission (the owner, 15 Nov 2026): the server sends each account only what partner-access.js allows, and
// `data.access` says which ('full', 'setup', 'commission' or 'team').
//   B2B Partners: the businesses you send applications to (they hold the direct agreement with a university). Each card shows how to
//   submit (the portal and its login, or the email) so it can be used without opening the partner.
//   Agents: the businesses that send you their students.
// Each has its contacts, the day its agreement started (chosen on a calendar), the commission list of each intake (a link or a PDF)
// and the visas it has brought. No agreement files are uploaded here (the owner, 15 Nov 2026).
(function () {
  const { el, h, api, field, number } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const KIND = document.body.dataset.kind === 'agents' ? 'agents' : 'b2b';
  const WORD = KIND === 'agents' ? { one: 'agent', a: 'an agent', title: 'Agents' } : { one: 'partner', a: 'a partner', title: 'B2B Partners' };
  const API = '/api/' + KIND;
  const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
  let data = null;
  // 'setup': the Application Team sets B2B partners up (details, how to submit, contacts) but not the commission, files or notes.
  const settingUp = () => data && data.access === 'setup';
  const viewer = () => data && data.access && data.access !== 'full' && data.access !== 'setup';
  // Admin edits everything; the Application Team opens the partner and changes only how to submit; everyone else looks.
  const open = (id, o) => (viewer() || settingUp() ? view(id, o) : edit(id));

  const stats = (name) => data.performance[String(name).toLowerCase()] || { students: 0, visas: 0, intakes: {} };
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const openLink = (text, href, cls = 'bp-link') => { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const btn = (cls, label, onClick) => { const b = el('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
  // Small round icon buttons (copy, show the password), each named for screen readers and on hover.
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  };
  const iconBtn = (icon, label, onClick) => { const b = btn('bp-icon', '', onClick); b.innerHTML = ICON[icon]; b.title = label; b.setAttribute('aria-label', label); return b; };
  const copy = (value, what) => iconBtn('copy', `Copy the ${what.toLowerCase()}`, async () => { try { await navigator.clipboard.writeText(value); say(`${what} copied`); } catch (e) { say(`Could not copy the ${what.toLowerCase()}`, true); } });
  const initialsOf = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const avatar = (name, big) => el('span', `bp-avatar${big ? ' is-big' : ''}`, initialsOf(name));
  const visasLine = (st) => `${number(st.visas)} visa${st.visas === 1 ? '' : 's'} · ${number(st.students)} student${st.students === 1 ? '' : 's'}`;
  const PILL = { Active: 'green', Ended: 'red' };
  // The agreement start as the calendar needs it (2026-01-01). Older records were typed by hand ("1 Jan 2026", "1/31/2026"): they
  // are read when they can be, so they open on the right day; anything else is kept as it was until a day is chosen.
  function isoDay(v) {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!/\d{4}/.test(s)) return '';
    const t = new Date(s + ' 12:00');
    return Number.isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  const started = (p) => (p.agreementStart ? 'Started ' + window.Portal.day(isoDay(p.agreementStart) || p.agreementStart) : '');
  // The partner just saved: its card glows once when the list comes back.
  let justSaved = '';

  // ---- the list ----
  // The busiest first (the most visas, then the most students, then by name), the ended ones last. No Sort menu (the owner, 17 Nov 2026).
  // Each entry is a partner set up ({ p }) or a name on the sheet not set up yet ({ x }).
  const nameOf = (it) => (it.p || it.x).name;
  const isEnded = (it) => Boolean(it.p && it.p.status === 'Ended');
  const studentsOf = (it) => (it.x ? it.x.students : stats(nameOf(it)).students);
  const busiest = (a, b) => isEnded(a) - isEnded(b) || stats(nameOf(b)).visas - stats(nameOf(a)).visas || studentsOf(b) - studentsOf(a) || nameOf(a).localeCompare(nameOf(b));
  function draw() {
    const all = data.partners;
    const sheet = data.onSheet || []; // named in the University Partner column, not set up yet
    const shown = all; // no search box (the owner, 17 Nov 2026)
    const shownSheet = sheet;
    const total = all.length + sheet.length;
    // Names marked "Not a partner" stay out of the list (the owner, 15 Nov 2026); a small "N hidden" above the list brings one back.
    const hidden = (data.notPartners || []);
    const hiddenBtn = $('hiddenBtn') || (() => { const b = btn('bp-hidden-btn', '', showHidden); b.id = 'hiddenBtn'; document.querySelector('.bp-tools').append(b); return b; })();
    hiddenBtn.textContent = `${hidden.length} hidden`;
    hiddenBtn.hidden = !hidden.length || viewer();
    // Admin adds a partner or an agent with the button beside the title (the owner, 26 Nov 2026).
    addButton(data.access === 'full');
    if (!total) { $('list').replaceChildren(el('div', 'bp-empty', `No ${WORD.one}s yet.`)); return; }
    const lead = [];
    const items = [...shown.map((p) => ({ p })), ...shownSheet.map((x) => ({ x }))];
    const ordered = items.sort(busiest);
    $('list').replaceChildren(...lead, ...ordered.map((it) => (it.p ? card(it.p) : sheetCard(it.x))));
  }
  // "Add partner" / "Add agent" (Admin only): the name first, then the new card opens so the rest can be filled in.
  function addButton(show) {
    let b = $('addBtn');
    if (!b) { b = btn('btn btn-primary bp-add', KIND === 'agents' ? '+ Add agent' : '+ Add partner', addOne); b.id = 'addBtn'; document.querySelector('#listView .p-head').append(b); }
    b.hidden = !show;
  }
  function addOne() {
    window.Portal.dialog(KIND === 'agents' ? 'Add an agent' : 'Add a partner', (body, close) => {
      const name = field(KIND === 'agents' ? 'Agent name' : 'Partner name', { max: 120, required: true, wide: true, placeholder: KIND === 'agents' ? 'The business that sends you students' : 'The business you apply through' });
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = btn('btn btn-primary', 'Add', async () => {
        const value = name.input.value.trim().replace(/\s+/g, ' ');
        if (!value) { msg.textContent = 'Write the name.'; msg.className = 'p-msg error'; name.input.focus(); return; }
        ok.disabled = true;
        try { const made = await api(API, { name: value }); close(); say(`${value} added`); justSaved = made && made.id; await load(); if (made && made.id) open(made.id); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; ok.disabled = false; }
      });
      name.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
      foot.append(btn('btn', 'Cancel', () => close()), ok);
      const form = el('div', 'p-form'); form.append(name.wrap);
      body.append(form, msg, foot);
    });
  }
  // The names marked "Not a partner", each with Show again.
  function showHidden() {
    window.Portal.dialog(`Hidden ${KIND === 'agents' ? 'agents' : 'partners'}`, (body, close) => {
      const list = el('div', 'bp-hidden-list');
      (data.notPartners || []).forEach((n) => {
        const row = el('div', 'bp-hidden-row');
        row.append(el('span', '', n), btn('btn btn-sm', 'Show again', async () => { await api(`${API}/not-partner`, { name: n, undo: true }); close(); load(); }));
        list.append(row);
      });
      const foot = el('div', 'p-dialog-foot'); foot.append(btn('btn', 'Close', () => close()));
      body.append(list, foot);
    });
  }

  // A partner named in the University Partner column but not set up yet: it can be marked as not a B2B partner (it is then hidden here
  // and in the dropdown, and can be shown again). It is no longer set up from here (the owner, 20 Nov 2026: no adding by hand).
  function sheetCard(x) {
    const st = stats(x.name);
    const c = el('article', 'bp-card bp-card-new');
    const head = el('div', 'bp-card-head');
    const who = el('div', 'bp-who');
    const words = el('div');
    words.append(el('div', 'bp-name', x.name), el('div', 'bp-sub', `${number(st.visas)} visa${st.visas === 1 ? '' : 's'} from ${number(x.students)} student${x.students === 1 ? '' : 's'} on the sheet`));
    who.append(avatar(x.name), words);
    head.append(who, el('span', 'bp-status amber', 'Not set up'));
    const foot = el('div', 'bp-foot');
    const notWord = KIND === 'agents' ? 'Not an agent' : 'Not a partner';
    foot.append(btn('btn', notWord, async () => {
      if (!(await window.NiecUI.confirm(`${x.name} is not ${KIND === 'agents' ? 'an agent' : 'a B2B partner'}? It is hidden from the list. You can show it again.`, { confirmText: notWord }))) return;
      await api(`${API}/not-partner`, { name: x.name }); say(`${x.name} hidden`); load();
    }));
    // Admin sets a name from the sheet up in one press, and its card opens to be filled in (the owner, 26 Nov 2026).
    if (data.access === 'full') {
      const add = btn('btn btn-primary', KIND === 'agents' ? 'Add as agent' : 'Add as partner', async () => {
        add.disabled = true;
        try { const made = await api(API, { name: x.name }); say(`${x.name} added`); justSaved = made && made.id; await load(); if (made && made.id) open(made.id); } catch (e) { say(e.message, true); add.disabled = false; }
      });
      foot.append(add);
    }
    c.append(head, foot);
    return c;
  }

  function card(p) {
    const st = stats(p.name);
    const c = el('article', `bp-card${p.id === justSaved ? ' is-saved' : ''}`);
    c.dataset.id = p.id;
    const head = el('div', 'bp-card-head');
    const who = el('div', 'bp-who');
    const words = el('div');
    words.append(btn('bp-name', p.name, () => open(p.id)), el('div', 'bp-sub', [p.city, visasLine(st)].filter(Boolean).join(' · ')));
    who.append(avatar(p.name), words);
    head.append(who, el('span', `bp-status ${PILL[p.status] || 'amber'}`, p.status));
    c.append(head);
    if (KIND === 'b2b') c.append(submitBox(p));
    // The partner's results at a glance, as on Partner Universities: students sent, visas, and how many of them got their visa.
    if (st.students) {
      const f = el('div', 'bp-funnel is-three');
      const rate = Math.round((st.visas / st.students) * 100);
      [['Students', number(st.students), 100], ['Visas', number(st.visas), rate], ['Visa rate', rate + '%', rate]].forEach(([k, n, w], i) => {
        const d = el('div', 'bp-funnel-step'); const bar = el('i'); bar.style.setProperty('--w', `${Math.max(6, w)}%`);
        if (i > 0) d.classList.add('is-visa');
        d.append(el('b', '', n), el('small', '', k), bar); f.append(d);
      });
      c.append(f);
    }
    const facts = el('dl', 'bp-facts');
    const row = (label, value) => { const dd = el('dd'); if (value instanceof Node) dd.append(value); else if (value) dd.textContent = value; else dd.append(el('span', 'bp-none', 'Not entered yet')); const pair = el('div', 'bp-fact'); pair.append(el('dt', '', label), dd); facts.append(pair); };
    // The commission of the intake that is running: open it, or a calm note that it is missing.
    const cur = data.currentIntake;
    const found = (p.commissions || []).find((x) => same(x.intake, cur) && (x.fileId || x.link));
    const withIntake = (node) => { const d = el('div', 'bp-lines'); d.append(node, el('small', 'bp-muted', cur || 'This intake')); return d; };
    if (data.access === 'team' || settingUp()) { /* a team does not see the commission */ } else if (found) row('Commission', withIntake(found.fileId ? openLink('Open the PDF \u2197', `${API}/${p.id}/files/${found.fileId}?open=1`) : openLink('Open the link \u2197', found.link)));
    else if (p.status === 'Ended') row('Commission', 'Ended');
    else if (viewer()) row('Commission', withIntake(el('span', 'bp-none', 'Not uploaded yet')));
    else row('Commission', withIntake(btn('bp-missing', 'Not uploaded yet', () => edit(p.id))));
    const k = p.contact || {};
    if (k.name || k.phone || k.email) {
      const d = el('div', 'bp-lines');
      if (k.name) d.append(el('span', 'bp-strong', k.name + (p.contactCount > 1 ? `  +${p.contactCount - 1}` : '')));
      if (k.phone) { const a = el('a', 'bp-link', k.phone); a.href = 'tel:' + k.phone.replace(/[^\d+]/g, ''); d.append(a); }
      if (k.email) { const a = el('a', 'bp-link', k.email); a.href = 'mailto:' + k.email; d.append(a); }
      row('Contact', d);
    } else row('Contact', null);
    row('Agreement', started(p));
    c.append(facts);
    const foot = el('div', 'bp-foot'); foot.append(btn('btn', settingUp() ? 'Open' : viewer() ? 'Open' : 'Edit', () => open(p.id)));
    c.append(foot);
    return c;
  }

  // How to submit an application through the partner, ready to use from the list: one "Open portal" button, then the username and
  // the password each on its own line with a copy button (and an eye to show the password).
  function submitBox(p) {
    const box = el('div', 'bp-submit');
    const line = (label, value, ...buttons) => { const d = el('div', 'bp-submit-line'); const b = el('span', 'bp-submit-btns'); b.append(...buttons); d.append(el('span', 'bp-submit-label', label), value, b); return d; };
    if (p.applyPortal) {
      const top = el('div', 'bp-submit-top');
      top.append(openLink('Open portal \u2197', p.applyPortal, 'bp-portal'), copy(p.applyPortal, 'Link'));
      box.append(top);
      if (p.applyUser) box.append(line('Username', el('code', 'bp-value', p.applyUser), copy(p.applyUser, 'Username')));
      if (p.applyPassword) {
        const dots = '\u2022'.repeat(10);
        const shown = el('code', 'bp-value', dots);
        const peek = iconBtn('eye', 'Show the password', () => { const showing = shown.textContent !== dots; shown.textContent = showing ? dots : p.applyPassword; peek.classList.toggle('is-on', !showing); peek.title = showing ? 'Show the password' : 'Hide the password'; peek.setAttribute('aria-label', peek.title); });
        box.append(line('Password', shown, peek, copy(p.applyPassword, 'Password')));
      } else if (p.loginHidden) {
        // The login is held back from this account (the Mock Team, a branch ...): the eye says so instead of showing it.
        const locked = iconBtn('eye', 'Show the password', () => window.NiecUI.toast('You do not have access to the portal login.', { type: 'error' }));
        locked.classList.add('is-locked');
        box.append(line('Password', el('code', 'bp-value bp-locked', '\u2022'.repeat(10)), locked));
      }
    } else if (p.applyEmail) {
      const top = el('div', 'bp-submit-top');
      const w = el('a', 'bp-portal', 'Write email \u2197'); w.href = 'mailto:' + p.applyEmail;
      top.append(w);
      box.append(top, line('Email', el('code', 'bp-value', p.applyEmail), copy(p.applyEmail, 'Email')));
    } else box.append(el('div', 'bp-none', 'How to apply is not entered yet'));
    return box;
  }

  // ---- one partner, in numbered steps ----
  function step(n, title, help) {
    const s = el('section', 'bp-step');
    const head = el('div', 'bp-step-head');
    const words = el('div'); words.append(el('h3', '', title)); if (help) words.append(el('p', '', help));
    head.append(el('span', 'bp-num', String(n)), words);
    s.append(head);
    return s;
  }
  function grid(cls, ...nodes) { const g = el('div', 'p-form ' + cls); nodes.forEach((n) => g.append(n)); return g; }
  function repeater(cols, items, addLabel) {
    const node = el('div');
    const box = el('div', 'bp-rows');
    const rows = [];
    const add = (item) => {
      const r = el('div', 'bp-row');
      const inputs = {};
      cols.forEach(([k, label, ph]) => { const f = field(label, { value: item[k], placeholder: ph, max: 500 }); inputs[k] = f.input; r.append(f.wrap); });
      r.append(btn('bp-remove', 'Remove', () => { r.remove(); rows.splice(rows.indexOf(inputs), 1); }));
      rows.push(inputs); box.append(r);
    };
    items.forEach(add);
    node.append(box, btn('btn btn-sm bp-add-row', '+ ' + addLabel, () => add({})));
    return { node, values: () => rows.map((i) => Object.fromEntries(Object.entries(i).map(([k, x]) => [k, x.value]))) };
  }
  function commissionEditor(id, p) {
    const node = el('div');
    const box = el('div', 'bp-rows');
    const rows = [];
    const intakes = data.intakes || [];
    const add = (item) => {
      const r = el('div', 'bp-row');
      const intake = field('Intake', { kind: 'select', choices: intakes, value: item.intake || data.currentIntake || '' });
      const link = field('Link (optional)', { value: item.link, placeholder: 'https://…', max: 500 });
      const st = { fileId: item.fileId || '' };
      const fileLine = el('div', 'p-field');
      const showFile = () => {
        const a = (p.agreements || []).find((x) => x.id === st.fileId);
        fileLine.replaceChildren(el('span', 'p-label', 'PDF'), a ? openLink(a.name, `${API}/${id}/files/${a.id}?open=1`) : el('span', 'p-muted', 'None uploaded'));
      };
      showFile();
      const pick = el('input'); pick.type = 'file'; pick.accept = '.pdf,.png,.jpg,.jpeg'; pick.setAttribute('aria-label', 'Upload the commission PDF');
      pick.addEventListener('change', async () => {
        const f = pick.files && pick.files[0]; if (!f) return;
        try {
          const res = await fetch(`${API}/${id}/files?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || 'Could not upload it.');
          p.agreements = j.agreements; st.fileId = j.agreements[j.agreements.length - 1].id; showFile(); say('Uploaded. Save to keep it for this intake.');
        } catch (e) { say(e.message, true); }
      });
      // The browser's own "Choose File, No file chosen" is hidden behind one plain button.
      const upLabel = el('label', 'btn btn-sm bp-upload');
      upLabel.append(document.createTextNode('Upload PDF'), pick);
      const rec = { intake, link, st };
      r.append(intake.wrap, link.wrap, fileLine, upLabel, btn('bp-remove', 'Remove', () => { r.remove(); rows.splice(rows.indexOf(rec), 1); }));
      rows.push(rec); box.append(r);
    };
    (p.commissions || []).forEach(add);
    node.append(box, btn('btn btn-sm bp-add-row', '+ Add an intake', () => add({})));
    return { node, values: () => rows.map((x) => ({ intake: x.intake.input.value, link: x.link.input.value, fileId: x.st.fileId, note: '' })) };
  }

  // A partner as the page uses it: every list present, whatever an older or partial record holds.
  const whole = (p) => ({ ...p, name: p.name || '', contacts: Array.isArray(p.contacts) ? p.contacts : [], commissions: Array.isArray(p.commissions) ? p.commissions : [], agreements: Array.isArray(p.agreements) ? p.agreements : [] });

  // ---- one partner, to look at (everyone but Admin), and for the Application Team to change how to submit ----
  async function view(id, o = {}) {
    const p = whole(await api(`${API}/${id}`));
    const st = stats(p.name);
    const page = el('div', 'bp-detail');
    page.append(btn('bp-back', `← ${WORD.title}`, closeEditor));
    // The partner at a glance: its initials, name, status, where it is and what it has brought.
    const hero = el('header', 'bp-hero');
    const words = el('div');
    const title = el('div', 'bp-hero-title');
    title.append(el('h2', '', p.name), el('span', `bp-status ${PILL[p.status] || 'amber'}`, p.status));
    words.append(title, el('p', 'bp-hero-sub', [p.city, started(p)].filter(Boolean).join(' · ')));
    const nums = el('div', 'bp-hero-nums');
    [[st.visas, st.visas === 1 ? 'visa' : 'visas'], [st.students, st.students === 1 ? 'student' : 'students']].forEach(([n, label]) => { const d = el('div'); d.append(el('b', '', number(n)), el('span', '', label)); nums.append(d); });
    hero.append(avatar(p.name, true), words, nums);
    page.append(hero);
    const section = (title, ...nodes) => { const s = el('section', 'bp-panel'); const hd = el('div', 'bp-panel-head'); hd.append(el('h3', '', title)); s.append(hd, ...nodes); page.append(s); return { s, hd }; };
    const none = (t = 'Not entered yet') => el('p', 'bp-none', t);
    if (KIND === 'b2b') {
      const sec = section('Application submission', submitBox(p));
      // The Application Team changes the portal link (or email), its username and its password here, and nothing else.
      if (settingUp()) {
        const form = () => {
          const apply = field('Portal link or email', { value: p.applyPortal || p.applyEmail, max: 600, wide: true, placeholder: 'https://portal.partner.com  or  applications@partner.com' });
          const user = field('Username', { value: p.applyUser, max: 200 });
          const pass = field('Password', { value: p.applyPassword, max: 200 });
          pass.input.type = 'password'; pass.input.autocomplete = 'new-password';
          const peek = iconBtn('eye', 'Show the password', () => { const hid = pass.input.type === 'password'; pass.input.type = hid ? 'text' : 'password'; peek.classList.toggle('is-on', hid); });
          const passRow = el('div', 'bp-pass'); pass.input.replaceWith(passRow); passRow.append(pass.input, peek);
          const login = grid('bp-two', user.wrap, pass.wrap);
          const showLogin = () => { const v = apply.input.value.trim(); login.hidden = !v || EMAIL.test(v); };
          apply.input.addEventListener('input', showLogin); showLogin();
          const bar = el('div', 'bp-form-bar');
          const save = btn('btn btn-primary', 'Save', async () => {
            save.disabled = true;
            try {
              const saved = await api(`${API}/${id}`, { apply: apply.input.value, applyUser: user.input.value, applyPassword: pass.input.value });
              if (apply.input.value.trim() && !saved.applyPortal && !saved.applyEmail) { say('That is not a web address or an email address.', true); save.disabled = false; return; }
              say(`${p.name} is saved.`);
              justSaved = id; closeEditor(); await load();
            } catch (e) { say(e.message, true); save.disabled = false; }
          });
          bar.append(save, btn('btn', 'Cancel', () => view(id)));
          const f = el('div', 'bp-submit-form');
          f.append(grid('bp-one', apply.wrap), login, bar);
          sec.s.replaceChildren(sec.hd, f);
          editBtn.hidden = true;
          setTimeout(() => apply.input.focus(), 0);
        };
        const editBtn = btn('btn btn-sm', 'Edit', form);
        sec.hd.append(editBtn);
        if (o.editSubmit) form();
      }
    }
    const contacts = (p.contacts || []).filter((c) => c.name || c.phone || c.email);
    const cl = el('div', 'bp-people');
    contacts.forEach((c) => {
      const row = el('div', 'bp-person');
      const w = el('div', 'bp-lines');
      if (c.name) w.append(el('span', 'bp-strong', c.name));
      if (c.phone) { const a = el('a', 'bp-link', c.phone); a.href = 'tel:' + c.phone.replace(/[^\d+]/g, ''); w.append(a); }
      if (c.email) { const a = el('a', 'bp-link', c.email); a.href = 'mailto:' + c.email; w.append(a); }
      row.append(avatar(c.name || c.email || '?'), w);
      cl.append(row);
    });
    section('Contacts', contacts.length ? cl : none());
    // The Manager also sees the commission list of each intake and the notes; a team never receives them.
    if (data.access === 'commission') {
      section('Commission by intake', (p.commissions || []).length ? (() => {
        const list = el('div', 'bp-people');
        p.commissions.forEach((c) => {
          const d = el('div', 'bp-person'); const w = el('div', 'bp-lines'); w.append(el('span', 'bp-strong', c.intake || 'Intake'));
          const f = (p.agreements || []).find((a) => a.id === c.fileId);
          if (f) w.append(openLink('Open the PDF ↗', `${API}/${p.id}/files/${f.id}?open=1`));
          if (c.link) w.append(openLink('Open the link ↗', c.link));
          d.append(w); list.append(d);
        });
        return list;
      })() : none());
      if (p.notes) section('Notes', el('p', 'bp-notes', p.notes));
    }
    $('editor').replaceChildren(page);
    $('listView').hidden = true; $('editor').hidden = false;
    window.scrollTo({ top: 0 });
  }

  async function edit(id) {
    const p = whole(await api(`${API}/${id}`));
    const st = stats(p.name);
    const ed = $('editor');
    const form = el('div');
    form.append(btn('bp-back', `← ${WORD.title}`, closeEditor));
    const head = el('div', 'bp-ed-head'); head.append(el('h2', '', p.name), el('span', `bp-status ${PILL[p.status] || 'amber'}`, p.status));
    form.append(head, el('p', 'bp-saved', `${number(st.visas)} visa${st.visas === 1 ? '' : 's'} from ${number(st.students)} student${st.students === 1 ? '' : 's'}.`));
    let n = 0;
    const name = field('Name', { value: p.name, max: 120 });
    const status = field('Status', { kind: 'select', choices: data.statuses, value: p.status });
    const blank = status.input.querySelector('option[value=""]'); if (blank) blank.remove();
    const city = field('City or country', { value: p.city, max: 300 });
    // When the agreement started, on a calendar (the owner, 15 Nov 2026: no end date asked). A day typed by hand in an older record
    // that cannot be read is named under the calendar and kept until a day is chosen.
    const start = field('Agreement started', { kind: 'date', value: isoDay(p.agreementStart) });
    if (p.agreementStart && !isoDay(p.agreementStart)) start.wrap.append(el('small', 'bp-was', `Was \u201c${p.agreementStart}\u201d. Choose the day.`));
    const s1 = step(++n, `The ${WORD.one}`, '');
    s1.append(grid('bp-four', name.wrap, status.wrap, city.wrap, start.wrap));
    const steps = [s1];

    let apply = null; let applyUser = null; let applyPassword = null;
    if (KIND === 'b2b') {
      const s2 = step(++n, 'Application submission', 'The portal link or email. Only Admin and the Application Team see the login.');
      apply = field('Portal link or email', { value: p.applyPortal || p.applyEmail, max: 600, wide: true, placeholder: 'e.g. https://portal.partner.com  or  applications@partner.com' });
      const kind = el('span', 'bp-kind');
      apply.wrap.append(kind);
      applyUser = field('Username', { value: p.applyUser, max: 200, placeholder: 'The username or email used to log in' });
      applyPassword = field('Password', { value: p.applyPassword, max: 200, placeholder: 'The password' });
      applyPassword.input.type = 'password'; applyPassword.input.autocomplete = 'new-password';
      const peek = btn('btn btn-sm', 'Show', () => { const hid = applyPassword.input.type === 'password'; applyPassword.input.type = hid ? 'text' : 'password'; peek.textContent = hid ? 'Hide' : 'Show'; });
      const passRow = el('div', 'bp-pass'); applyPassword.input.replaceWith(passRow); passRow.append(applyPassword.input, peek);
      const login = el('div'); login.append(el('h4', 'bp-sub-head', 'Login details'), grid('bp-two', applyUser.wrap, applyPassword.wrap));
      const showKind = () => { const v = apply.input.value.trim(); const isEmail = EMAIL.test(v); kind.hidden = !v; kind.textContent = isEmail ? 'Email: applications are sent to this address' : 'Portal link: add the login details below'; login.hidden = !v || isEmail; };
      apply.input.addEventListener('input', showKind); showKind();
      s2.append(grid('bp-one', apply.wrap), login);
      steps.push(s2);
    }

    const s3 = step(++n, 'Contacts', '');
    const contacts = repeater([['name', 'Name', 'e.g. Partner manager'], ['phone', 'Phone', 'e.g. 98XXXXXXXX'], ['email', 'Email', 'name@partner.com']], p.contacts, 'Add a contact');
    s3.append(contacts.node); steps.push(s3);

    const full = !settingUp();
    const s4 = step(++n, 'Commission list by intake', 'A link or the PDF for each intake.');
    const commissions = commissionEditor(id, p);
    s4.append(commissions.node); if (full) steps.push(s4); else n -= 1;

    const byIntake = Object.entries(st.intakes || {});
    const s6 = step(++n, 'Visas by intake', '');
    if (!byIntake.length) s6.append(el('p', 'p-muted', 'No students yet.'));
    else {
      const t = el('div', 'bp-visas');
      byIntake.forEach(([intake, v]) => { const d = el('div'); d.append(el('span', '', intake), el('b', '', number(v.visas))); t.append(d); });
      const tot = el('div', 'total'); tot.append(el('span', '', 'Total'), el('b', '', number(st.visas))); t.append(tot);
      s6.append(t);
    }
    steps.push(s6);

    const notes = field('Notes', { kind: 'area', value: p.notes, max: 12000, wide: true });
    const s7 = step(++n, 'Notes', '');
    s7.append(grid('bp-one', notes.wrap)); if (full) steps.push(s7);
    form.append(...steps);

    const bar = el('div', 'bp-savebar');
    const save = btn('btn btn-primary', 'Save', async () => {
      try {
        // The end date is no longer asked; one kept in an older record stays as it was.
        const body = { name: name.input.value, status: status.input.value, city: city.input.value, agreementStart: start.input.value || (isoDay(p.agreementStart) ? '' : p.agreementStart || ''), agreementEnd: p.agreementEnd || '', contacts: contacts.values() };
        if (full) Object.assign(body, { commissions: commissions.values(), notes: notes.input.value });
        if (apply) Object.assign(body, { apply: apply.input.value, applyUser: applyUser.input.value, applyPassword: applyPassword.input.value });
        const saved = await api(`${API}/${id}`, body);
        // Saved: straight back to the list, where the card glows once (the owner, 15 Nov 2026: no "Back to the list" to press).
        if (apply && apply.input.value.trim() && !saved.applyPortal && !saved.applyEmail) say('Saved, but the link was not kept: use a web address or an email address.', true);
        else say(`${saved.name || name.input.value || 'The ' + WORD.one} is saved.`);
        justSaved = id;
        closeEditor(); await load();
      } catch (e) { say(e.message, true); }
    });
    const del = btn('btn btn-danger', 'Remove from list', async () => { if (!(await window.NiecUI.confirm(`Remove ${p.name} from ${WORD.title}?`, { danger: true, confirmText: 'Remove' }))) return; await api(`${API}/${id}/delete`, {}); say('Removed'); closeEditor(); load(); });
    bar.append(save, btn('btn', 'Cancel', closeEditor), el('span', 'grow'));
    if (full) bar.append(del);
    else bar.append(el('span', 'p-muted p-small', 'The commission list and notes are kept by Admin.'));
    form.append(bar);
    ed.replaceChildren(form);
    $('listView').hidden = true; ed.hidden = false;
    window.scrollTo({ top: 0 });
  }
  function closeEditor() { $('editor').hidden = true; $('editor').replaceChildren(); $('listView').hidden = false; window.scrollTo({ top: 0 }); }

  async function load() {
    data = await api(API);
    if (!viewer()) { const c = document.querySelector('#pageTitle .p-chip'); if (c) c.hidden = true; } // others look at it too now
    if (settingUp()) $('intro').textContent = 'How to apply and who to contact.';
    if (viewer()) {
      const chip = document.querySelector('#pageTitle .p-chip'); if (chip) chip.textContent = 'View only';
      $('intro').textContent = data.access === 'commission'
        ? 'How to apply, contacts and commission. View only.'
        : `View only.`;
    }
    draw();
    if (justSaved) {
      const c = document.querySelector(`.bp-card[data-id="${CSS.escape(justSaved)}"]`);
      if (c) c.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      justSaved = '';
    }
  }
  load().catch((e) => { $('list').replaceChildren(h('div', { class: 'p-notice bad' }, e.message)); });
})();
