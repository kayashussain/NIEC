// One student's card (student.html), kept short: Notes (where the student came from, the notes and the history) and University
// options. Call, WhatsApp, Email and Copy number are one tap under the name; messages to many students go from Follow-up. The sheet's own details are changed on the sheet; the card never changes them except the Student Source,
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
  const TABS = [['details', 'Notes'], ['options', 'University options']];
  let tab = (location.hash || '#details').slice(1);
  const view = document.getElementById('view');
  const say = (text, error) => window.NiecUI.toast(text, { type: error ? 'error' : 'success' });

  if (embedded) {
    document.body.classList.add('p-embed');
    document.getElementById('closeEmbed').addEventListener('click', () => parent.postMessage({ niecCard: 'close' }, location.origin));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('dialog[open], .p-dialog')) parent.postMessage({ niecCard: 'close' }, location.origin); });
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
  const HERO_FIELDS = [['FIRST NAME', 'First name'], ['LAST NAME', 'Last name'], ['EMAIL', 'Email'], ['CONTACT NUMBER', 'Contact number'], ['UNIVERSITY NAME', 'University'], ['COURSE NAME', 'Course'], ['APPLICATION SUBMISSION DATE', 'Application submitted', 'date'], ['OFFER RECEIVED DATE', 'Offer received', 'date']];
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
    fact('Application submitted', s.row['APPLICATION SUBMISSION DATE'] ? day(s.row['APPLICATION SUBMISSION DATE']) : '');
    fact('Offer received', s.row['OFFER RECEIVED DATE'] ? day(s.row['OFFER RECEIVED DATE']) : '');
    if (pp.nationality && pp.nationality !== 'Nepali') fact('Nationality', pp.nationality);
    mid.append(facts);
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
    // Only the open tasks: a done one is in Notes and history (the owner, 15 Nov 2026). Something new first, then the longest waiting.
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
        const v = picker.value();
        if (data.can.source && v.source !== (s.source || '')) { await save('source', { source: v.source }); data.student.source = v.source; }
        await save('profile', { sourceDetail: v.detail, sourceRemarks: v.remarks, sourcePlatform: v.platform || '', sourceWay: v.way || '' }, 'Saved');
        editingOrigin = false; render();
      } catch (e) { /* shown */ }
    } }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => { editingOrigin = false; render(); } }, 'Cancel'));
    box.append(bar);
    return box;
  }

  // ---- Notes (replace the Remarks column of the sheet) ----
  // A note is a note (the owner, 14 Nov 2026): no kinds to choose (phone call, office visit, message); notes kept with a kind
  // before still show, all simply as notes. Notes are about the student (IELTS booked, the CAS result, money ready); the talk with
  // a team about a piece of work is in the comments of its task.
  function notes() {
    const wrap = el('section', 'p-card');
    wrap.append(el('h2', '', 'Notes and history'));
    // No sentence under the title (the owner, 15 Nov 2026: only what is needed).
    if (can()) {
      const box = el('div', 'p-note-box');
      const text = el('textarea', 'p-input');
      text.placeholder = 'e.g. IELTS booked for 6 December. The bank statement will be ready next week.';
      text.setAttribute('aria-label', 'Write a note');
      text.maxLength = 4000;
      const bar = el('div', 'p-bar');
      bar.style.marginTop = '0';
      const add = h('button', { class: 'btn btn-primary', type: 'button' }, 'Add note');
      add.addEventListener('click', async () => {
        if (!text.value.trim()) { text.focus(); return; }
        add.disabled = true;
        try { await save('notes', { text: text.value, kind: 'note' }, 'Note added'); render(); } catch (e) { add.disabled = false; }
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
    events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    const kindOfEvent = (e) => (e.kind === 'note' ? 'note' : e.kind === 'message' ? 'message' : 'task');
    const present = new Set(events.map(kindOfEvent));
    if (present.size > 1) {
      const seg = el('div', 'p-history-filter');
      seg.setAttribute('role', 'tablist');
      [['all', 'Everything'], ['note', 'Notes'], ['task', 'Tasks'], ['message', 'Messages']].filter(([k]) => k === 'all' || present.has(k)).forEach(([k, label]) => {
        const b = h('button', { class: 'td-filter-pill', type: 'button', role: 'tab', 'aria-selected': String(historyFilter === k) }, label);
        b.addEventListener('click', () => { historyFilter = k; render(); });
        seg.append(b);
      });
      wrap.append(seg);
    }
    const all = events.filter((e) => historyFilter === 'all' || kindOfEvent(e) === historyFilter);
    const list = el('ol', 'p-timeline');
    const items = showAllNotes ? all : all.slice(0, 6);
    // The sheet's Remarks, unless it is only the latest progress line ISR wrote there (that is already a note above).
    const remark = data.student.remarks && data.student.remarks !== data.card.autoRemark ? data.student.remarks : '';
    if (!all.length && !remark) list.append(el('li', '', 'Nothing yet.'));
    items.forEach((e) => {
      const li = el('li', e.kind === 'note' ? '' : `p-history-${e.kind}`);
      const head = el('div', 'p-when');
      head.append(el('b', '', e.by || 'Someone'), el('span', '', when(e.at)));
      if (e.kind === 'note') {
        const n = e.note;
        if (can() && (n.by === data.me.name || data.can.removeAnyNote)) head.append(h('button', { class: 'p-link', type: 'button', onclick: async () => { if (await window.NiecUI.confirm('Remove this note?', { danger: true })) { await save('notes/' + n.id + '/delete', {}, 'Note removed'); render(); } } }, 'Remove'));
        li.append(head, el('p', '', e.text));
      } else {
        head.append(el('span', `p-history-chip is-${e.kind}`, e.kind === 'done' ? 'Done' : e.kind === 'update' ? 'Update' : e.kind === 'message' ? 'Message' : 'Task'));
        if (e.message && e.message.channel === 'email') head.append(h('button', { class: 'p-link', type: 'button', onclick: () => readMessage(e.message) }, 'Read'));
        // A done task can be reopened (the team it is for, Admin and the Manager), and what it recorded put back (the owner, 16 Nov
        // 2026: a wrong answer is corrected in one step).
        const mayReopen = e.task && !data.can.readOnly && (data.can.removeAnyTask || (data.can.myTeams || []).includes(e.task.team) || (e.task.team === 'head' && (data.me || {}).role === 'admin'));
        if (mayReopen) {
          head.append(h('button', { class: 'p-link', type: 'button', onclick: async () => {
            const how = await window.Portal.reopenDialog(e.task);
            if (!how) return;
            const r = await save(`tasks/${e.task.id}`, { done: false, finish: how }, 'Reopened');
            if (r && r.undone && r.undone.length) say(`Reopened. Put back: ${r.undone.join('; ')}${r.left && r.left.length ? `. ${r.left.join('; ')}` : ''}`);
            data = await api('/api/cards/' + encodeURIComponent(id)); render();
          } }, 'Reopen'));
        }
        li.append(head, el('p', 'p-history-title', e.title));
        if (e.text) li.append(el('p', '', e.text));
        if (e.tag) li.lastChild.prepend(el('span', `td-tag tag-${e.tag}`, window.Portal.tagLabel(e.tag)), ' ');
      }
      list.append(li);
    });
    if (remark && historyFilter !== 'task') { const li = el('li'); li.append(el('div', 'p-when'), el('p', '', remark)); li.firstChild.append(el('b', '', 'Earlier remark from the sheet')); list.append(li); }
    wrap.append(list);
    if (all.length > 6) wrap.append(h('button', { class: 'p-link', type: 'button', style: 'margin-top:8px', onclick: () => { showAllNotes = !showAllNotes; render(); } }, showAllNotes ? 'Show fewer' : `Show all ${all.length}`));
    return wrap;
  }

  // ---- University options ----
  function chosenOptions() {
    const box = el('section', 'p-card');
    const head = el('div', 'p-card-head');
    head.append(el('h2', '', `Options for this student (${data.card.options.length})`));
    if (data.card.options.length) head.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openCompose('options') }, 'Email these options'));
    box.append(head);
    if (!data.card.options.length) { box.append(el('p', 'p-muted', 'No options yet. Search below and press Add.')); return box; }
    const list = el('div', 'p-chosen');
    data.card.options.forEach((o) => {
      const item = el('div', 'p-chosen-item');
      const header = el('header');
      header.append(el('h4', '', `${o.university}${o.course ? ': ' + o.course : ''}${o.intake ? ' (' + o.intake + ')' : ''}`));
      if (o.applied) header.firstChild.append(' ', el('span', 'p-applied', `Applied ${day(o.applied)}`));
      if (o.offer) header.firstChild.append(' ', el('span', 'p-applied is-offer', `${o.offerType ? o.offerType + ' offer' : 'Offer'} ${day(o.offer)}`));
      if (o.refused) header.firstChild.append(' ', el('span', 'p-applied is-refused', `Refused ${day(o.refused)}`));
      if (o.withdrawn) header.firstChild.append(' ', el('span', 'p-applied is-refused', `Withdrawn ${day(o.withdrawn)}`));
      if (can()) header.append(h('button', { class: 'p-link', type: 'button', onclick: async () => { await save('options/' + o.id + '/delete', {}); render(); } }, 'Remove'));
      const form = el('div', 'p-form');
      const fee = field('Tuition fee', { value: o.fee, disabled: !can(), max: 400 });
      const dep = field('Minimum cash deposit', { value: o.deposit, disabled: !can(), max: 400 });
      const sch = field('Scholarship', { value: o.scholarship, disabled: !can(), max: 400 });
      const link = field('Course link', { value: o.link, disabled: !can(), max: 500, placeholder: 'https://…' });
      const note = field('Note for the student', { value: o.note, disabled: !can(), max: 400 });
      if (!o.link && can()) {
        // No link yet: the server looks the course page up and the link is filled in and kept.
        window.SendToStudent.lookupLink(o).then(async (found) => {
          if (!found) { const f = el('a', 'p-link p-small', 'Search for the course page'); f.href = F.courseSearchUrl(o); f.target = '_blank'; f.rel = 'noopener'; link.wrap.append(f); return; }
          link.input.value = found;
          try { await save('options/' + o.id, { link: found }); o.link = found; } catch (e) { /* shown */ }
        });
      }
      form.append(fee.wrap, dep.wrap, sch.wrap, link.wrap, note.wrap);
      item.append(header, form);
      if (can()) {
        const save1 = h('button', { class: 'btn btn-sm', type: 'button' }, 'Save changes');
        save1.addEventListener('click', async () => { try { await save('options/' + o.id, { fee: fee.input.value, deposit: dep.input.value, scholarship: sch.input.value, link: link.input.value, note: note.input.value }, 'Saved'); render(); } catch (e) { /* shown */ } });
        item.append(el('div', 'p-bar'));
        item.lastChild.append(save1);
      }
      list.append(item);
    });
    box.append(list);
    return box;
  }
  async function addOption(o) {
    try { await save('options', { universityId: o.universityId, university: o.university, course: o.course, level: o.level, intake: o.intake, fee: o.fee, deposit: o.deposit, scholarship: o.scholarship, link: o.link }, 'Added to the options'); render(); } catch (e) { /* shown */ }
  }
  function optionCard(o) {
    const c = el('div', `p-option${o.closed ? ' closed' : ''}`);
    const left = el('div');
    left.append(el('h4', '', o.course), el('div', 'p-uni', `${o.university}${o.intake ? ' · ' + o.intake : ''}${o.level ? ' · ' + o.level : ''}`));
    c.append(left);
    const act = el('div', 'p-option-act');
    if (can()) act.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => addOption(o) }, 'Add'));
    if (o.universityId) { const open = h('a', { class: 'btn btn-sm', href: '/fact-file?u=' + encodeURIComponent(o.universityId), target: '_blank', rel: 'noopener' }, 'Open'); act.append(open); }
    c.append(act);
    const money = el('div', 'p-money');
    [['Fee', o.fee], ['Scholarship', o.scholarship]].forEach(([k, v]) => { const sp = el('span'); sp.append(el('span', 'p-muted', k + ': '), el('b', '', v || 'to be confirmed')); money.append(sp); });
    c.append(money);
    const w = el('div', 'p-why');
    const addLink = (text, href) => { const a = el('a', 'p-link p-small', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (w.childNodes.length) w.append(' · '); w.append(a); };
    if (o.link) addLink(o.linkIsCourse ? 'Course page' : 'University website', o.link);
    if (!o.linkIsCourse) addLink('Search for the course page', F.courseSearchUrl(o));
    c.append(w);
    return c;
  }
  // University options (the owner, 14 Nov 2026): the study level, a course search with its own Search button, and remarks. Each course
  // found has Add (to this student's options) and Open (its university's page in the Fact File). What is typed is kept on the card.
  function optionsTab() {
    const wrap = el('div');
    wrap.append(chosenOptions());
    const p = profile();
    const lock = !can();
    const box = el('section', 'p-card');
    box.append(el('h2', '', 'Find a course'));
    const form = el('form', 'p-find');
    const lv = field('Study level', { kind: 'select', choices: [['', 'Any level'], ...F.STUDY_LEVELS.map((x) => [x, x])], value: F.OLDER_STUDY_LEVELS[p.studyLevel] || p.studyLevel });
    const q = field('Course name', { placeholder: 'e.g. Cyber Security, Nursing, Business', value: p.subject || '', max: 160 });
    q.input.type = 'search';
    const go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Search');
    // In the owner's order (15 Nov 2026): Study level, Course name, Remarks, then Search.
    const remarks = field('Remarks', { kind: 'area', wide: true, value: p.optionRemarks || '', max: 1500, disabled: lock, placeholder: 'e.g. Prefers Manchester or London, 5 options, 2 year study gap' });
    remarks.input.rows = 2;
    form.append(lv.wrap, q.wrap, remarks.wrap, go);
    const out = el('div', 'p-option-results');
    box.append(form, out);
    wrap.append(box);
    let saved = JSON.stringify([p.studyLevel || '', p.subject || '', p.optionRemarks || '']);
    // What was searched and the remarks are kept on the card, only when something changed.
    const keep = () => {
      if (lock) return;
      const now = [lv.input.value, q.input.value.trim(), remarks.input.value.trim()];
      if (JSON.stringify(now) === saved) return;
      saved = JSON.stringify(now);
      save('profile', { studyLevel: now[0], subject: now[1], optionRemarks: now[2] }, '').catch(() => {});
    };
    const run = async () => {
      keep();
      go.disabled = true;
      out.replaceChildren(el('div', 'p-muted p-small', 'Searching…'));
      try {
        const r = await api('/api/courses?' + new URLSearchParams({ q: q.input.value, level: lv.input.value }));
        out.replaceChildren(el('div', 'p-muted p-small p-found', r.total ? `${r.total} course${r.total === 1 ? '' : 's'}${r.total > r.options.length ? `, the first ${r.options.length} shown` : ''}` : 'No course found. Try fewer words.'));
        r.options.forEach((o) => out.append(optionCard(o)));
      } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); }
      go.disabled = false;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
    lv.input.addEventListener('change', run);
    remarks.input.addEventListener('blur', keep);
    if (p.subject || p.studyLevel) run();
    else out.append(el('p', 'p-muted p-small', 'Choose a level or type a course, then Search.'));
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
  // One tap to reach the student: call, WhatsApp, email, or copy the number.
  function contactBar() {
    const s = data.student;
    const wa = F.whatsappNumber(s.phone);
    if (!s.phone && !s.email) return null;
    const bar = el('div', 'p-reach');
    if (s.phone) bar.append(h('a', { class: 'p-reach-btn', href: 'tel:' + String(s.phone).replace(/[^\d+]/g, '') }, el('span', 'p-reach-ico', '☎'), 'Call'));
    if (wa) bar.append(h('a', { class: 'p-reach-btn is-wa', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', onclick: (e) => { e.preventDefault(); window.Portal.whatsapp(wa, s.name, '', id); } }, el('span', 'p-reach-ico', '●'), 'WhatsApp'));
    if (s.email) bar.append(h('a', { class: 'p-reach-btn', href: 'mailto:' + s.email }, el('span', 'p-reach-ico', '@'), 'Email'));
    if (s.phone) bar.append(h('button', { class: 'p-reach-btn', type: 'button', onclick: async () => say(await window.Portal.copy(s.phone) ? `Copied ${s.phone}` : 'Could not copy', false) }, el('span', 'p-reach-ico', '⎘'), 'Copy number'));
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
    else if (s.stage === 'Application Stage' && !applied) step = { title: 'Record the application', why: 'When the application is submitted, pick the day: All Students is updated.', col: 'APPLICATION SUBMISSION DATE', label: 'Submitted on' };
    else if (applied && !iso(row['OFFER RECEIVED DATE']) && ['Application Stage', 'Mock Stage'].includes(s.stage)) {
      const waited = Math.max(0, Math.round((Date.parse(data.today || new Date().toISOString().slice(0, 10)) - Date.parse(applied)) / 86400000));
      step = { title: 'Record the offer', why: `Applied ${day(applied)}, ${waited} ${waited === 1 ? 'day' : 'days'} ago. When the offer comes, pick the day.`, col: 'OFFER RECEIVED DATE', label: 'Offer received on', min: applied };
    } else if (s.stage && !['Inquiry', 'Visa Issued', ...F.LOST_STAGES].includes(s.stage) && (!pp.dob || !pp.passportNo || !pp.address)) {
      const gone = [['date of birth', pp.dob], ['passport number', pp.passportNo], ['address', pp.address]].filter(([, v]) => !v).map(([k]) => k);
      step = { title: 'Add the passport details', why: `Still missing: ${gone.join(', ')}.`, edit: true };
    }
    if (!step) return null;
    const box = el('section', 'p-next');
    const words = el('div', 'p-next-words');
    words.append(el('span', 'p-next-eyebrow', 'Next step'), el('b', '', step.title), el('span', 'p-next-why', step.why));
    const act = el('div', 'p-next-act');
    if (step.edit) act.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { editingHero = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Add them'));
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

  function render() {
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
      view.replaceChildren(h('div', { class: 'p-card' }, el('h2', '', 'This student cannot be opened'), el('p', '', e.message), h('a', { class: 'btn', href: '/students' }, 'Back to All Students')));
    }
  }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (data && t !== tab && TABS.some(([k]) => k === t)) { tab = t; render(); } });
  start();
})();
