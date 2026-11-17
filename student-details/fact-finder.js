// Shortlisting from the Fact File for a student (the owner, 17 Nov 2026). The team chooses the student once (kept while the browser tab
// is open), then presses Shortlist beside any course: on a university's page, in the search results ("nursing" lists every matching
// course of every university) and in "Find universities for a student". Nobody leaves the Fact File: a tray at the bottom of the page
// holds the student's shortlist, numbered 1, 2, 3 in the order to apply, with
//
//   Email these options             the student gets the courses in one email (fee, scholarship, deposit and course page by themselves)
//   Assign to the Application Team  asks, for every course, through which partner it goes (Direct or a B2B partner) and for notes,
//                                   then gives the Application Team one task with the numbered list
//   Open the card                   the student card in a new tab, so the Fact File stays where it was
//
// The same two windows are used on the student card (student-page.js) through window.OptionActions.
//
// Also the look-up of a course's page on the university's website for the student card (SendToStudent.lookupLink).
(function (root) {
  const { el, h, api, field, dialog } = root.Portal;
  const say = (t, e) => root.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const KEY = 'isrShortlistFor';
  const state = { student: null, options: [], listeners: [], order: null, open: false };
  const optKey = (universityId, course, intake) => `${universityId}|${String(course).toLowerCase()}|${String(intake || '').toLowerCase()}`;
  const changed = () => { state.listeners.forEach((f) => f()); drawTray(); };

  function remembered() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function remember(s) { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) { /* kept for this page only */ } }

  async function loadOptions() {
    if (!state.student) { state.options = []; return; }
    try {
      const r = await api(`/api/cards/${encodeURIComponent(state.student.id)}`);
      state.options = (r.card && r.card.options) || [];
      state.student.email = (r.student && r.student.row && r.student.row.EMAIL) || '';
    } catch (e) { state.student = null; remember(null); state.options = []; }
  }
  // The courses not yet given to the Application Team, in the order chosen in the tray.
  function waiting() {
    const list = state.options.filter((o) => !o.sent && !o.applied);
    const ids = list.map((o) => o.id);
    state.order = (state.order || []).filter((x) => ids.includes(x));
    ids.forEach((x) => { if (!state.order.includes(x)) state.order.push(x); });
    return state.order.map((x) => list.find((o) => o.id === x));
  }

  // Pick one student from the ones this account sees (by name, email or phone number).
  function pickStudent() {
    return dialog('Shortlist for which student?', (body, close) => {
      const q = field('Search', { placeholder: 'Name, email or phone number', max: 100 });
      const results = el('div', 'p-pick-list');
      body.append(q.wrap, results);
      let timer;
      const run = async () => {
        try {
          const r = await api('/api/students/search?q=' + encodeURIComponent(q.input.value));
          results.replaceChildren(...(r.students.length ? r.students.map((s) => {
            const b = el('button', 'p-pick');
            b.type = 'button';
            const t = el('span', 'p-pick-text');
            t.append(el('b', '', s.name), el('small', '', [s.stage, s.intake, s.email].filter(Boolean).join(' · ')));
            b.append(el('span', 'p-avatar sm', root.Portal.initials(s.name)), t);
            b.addEventListener('click', () => close({ id: s.id, name: s.name }));
            return b;
          }) : [el('div', 'p-empty', 'No student found.')]));
        } catch (e) { results.replaceChildren(el('div', 'p-notice bad', e.message)); }
      };
      q.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
      run();
      setTimeout(() => q.input.focus(), 30);
    });
  }
  async function choose() {
    const s = await pickStudent();
    if (!s) return false;
    state.student = s;
    state.order = null;
    remember(s);
    await loadOptions();
    state.open = true;
    changed();
    return true;
  }

  // "Shortlisting for Ram Sharma · Change", or the button to choose the student (above the courses).
  function bar() {
    const box = el('div', 'sl-for no-print');
    if (!state.student) {
      box.append(el('span', 'sl-for-text', 'Choose the student first, then press Shortlist beside each course.'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => choose() }, 'Choose the student'));
      return box;
    }
    const t = el('span', 'sl-for-text');
    t.append('Shortlisting for ', el('b', '', state.student.name));
    box.append(t, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose() }, 'Change student'));
    return box;
  }

  // Shortlist / Shortlisted beside a course. The fee, scholarship, deposit and course page are added by the server from the Fact File.
  function button(o) {
    const found = () => state.options.find((x) => optKey(x.universityId, x.course, x.intake) === optKey(o.universityId, o.course, o.intake));
    const on = found();
    const b = h('button', { class: `sl-pick no-print${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(on)) }, on ? (on.sent ? '✓ Sent' : '✓ Shortlisted') : '+ Shortlist');
    b.addEventListener('click', async () => {
      if (!state.student && !(await choose())) return;
      b.disabled = true;
      try {
        const now = found();
        if (now) {
          if (now.sent || now.applied) { say('Already given to the Application Team: change it on the student card.', true); b.disabled = false; return; }
          await api(`/api/cards/${encodeURIComponent(state.student.id)}/options/${now.id}/delete`, {});
          say(`Taken off ${state.student.name}'s shortlist`);
        } else {
          await api(`/api/cards/${encodeURIComponent(state.student.id)}/options`, { universityId: o.universityId, university: o.university, course: o.course, level: o.level || '', intake: o.intake || '' });
          say(`Shortlisted for ${state.student.name}`);
        }
        await loadOptions();
        changed();
      } catch (e) { say(e.message, true); b.disabled = false; }
    });
    return b;
  }

  // ---- the tray at the bottom of the Fact File ----
  let trayBox = null;
  function drawTray() {
    if (!trayBox) return;
    trayBox.hidden = !state.student;
    document.body.classList.toggle('has-sl-tray', Boolean(state.student));
    if (!state.student) return;
    const list = waiting();
    const sent = state.options.filter((o) => o.sent || o.applied).length;
    trayBox.replaceChildren();
    const head = el('div', 'sl-tray-head');
    const who = el('button', 'sl-tray-who');
    who.type = 'button';
    who.setAttribute('aria-expanded', String(state.open));
    who.append(el('span', 'p-avatar sm', root.Portal.initials(state.student.name)));
    const words = el('span', 'sl-tray-words');
    words.append(el('b', '', state.student.name), el('small', '', list.length ? `${list.length} course${list.length === 1 ? '' : 's'} shortlisted${sent ? `, ${sent} already with the Application Team` : ''}` : (sent ? `${sent} with the Application Team. Shortlist more below.` : 'Nothing shortlisted yet. Press Shortlist beside a course.')));
    who.append(words, el('span', `sl-tray-chev${state.open ? ' is-open' : ''}`));
    who.addEventListener('click', () => { state.open = !state.open; drawTray(); });
    const acts = el('div', 'sl-tray-acts');
    acts.append(
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose() }, 'Change student'),
      h('a', { class: 'btn btn-sm', href: `/student?id=${encodeURIComponent(state.student.id)}#options`, target: '_blank', rel: 'noopener' }, 'Open the card'),
    );
    if (list.length) {
      acts.append(
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => emailOptions(state.student, list).then((r) => { if (r) loadOptions().then(changed); }) }, 'Email these options'),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => assign(state.student, list).then((r) => { if (r) { state.order = null; loadOptions().then(changed); } }) }, 'Assign to the Application Team'),
      );
    }
    head.append(who, acts);
    trayBox.append(head);
    if (state.open && list.length) {
      const ol = el('ol', 'sl-tray-list');
      list.forEach((o, i) => {
        const li = el('li');
        const t = el('div', 'sl-tray-text');
        t.append(el('b', '', o.course || o.university), el('span', '', [o.course ? o.university : '', o.intake, o.fee].filter(Boolean).join(' · ')));
        const move = (d) => () => { const j = i + d; if (j < 0 || j >= state.order.length) return; [state.order[i], state.order[j]] = [state.order[j], state.order[i]]; drawTray(); };
        const tools = el('div', 'sl-tray-tools');
        tools.append(
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'),
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: move(1) }, '↓'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await api(`/api/cards/${encodeURIComponent(state.student.id)}/options/${o.id}/delete`, {}); await loadOptions(); changed(); } catch (e) { say(e.message, true); } } }, 'Remove'),
        );
        li.append(t, tools);
        ol.append(li);
      });
      trayBox.append(ol);
    }
  }
  function tray() {
    if (!trayBox) {
      trayBox = el('aside', 'sl-tray no-print');
      trayBox.setAttribute('aria-label', 'Shortlist');
      document.body.append(trayBox);
    }
    drawTray();
  }

  // ---- Email these options (a window; also used on the student card) ----
  const SUBJECT = 'Your university options';
  const BODY = 'Dear {first_name},\n\nThank you for your interest in studying in the UK. Here are the university options we have shortlisted for you:\n\n{options_table}\n\nPlease have a look and tell us which ones you like. We are happy to answer any question.';
  function emailOptions(student, options) {
    return dialog(`Email the options to ${student.name}`, (body, close) => {
      const ids = options.map((o) => o.id);
      const ul = el('ol', 'oa-list');
      options.forEach((o) => { const li = el('li'); li.append(el('b', '', o.course || o.university), el('span', 'p-muted p-small', [o.course ? o.university : '', o.fee].filter(Boolean).join(' · '))); ul.append(li); });
      const to = field('To', { value: student.email || '', disabled: true, placeholder: 'No email address on the sheet' });
      const subject = field('Subject', { value: SUBJECT, max: 200 });
      const text = field('Message', { kind: 'area', value: BODY, max: 6000, hint: '{options_table} is where the table of courses (fee, scholarship, deposit and course page) goes.' });
      text.input.rows = 7;
      const view = el('div', 'oa-preview');
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const preview = h('button', { class: 'btn', type: 'button' }, 'Preview');
      const send = h('button', { class: 'btn btn-primary', type: 'button' }, `Send to ${student.name.split(/\s+/)[0]}`);
      const payload = () => ({ subject: subject.input.value, body: text.input.value, optionIds: ids, channel: 'email' });
      preview.addEventListener('click', async () => {
        preview.disabled = true;
        try {
          const r = await api(`/api/cards/${encodeURIComponent(student.id)}/messages/preview`, payload());
          const frame = el('iframe', 'oa-frame');
          frame.setAttribute('sandbox', '');
          frame.title = 'The email as the student will see it';
          frame.srcdoc = r.html;
          view.replaceChildren(frame);
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; }
        preview.disabled = false;
      });
      send.addEventListener('click', async () => {
        send.disabled = true;
        msg.textContent = 'Sending...'; msg.className = 'p-msg';
        try {
          const r = await api(`/api/cards/${encodeURIComponent(student.id)}/messages/send`, payload());
          say(r.status === 'sent' ? `Emailed to ${student.name}` : 'Email is not set up on this server: the email is kept on the card as a preview.', r.status !== 'sent');
          close(true);
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; send.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), preview, send);
      body.append(el('h3', 'oa-sub', `${options.length} course${options.length === 1 ? '' : 's'}`), ul, to.wrap, subject.wrap, text.wrap, view, msg, foot);
    }, { wide: true });
  }

  // ---- Assign to the Application Team (a window; also used on the student card) ----
  // Every course needs its partner (Direct, or the B2B partner it goes through) before the task can be given.
  function assign(student, options) {
    return dialog(`Assign ${student.name} to the Application Team`, (body, close) => {
      body.append(el('p', 'p-muted p-small', 'In the order to apply. Choose through which partner each application goes.'));
      const list = el('ol', 'oa-assign');
      const picks = [];
      options.forEach((o) => {
        const li = el('li');
        const t = el('div', 'oa-assign-text');
        t.append(el('b', '', o.course || o.university), el('span', 'p-muted p-small', [o.course ? o.university : '', o.intake].filter(Boolean).join(' · ')));
        const sel = el('select', 'oa-partner');
        sel.setAttribute('aria-label', `Partner for ${o.university}`);
        sel.append(new Option('Loading the partners...', ''));
        sel.disabled = true;
        const hint = el('div', 'oa-hint');
        li.append(t, sel, hint);
        list.append(li);
        picks.push({ o, sel, hint });
      });
      const note = field('Notes for the Application Team', { kind: 'area', max: 1500, placeholder: 'e.g. Documents are in the email from Chitwan. Apply for the January intake.' });
      note.input.rows = 3;
      const msg = el('div', 'p-msg');
      const go = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Assign to the Application Team');
      const ready = () => { go.disabled = picks.some((p) => !p.sel.value); };
      const foot = el('div', 'p-dialog-foot');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), go);
      body.append(list, note.wrap, msg, foot);
      const qs = [...new Set(options.map((o) => o.university).filter(Boolean))].map((u) => 'u=' + encodeURIComponent(u)).join('&');
      api('/api/application-partners?' + qs).then((r) => {
        picks.forEach((p) => {
          const info = r.universities[p.o.university] || { suggested: '', used: [] };
          const pick = p.o.partner || info.suggested || '';
          p.sel.replaceChildren(new Option('Choose the partner...', ''), new Option(`Direct with ${p.o.university || 'the university'}`, 'Direct'));
          const group = document.createElement('optgroup');
          group.label = 'B2B partners';
          const names = [...new Set([...info.used.filter((n) => n !== 'Direct'), ...r.b2b])];
          if (pick && pick !== 'Direct' && !names.includes(pick)) names.unshift(pick);
          names.forEach((n) => group.append(new Option(n, n)));
          p.sel.append(group);
          p.sel.value = pick;
          p.sel.disabled = false;
          if (info.suggested && !p.o.partner) p.hint.textContent = info.suggested === 'Direct' ? 'Suggested: we apply direct to this university.' : `Suggested: used before for this university.`;
          p.sel.addEventListener('change', () => { p.hint.textContent = ''; ready(); });
        });
        ready();
      }).catch((e) => { msg.textContent = e.message; msg.className = 'p-msg error'; });
      go.addEventListener('click', async () => {
        go.disabled = true;
        try {
          await api(`/api/cards/${encodeURIComponent(student.id)}/options/send`, { ids: picks.map((p) => p.o.id), partners: Object.fromEntries(picks.map((p) => [p.o.id, p.sel.value])), note: note.input.value.trim() });
          say(`Assigned to the Application Team: ${options.length} course${options.length === 1 ? '' : 's'} for ${student.name}`);
          close(true);
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; ready(); }
      });
    }, { wide: true });
  }

  const ready = async () => { state.student = remembered(); await loadOptions(); };
  root.ShortlistFor = { ready, bar, button, tray, onChange: (f) => state.listeners.push(f), current: () => state.student };
  root.OptionActions = { email: emailOptions, assign };

  // Looks the course page up on the university's website (the server does the search); resolves to a link or ''.
  async function lookupLink(o) {
    try { const r = await api('/api/course-link', { universityId: o.universityId, university: o.university, course: o.course }); return r.link || ''; } catch (e) { return ''; }
  }
  root.SendToStudent = { lookupLink };
})(this);
