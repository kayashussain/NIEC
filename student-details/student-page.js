// One student's card (student.html): the main card (who the student is, Call, WhatsApp and Email, the progress, the details and
// where the student came from), then two tabs, Timeline (tasks, notes and history) and Applications. Call, WhatsApp and Email are one tap under the name; messages to many students go from Follow-up. The sheet's own details are changed on the sheet; the card never changes them except the Student Source,
// which is chosen here (it is no longer a column of the sheet).
(function () {
  const { el, h, api, day, when, stagePill, initials, field, dialog } = window.Portal;
  const F = window.CardFields;
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const embedded = params.get('embed') === '1';
  let data = null; // { student, card, can, me, mail, today }
  let lists = { sourceOptions: {}, partners: [] };
  let historyFilter = 'all'; // the student's History: everything, the notes only, or the tasks only
  // Named for what they hold (the owner, 17 Nov 2026): Timeline (every step, day by day) and Applications (shortlist and applications).
  // No tabs any more (the owner, 21 Nov 2026, the Ledger design): Applications, the tasks and the Timeline are panels one under
  // another. "#options" in a link still goes straight to Applications, "#details" to the Timeline.
  const SECTIONS = { details: 'lg-timeline', options: 'lg-apps' };
  const view = document.getElementById('view');
  const say = (text, error) => window.NiecUI.toast(text, { type: error ? 'error' : 'success' });
  // ---- Undo and Redo of a change saved on the card (the owner, 22 Nov 2026): for 5 seconds after saving, Undo (the button on the
  // message, or Ctrl+Z / Cmd+Z) puts the details back as they were; for 5 seconds after an Undo, Redo (Ctrl+Y / Cmd+Shift+Z) puts the
  // change back again. Each step is a save of its own and is written in the student's notes ("Undone on the student card"). ----
  const UNDO_MS = 5000;
  let lastChange = null; // { before: { sheet, prof }, after: { sheet, prof }, at, undone }
  // One Undo or Redo message at a time: the next one closes the one before, so an old Undo button is never left on screen.
  let stepToast = null;
  const stepSay = (message, label, onClick) => {
    if (stepToast) stepToast();
    stepToast = window.NiecUI.toast(message, { type: 'success', duration: UNDO_MS, action: { label, onClick } }) || null;
  };
  async function putState(state, undo) {
    if (state.source !== undefined) await api(`/api/cards/${encodeURIComponent(id)}/source`, { source: state.source, undo });
    if (Object.keys(state.sheet || {}).length) await api(`/api/cards/${encodeURIComponent(id)}/sheet`, { fields: state.sheet, undo });
    if (Object.keys(state.prof || {}).length) await api(`/api/cards/${encodeURIComponent(id)}/profile`, { ...state.prof, markSaved: true, undo });
    data = await api('/api/cards/' + encodeURIComponent(id));
    render();
  }
  // What a save on the sheet really replaced, as the server had it (a colleague may have changed it after this page opened): Undo puts
  // back exactly that, never this page's older copy.
  const tookOver = (was, r) => { if (r && r.replaced) Object.keys(was.sheet || {}).forEach((k) => { if (k in r.replaced) was.sheet[k] = r.replaced[k]; }); };
  // `before` and `after`: { sheet: { COLUMN: value }, prof: { key: value } }, only what changed.
  function savedWithUndo(message, before, after) {
    lastChange = { before, after, at: Date.now(), undone: false };
    stepSay(message, 'Undo', undoLast);
  }
  const fresh = () => lastChange && Date.now() - lastChange.at <= UNDO_MS;
  let stepping = false;
  async function undoLast() {
    if (stepping || !fresh() || lastChange.undone) return false;
    stepping = true;
    try {
      await putState(lastChange.before, true);
      lastChange.undone = true; lastChange.at = Date.now();
      stepSay('Change undone', 'Redo', redoLast);
    } catch (e) { say(e.message, true); } finally { stepping = false; }
    return true;
  }
  async function redoLast() {
    if (stepping || !fresh() || !lastChange.undone) return false;
    stepping = true;
    try {
      await putState(lastChange.after, false);
      lastChange.undone = false; lastChange.at = Date.now();
      stepSay('Change redone', 'Undo', undoLast);
    } catch (e) { say(e.message, true); } finally { stepping = false; }
    return true;
  }
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // Typing in a box keeps the box's own undo; a window open keeps its own keys.
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const isUndo = k === 'z' && !e.shiftKey;
    const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
    if (!(isUndo || isRedo) || !fresh()) return;
    if (isUndo ? lastChange.undone : !lastChange.undone) return;
    e.preventDefault();
    if (isUndo) undoLast(); else redoLast();
  });

  if (embedded) {
    document.body.classList.add('p-embed');
    // Asked by the window around the card (card-drawer.js) before it closes or moves to another student.
    window.isrCardBusy = () => Boolean(editingHero || editingOrigin || editingField || document.querySelector('dialog[open], .p-dialog'));
    document.getElementById('closeEmbed').addEventListener('click', () => parent.postMessage({ niecCard: 'close' }, location.origin));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editingHero && !editingOrigin && !editingField && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('dialog[open], .p-dialog')) parent.postMessage({ niecCard: 'close' }, location.origin); });
    // ← and → go to the previous and next student of the list the card was opened from (card-drawer.js), when nothing is being typed.
    document.addEventListener('keydown', (e) => {
      if (editingHero || editingOrigin || editingField) return; // a form is open: its words are never lost to a keystroke
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable || a.closest('[role="tablist"], .p-seg, .p-tabs'))) return;
      if (document.querySelector('dialog[open], .p-dialog')) return;
      parent.postMessage({ niecCard: e.key === 'ArrowRight' ? 'next' : 'prev' }, location.origin);
    });
  }
  const can = () => data.can.edit;
  const profile = () => data.card.profile;
  async function save(path, body, okText) {
    try {
      const r = await api(`/api/cards/${id}/${path}`, body);
      if (r.card) data.card = r.card;
      if (okText) say(okText);
      return r;
    } catch (e) { say(e.message, true); throw e; }
  }

  // ---- the student's profile: shown as a table, changed in one window (the owner, 21 Nov 2026: "one Edit profile for everything") ----
  // No pencil on each line. Edit profile opens one window with every detail; Save changes saves them together and the server records
  // who saved and when, shown under the table. Passport expiry, the studies and the study plans are not on the card any more (the
  // owner, 21 Nov 2026); what was kept for them stays in the student's file.
  let editingHero = false; // kept for the key handlers: the name is now changed in Edit profile
  let editingField = '';
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const FIELDS = [
    { key: 'EMAIL', on: 'sheet', label: 'Email', type: 'email', get: () => data.student.email, link: (v) => 'mailto:' + v, max: 120 },
    { key: 'CONTACT NUMBER', on: 'sheet', label: 'WhatsApp', type: 'tel', get: () => data.student.phone, wa: true, max: 40 },
    { key: 'passportNo', on: 'profile', label: 'Passport number', get: () => profile().passportNo, upper: true, max: 20 },
    { key: 'dob', on: 'profile', label: 'Date of birth', type: 'date', get: () => profile().dob, show: (v) => day(v) },
    { key: 'nationality', on: 'profile', label: 'Nationality', type: 'select', get: () => profile().nationality || 'Nepali', choices: () => F.NATIONALITIES },
    { key: 'gender', on: 'profile', label: 'Gender', type: 'select', get: () => profile().gender, choices: () => F.GENDERS, optional: true },
    { key: 'address', on: 'profile', label: 'Address', type: 'text', get: () => profile().address, max: 200 },
  ];
  function editProfile() {
    if (!can()) return;
    const row = data.student.row || {};
    dialog('Edit profile', (body, close) => {
      const form = el('form', 'lg-form');
      form.noValidate = true;
      const inputs = {};
      const group = (t) => form.append(el('div', 'lg-form-group', t));
      const fieldBox = (key, label, input, wide) => {
        const w = el('div', `lg-form-field${wide ? ' is-wide' : ''}`);
        const fid = 'ep-' + key.replace(/\W+/g, '-').toLowerCase();
        input.id = fid; input.classList.add('lg-input');
        const l = el('label', 'lg-form-label', label); l.htmlFor = fid;
        w.append(l, input); form.append(w); inputs[key] = input;
      };
      const text = (v, max) => { const i = h('input', { type: 'text', value: v || '' }); if (max) i.maxLength = max; return i; };
      const pick = (v, choices, blank) => { const sel = document.createElement('select'); [...(blank ? [['', 'Choose']] : []), ...choices.map((c) => [c, c])].forEach(([c, t]) => { const o = document.createElement('option'); o.value = c; o.textContent = t; sel.append(o); }); sel.value = v || ''; return sel; };
      group('Name');
      fieldBox('FIRST NAME', 'First name', text(row['FIRST NAME'], 80));
      fieldBox('LAST NAME', 'Last name', text(row['LAST NAME'], 80));
      group('Contact');
      fieldBox('EMAIL', 'Email', h('input', { type: 'email', value: data.student.email || '', maxlength: '120' }));
      fieldBox('CONTACT NUMBER', 'WhatsApp number', h('input', { type: 'tel', value: data.student.phone || '', maxlength: '40' }));
      group('Passport');
      fieldBox('passportNo', 'Passport number', text(profile().passportNo, 20));
      const dob = h('input', { type: 'date', value: profile().dob || '' }); dob.max = today();
      fieldBox('dob', 'Date of birth', dob);
      fieldBox('nationality', 'Nationality', pick(profile().nationality || 'Nepali', F.NATIONALITIES));
      fieldBox('gender', 'Gender', pick(profile().gender, F.GENDERS, true));
      fieldBox('address', 'Address (as in the passport)', text(profile().address, 200), true);
      // The Student source is part of the Profile, changed here with the rest (the owner, 22 Nov 2026).
      group('Student source');
      const sp = profile();
      const srcStart = { source: data.student.source || '', detail: sp.sourceDetail || '', remarks: sp.sourceRemarks || '', platform: sp.sourcePlatform || '', way: sp.sourceWay || '' };
      const picker = window.SourcePicker.create({ lists, initial: srcStart, disabled: !data.can.source });
      picker.nodes.forEach((n) => { n.classList.add('lg-form-field'); form.append(n); }); // laid out like the other fields; a hidden one takes no room
      if (!data.can.source && data.student.source) form.append(el('p', 'p-muted p-small', 'Only Admin changes the source.'));
      const srcValue = () => { const v = picker.value(); return { source: v.source || '', detail: v.detail || '', remarks: v.remarks || '', platform: v.platform || '', way: v.way || '' }; };
      // Compared with the picker's own first reading (taken once it has drawn), not the stored words: an older Social Media or branch
      // student is shown in today's form, and only opening the window must never count as a change. Undo puts the stored words back.
      let srcBase = null;
      setTimeout(() => { srcBase = srcValue(); showChanges(); }, 0);
      const srcDiff = () => { if (!srcBase) return []; const v = srcValue(); return Object.keys(srcStart).filter((k) => (k !== 'source' || data.can.source) && v[k] !== srcBase[k]); };
      const srcChanged = () => srcDiff().length > 0;
      const SHEET = ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER'];
      const LABEL = { 'FIRST NAME': 'First name', 'LAST NAME': 'Last name', EMAIL: 'Email', 'CONTACT NUMBER': 'WhatsApp number', passportNo: 'Passport number', dob: 'Date of birth', nationality: 'Nationality', gender: 'Gender', address: 'Address' };
      const before = { 'FIRST NAME': row['FIRST NAME'] || '', 'LAST NAME': row['LAST NAME'] || '', EMAIL: data.student.email || '', 'CONTACT NUMBER': data.student.phone || '', passportNo: profile().passportNo || '', dob: profile().dob || '', nationality: profile().nationality || 'Nepali', gender: profile().gender || '', address: profile().address || '' };
      const now = () => { const v = {}; Object.keys(inputs).forEach((k) => { v[k] = String(inputs[k].value || '').trim(); }); v.passportNo = v.passportNo.toUpperCase(); return v; };
      const changedKeys = () => { const v = now(); return Object.keys(v).filter((k) => v[k] !== before[k] && k in LABEL); };
      // What will change, said plainly before saving (the owner, 21 Nov 2026: so the team trusts that the details are right).
      const note = el('p', 'lg-form-note');
      const showChanges = () => { const c = [...changedKeys().map((k) => LABEL[k]), ...(srcChanged() ? ['Student source'] : [])]; note.textContent = c.length ? `Will change: ${c.join(', ')}.` : 'Nothing changed yet.'; };
      form.addEventListener('input', showChanges); form.addEventListener('change', showChanges);
      showChanges();
      form.append(note);
      const foot = el('div', 'p-dialog-foot');
      const saved = profile().savedAt ? `Last saved ${when(profile().savedAt)} by ${profile().savedBy || 'someone'}` : '';
      if (saved) foot.append(el('span', 'lg-form-saved', saved));
      const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      form.append(foot);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = now(); const c = changedKeys();
        const bad = (msg, k) => { say(msg, true); if (k && inputs[k]) inputs[k].focus(); };
        const srcC = srcChanged();
        if (!c.length && !srcC) { close(); return; }
        if (srcC) { const missing = picker.check(); if (missing) return bad(missing); }
        if (!v['FIRST NAME'] && !v['LAST NAME']) return bad('A student needs a name.', 'FIRST NAME');
        if (v.EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.EMAIL)) return bad('That email does not look right.', 'EMAIL');
        if (v.dob && v.dob > today()) return bad('A date of birth cannot be in the future.', 'dob');
        ok.disabled = true; ok.textContent = 'Saving...';
        try {
          const sheet = {}; const prof = { markSaved: true };
          c.forEach((k) => { if (SHEET.includes(k)) sheet[k] = v[k]; else prof[k] = v[k]; });
          const was = { sheet: {}, prof: {} }; const now2 = { sheet: {}, prof: {} };
          c.forEach((k) => { const into = SHEET.includes(k) ? 'sheet' : 'prof'; was[into][k] = before[k]; now2[into][k] = v[k]; });
          // The name, email and phone first: they are the ones the server may refuse, so a refusal leaves nothing half saved.
          if (Object.keys(sheet).length) tookOver(was, await api(`/api/cards/${id}/sheet`, { fields: sheet }));
          if (srcC) {
            const sv = srcValue();
            const diff = srcDiff();
            if (data.can.source && diff.includes('source')) { await api(`/api/cards/${id}/source`, { source: sv.source }); was.source = srcStart.source; now2.source = sv.source; }
            // The whole source is saved together once any part of it changed (as the Source panel did), so its parts always agree.
            [['sourceDetail', 'detail'], ['sourceRemarks', 'remarks'], ['sourcePlatform', 'platform'], ['sourceWay', 'way']].forEach(([key, k]) => { if (sv[k] !== srcStart[k]) { prof[key] = sv[k]; was.prof[key] = srcStart[k]; now2.prof[key] = sv[k]; } });
          }
          await api(`/api/cards/${id}/profile`, prof);
          data = await api('/api/cards/' + encodeURIComponent(id));
          close(); render(); savedWithUndo('Profile saved', was, now2);
        } catch (err) { ok.disabled = false; ok.textContent = 'Save changes'; say(err.message, true); }
      });
      body.append(form);
      setTimeout(() => { const f = inputs['FIRST NAME']; if (f) f.focus(); }, 0);
    }, { wide: true });
  }

  // ---- small line pictures for the card (drawn in lines, as Apple's own symbols are) ----
  const ICONS = {
    phone: '<path d="M6.6 3.5h2.6l1.4 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.8z"/><path d="M9.2 8.6c.2 2.6 3.2 5.6 6 6l1-1.3-1.8-.9-.8.8c-1-.4-2.4-1.8-2.8-2.8l.8-.8-.9-1.8z"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
    cake: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M4 15c2 1.3 4 1.3 5.3 0s4-1.3 5.4 0 4 1.3 5.3 0M12 11V8M12 5.5v-.01"/>',
    passport: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><circle cx="12" cy="10.5" r="3"/><path d="M9 17h6"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c2.8 2.3 8.2 2.3 11 0v-4.5M21.5 9.5v5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17v.01"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    keys: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
  };
  // ---- small moments of feedback (the owner, 20 Nov 2026: every action answers) ----
  const calm = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A gentle shake for a mistake, so the eye finds the message.
  const shake = (node) => { if (!node || calm() || !node.animate) return; node.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'ease-out' }); };
  // A button that says what it is doing: "Saving..." while it works, then a tick and "Saved" for a moment.
  async function morph(btn, work, { busy = 'Saving…', done = 'Saved' } = {}) {
    const was = [...btn.childNodes];
    btn.disabled = true; btn.classList.add('is-busy');
    btn.replaceChildren(el('span', 'sc-spin'), busy);
    try {
      // "Saving..." stays long enough to be read, and the tick long enough to be seen.
      const [out] = await Promise.all([work(), new Promise((r) => setTimeout(r, calm() ? 0 : 320))]);
      btn.classList.remove('is-busy'); btn.classList.add('is-done');
      btn.replaceChildren(icon('check', 'sc-btn-ico sc-tick'), done);
      await new Promise((r) => setTimeout(r, calm() ? 0 : 1000));
      return out;
    } catch (e) {
      btn.classList.remove('is-busy'); btn.disabled = false; btn.replaceChildren(...was); shake(btn);
      throw e;
    }
  }
  // The light that follows the mouse is the shared motion kit's (motion.js), on the tiles, contact buttons and Timeline bubbles too.
  let firstDraw = true; // the first drawing: a link to #options goes straight to Applications
  const icon = (name, cls) => { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('aria-hidden', 'true'); if (cls) sv.setAttribute('class', cls); sv.innerHTML = ICONS[name] || ''; return sv; };

  // ---- where the student is on the way from first inquiry to visa: eight named steps under the name ----
  // Done steps are a blue dot with a tick, the step the student is at has a soft ring, the rest are grey (the owner, 20 Nov 2026).
  const JOURNEY = [['Inquiry', 'Inquiry'], ['Application Stage', 'Application'], ['Mock Stage', 'Mock interview'], ['Payment Stage', 'Payment'],
    ['CAS Stage', 'CAS requested'], ['CAS Issued', 'CAS issued'], ['Visa Lodge', 'Visa lodged'], ['Visa Issued', 'Visa issued']];
  // What each step means, shown in a small card when the mouse is on it (or it has the keyboard).
  const STEP_HELP = ['The student first asked about studying', 'Applications to universities', 'The mock interview before the CAS', 'Deposit or tuition paid',
    'The CAS is asked for', 'The CAS is in hand', 'The visa application is lodged', 'The visa is granted'];
  function journey(stage) {
    const box = el('div', 'sc-steps-box');
    const at = JOURNEY.findIndex(([name]) => name === stage);
    const lost = F.LOST_STAGES.includes(stage);
    const head = el('div', 'sc-steps-head');
    if (at !== -1) head.append(el('span', 'sc-eyebrow', 'Progress'), el('span', 'sc-steps-now', `Step ${at + 1} of ${JOURNEY.length}: `), el('b', '', JOURNEY[at][1]));
    else if (lost) { box.classList.add('is-lost'); head.append(el('span', 'sc-eyebrow', 'Progress'), el('b', '', `Not moving at the moment: ${stage}`)); }
    else head.append(el('span', 'sc-eyebrow', 'Progress'), el('b', '', stage ? `Stage: ${stage}` : 'No stage yet'));
    const ol = el('ol', 'sc-steps');
    /* 🔴 CSS CHANGED (2026-11-21): --sc-done set here | from: none | to: how far the progress line reaches (0 to 1), drawn from the start when the card appears */
    ol.style.setProperty('--sc-done', at <= 0 ? '0' : String(at / (JOURNEY.length - 1)));
    JOURNEY.forEach(([, label], i) => {
      const state = at === -1 ? '' : i < at ? 'is-done' : i === at ? 'is-now' : '';
      const li = el('li', state);
      li.tabIndex = 0;
      const dot = el('span', 'sc-step-dot');
      if (at !== -1 && i < at) dot.append(icon('check'));
      const tip = el('span', 'sc-step-tip');
      tip.append(el('b', '', label), el('span', '', STEP_HELP[i]), el('em', '', state === 'is-done' ? 'Done' : state === 'is-now' ? 'Here now' : at !== -1 && i === at + 1 ? 'Next' : 'Still to come'));
      li.append(dot, el('span', 'sc-step-label', label), tip);
      li.setAttribute('aria-label', `${label}: ${state === 'is-done' ? 'done' : state === 'is-now' ? 'here now' : 'still to come'}`);
      if (i === at) li.setAttribute('aria-current', 'step');
      /* 🔴 CSS CHANGED (2026-11-21): --i set here | from: none | to: the step's number, so the dots light up one after another */
      li.style.setProperty('--i', String(i));
      ol.append(li);
    });
    box.append(head, ol);
    return box;
  }

  // ---- the bar at the top: who the student is, the stage and intake, the actions, and the progress line (a solid panel) ----
  function hero() {
    const s = data.student;
    const c = el('section', 'sc-hero lg-box');
    const head = el('div', 'sc-head');
    const av = el('div', 'sc-avatar', initials(s.name));
    av.setAttribute('aria-hidden', 'true');
    const who = el('div', 'sc-id');
    who.append(el('h1', 'sc-name', s.name));
    const meta = el('div', 'sc-meta');
    if (s.intake) meta.append(el('span', 'sc-meta-text', s.intake));
    meta.append(stagePill(s.stage));
    who.append(meta);
    const act = el('div', 'sc-actions');
    const reach = contactBar();
    if (reach) act.append(reach);
    if (data.can.assign) { const b = h('button', { class: 'btn btn-primary', type: 'button', onclick: assignTask }); b.append(icon('plus', 'sc-btn-ico'), 'Assign a task'); act.append(b); }
    head.append(av, who, act);
    c.append(head, journey(s.stage));
    return c;
  }

  // A panel with its title bar (the owner, 21 Nov 2026: solid panels and tables, as Route2Uni).
  function box(title, cls, extra) {
    const sec = el('section', `lg-box ${cls || ''}`.trim());
    const head = el('div', 'lg-head');
    const t = el('h2', '', title);
    if (extra) t.append(el('span', 'lg-head-sub', extra));
    head.append(t);
    sec.append(head);
    return { sec, head };
  }

  // ---- the left column: the profile as a table with one Edit profile, and the student source ----
  function profileColumn() {
    const side = el('aside', 'sc-side');
    const { sec, head } = box('Profile', 'lg-profile');
    if (can()) head.append(h('button', { class: 'btn lg-edit', type: 'button', onclick: editProfile }, 'Edit profile'));
    const dl = el('dl', 'lg-dl');
    FIELDS.forEach((f) => {
      const v = f.get();
      const dd = el('dd', '');
      if (v) {
        const shown = f.show ? f.show(v) : v;
        if (f.link || f.wa) {
          const wa = f.wa ? F.whatsappNumber(v) : '';
          const a = el('a', '', shown); a.href = f.link ? f.link(v) : wa ? 'https://wa.me/' + wa : '#';
          if (f.wa && wa) a.addEventListener('click', (e) => { e.preventDefault(); window.Portal.whatsapp(wa, data.student.name, '', id); });
          dd.append(a);
        } else dd.textContent = shown;
      } else dd.append(el('span', f.optional ? 'lg-none' : 'lg-missing', f.optional ? 'Not added' : 'Missing'));
      dl.append(el('dt', '', f.label), dd);
    });
    // The Student source, as rows of the Profile (the owner, 22 Nov 2026: not a card of its own); changed in Edit profile.
    const p = profile();
    const s = data.student;
    const g = F.sourceGroup(s.source);
    const plain = (v) => String(v || '').replace(/^(Marketing|Event)\s*:\s*/i, '').replace(/,\s*\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}$/, '').trim();
    const row = (label, value, empty) => { const dd = el('dd', ''); if (value) dd.textContent = value; else dd.append(el('span', empty === 'missing' ? 'lg-missing' : 'lg-none', empty === 'missing' ? 'Missing' : 'Not added')); dl.append(el('dt', '', label), dd); };
    row('Student source', g === 'Branch' ? s.source : g, 'missing');
    if (g === 'Social Media' && (p.sourcePlatform || p.sourceWay)) {
      row('Platform', p.sourcePlatform);
      row('How they came', p.sourceWay === 'Advert' ? `Advert: ${plain(p.sourceDetail) || 'campaign not named'}` : 'Organic (by itself)');
    } else if (g && g !== 'Branch') row(F.SOURCE_DETAIL_LABEL[g] || 'Where exactly', (g === 'Events' && data.event ? plain(data.event.name) : plain(p.sourceDetail)));
    if (p.inquiryDate) row('First inquiry', `${day(p.inquiryDate)}${p.inquiryTime ? ` at ${p.inquiryTime}` : ''}`);
    sec.append(dl);
    if (p.savedAt) sec.append(el('div', 'lg-foot', `Last saved ${when(p.savedAt)} by ${p.savedBy || 'someone'}`));
    side.append(sec, applicationDetails(), mockInterviews());
    return side;
  }

  // ---- Application details and Mock interviews (the owner, 22 Nov 2026): every detail of the application on the card ----
  // University, course and University partner come by themselves from the Priority application; the rest is changed with Edit, in
  // one window. Every save is written in the student's notes and can be undone for 5 seconds. The Application Team changes these
  // here, never on the sheet. Mock interviews are changed by the Mock Team (and Admin); the Application Team only looks.
  const rowOf = () => data.student.row || {};
  const mayEdit = (col) => (data.can.cols || []).includes(col);
  const APP_EDIT = ['RECEIVING PARTNER', 'LANGUAGE TEST DATE', 'STUDENT ID', 'NOC', 'NOC NUMBER', 'MEDICAL REPORT'];
  const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
  const languageShown = (v) => { const t = String(v || '').trim(); if (!t) return ''; const d = isoDay(t); return d ? `Test date, ${day(d)}` : t; };
  function detailsList(rows) {
    const dl = el('dl', 'lg-dl');
    rows.forEach(([label, value]) => {
      const dd = el('dd', '');
      if (value instanceof Node) dd.append(value); else if (value) dd.textContent = value; else dd.append(el('span', 'lg-none', 'Not added'));
      dl.append(el('dt', '', label), dd);
    });
    return dl;
  }
  function applicationDetails() {
    const r = rowOf();
    const { sec, head } = box('Application details', 'lg-appdetails');
    if (can() && APP_EDIT.some(mayEdit)) head.append(h('button', { class: 'btn lg-edit', type: 'button', onclick: editApplicationDetails }, 'Edit'));
    const med = (data.card.medical && data.card.medical.date) || '';
    sec.append(detailsList([
      ['University', r['UNIVERSITY NAME']], ['Course', r['COURSE NAME']], ['University partner', r['UNIVERSITY PARTNER']],
      ['Receiving partner', r['RECEIVING PARTNER']], ['Language test', languageShown(r['LANGUAGE TEST DATE'])], ['Student ID', r['STUDENT ID']],
      ['NOC', r.NOC], ['NOC number', r['NOC NUMBER']], ['Medical report', r['MEDICAL REPORT']], ['Medical booking date', med ? day(med) : ''],
    ]));
    return sec;
  }
  async function editApplicationDetails() {
    const r = rowOf();
    let choices = { offices: [], agents: [] };
    try { choices = await api('/api/partner-choices'); } catch (e) { /* the list stays short: the current value is still offered */ }
    const lang = String(r['LANGUAGE TEST DATE'] || '').trim();
    const before = {
      'RECEIVING PARTNER': String(r['RECEIVING PARTNER'] || '').trim(), 'LANGUAGE TEST DATE': lang, 'STUDENT ID': String(r['STUDENT ID'] || '').trim(),
      NOC: String(r.NOC || '').trim(), 'NOC NUMBER': String(r['NOC NUMBER'] || '').trim(), 'MEDICAL REPORT': String(r['MEDICAL REPORT'] || '').trim(),
      'MEDICAL BOOKING DATE': (data.card.medical && data.card.medical.date) || '',
    };
    const LABEL = { 'RECEIVING PARTNER': 'Receiving partner', 'LANGUAGE TEST DATE': 'Language test', 'STUDENT ID': 'Student ID', NOC: 'NOC', 'NOC NUMBER': 'NOC number', 'MEDICAL REPORT': 'Medical report', 'MEDICAL BOOKING DATE': 'Medical booking date' };
    dialog('Application details', (body, close) => {
      const form = el('form', 'lg-form');
      form.noValidate = true;
      const field = (key, label, input, wide) => {
        const w = el('div', `lg-form-field${wide ? ' is-wide' : ''}`);
        input.id = 'ad-' + key.replace(/\W+/g, '-').toLowerCase(); input.classList.add('lg-input');
        if (!mayEdit(key === 'MEDICAL BOOKING DATE' ? 'MEDICAL REPORT' : key.trim())) input.disabled = true;
        const l = el('label', 'lg-form-label', label); l.htmlFor = input.id;
        w.append(l, input); form.append(w); return w;
      };
      const pick = (v, list) => { const sel = document.createElement('select'); const all = [...new Set([...(v && !list.includes(v) ? [v] : []), ...list])]; [['', 'Choose'], ...all.map((c) => [c, c])].forEach(([c, t]) => { const o = document.createElement('option'); o.value = c; o.textContent = t; sel.append(o); }); sel.value = v || ''; return sel; };
      const recv = pick(before['RECEIVING PARTNER'], [...(choices.offices || []), ...(choices.agents || []).filter((n) => !(choices.offices || []).includes(n))]);
      field('RECEIVING PARTNER', 'Receiving partner', recv);
      const kindNow = isoDay(lang) || lang === 'Test Date' ? 'Test Date' : lang;
      const kind = pick(kindNow, ['Test Date', 'Waiver', 'University Internal Test']);
      field('LANGUAGE TEST DATE', 'Language test', kind);
      const testDay = h('input', { type: 'date', value: isoDay(lang) });
      const testBox = field('LANGUAGE TEST DATE ', 'Test date', testDay);
      const showDay = () => { testBox.hidden = kind.value !== 'Test Date'; };
      kind.addEventListener('change', showDay); showDay();
      const sid = h('input', { type: 'text', value: before['STUDENT ID'], maxlength: '60' });
      field('STUDENT ID', 'Student ID', sid);
      const noc = pick(before.NOC, ['Pending', 'Received']);
      field('NOC', 'NOC', noc);
      const nocNo = h('input', { type: 'text', value: before['NOC NUMBER'], maxlength: '60' });
      field('NOC NUMBER', 'NOC number', nocNo);
      const medR = pick(before['MEDICAL REPORT'], ['Pending', 'Booked', 'Received']);
      field('MEDICAL REPORT', 'Medical report', medR);
      const medD = h('input', { type: 'date', value: before['MEDICAL BOOKING DATE'] });
      field('MEDICAL BOOKING DATE', 'Medical booking date', medD);
      const now = () => ({
        'RECEIVING PARTNER': recv.value, 'LANGUAGE TEST DATE': kind.value === 'Test Date' ? (testDay.value || 'Test Date') : kind.value,
        'STUDENT ID': sid.value.trim(), NOC: noc.value, 'NOC NUMBER': nocNo.value.trim(), 'MEDICAL REPORT': medR.value, 'MEDICAL BOOKING DATE': medD.value,
      });
      const changed = () => { const v = now(); return Object.keys(v).filter((k) => v[k] !== before[k]); };
      const note = el('p', 'lg-form-note');
      const showChanges = () => { const c = changed(); note.textContent = c.length ? `Will change: ${c.map((k) => LABEL[k]).join(', ')}.` : 'Nothing changed yet.'; };
      form.addEventListener('input', showChanges); form.addEventListener('change', showChanges); showChanges();
      form.append(note);
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      form.append(foot);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = now(); const c = changed();
        if (!c.length) { close(); return; }
        ok.disabled = true; ok.textContent = 'Saving...';
        try {
          const was = { sheet: {} }; const now2 = { sheet: {} };
          c.forEach((k) => { was.sheet[k] = before[k]; now2.sheet[k] = v[k]; });
          tookOver(was, await api(`/api/cards/${id}/sheet`, { fields: now2.sheet }));
          data = await api('/api/cards/' + encodeURIComponent(id));
          close(); render(); savedWithUndo('Application details saved', was, now2);
        } catch (err) { ok.disabled = false; ok.textContent = 'Save changes'; say(err.message, true); }
      });
      body.append(form);
      setTimeout(() => { const f = form.querySelector('select:not([disabled]), input:not([disabled])'); if (f) f.focus(); }, 0);
    }, { wide: true });
  }
  function mockInterviews() {
    const r = rowOf();
    const { sec, head } = box('Mock interviews', 'lg-mocks');
    if (can() && mayEdit('MOCK SCHEDULE 1')) head.append(h('button', { class: 'btn lg-edit', type: 'button', onclick: editMockInterviews }, 'Edit'));
    const mock = (n) => {
      const d = isoDay(r[`MOCK SCHEDULE ${n}`]) || String(r[`MOCK SCHEDULE ${n}`] || '').trim();
      const fb = String(r[`FEEDBACK ${n}`] || '').trim();
      if (!d && !fb) return '';
      const w = el('div', '');
      w.append(el('div', '', d ? (isoDay(d) ? day(d) : d) : 'No day'));
      if (fb) w.append(el('div', 'lg-none', fb));
      return w;
    };
    sec.append(detailsList([[`Mock 1`, mock(1)], [`Mock 2`, mock(2)], [`Mock 3`, mock(3)], [`Mock 4`, mock(4)], ['Pre-CAS interview', r['PRE CAS INTERVIEW']]]));
    return sec;
  }
  function editMockInterviews() {
    const r = rowOf();
    const COLS = [1, 2, 3, 4].flatMap((n) => [`MOCK SCHEDULE ${n}`, `FEEDBACK ${n}`]).concat('PRE CAS INTERVIEW');
    const before = Object.fromEntries(COLS.map((c) => [c, c.startsWith('MOCK SCHEDULE') ? isoDay(r[c]) || String(r[c] || '').trim() : String(r[c] || '').trim()]));
    const LABEL = (c) => c === 'PRE CAS INTERVIEW' ? 'Pre-CAS interview' : c.startsWith('MOCK') ? `Mock ${c.slice(-1)} day` : `Mock ${c.slice(-1)} feedback`;
    dialog('Mock interviews', (body, close) => {
      const form = el('form', 'lg-form');
      form.noValidate = true;
      const inputs = {};
      const field = (key, label, input, wide) => {
        const w = el('div', `lg-form-field${wide ? ' is-wide' : ''}`);
        input.id = 'mi-' + key.replace(/\W+/g, '-').toLowerCase(); input.classList.add('lg-input');
        if (!mayEdit(key)) input.disabled = true;
        const l = el('label', 'lg-form-label', label); l.htmlFor = input.id;
        w.append(l, input); form.append(w); inputs[key] = input;
      };
      [1, 2, 3, 4].forEach((n) => {
        form.append(el('div', 'lg-form-group', `Mock ${n}`));
        // A day kept in an older form ("3/12/2026") is shown as it is, so saving another detail never empties it.
        const kept = before[`MOCK SCHEDULE ${n}`];
        field(`MOCK SCHEDULE ${n}`, 'Day', kept && !isoDay(kept) ? h('input', { type: 'text', value: kept, maxlength: '40' }) : h('input', { type: 'date', value: kept }));
        const fb = document.createElement('textarea'); fb.rows = 2; fb.maxLength = 2000; fb.value = before[`FEEDBACK ${n}`];
        field(`FEEDBACK ${n}`, 'Feedback', fb, true);
      });
      form.append(el('div', 'lg-form-group', 'Pre-CAS interview'));
      const pc = document.createElement('select'); [['', 'Not yet'], ['Passed', 'Passed'], ['Fail', 'Fail']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; pc.append(o); }); pc.value = before['PRE CAS INTERVIEW'];
      field('PRE CAS INTERVIEW', 'Result', pc);
      const now = () => Object.fromEntries(COLS.map((c) => [c, String(inputs[c].value || '').trim()]));
      const changed = () => { const v = now(); return COLS.filter((c) => v[c] !== before[c]); };
      const note = el('p', 'lg-form-note');
      const showChanges = () => { const c = changed(); note.textContent = c.length ? `Will change: ${c.map(LABEL).join(', ')}.` : 'Nothing changed yet.'; };
      form.addEventListener('input', showChanges); form.addEventListener('change', showChanges); showChanges();
      form.append(note);
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      form.append(foot);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = now(); const c = changed();
        if (!c.length) { close(); return; }
        ok.disabled = true; ok.textContent = 'Saving...';
        try {
          const was = { sheet: {} }; const now2 = { sheet: {} };
          c.forEach((k) => { was.sheet[k] = before[k]; now2.sheet[k] = v[k]; });
          tookOver(was, await api(`/api/cards/${id}/sheet`, { fields: now2.sheet }));
          data = await api('/api/cards/' + encodeURIComponent(id));
          close(); render(); savedWithUndo('Mock interviews saved', was, now2);
        } catch (err) { ok.disabled = false; ok.textContent = 'Save changes'; say(err.message, true); }
      });
      body.append(form);
    }, { wide: true });
  }

  // ---- tasks given to a team about this student ----
  function assignTask() {
    dialog('Assign a task', (body, close) => {
      // Which team and what to do: no date to do it by (the owner, 14 Nov 2026). The team asks for anything it needs in the
      // task's comments, and ticks it when it is done.
      // A team, or Admin (named with their title): the teams and branches can give Admin a task too.
      const targets = (data.assignTeams || data.taskTeams || []).map((t) => [t.id, t.label]);
      const team = field('Who should do it?', { kind: 'select', choices: targets, value: targets.length === 1 ? targets[0][0] : '', required: true });
      // Exactly who gets it (the owner, 15 Nov 2026): the people whose own team it is.
      const goes = el('div', 'p-goes');
      const showGoes = () => {
        const t = (data.assignTeams || data.taskTeams || []).find((x) => x.id === team.input.value);
        goes.replaceChildren();
        if (!t) return;
        const names = t.members || [];
        goes.append(names.length ? `Goes to ${names.join(', ')}` : 'Nobody has this team yet: set it in Users.');
        goes.classList.toggle('is-warn', !names.length);
      };
      team.wrap.append(goes);
      team.input.addEventListener('change', showGoes);
      showGoes();
      // What it is about first, required (the owner, 20 Nov 2026). An Application task then asks, each required with a red *: the
      // university (every university in Universities), the intake, the course level, the location (when it teaches in more than one
      // place) and the course, from the university's own list; then optional comments. Mock interview, Documents, NOC and Medical ask
      // for comments only (the owner, 20 Nov 2026); Other asks for them too, and needs them, since it says nothing by itself.
      const tag = window.Portal.tagPicker('');
      const tagWrap = el('div', 'p-field p-wide');
      const tagLabel = el('span', 'p-label', 'What is it about?');
      tagLabel.append(window.Portal.requiredMark());
      tagWrap.append(tagLabel, tag.node);
      const text = field('Comments', { kind: 'area', max: 2000, wide: true, placeholder: 'e.g. Ask for the bank statement.' });
      const textLabel = text.wrap.querySelector('.p-label');
      const otherMark = window.Portal.requiredMark();
      // The application fields.
      const appBox = el('div', 'p-form p-assign-app p-wide');
      const uni = field('University', { kind: 'select', choices: [], required: true });
      const intake = field('Intake', { kind: 'select', choices: [], required: true });
      const level = field('Course level', { kind: 'select', choices: [], required: true });
      const place = field('Location', { kind: 'select', choices: [], required: true });
      const course = field('Course', { kind: 'select', choices: [], required: true });
      const comments = field('Comments', { kind: 'area', max: 1500, wide: true, placeholder: 'e.g. Please submit the application to this university.' });
      comments.input.rows = 2;
      appBox.append(uni.wrap, intake.wrap, level.wrap, place.wrap, course.wrap, comments.wrap);
      const fill = (f, list, keep) => { const was = keep ? f.input.value : ''; f.input.replaceChildren(h('option', { value: '' }, 'Choose\u2026'), ...list.map((x) => h('option', { value: x }, x))); f.input.value = list.includes(was) ? was : list.length === 1 ? list[0] : ''; };
      let choices = null;
      let unis = [];
      const coursesNow = () => (choices ? choices.courses.filter((c) => (!intake.input.value || !c.start || c.start.includes(intake.input.value)) && (!level.input.value || c.level === level.input.value) && (!place.input.value || !c.campus || c.campus === place.input.value)) : []);
      const refreshCourses = () => { fill(course, [...new Set(coursesNow().map((c) => c.name))].sort((a, b) => a.localeCompare(b)), true); };
      uni.input.addEventListener('change', async () => {
        choices = null; [intake, level, place, course].forEach((f) => fill(f, []));
        if (!uni.input.value) return;
        try { choices = await api(`/api/facts/${encodeURIComponent(uni.input.value)}/choices`); } catch (e) { choices = { intakes: ['January 2027'], levels: [], campuses: [], courses: [] }; }
        fill(intake, choices.intakes); fill(level, choices.levels); fill(place, choices.campuses);
        place.wrap.hidden = choices.campuses.length < 2; // one place: nothing to choose
        refreshCourses();
      });
      intake.input.addEventListener('change', refreshCourses);
      level.input.addEventListener('change', refreshCourses);
      place.input.addEventListener('change', refreshCourses);
      api('/api/facts').then((list) => { unis = list.sort((a, b) => a.name.localeCompare(b.name)); uni.input.replaceChildren(h('option', { value: '' }, 'Choose\u2026'), ...unis.map((u) => h('option', { value: u.id }, u.name))); }).catch(() => {});
      const isApp = () => tag.value() === 'application';
      const showKind = () => {
        const a = isApp(); const k = tag.value();
        appBox.hidden = !a; text.wrap.hidden = a || !k;
        if (k === 'other') { if (textLabel && !otherMark.isConnected) textLabel.append(otherMark); } else otherMark.remove();
        const hints = { mock: 'e.g. Book the mock interview for Tuesday.', documents: 'e.g. Ask for the bank statement.', noc: 'e.g. Apply for the NOC this week.', medical: 'e.g. Book the TB test at the clinic.', other: 'What should they do?' };
        text.input.placeholder = hints[k] || '';
      };
      tag.node.addEventListener('click', () => setTimeout(showKind, 0));
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Assign');
      ok.addEventListener('click', async () => {
        const stop = (t, f) => { msg.textContent = t; msg.className = 'p-msg error'; shake(msg); if (f) { f.classList.add('sc-bad'); shake(f); const off = () => f.classList.remove('sc-bad'); f.addEventListener('change', off, { once: true }); f.addEventListener('click', off, { once: true }); } };
        if (!team.input.value) return stop('Choose who should do it.', team.wrap);
        if (!tag.value()) return stop('Choose what it is about.', tagWrap);
        let payload;
        if (isApp()) {
          const need = [[uni, 'the university'], [intake, 'the intake'], [level, 'the course level'], ...(place.wrap.hidden ? [] : [[place, 'the location']]), [course, 'the course']].find(([f]) => !f.input.value);
          if (need) return stop(`Choose ${need[1]}.`, need[0].wrap);
          const uName = (unis.find((u) => u.id === uni.input.value) || {}).name || '';
          const loc = place.input.value || (choices && choices.campuses.length === 1 ? choices.campuses[0] : '');
          const app = { university: uName, universityId: uni.input.value, intake: intake.input.value, level: level.input.value, location: loc, course: course.input.value };
          const line = [uName, app.intake, app.level, loc, app.course].filter(Boolean).join(' · ');
          payload = { team: team.input.value, tag: 'application', app, text: `Submit the application: ${line}${comments.input.value.trim() ? `\n${comments.input.value.trim()}` : ''}` };
        } else {
          const words = text.input.value.trim();
          if (!words && tag.value() === 'other') return stop('Write what should be done.', text.wrap);
          // No comments: the task is named by what it is about ("Mock interview"), so the team still sees what to do.
          payload = { team: team.input.value, text: words || window.Portal.tagLabel(tag.value()), tag: tag.value() };
        }
        try { await morph(ok, () => save('tasks', payload), { busy: 'Assigning…', done: 'Assigned' }); window.Portal.celebrate(ok); say('Task assigned. The team is told.'); close(true); } catch (e) { /* shown */ }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form p-assign'); g.append(team.wrap, tagWrap, appBox, text.wrap);
      body.append(g, msg, foot);
      showKind();
    }).then((done) => { if (done) render(); });
  }
  // The tasks about this student, in the same look as Today, each with its comments: shown only when there is one (the "Assign a
  // task" button is at the top).
  function tasksCard() {
    const lastAt = (t) => { const c = t.comments || []; return String(c.length ? c[c.length - 1].at : t.at); };
    // Only the open tasks: a done one is in Notes and history (the owner, 15 Nov 2026). The oldest first, the newest last.
    const tasks = (data.card.tasks || []).filter((t) => !t.done).sort((a, b) => window.Portal.taskPriority(b) - window.Portal.taskPriority(a) || lastAt(b).localeCompare(lastAt(a)));
    if (!tasks.length) return null;
    const c = el('section', 'p-card p-tasks');
    const head = el('div', 'p-card-head');
    const open = tasks.filter((t) => !t.done).length;
    // The title with how many are open in grey beside it, and a small red pill only when something is new.
    const title = el('h2', '', 'Tasks');
    title.append(el('span', 'sc-tl-count', String(open)));
    head.append(title);
    c.append(head);
    const label = (id) => ((data.taskTeams || []).find((t) => t.id === id) || { label: id }).label;
    const me = (data.me || {}).name || '';
    const unread = data.taskUnread || {};
    const fresh = Object.values(unread).reduce((n, x) => n + x, 0);
    if (fresh) head.append(el('span', 'td-chip is-new', `${fresh} new`));
    const list = el('div', 'td-list');
    c.append(list);
    tasks.forEach((t) => {
      const forMe = (data.can.myTeams || []).includes(t.team) || (t.team === 'head' && (data.me || {}).role === 'admin');
      const mine = data.can.removeAnyTask || forMe;
      const had = (t.route || []).some((x) => (data.can.myTeams || []).includes(x) || (x === 'head' && (data.me || {}).role === 'admin'));
      const reload = async () => { data = await api('/api/cards/' + encodeURIComponent(id)); render(); };
      list.append(window.Portal.taskCard(t, {
        rowId: id, me, teams: data.taskTeams || [], stage: data.student.stage, unread: unread[t.id] || 0, today: data.today,
        canWrite: !data.can.readOnly && (mine || t.by === me || had), mayTick: mine, canChange: !data.can.readOnly && (Boolean(data.can.removeAnyTask) || t.by === me), // the tag: whoever gave it, Admin or the Manager
        student: null, fromName: t.by === me ? 'You' : t.by || 'Someone', toName: forMe && t.team === 'head' ? 'you' : label(t.team),
        actions: [
          // Reassign (the team it is with, whoever gave it, Admin and the Manager) and Remove.
          !t.done && !data.can.readOnly && (mine || t.by === me) && ['Reschedule', async () => { if (await window.Portal.scheduleTask(t, { rowId: id, today: data.today })) { say('Rescheduled. It waits under Later on Today.'); reload(); } }],
          (data.can.removeAnyTask || t.by === me) && ['Edit the task', async () => { if (await window.Portal.editTask(t, { rowId: id, stage: data.student.stage })) { say('Task updated. The team is told.'); reload(); } }],
          !data.can.readOnly && (mine || t.by === me) && ['Reassign to another team', async () => { if (await window.Portal.handOn(t, { rowId: id, teams: data.handTeams || [] })) { say('Reassigned'); reload(); } }],
          (data.can.removeAnyTask || t.by === me) && ['Remove the task', async () => { if (await window.NiecUI.confirm('Remove this task and its updates?', { danger: true, confirmText: 'Remove' })) { await save(`tasks/${t.id}/delete`, {}, 'Task removed'); render(); } }, true],
        ],
        onTick: async (done, folded, finish) => { await save(`tasks/${t.id}`, { done, ...(finish ? { finish } : {}) }, done ? window.Portal.cheer() : 'Marked as not done'); await folded; data = await api('/api/cards/' + encodeURIComponent(id)); render(); },
        onChanged: reload,
      }));
    });
    return c;
  }



  // The Student source is shown in the Profile and changed in Edit profile (the owner, 22 Nov 2026). Kept for the key handlers.
  let editingOrigin = false;

  // ---- Notes (replace the Remarks column of the sheet) ----
  // A note is a note (the owner, 14 Nov 2026): no kinds to choose (phone call, office visit, message); notes kept with a kind
  // before still show, all simply as notes. Notes are about the student (IELTS booked, the CAS result, money ready); the talk with
  // a team about a piece of work is in the comments of its task.
  let noteDraft = '';
  let tlLastSeen = null; // when this person last opened this student ('' the first time), read once when the card opens
  // A note being written is kept in this browser until it is added, so closing the card or the window never loses it.
  const draftKey = () => `isrDraft:${(data && data.me && data.me.name) || ''}:${id}`;
  // N starts a note (when nothing is being typed and no window is open), as a quick key in Apple's apps.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('dialog[open], .p-dialog')) return;
    const box = document.querySelector('.sc-tl-input');
    if (box) { e.preventDefault(); box.focus(); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
  // Web addresses, email addresses and phone numbers in what was written open with one click.
  const LINKABLE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]|www\.[^\s<>"]+[^\s<>".,;:!?)\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?977[\s-]?9\d{9}|\b9[678]\d{8}\b)/g;
  function linked(text) {
    const out = []; const t = String(text || ''); let i = 0; let m;
    LINKABLE.lastIndex = 0;
    while ((m = LINKABLE.exec(t))) {
      if (m.index > i) out.push(t.slice(i, m.index));
      const v = m[0];
      const a = el('a', 'sc-tl-link', v);
      if (/@/.test(v) && !/^https?:|^www\./.test(v)) a.href = 'mailto:' + v;
      else if (/^[+\d]/.test(v)) a.href = 'tel:' + v.replace(/[^\d+]/g, '');
      else { a.href = /^www\./.test(v) ? 'https://' + v : v; a.target = '_blank'; a.rel = 'noopener'; }
      out.push(a);
      i = m.index + v.length;
    }
    if (i < t.length) out.push(t.slice(i));
    return out;
  }
  // The Timeline (the owner, 21 Nov 2026, the Ledger design): one table, newest first, with When, What, What happened and By. Every
  // event is shown, never cut short and never folded; what can be done to an event (Reopen a done task, Remove a note, Read an email)
  // is in its small "..." menu. What is written stays as it was written.
  let openMenu = null;
  const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  document.addEventListener('click', (e) => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.lg-more')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { e.stopPropagation(); closeMenu(); } }, true);
  function moreMenu(cell, items) {
    const b = h('button', { class: 'lg-more', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'More for this event', title: 'More' }, '...');
    b.addEventListener('click', () => {
      const was = openMenu && openMenu.parentNode === cell;
      closeMenu();
      if (was) return;
      const m = el('div', 'lg-menu'); m.setAttribute('role', 'menu');
      items.forEach(([label, fn, danger]) => { const it = h('button', { class: `lg-menu-item${danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem' }, label); it.addEventListener('click', () => { closeMenu(); fn(); }); m.append(it); });
      cell.append(m); openMenu = m;
      const first = m.querySelector('button'); if (first) first.focus();
    });
    cell.append(b);
  }
  function notes() {
    const wrap = el('section', 'lg-box lg-timeline p-tl');
    const head = el('div', 'lg-head');
    const title = el('h2', '', 'Timeline');
    head.append(title);
    wrap.append(head);
    // What is new since this person last opened the student: a small blue dot. Kept in this browser only.
    const meName = (data.me || {}).name || '';
    if (tlLastSeen === null) {
      const key = `isrSeen:${meName}:${id}`;
      try { tlLastSeen = localStorage.getItem(key) || ''; localStorage.setItem(key, new Date().toISOString()); } catch (e) { tlLastSeen = ''; }
    }
    if (can()) {
      const box2 = el('div', 'lg-compose sc-tl-compose');
      const text = el('textarea', 'lg-input sc-tl-input');
      text.placeholder = 'Add a note';
      text.setAttribute('aria-label', 'Write a note');
      text.maxLength = 4000;
      text.rows = 1;
      text.value = noteDraft;
      const add = h('button', { class: 'btn btn-primary', type: 'button' }, 'Add note');
      text.addEventListener('input', () => { noteDraft = text.value; try { if (noteDraft.trim()) localStorage.setItem(draftKey(), noteDraft); else localStorage.removeItem(draftKey()); } catch (e) { /* not kept */ } });
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add.click(); } });
      add.addEventListener('click', async () => {
        if (!text.value.trim()) { text.focus(); return; }
        add.disabled = true; add.textContent = 'Adding...';
        try {
          await save('notes', { text: text.value, kind: 'note' }, 'Note added');
          noteDraft = ''; try { localStorage.removeItem(draftKey()); } catch (e) { /* nothing kept */ }
          if (historyFilter !== 'all' && historyFilter !== 'note') historyFilter = 'all';
          render();
        } catch (e) { add.disabled = false; add.textContent = 'Add note'; }
      });
      box2.append(text, add);
      wrap.append(box2);
    }
    // Every note, every task event (given, each update, reassigned, moved, done) and every message sent from Follow-up.
    const teamName = (tid) => (((data.taskTeams || []).find((x) => x.id === tid) || {}).label || tid).replace(/\s*\(.*\)$/, '');
    const AUTO = 'ISR (automatic)';
    // A stage moved on and a call with no answer are written by ISR (the owner, 21 Nov 2026) and shown as such.
    const events = data.card.notes.map((n) => ({ kind: n.by === AUTO ? 'auto' : n.kind === 'stage' ? 'stage' : n.kind === 'try' ? 'try' : 'note', at: n.at, by: n.by, text: n.text, note: n }));
    (data.card.tasks || []).forEach((t) => {
      const tag = window.Portal.tagOf(t, data.student.stage);
      events.push({ kind: 'task', at: t.at, by: t.by, label: 'Task given', lead: `To ${teamName(t.team)}`, text: t.text, tag });
      (t.comments || []).forEach((c) => {
        if (c.handoff) events.push({ kind: 'task', at: c.at, by: c.by, label: 'Reassigned', lead: `${teamName(c.handoff.from)} to ${teamName(c.handoff.to)}`, ref: t.text, text: c.text || '' });
        else if (c.schedule) events.push({ kind: 'task', at: c.at, by: c.by, label: 'Moved', lead: c.schedule.to ? `Moved to ${window.Portal.dayLabel(c.schedule.to, data.today)}` : 'Moved back to today', ref: t.text, text: c.text || '' });
        else if (c.text) events.push({ kind: 'update', at: c.at, by: c.by, label: 'Task update', ref: t.text, text: c.text });
      });
      if (t.done && t.doneAt) events.push({ kind: 'done', at: t.doneAt, by: t.doneBy, label: 'Task done', ref: t.text, text: '', task: t });
    });
    (data.card.messages || []).forEach((m) => {
      const label = m.channel === 'whatsapp' ? 'WhatsApp' : m.status === 'sent' ? 'Email sent' : m.status === 'failed' ? 'Email not sent' : 'Email prepared';
      events.push({ kind: 'message', at: m.at, by: m.by, label, lead: m.subject || m.template || '', text: '', message: m });
    });
    events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    const group = (e) => (['note', 'auto', 'stage', 'try'].includes(e.kind) ? 'note' : e.kind === 'message' ? 'message' : 'task');
    const present = new Set(events.map(group));
    if (!present.has(historyFilter)) historyFilter = 'all';
    const remark = data.student.remarks && data.student.remarks !== data.card.autoRemark ? data.student.remarks : '';
    const shown = events.filter((e) => historyFilter === 'all' || group(e) === historyFilter);
    title.append(el('span', 'lg-head-sub', `${events.length} ${events.length === 1 ? 'event' : 'events'}`));
    // All, Notes, Tasks, Messages: one segmented switch with the count of each.
    if (present.size > 1) {
      const seg = el('div', 'lg-seg');
      seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show');
      [['all', 'All'], ['note', 'Notes'], ['task', 'Tasks'], ['message', 'Messages']].filter(([k]) => k === 'all' || present.has(k)).forEach(([k, label]) => {
        const n = k === 'all' ? events.length : events.filter((e) => group(e) === k).length;
        const b = h('button', { class: 'lg-seg-btn', type: 'button', 'aria-pressed': String(historyFilter === k) }, `${label} ${n}`);
        b.addEventListener('click', () => { historyFilter = k; render(); });
        seg.append(b);
      });
      head.append(seg);
    }
    const table = el('table', 'lg-table lg-tl');
    const thead = el('thead'); const hr = el('tr');
    [['When', 'is-when'], ['What', 'is-kind'], ['What happened', ''], ['By', 'is-by'], ['', 'is-more']].forEach(([t, c]) => { const th = el('th', c, t); th.scope = 'col'; hr.append(th); });
    thead.append(hr); table.append(thead);
    const tb = el('tbody');
    const pad = (n) => String(n).padStart(2, '0');
    const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayIso = isoOf(new Date());
    const whenText = (at) => {
      const d = new Date(at);
      if (Number.isNaN(d.getTime())) return [String(at || ''), ''];
      const iso = isoOf(d);
      const ago = Math.round((Date.parse(todayIso + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400000);
      const dayWord = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(iso.slice(0, 4) === todayIso.slice(0, 4) ? {} : { year: 'numeric' }) });
      return [dayWord, d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })];
    };
    const KIND = { note: 'Note', auto: 'Automatic', update: 'Task update', done: 'Task done', stage: 'Stage', try: 'No answer' };
    shown.forEach((e) => {
      const tr = el('tr', `is-${e.kind}`);
      const [d1, d2] = whenText(e.at);
      const tdW = el('td', 'is-when'); tdW.append(el('b', '', d1), el('span', '', d2)); tdW.title = when(e.at);
      const tdK = el('td', 'is-kind'); tdK.append(el('span', `lg-kind is-${e.kind}`, KIND[e.kind] || e.label || ''));
      if (tlLastSeen && String(e.at) > tlLastSeen && e.by !== meName) { tr.classList.add('is-unseen'); tdK.title = 'New since you last opened this student'; }
      const tdT = el('td', 'is-what');
      if (e.ref) tdT.append(el('b', 'lg-ref', e.ref));
      if (e.lead) tdT.append(el('span', 'lg-lead', e.lead));
      if (e.text) { const p2 = el('p', 'lg-text'); if (e.tag) p2.append(el('span', `td-tag tag-${e.tag}`, window.Portal.tagLabel(e.tag)), ' '); p2.append(...linked(e.text)); tdT.append(p2); }
      const tdB = el('td', 'is-by', e.kind === 'auto' ? 'ISR' : e.by || 'Someone');
      const tdM = el('td', 'is-more');
      const items = [];
      if (e.message && e.message.channel === 'email') items.push(['Read the email', () => readMessage(e.message)]);
      const mayReopen = e.task && !data.can.readOnly && (data.can.removeAnyTask || (data.can.myTeams || []).includes(e.task.team) || (e.task.team === 'head' && (data.me || {}).role === 'admin'));
      if (mayReopen) items.push(['Reopen the task', async () => {
        const how = await window.Portal.reopenDialog(e.task);
        if (!how) return;
        const r = await save(`tasks/${e.task.id}`, { done: false, finish: how }, 'Reopened');
        if (r && r.undone && r.undone.length) say(`Reopened. Put back: ${r.undone.join('; ')}${r.left && r.left.length ? `. ${r.left.join('; ')}` : ''}`);
        data = await api('/api/cards/' + encodeURIComponent(id)); render();
      }]);
      const n = e.note;
      if (n && can() && (n.by === meName || data.can.removeAnyNote)) items.push(['Remove the note', async () => { if (await window.NiecUI.confirm('Remove this note?', { danger: true })) { await save('notes/' + n.id + '/delete', {}, 'Note removed'); render(); } }, true]);
      if (items.length) moreMenu(tdM, items);
      tr.append(tdW, tdK, tdT, tdB, tdM);
      tb.append(tr);
    });
    if (remark && (historyFilter === 'all' || historyFilter === 'note')) {
      const tr = el('tr', 'is-auto');
      const tdW = el('td', 'is-when'); tdW.append(el('b', '', 'Earlier'));
      const tdK = el('td', 'is-kind'); tdK.append(el('span', 'lg-kind is-auto', 'Remark'));
      const tdT = el('td', 'is-what'); tdT.append(el('p', 'lg-text', remark));
      tr.append(tdW, tdK, tdT, el('td', 'is-by', 'All Students'), el('td', 'is-more'));
      tb.append(tr);
    }
    if (!tb.children.length) { const tr = el('tr'); const td = el('td', 'lg-empty', 'No history yet. Notes, tasks and messages about this student will show here.'); td.colSpan = 5; tr.append(td); tb.append(tr); }
    table.append(tb);
    wrap.append(table);
    return wrap;
  }

  // ---- University options ----
  // The shortlist (the owner, 17 Nov 2026): the courses shortlisted from Universities or added here, numbered 1, 2, 3 in the order to
  // apply. Nothing is typed: the fee, scholarship, deposit and course page come from Universities by themselves. "Share options" (emails these
  // options, a short word so the row stays tidy) and "Assign to the Application Team" open the same windows as on Universities (fact-finder.js): the second asks, for every course,
  // through which partner it goes, and for notes. Up and Down change the order before assigning.
  const refreshCard = async () => { data = await api('/api/cards/' + encodeURIComponent(id)); render(); };
  let sendOrder = null; // option ids not yet sent, in the order chosen on this page
  const studentRef = () => ({ id, name: (data.student && data.student.name) || 'the student', email: (data.student && data.student.row && data.student.row.EMAIL) || '' });
  // Applied to and offers, from Applications, or All Students' own days for a student recorded before (one application).
  function appStats() {
    const o = data.card.options;
    const row = data.student.row || {};
    let submitted = o.filter((x) => x.applied).length; let offers = o.filter((x) => x.offer).length;
    if (!submitted && String(row['APPLICATION SUBMISSION DATE'] || '').trim()) submitted = 1;
    if (!offers && String(row['OFFER RECEIVED DATE'] || '').trim()) offers = 1;
    return { submitted, offers };
  }
  function waitingOptions() {
    const waiting = data.card.options.filter(F.onShortlist);
    const ids = waiting.map((o) => o.id);
    sendOrder = (sendOrder || []).filter((x) => ids.includes(x));
    ids.forEach((x) => { if (!sendOrder.includes(x)) sendOrder.push(x); });
    return sendOrder.map((x) => waiting.find((o) => o.id === x));
  }
  // One shortlisted or applied course: its name, university, partner and what Universities says.
  function optionItem(o, waiting) {
    const item = el('li', 'p-chosen-item');
    const i = waiting.indexOf(o);
    // The university first, the course under it (the owner, 17 Nov 2026: long course names looked packed). An application shows the
    // university's initials in its round badge; the shortlist keeps 1, 2, 3, the order to apply.
    item.dataset.mono = String(o.university || '').replace(/\b(of|the|and|for|at|in)\b/gi, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    if (i < 0 && isGoingAhead(o)) item.classList.add('is-priority');
    const header = el('header');
    const title = el('div', 'p-chosen-title');
    title.append(el('h3', '', o.university || o.course));
    const courseLine = [o.university ? o.course : '', o.intake, o.level].filter(Boolean).join(' · ');
    if (courseLine) title.append(el('p', 'p-chosen-course', courseLine));
    header.append(title);
    const tools = el('div', 'p-chosen-tools');
    if (can() && i >= 0 && waiting.length > 1) {
      const move = (d) => () => { const j = i + d; if (j < 0 || j >= sendOrder.length) return; [sendOrder[i], sendOrder[j]] = [sendOrder[j], sendOrder[i]]; render(); };
      tools.append(h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'), h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move down', disabled: i === waiting.length - 1, onclick: move(1) }, '↓'));
    }
    // Taken off the shortlist right here (the owner, 17 Nov 2026: no going back to Universities), until an application is recorded.
    const answered = o.applied || o.offer || o.refused || o.withdrawn || o.skipped;
    // A course already given to the team is answered, not removed; only Admin may still take it off (as the server allows).
    if (can() && o.id && !answered && (!o.sent || (data.me || {}).role === 'admin')) {
      tools.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        if (o.sent && !(await window.NiecUI.confirm(`Take ${o.university}${o.course ? ` (${o.course})` : ''} off? It was given to the Application Team on ${day(o.sent)}; tell them too.`, { danger: true, confirmText: 'Take it off' }))) return;
        try { await save('options/' + o.id + '/delete', {}, 'Taken off the shortlist'); render(); } catch (e) { /* the message is shown */ }
      } }, 'Remove from shortlist'));
    }
    if (can() && i < 0) tools.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => updateApplication(o) }, answered ? 'Update' : 'Record submission'));
    header.append(tools);
    item.append(header);
    const sub = el('div', 'p-chosen-sub');
    // The priority university (the one the student goes ahead with, named on All Students): its tag first, chosen above the list.
    if (i < 0 && isGoingAhead(o)) sub.append(el('span', 'p-applied is-priority', 'Priority'));
    if (o.fromSheet) sub.append(el('span', 'p-chosen-partner', 'On All Students'));
    // The partner by its name only (the owner, 21 Nov 2026): "Adventus", "Route2Uni", or the university itself when sent direct; never
    // "Direct" or "B2B".
    if (o.partner) { const pn = el('span', 'p-chosen-partner'); pn.append(el('small', '', 'Partner '), /^direct$/i.test(o.partner) ? (o.university || 'the university') : o.partner); sub.append(pn); }
    if (o.sent && !o.applied) sub.append(el('span', 'p-applied is-sent', `With the Application Team since ${day(o.sent)}, not submitted yet`));
    if (o.applied) sub.append(el('span', 'p-applied', `Submitted ${day(o.applied)}`));
    if (o.offer) sub.append(el('span', 'p-applied is-offer', `${o.offerType ? o.offerType + ' offer' : 'Offer'} ${day(o.offer)}`));
    if (o.refused) sub.append(el('span', 'p-applied is-refused', `Refused ${day(o.refused)}`));
    if (o.withdrawn) sub.append(el('span', 'p-applied is-refused', `Withdrawn ${day(o.withdrawn)}`));
    if (o.skipped) sub.append(el('span', 'p-applied is-refused', `Not submitted (${day(o.skipped)})`));
    if (o.applied && !o.offer && !o.refused && !o.withdrawn) sub.append(el('span', 'p-applied is-sent', 'Waiting for the answer'));
    if (sub.children.length) item.append(sub);
    if (o.reason && (o.refused || o.withdrawn || o.skipped)) item.append(el('p', 'p-muted p-small', `Reason: ${o.reason}`));
    // What Universities says, read only (the owner, 17 Nov 2026: "I don't want to fill any details").
    const facts = el('dl', 'p-chosen-facts');
    [['Tuition fee', o.fee], ['Scholarship', o.scholarship], ['Deposit', o.deposit]].forEach(([k, v]) => { if (v) { const d = el('div'); d.append(el('dt', '', k), el('dd', '', v)); facts.append(d); } });
    if (o.link) { const d = el('div'); const a = el('a', '', 'Course page'); a.href = o.link; a.target = '_blank'; a.rel = 'noopener'; const dd = el('dd'); dd.append(a); d.append(el('dt', '', 'Link'), dd); facts.append(d); }
    if (facts.children.length) item.append(facts);
    if (!o.link && can() && o.universityId) {
      // No link yet: the server looks the course page up and keeps it.
      window.SendToStudent.lookupLink(o).then(async (found) => {
        if (!found) return;
        try { await save('options/' + o.id, { link: found }); o.link = found; } catch (e) { /* shown */ }
      });
    }
    return item;
  }

  // The Application Team records each application here (the owner, 17 Nov 2026): the day it was submitted, then the answer (an offer
  // with its day, or refused or withdrawn with the reason). The same days an Application task records when it is marked done.
  // A course given to the team but not submitted (not eligible ...) is marked Not submitted, with the reason. Each change is also a
  // line in the Timeline, and the first submission and first offer are kept in All Students' own (hidden) columns by the server.
  const RESULTS = [['', 'Waiting for the answer'], ['offer', 'Offer (type not known)'], ['Conditional', 'Conditional offer'], ['Unconditional', 'Unconditional offer'], ['refused', 'Refused'], ['withdrawn', 'Withdrawn'], ['skipped', 'Not submitted (for example not eligible)']];
  const WITH_REASON = ['refused', 'withdrawn', 'skipped'];
  async function updateApplication(o, { offer: forOffer } = {}) {
    const wasSheet = Boolean(o.fromSheet);
    if (o.fromSheet) {
      // Kept in University options first (with the days All Students has), then updated like any other.
      const r = await save('options', { university: o.university, course: o.course, applied: o.applied, offer: o.offer });
      o = (r && r.option) || data.card.options.find((x) => x.university === o.university);
      if (!o) return;
    }
    const todayIso = data.today || new Date().toISOString().slice(0, 10);
    const saved = await dialog(`${o.university}${o.course ? ': ' + o.course : ''}`, (body, close) => {
      const form = el('div', 'p-form');
      // The university and the course can be corrected here too (a wrong name, or a course changed), not only the answer.
      const uniF = field('University', { value: o.university || '', max: 160, required: true, wide: true });
      const courseF = field('Course', { value: o.course || '', max: 240, wide: true });
      const applied = field('Application submitted on', { kind: 'date', value: o.applied || '' });
      const now = o.skipped ? 'skipped' : o.refused ? 'refused' : o.withdrawn ? 'withdrawn' : o.offer ? (o.offerType || 'offer') : '';
      const result = field('Answer from the university', { kind: 'select', choices: RESULTS, value: now, wide: true });
      const when2 = field('Day of the answer', { kind: 'date', value: o.skipped || o.refused || o.withdrawn || o.offer || '' });
      const reason = field('Reason', { wide: true, max: 300, value: o.reason || '', placeholder: 'e.g. Grades below the entry requirement, course full' });
      [applied, when2].forEach((f) => { f.input.max = todayIso; });
      const show = () => { const r = result.input.value; when2.wrap.hidden = !r; reason.wrap.hidden = !WITH_REASON.includes(r); applied.wrap.hidden = r === 'skipped'; when2.wrap.querySelector('.p-label').textContent = r === 'skipped' ? 'Decided on' : 'Day of the answer'; };
      // Opened from Next step "Record offer": the answer is set to an offer, and the day is next.
      if (forOffer && !now) { result.input.value = 'offer'; setTimeout(() => when2.input.focus(), 50); }
      result.input.addEventListener('change', show);
      show();
      form.append(uniF.wrap, courseF.wrap, result.wrap, applied.wrap, when2.wrap, reason.wrap);
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        const r = result.input.value; const d = when2.input.value; const a = applied.input.value;
        const fail = (t) => { msg.textContent = t; msg.className = 'p-msg error'; };
        if (r && !a && !['withdrawn', 'skipped'].includes(r)) return fail('Fill in the day the application was submitted.');
        if (r && !d) return fail('Fill in the day of the answer.');
        if (a && d && d < a) return fail('The answer cannot come before the application was submitted.');
        if (!uniF.input.value.trim()) return fail('Write the university.');
        if (WITH_REASON.includes(r) && reason.input.value.trim().length < 8) return fail('Write the reason in a few words (at least 8 letters), for example: grades below the entry requirement.');
        ok.disabled = true;
        const offer = ['offer', 'Conditional', 'Unconditional'].includes(r);
        try {
          await save('options/' + o.id, { university: uniF.input.value.trim(), course: courseF.input.value.trim(), applied: r === 'skipped' ? '' : a, offer: offer ? d : '', offerType: offer && r !== 'offer' ? r : '', refused: r === 'refused' ? d : '', withdrawn: r === 'withdrawn' ? d : '', skipped: r === 'skipped' ? d : '', reason: WITH_REASON.includes(r) ? reason.input.value.trim() : '' }, 'Saved');
          // The application All Students names: a corrected university or course is corrected there too, so it does not appear twice.
          if (wasSheet && data.can.edit && (uniF.input.value.trim() !== o.university || courseF.input.value.trim() !== (o.course || ''))) {
            try { await save('sheet', { fields: { 'UNIVERSITY NAME': uniF.input.value.trim(), 'COURSE NAME': courseF.input.value.trim() } }); } catch (e) { /* shown by save */ }
          }
          close({ a, offer: offer ? d : '' });
        } catch (e) { fail(e.message); ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      body.append(form, msg, foot);
    });
    // All Students' own two columns follow by themselves on the server (the first application and the first offer).
    if (saved) refreshCard();
  }

  // The application the student goes ahead with: the one whose university (and course) All Students names.
  const squashName = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function isGoingAhead(o) {
    const row = data.student.row || {};
    const u = squashName(row['UNIVERSITY NAME']); const c = squashName(row['COURSE NAME']);
    return Boolean(u) && squashName(o.university) === u && (!c || !o.course || squashName(o.course) === c);
  }
  // The applications still going (not refused, withdrawn or left unsubmitted), and how one is named.
  const liveApps = () => data.card.options.filter((o) => o.id && (o.sent || o.applied || o.offer) && !o.refused && !o.withdrawn && !o.skipped);
  const appName = (o) => [o.university, o.course].filter(Boolean).join(', ');
  async function goAhead(o) {
    try {
      const row0 = data.student.row || {};
      const was = { sheet: { 'UNIVERSITY NAME': row0['UNIVERSITY NAME'] || '', 'COURSE NAME': row0['COURSE NAME'] || '' } };
      const now2 = { sheet: { 'UNIVERSITY NAME': o.university || '', 'COURSE NAME': o.course || '' } };
      tookOver(was, await api(`/api/cards/${id}/sheet`, { fields: now2.sheet }));
      savedWithUndo(`Priority: ${o.university}. All Students is updated.`, was, now2);
      refreshCard();
    } catch (e) { say(e.message, true); }
  }

  function chosenOptions() {
    const box = el('section', 'p-card');
    const head = el('div', 'p-card-head');
    const waiting = waitingOptions();
    { const t = el('h2', '', 'Shortlist'); t.append(el('span', 'sc-tl-count', String(waiting.length))); head.append(t); }
    const acts = el('div', 'p-card-acts');
    // Straight to Universities with this student already chosen, so the team shortlists without searching for the student again.
    // target _top: from the half card (an iframe on All Students) Universities opens as the whole page, not inside the card.
    if (can()) acts.append(h('a', { class: 'btn btn-sm', href: '/fact-file?for=' + encodeURIComponent(id), target: '_top' }, 'Find course'));
    // Share options: only for those who may change the student, and only the options still open (never a refused, withdrawn or not
    // submitted university under "the options we have shortlisted for you").
    const openOpts = data.card.options.filter((o) => !o.refused && !o.withdrawn && !o.skipped);
    if (can() && openOpts.length) {
      acts.append(h('button', { class: 'btn btn-sm', type: 'button', title: 'Email these options to the student', onclick: () => window.OptionActions.email(studentRef(), waiting.length ? waiting : openOpts).then((r) => { if (r) refreshCard(); }) }, 'Share options'));
      if (waiting.length && can()) acts.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.OptionActions.assign(studentRef(), waitingOptions()).then((r) => { if (r) { sendOrder = null; refreshCard(); } }) }, 'Assign to the Application Team'));
    }
    if (acts.children.length) head.append(acts);
    box.append(head);
    if (!waiting.length) box.append(el('p', 'p-muted', can() ? 'No course waiting to be assigned. Press "Find course" to open Universities with this student chosen.' : 'No course waiting to be assigned.'));
    else { const list = el('ol', 'p-chosen'); waiting.forEach((o) => list.append(optionItem(o, waiting))); box.append(list); }
    return box;
  }

  // Applications (the owner, 17 Nov 2026): every university the student was assigned to or applied to, with the course, the day it
  // was submitted and the answer, so one look shows where the student has applied and holds an offer. A student can apply to many.
  function applicationsList() {
    const apps = data.card.options.filter((o) => o.sent || o.applied || o.offer || o.refused || o.withdrawn || o.skipped);
    // The application on All Students (its university, course and days) when University options does not have it yet: shown too, and
    // its Update keeps it in University options from then on.
    const row = data.student.row || {};
    const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sheetUni = String(row['UNIVERSITY NAME'] || '').trim();
    const iso = (v) => { const t = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; }; // month first, as the sheet keeps it (dashboard-stats.js isoDate)
    if (sheetUni && !data.card.options.some((o) => squash(o.university) === squash(sheetUni))) {
      const applied = iso(row['APPLICATION SUBMISSION DATE']); const offer = iso(row['OFFER RECEIVED DATE']);
      if (applied || offer) apps.unshift({ id: '', fromSheet: true, university: sheetUni, course: String(row['COURSE NAME'] || '').trim(), applied, offer });
    }
    const box = el('section', 'p-card');
    const offers = apps.filter((o) => o.offer).length;
    const submitted = apps.filter((o) => o.applied).length;
    { const t = el('h2', '', 'Universities applied to'); t.append(el('span', 'sc-tl-count', String(apps.length))); box.append(t); }
    if (!apps.length) { box.append(el('p', 'p-muted', 'Nothing assigned yet. Find courses above and press "Assign to the Application Team".')); return box; }
    const waitingTeam = apps.filter((o) => o.sent && !o.applied && !o.skipped && !o.withdrawn).length;
    box.append(el('p', 'p-apps-summary', [`${submitted} submitted`, `${offers} ${offers === 1 ? 'offer' : 'offers'}`, waitingTeam ? `${waitingTeam} with the Application Team` : ''].filter(Boolean).join(' · ')));
    // The priority university (the owner, 17 Nov 2026): chosen here from the applications; it writes the university and course
    // on All Students by itself, and can be changed at any time.
    const live = liveApps();
    if (can() && live.length) {
      const cur = live.find(isGoingAhead);
      // One quiet row: the words on the left, the choice on the right (long names end in "..." instead of crowding the row).
      const row = el('label', 'p-priority');
      const words = el('span', 'p-priority-text');
      words.append(el('b', '', 'Priority University')); // it still writes the university and course on All Students, without saying so (the owner, 21 Nov 2026)
      const sel = document.createElement('select');
      sel.className = 'p-priority-select';
      [...(cur ? [] : [['', 'Choose one']]), ...live.map((o) => [o.id, appName(o)])].forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; sel.append(op); });
      sel.value = cur ? cur.id : '';
      if (cur) sel.title = appName(cur);
      sel.addEventListener('change', () => { const o = live.find((x) => x.id === sel.value); if (o) goAhead(o); });
      row.append(words, sel);
      box.append(row);
    }
    const order = (o) => (isGoingAhead(o) ? -1 : o.offer ? 0 : o.applied && !o.refused && !o.withdrawn ? 1 : o.sent && !o.applied && !o.skipped ? 2 : 3);
    const list = el('ol', 'p-chosen is-apps');
    apps.slice().sort((a, b) => order(a) - order(b) || Number(a.rank || 99) - Number(b.rank || 99)).forEach((o) => list.append(optionItem(o, [])));
    box.append(list);
    return box;
  }
  // University options (the owner, 17 Nov 2026): the Shortlist (courses waiting to be assigned, with Find course, which opens the
  // whole university page with this student chosen, and Assign to the Application Team), then Applications: every university assigned
  // or applied to, with the course, the day it was submitted and the answer (offer, refused or withdrawn with the reason).
  function optionsTab() {
    const wrap = el('div', 'p-apps');
    wrap.append(chosenOptions(), applicationsList());
    return wrap;
  }

  async function readMessage(m) {
    try {
      const r = await api(`/api/cards/${id}/messages/${m.id}`);
      dialog(m.subject || m.template, (body, close) => {
        body.append(el('p', 'p-muted p-small', `To ${m.to || ''}, ${when(m.at)}, by ${m.by}`), el('pre', 'p-wa-preview', r.text || '(the words were not kept)'), el('div', 'p-dialog-foot'));
        body.lastChild.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'));
      }, { wide: true });
    } catch (e) { say(e.message, true); }
  }

  function select(name) {
    const sec = view.querySelector('.' + (SECTIONS[name] || SECTIONS.details));
    if (sec) sec.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', location.pathname + location.search + '#' + name);
  }

  // Details that do not add up (the owner, 16 Nov 2026), right under the student's name: each says what is wrong. Correct it with
  // Edit above (or the sheet), or press "It is correct" once checked, and it leaves the list (and Today's "Details to check").
  function checksBox() {
    const box = el('section', 'sc-checks');
    const head = el('div', 'sc-checks-head');
    const ic = el('span', 'sc-checks-ico'); ic.append(icon('alert'));
    const t = el('h2', '', 'Details to check');
    t.append(el('span', 'sc-checks-count', String(data.checks.length)));
    head.append(ic, t);
    const list = el('ul');
    data.checks.forEach((c) => {
      const li = el('li');
      li.append(el('span', 'sc-checks-text', c.text));
      if (can()) {
        const b = h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          try {
            await morph(b, () => save('checks', { key: c.key }), { busy: 'Saving…', done: 'Checked' });
            li.classList.add('is-leaving');
            await new Promise((r) => setTimeout(r, calm() ? 0 : 380));
            data = await api('/api/cards/' + encodeURIComponent(id)); say('Marked as checked'); render();
          } catch (e) { /* shown */ }
        } });
        b.append(icon('check', 'sc-btn-ico'), 'It is correct');
        li.append(b);
      }
      list.append(li);
    });
    box.append(head, list, el('p', 'sc-checks-foot', 'Wrong? Correct it with Edit details above, or on All Students.'));
    return box;
  }
  // ---- fewer clicks (the owner, 17 Nov 2026) ----
  // Working through a list ("Work through them"): "3 of 12" with Previous and Next, and the [ and ] keys, so the next
  // student opens without going back to the list.
  function queue() {
    try {
      const q = JSON.parse(sessionStorage.getItem('isrQueue') || 'null');
      if (!q || !Array.isArray(q.ids)) return null;
      const at = q.ids.indexOf(id);
      return at === -1 ? null : { ...q, at };
    } catch (e) { return null; }
  }
  function queueBar() {
    const q = queue();
    if (!q || embedded) return null;
    const bar = el('nav', 'p-queue');
    bar.setAttribute('aria-label', 'Students in this list');
    const go = (i) => { location.href = '/student?id=' + encodeURIComponent(q.ids[i]); };
    const prev = h('button', { class: 'btn btn-sm', type: 'button', disabled: q.at === 0, onclick: () => go(q.at - 1), title: 'The student before ( [ )' }, '‹ Previous');
    const next = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: q.at === q.ids.length - 1, onclick: () => go(q.at + 1), title: 'The next student ( ] )' }, 'Next ›');
    const where = el('div', 'p-queue-where');
    where.append(el('b', '', `${q.at + 1} of ${q.ids.length}`), el('span', '', q.label || ''));
    bar.append(h('a', { class: 'p-queue-back', href: q.back || '/today' }, 'Back to the list'), where, el('span', 'p-queue-gap'), prev, next);
    if (!queueBar.keys) {
      queueBar.keys = true;
      document.addEventListener('keydown', (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
        const cur = queue(); if (!cur) return;
        if (e.key === ']' && cur.at < cur.ids.length - 1) go(cur.at + 1);
        if (e.key === '[' && cur.at > 0) go(cur.at - 1);
      });
    }
    return bar;
  }
  // One tap to reach the student: call, WhatsApp or email (no Copy number, the owner, 17 Nov 2026), in the main card under the name.
  function contactBar() {
    const s = data.student;
    const wa = F.whatsappNumber(s.phone);
    if (!s.phone && !s.email) return null;
    const bar = el('div', 'sc-reach');
    const btn = (cls, ico, text, attrs) => { const a = h('a', { class: `sc-reach-btn ${cls}`, ...attrs }); const i = el('span', 'sc-reach-ico'); i.append(icon(ico)); a.append(i, el('span', '', text)); return a; };
    // Call rings the student from the person's own phone, as WhatsApp does (phone-link.js); with no phone connected it says how.
    if (s.phone) bar.append(btn('is-call', 'phone', 'Call', { href: 'tel:' + String(s.phone).replace(/[^\d+]/g, ''), onclick: (e) => { if (!window.PhoneLink || !wa) return; e.preventDefault(); window.PhoneLink.call({ id, number: wa, name: s.name }); } }));
    if (wa) bar.append(btn('is-wa', 'whatsapp', 'WhatsApp', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', onclick: (e) => { e.preventDefault(); window.Portal.whatsapp(wa, s.name, '', id); } }));
    if (s.email) bar.append(btn('is-mail', 'mail', 'Email', { href: 'mailto:' + s.email }));
    return bar;
  }
  // The next thing the sheet needs for this student, done right here: one day to pick and Save, or the passport details to add.
  function nextStep() {
    if (!can()) return null;
    const s = data.student;
    const row = s.row || {};
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    const applied = iso(row['APPLICATION SUBMISSION DATE']);
    const pp = profile();
    let step = null;
    if (String(row['LANGUAGE TEST DATE'] || '').trim() === 'Test Date') step = { title: 'Pick the language test day', why: 'The test is chosen as "Test Date", but no day is on the sheet.', col: 'LANGUAGE TEST DATE', label: 'Test date' };
    // The application and the offer are recorded per university, under Applications (the owner, 17 Nov 2026).
    else if (s.stage === 'Application Stage' && !applied && data.card.options.some((o) => o.sent && !o.applied && !o.skipped)) step = { title: 'Record the applications', why: 'When the Application Team submits, record the day for each university.', apps: true, act: 'Record submission', pick: () => { const w = data.card.options.filter((o) => o.sent && !o.applied && !o.skipped); return w.length === 1 ? w[0] : null; } };
    else if (applied && !iso(row['OFFER RECEIVED DATE']) && ['Application Stage', 'Mock Stage'].includes(s.stage)) {
      const waited = Math.max(0, Math.round((Date.parse(data.today || new Date().toISOString().slice(0, 10)) - Date.parse(applied)) / 86400000));
      step = { title: 'Record the offer', why: `First application ${day(applied)}, ${waited} ${waited === 1 ? 'day' : 'days'} ago. When an offer comes, record it on that university.`, apps: true, act: 'Record offer', pick: () => { const w = data.card.options.filter((o) => o.id && o.applied && !o.offer && !o.refused && !o.withdrawn && !o.skipped); return w.length === 1 ? w[0] : null; } };
    } else if (s.stage && !['Inquiry', 'Visa Issued', ...F.LOST_STAGES].includes(s.stage) && (!pp.dob || !pp.passportNo || !pp.address)) {
      const gone = [['date of birth', pp.dob], ['passport number', pp.passportNo], ['address', pp.address]].filter(([, v]) => !v).map(([k]) => k);
      step = { title: 'Add the passport details', why: `Still missing: ${gone.join(', ')}.`, edit: true };
    }
    if (!step) return null;
    const box = el('section', 'sc-next');
    const ic = el('span', 'sc-next-ico'); ic.append(icon('arrow'));
    const words = el('div', 'sc-next-words');
    words.append(el('span', 'sc-eyebrow', 'Next step'), el('b', '', step.title), el('span', 'sc-next-why', step.why));
    const act = el('div', 'sc-next-act');
    // One university to record: the button does it at once; several: it opens Applications to choose.
    const one = step.apps ? step.pick() : null;
    if (one) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => updateApplication(one, { offer: step.act === 'Record offer' }) }, step.act));
    else if (step.apps) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => select('options') }, 'Open Applications'));
    else if (step.edit) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: editProfile }, 'Add them'));
    else {
      const input = h('input', { type: 'date', 'aria-label': step.label });
      input.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      if (step.col === 'LANGUAGE TEST DATE') input.removeAttribute('max'); // a test can be booked ahead
      if (step.min) input.min = step.min;
      const ok = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Save');
      input.addEventListener('change', () => { ok.disabled = !input.value; });
      input.addEventListener('input', () => { ok.disabled = !input.value; });
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try {
          const was = { sheet: { [step.col]: (data.student.row || {})[step.col] || '' } };
          tookOver(was, await api(`/api/cards/${encodeURIComponent(id)}/sheet`, { fields: { [step.col]: input.value } }));
          data = await api('/api/cards/' + encodeURIComponent(id));
          render();
          savedWithUndo(`Saved: ${step.label.toLowerCase()} ${day(input.value)}`, was, { sheet: { [step.col]: input.value } });
        } catch (e) { say(e.message, true); ok.disabled = false; }
      });
      act.append(input, ok);
    }
    box.append(ic, words, act);
    return box;
  }

  // A student recorded before the days were kept per university: All Students' own application and offer days belong to the
  // university named there, so its line under Applications shows them (Update then keeps them on that university).
  function sheetDaysOnOptions() {
    const row = data.student.row || {};
    const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Only for a student recorded before the days were kept per university (no university has its own day yet).
    if (data.card.options.some((x) => x.applied || x.offer)) return;
    const o = data.card.options.find((x) => squash(x.university) && squash(x.university) === squash(row['UNIVERSITY NAME']));
    if (!o) return;
    const iso = (v) => { const t = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; };
    if (!o.applied && !o.skipped && iso(row['APPLICATION SUBMISSION DATE'])) o.applied = iso(row['APPLICATION SUBMISSION DATE']);
    if (!o.offer && !o.refused && iso(row['OFFER RECEIVED DATE'])) o.offer = iso(row['OFFER RECEIVED DATE']);
  }
  function render() {
    sheetDaysOnOptions();
    document.title = `${data.student.name} · Student · ISR`;
    const keepY = window.scrollY;
    const frag = document.createDocumentFragment();
    const q = queueBar(); if (q) frag.append(q);
    frag.append(hero());
    // The Ledger design (the owner, 21 Nov 2026): solid panels and tables, as Route2Uni. The profile and the source on the left;
    // Next step, Applications, the open tasks and the whole Timeline on the right, one under another.
    const layout = el('div', 'sc-layout');
    const main = el('div', 'sc-main');
    { const n = nextStep(); if (n) main.append(n); }
    if ((data.checks || []).length) main.append(checksBox());
    if (!can()) main.append(el('div', 'p-notice', 'View only.'));
    const ap = appStats();
    const apps = box('Applications', 'lg-apps', ap.submitted || ap.offers ? `${ap.submitted} submitted, ${ap.offers} ${ap.offers === 1 ? 'offer' : 'offers'}` : '');
    apps.sec.append(optionsTab());
    main.append(apps.sec);
    const tc = tasksCard();
    if (tc) { tc.classList.add('lg-box', 'lg-tasks'); main.append(tc); }
    main.append(notes());
    layout.append(profileColumn(), main);
    frag.append(layout);
    view.replaceChildren(frag);
    window.scrollTo(0, keepY);
    focusForm();
    interactions();
    if (firstDraw) { firstDraw = false; const want = location.hash.slice(1); if (SECTIONS[want] && want !== 'details') select(want); }
  }

  // Keys for the card (the owner, 20 Nov 2026), when nothing is being typed and no window is open: N a note (above), E Edit details,
  // A Assign a task, 1 and 2 the tabs, ? the list of keys. Ctrl+K (quick search) and the arrow keys (the next student) are kept.
  const KEYS = [['N', 'Write a note'], ['E', 'Edit profile'], ['A', 'Assign a task'], ['1', 'Go to the Timeline'], ['2', 'Go to Applications'], ['← →', 'Previous or next student (from All Students)'], ['Ctrl K', 'Quick search'], ['?', 'These shortcuts']];
  document.addEventListener('keydown', (e) => {
    if (!data || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('dialog[open], .p-dialog') || editingHero || editingOrigin || editingField) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && can()) { e.preventDefault(); editProfile(); }
    else if (k === 'a' && data.can.assign) { e.preventDefault(); assignTask(); }
    else if (k === '1' || k === '2') { e.preventDefault(); select(k === '1' ? 'details' : 'options'); }
    else if (e.key === '?') {
      e.preventDefault();
      dialog('Shortcuts for this card', (body, close) => {
        const list = el('dl', 'sc-keys');
        KEYS.forEach(([key, what]) => { const d = el('div'); const dt = el('dt'); key.split(' ').forEach((x) => dt.append(el('kbd', '', x))); d.append(dt, el('dd', '', what)); list.append(d); });
        const foot = el('div', 'p-dialog-foot');
        foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, 'Got it'));
        body.append(list, foot);
      });
    }
  });

  // An open form inside the card (Edit details, the source): Escape cancels it, as Cancel does (the owner, 20 Nov 2026: one way out
  // everywhere), and the cursor starts in its first box.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !(editingHero || editingOrigin || editingField) || document.querySelector('dialog[open], .p-dialog[open]')) return;
    e.preventDefault(); editingHero = false; editingOrigin = false; editingField = ''; render();
  });
  const focusForm = () => { if (!(editingHero || editingOrigin || editingField)) return; const f = view.querySelector('.sc-source.is-editing select, .sc-source.is-editing input'); if (f && document.activeElement !== f) { f.focus({ preventScroll: true }); if (f.select && f.type !== 'date') f.select(); } };
  // ---- solid, not floating (the owner, 21 Nov 2026: "it should feel like a hard rock, not like flowing in a river") ----
  // Nothing slides or fades in: everything is simply there.
  function interactions() {
    view.querySelectorAll('.sc-tl-item, .sc-tl-list, .p-chosen-item').forEach((x) => x.classList.add('is-seen'));
  }
  async function start() {
    if (!id) { view.replaceChildren(el('div', 'p-card', 'Choose a student from the sheet first.')); return; }
    try {
      const [d, l] = await Promise.all([api('/api/cards/' + encodeURIComponent(id)), api('/api/card-lists')]);
      data = d; lists = l;
      try { noteDraft = localStorage.getItem(draftKey()) || ''; } catch (e) { /* none kept */ }
      render();
    } catch (e) {
      view.replaceChildren(h('div', { class: 'p-card' }, el('h1', 'p-error-title', 'This student cannot be opened'), el('p', '', e.message), h('a', { class: 'btn', href: '/students' }, 'Back to All Students')));
    }
  }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (data && SECTIONS[t]) select(t); });
  start();
})();
