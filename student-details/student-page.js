// One student's card (student.html), kept short: Notes (where the student came from, the notes and the history) and University
// options. Call, WhatsApp and Email are one tap under the name; messages to many students go from Follow-up. The sheet's own details are changed on the sheet; the card never changes them except the Student Source,
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
  let historyQuery = ''; // words searched for in the Timeline (kept while the card is redrawn)
  let editingNote = ''; // the id of the note being changed in place
  const openNotes = new Set(); // long notes opened with "Read more"
  // Named for what they hold (the owner, 17 Nov 2026): Timeline (every step, day by day) and Applications (shortlist and applications).
  const TABS = [['details', 'Timeline'], ['options', 'Applications']];
  let tab = (location.hash || '#details').slice(1);
  const view = document.getElementById('view');
  const say = (text, error) => window.NiecUI.toast(text, { type: error ? 'error' : 'success' });

  if (embedded) {
    document.body.classList.add('p-embed');
    document.getElementById('closeEmbed').addEventListener('click', () => parent.postMessage({ niecCard: 'close' }, location.origin));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('dialog[open], .p-dialog')) parent.postMessage({ niecCard: 'close' }, location.origin); });
    // ← and → go to the previous and next student of the list the card was opened from (card-drawer.js), when nothing is being typed.
    document.addEventListener('keydown', (e) => {
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
    const save = async () => {
      try {
        await api(`/api/cards/${id}/profile`, { dob: dob.input.value, passportNo: passNo.input.value.trim().toUpperCase(), address: address.input.value.trim(), nationality: nation.input.value });
        await api(`/api/cards/${id}/sheet`, { fields: Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])) });
        data = await api('/api/cards/' + encodeURIComponent(id));
        editingHero = false; say('Saved on the sheet'); render();
      } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; }
    };
    bar.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => { editingHero = false; render(); } }, 'Cancel'));
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
    c.append(form, bar, msg);
    return c;
  }

  // ---- where the student is on the way from first inquiry to visa: a slim line of steps under the name ----
  const JOURNEY = [['Inquiry', 'Inquiry'], ['Application Stage', 'Application'], ['Mock Stage', 'Mock interview'], ['Payment Stage', 'Payment'],
    ['CAS Stage', 'CAS requested'], ['CAS Issued', 'CAS issued'], ['Visa Lodge', 'Visa lodged'], ['Visa Issued', 'Visa issued']];
  function journey(stage) {
    const box = el('div', 'p-journey');
    const bar = el('div', 'p-journey-bar');
    const at = JOURNEY.findIndex(([name]) => name === stage);
    JOURNEY.forEach(([, label], i) => { const step = el('i', at === -1 ? '' : i < at ? 'done' : i === at ? 'now' : ''); step.title = label; bar.append(step); });
    bar.setAttribute('aria-hidden', 'true');
    const text = el('div', 'p-journey-text');
    if (at !== -1) text.append(`Step ${at + 1} of ${JOURNEY.length}: `, el('b', '', JOURNEY[at][1]));
    else if (F.LOST_STAGES.includes(stage)) { box.classList.add('lost'); text.textContent = `Not moving at the moment: ${stage}`; }
    else text.textContent = stage ? `Stage: ${stage}` : 'No stage yet';
    box.append(bar, text);
    return box;
  }

  // The source in a few plain words, for the line under the name. A campaign's own date is left out (it is the day the campaign
  // started, not the student's), and so is a "Marketing:" or "Event:" word the records sometimes keep in front of the name.
  function sourceLine(s) {
    if (!s.source) return '';
    const p = profile();
    const plain = (v) => String(v || '').replace(/^(Marketing|Event)\s*:\s*/i, '').replace(/,\s*\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}$/, '').trim();
    const g = F.sourceGroup(s.source) || s.source;
    const parts = [g === 'Branch' ? s.source : g];
    if (p.sourcePlatform) parts.push(p.sourcePlatform);
    const what = data.event ? plain(data.event.name) : plain(p.sourceDetail);
    if (p.sourceWay === 'Advert') parts.push(what ? `Advert: ${what}` : 'Advert');
    else if (p.sourceWay === 'Organic') parts.push('Organic');
    else if (what && !parts.includes(what)) parts.push(what);
    return parts.filter(Boolean).join(' \u00b7 ');
  }

  // ---- the top: name, stage, contact ----
  function hero() {
    const s = data.student;
    if (editingHero) return heroEdit();
    const c = el('section', 'p-card p-hero');
    c.append(el('div', 'p-avatar', initials(s.name)));
    const mid = el('div', 'p-hero-mid');
    // The name and the buttons share the top row; a long name (SANJIP KUMAR MAHTO Mahato) wraps and the buttons move under it,
    // they never sit on top of each other (the owner, 15 Nov 2026).
    const top = el('div', 'p-hero-top');
    const name = el('h1', '', s.name);
    name.title = s.name;
    const act = el('div', 'p-hero-actions');
    top.append(name, act);
    mid.append(top);
    const line = el('div', 'p-hero-line');
    line.append(stagePill(s.stage), el('span', 'p-hero-intake', s.intake));
    mid.append(line);
    // Where the student came from, as one quiet line in smaller grey type: "Social Media · Facebook · Advert: Facebook ads ...".
    // The full story (dates, first inquiry, remarks) is in the Source panel.
    const src = sourceLine(s);
    if (src) { const sl = el('div', 'p-hero-source', src); sl.title = src; mid.append(sl); }
    mid.append(journey(s.stage));
    const facts = el('dl', 'p-facts');
    const fact = (k, v, href) => { if (!v) return; const d = el('div', 'p-fact'); const dd = el('dd'); if (href) { const a = el('a', '', v); a.href = href; dd.append(a); } else dd.textContent = v; d.append(el('dt', '', k), dd); facts.append(d); };
    // The order the owner asked for (14 Nov 2026): who the student is (email and the passport details), then how to reach them, then
    // the application.
    const pp = profile();
    // The passport details are always shown: an empty one says "Missing" in orange (needed from Application Stage on; Today lists them).
    const missing = (k) => { const d = el('div', 'p-fact'); const dd = el('dd'); dd.append(el('span', 'p-missing', 'Missing')); d.append(el('dt', '', k), dd); facts.append(d); };
    const must = (k, v) => (v ? fact(k, v) : missing(k));
    fact('Email', s.email, s.email ? 'mailto:' + s.email : '');
    // The date only, no age beside it (the owner, 15 Nov 2026): the Dashboard groups the students by age.
    must('Date of birth', pp.dob ? day(pp.dob) : '');
    must('Passport number', pp.passportNo);
    must('Address (passport)', pp.address);
    fact('WhatsApp', s.phone, F.whatsappNumber(s.phone) ? 'https://wa.me/' + F.whatsappNumber(s.phone) : '');
    { const a = facts.lastChild && facts.lastChild.querySelector('a[href^="https://wa.me/"]'); if (a) a.addEventListener('click', (e) => { e.preventDefault(); window.Portal.whatsapp(F.whatsappNumber(s.phone), s.name, '', id); }); }
    fact('University', s.university);
    fact('Course', s.course);
    // How many universities were applied to and how many offers, from Applications (one student applies to many).
    { const ap = appStats(); if (ap.submitted || ap.offers) fact('Applications', `${ap.submitted} submitted · ${ap.offers} ${ap.offers === 1 ? 'offer' : 'offers'}`); }
    if (pp.nationality && pp.nationality !== 'Nepali') fact('Nationality', pp.nationality);
    mid.append(facts);
    // What is still missing, named in one line with one button that opens the form (the owner, 17 Nov 2026: less work for the team).
    const gaps = [['Date of birth', pp.dob], ['Passport number', pp.passportNo], ['Address', pp.address]].filter(([, v]) => !v).map(([k]) => k);
    if (gaps.length && can()) {
      const bar = el('div', 'p-gaps');
      bar.append(el('span', 'p-gaps-dot'), el('span', 'p-gaps-text', `${gaps.length === 1 ? '1 detail' : `${gaps.length} details`} missing: ${gaps.join(', ')}`),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { editingHero = true; render(); } }, gaps.length === 1 ? 'Fill it in' : 'Fill them in'));
      mid.append(bar);
    }
    if (can()) act.append(h('button', { class: 'btn', type: 'button', onclick: () => { editingHero = true; render(); } }, 'Edit details'));
    if (data.can.assign) act.append(h('button', { class: 'btn', type: 'button', onclick: assignTask }, 'Assign a task'));
    if (!act.childNodes.length) act.remove();
    c.append(mid);
    return c;
  }

  // ---- Details: only the notes, and why a student did not go on ----
  // ---- tasks given to a team about this student ----
  function assignTask() {
    dialog('Assign a task', (body, close) => {
      // Which team and what to do: no date to do it by (the owner, 14 Nov 2026). The team asks for anything it needs in the
      // task's comments, and ticks it when it is done.
      // A team, or Admin (named with their title): the teams and branches can give Admin a task too.
      const targets = (data.assignTeams || data.taskTeams || []).map((t) => [t.id, t.label]);
      const team = field('Who should do it?', { kind: 'select', choices: targets, value: targets.length === 1 ? targets[0][0] : '' });
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
      const text = field('What should they do?', { kind: 'area', max: 2000, wide: true, placeholder: 'e.g. Submit the application to Coventry University.' });
      // How important it is, and what it is about: the tag is chosen by hand by whoever gives the task (NOC, Medical, Application,
      // Documents and the rest), never set by the system (the owner, 15 Nov 2026).
      const tag = window.Portal.tagPicker('');
      const tagWrap = el('div', 'p-field p-wide');
      tagWrap.append(el('span', 'p-label', 'What is it about?'), tag.node);
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Assign');
      ok.addEventListener('click', async () => {
        if (!team.input.value) { msg.textContent = 'Choose who should do it.'; msg.className = 'p-msg error'; return; }
        if (!text.input.value.trim()) { msg.textContent = 'Write what should be done.'; msg.className = 'p-msg error'; return; }
        if (!tag.value()) { msg.textContent = 'Choose what the task is about.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try { await save('tasks', { team: team.input.value, text: text.input.value, tag: tag.value() }, 'Task assigned'); close(true); } catch (e) { ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(team.wrap, text.wrap, tagWrap);
      body.append(g, msg, foot);
      setTimeout(() => text.input.focus(), 0);
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
    head.append(el('h2', '', 'Tasks'), el('span', 'td-chip', open ? `${open} open` : 'All done'));
    c.append(head);
    const label = (id) => ((data.taskTeams || []).find((t) => t.id === id) || { label: id }).label;
    const me = (data.me || {}).name || '';
    const unread = data.taskUnread || {};
    const fresh = Object.values(unread).reduce((n, x) => n + x, 0);
    if (fresh) head.insertBefore(el('span', 'td-chip is-new', `${fresh} new`), head.lastChild);
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

  function details() {
    const wrap = el('div');
    const s = data.student;
    const tc = tasksCard();
    if (tc) wrap.append(tc);
    if (F.LOST_STAGES.includes(s.stage) || profile().lostReason) {
      const kind = el('section', 'p-card');
      kind.append(el('h2', '', 'Why the student did not go on'));
      const reason = field('Reason', { kind: 'select', choices: F.LOST_REASONS, value: profile().lostReason, disabled: !can() });
      kind.append(reason.wrap);
      if (can()) {
        const bar = el('div', 'p-bar');
        bar.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { await save('profile', { lostReason: reason.input.value }, 'Saved'); render(); } }, 'Save'));
        kind.append(bar);
      }
      wrap.append(kind);
    }
    // While the source is being changed its form gets the card's full width (not the narrow left column beside the notes).
    if (editingOrigin) wrap.classList.add('p-editing-origin');
    wrap.append(origin(), notes());
    return wrap;
  }

  // ---- Where the student came from: shown as text, and changed only after pressing Edit ----
  let editingOrigin = false;
  function origin() {
    const p = profile();
    const s = data.student;
    const box = el('section', 'p-card p-origin');
    const head = el('div', 'p-card-head');
    const title = el('div');
    title.append(el('h2', '', 'Source'));
    head.append(title);
    if (can() && !editingOrigin) head.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { editingOrigin = true; render(); } }, 'Edit'));
    box.append(head);
    if (!editingOrigin) {
      // The source itself large, with a round initial (the owner, 15 Nov 2026: the source did not look well); the details under it
      // as quiet label and value rows.
      const g = F.sourceGroup(s.source);
      const main = el('div', `p-origin-main${g ? '' : ' is-empty'}`);
      const ico = el('span', 'p-origin-ico', g ? g.charAt(0) : '?');
      ico.setAttribute('aria-hidden', 'true');
      const mw = el('div');
      mw.append(el('b', '', g === 'Branch' ? s.source : g || 'Not recorded yet'));
      if (!g && can()) mw.append(el('small', '', 'Press Edit to add it.'));
      main.append(ico, mw);
      box.append(main);
      const dl = el('dl', 'p-origin-rows');
      const fact = (k, v) => { const d = el('div', 'p-origin-row'); d.append(el('dt', '', k), el('dd', '', v || 'Not recorded')); dl.append(d); };
      // An event or campaign is shown by its name: the date kept beside it in the records is the day the campaign started, not the
      // student's (the owner, 14 Nov 2026). The student's own first inquiry day and time are shown below it.
      const plain = (v) => String(v || '').replace(/,\s*\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}$/, '');
      if (g === 'Branch') { /* the branch is named in the line above ("Chitwan Branch") */ } else if (g === 'Social Media' && (p.sourcePlatform || p.sourceWay)) {
        fact('Platform', p.sourcePlatform);
        fact('How they came', p.sourceWay === 'Advert' ? `Advert: ${plain(p.sourceDetail) || 'campaign not named'}` : 'Organic (by itself)');
      } else if (p.sourceDetail || (F.SOURCE_DETAILS[g] || []).length || g === 'Agent') fact(F.SOURCE_DETAIL_LABEL[g] || (g === 'Agent' ? 'Which agent' : 'Where exactly'), plain(p.sourceDetail));
      if (p.inquiryDate) fact('First inquiry', `${day(p.inquiryDate)}${p.inquiryTime ? ` at ${p.inquiryTime}` : ''}`);
      if (p.sourceRemarks) fact('Remarks', p.sourceRemarks);
      if (dl.children.length) box.append(dl);
      return box;
    }
    const picker = window.SourcePicker.create({ lists, initial: { source: s.source, detail: p.sourceDetail, remarks: p.sourceRemarks, platform: p.sourcePlatform, way: p.sourceWay }, disabled: !data.can.source });
    const form = el('div', 'p-form');
    picker.nodes.forEach((n) => form.append(n));
    box.append(form);
    if (!data.can.source && s.source) box.append(el('p', 'p-muted p-small', 'Only Admin changes the source.'));
    const bar = el('div', 'p-bar');
    bar.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try {
        const missing = picker.check();
        if (missing) { say(missing, true); return; }
        await saveSource(picker.value());
        editingOrigin = false; render();
      } catch (e) { /* shown */ }
    } }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => { editingOrigin = false; render(); } }, 'Cancel'));
    box.append(bar);
    return box;
  }

  async function saveSource(v) {
    const s = data.student;
    if (data.can.source && v.source !== (s.source || '')) { await save('source', { source: v.source }); data.student.source = v.source; }
    await save('profile', { sourceDetail: v.detail, sourceRemarks: v.remarks, sourcePlatform: v.platform || '', sourceWay: v.way || '' }, 'Saved');
  }

  // What is still missing from the source ('' when it is complete): the source itself, and then how exactly the student reached us
  // (the branch, the platform and Organic or Advert, the event, the agent, the class, how a visitor came, who referred them).
  function sourceGap(v) {
    const g = v.group;
    if (!g) return 'Choose the student source.';
    if (g === 'Branch') return v.source ? '' : 'Choose the branch.';
    if (g === 'Social Media') {
      if (!v.platform) return 'Choose the platform.';
      if (!v.way) return 'Choose Organic or Advert.';
      return v.way === 'Advert' && !v.detail ? 'Choose the campaign.' : '';
    }
    if (!v.detail) return `Fill in: ${F.SOURCE_DETAIL_LABEL[g] || 'where exactly'}.`;
    return '';
  }
  const storedSourceValue = () => {
    const s = data.student; const p = profile(); const g = F.sourceGroup(s.source);
    return { group: g, source: s.source || '', detail: p.sourceDetail || '', platform: p.sourcePlatform || '', way: p.sourceWay || '' };
  };

  // Asked every time the card opens (the owner, 17 Nov 2026): what is still missing from the student. At Inquiry only the Student
  // Source (and how exactly the student reached us) is asked. From Application Stage on (Mock, Payment, CAS, visa ...) the details
  // needed to apply are asked too: phone, email, date of birth, passport number and the address in the passport. The application
  // and offer days are not asked at Application Stage (an application may not be submitted yet); past it, when no university has an
  // application day, the pop-up asks which university and the day, and from Payment Stage on the same for the offer (kept under
  // Applications). "Not now" closes it and the card is used as before; the next time the card opens it asks again, until nothing is
  // missing. Only for those who can change the card, and only what they may change.
  const ASK_STAGES = ['Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'];
  function missingDetails() {
    const s = data.student; const p = profile(); const row = s.row || {};
    const out = [];
    const sourceMissing = Boolean(sourceGap(storedSourceValue())) && (data.can.source || F.sourceGroup(s.source));
    if (!ASK_STAGES.includes(s.stage || '')) return { sourceMissing, fields: out };
    // Past Application Stage the student has applied, and from Payment Stage on holds an offer: when no university says so yet, the
    // pop-up asks which one and the day (the owner, 17 Nov 2026: the days must always be there). At Application Stage it never asks.
    const st = appStats();
    const askApp = s.stage !== 'Application Stage' && !st.submitted;
    const askOffer = ['Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'].includes(s.stage) && !st.offers;
    const blank = (v) => !String(v || '').trim();
    if (blank(row['CONTACT NUMBER'])) out.push({ on: 'sheet', key: 'CONTACT NUMBER', label: 'Phone number', max: 40 });
    if (blank(row.EMAIL)) out.push({ on: 'sheet', key: 'EMAIL', label: 'Email', max: 120 });
    if (blank(p.dob)) out.push({ on: 'profile', key: 'dob', label: 'Date of birth', kind: 'date' });
    if (blank(p.passportNo)) out.push({ on: 'profile', key: 'passportNo', label: 'Passport number', max: 20, upper: true });
    if (blank(p.address)) out.push({ on: 'profile', key: 'address', label: 'Address (as in the passport)', max: 200 });
    return { sourceMissing, fields: out, askApp, askOffer };
  }
  // A university to choose (the student's shortlisted or applied ones) or another one typed, with its course and a day.
  function uniQuestion(form, title, choices, dayLabel, withType) {
    form.append(el('h3', 'p-wide', title));
    const NEW = '__new';
    const pick = field('University', { kind: 'select', choices: [...choices.map((o) => [o.id, [o.university, o.course].filter(Boolean).join(': ')]), [NEW, 'Another university (type it)']], value: choices.length ? '' : NEW });
    const row = data.student.row || {};
    const uni = field('University name', { max: 160, value: String(row['UNIVERSITY NAME'] || '') });
    const course = field('Course', { max: 240, value: String(row['COURSE NAME'] || '') });
    const when2 = field(dayLabel, { kind: 'date' });
    when2.input.max = data.today || '';
    const type = withType ? field('Offer', { kind: 'select', choices: [['', 'Type not known'], ['Conditional', 'Conditional'], ['Unconditional', 'Unconditional']] }) : null;
    const showNew = () => { const n = pick.input.value === NEW; uni.wrap.hidden = !n; course.wrap.hidden = !n; };
    pick.input.addEventListener('change', showNew); showNew();
    form.append(pick.wrap, uni.wrap, course.wrap, when2.wrap, ...(type ? [type.wrap] : []));
    return {
      filled: () => Boolean(when2.input.value),
      check: () => (!when2.input.value ? '' : !pick.input.value ? 'Choose the university.' : pick.input.value === NEW && !uni.input.value.trim() ? 'Type the name of the university.' : ''),
      async save(key) {
        const extra = key === 'offer' ? { offer: when2.input.value, offerType: type ? type.input.value : '' } : { applied: when2.input.value };
        if (pick.input.value !== NEW) { await api(`/api/cards/${id}/options/${pick.input.value}`, extra); return; }
        // The same university typed for the application and the offer is one line: the second answer goes on the first.
        const u = uni.input.value.trim(); const c = course.input.value.trim(); const low = (v) => String(v || '').trim().toLowerCase();
        const now = (await api('/api/cards/' + encodeURIComponent(id))).card.options;
        const same = now.find((o) => low(o.university) === low(u) && (!c || !o.course || low(o.course) === low(c)));
        if (same) await api(`/api/cards/${id}/options/${same.id}`, extra);
        else await api(`/api/cards/${id}/options`, { university: u, course: c, ...extra });
      },
    };
  }
  async function askMissing() {
    if (!can()) return;
    const { sourceMissing, fields, askApp, askOffer } = missingDetails();
    if (!sourceMissing && !fields.length && !askApp && !askOffer) return;
    const s = data.student; const p = profile();
    const saved = await dialog(sourceMissing && !fields.length && !askApp && !askOffer ? 'Where did this student come from?' : 'Details missing for this student', (body, close) => {
      body.append(el('p', 'p-muted', `Some details of ${s.name || 'this student'} are missing. Fill in what you have now and press Save; what is left is asked again next time.`));
      const form = el('div', 'p-form');
      let picker = null;
      if (sourceMissing) {
        picker = window.SourcePicker.create({ lists, initial: { source: s.source, detail: p.sourceDetail, remarks: p.sourceRemarks, platform: p.sourcePlatform, way: p.sourceWay }, disabled: !data.can.source });
        picker.nodes.forEach((n) => form.append(n));
      }
      const inputs = fields.map((f) => {
        const x = field(f.label, { kind: f.kind, max: f.max });
        if (f.key === 'dob') x.input.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        form.append(x.wrap);
        return { f, input: x.input };
      });
      const opts = data.card.options;
      const appQ = askApp ? uniQuestion(form, 'Application submitted', opts.filter((o) => !o.applied && !o.skipped), 'Submitted on', false) : null;
      const offerQ = askOffer ? uniQuestion(form, 'Offer received', opts.filter((o) => !o.offer && !o.refused && !o.skipped), 'Offer received on', true) : null;
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        const v = picker ? picker.value() : null;
        const sourceChosen = Boolean(v && v.group);
        if (sourceChosen) { const gap = picker.check() || sourceGap(v); if (gap) { msg.textContent = gap; msg.className = 'p-msg error'; return; } }
        const qs = [appQ, offerQ].filter(Boolean);
        const qGap = qs.map((q) => q.check()).find(Boolean);
        if (qGap) { msg.textContent = qGap; msg.className = 'p-msg error'; return; }
        const filled = inputs.filter((x) => x.input.value.trim());
        if (!sourceChosen && !filled.length && !qs.some((q) => q.filled())) { msg.textContent = 'Fill in at least one detail, or press Not now.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try {
          if (sourceChosen) await saveSource(v);
          const value = (x) => (x.f.upper ? x.input.value.trim().toUpperCase() : x.input.value.trim());
          const prof = Object.fromEntries(filled.filter((x) => x.f.on === 'profile').map((x) => [x.f.key, value(x)]));
          const sheet = Object.fromEntries(filled.filter((x) => x.f.on === 'sheet').map((x) => [x.f.key, value(x)]));
          if (Object.keys(prof).length) await api(`/api/cards/${id}/profile`, prof);
          if (Object.keys(sheet).length) await api(`/api/cards/${id}/sheet`, { fields: sheet });
          if (appQ && appQ.filled()) await appQ.save('applied');
          if (offerQ && offerQ.filled()) await offerQ.save('offer');
          close(true);
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; ok.disabled = false; }
      });
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); ok.click(); } });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Not now'), ok);
      body.append(form, msg, foot);
    });
    if (saved) { data = await api('/api/cards/' + encodeURIComponent(id)); say('Saved'); render(); }
  }

  // ---- Notes (replace the Remarks column of the sheet) ----
  // A note is a note (the owner, 14 Nov 2026): no kinds to choose (phone call, office visit, message); notes kept with a kind
  // before still show, all simply as notes. Notes are about the student (IELTS booked, the CAS result, money ready); the talk with
  // a team about a piece of work is in the comments of its task.
  let noteDraft = '';
  function notes() {
    const wrap = el('section', 'p-card');
    // One timeline (the owner, 17 Nov 2026): every note, task, message and application step, newest first, so how the student moved
    // and every decision can be read day by day. The pills only narrow it for a moment; Everything is where it starts.
    // The title with one quiet line beside it: how many entries and when the last thing happened.
    const tlHead = el('div', 'p-tl-head');
    tlHead.append(el('h2', '', 'Timeline'));
    wrap.append(tlHead);
    // No sentence under the title (the owner, 15 Nov 2026: only what is needed).
    if (can()) {
      const box = el('div', 'p-note-box');
      const text = el('textarea', 'p-input');
      text.placeholder = 'e.g. IELTS booked for 6 December. The bank statement will be ready next week.  (Ctrl+Enter adds it)';
      text.setAttribute('aria-label', 'Write a note');
      text.maxLength = 4000;
      // What is typed survives a redraw of the card (a tab change, a task ticked) until it is added.
      text.value = noteDraft;
      text.addEventListener('input', () => { noteDraft = text.value; });
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add.click(); } });
      const bar = el('div', 'p-bar');
      bar.style.marginTop = '0';
      const add = h('button', { class: 'btn btn-primary', type: 'button' }, 'Add note');
      add.addEventListener('click', async () => {
        if (!text.value.trim()) { text.focus(); return; }
        add.disabled = true;
        try { await save('notes', { text: text.value, kind: 'note' }, 'Note added'); noteDraft = ''; render(); } catch (e) { add.disabled = false; }
      });
      bar.append(add);
      box.append(text, bar);
      wrap.append(box);
    }
    // The student's History (the owner, 15 Nov 2026): the notes and, without anyone typing them again, every task about the student:
    // who gave it to which team, each update, a reassignment or a move to another day, and who marked it done. Newest first.
    const short = (t) => (t.length > 70 ? t.slice(0, 67) + '...' : t);
    const teamName = (id) => (((data.taskTeams || []).find((x) => x.id === id) || {}).label || id).replace(/\s*\(.*\)$/, '');
    const events = data.card.notes.map((n) => ({ kind: 'note', at: n.at, by: n.by, text: n.text, note: n }));
    (data.card.tasks || []).forEach((t) => {
      const tag = window.Portal.tagOf(t, data.student.stage);
      events.push({ kind: 'task', at: t.at, by: t.by, title: `Gave ${teamName(t.team)} a task`, text: t.text, tag });
      (t.comments || []).forEach((c) => {
        if (c.handoff) events.push({ kind: 'task', at: c.at, by: c.by, title: `Reassigned “${short(t.text)}”: ${teamName(c.handoff.from)} → ${teamName(c.handoff.to)}`, text: c.text || '' });
        else if (c.schedule) events.push({ kind: 'task', at: c.at, by: c.by, title: c.schedule.to ? `Moved “${short(t.text)}” to ${window.Portal.dayLabel(c.schedule.to, data.today)}` : `Moved “${short(t.text)}” back to today`, text: c.text || '' });
        else if (c.text) events.push({ kind: 'update', at: c.at, by: c.by, title: `Update on “${short(t.text)}”`, text: c.text });
      });
      if (t.done && t.doneAt) events.push({ kind: 'done', at: t.doneAt, by: t.doneBy, title: `Done: “${short(t.text)}”`, text: '', task: t });
    });
    // The emails and WhatsApp messages sent from Follow-up are in the history too (the card itself sends nothing: Call, WhatsApp
    // and Email under the name open the person's own phone, WhatsApp or email program).
    (data.card.messages || []).forEach((m) => {
      const how = m.channel === 'whatsapp' ? 'WhatsApp opened' : m.status === 'sent' ? 'Email sent' : m.status === 'failed' ? 'Email not sent' : 'Email prepared';
      events.push({ kind: 'message', at: m.at, by: m.by, title: `${how}${m.subject ? `: “${short(m.subject)}”` : ''}`, text: '', message: m });
    });
    // Each course shortlisted and given to the Application Team (the answers are notes, written when they are recorded).
    data.card.options.forEach((o) => {
      const name = [o.university, o.course].filter(Boolean).join(', ');
      if (o.addedAt) events.push({ kind: 'app', at: o.addedAt, by: o.byStudent ? 'The student' : o.addedBy, title: `Shortlisted ${name}`, text: '' });
      if (o.sent) events.push({ kind: 'app', at: o.sent, dayOnly: true, by: '', title: `Given to the Application Team: ${name}${o.partner ? (/^direct$/i.test(o.partner) ? ', direct' : `, through ${o.partner}`) : ''}`, text: '' });
    });
    events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    const AUTO = 'ISR (automatic)';
    const kindOfEvent = (e) => (e.kind === 'note' ? 'note' : e.kind === 'message' ? 'message' : e.kind === 'app' ? 'app' : 'task');
    const counts = {};
    events.forEach((e) => { const k = kindOfEvent(e); counts[k] = (counts[k] || 0) + 1; });
    // The day of an entry in the reader's own time (YYYY-MM-DD), and how people say it: Today, Yesterday, Mon 16 Nov 2026.
    const localDay = (e) => { if (e.dayOnly) return String(e.at).slice(0, 10); const d = new Date(e.at); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const daysAgo = (iso) => Math.round((Date.parse(todayIso + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400000);
    const dayName = (iso) => { const n = daysAgo(iso); if (n === 0) return 'Today'; if (n === 1) return 'Yesterday'; const d = new Date(iso + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${day(iso)}`; };
    const agoText = (iso) => { const n = daysAgo(iso); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
    if (events.length) {
      const last = events[0];
      const sum = el('span', 'p-tl-sum', `${events.length} ${events.length === 1 ? 'entry' : 'entries'} · last ${agoText(localDay(last))}${last.by ? `, by ${last.by}` : ''}`);
      tlHead.append(sum);
    }
    // Who may change a note: the person who wrote it, or Admin. Anyone who can change the card may pin one to the top.
    const mayChange = (n) => can() && (n.by === data.me.name || data.can.removeAnyNote);
    // The words searched for, marked in yellow.
    const marked = (text) => {
      const t = String(text || ''); const q = historyQuery.trim();
      if (!q) return [t];
      const out = []; const low = t.toLowerCase(); const ql = q.toLowerCase(); let i = 0; let j;
      while ((j = low.indexOf(ql, i)) !== -1) { if (j > i) out.push(t.slice(i, j)); out.push(el('mark', '', t.slice(j, j + q.length))); i = j + q.length; }
      if (i < t.length) out.push(t.slice(i));
      return out;
    };
    // A note's words: long ones fold to a few lines with "Read more"; while it is being changed, a box with Save and Cancel.
    const noteBody = (n, li) => {
      if (editingNote === n.id) {
        const box = el('div', 'p-tl-edit');
        const ta = el('textarea', 'p-input');
        ta.value = n.text; ta.maxLength = 4000; ta.setAttribute('aria-label', 'Change the note');
        const bar = el('div', 'p-bar');
        const ok = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Save');
        ok.addEventListener('click', async () => {
          if (!ta.value.trim()) { ta.focus(); return; }
          ok.disabled = true;
          try { await save('notes/' + n.id, { text: ta.value }, 'Note changed'); editingNote = ''; render(); } catch (e) { ok.disabled = false; }
        });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } if (e.key === 'Escape') { e.stopPropagation(); editingNote = ''; render(); } });
        bar.append(ok, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { editingNote = ''; render(); } }, 'Cancel'));
        box.append(ta, bar);
        setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
        return [box];
      }
      const p = el('p');
      p.append(...marked(n.text));
      const long = n.text.length > 420 || n.text.split('\n').length > 6;
      if (!long || openNotes.has(n.id) || historyQuery.trim()) return [p];
      p.classList.add('p-tl-fold');
      const more = h('button', { class: 'p-link p-tl-more', type: 'button', onclick: () => { openNotes.add(n.id); p.classList.remove('p-tl-fold'); more.remove(); } }, 'Read more');
      li.classList.add('has-more');
      return [p, more];
    };
    // The buttons on a note: Pin (or Unpin), Change and Remove.
    const noteActs = (n) => {
      const acts = el('span', 'p-tl-acts');
      if (can() && !data.can.readOnly) acts.append(h('button', { class: `p-link${n.pinned ? ' is-on' : ''}`, type: 'button', title: n.pinned ? 'Take it off the top' : 'Keep it at the top of the Timeline', onclick: async () => { try { await save('notes/' + n.id, { pinned: !n.pinned }, n.pinned ? 'Unpinned' : 'Pinned to the top'); render(); } catch (e) { /* shown */ } } }, n.pinned ? 'Unpin' : 'Pin'));
      if (mayChange(n) && n.by !== AUTO) acts.append(h('button', { class: 'p-link', type: 'button', onclick: () => { editingNote = n.id; render(); } }, 'Change'));
      if (mayChange(n)) acts.append(h('button', { class: 'p-link', type: 'button', onclick: async () => { if (await window.NiecUI.confirm('Remove this note?', { danger: true })) { await save('notes/' + n.id + '/delete', {}, 'Note removed'); render(); } } }, 'Remove'));
      return acts;
    };
    const who = (name, fallback) => {
      const frag = [];
      const nm = name || fallback;
      const av = el('i', `p-tl-av${name === AUTO ? ' is-auto' : ''}`, name === AUTO ? 'ISR' : initials(nm));
      av.setAttribute('aria-hidden', 'true');
      frag.push(av, el('b', '', nm));
      return frag;
    };
    // One entry of the Timeline.
    const entry = (e, inPins) => {
      const k = e.kind === 'note' && e.by === AUTO ? 'auto' : e.kind;
      const li = el('li', `${e.kind === 'note' ? '' : `p-history-${e.kind} `}is-k-${k}`);
      const head = el('div', 'p-when');
      const t = e.dayOnly ? '' : new Date(e.at);
      const time = inPins ? (e.dayOnly ? day(e.at) : when(e.at)) : (t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : day(e.at));
      head.append(...who(e.by, e.kind === 'app' ? 'Applications' : 'Someone'), el('span', '', time));
      if (e.kind === 'note') {
        const n = e.note;
        if (n.by === AUTO) head.append(el('span', 'p-history-chip is-update', 'Automatic'));
        if (n.pinned && !inPins) head.append(el('span', 'p-history-chip is-pin', 'Pinned'));
        if (n.editedAt) { const ed = el('span', 'p-tl-edited', 'edited'); ed.title = `Changed ${when(n.editedAt)}${n.editedBy ? ` by ${n.editedBy}` : ''}`; head.append(ed); }
        head.append(noteActs(n));
        li.append(head, ...noteBody(n, li));
        return li;
      }
      head.append(el('span', `p-history-chip is-${e.kind === 'app' ? 'task' : e.kind}`, e.kind === 'done' ? 'Done' : e.kind === 'update' ? 'Update' : e.kind === 'message' ? 'Message' : e.kind === 'app' ? 'Application' : 'Task'));
      const acts = el('span', 'p-tl-acts');
      if (e.message && e.message.channel === 'email') acts.append(h('button', { class: 'p-link', type: 'button', onclick: () => readMessage(e.message) }, 'Read'));
      // A done task can be reopened (the team it is for, Admin and the Manager), and what it recorded put back (the owner, 16 Nov
      // 2026: a wrong answer is corrected in one step).
      const mayReopen = e.task && !data.can.readOnly && (data.can.removeAnyTask || (data.can.myTeams || []).includes(e.task.team) || (e.task.team === 'head' && (data.me || {}).role === 'admin'));
      if (mayReopen) {
        acts.append(h('button', { class: 'p-link', type: 'button', onclick: async () => {
          const how = await window.Portal.reopenDialog(e.task);
          if (!how) return;
          const r = await save(`tasks/${e.task.id}`, { done: false, finish: how }, 'Reopened');
          if (r && r.undone && r.undone.length) say(`Reopened. Put back: ${r.undone.join('; ')}${r.left && r.left.length ? `. ${r.left.join('; ')}` : ''}`);
          data = await api('/api/cards/' + encodeURIComponent(id)); render();
        } }, 'Reopen'));
      }
      if (acts.children.length) head.append(acts);
      const title = el('p', 'p-history-title');
      title.append(...marked(e.title));
      li.append(head, title);
      if (e.text) { const p = el('p'); p.append(...marked(e.text)); li.append(p); }
      if (e.tag) li.lastChild.prepend(el('span', `td-tag tag-${e.tag}`, window.Portal.tagLabel(e.tag)), ' ');
      return li;
    };
    // Pinned notes stay at the top, whatever is chosen below (the owner, 17 Nov 2026: the Timeline does more).
    const pins = events.filter((e) => e.kind === 'note' && e.note.pinned);
    if (pins.length) {
      const box = el('section', 'p-tl-pins');
      box.append(el('div', 'p-tl-pins-title', pins.length === 1 ? 'Pinned' : `Pinned (${pins.length})`));
      const ol = el('ol', 'p-timeline');
      pins.forEach((e) => ol.append(entry(e, true)));
      box.append(ol);
      wrap.append(box);
    }
    // The kinds to narrow to, each with how many, and a search through every word.
    const present = new Set(events.map(kindOfEvent));
    const tools = el('div', 'p-tl-tools');
    if (present.size > 1) {
      const seg = el('div', 'p-history-filter');
      seg.setAttribute('role', 'tablist');
      [['all', 'Everything'], ['note', 'Notes'], ['task', 'Tasks'], ['app', 'Applications'], ['message', 'Messages']].filter(([k]) => k === 'all' || present.has(k)).forEach(([k, label]) => {
        const b = h('button', { class: 'td-filter-pill', type: 'button', role: 'tab', 'aria-selected': String(historyFilter === k) }, label, el('span', 'td-filter-n', String(k === 'all' ? events.length : counts[k] || 0)));
        b.addEventListener('click', () => { historyFilter = k; render(); });
        seg.append(b);
      });
      tools.append(seg);
    }
    const list = el('ol', 'p-timeline');
    const moreBtn = h('button', { class: 'p-link p-tl-all', type: 'button' });
    if (events.length > 3) {
      const search = el('input', 'p-input p-tl-search');
      search.type = 'search';
      search.placeholder = 'Search the timeline';
      search.setAttribute('aria-label', 'Search the timeline');
      search.value = historyQuery;
      search.addEventListener('input', () => { historyQuery = search.value; fill(); });
      tools.append(search);
    }
    if (tools.children.length) wrap.append(tools);
    // The sheet's Remarks, unless it is only the latest progress line ISR wrote there (that is already a note above).
    const remark = data.student.remarks && data.student.remarks !== data.card.autoRemark ? data.student.remarks : '';
    const LIMIT = 8;
    function fill() {
      const q = historyQuery.trim().toLowerCase();
      // A pinned note is shown once, in Pinned above (a search still finds it here).
      const all = events.filter((e) => (historyFilter === 'all' || kindOfEvent(e) === historyFilter)
        && (q ? [e.by, e.title, e.text].some((v) => String(v || '').toLowerCase().includes(q)) : !(e.kind === 'note' && e.note.pinned)));
      const items = showAllNotes || q ? all : all.slice(0, LIMIT);
      list.replaceChildren();
      if (!all.length && (!remark || q)) list.append(el('li', 'p-tl-empty', q ? `Nothing found for “${historyQuery.trim()}”.` : 'Nothing yet.'));
      // Grouped by day, newest first, with the day as a small heading.
      let lastDay = null;
      items.forEach((e) => {
        const d = localDay(e);
        if (d !== lastDay) { lastDay = d; const dh = el('li', 'p-tl-day'); dh.append(el('span', '', dayName(d))); list.append(dh); }
        list.append(entry(e, false));
      });
      if (remark && !q && historyFilter !== 'task') { const li = el('li', 'is-k-auto'); li.append(el('div', 'p-when'), el('p', '', remark)); li.firstChild.append(el('b', '', 'Earlier remark from the sheet')); list.append(li); }
      moreBtn.hidden = Boolean(q) || all.length <= LIMIT;
      moreBtn.textContent = showAllNotes ? 'Show fewer' : `Show all ${all.length}`;
    }
    moreBtn.addEventListener('click', () => { showAllNotes = !showAllNotes; render(); });
    fill();
    wrap.append(list, moreBtn);
    return wrap;
  }

  // ---- University options ----
  // The shortlist (the owner, 17 Nov 2026): the courses shortlisted from the Fact File or added here, numbered 1, 2, 3 in the order to
  // apply. Nothing is typed: the fee, scholarship, deposit and course page come from the Fact File by themselves. "Email these options"
  // and "Assign to the Application Team" open the same windows as on the Fact File (fact-finder.js): the second asks, for every course,
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
    const waiting = data.card.options.filter((o) => !o.sent && !o.applied && !o.skipped);
    const ids = waiting.map((o) => o.id);
    sendOrder = (sendOrder || []).filter((x) => ids.includes(x));
    ids.forEach((x) => { if (!sendOrder.includes(x)) sendOrder.push(x); });
    return sendOrder.map((x) => waiting.find((o) => o.id === x));
  }
  // One shortlisted or applied course: its name, university, partner and what the Fact File says.
  function optionItem(o, waiting) {
    const item = el('li', 'p-chosen-item');
    const header = el('header');
    header.append(el('h3', '', `${o.course || o.university}`));
    const tools = el('div', 'p-chosen-tools');
    const i = waiting.indexOf(o);
    if (can() && i >= 0 && waiting.length > 1) {
      const move = (d) => () => { const j = i + d; if (j < 0 || j >= sendOrder.length) return; [sendOrder[i], sendOrder[j]] = [sendOrder[j], sendOrder[i]]; render(); };
      tools.append(h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'), h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move down', disabled: i === waiting.length - 1, onclick: move(1) }, '↓'));
    }
    // Taken off the shortlist right here (the owner, 17 Nov 2026: no going back to the Fact File), until an application is recorded.
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
    sub.append(el('span', '', [o.university, o.intake, o.level].filter(Boolean).join(' · ')));
    if (o.fromSheet) sub.append(el('span', 'p-chosen-partner', 'On All Students'));
    if (o.partner) sub.append(el('span', 'p-chosen-partner', /^direct$/i.test(o.partner) ? 'Direct' : `Through ${o.partner}`));
    if (o.sent && !o.applied) sub.append(el('span', 'p-applied is-sent', `With the Application Team since ${day(o.sent)}, not submitted yet`));
    if (o.applied) sub.append(el('span', 'p-applied', `Submitted ${day(o.applied)}`));
    if (o.offer) sub.append(el('span', 'p-applied is-offer', `${o.offerType ? o.offerType + ' offer' : 'Offer'} ${day(o.offer)}`));
    if (o.refused) sub.append(el('span', 'p-applied is-refused', `Refused ${day(o.refused)}`));
    if (o.withdrawn) sub.append(el('span', 'p-applied is-refused', `Withdrawn ${day(o.withdrawn)}`));
    if (o.skipped) sub.append(el('span', 'p-applied is-refused', `Not submitted (${day(o.skipped)})`));
    if (o.applied && !o.offer && !o.refused && !o.withdrawn) sub.append(el('span', 'p-applied is-sent', 'Waiting for the answer'));
    item.append(sub);
    if (o.reason && (o.refused || o.withdrawn || o.skipped)) item.append(el('p', 'p-muted p-small', `Reason: ${o.reason}`));
    // What the Fact File says, read only (the owner, 17 Nov 2026: "I don't want to fill any details").
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
    if (o.fromSheet) {
      // Kept in University options first (with the days All Students has), then updated like any other.
      const r = await save('options', { university: o.university, course: o.course, applied: o.applied, offer: o.offer });
      o = (r && r.option) || data.card.options.find((x) => x.university === o.university);
      if (!o) return;
    }
    const todayIso = data.today || new Date().toISOString().slice(0, 10);
    const saved = await dialog(`${o.university}${o.course ? ': ' + o.course : ''}`, (body, close) => {
      const form = el('div', 'p-form');
      const applied = field('Application submitted on', { kind: 'date', value: o.applied || '' });
      const now = o.skipped ? 'skipped' : o.refused ? 'refused' : o.withdrawn ? 'withdrawn' : o.offer ? (o.offerType || 'offer') : '';
      const result = field('Answer from the university', { kind: 'select', choices: RESULTS, value: now });
      const when2 = field('Day of the answer', { kind: 'date', value: o.skipped || o.refused || o.withdrawn || o.offer || '' });
      const reason = field('Reason', { max: 300, value: o.reason || '', placeholder: 'e.g. Grades below the entry requirement, course full' });
      [applied, when2].forEach((f) => { f.input.max = todayIso; });
      const show = () => { const r = result.input.value; when2.wrap.hidden = !r; reason.wrap.hidden = !WITH_REASON.includes(r); applied.wrap.hidden = r === 'skipped'; when2.wrap.querySelector('.p-label').textContent = r === 'skipped' ? 'Decided on' : 'Day of the answer'; };
      result.input.addEventListener('change', show);
      show();
      form.append(applied.wrap, result.wrap, when2.wrap, reason.wrap);
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        const r = result.input.value; const d = when2.input.value; const a = applied.input.value;
        const fail = (t) => { msg.textContent = t; msg.className = 'p-msg error'; };
        if (r && !a && !['withdrawn', 'skipped'].includes(r)) return fail('Fill in the day the application was submitted.');
        if (r && !d) return fail('Fill in the day of the answer.');
        if (a && d && d < a) return fail('The answer cannot come before the application was submitted.');
        if (WITH_REASON.includes(r) && !reason.input.value.trim()) return fail('Write the reason in a few words.');
        ok.disabled = true;
        const offer = ['offer', 'Conditional', 'Unconditional'].includes(r);
        try {
          await save('options/' + o.id, { applied: r === 'skipped' ? '' : a, offer: offer ? d : '', offerType: offer && r !== 'offer' ? r : '', refused: r === 'refused' ? d : '', withdrawn: r === 'withdrawn' ? d : '', skipped: r === 'skipped' ? d : '', reason: WITH_REASON.includes(r) ? reason.input.value.trim() : '' }, 'Saved');
          close({ a, offer: offer ? d : '' });
        } catch (e) { fail(e.message); ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      body.append(form, msg, foot);
    });
    // All Students' own two columns follow by themselves on the server (the first application and the first offer).
    if (saved) refreshCard();
  }

  function chosenOptions() {
    const box = el('section', 'p-card');
    const head = el('div', 'p-card-head');
    const waiting = waitingOptions();
    head.append(el('h2', '', `Shortlist (${waiting.length})`));
    const acts = el('div', 'p-card-acts');
    // Straight to the Fact File with this student already chosen, so the team shortlists without searching for the student again.
    // target _top: from the half card (an iframe on All Students) the Fact File opens as the whole page, not inside the card.
    if (can()) acts.append(h('a', { class: 'btn btn-sm', href: '/fact-file?for=' + encodeURIComponent(id), target: '_top' }, 'Shortlist course'));
    if (data.card.options.length) {
      acts.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.OptionActions.email(studentRef(), waiting.length ? waiting : data.card.options).then((r) => { if (r) refreshCard(); }) }, 'Email these options'));
      if (waiting.length && can()) acts.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.OptionActions.assign(studentRef(), waitingOptions()).then((r) => { if (r) { sendOrder = null; refreshCard(); } }) }, 'Assign to the Application Team'));
    }
    if (acts.children.length) head.append(acts);
    box.append(head);
    if (!waiting.length) box.append(el('p', 'p-muted', 'No course waiting to be assigned. Press "Shortlist course" to open the Fact File with this student chosen.'));
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
    box.append(el('h2', '', `Universities applied to (${apps.length})`));
    if (!apps.length) { box.append(el('p', 'p-muted', 'Nothing assigned yet. Shortlist courses above and press "Assign to the Application Team".')); return box; }
    const waitingTeam = apps.filter((o) => o.sent && !o.applied && !o.skipped && !o.withdrawn).length;
    box.append(el('p', 'p-muted p-small', `${submitted} submitted, ${offers} with an offer${waitingTeam ? `, ${waitingTeam} with the Application Team, not submitted yet` : ''}. Record submission or Update keeps each university's days.`));
    const order = (o) => (o.offer ? 0 : o.applied && !o.refused && !o.withdrawn ? 1 : o.sent && !o.applied && !o.skipped ? 2 : 3);
    const list = el('ol', 'p-chosen');
    apps.slice().sort((a, b) => order(a) - order(b) || Number(a.rank || 99) - Number(b.rank || 99)).forEach((o) => list.append(optionItem(o, [])));
    box.append(list);
    return box;
  }
  // University options (the owner, 17 Nov 2026): the Shortlist (courses waiting to be assigned, with Shortlist course, which opens the
  // whole Fact File page with this student chosen, and Assign to the Application Team), then Applications: every university assigned
  // or applied to, with the course, the day it was submitted and the answer (offer, refused or withdrawn with the reason).
  function optionsTab() {
    const wrap = el('div');
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
    const box = el('section', 'p-checks');
    box.append(el('h2', '', 'Details to check'));
    const list = el('ul');
    data.checks.forEach((c) => {
      const li = el('li');
      li.append(el('span', '', c.text));
      if (can()) li.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await save('checks', { key: c.key }, 'Marked as checked'); data = await api('/api/cards/' + encodeURIComponent(id)); render(); } }, 'It is correct'));
      list.append(li);
    });
    box.append(list, el('p', 'p-muted p-small', 'Wrong? Correct it with Edit above, or on All Students.'));
    return box;
  }
  // ---- fewer clicks (the owner, 17 Nov 2026) ----
  // Working through a list (Data to fix, "Work through them"): "3 of 12" with Previous and Next, and the [ and ] keys, so the next
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
  // One tap to reach the student: call, WhatsApp or email (no Copy number, the owner, 17 Nov 2026).
  function contactBar() {
    const s = data.student;
    const wa = F.whatsappNumber(s.phone);
    if (!s.phone && !s.email) return null;
    const bar = el('div', 'p-reach');
    // Call rings the student from the person's own phone, as WhatsApp does (phone-link.js); with no phone connected it says how.
    if (s.phone) bar.append(h('a', { class: 'p-reach-btn', href: 'tel:' + String(s.phone).replace(/[^\d+]/g, ''), onclick: (e) => { if (!window.PhoneLink || !wa) return; e.preventDefault(); window.PhoneLink.call({ id, number: wa, name: s.name }); } }, el('span', 'p-reach-ico', '☎'), 'Call'));
    if (wa) bar.append(h('a', { class: 'p-reach-btn is-wa', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', onclick: (e) => { e.preventDefault(); window.Portal.whatsapp(wa, s.name, '', id); } }, el('span', 'p-reach-ico', '●'), 'WhatsApp'));
    if (s.email) bar.append(h('a', { class: 'p-reach-btn', href: 'mailto:' + s.email }, el('span', 'p-reach-ico', '@'), 'Email'));
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
    const box = el('section', 'p-next');
    const words = el('div', 'p-next-words');
    words.append(el('span', 'p-next-eyebrow', 'Next step'), el('b', '', step.title), el('span', 'p-next-why', step.why));
    const act = el('div', 'p-next-act');
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
    box.append(words, act);
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
    if (!editingHero) { const r = contactBar(); if (r) frag.append(r); const n = nextStep(); if (n) frag.append(n); }
    if ((data.checks || []).length) frag.append(checksBox());
    if (!can()) frag.append(el('div', 'p-notice', 'View only.'));
    const tabs = el('div', 'p-tabs');
    tabs.style.marginTop = '16px';
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
    frag.append(tabs);
    frag.append(tab === 'options' ? optionsTab() : details());
    view.replaceChildren(frag);
  }

  async function start() {
    if (!id) { view.replaceChildren(el('div', 'p-card', 'Choose a student from the sheet first.')); return; }
    try {
      const [d, l] = await Promise.all([api('/api/cards/' + encodeURIComponent(id)), api('/api/card-lists')]);
      data = d; lists = l;
      if (!TABS.some(([k]) => k === tab)) tab = 'details';
      render();
    } catch (e) {
      view.replaceChildren(h('div', { class: 'p-card' }, el('h1', 'p-error-title', 'This student cannot be opened'), el('p', '', e.message), h('a', { class: 'btn', href: '/students' }, 'Back to All Students')));
      return;
    }
    askMissing();
  }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (data && t !== tab && TABS.some(([k]) => k === t)) { tab = t; render(); } });
  start();
})();
