// Shortlisting from the Fact File for a student (the owner, 17 Nov 2026). The team chooses the student once (kept while the browser tab
// is open), then presses Shortlist beside any course: on a university's page, in the search results ("nursing" lists every matching
// course of every university) and in "Find universities for a student". Nobody leaves the Fact File: a tray at the bottom of the page
// holds the student's shortlist, numbered 1, 2, 3 in the order to apply, with
//
//   Share options (by email)         the student gets the courses in one email (fee, scholarship, deposit and course page by themselves)
//   Assign to the Application Team  asks, for every course, through which partner it goes (Direct or a B2B partner) and for notes,
//                                   then gives the Application Team one task with the numbered list
//   Open the card                   the student card in a new tab, so the Fact File stays where it was
//   ✕ Stop                          ends the shortlisting: the bar and the tray go away; courses not yet given to the Application
//                                   Team can be kept on the student card or discarded (the owner, 17 Nov 2026)
//
// The chosen student is kept while moving between Fact File pages, but a refresh of the page starts clean, with no student chosen
// (the owner, 17 Nov 2026: the bar kept coming back after every refresh).
//
// The same two windows are used on the student card (student-page.js) through window.OptionActions.
//
// Also the look-up of a course's page on the university's website for the student card (SendToStudent.lookupLink).
(function (root) {
  const { el, h, api, field, dialog } = root.Portal;
  const say = (t, e) => root.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const KEY = 'isrShortlistFor';
  const ORDER_KEY = 'isrShortlistOrder';
  const state = { student: null, options: [], listeners: [], order: null, open: false };
  const optKey = (universityId, course, intake) => `${universityId}|${String(course).toLowerCase()}|${String(intake || '').toLowerCase()}`;
  // A shortlist change only repaints the Shortlist buttons and the tray, at once (the owner, 17 Nov 2026: quick, fast and smooth);
  // the page itself is redrawn only when the student changes (its "Shortlisting for ..." bars).
  const changed = () => { syncButtons(); drawTray(); };
  const studentChanged = () => { state.listeners.forEach((f) => f()); changed(); };
  // The order chosen in the tray, kept for this student while the tab is open (a reload keeps it).
  const saveOrder = () => { try { if (state.student) sessionStorage.setItem(ORDER_KEY, JSON.stringify({ id: state.student.id, order: state.order || [] })); } catch (e) { /* this page only */ } };
  const savedOrder = () => { try { const o = JSON.parse(sessionStorage.getItem(ORDER_KEY) || 'null'); return o && state.student && o.id === state.student.id ? o.order : null; } catch (e) { return null; } };

  function remembered() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function remember(s) { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) { /* kept for this page only */ } }

  async function loadOptions() {
    if (!state.student) { state.options = []; return; }
    try {
      const r = await api(`/api/cards/${encodeURIComponent(state.student.id)}`);
      state.options = (r.card && r.card.options) || [];
      state.student.email = (r.student && r.student.row && r.student.row.EMAIL) || '';
      if (r.student && r.student.name) state.student.name = r.student.name;
    } catch (e) { state.student = null; remember(null); state.options = []; }
  }
  // The courses not yet given to the Application Team, in the order chosen in the tray.
  function waiting() {
    const list = state.options.filter(CardFields.onShortlist);
    const ids = list.map((o) => o.id);
    state.order = (state.order || []).filter((x) => ids.includes(x));
    ids.forEach((x) => { if (!state.order.includes(x)) state.order.push(x); });
    saveOrder();
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
    remember(s);
    state.order = savedOrder();
    await loadOptions();
    state.open = true;
    studentChanged();
    return true;
  }

  // Ends the shortlisting for this student. Courses still waiting (not yet with the Application Team) can stay on the card or be discarded.
  async function stop() {
    if (!state.student) return;
    const who = state.student;
    const left = waiting();
    let discard = false;
    if (left.length) {
      const answer = await dialog(`Stop shortlisting for ${who.name}?`, (body, close) => {
        const foot = el('div', 'p-dialog-foot');
        body.append(el('p', '', `${left.length} course${left.length === 1 ? ' is' : 's are'} shortlisted and not yet given to the Application Team.`), foot);
        foot.append(
          h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn', type: 'button', onclick: () => close('keep') }, 'Keep them on the card'),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: () => close('discard') }, 'Discard them'),
        );
      });
      if (!answer) return;
      discard = answer === 'discard';
    }
    const sid = encodeURIComponent(who.id);
    if (discard) {
      let failed = 0;
      for (const o of left) { if (String(o.id).startsWith('new-')) continue; try { await api(`/api/cards/${sid}/options/${o.id}/delete`, {}); } catch (e) { failed += 1; } }
      say(failed ? `${failed} course${failed === 1 ? '' : 's'} could not be taken off: see the student card.` : `Discarded ${left.length} course${left.length === 1 ? '' : 's'} for ${who.name}`, Boolean(failed));
    } else say(left.length ? `Stopped. The shortlist stays on ${who.name}'s card.` : 'Stopped shortlisting.');
    state.student = null; state.options = []; state.order = null; state.open = false;
    remember(null);
    try { sessionStorage.removeItem(ORDER_KEY); } catch (e) { /* nothing kept */ }
    // "?for=" in the address would bring the student back; it is taken off.
    try { const u = new URL(location.href); if (u.searchParams.has('for')) { u.searchParams.delete('for'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) { /* the address stays */ }
    studentChanged();
  }
  const stopButton = () => h('button', { class: 'btn btn-sm', type: 'button', title: 'Stop shortlisting for this student', 'aria-label': 'Stop shortlisting for this student', onclick: () => stop() }, '✕ Stop');

  // "Shortlisting for Ram Sharma · Change", or the button to choose the student (above the courses).
  function bar() {
    const box = el('div', 'sl-for no-print');
    if (!state.student) {
      box.append(el('span', 'sl-for-text', 'Choose the student first, then press Shortlist beside each course.'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => choose() }, 'Choose the student'));
      return box;
    }
    const t = el('span', 'sl-for-text');
    t.append('Shortlisting for ', el('b', '', state.student.name));
    box.append(t, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose() }, 'Change student'), stopButton());
    return box;
  }

  // Shortlist / Shortlisted beside a course. The fee, scholarship, deposit and course page are added by the server from the Fact File.
  // The button changes the moment it is pressed and the server is told behind it; if the server refuses, the button goes back.
  const found = (o) => state.options.find((x) => optKey(x.universityId, x.course, x.intake) === optKey(o.universityId, o.course, o.intake));
  function paint(b) {
    const on = found(b.slOption);
    b.classList.toggle('is-on', Boolean(on));
    b.classList.toggle('is-sent', Boolean(on && CardFields.WITH_TEAM(on)));
    b.setAttribute('aria-pressed', String(Boolean(on)));
    b.textContent = on ? (CardFields.WITH_TEAM(on) ? '✓ With the team' : '✓ Shortlisted') : '+ Shortlist';
    b.title = on ? (CardFields.WITH_TEAM(on) ? 'Already given to the Application Team' : 'Press again to take it off the shortlist') : (state.student ? `Shortlist for ${state.student.name}` : 'Choose the student, then shortlist');
  }
  function syncButtons() { document.querySelectorAll('.sl-pick').forEach((b) => { if (b.slOption) paint(b); }); }
  // Adds or removes a course on the student's shortlist, at once on the page.
  async function toggle(o) {
    if (!state.student && !(await choose())) return;
    const now = found(o);
    const sid = encodeURIComponent(state.student.id);
    const before = state.options;
    if (now && CardFields.WITH_TEAM(now)) { say('Already given to the Application Team: change it on the student card.', true); return; }
    if (now) state.options = state.options.filter((x) => x !== now);
    else state.options = [...state.options, { id: 'new-' + Date.now(), universityId: o.universityId, university: o.university, course: o.course, intake: o.intake || '', level: o.level || '', fee: o.fee || '', pending: true }];
    changed();
    try {
      const r = now ? await api(`/api/cards/${sid}/options/${now.id}/delete`, {})
        : await api(`/api/cards/${sid}/options`, { universityId: o.universityId, university: o.university, course: o.course, level: o.level || '', intake: o.intake || '' });
      if (r && r.card && Array.isArray(r.card.options)) state.options = r.card.options;
      else await loadOptions();
      say(now ? `Taken off ${state.student.name}'s shortlist` : `Shortlisted for ${state.student.name}`);
    } catch (e) {
      state.options = before;
      say(e.message, true);
    }
    changed();
  }
  function button(o) {
    const b = h('button', { class: 'sl-pick no-print', type: 'button' }, '');
    b.slOption = o;
    paint(b);
    b.addEventListener('click', () => toggle(o));
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
    const sent = state.options.filter(CardFields.WITH_TEAM).length;
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
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Email these options to the student', onclick: () => emailOptions(state.student, list).then((r) => { if (r) loadOptions().then(changed); }) }, 'Share options'),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => assign(state.student, list).then((r) => { if (r) { state.order = null; loadOptions().then(changed); } }) }, 'Assign to the Application Team'),
      );
    }
    acts.append(stopButton());
    head.append(who, acts);
    trayBox.append(head);
    if (state.open && list.length) {
      const ol = el('ol', 'sl-tray-list');
      list.forEach((o, i) => {
        const li = el('li');
        const t = el('div', 'sl-tray-text');
        t.append(el('b', '', o.course || o.university), el('span', '', [o.course ? o.university : '', o.intake, o.fee].filter(Boolean).join(' · ')));
        if (o.pending) li.classList.add('is-pending');
        const move = (d) => () => { const j = i + d; if (j < 0 || j >= state.order.length) return; [state.order[i], state.order[j]] = [state.order[j], state.order[i]]; saveOrder(); drawTray(); };
        const tools = el('div', 'sl-tray-tools');
        tools.append(
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'),
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: move(1) }, '↓'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => toggle(o) }, 'Remove'),
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
      // The button says how many partners are still to choose, so nobody wonders why it cannot be pressed.
      const ready = () => {
        const left = picks.filter((p) => !p.sel.value).length;
        go.disabled = left > 0;
        go.textContent = left ? `Choose ${left} more partner${left === 1 ? '' : 's'}` : `Assign ${options.length} course${options.length === 1 ? '' : 's'} to the Application Team`;
        picks.forEach((p) => p.sel.classList.toggle('is-missing', !p.sel.value));
      };
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
          p.sel.addEventListener('change', () => {
            p.hint.replaceChildren();
            // With several courses, one press gives the same partner to the ones still without one (most go through one partner).
            const empty = picks.filter((x) => x !== p && !x.sel.value && [...x.sel.options].some((op) => op.value === p.sel.value));
            if (p.sel.value && empty.length) {
              const all = h('button', { class: 'p-link oa-all', type: 'button' }, `Use ${p.sel.value === 'Direct' ? 'Direct' : p.sel.value} for the other ${empty.length}`);
              all.addEventListener('click', () => { empty.forEach((x) => { x.sel.value = p.sel.value === 'Direct' ? 'Direct' : p.sel.value; x.hint.replaceChildren(); }); all.remove(); ready(); });
              p.hint.append(all);
            }
            ready();
          });
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

  // The student comes from the address (?for=ID, from "Find course" on the student card), else the one chosen before in this tab.
  // A refresh starts clean: the student chosen before is forgotten (moving to another Fact File page keeps it).
  const refreshed = () => { try { const n = performance.getEntriesByType('navigation')[0]; return Boolean(n && n.type === 'reload'); } catch (e) { return false; } };
  const ready = async () => {
    if (refreshed()) {
      remember(null);
      try { sessionStorage.removeItem(ORDER_KEY); const u = new URL(location.href); if (u.searchParams.has('for')) { u.searchParams.delete('for'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) { /* nothing kept */ }
    }
    const asked = new URLSearchParams(location.search).get('for');
    state.student = asked && /^[\w-]{1,64}$/.test(asked) ? { id: asked, name: '' } : remembered();
    await loadOptions();
    if (state.student) { remember(state.student); state.order = savedOrder(); if (asked) state.open = true; }
  };
  root.ShortlistFor = { ready, bar, button, tray, onChange: (f) => state.listeners.push(f), current: () => state.student };
  root.OptionActions = { email: emailOptions, assign };

  // Looks the course page up on the university's website (the server does the search); resolves to a link or ''.
  async function lookupLink(o) {
    try { const r = await api('/api/course-link', { universityId: o.universityId, university: o.university, course: o.course }); return r.link || ''; } catch (e) { return ''; }
  }
  root.SendToStudent = { lookupLink };
})(this);
