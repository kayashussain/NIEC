// The Partner Universities page (direct.html). Admin edits it; the Manager, the Application and Mock Teams and the branches look at it
// (see partner-access.js: the server sends a team no commission and no portal login);
// everything shown is put on the page as text, never as HTML.
// The list is a set of calm cards with each university's logo; a click opens the university as its own view, in numbered steps,
// with a Save bar that stays at the bottom of the screen. Admin adds one with "+ Add university" beside the title, and the page
// holds the partners only: no summary tiles above the list (the owner, 26 Nov 2026).
(function () {
  const $ = (id) => document.getElementById(id);
  let uni = null; // the university open in the editor
  let all = []; // the list
  // ?backup=ID: this is an earlier daily backup, read only (see backup-bar.js): looked at, never changed.
  const BACKUP = new URLSearchParams(location.search).get('backup') || '';
  const API = BACKUP ? '/api/restore/snapshot/' + encodeURIComponent(BACKUP) + '/partners' : '/api/direct';
  const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
  // What this account sees (student-details/partner-access.js): 'full' Admin, 'commission' the Manager (everything, to look at),
  // 'team' a team or a branch (no commission, no portal login). Only Admin gets the editor; everyone else gets a read-only page.
  let level = BACKUP ? 'full' : 'team';
  const viewer = () => level !== 'full';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function say(id, text, error) { const m = $(id); if (!m) return; m.textContent = text || ''; m.className = 'msg' + (error ? ' error' : ''); }
  async function api(url, body) {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Something went wrong.');
    return json;
  }
  const btn = (cls, label, onClick) => { const b = el('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };

  // The university's logo (from its page in Universities, sent by the server), else its initials.
  const media = (u) => (/^https:\/\//.test(u) ? `/api/media?u=${encodeURIComponent(u)}` : u);
  function logoMark(u) {
    const m = el('span', 'bp-avatar', u.logo ? undefined : initialsOf(u.name));
    if (!u.logo) return m;
    m.classList.add('has-logo');
    const i = el('img'); i.src = media(u.logo); i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer';
    i.addEventListener('error', () => { m.classList.remove('has-logo'); m.replaceChildren(); m.textContent = initialsOf(u.name); });
    m.append(i);
    return m;
  }

  // ---- the list, in the same look as B2B Partners (the owner, 15 Nov 2026) ----
  let stats = {};
  let currentIntake = '';
  let justSaved = '';
  async function loadList() {
    try {
      const [list, st] = await Promise.all([api(API), BACKUP ? Promise.resolve({ stats: {} }) : api('/api/direct-stats').catch(() => ({ stats: {} }))]);
      all = list;
      stats = st.stats || {};
      currentIntake = st.currentIntake || '';
      drawList();
    } catch (e) { say('listMsg', e.message, true); }
  }
  const num = (n) => Number(n || 0).toLocaleString('en-GB');
  const statOf = (u) => stats[u.id] || { students: 0, visas: 0, applied: 0, offers: 0, thisIntake: 0 };
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || one + 's')}`;
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  };
  const toast = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const iconBtn = (icon, label, onClick) => { const b = btn('bp-icon', '', onClick); b.innerHTML = ICON[icon]; b.title = label; b.setAttribute('aria-label', label); return b; };
  const copy = (value, what) => iconBtn('copy', `Copy the ${what.toLowerCase()}`, async () => { try { await navigator.clipboard.writeText(value); toast(`${what} copied`); } catch (e) { toast(`Could not copy the ${what.toLowerCase()}`, true); } });
  const initialsOf = (name) => String(name || '?').replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|for)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const openLink = (text, href, cls) => { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  // A day as the calendar needs it (2026-01-01): older days were typed by hand ("1 Sep 2025", "9/1/2025").
  function isoDay(v) {
    const t = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!/\d{4}/.test(t)) return '';
    const d = new Date(t + ' 12:00');
    return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const dayOf = (v) => (window.Portal && /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? window.Portal.day(v) : String(v || ''));
  const PILL = { Active: 'green', Ended: 'red' };
  const openOne = (id) => (viewer() ? openView(id) : openEditor(id));

  function drawList() {
    const shown = all; // no search box (the owner, 17 Nov 2026)
    addButton(level === 'full' && !BACKUP);
    if (!all.length) { $('list').replaceChildren(el('div', 'bp-empty', 'No partner universities yet.')); return; }
    // The busiest first (the most students, then by name). No Sort menu (the owner, 17 Nov 2026).
    const ordered = shown.slice().sort((x, y) => (x.status === 'Ended') - (y.status === 'Ended') || statOf(y).students - statOf(x).students || x.name.localeCompare(y.name));
    $('list').replaceChildren(...ordered.map(card));
    if (justSaved) { const hit = $('list').querySelector(`[data-id="${justSaved}"]`); if (hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    justSaved = '';
  }

  // "+ Add university" (Admin only): the name first (suggested from Universities, which brings the logo), then its card opens.
  function addButton(show) {
    let b = $('addBtn');
    if (!b) { b = btn('btn btn-primary bp-add', '+ Add university', addOne); b.id = 'addBtn'; document.querySelector('#listView .p-head').append(b); }
    b.hidden = !show;
  }
  function addOne() {
    window.Portal.dialog('Add a partner university', (body, close) => {
      const name = window.Portal.field('University name', { max: 120, required: true, wide: true, placeholder: 'Start typing the name', list: 'puNames' });
      const names = el('datalist'); names.id = 'puNames';
      api('/api/facts').then((rows) => {
        const have = new Set(all.map((u) => u.name.toLowerCase()));
        (Array.isArray(rows) ? rows : []).filter((r) => !have.has(r.name.toLowerCase())).forEach((r) => { const o = el('option'); o.value = r.name; names.append(o); });
      }).catch(() => { /* typed by hand */ });
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const wrong = (t) => { msg.textContent = t; msg.className = 'p-msg error'; };
      const ok = btn('btn btn-primary', 'Add', async () => {
        const value = name.input.value.trim().replace(/\s+/g, ' ');
        if (!value) { wrong('Write the name.'); name.input.focus(); return; }
        ok.disabled = true;
        try {
          const made = await api(API, { name: value });
          close(); toast(`${value} added`); justSaved = made.id;
          await loadList(); openEditor(made.id);
        } catch (e) { wrong(e.message); ok.disabled = false; }
      });
      name.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
      foot.append(btn('btn', 'Cancel', () => close()), ok);
      const form = el('div', 'p-form'); form.append(name.wrap, names);
      body.append(form, msg, foot);
    });
  }

  function card(u) {
    const st = statOf(u);
    const c = el('article', `bp-card${u.id === justSaved ? ' is-saved' : ''}`);
    c.dataset.id = u.id;
    const head = el('div', 'bp-card-head');
    const who = el('div', 'bp-who');
    const words = el('div');
    const sub = [u.type === 'Through a B2B partner' && u.via ? `Through ${u.via}` : '', st.students ? `${plural(st.visas, 'visa')} · ${plural(st.students, 'student')}` : 'No students yet'].filter(Boolean).join(' · ');
    words.append(btn('bp-name', u.name, () => openOne(u.id)), el('div', 'bp-sub', sub));
    who.append(logoMark(u), words);
    head.append(who, el('span', `bp-status ${PILL[u.status] || 'amber'}`, u.status || 'Active'));
    c.append(head);
    // The campuses as soft tags under the name.
    if ((u.campuses || []).length) { const t = el('div', 'bp-tags'); u.campuses.forEach((x) => t.append(el('span', 'bp-tag', x))); c.append(t); }
    c.append(submitBox(u));
    // A small funnel of this university's students: applied, offers, visas.
    if (st.students) {
      const f = el('div', 'bp-funnel');
      [['Students', st.students], ['Applied', st.applied], ['Offers', st.offers], ['Visas', st.visas]].forEach(([k, n], i) => {
        const d = el('div', 'bp-funnel-step'); const bar = el('i'); bar.style.setProperty('--w', `${Math.max(6, Math.round((n / st.students) * 100))}%`);
        if (i === 3) d.classList.add('is-visa');
        d.append(el('b', '', num(n)), el('small', '', k), bar); f.append(d);
      });
      c.append(f);
    }
    const facts = el('dl', 'bp-facts');
    const row = (label, value) => { const dd = el('dd'); if (value instanceof Node) dd.append(value); else if (value) dd.textContent = value; else dd.append(el('span', 'bp-none', 'Not entered yet')); const pair = el('div', 'bp-fact'); pair.append(el('dt', '', label), dd); facts.append(pair); };
    if (level !== 'team') row('Commission', u.slabs && u.slabs.length ? (() => { const d = el('div', 'bp-lines'); u.slabs.forEach((x) => d.append(el('span', '', x))); return d; })() : null);
    const p = u.contact || {};
    if (p.name || p.phone || p.email) {
      const d = el('div', 'bp-lines');
      if (p.name) d.append(el('span', 'bp-strong', p.name + (u.contactCount > 1 ? `  +${u.contactCount - 1}` : '')));
      if (p.phone) { const a = el('a', 'bp-link', p.phone); a.href = 'tel:' + p.phone.replace(/[^\d+]/g, ''); d.append(a); }
      if (p.email) { const a = el('a', 'bp-link', p.email); a.href = 'mailto:' + p.email; d.append(a); }
      row('Contact', d);
    } else row('Contact', null);
    row('Agreement', [u.agreementStart ? 'Started ' + dayOf(u.agreementStart) : '', u.agreementEnd ? 'ends ' + dayOf(u.agreementEnd) : '', u.agreementCount ? plural(u.agreementCount, 'file') : ''].filter(Boolean).join(' · '));
    c.append(facts);
    const foot = el('div', 'bp-foot'); foot.append(btn('btn', viewer() ? 'Open' : 'Edit', () => openOne(u.id)));
    c.append(foot);
    return c;
  }

  // How to apply, ready to use from the list (as on B2B Partners): Open portal, then the username and the password each with a copy
  // button (an eye shows the password), or the email.
  function submitBox(u) {
    const box = el('div', 'bp-submit');
    const line = (label, value, ...buttons) => { const d = el('div', 'bp-submit-line'); const b = el('span', 'bp-submit-btns'); b.append(...buttons); d.append(el('span', 'bp-submit-label', label), value, b); return d; };
    if (u.applyPortal) {
      const top = el('div', 'bp-submit-top');
      top.append(openLink('Open portal ↗', u.applyPortal, 'bp-portal'), copy(u.applyPortal, 'Link'));
      box.append(top);
      if (u.applyUser) box.append(line('Username', el('code', 'bp-value', u.applyUser), copy(u.applyUser, 'Username')));
      if (u.applyPassword) {
        const dots = '•'.repeat(10);
        const shown = el('code', 'bp-value', dots);
        const peek = iconBtn('eye', 'Show the password', () => { const showing = shown.textContent !== dots; shown.textContent = showing ? dots : u.applyPassword; peek.classList.toggle('is-on', !showing); peek.title = showing ? 'Show the password' : 'Hide the password'; peek.setAttribute('aria-label', peek.title); });
        box.append(line('Password', shown, peek, copy(u.applyPassword, 'Password')));
      } else if (u.loginHidden) {
        // The login is held back from this account (the Mock Team, a branch ...): the eye says so instead of showing it.
        const locked = iconBtn('eye', 'Show the password', () => window.NiecUI.toast('You do not have access to the portal login.', { type: 'error' }));
        locked.classList.add('is-locked');
        box.append(line('Password', el('code', 'bp-value bp-locked', '\u2022'.repeat(10)), locked));
      }
    } else if (u.applyEmail) {
      const top = el('div', 'bp-submit-top');
      const w = el('a', 'bp-portal', 'Write email ↗'); w.href = 'mailto:' + u.applyEmail;
      top.append(w);
      box.append(top, line('Email', el('code', 'bp-value', u.applyEmail), copy(u.applyEmail, 'Email')));
    } else box.append(el('div', 'bp-none', viewer() ? 'How to apply is not entered yet' : 'How to apply is not entered yet'));
    return box;
  }

  // ---- the editor ----
  function field(label, input, { wide = false, hint = '' } = {}) {
    const l = el('label', 'pu-field' + (wide ? ' wide' : ''));
    l.append(el('span', '', label), input);
    if (hint) l.append(el('small', 'pu-hint', hint));
    return l;
  }
  function text(value, max, placeholder) { const i = el('input'); i.value = value || ''; i.maxLength = max || 300; if (placeholder) i.placeholder = placeholder; return i; }
  function area(value, placeholder) { const t = el('textarea'); t.value = value || ''; t.maxLength = 12000; if (placeholder) t.placeholder = placeholder; return t; }
  function step(n, title, help) {
    const s = el('section', 'pu-step');
    const head = el('div', 'pu-step-head');
    const words = el('div'); words.append(el('h3', '', title)); if (help) words.append(el('p', '', help));
    head.append(el('span', 'pu-num', String(n)), words);
    s.append(head);
    return s;
  }

  // A repeatable set of rows (campuses, slabs, contacts): each row has labelled boxes and a Remove link.
  function repeater(cols, items, addLabel) {
    const node = el('div');
    const box = el('div', 'pu-rows');
    const rows = [];
    function add(item) {
      const row = el('div', 'pu-row');
      row.style.setProperty('--cols', String(cols.length));
      const inputs = {};
      cols.forEach(([key, label, ph]) => { inputs[key] = text(item[key], 300, ph); row.append(field(label, inputs[key])); });
      const entry = { inputs };
      row.append(btn('pu-remove', 'Remove', () => { row.remove(); rows.splice(rows.indexOf(entry), 1); }));
      rows.push(entry);
      box.append(row);
    }
    (items || []).forEach(add);
    const addBtn = btn('btn btn-sm pu-add-row', '+ ' + addLabel, () => add({}));
    node.append(box, addBtn);
    return { node, values: () => rows.map((r) => Object.fromEntries(Object.entries(r.inputs).map(([k, i]) => [k, i.value]))) };
  }

  // ---- a university, read only (everyone but Admin) ----
  function openView(id) {
    api(API + '/' + id).then((u) => {
      const ed = $('editor');
      const page = el('div', 'pu-view');
      page.append(btn('pu-back', '← Partner Universities', closeEditor));
      const head = el('div', 'pu-ed-head'); head.append(el('h2', '', u.name)); page.append(head);
      const box = (title, ...nodes) => { const s = el('section', 'pu-step'); const hd = el('div', 'pu-step-head'); const w = el('div'); w.append(el('h3', '', title)); hd.append(w); s.append(hd, ...nodes); page.append(s); };
      const lines = (items) => { const d = el('div', 'pu-lines'); items.forEach((x) => d.append(x instanceof Node ? x : el('span', '', x))); return d; };
      const none = (t = 'Not entered yet') => el('span', 'pu-none', t);
      box('Campuses', (u.campuses || []).length ? lines(u.campuses.map((c) => [c.name, c.city].filter(Boolean).join(', '))) : none());
      const sub = el('div', 'pu-submit');
      if (u.applyPortal) { const a = el('a', 'pu-portal', 'Open portal ↗'); a.href = u.applyPortal; a.target = '_blank'; a.rel = 'noopener noreferrer'; sub.append(a); }
      else if (u.applyEmail) { const a = el('a', 'pu-portal', u.applyEmail); a.href = 'mailto:' + u.applyEmail; sub.append(a); }
      else sub.append(none());
      box('Application submission', sub);
      box('Contacts', (u.contacts || []).length ? lines(u.contacts.map((c) => { const d = el('div', 'pu-lines'); if (c.name) d.append(el('b', '', c.name)); if (c.phone) d.append(el('span', '', c.phone)); if (c.email) { const a = el('a', 'pu-link', c.email); a.href = 'mailto:' + c.email; d.append(a); } return d; })) : none());
      box('Agreement', lines([u.agreementStart ? 'Started ' + window.Portal.day(u.agreementStart) : 'Start not entered', u.agreementEnd ? 'Ends ' + window.Portal.day(u.agreementEnd) : ''].filter(Boolean)));
      // The Manager also sees the commission and the agreement files; a team never receives them.
      if (level === 'commission') {
        box('Commission', (u.slabs || []).length ? lines(u.slabs.map((x) => [x.level, x.students, x.commission].filter(Boolean).join(' · '))) : none(), ...(u.paymentTerms ? [el('p', 'pu-hint', 'Payment terms: ' + u.paymentTerms)] : []));
        box('Agreement files', (u.agreements || []).length ? lines(u.agreements.map((a) => { const l = el('a', 'pu-link', a.name); l.href = `/api/direct/${u.id}/files/${a.id}`; return l; })) : none('No files'));
        if (u.notes) box('Notes', el('p', '', u.notes));
      }
      ed.replaceChildren(page);
      $('listView').hidden = true; ed.hidden = false;
      window.scrollTo({ top: 0 });
    }).catch((e) => say('listMsg', e.message, true));
  }

  function openEditor(id) {
    api(API + '/' + id).then((u) => { uni = u; buildEditor(); }).catch((e) => say('listMsg', e.message, true));
  }
  function closeEditor() {
    $('editor').hidden = true; $('editor').replaceChildren(); uni = null;
    $('listView').hidden = false;
    window.scrollTo({ top: 0 });
  }

  function buildEditor() {
    const ed = $('editor');
    const f = {};
    const form = el('form');
    form.autocomplete = 'off';
    form.append(btn('pu-back', '← Partner Universities', closeEditor));
    const head = el('div', 'pu-ed-head');
    head.append(el('h2', '', uni.name));
    // As on B2B Partners: the students and visas under the name, and when it was last saved, in the office's date style.
    const st = statOf(uni);
    const saved = uni.updatedAt ? `Saved ${new Date(uni.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${uni.updatedBy ? ' by ' + uni.updatedBy : ''}` : '';
    form.append(head, el('p', 'pu-saved', [st.students ? `${plural(st.visas, 'visa')} from ${plural(st.students, 'student')}` : '', saved].filter(Boolean).join(' · ')));

    // 1. The university: its name, its campuses and when the agreement started. (Status, how it is held, when it ends
    // and notes are no longer asked: a partner is always active. Anything stored in them is kept as it is.)
    const s1 = step(1, 'The university', '');
    f.name = text(uni.name, 120);
    // The day the agreement started, on a calendar (as on B2B Partners); a day typed by hand earlier opens on the calendar when it can be read.
    f.agreementStart = text(isoDay(uni.agreementStart) || '', 40);
    f.agreementStart.type = 'date';
    const g1 = el('div', 'pu-fields two');
    g1.append(field('University name', f.name), field('Agreement started', f.agreementStart));
    const campusHead = el('h4', 'pu-sub-head', 'Campuses');
    const campuses = repeater([['name', 'Campus', 'e.g. London Campus'], ['city', 'City', 'e.g. London']], uni.campuses, 'Add a campus');
    s1.append(g1, campusHead, campuses.node);

    // 2. Application submission: one box, a link or an email; the login only for a link.
    const s2 = step(2, 'Application submission', 'The portal link or email, and the portal login. Only Admin and the Application Team see the login.');
    f.apply = text(uni.applyPortal || uni.applyEmail, 600, 'e.g. https://apply.university.ac.uk  or  admissions@university.ac.uk');
    f.apply.inputMode = 'url';
    const kind = el('span', 'pu-kind');
    f.applyUser = text(uni.applyUser, 200, 'The username or email used to log in');
    f.applyPassword = text(uni.applyPassword, 200, 'The password');
    f.applyPassword.type = 'password';
    f.applyPassword.autocomplete = 'new-password';
    const peek = btn('btn btn-sm', 'Show', () => { const hidden = f.applyPassword.type === 'password'; f.applyPassword.type = hidden ? 'text' : 'password'; peek.textContent = hidden ? 'Hide' : 'Show'; });
    const pass = el('div', 'pu-pass'); pass.append(f.applyPassword, peek);
    const login = el('div');
    const loginFields = el('div', 'pu-fields two');
    loginFields.append(field('Username', f.applyUser), field('Password', pass));
    login.append(el('h4', 'pu-sub-head', 'Login details'), loginFields);
    const g2 = el('div', 'pu-fields');
    const applyField = field('Portal link or email', f.apply, { wide: true });
    applyField.append(kind);
    g2.append(applyField);
    const showKind = () => {
      const v = f.apply.value.trim();
      const isEmail = EMAIL.test(v);
      kind.hidden = !v;
      kind.textContent = isEmail ? 'Email: applications are sent to this address' : 'Portal link: add the login details below';
      login.hidden = !v || isEmail;
    };
    f.apply.addEventListener('input', showKind); showKind();
    s2.append(g2, login);

    // 3. Contacts
    const s3 = step(3, 'Contacts', 'The first one shows on the list.');
    const contacts = repeater([['name', 'Name', 'e.g. Sam Taylor (Regional Manager)'], ['phone', 'Phone', 'e.g. +44 7700 900000'], ['email', 'Email', 'name@university.ac.uk']], uni.contacts, 'Add a contact');
    s3.append(contacts.node);

    // 4. Commission and payment
    const s5 = step(4, 'Commission and payment', 'One row per band, e.g. UG, "1 to 10", "15%".');
    const slabs = repeater([['level', 'Level', 'UG, PG or All'], ['students', 'Students enrolled', 'e.g. 1 to 10'], ['commission', 'Commission', 'e.g. 15% or £1,500']], uni.slabs, 'Add a commission band');
    f.paymentTerms = area(uni.paymentTerms, 'When and how commission is paid.');
    const pay = el('div', 'pu-fields'); pay.style.marginTop = '16px';
    pay.append(field('Payment terms', f.paymentTerms, { wide: true }));
    s5.append(slabs.node, pay);

    // 6. Agreement files: uploaded and removed at once (they are not part of Save).
    const s6 = step(5, 'Agreement files', 'PDF, Word or image, up to 10 MB.');
    const fileList = el('div', 'pu-files');
    const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    function drawFiles() {
      if (!uni.agreements.length) { fileList.replaceChildren(el('p', 'pu-hint', 'No agreement uploaded yet.')); return; }
      fileList.replaceChildren(...uni.agreements.map((a) => {
        const row = el('div', 'pu-file');
        const link = BACKUP ? el('span', '', a.name) : el('a', 'pu-link', a.name);
        if (!BACKUP) { link.href = `/api/direct/${uni.id}/files/${a.id}`; link.setAttribute('download', a.name); }
        const info = el('span', 'pu-hint', `${size(a.size)} · uploaded ${new Date(a.uploadedAt).toLocaleDateString()}${a.uploadedBy ? ' by ' + a.uploadedBy : ''}`);
        const rm = btn('pu-remove', 'Remove', async () => {
          if (!(await window.NiecUI.confirm(`Remove the agreement file ${a.name}?`, { danger: true }))) return;
          try { uni.agreements = (await api(`/api/direct/${uni.id}/files/${a.id}/delete`, {})).agreements; drawFiles(); loadList(); } catch (e) { say('editMsg', e.message, true); }
        });
        row.append(link, info, rm);
        return row;
      }));
    }
    drawFiles();
    const pick = el('input'); pick.type = 'file'; pick.accept = '.pdf,.doc,.docx,.png,.jpg,.jpeg'; pick.setAttribute('aria-label', 'Agreement file');
    const up = btn('btn btn-sm', 'Upload', async () => {
      const file = pick.files && pick.files[0];
      if (!file) { say('editMsg', 'Choose the agreement file first.', true); return; }
      if (file.size > 10 * 1024 * 1024) { say('editMsg', 'That file is too large (the limit is 10 MB).', true); return; }
      say('editMsg', 'Uploading...'); up.disabled = true;
      try {
        const res = await fetch(`/api/direct/${uni.id}/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not upload it.');
        uni.agreements = json.agreements; pick.value = ''; drawFiles(); loadList(); say('editMsg', ''); window.NiecUI.toast('Agreement uploaded', { type: 'success' });
      } catch (e) { say('editMsg', e.message, true); }
      up.disabled = false;
    });
    const picker = el('div', 'bar'); picker.append(pick, up);
    s6.append(fileList, picker);

    form.append(s1, s2, s3, s5, s6);

    const bar = el('div', 'pu-savebar');
    const save = el('button', 'btn btn-primary', 'Save'); save.type = 'submit';
    const close = btn('btn', 'Cancel', closeEditor);
    const msg = el('div', 'msg grow'); msg.id = 'editMsg'; msg.setAttribute('role', 'status');
    const del = btn('btn btn-danger', 'Remove from list', async () => {
      if (!(await window.NiecUI.confirm(`Remove ${uni.name} from Partner Universities?`, { danger: true }))) return;
      try { await api(`/api/direct/${uni.id}/delete`, {}); window.NiecUI.toast('Removed', { type: 'success' }); closeEditor(); loadList(); } catch (e) { say('editMsg', e.message, true); }
    });
    bar.append(save, close, msg, del);
    form.append(bar);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value]));
      Object.assign(body, { campuses: campuses.values(), slabs: slabs.values(), contacts: contacts.values() });
      // An older day typed by hand that the calendar cannot read is kept until a day is chosen.
      if (!body.agreementStart && uni.agreementStart && !isoDay(uni.agreementStart)) body.agreementStart = uni.agreementStart;
      // What the page no longer asks is sent back as it was, so nothing stored is lost; a partner is always Active.
      Object.assign(body, { status: uni.status || 'Active', type: uni.type || 'Direct', via: uni.via || '', agreementEnd: uni.agreementEnd || '', notes: uni.notes || '' });
      say('editMsg', 'Saving...');
      try {
        uni = await api('/api/direct/' + uni.id, body);
        // A link or email that is not a real address is not kept: say so instead of losing it quietly.
        if (body.apply.trim() && !uni.applyPortal && !uni.applyEmail) window.NiecUI.toast('Saved, but the link was not kept: use a web address or an email address.', { type: 'error' });
        else window.NiecUI.toast('Saved', { type: 'success' });
        // Straight back to the list, where the saved card glows once (as on B2B Partners).
        justSaved = uni.id;
        closeEditor();
        await loadList();
      } catch (err) { say('editMsg', err.message, true); }
    });

    if (BACKUP) { // look only: every box is locked and every button except the way back is gone
      form.querySelectorAll('input, textarea, select').forEach((i) => { i.disabled = true; });
      form.querySelectorAll('button').forEach((b) => { if (b !== close && !b.classList.contains('pu-back') && b !== peek) b.hidden = true; });
      picker.hidden = true;
    }
    ed.replaceChildren(form);
    $('listView').hidden = true;
    ed.hidden = false;
    if (BACKUP) say('editMsg', 'As in the backup (agreement files are not kept in backups).');
    window.scrollTo({ top: 0 });
  }

  // Everyone but Admin looks only, and the heading says so.
  async function setLevel() {
    if (BACKUP) return;
    try { level = (await api('/api/partner-access')).direct || 'team'; } catch (e) { level = 'team'; }
    if (!viewer()) { $('adminOnly').hidden = true; return; } // other accounts now look at this page too, so it is no longer "Admin only"
    $('adminOnly').textContent = 'View only';
    document.querySelector('.pu-intro').textContent = level === 'commission'
      ? 'Where to apply, contacts, agreements and commission. View only; Admin edits.'
      : 'Where to apply, campuses, contacts and agreements. View only; Admin edits.';
  }
  setLevel().then(loadList);
})();
