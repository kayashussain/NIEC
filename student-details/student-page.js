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
  let showAllNotes = false;
  let historyFilter = 'all'; // the student's History: everything, the notes only, or the tasks only
  const openNotes = new Set(); // long notes opened with "Read more"
  let justAdded = ''; // the note just added: it fades in with a soft highlight once
  // Named for what they hold (the owner, 17 Nov 2026): Timeline (every step, day by day) and Applications (shortlist and applications).
  const TABS = [['details', 'Timeline'], ['options', 'Applications']];
  let tab = (location.hash || '#details').slice(1);
  const view = document.getElementById('view');
  const say = (text, error) => window.NiecUI.toast(text, { type: error ? 'error' : 'success' });

  if (embedded) {
    document.body.classList.add('p-embed');
    document.getElementById('closeEmbed').addEventListener('click', () => parent.postMessage({ niecCard: 'close' }, location.origin));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editingHero && !editingOrigin && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('dialog[open], .p-dialog')) parent.postMessage({ niecCard: 'close' }, location.origin); });
    // ← and → go to the previous and next student of the list the card was opened from (card-drawer.js), when nothing is being typed.
    document.addEventListener('keydown', (e) => {
      if (editingHero || editingOrigin) return; // a form is open: its words are never lost to a keystroke
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

  // ---- the details of the sheet (name, email, number, university, course, dates): shown, and changed only after pressing Edit ----
  let editingHero = false;
  const HERO_FIELDS = [['FIRST NAME', 'First name'], ['LAST NAME', 'Last name'], ['EMAIL', 'Email'], ['CONTACT NUMBER', 'Contact number'], ['UNIVERSITY NAME', 'University'], ['COURSE NAME', 'Course']];
  // The application and offer days are not here (the owner, 17 Nov 2026): they are kept per university under Applications.
  function heroEdit() {
    const c = el('section', 'p-card');
    c.append(el('h2', '', 'Change the details'));
    c.append(el('p', 'p-muted p-small', 'Changes here also update All Students.'));
    const form = el('div', 'p-form');
    const inputs = {};
    HERO_FIELDS.forEach(([col, label, kind]) => {
      const raw = String(data.student.row[col] || '');
      const iso = kind === 'date' ? (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(raw) ? raw.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m, a, b, y) => `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`) : '')) : raw;
      const f = field(label, { value: iso, kind: kind === 'date' ? 'date' : undefined, max: 240 });
      inputs[col] = f.input;
      form.append(f.wrap);
    });
    // And from the passport, kept on the card.
    const pp = profile();
    const dob = field('Date of birth', { kind: 'date', value: pp.dob });
    dob.input.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); // never in the future; the calendar's years then end this year
    const passNo = field('Passport number', { value: pp.passportNo, max: 20 });
    const address = field('Address (as in the passport)', { value: pp.address, max: 200 });
    const nation = field('Nationality', { kind: 'select', choices: F.NATIONALITIES, value: pp.nationality || 'Nepali' });
    form.append(dob.wrap, passNo.wrap, address.wrap, nation.wrap);
    const bar = el('div', 'p-bar');
    const msg = el('div', 'p-msg');
    // What was in each box when it opened: only the boxes that were changed are saved, so a detail someone else fixed in the
    // meantime (on the sheet or another card) is never put back to the old one.
    const started = { dob: dob.input.value, passportNo: passNo.input.value, address: address.input.value, nationality: nation.input.value };
    const startedSheet = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const save = async () => {
      try {
        const nowProfile = { dob: dob.input.value, passportNo: passNo.input.value.trim().toUpperCase(), address: address.input.value.trim(), nationality: nation.input.value };
        const tidy = (k, v) => (k === 'passportNo' ? String(v).trim().toUpperCase() : String(v).trim());
        const profileChanged = Object.fromEntries(Object.entries(nowProfile).filter(([k, v]) => v !== tidy(k, started[k])));
        if (Object.keys(profileChanged).length) await api(`/api/cards/${id}/profile`, profileChanged);
        const sheetChanged = Object.fromEntries(Object.entries(inputs).filter(([k, i]) => i.value !== startedSheet[k]).map(([k, i]) => [k, i.value]));
        if (Object.keys(sheetChanged).length) await api(`/api/cards/${id}/sheet`, { fields: sheetChanged });
        data = await api('/api/cards/' + encodeURIComponent(id));
        editingHero = false; say('Saved on the sheet'); render();
      } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; shake(msg); throw e; }
    };
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => morph(saveBtn, save).catch(() => {}) }, 'Save');
    bar.append(saveBtn, h('button', { class: 'btn', type: 'button', onclick: () => { editingHero = false; render(); } }, 'Cancel'));
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveBtn.click(); } });
    c.append(form, bar, msg);
    return c;
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
      const out = await work();
      btn.classList.remove('is-busy'); btn.classList.add('is-done');
      btn.replaceChildren(icon('check', 'sc-btn-ico sc-tick'), done);
      await new Promise((r) => setTimeout(r, calm() ? 0 : 650));
      return out;
    } catch (e) {
      btn.classList.remove('is-busy'); btn.disabled = false; btn.replaceChildren(...was); shake(btn);
      throw e;
    }
  }
  // Confetti for a milestone (an offer, a visa): soft coloured pieces fall from the top for a moment; only transform and opacity move.
  /* 🔴 CSS CHANGED (2026-11-20): confetti styles set here | from: none | to: each piece placed at random across the top, coloured, with its own drift, spin, delay and fall time */
  function confetti() {
    if (calm()) return;
    const box = el('div', 'sc-confetti');
    box.setAttribute('aria-hidden', 'true');
    const colours = ['#0071e3', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#ffd60a'];
    for (let i = 0; i < 90; i += 1) {
      const d = el('i');
      d.style.left = `${Math.random() * 100}%`;
      d.style.background = colours[i % colours.length];
      d.style.setProperty('--x', `${(Math.random() - 0.5) * 220}px`);
      d.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
      d.style.animationDelay = `${Math.random() * 0.5}s`;
      d.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
      if (i % 3 === 0) d.style.borderRadius = '50%';
      box.append(d);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 4000);
  }
  // A light that follows the mouse over the tiles, buttons and the main card.
  /* 🔴 CSS CHANGED (2026-11-20): --mx and --my set here | from: none | to: the mouse position inside the tile, read by the soft light in theme.css */
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.sc-fact, .sc-reach-btn, .sc-hero, .sc-tl-body, .sc-source');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
  let intro = true; // the first drawing of the card: its parts arrive one after another; later redraws do not replay it
  const icon = (name, cls) => { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('aria-hidden', 'true'); if (cls) sv.setAttribute('class', cls); sv.innerHTML = ICONS[name] || ''; return sv; };

  // ---- where the student is on the way from first inquiry to visa: eight named steps under the name ----
  // Done steps are a blue dot with a tick, the step the student is at has a soft ring, the rest are grey (the owner, 20 Nov 2026).
  const JOURNEY = [['Inquiry', 'Inquiry'], ['Application Stage', 'Application'], ['Mock Stage', 'Mock interview'], ['Payment Stage', 'Payment'],
    ['CAS Stage', 'CAS requested'], ['CAS Issued', 'CAS issued'], ['Visa Lodge', 'Visa lodged'], ['Visa Issued', 'Visa issued']];
  function journey(stage) {
    const box = el('div', 'sc-steps-box');
    const at = JOURNEY.findIndex(([name]) => name === stage);
    const lost = F.LOST_STAGES.includes(stage);
    const head = el('div', 'sc-steps-head');
    if (at !== -1) head.append(el('span', 'sc-eyebrow', 'Progress'), el('span', 'sc-steps-now', `Step ${at + 1} of ${JOURNEY.length}: `), el('b', '', JOURNEY[at][1]));
    else if (lost) { box.classList.add('is-lost'); head.append(el('span', 'sc-eyebrow', 'Progress'), el('b', '', `Not moving at the moment: ${stage}`)); }
    else head.append(el('span', 'sc-eyebrow', 'Progress'), el('b', '', stage ? `Stage: ${stage}` : 'No stage yet'));
    const ol = el('ol', 'sc-steps');
    /* 🔴 CSS CHANGED (2026-11-20): --sc-done set here | from: none | to: how far the blue progress line reaches (0 to 1) */
    ol.style.setProperty('--sc-done', at <= 0 ? '0' : String(at / (JOURNEY.length - 1)));
    JOURNEY.forEach(([, label], i) => {
      const li = el('li', at === -1 ? '' : i < at ? 'is-done' : i === at ? 'is-now' : '');
      const dot = el('span', 'sc-step-dot');
      if (at !== -1 && i < at) dot.append(icon('check'));
      li.append(dot, el('span', 'sc-step-label', label));
      li.title = label;
      if (i === at) li.setAttribute('aria-current', 'step');
      /* 🔴 CSS CHANGED (2026-11-20): --i set here | from: none | to: the step's number, so the dots light up one after another */
      li.style.setProperty('--i', String(i));
      ol.append(li);
    });
    box.append(head, ol);
    return box;
  }

  // ---- the top: who the student is, how to reach them, where they are, and where they came from ----
  function hero() {
    const s = data.student;
    if (editingHero) return heroEdit();
    const pp = profile();
    const kind = window.Portal.stageKind(s.stage);
    const c = el('section', `sc-hero is-${kind}${intro ? ' is-intro' : ''}`);
    const head = el('div', 'sc-head');
    const av = el('div', 'sc-avatar', initials(s.name));
    av.setAttribute('aria-hidden', 'true');
    const who = el('div', 'sc-id');
    // A long name (SANJIP KUMAR MAHTO Mahato) wraps; the buttons move under it, they never sit on top of each other (the owner, 15 Nov 2026).
    const name = el('h1', 'sc-name', s.name);
    name.title = s.name;
    const meta = el('div', 'sc-meta');
    meta.append(stagePill(s.stage));
    if (s.intake) { const ch = el('span', 'sc-chip'); ch.append(icon('calendar'), s.intake); meta.append(ch); }
    if (pp.nationality && pp.nationality !== 'Nepali') { const ch = el('span', 'sc-chip'); ch.append(icon('globe'), pp.nationality); meta.append(ch); }
    // A milestone the team can see at a glance: the student holds an offer.
    if (appStats().offers) { const ch = el('span', 'sc-chip is-offer'); ch.append(icon('star'), appStats().offers > 1 ? `${appStats().offers} offers received` : 'Offer received'); meta.append(ch); }
    who.append(name, meta);
    const reach = contactBar();
    if (reach) who.append(reach);
    const act = el('div', 'sc-actions');
    if (can()) { const b = h('button', { class: 'btn', type: 'button', onclick: () => { editingHero = true; render(); } }); b.append(icon('pencil', 'sc-btn-ico'), 'Edit details'); act.append(b); }
    if (data.can.assign) { const b = h('button', { class: 'btn btn-primary', type: 'button', onclick: assignTask }); b.append(icon('plus', 'sc-btn-ico'), 'Assign a task'); act.append(b); }
    head.append(av, who);
    if (act.childNodes.length) head.append(act);
    c.append(head, journey(s.stage));

    // The details as tiles, in the order the owner asked for (14 Nov 2026): who the student is (email and the passport details), then how
    // to reach them, then the applications. The passport details are always shown: an empty one says "Missing" in orange.
    const facts = el('div', 'sc-facts');
    const tile = (ico, k, v, { href, missing, onClick, wide } = {}) => {
      const t = el(onClick ? 'button' : 'div', `sc-fact${missing ? ' is-missing' : ''}${onClick ? ' is-action' : ''}${wide ? ' is-wide' : ''}`);
      if (onClick) { t.type = 'button'; t.addEventListener('click', onClick); }
      const ic = el('span', 'sc-fact-ico'); ic.append(icon(ico));
      const txt = el('span', 'sc-fact-text');
      txt.append(el('span', 'sc-fact-label', k));
      const val = el('span', 'sc-fact-value');
      if (missing) val.append(el('span', 'p-missing', 'Missing'));
      else if (href) { const a2 = el('a', '', v); a2.href = href; val.append(a2); }
      else val.textContent = v;
      val.title = missing ? '' : v;
      txt.append(val);
      t.append(ic, txt);
      if (onClick) t.append(icon('arrow', 'sc-fact-go'));
      facts.append(t);
      return t;
    };
    if (s.email) tile('mail', 'Email', s.email, { href: 'mailto:' + s.email, wide: s.email.length > 26 });
    if (s.phone) {
      const wa = F.whatsappNumber(s.phone);
      const t = tile('whatsapp', 'WhatsApp', s.phone, { href: wa ? 'https://wa.me/' + wa : '' });
      const a2 = t.querySelector('a');
      if (a2) a2.addEventListener('click', (e) => { e.preventDefault(); window.Portal.whatsapp(wa, s.name, '', id); });
    }
    // The date only, no age beside it (the owner, 15 Nov 2026): the Dashboard groups the students by age.
    tile('cake', 'Date of birth', pp.dob ? day(pp.dob) : '', { missing: !pp.dob });
    tile('passport', 'Passport number', pp.passportNo, { missing: !pp.passportNo });
    tile('pin', 'Address (passport)', pp.address, { missing: !pp.address });
    // How many universities were applied to and how many offers, from Applications (one student applies to many); a press opens them.
    {
      const ap = appStats();
      const t = tile('cap', 'Applications', 'None yet', { onClick: () => select('options') });
      t.setAttribute('aria-label', `Applications: ${ap.submitted} submitted, ${ap.offers} ${ap.offers === 1 ? 'offer' : 'offers'}. Open Applications`);
      // The two numbers count up when the card opens (ui.js, the one count-up of ISR).
      if (ap.submitted || ap.offers) t.querySelector('.sc-fact-value').replaceChildren(el('b', 'sc-num', String(ap.submitted)), ' submitted · ', el('b', 'sc-num', String(ap.offers)), ` ${ap.offers === 1 ? 'offer' : 'offers'}`);
    }
    /* 🔴 CSS CHANGED (2026-11-20): --i set here | from: none | to: each tile's number, so the tiles cascade in */
    [...facts.children].forEach((t, i) => t.style.setProperty('--i', String(i)));
    c.append(facts);
    // What is still missing, named in one line with one button that opens the form (the owner, 17 Nov 2026: less work for the team).
    const gaps = [['Date of birth', pp.dob], ['Passport number', pp.passportNo], ['Address', pp.address]].filter(([, v]) => !v).map(([k]) => k);
    if (gaps.length && can()) {
      const bar = el('div', 'sc-gaps');
      const ic = el('span', 'sc-gaps-ico'); ic.append(icon('alert'));
      bar.append(ic, el('span', 'sc-gaps-text', `${gaps.length === 1 ? '1 detail' : `${gaps.length} details`} missing: ${gaps.join(', ')}`),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { editingHero = true; render(); } }, gaps.length === 1 ? 'Fill it in' : 'Fill them in'));
      c.append(bar);
    }
    // Where the student came from, inside the main card (the owner, 20 Nov 2026: not a separate panel under the tabs).
    c.append(origin());
    return c;
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
        const stop = (t) => { msg.textContent = t; msg.className = 'p-msg error'; shake(msg); };
        if (!team.input.value) return stop('Choose who should do it.');
        if (!tag.value()) return stop('Choose what it is about.');
        let payload;
        if (isApp()) {
          const need = [[uni, 'the university'], [intake, 'the intake'], [level, 'the course level'], ...(place.wrap.hidden ? [] : [[place, 'the location']]), [course, 'the course']].find(([f]) => !f.input.value);
          if (need) return stop(`Choose ${need[1]}.`);
          const uName = (unis.find((u) => u.id === uni.input.value) || {}).name || '';
          const loc = place.input.value || (choices && choices.campuses.length === 1 ? choices.campuses[0] : '');
          const app = { university: uName, universityId: uni.input.value, intake: intake.input.value, level: level.input.value, location: loc, course: course.input.value };
          const line = [uName, app.intake, app.level, loc, app.course].filter(Boolean).join(' · ');
          payload = { team: team.input.value, tag: 'application', app, text: `Submit the application: ${line}${comments.input.value.trim() ? `\n${comments.input.value.trim()}` : ''}` };
        } else {
          const words = text.input.value.trim();
          if (!words && tag.value() === 'other') return stop('Write what should be done.');
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
        canWrite: !data.can.readOnly && (mine || t.by === me || had), mayTick: mine, canChange: !data.can.readOnly && (mine || t.by === me),
        student: null, fromName: t.by === me ? 'You' : t.by || 'Someone', toName: forMe && t.team === 'head' ? 'you' : label(t.team),
        actions: [
          // Reassign (the team it is with, whoever gave it, Admin and the Manager) and Remove.
          !t.done && !data.can.readOnly && (mine || t.by === me) && [t.doOn && t.doOn > data.today ? 'Change the day' : 'Move to another day', async () => { if (await window.Portal.scheduleTask(t, { rowId: id, today: data.today })) { say('Moved. It waits under Upcoming on Today.'); reload(); } }],
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

  // The Timeline tab (the owner, 17 Nov 2026: calm and professional, as Apple would make it): one column across the whole width, so
  // the tasks and the notes have room. Where the student came from is in the main card above (the owner, 20 Nov 2026). There is no
  // box for why a student did not go on: it is explained in a note.
  function details() {
    const page = el('div', 'sc-tl-page');
    const tc = tasksCard();
    if (tc) page.append(tc);
    page.append(notes());
    return page;
  }

  // ---- Where the student came from: part of the main card, shown as text and changed only after pressing Edit ----
  // A student's source is asked when the student is added (it is required there), so the card no longer asks for it in a window when
  // it opens (the owner, 20 Nov 2026). An older student without one shows "Not recorded yet" here, with Add source.
  let editingOrigin = false;
  const SOURCE_ICON = { Branch: 'pin', Agent: 'globe', Events: 'calendar', 'Social Media': 'whatsapp', 'Language Classes': 'cap', Reference: 'compass', Visitor: 'pin' };
  function origin() {
    const p = profile();
    const s = data.student;
    const g = F.sourceGroup(s.source);
    const box = el('div', `sc-source${g ? '' : ' is-missing'}${editingOrigin ? ' is-editing' : ''}`);
    const ico = el('span', 'sc-source-ico');
    ico.append(icon(g ? SOURCE_ICON[g] || 'compass' : 'alert'));
    const words = el('div', 'sc-source-words');
    words.append(el('span', 'sc-eyebrow', 'Student source'));
    if (!editingOrigin) {
      words.append(el('b', 'sc-source-name', g === 'Branch' ? s.source : g || 'Not recorded yet'));
      // An event or campaign is shown by its name: the date kept beside it in the records is the day the campaign started, not the
      // student's (the owner, 14 Nov 2026). The student's own first inquiry day and time are shown beside it.
      const plain = (v) => String(v || '').replace(/^(Marketing|Event)\s*:\s*/i, '').replace(/,\s*\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}$/, '').trim();
      const rows = el('dl', 'sc-source-rows');
      const fact = (k, v) => { if (!v) return; const d = el('div'); d.append(el('dt', '', k), el('dd', '', v)); rows.append(d); };
      if (g === 'Branch') { /* the branch is named above ("Chitwan Branch") */ } else if (g === 'Social Media' && (p.sourcePlatform || p.sourceWay)) {
        fact('Platform', p.sourcePlatform);
        fact('How they came', p.sourceWay === 'Advert' ? `Advert: ${plain(p.sourceDetail) || 'campaign not named'}` : 'Organic (by itself)');
      } else if (g) fact(F.SOURCE_DETAIL_LABEL[g] || (g === 'Agent' ? 'Which agent' : 'Where exactly'), (g === 'Events' && data.event ? plain(data.event.name) : plain(p.sourceDetail)) || 'Not recorded');
      if (p.inquiryDate) fact('First inquiry', `${day(p.inquiryDate)}${p.inquiryTime ? ` at ${p.inquiryTime}` : ''}`);
      if (p.sourceRemarks) fact('Remarks', p.sourceRemarks);
      if (!g && can()) words.append(el('span', 'sc-source-hint', 'Where did this student come from? Add it once and it is counted on the Dashboard.'));
      if (rows.children.length) words.append(rows);
      box.append(ico, words);
      if (can()) {
        const b = h('button', { class: `btn btn-sm${g ? '' : ' btn-primary'}`, type: 'button', onclick: () => { editingOrigin = true; render(); } });
        b.append(icon(g ? 'pencil' : 'plus', 'sc-btn-ico'), g ? 'Edit' : 'Add source');
        box.append(b);
      }
      return box;
    }
    const picker = window.SourcePicker.create({ lists, initial: { source: s.source, detail: p.sourceDetail, remarks: p.sourceRemarks, platform: p.sourcePlatform, way: p.sourceWay }, disabled: !data.can.source });
    const form = el('div', 'p-form');
    picker.nodes.forEach((n) => form.append(n));
    words.append(form);
    if (!data.can.source && s.source) words.append(el('p', 'p-muted p-small', 'Only Admin changes the source.'));
    const bar = el('div', 'p-bar');
    bar.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async (ev) => {
      const btn = ev.currentTarget;
      try {
        const missing = picker.check();
        if (missing) { say(missing, true); shake(form); return; }
        await morph(btn, () => saveSource(picker.value()));
        editingOrigin = false; render();
      } catch (e) { /* shown */ }
    } }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => { editingOrigin = false; render(); } }, 'Cancel'));
    words.append(bar);
    box.append(ico, words);
    return box;
  }

  async function saveSource(v) {
    const s = data.student;
    if (data.can.source && v.source !== (s.source || '')) { await save('source', { source: v.source }); data.student.source = v.source; }
    await save('profile', { sourceDetail: v.detail, sourceRemarks: v.remarks, sourcePlatform: v.platform || '', sourceWay: v.way || '' }, 'Saved');
  }

  // ---- Notes (replace the Remarks column of the sheet) ----
  // A note is a note (the owner, 14 Nov 2026): no kinds to choose (phone call, office visit, message); notes kept with a kind
  // before still show, all simply as notes. Notes are about the student (IELTS booked, the CAS result, money ready); the talk with
  // a team about a piece of work is in the comments of its task.
  let noteDraft = '';
  // The small pictures in the round badges of the Timeline (drawn in lines, as Apple's own symbols are).
  const TL_ICON = {
    task: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
    done: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    update: '<path d="M4 5.5h16v10H9l-5 4z"/>',
    email: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.8z"/>',
  };
  const tlIcon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = TL_ICON[name]; return s; };
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
  let tlRevealFrom = 0; // after Show all, the entries from here on fade in once
  // The time of an entry as people say it: "Just now", "5 min ago" in the last hour, then the clock time ("3:40 PM"). The words are
  // kept fresh every minute while the card is open.
  function tlTime(at) {
    const t = new Date(at);
    if (Number.isNaN(t.getTime())) return '';
    const mins = Math.floor((Date.now() - t.getTime()) / 60000);
    if (mins >= 0 && mins < 1) return 'Just now';
    if (mins >= 1 && mins < 60) return `${mins} min ago`;
    return t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  setInterval(() => { document.querySelectorAll('.sc-tl-time[datetime]').forEach((x) => { const v = tlTime(x.dateTime); if (x.textContent !== v) x.textContent = v; }); }, 60000);
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
  function notes() {
    const wrap = el('section', 'p-card p-tl');
    // One timeline (the owner, 17 Nov 2026): every note, task and message, newest first, so how the student moved and every decision
    // can be read day by day. What is written stays as it was written: no pinning and no changing (the owner, 17 Nov 2026); a note can
    // still be removed by the person who wrote it or Admin, and a done task reopened. The applications are not repeated here: the
    // tasks and notes already say each step, and Applications has the rest.
    // The title on the left and the switch (All, Notes, Tasks, Messages) on the right of the same row, as in Apple's apps.
    const top = el('div', 'sc-tl-top');
    top.append(el('h2', '', 'Timeline'));
    wrap.append(top);
    // What is new since this person last opened the student: a small blue dot, as in Mail. Kept in this browser only.
    const meName = (data.me || {}).name || '';
    if (tlLastSeen === null) {
      const key = `isrSeen:${meName}:${id}`;
      try { tlLastSeen = localStorage.getItem(key) || ''; localStorage.setItem(key, new Date().toISOString()); } catch (e) { tlLastSeen = ''; }
    }
    if (can()) {
      // The box to write a note, with its button inside it at the bottom, as in Apple's own apps.
      const box = el('div', 'sc-tl-compose');
      // The writer's own round badge beside the box, as in Apple's comments.
      const me = el('span', 'sc-tl-av sc-tl-me', initials((data.me || {}).name || '?'));
      me.setAttribute('aria-hidden', 'true');
      const field2 = el('div', 'sc-tl-compose-field');
      const text = el('textarea', 'sc-tl-input');
      text.placeholder = 'Add a note…';
      text.setAttribute('aria-label', 'Write a note');
      text.maxLength = 4000;
      // What is typed survives a redraw of the card (a tab change, a task ticked) until it is added.
      text.value = noteDraft;
      const bar = el('div', 'sc-tl-compose-bar');
      const add = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add note');
      // The button appears once something is typed (Ctrl+Enter or Cmd+Return also adds it).
      const showAdd = () => { box.classList.toggle('has-text', Boolean(text.value.trim())); };
      text.addEventListener('input', () => { noteDraft = text.value; showAdd(); try { if (noteDraft.trim()) localStorage.setItem(draftKey(), noteDraft); else localStorage.removeItem(draftKey()); } catch (e) { /* not kept */ } });
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add.click(); } });
      add.addEventListener('click', async () => {
        if (!text.value.trim()) { text.focus(); shake(field2); return; }
        try {
          const r = await morph(add, () => save('notes', { text: text.value, kind: 'note' }), { busy: 'Adding…', done: 'Added' });
          justAdded = (r && r.note && r.note.id) || '';
          noteDraft = ''; try { localStorage.removeItem(draftKey()); } catch (e) { /* nothing kept */ } historyFilter = historyFilter === 'all' || historyFilter === 'note' ? historyFilter : 'all'; render();
        } catch (e) { /* shown by save */ }
      });
      bar.append(add);
      field2.append(text, bar);
      box.append(me, field2);
      showAdd();
      wrap.append(box);
    }
    // The student's History (the owner, 15 Nov 2026): the notes and, without anyone typing them again, every task about the student:
    // who gave it to which team, each update, a reassignment or a move to another day, and who marked it done. Newest first.
    const teamName = (id) => (((data.taskTeams || []).find((x) => x.id === id) || {}).label || id).replace(/\s*\(.*\)$/, '');
    const events = data.card.notes.map((n) => ({ kind: 'note', at: n.at, by: n.by, text: n.text, note: n }));
    // Each entry says what it is in a few grey words beside the name ("Task for Application Team", "Update", "Reassigned"), and the
    // task it belongs to is shown once, as a small grey quote, as a reply is in Apple's Mail (the owner, 17 Nov 2026).
    (data.card.tasks || []).forEach((t) => {
      const tag = window.Portal.tagOf(t, data.student.stage);
      events.push({ kind: 'task', at: t.at, by: t.by, label: `Task for ${teamName(t.team)}`, text: t.text, tag });
      (t.comments || []).forEach((c) => {
        if (c.handoff) events.push({ kind: 'task', at: c.at, by: c.by, label: 'Reassigned', lead: `${teamName(c.handoff.from)} → ${teamName(c.handoff.to)}`, ref: t.text, text: c.text || '' });
        else if (c.schedule) events.push({ kind: 'task', at: c.at, by: c.by, label: 'Moved', lead: c.schedule.to ? `Moved to ${window.Portal.dayLabel(c.schedule.to, data.today)}` : 'Moved back to today', ref: t.text, text: c.text || '' });
        else if (c.text) events.push({ kind: 'update', at: c.at, by: c.by, label: 'Update', ref: t.text, text: c.text });
      });
      if (t.done && t.doneAt) events.push({ kind: 'done', at: t.doneAt, by: t.doneBy, label: 'Marked done', ref: t.text, text: '', task: t });
    });
    // The emails and WhatsApp messages sent from Follow-up are in the history too (the card itself sends nothing: Call, WhatsApp
    // and Email under the name open the person's own phone, WhatsApp or email program).
    (data.card.messages || []).forEach((m) => {
      const label = m.channel === 'whatsapp' ? 'WhatsApp' : m.status === 'sent' ? 'Email sent' : m.status === 'failed' ? 'Email not sent' : 'Email prepared';
      events.push({ kind: 'message', at: m.at, by: m.by, label, lead: m.subject || m.template || '', text: '', message: m });
    });
    events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    const AUTO = 'ISR (automatic)';
    const kindOfEvent = (e) => (e.kind === 'note' ? 'note' : e.kind === 'message' ? 'message' : 'task');
    // The day of an entry in the reader's own time (YYYY-MM-DD), and how people say it: Today, Yesterday, Monday 16 November 2026.
    const pad = (n) => String(n).padStart(2, '0');
    const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const localDay = (e) => { const d = new Date(e.at); return Number.isNaN(d.getTime()) ? String(e.at).slice(0, 10) : isoOf(d); };
    const todayIso = isoOf(new Date());
    const daysAgo = (iso) => Math.round((Date.parse(todayIso + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400000);
    const dayName = (iso) => {
      const n = daysAgo(iso);
      if (n === 0) return 'Today';
      if (n === 1) return 'Yesterday';
      const d = new Date(iso + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(iso.slice(0, 4) === todayIso.slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
    };
    // One entry: a round badge (the writer's initials on a note, a symbol for the rest), the name, what it is and the time on one
    // line, then the words. Long notes fold to six lines with "Read more".
    const entry = (e) => {
      const k = e.kind === 'note' && e.by === AUTO ? 'auto' : e.kind;
      const li = el('li', `sc-tl-item is-${k}`);
      const av = el('span', 'sc-tl-av');
      av.setAttribute('aria-hidden', 'true');
      if (k === 'note') av.textContent = initials(e.by || '?');
      else if (k === 'auto') av.textContent = 'ISR';
      else av.append(tlIcon(k === 'message' ? (e.message.channel === 'whatsapp' ? 'whatsapp' : 'email') : k));
      const body = el('div', 'sc-tl-body');
      const line = el('div', 'sc-tl-line');
      const time = el('time', 'sc-tl-time', tlTime(e.at));
      time.dateTime = e.at; time.title = when(e.at);
      const label = k === 'auto' ? 'Automatic' : k === 'note' ? 'Note' : e.label;
      line.append(el('b', 'sc-tl-who', k === 'auto' ? 'ISR' : e.by || 'Someone'), el('span', 'sc-tl-kind', label), time);
      body.append(line);
      if (e.lead) body.append(el('p', 'sc-tl-lead', e.lead));
      if (e.ref) { const q = el('p', 'sc-tl-ref', e.ref); q.title = e.ref; body.append(q); }
      if (e.text) {
        const p = el('p', 'sc-tl-text');
        if (e.tag) p.append(el('span', `td-tag tag-${e.tag}`, window.Portal.tagLabel(e.tag)), ' ');
        p.append(...linked(e.text));
        body.append(p);
        const long = e.text.length > 420 || e.text.split('\n').length > 6;
        if (long && !(e.note && openNotes.has(e.note.id))) {
          p.classList.add('is-folded');
          const more = h('button', { class: 'sc-tl-more', type: 'button', onclick: () => { if (e.note) openNotes.add(e.note.id); p.classList.remove('is-folded'); more.remove(); } }, 'Read more');
          body.append(more);
        }
      }
      const acts = el('div', 'sc-tl-acts');
      if (e.message && e.message.channel === 'email') acts.append(h('button', { class: 'sc-tl-act', type: 'button', onclick: () => readMessage(e.message) }, 'Read email'));
      // A done task can be reopened (the team it is for, Admin and the Manager), and what it recorded put back (the owner, 16 Nov
      // 2026: a wrong answer is corrected in one step).
      const mayReopen = e.task && !data.can.readOnly && (data.can.removeAnyTask || (data.can.myTeams || []).includes(e.task.team) || (e.task.team === 'head' && (data.me || {}).role === 'admin'));
      if (mayReopen) {
        acts.append(h('button', { class: 'sc-tl-act', type: 'button', onclick: async () => {
          const how = await window.Portal.reopenDialog(e.task);
          if (!how) return;
          const r = await save(`tasks/${e.task.id}`, { done: false, finish: how }, 'Reopened');
          if (r && r.undone && r.undone.length) say(`Reopened. Put back: ${r.undone.join('; ')}${r.left && r.left.length ? `. ${r.left.join('; ')}` : ''}`);
          data = await api('/api/cards/' + encodeURIComponent(id)); render();
        } }, 'Reopen'));
      }
      // Remove stays for a note written by mistake (the writer or Admin); it shows when the mouse is on the note.
      const n = e.note;
      if (n && can() && (n.by === data.me.name || data.can.removeAnyNote)) {
        line.insertBefore(h('button', { class: 'sc-tl-act is-remove', type: 'button', 'aria-label': 'Remove this note', onclick: async () => { if (await window.NiecUI.confirm('Remove this note?', { danger: true })) { await save('notes/' + n.id + '/delete', {}, 'Note removed'); render(); } } }, 'Remove'), time);
      }
      if (acts.children.length) body.append(acts);
      li.append(av, body);
      if (e.note && e.note.id === justAdded) { li.classList.add('is-new'); justAdded = ''; }
      else if (tlLastSeen && String(e.at) > tlLastSeen && e.by !== meName) { li.classList.add('is-unseen'); li.title = 'New since you last opened this student'; }
      return li;
    };
    // Everything, Notes, Tasks or Messages.
    const present = new Set(events.map(kindOfEvent));
    if (present.size > 1) {
      const seg = el('div', 'sc-tl-seg');
      seg.setAttribute('role', 'tablist');
      [['all', 'All'], ['note', 'Notes'], ['task', 'Tasks'], ['message', 'Messages']].filter(([k]) => k === 'all' || present.has(k)).forEach(([k, label]) => {
        const b = h('button', { class: 'sc-tl-seg-btn', type: 'button', role: 'tab', 'aria-selected': String(historyFilter === k) }, label);
        b.addEventListener('click', () => { historyFilter = k; render(); });
        seg.append(b);
      });
      top.append(seg);
    } else historyFilter = 'all';
    // The sheet's Remarks, unless it is only the latest progress line ISR wrote there (that is already a note above).
    const remark = data.student.remarks && data.student.remarks !== data.card.autoRemark ? data.student.remarks : '';
    const LIMIT = 8;
    let revealFrom = tlRevealFrom; tlRevealFrom = 0;
    const days = el('div', 'sc-tl-days');
    const moreBtn = h('button', { class: 'sc-tl-all', type: 'button' });
    function fill() {
      const all = events.filter((e) => historyFilter === 'all' || kindOfEvent(e) === historyFilter);
      const items = showAllNotes ? all : all.slice(0, LIMIT);
      days.replaceChildren();
      if (!all.length && !remark) {
        const empty = el('div', 'sc-tl-empty');
        const ico = el('span', 'sc-tl-empty-ico'); ico.append(tlIcon('update'));
        empty.append(ico, el('b', '', 'No history yet'), el('span', '', 'Notes, tasks and messages about this student will appear here.'));
        days.append(empty);
      }
      // Grouped by day, newest first, each day a rounded group under its own heading.
      let list = null; let lastDay = null; let prev = null;
      items.forEach((e, i) => {
        const d = localDay(e);
        if (d !== lastDay) {
          lastDay = d; prev = null;
          const g = el('section', 'sc-tl-group');
          list = el('ol', 'sc-tl-list');
          g.append(el('h3', 'sc-tl-day', dayName(d)), list);
          days.append(g);
        }
        const li = entry(e);
        // Notes written one after another by the same person sit together under one name, as in Messages (within half an hour).
        if (prev && e.kind === 'note' && prev.kind === 'note' && e.by && e.by === prev.by && e.by !== AUTO && Math.abs(Date.parse(prev.at) - Date.parse(e.at)) < 30 * 60000) li.classList.add('is-cont');
        if (revealFrom && i >= revealFrom) li.classList.add('is-reveal');
        // The entries arrive one after another (the first ten); the rest rise in as they are scrolled to.
        /* 🔴 CSS CHANGED (2026-11-20): --i set here | from: none | to: each Timeline entry's number (up to 10), so they arrive one after another */
        li.style.setProperty('--i', String(Math.min(i, 10)));
        if (i >= 10) li.classList.add('sc-later');
        list.append(li);
        prev = e;
      });
      revealFrom = 0;
      if (remark && historyFilter !== 'task' && historyFilter !== 'message' && (showAllNotes || all.length <= LIMIT)) {
        const g = el('section', 'sc-tl-group');
        const ol = el('ol', 'sc-tl-list');
        const li = el('li', 'sc-tl-item is-auto');
        const av = el('span', 'sc-tl-av', 'ISR'); av.setAttribute('aria-hidden', 'true');
        const body = el('div', 'sc-tl-body');
        const line = el('div', 'sc-tl-line'); line.append(el('b', 'sc-tl-who', 'All Students'), el('span', 'sc-tl-kind', 'Earlier remark'));
        body.append(line, el('p', 'sc-tl-text', remark));
        li.append(av, body); ol.append(li);
        g.append(el('h3', 'sc-tl-day', 'From the sheet'), ol);
        days.append(g);
      }
      moreBtn.hidden = all.length <= LIMIT;
      moreBtn.textContent = showAllNotes ? 'Show less' : `Show all ${all.length}`;
    }
    // The rest fade in softly when Show all is pressed.
    moreBtn.addEventListener('click', () => { showAllNotes = !showAllNotes; tlRevealFrom = showAllNotes ? LIMIT : 0; render(); });
    fill();
    wrap.append(days, moreBtn);
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
    if (can() && o.id && !answered) {
      tools.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        if (o.sent && !(await window.NiecUI.confirm(`Take ${o.university}${o.course ? ` (${o.course})` : ''} off? It was given to the Application Team on ${day(o.sent)}; tell them too.`, { danger: true, confirmText: 'Take it off' }))) return;
        await save('options/' + o.id + '/delete', {}, 'Taken off the shortlist'); render();
      } }, 'Remove from shortlist'));
    }
    if (can() && i < 0) tools.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => updateApplication(o) }, answered ? 'Update' : 'Record submission'));
    header.append(tools);
    item.append(header);
    const sub = el('div', 'p-chosen-sub');
    // The priority university (the one the student goes ahead with, named on All Students): its tag first, chosen above the list.
    if (i < 0 && isGoingAhead(o)) sub.append(el('span', 'p-applied is-priority', 'Priority'));
    if (o.fromSheet) sub.append(el('span', 'p-chosen-partner', 'On All Students'));
    if (o.partner) sub.append(el('span', 'p-chosen-partner', /^direct$/i.test(o.partner) ? 'Direct' : `Through ${o.partner}`));
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
  async function updateApplication(o) {
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
      const uniF = field('University', { value: o.university || '', max: 160, required: true });
      const courseF = field('Course', { value: o.course || '', max: 240 });
      const applied = field('Application submitted on', { kind: 'date', value: o.applied || '' });
      const now = o.skipped ? 'skipped' : o.refused ? 'refused' : o.withdrawn ? 'withdrawn' : o.offer ? (o.offerType || 'offer') : '';
      const result = field('Answer from the university', { kind: 'select', choices: RESULTS, value: now });
      const when2 = field('Day of the answer', { kind: 'date', value: o.skipped || o.refused || o.withdrawn || o.offer || '' });
      const reason = field('Reason', { max: 300, value: o.reason || '', placeholder: 'e.g. Grades below the entry requirement, course full' });
      [applied, when2].forEach((f) => { f.input.max = todayIso; });
      const show = () => { const r = result.input.value; when2.wrap.hidden = !r; reason.wrap.hidden = !WITH_REASON.includes(r); applied.wrap.hidden = r === 'skipped'; when2.wrap.querySelector('.p-label').textContent = r === 'skipped' ? 'Decided on' : 'Day of the answer'; };
      result.input.addEventListener('change', show);
      show();
      form.append(uniF.wrap, courseF.wrap, applied.wrap, result.wrap, when2.wrap, reason.wrap);
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
      await api(`/api/cards/${id}/sheet`, { fields: { 'UNIVERSITY NAME': o.university || '', 'COURSE NAME': o.course || '' } });
      say(`Priority: ${o.university}. All Students is updated.`);
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
    if (data.card.options.length) {
      acts.append(h('button', { class: 'btn btn-sm', type: 'button', title: 'Email these options to the student', onclick: () => window.OptionActions.email(studentRef(), waiting.length ? waiting : data.card.options).then((r) => { if (r) refreshCard(); }) }, 'Share options'));
      if (waiting.length && can()) acts.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.OptionActions.assign(studentRef(), waitingOptions()).then((r) => { if (r) { sendOrder = null; refreshCard(); } }) }, 'Assign to the Application Team'));
    }
    if (acts.children.length) head.append(acts);
    box.append(head);
    if (!waiting.length) box.append(el('p', 'p-muted', 'No course waiting to be assigned. Press "Find course" to open Universities with this student chosen.'));
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
    { const t = el('h2', '', 'Universities Applied To'); t.append(el('span', 'sc-tl-count', String(apps.length))); box.append(t); }
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
      words.append(el('b', '', 'Priority University'), el('small', '', 'Writes the university and course on All Students'));
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
    const changed = name !== tab;
    tab = name;
    history.replaceState(null, '', location.pathname + location.search + '#' + name);
    // Another tab cross-fades in, as on a Mac; the same tab again is redrawn at once.
    if (changed && window.NiecUI && window.NiecUI.swap) window.NiecUI.swap(() => render(), { soft: true });
    else render();
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
    else if (s.stage === 'Application Stage' && !applied && data.card.options.some((o) => o.sent && !o.applied && !o.skipped)) step = { title: 'Record the applications', why: 'When the Application Team submits, record the day for each university.', apps: true };
    else if (applied && !iso(row['OFFER RECEIVED DATE']) && ['Application Stage', 'Mock Stage'].includes(s.stage)) {
      const waited = Math.max(0, Math.round((Date.parse(data.today || new Date().toISOString().slice(0, 10)) - Date.parse(applied)) / 86400000));
      step = { title: 'Record the offer', why: `First application ${day(applied)}, ${waited} ${waited === 1 ? 'day' : 'days'} ago. When an offer comes, record it on that university.`, apps: true };
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
    if (step.apps) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => select('options') }, 'Open Applications'));
    else if (step.edit) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { editingHero = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Add them'));
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
          await api(`/api/cards/${encodeURIComponent(id)}/sheet`, { fields: { [step.col]: input.value } });
          data = await api('/api/cards/' + encodeURIComponent(id));
          say(`Saved: ${step.label.toLowerCase()} ${day(input.value)}`);
          render();
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
    const o = data.card.options.find((x) => squash(x.university) && squash(x.university) === squash(row['UNIVERSITY NAME']));
    if (!o) return;
    const iso = (v) => { const t = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; };
    if (!o.applied && !o.skipped && iso(row['APPLICATION SUBMISSION DATE'])) o.applied = iso(row['APPLICATION SUBMISSION DATE']);
    if (!o.offer && !o.refused && iso(row['OFFER RECEIVED DATE'])) o.offer = iso(row['OFFER RECEIVED DATE']);
  }
  function render() {
    sheetDaysOnOptions();
    document.title = `${data.student.name} · Student · ISR`;
    const frag = document.createDocumentFragment();
    const q = queueBar(); if (q) frag.append(q);
    frag.append(hero());
    if (!editingHero) { const n = nextStep(); if (n) frag.append(n); }
    if ((data.checks || []).length) frag.append(checksBox());
    if (!can()) frag.append(el('div', 'p-notice', 'View only.'));
    const tabs = el('div', 'p-tabs sc-tabs');
    tabs.setAttribute('role', 'tablist');
    TABS.forEach(([key, text]) => {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(key === tab));
      b.textContent = text;
      if (key === 'options' && data.card.options.length) b.append(el('span', 'p-count', String(data.card.options.length)));
      b.addEventListener('click', () => select(key));
      tabs.append(b);
    });
    // A quiet key symbol at the end of the tabs opens the list of keys (the same as pressing ?).
    const keysBtn = h('button', { class: 'sc-keys-btn', type: 'button', title: 'Keys for this card (?)', 'aria-label': 'Keys for this card', onclick: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) });
    keysBtn.append(icon('keys'));
    const tabRow = el('div', 'sc-tabrow');
    tabRow.append(tabs, keysBtn);
    frag.append(tabRow);
    frag.append(tab === 'options' ? optionsTab() : details());
    view.replaceChildren(frag);
    miniBar();
    watchLater();
    if (intro) { intro = false; milestones(); }
  }

  // Entries further down rise in as they come into view.
  let laterObs = null;
  function watchLater() {
    const items = view.querySelectorAll('.sc-later');
    if (!items.length) return;
    if (!('IntersectionObserver' in window) || calm()) { items.forEach((x) => x.classList.add('is-in')); return; }
    if (laterObs) laterObs.disconnect();
    laterObs = new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); laterObs.unobserve(en.target); } }), { rootMargin: '0px 0px -40px 0px' });
    items.forEach((x) => laterObs.observe(x));
  }

  // A slim frosted bar with the student's name, stage and step slides in at the top once the main card is scrolled away, so the
  // person always knows whose card this is. It has no buttons (the main card has them).
  let mini = null; let miniObs = null;
  function miniBar() {
    const s = data.student;
    if (!mini) { mini = el('div', 'sc-mini'); mini.setAttribute('aria-hidden', 'true'); document.body.append(mini); }
    const at = JOURNEY.findIndex(([n]) => n === s.stage);
    const av = el('span', `sc-mini-av is-${window.Portal.stageKind(s.stage)}`, initials(s.name));
    /* 🔴 CSS CHANGED (2026-11-20): the mini bar's fill set here | from: none | to: a thin blue line as long as the student's progress */
    const bar = el('span', 'sc-mini-bar'); const fill = el('i'); fill.style.transform = `scaleX(${at < 0 ? 0 : (at + 1) / JOURNEY.length})`; bar.append(fill);
    mini.replaceChildren(av, el('b', '', s.name), stagePill(s.stage), at >= 0 ? el('span', 'sc-mini-step', `Step ${at + 1} of ${JOURNEY.length}`) : '', bar);
    const head = view.querySelector('.sc-head');
    if (miniObs) miniObs.disconnect();
    if (!head || !('IntersectionObserver' in window)) { mini.classList.remove('is-on'); return; }
    /* 🔴 CSS CHANGED (2026-11-20): --sc-mini-x set here | from: none | to: the middle of the card, so the frosted bar sits over the card */
    // Centred over the card, not the window (the menu is on the left).
    const place = () => { const r = view.getBoundingClientRect(); mini.style.setProperty('--sc-mini-x', `${r.left + r.width / 2}px`); };
    place();
    if (!miniBar.placed) { miniBar.placed = true; window.addEventListener('resize', place); }
    miniObs = new IntersectionObserver(([en]) => { place(); mini.classList.toggle('is-on', !en.isIntersecting && en.boundingClientRect.top < 0); });
    miniObs.observe(head);
  }

  // Milestones (the owner, 20 Nov 2026: a reward when something good happens): the first time a person opens a student who holds an
  // offer, or whose visa is issued, confetti falls and a word of praise shows. Kept in this browser, so it happens once per person.
  function milestones() {
    const me = (data.me || {}).name || '';
    const s = data.student;
    const once = (what, words) => {
      const key = `isrCheer:${what}:${me}:${id}`;
      try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, new Date().toISOString()); } catch (e) { return false; }
      setTimeout(() => { confetti(); window.NiecUI.toast(words, { type: 'success' }); }, 700);
      return true;
    };
    if (s.stage === 'Visa Issued' && once('visa', `Visa issued for ${s.name}. Wonderful work.`)) return;
    if (appStats().offers) once('offer', `${s.name} holds an offer. Well done.`);
  }

  // Keys for the card (the owner, 20 Nov 2026), when nothing is being typed and no window is open: N a note (above), E Edit details,
  // A Assign a task, 1 and 2 the tabs, ? the list of keys. Ctrl+K (quick search) and the arrow keys (the next student) are kept.
  const KEYS = [['N', 'Write a note'], ['E', 'Edit details'], ['A', 'Assign a task'], ['1', 'Timeline'], ['2', 'Applications'], ['← →', 'Previous or next student (from All Students)'], ['Ctrl K', 'Quick search'], ['?', 'These keys']];
  document.addEventListener('keydown', (e) => {
    if (!data || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('dialog[open], .p-dialog') || editingHero || editingOrigin) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && can()) { e.preventDefault(); editingHero = true; render(); window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); }
    else if (k === 'a' && data.can.assign) { e.preventDefault(); assignTask(); }
    else if (k === '1' || k === '2') { e.preventDefault(); select(k === '1' ? 'details' : 'options'); }
    else if (e.key === '?') {
      e.preventDefault();
      dialog('Keys for this card', (body, close) => {
        const list = el('dl', 'sc-keys');
        KEYS.forEach(([key, what]) => { const d = el('div'); const dt = el('dt'); key.split(' ').forEach((x) => dt.append(el('kbd', '', x))); d.append(dt, el('dd', '', what)); list.append(d); });
        const foot = el('div', 'p-dialog-foot');
        foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, 'Got it'));
        body.append(list, foot);
      });
    }
  });

  async function start() {
    if (!id) { view.replaceChildren(el('div', 'p-card', 'Choose a student from the sheet first.')); return; }
    try {
      const [d, l] = await Promise.all([api('/api/cards/' + encodeURIComponent(id)), api('/api/card-lists')]);
      data = d; lists = l;
      try { noteDraft = localStorage.getItem(draftKey()) || ''; } catch (e) { /* none kept */ }
      if (!TABS.some(([k]) => k === tab)) tab = 'details';
      render();
    } catch (e) {
      view.replaceChildren(h('div', { class: 'p-card' }, el('h1', 'p-error-title', 'This student cannot be opened'), el('p', '', e.message), h('a', { class: 'btn', href: '/students' }, 'Back to All Students')));
    }
  }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (data && t !== tab && TABS.some(([k]) => k === t)) { tab = t; render(); } });
  start();
})();
