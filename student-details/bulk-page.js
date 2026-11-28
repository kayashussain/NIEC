// Follow-up (the /bulk page), one step at a time (the owner, 17 Nov 2026: "process by process, step by step, each on its own page"):
//   1. How to send: email or WhatsApp.
//   2. Your setup: only what that way of sending needs (your email and signature, or your WhatsApp number), sender-setup.js.
//   3. The students: filter by intake, stage, source and name, then tick them.
//   4. The message: the {words} are filled in for each student.
//   5. Check and send: the message as each student gets it, then send the emails in one go or open each WhatsApp chat in turn.
// Each step is its own screen with its own address (#how, #setup, #students, #message, #check), so the browser's Back button
// goes back one step. A step that is not ready yet sends you to the first step still to do.
(function () {
  const { el, h, api, field } = window.Portal;
  const view = document.getElementById('view');
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const STEPS = [
    ['how', 'How to send'],
    ['setup', 'Your setup'],
    ['students', 'Students'],
    ['message', 'Message'],
    ['check', 'Check and send'],
  ];
  const SHOWN = ['first_name', 'full_name', 'university', 'course', 'intake', 'stage', 'offer_date', 'sender_name', 'company_name', 'options_table', 'documents_list'];
  const NAMES = { Events: 'Events and marketing', Agent: 'Agents', Branch: 'Branches' };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // What the person has chosen so far; it lives while the page is open.
  const state = { channel: '', subject: '', body: 'Dear {first_name},\n\n', wa: 'Hello {first_name}, ', filters: { intake: '', stage: '', source: '', name: '' }, onlyChosen: false };
  let students = [];
  let lists = { intakes: [], stages: [] };
  let fields = [];
  let mail = { ready: false };
  let setupDirect = false; // reached through /bulk#setup (from the menu): show all three setup rows
  const chosen = new Set();
  let ownPhone = ''; // the sender's WhatsApp number, from their setup

  // The draft (how to send, the students ticked, the filters and the message) is kept while this tab is open, so a reload or a look
  // at another page loses nothing (the owner, 17 Nov 2026: less work for the team). It is cleared once the message has gone.
  const DRAFT = 'sr360FollowupDraft';
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT, JSON.stringify({ channel: state.channel, subject: state.subject, body: state.body, wa: state.wa, filters: state.filters, chosen: [...chosen] })); } catch (e) { /* this page only */ }
  }
  function loadDraft() {
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT) || 'null');
      if (!d) return;
      ['channel', 'subject', 'body', 'wa'].forEach((k) => { if (typeof d[k] === 'string') state[k] = d[k]; });
      if (d.filters) Object.assign(state.filters, d.filters);
      (d.chosen || []).forEach((x) => { if (students.some((st) => st.id === x)) chosen.add(x); });
    } catch (e) { /* start afresh */ }
  }
  const clearDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch (e) { /* nothing kept */ } };
  // The words to insert, by the names the team uses ({first_name} is still what goes into the text).
  const LABELS = { first_name: 'First name', full_name: 'Full name', university: 'University', course: 'Course', intake: 'Intake', stage: 'Stage', offer_date: 'Offer date', sender_name: 'Your name', company_name: 'Consultancy name', options_table: 'University options (table)', documents_list: 'Documents to send' };
  // The setup that way of sending needs is already done, so step 2 can be passed by.
  const setupReady = (channel) => (channel === 'email' ? Boolean(mail.ready) : Boolean(ownPhone));

  const q = new URLSearchParams(location.search);

  // The first step that is not ready yet: a later step can only be opened once the ones before it are done.
  function firstOpen() {
    if (!state.channel) return 'how';
    if (state.channel === 'email' && !mail.ready) return 'setup';
    if (!chosen.size) return 'students';
    if (state.channel === 'email' ? !(state.subject.trim() && state.body.trim()) : !state.wa.trim()) return 'message';
    return 'check';
  }
  const idx = (k) => STEPS.findIndex(([s]) => s === k);
  const allowed = (k) => idx(k) <= idx(firstOpen());

  let current = '';
  function go(k, { push = true } = {}) {
    if (!allowed(k)) k = firstOpen();
    if (push && k !== current) history.pushState({ step: k }, '', '#' + k);
    else history.replaceState({ step: k }, '', '#' + k);
    current = k;
    saveDraft();
    draw();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.addEventListener('popstate', () => { const k = (location.hash || '#how').slice(1); go(STEPS.some(([s]) => s === k) ? k : 'how', { push: false }); });

  async function start() {
    try {
      const l = await api('/api/bulk/students');
      students = l.students; lists = l; mail = l.mail;
      const t = await api('/api/templates');
      fields = t.fields || []; mail = t.mail || mail;
      try { ownPhone = (await api('/api/my-mail')).phone || ''; } catch (e) { ownPhone = ''; }
      loadDraft();
      if (q.get('stage') && lists.stages.includes(q.get('stage'))) state.filters.stage = q.get('stage');
      if (q.get('sheet')) state.filters.intake = q.get('sheet');
      const want = (location.hash || '').slice(1);
      setupDirect = want === 'setup';
      if (setupDirect && !state.channel) { current = 'setup'; history.replaceState({ step: 'setup' }, '', '#setup'); draw(); return; }
      go(STEPS.some(([s]) => s === want) ? want : 'how', { push: false });
    } catch (e) { view.replaceChildren(el('div', 'p-card', e.message)); }
  }

  // ---- the frame: title, the row of steps, the screen and the bar with Back and Continue ----
  let foot; let nextBtn; let backBtn; let footInfo;
  let onNext = null; // what Continue does on this step, when it is not simply the next step (Send, Open the next chat)
  function draw() {
    const wrap = el('div', 'bk fw');
    const head = el('div', 'p-head');
    const title = el('div');
    title.append(el('h1', '', 'Follow-up'), el('p', '', 'One personal message to many students, step by step.'));
    head.append(title, h('a', { class: 'btn', href: '/students' }, 'Back to All Students'));

    const nav = el('ol', 'fw-steps');
    nav.setAttribute('aria-label', 'Steps');
    const at = idx(current);
    STEPS.forEach(([k, name], i) => {
      const done = i < at && allowed(k);
      const li = el('li', 'fw-step' + (i === at ? ' is-now' : done ? ' is-done' : ''));
      const b = h('button', { type: 'button', disabled: !allowed(k) || i === at, 'aria-current': i === at ? 'step' : false }, '');
      b.append(el('span', 'fw-dot', done ? '✓' : String(i + 1)), el('span', 'fw-name', name));
      b.addEventListener('click', () => go(k));
      li.append(b);
      nav.append(li);
    });

    const screen = el('section', 'fw-screen');
    foot = el('div', 'fw-foot');
    backBtn = h('button', { class: 'btn', type: 'button', onclick: () => go(STEPS[Math.max(0, at - 1)][0]) }, 'Back');
    backBtn.hidden = at === 0;
    footInfo = el('span', 'fw-info');
    nextBtn = h('button', { class: 'btn btn-primary', type: 'button', title: 'Ctrl+Enter' }, 'Continue');
    onNext = null;
    nextBtn.addEventListener('click', () => { if (nextBtn.disabled) return; if (onNext) onNext(); else if (at < STEPS.length - 1) go(STEPS[at + 1][0]); });
    foot.append(backBtn, footInfo, nextBtn);

    wrap.append(head, nav, screen, foot);
    view.replaceChildren(wrap);
    ({ how: drawHow, setup: drawSetup, students: drawStudents, message: drawMessage, check: drawCheck })[current](screen);
  }
  // The Continue button and the words beside it, for the step on screen.
  function footer(info, ready, label) {
    footInfo.textContent = info || '';
    nextBtn.disabled = !ready;
    if (label) nextBtn.textContent = label;
  }
  const screenHead = (screen, title, help) => {
    const t = el('div', 'fw-head');
    t.append(el('h2', '', title), el('p', '', help));
    screen.append(t);
  };

  // ---- 1. How to send ----
  function drawHow(screen) {
    screenHead(screen, 'How do you want to send it?', 'Choose one. You can come back and change it.');
    const grid = el('div', 'fw-choices');
    [['email', 'By email', 'Each student gets their own email from your mailbox, with your signature.'],
      ['whatsapp', 'By WhatsApp', 'Each student\'s chat opens with the message written, one after the other.']].forEach(([k, name, help]) => {
      const c = h('button', { type: 'button', class: 'fw-choice fw-choice-' + k + (state.channel === k ? ' is-on' : ''), 'aria-pressed': String(state.channel === k) }, '');
      c.append(el('span', 'fw-choice-ico'), el('b', '', name), el('span', '', help), el('span', 'fw-choice-tick', '✓'));
      // Straight on to the students when this way of sending is already set up; the setup stays one click away in the steps.
      c.addEventListener('click', () => { state.channel = k; setupDirect = false; go(setupReady(k) ? 'students' : 'setup'); });
      grid.append(c);
    });
    screen.append(grid);
    footer(state.channel ? `Sending by ${state.channel === 'email' ? 'email' : 'WhatsApp'}` : 'Choose email or WhatsApp to go on', Boolean(state.channel));
  }

  // ---- 2. Your setup ----
  function drawSetup(screen) {
    const box = el('div');
    screen.append(box);
    const only = setupDirect && !state.channel ? null : state.channel === 'email' ? ['email', 'signature'] : ['whatsapp'];
    let phone = null; // known once the setup has loaded
    const update = () => {
      if (!state.channel) { footer('Your setup is saved for every message you send.', true, 'Choose how to send'); return; }
      const ok = state.channel === 'whatsapp' || mail.ready;
      const note = state.channel === 'whatsapp' && phone === '' ? 'Adding your number is optional' : 'Your setup is ready';
      footer(ok ? note : 'Set up your email to go on', ok, 'Continue');
    };
    // From the menu's setup link: Continue starts the steps at "How to send".
    if (!state.channel) onNext = () => { setupDirect = false; go('how'); };
    update();
    window.SenderSetup.mount(box, { open: true, only, onChange: (i) => { mail = i.mail; fields = i.fields || fields; phone = i.phone; ownPhone = i.phone || ''; update(); } })
      .then((info) => { mail = info.mail; fields = info.fields || fields; phone = info.phone; ownPhone = info.phone || ''; update(); })
      .catch((e) => box.replaceChildren(el('div', 'p-notice bad', e.message)));
  }

  // ---- 3. The students ----
  function drawStudents(screen) {
    screenHead(screen, 'Who should get it?', 'Narrow the list, then tick the students.');
    const panel = el('div', 'fw-panel');
    const bar = el('div', 'bk-filters');
    const search = field('Name', { placeholder: 'Search by name', value: state.filters.name });
    search.input.type = 'search';
    search.wrap.classList.add('bk-search');
    const intake = field('Intake', { kind: 'select', choices: [['', 'All intakes you can see'], ...lists.intakes.map((i) => [i.id, i.name])], value: state.filters.intake });
    const stage = field('Stage (application status)', { kind: 'select', choices: [['', 'Every stage'], ...lists.stages.map((s) => [s, s])], value: state.filters.stage });
    // Source: only the students of one source (Visitor, Social Media, a branch ...) or exactly which (a platform, a campaign).
    const groups = new Map();
    students.forEach((s) => { const g = groups.get(s.source) || { n: 0, details: new Map() }; g.n += 1; if (s.sourceDetail) g.details.set(s.sourceDetail, (g.details.get(s.sourceDetail) || 0) + 1); groups.set(s.source, g); });
    const source = field('Source', { kind: 'select', choices: [['', 'Every source']] });
    [...groups].sort((a, b) => b[1].n - a[1].n).forEach(([g, info]) => {
      const og = document.createElement('optgroup'); og.label = NAMES[g] || g;
      og.append(new Option(`All ${NAMES[g] || g} (${info.n})`, 'g:' + g));
      [...info.details].sort((a, b) => b[1] - a[1]).forEach(([d, n]) => og.append(new Option(`${d} (${n})`, `d:${g}\u0001${d}`)));
      source.input.append(og);
    });
    source.input.value = state.filters.source;
    bar.append(search.wrap, intake.wrap, stage.wrap, source.wrap);

    const fromSource = (s) => { const v = source.input.value; if (!v) return true; if (v.startsWith('g:')) return s.source === v.slice(2); const [g, d] = v.slice(2).split('\u0001'); return s.source === g && s.sourceDetail === d; };
    const visible = () => students.filter((s) => (!state.onlyChosen || chosen.has(s.id)) && fromSource(s) && (!intake.input.value || s.sheetId === intake.input.value) && (!stage.input.value || s.stage === stage.input.value) && (!search.input.value || s.name.toLowerCase().includes(search.input.value.toLowerCase())));
    const info = el('div', 'bk-info');
    const tools = el('div', 'bk-tools');
    const listBox = el('div', 'bk-list');
    const reach = (s) => (state.channel === 'email' ? Boolean(s.email) : Boolean(s.whatsapp));
    const counts = (v) => {
      info.textContent = plural(v.length, 'student matches', 'students match');
      only.textContent = state.onlyChosen ? 'Show everyone' : `Show only the chosen (${chosen.size})`;
      only.hidden = !chosen.size && !state.onlyChosen;
      saveDraft();
      footer(chosen.size ? `${plural(chosen.size, 'student', 'students')} chosen` : 'Tick at least one student', chosen.size > 0);
    };
    const drawList = () => {
      Object.assign(state.filters, { intake: intake.input.value, stage: stage.input.value, source: source.input.value, name: search.input.value });
      const v = visible();
      counts(v);
      listBox.replaceChildren(...(v.length ? v.slice(0, 400).map((s) => {
        const row = el('label', 'bk-row');
        const c = el('input'); c.type = 'checkbox'; c.checked = chosen.has(s.id);
        row.classList.toggle('is-on', c.checked);
        c.addEventListener('change', () => { if (c.checked) chosen.add(s.id); else chosen.delete(s.id); row.classList.toggle('is-on', c.checked); counts(v); });
        const t = el('span', 'bk-who');
        t.append(el('b', '', s.name), el('span', 'bk-sub', [s.intake, state.channel === 'email' ? s.email : s.phone].filter(Boolean).join(' · ')));
        const tags = el('span', 'bk-tags');
        if (s.stage) tags.append(el('span', 'bk-tag', s.stage));
        if (!reach(s)) tags.append(el('span', 'bk-tag is-warn', state.channel === 'email' ? 'No email' : 'No WhatsApp'));
        row.append(c, el('span', 'bk-av', initials(s.name)), t, tags);
        return row;
      }) : [el('div', 'bk-empty', 'No student matches.')]));
    };
    const only = h('button', { class: 'bk-link', type: 'button', onclick: () => { state.onlyChosen = !state.onlyChosen; drawList(); } }, '');
    // Tick all ticks only the students the message can reach (an email address, or a WhatsApp number), so nobody is skipped at the end.
    tools.append(info,
      h('button', { class: 'bk-link', type: 'button', onclick: () => {
        const v = visible(); const can = v.filter(reach); can.slice(0, 150).forEach((s) => chosen.add(s.id));
        if (can.length < v.length) say(`${plural(v.length - can.length, 'student was', 'students were')} left out: no ${state.channel === 'email' ? 'email address' : 'WhatsApp number'}.`);
        drawList();
      } }, 'Tick all shown (up to 150)'),
      only,
      h('button', { class: 'bk-link', type: 'button', onclick: () => { chosen.clear(); state.onlyChosen = false; drawList(); } }, 'Clear'));
    [intake, stage, source, search].forEach((x) => { x.input.addEventListener('input', drawList); x.input.addEventListener('change', drawList); });
    panel.append(bar, tools, listBox);
    screen.append(panel);
    drawList();
  }

  // ---- 4. The message ----
  function drawMessage(screen) {
    const email = state.channel === 'email';
    screenHead(screen, 'Write the message', 'Press a word below (First name, University ...) to add it where you are typing: it is filled in for each student. Ctrl+Enter goes on.');
    const form = el('div', 'bk-mail' + (email ? '' : ' is-wa'));
    const to = el('div', 'bk-to');
    to.append(el('span', 'bk-to-label', 'To'), el('span', 'bk-to-n', `${plural(chosen.size, 'student', 'students')}, each gets their own message`));
    form.append(to);
    const boxes = [];
    let subject;
    if (email) {
      subject = field('Subject', { wide: true, max: 200, value: state.subject, placeholder: 'What is this email about?' });
      form.append(subject.wrap); boxes.push(subject.input);
    }
    const text = field(email ? 'Email text' : 'WhatsApp text', { kind: 'area', max: email ? 8000 : 2000, wide: true, value: email ? state.body : state.wa });
    form.append(text.wrap); boxes.push(text.input);
    let lastBox = text.input;
    const check = () => {
      if (email) { state.subject = subject.input.value; state.body = text.input.value; } else state.wa = text.input.value;
      saveDraft();
      const ok = email ? state.subject.trim() && state.body.trim() : state.wa.trim();
      footer(ok ? 'Next: see it as each student will' : (email ? 'Write the subject and the text' : 'Write the text'), Boolean(ok));
    };
    boxes.forEach((x) => { x.addEventListener('focus', () => { lastBox = x; }); x.addEventListener('input', check); });
    const chips = el('div', 'tp-chips');
    chips.append(...fields.filter(([k]) => SHOWN.includes(k)).map(([k, d]) => {
      const c = h('button', { class: 'tp-chip', type: 'button', title: `${d}: adds {${k}}` }, LABELS[k] || `{${k}}`);
      c.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor where it is
      c.addEventListener('click', () => {
        const box = lastBox;
        const at = box.selectionStart ?? box.value.length; const end = box.selectionEnd ?? at;
        box.value = box.value.slice(0, at) + `{${k}}` + box.value.slice(end);
        box.focus(); box.selectionStart = box.selectionEnd = at + k.length + 2;
        check();
      });
      return c;
    }));
    const words = el('div', 'bk-words');
    words.append(el('span', 'tp-label', 'Insert'), chips);
    form.append(words);
    screen.append(form);
    check();
    setTimeout(() => (email && !state.subject ? subject.input : text.input).focus(), 0);
  }

  // ---- 5. Check and send ----
  function drawCheck(screen) {
    const email = state.channel === 'email';
    screenHead(screen, email ? 'Check and send' : 'Check and open the chats', email ? 'Read the email as each student will get it, then send.' : 'Open each student\'s chat in turn; the message is already written.');
    const tiles = el('div', 'fw-tiles');
    const body = el('div', 'fw-check');
    const list = el('div', 'fw-list');
    const show = el('div', 'fw-preview');
    body.append(list, show);
    screen.append(tiles, body);
    list.append(el('div', 'bk-empty', 'Getting the messages ready...'));
    footer('Getting the messages ready...', false, email ? 'Send emails now' : 'Open the next chat');
    const payload = () => ({ ids: [...chosen], subject: state.subject, body: state.body, whatsapp: state.wa });

    // One message as the student sees it: an email window or a WhatsApp bubble.
    const preview = (i) => {
      if (!i) { show.replaceChildren(el('div', 'bk-empty', 'No message to show.')); return; }
      if (email) {
        const m = el('div', 'fw-mailview');
        const top = el('div', 'fw-mailtop');
        top.append(el('b', '', i.subject || state.subject), el('span', '', 'To: ' + (i.to || i.problem || '')));
        m.append(top, el('div', 'fw-mailtext', i.text || ''));
        // The signature picture that ends the email (the sender's own, or the office one for Admin).
        if (sigPicture) { const img = el('img', 'fw-mailsig'); img.src = sigPicture; img.alt = 'Your signature'; m.append(img); }
        show.replaceChildren(m);
      } else {
        const p = el('div', 'fw-waview');
        const top = el('div', 'fw-watop');
        top.append(el('span', 'bk-av', initials(i.name)), el('b', '', i.name));
        p.append(top, el('div', 'fw-bubble', (i.whatsapp && i.whatsapp.text) || ''));
        show.replaceChildren(p);
      }
    };

    let sigPicture = '';
    api('/api/bulk/preview', payload()).then((r) => {
      const items = r.items;
      sigPicture = r.signature || '';
      const isReady = (i) => !i.error && (email ? !i.problem : Boolean(i.whatsapp && i.whatsapp.number));
      const ready = items.filter(isReady);
      const missing = items.filter((i) => !i.error && i.missing && i.missing.length).length;
      const tile = (n, label, cls) => { const t = el('div', 'fw-tile ' + (cls || '')); t.append(el('b', '', String(n)), el('span', '', label)); return t; };
      tiles.replaceChildren(tile(items.length, 'chosen'), tile(ready.length, email ? 'ready for email' : 'with a WhatsApp number', 'is-ok'), tile(items.length - ready.length, 'cannot be sent', items.length - ready.length ? 'is-bad' : ''), ...(email ? [tile(missing, 'with a word not filled in', missing ? 'is-warn' : '')] : []));
      let opened = 0;
      const rows = items.map((i) => {
        const row = h('button', { type: 'button', class: 'fw-item' + (isReady(i) ? '' : ' is-off') }, '');
        const words = el('span', 'bk-who');
        words.append(el('b', '', i.name || i.id), el('span', 'bk-sub', i.error || (email ? (i.problem || i.to) : (i.whatsapp && i.whatsapp.number ? '+' + i.whatsapp.number : 'No WhatsApp number'))));
        row.append(el('span', 'bk-av', initials(i.name)), words);
        if (i.missing && i.missing.length) row.append(el('span', 'bk-tag is-warn', 'Missing: ' + i.missing.join(', ')));
        if (!email && isReady(i)) {
          const wa = h('span', { class: 'fw-wa', role: 'button', tabindex: '0' }, 'WhatsApp');
          const open = (e) => {
            if (e) e.stopPropagation();
            if (i.opened) return;
            window.Portal.whatsapp(i.whatsapp.number, i.name, i.whatsapp.text, i.id); // on the connected phone, or WhatsApp here
            api(`/api/cards/${i.id}/messages/send`, { channel: 'whatsapp', whatsapp: state.wa }).catch(() => {});
            i.opened = true; opened += 1; wa.textContent = '✓ Opened'; wa.classList.add('is-done');
            footer(`${opened} of ${ready.length} chats opened`, opened < ready.length, opened < ready.length ? 'Open the next chat' : 'All chats opened');
            if (opened >= ready.length) clearDraft();
          };
          wa.addEventListener('click', open);
          wa.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
          i.open = open;
          row.append(wa);
        }
        row.addEventListener('click', () => { rows.forEach((x) => x.classList.remove('is-on')); row.classList.add('is-on'); preview(i); });
        return row;
      });
      list.replaceChildren(...rows);
      const first = items.findIndex(isReady);
      if (rows.length) { rows[Math.max(0, first)].classList.add('is-on'); preview(items[Math.max(0, first)]); }

      if (email) {
        if (!mail.ready) { footer('Set up your email first (step 2).', false, 'Send emails now'); return; }
        footer(`${plural(ready.length, 'email', 'emails')} will go from ${mail.from || 'your mailbox'}`, ready.length > 0, `Send ${plural(ready.length, 'email', 'emails')}`);
        onNext = async () => {
          if (!(await window.NiecUI.confirm(`Send this email to ${plural(ready.length, 'student', 'students')}?`, { confirmText: 'Send emails' }))) return;
          nextBtn.disabled = true;
          try {
            const res = await api('/api/bulk/send-email', payload());
            const sent = res.results.filter((x) => x.status === 'sent').length;
            say(`${sent} emails sent`);
            const done = el('div', 'fw-done');
            done.append(el('span', 'fw-done-ico', '✓'), el('h2', '', `${plural(sent, 'email', 'emails')} sent`), el('p', '', sent === res.results.length ? 'Every chosen student got their own email.' : 'These could not be sent:'));
            res.results.filter((x) => x.status !== 'sent').forEach((x) => done.append(el('div', 'fw-done-line', `${x.name}: ${x.error || x.status}`)));
            clearDraft();
            done.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { chosen.clear(); state.subject = ''; state.body = 'Dear {first_name},\n\n'; go('students'); } }, 'Send another message'));
            screen.replaceChildren(done);
            foot.hidden = true;
          } catch (e) { say(e.message, true); nextBtn.disabled = false; }
        };
      } else {
        footer(`0 of ${ready.length} chats opened`, ready.length > 0, 'Open the next chat');
        onNext = () => { const n = items.find((i) => isReady(i) && !i.opened); if (n) n.open(); };
      }
    }).catch((e) => { list.replaceChildren(el('div', 'p-notice bad', e.message)); footer('', false); });
  }

  // Ctrl+Enter (or Cmd+Enter on a Mac) presses Continue from anywhere on the step, also while typing the message.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && nextBtn && !nextBtn.disabled && !document.querySelector('.p-dialog, dialog[open]')) { e.preventDefault(); nextBtn.click(); }
  });

  start();
})();
