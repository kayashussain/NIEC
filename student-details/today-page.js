// Today: the first screen, kept quiet on purpose. Two things only:
//   1. the tasks: what is for this person (their team's, or for Admin the tasks the team gave them), what they gave, and (Admin and
//      the Manager) what others gave; each says who gave it to whom, has its own comments, and a red dot marks what is new (the
//      owner, 14 Nov 2026: no dates to do it by);
//   2. what needs attention: one short list, a line per kind of work with how many students wait, opened with a click.
// The numbers, charts and buttons live on the Dashboard and on All Students, not here.
(function () {
  const { el, h, api, initials, stagePill, handOn, taskPriority, priorityOf, tagOf, tagLabel } = window.Portal;
  const view = document.getElementById('view');
  if (new URLSearchParams(location.search).get('notice') === 'admin') {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => { if (window.NiecUI) window.NiecUI.toast('That page is for Admin only, so you are back on Today.', { type: 'error' }); }, 300);
  }
  const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
  const shortDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let me = '';

  let showDone = false;
  // Calm by design (the owner, 15 Nov 2026): the tasks can be narrowed to one kind (Payment, Application, NOC ...), each list is
  // in the order of how important each task was marked (Super priority, Priority, Medium; inside that, something new first, then the
  // one waiting longest), and only the first five of a list show until "Show all" is pressed.
  let tagFilter = 'all';
  const expanded = new Set();
  const FIRST = 5;
  // The task a notification was pressed for: shown even when it is past the first five or among the done ones.
  let focusTask = null;
  // One task (portal-ui.js taskCard): the tick (only for whoever the task is for), what to do, its updates, the student, who gave it to
  // whom and when.
  function taskRow(t, refresh) {
    const fromName = t.by === me ? 'You' : t.by || 'Someone';
    const toName = t.forMe ? (t.team === 'head' ? 'you' : `your team (${t.teamLabel})`) : t.teamLabel;
    return window.Portal.taskCard(t, {
      rowId: t.studentId, me, teams: allTeams, stage: t.stage, unread: t.unread || 0, canWrite: true,
      mayTick: t.forMe || (canAssignAll && !t.given), tickTitle: `${t.teamLabel} ticks it when it is done`,
      canChange: t.forMe || t.by === me || canAssignAll,
      student: { name: t.student, href: '/student?id=' + encodeURIComponent(t.studentId) }, fromName, toName,
      actions: [
        (canAssignAll || t.by === me) && ['Edit the task', async () => { if (await window.Portal.editTask(t, { rowId: t.studentId, stage: t.stage })) { window.NiecUI.toast('Task updated. The team is told.', { type: 'success' }); refresh(true); } }],
        t.mayHand && ['Reassign to another team', async () => { if (await handOn(t, { rowId: t.studentId, teams: allTeams })) { window.NiecUI.toast('Reassigned. You can still follow it here.', { type: 'success' }); refresh(true); } }],
        (canAssignAll || t.by === me) && ['Remove the task', async () => { if (await window.NiecUI.confirm('Remove this task and its updates?', { danger: true, confirmText: 'Remove' })) { try { await api(`/api/cards/${encodeURIComponent(t.studentId)}/tasks/${t.id}/delete`, {}); refresh(true); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, true],
      ],
      onTick: async (done, folded) => {
        try {
          await api(`/api/cards/${encodeURIComponent(t.studentId)}/tasks/${t.id}`, { done });
          window.NiecUI.toast(done ? window.Portal.cheer() : 'Marked as not done', { type: 'success' });
          await folded;
          refresh(true);
        } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); throw e; }
      },
      onChanged: () => refresh(true),
    });
  }
  let canAssignAll = false;
  let allTeams = [];

  // One list of tasks under its own heading, the newest word first; the ones done in the last 7 days fold away at the bottom.
  function group(title, hint, all, refresh, emptyText) {
    const g = el('div', 'td-group');
    const list = tagFilter === 'all' ? all : all.filter((x) => tagOf(x, x.stage) === tagFilter);
    const open = list.filter((x) => !x.done).sort((a, b) => taskPriority(b) - taskPriority(a));
    const done = list.filter((x) => x.done && Date.now() - Date.parse(x.doneAt || 0) < 7 * 86400000);
    const head = el('div', 'td-group-head');
    const words = el('div');
    words.append(el('h3', '', title));
    if (hint) words.append(el('p', '', hint));
    head.append(words);
    const chips = el('div', 'td-sum');
    const fresh = list.reduce((n, x) => n + (x.unread || 0), 0);
    if (fresh) chips.append(el('span', 'td-chip is-new', `${fresh} new`));
    const urgent = open.filter((x) => priorityOf(x) === 'super').length;
    if (urgent) chips.append(el('span', 'td-chip is-super', `${urgent} super priority`));
    chips.append(el('span', 'td-chip', `${open.length} open`));
    head.append(chips);
    g.append(head);
    if (!open.length) {
      const empty = el('div', 'td-empty');
      empty.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      empty.append(el('div', '', tagFilter === 'all' ? emptyText : `Nothing open about ${tagLabel(tagFilter).toLowerCase()} here.`));
      g.append(empty);
    }
    const many = open.length > FIRST && !expanded.has(title) && !open.slice(FIRST).some((x) => x.id === focusTask);
    (many ? open.slice(0, FIRST) : open).forEach((x) => g.append(taskRow(x, refresh)));
    if (open.length > FIRST) {
      const more = h('button', { class: 'td-more', type: 'button' }, many ? `Show all ${open.length} open tasks` : 'Show only the first five');
      more.addEventListener('click', () => { if (many) expanded.add(title); else expanded.delete(title); refresh(); });
      g.append(more);
    }
    if (done.length) {
      const key = title;
      const shown = showDone === key || done.some((x) => x.id === focusTask);
      const toggle = h('button', { class: 'td-done-toggle', type: 'button', 'aria-expanded': String(shown) }, shown ? 'Hide the tasks done this week' : `Done this week (${done.length})`);
      toggle.addEventListener('click', () => { showDone = shown ? false : key; refresh(); });
      g.append(toggle);
      if (shown) { const d = el('div', 'is-done'); done.forEach((x) => d.append(taskRow(x, refresh))); g.append(d); }
    }
    return g;
  }

  function tasksPanel(t, refresh) {
    canAssignAll = Boolean(t.canAssign);
    allTeams = t.teams || [];
    if (t.me) me = t.me;
    const box = el('section', 'td-tasks');
    const head = el('div', 'td-tasks-head');
    const titles = el('div');
    titles.append(el('h2', '', 'Tasks'), el('p', '', 'What to do, in order of priority. Anything new is in Notifications above.'));
    head.append(titles);
    box.append(head);
    // One row of pills to see one kind of task at a time, each with how many are open.
    const openAll = t.tasks.filter((x) => !x.done);
    if (openAll.length) {
      const counts = {};
      openAll.forEach((x) => { const k = tagOf(x, x.stage); counts[k] = (counts[k] || 0) + 1; });
      if (tagFilter !== 'all' && !counts[tagFilter]) tagFilter = 'all';
      const bar = el('div', 'td-filter');
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Show the tasks about');
      const pill = (k, label, n) => {
        const b = h('button', { class: `td-filter-pill${k === 'all' ? '' : ' tag-' + k}`, type: 'button', role: 'tab', 'aria-selected': String(tagFilter === k) }, label);
        b.append(el('span', 'td-filter-n', String(n)));
        b.addEventListener('click', () => { tagFilter = k; refresh(); });
        bar.append(b);
      };
      pill('all', 'All', openAll.length);
      ((window.CardFields && window.CardFields.TASK_TAGS) || []).forEach(([k, label]) => { if (counts[k]) pill(k, label, counts[k]); });
      box.append(bar);
    }
    const forMe = t.tasks.filter((x) => x.forMe);
    const gave = t.tasks.filter((x) => !x.forMe && (x.given || x.by === me));
    const others = t.canAssign ? t.tasks.filter((x) => !x.forMe && x.by !== me) : [];
    // Tasks the team handed on to another team: still seen here, to follow them and comment.
    const passed = t.canAssign ? [] : t.tasks.filter((x) => x.had && !x.forMe && !gave.includes(x));
    const any = forMe.length || gave.length || others.length || passed.length;
    if (t.isHead || forMe.length || !t.canAssign) box.append(group(t.isHead ? 'For you' : 'For your team', t.isHead ? `Tasks the team gave you, ${t.headLabel || 'Admin'}.` : 'Tick when done. Post an update to ask or report.', forMe, refresh, t.isHead ? 'Nothing for you. When the team gives you a task, it is here.' : 'Nothing open for your team. You are all caught up.'));
    if (gave.length || t.canAssign) box.append(group('Tasks you have given', 'Assign tasks from a student card. Updates appear here.', gave, refresh, 'Every task you gave is done.'));
    if (passed.length) box.append(group('Reassigned by your team', 'Tasks your team reassigned. Follow and post updates here.', passed, refresh, 'Every one of them is done.'));
    if (others.length) box.append(group('Given by others', 'Tasks assigned by others.', others, refresh, 'Every one of them is done.'));
    if (!any && !t.canAssign && !forMe.length) { /* the "For your team" list above already says so */ }
    return box;
  }

  // ---- Notifications (the owner, 15 Nov 2026): exactly what is new and on which task, newest first. A press goes straight to the task,
  // opens its updates and marks it read, so nobody has to scroll through every task to find the new message. ----
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!(m >= 0)) return '';
    if (m < 1) return 'Just now';
    if (m < 60) return `${m} min ago`;
    if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
    if (m < 48 * 60) return 'Yesterday';
    return shortDay(iso);
  };
  let inboxAll = false;
  const NOTE_VERB = { task: (x) => ` gave ${x.forMe && x.team !== 'head' ? 'your team' : 'you'} a new task`, reassigned: () => ' reassigned a task', edited: () => ' changed a task', done: () => ' marked a task as done', update: () => ' posted an update' };
  // Notifications (the owner, 15 Nov 2026): every task given, update, change, reassignment and completion of the last 30 days, kept
  // after they are read. The new ones come first under "New" with a blue dot; the rest under "Earlier". Always on Today.
  function inbox(t, refresh) {
    const items = t.tasks.flatMap((x) => (x.history || []).map((n) => ({ ...n, task: x }))).sort((a, b) => (b.isNew - a.isNew) || String(b.at).localeCompare(String(a.at)));
    const fresh = items.filter((n) => n.isNew);
    const box = el('section', 'td-inbox');
    box.setAttribute('aria-label', 'Notifications');
    const head = el('div', 'td-inbox-head');
    const title = el('h2', '', 'Notifications');
    if (fresh.length) title.append(el('span', 'td-inbox-count', String(fresh.length)));
    head.append(title);
    if (fresh.length) {
      const clear = h('button', { class: 'td-inbox-clear', type: 'button' }, 'Mark all as read');
      clear.addEventListener('click', async () => {
        clear.disabled = true;
        const ids = [...new Set(fresh.map((n) => n.task))];
        await Promise.all(ids.map((x) => api(`/api/cards/${encodeURIComponent(x.studentId)}/tasks/${x.id}`, { seen: true }).catch(() => {})));
        ids.forEach((x) => { x.news = []; x.unread = 0; (x.history || []).forEach((n) => { n.isNew = false; }); });
        window.dispatchEvent(new Event('isr-tasks-read'));
        refresh();
      });
      head.append(clear);
    }
    box.append(head);
    if (!items.length) {
      box.append(el('p', 'td-inbox-empty', 'Nothing yet. When a task is given to you, someone posts an update, or a task you gave is done, it shows here.'));
      return box;
    }
    const SHOW = 5;
    const shown = inboxAll ? items : items.slice(0, Math.max(SHOW, fresh.length));
    const list = el('div', 'td-inbox-list');
    let earlier = false;
    if (fresh.length) list.append(el('div', 'td-inbox-sec', 'New'));
    shown.forEach((n) => {
      if (!n.isNew && !earlier) { earlier = true; list.append(el('div', 'td-inbox-sec', 'Earlier')); }
      const x = n.task;
      const b = h('button', { class: `td-note kind-${n.kind}${n.isNew ? ' is-new' : ''}`, type: 'button' });
      const av = el('span', 'td-note-av', initials(n.by));
      av.setAttribute('aria-hidden', 'true');
      const words = el('div', 'td-note-words');
      const line = el('div', 'td-note-line');
      line.append(el('b', '', n.by === me ? 'You' : n.by), (NOTE_VERB[n.kind] || NOTE_VERB.update)(x));
      words.append(line, el('div', 'td-note-task', x.text));
      if (n.text) words.append(el('div', 'td-note-text', `\u201c${n.text}\u201d`));
      const side = el('div', 'td-note-side');
      side.append(el('span', 'td-note-when', ago(n.at)), el('span', 'td-note-student', x.student));
      b.append(av, words, side);
      b.addEventListener('click', () => goTo(x, refresh));
      list.append(b);
    });
    box.append(list);
    if (items.length > shown.length || inboxAll) {
      const more = h('button', { class: 'td-more', type: 'button' }, inboxAll ? 'Show fewer' : `Show all ${items.length} notifications (last 30 days)`);
      more.addEventListener('click', () => { inboxAll = !inboxAll; refresh(); });
      box.append(more);
    }
    return box;
  }
  // Go to one task: every kind shown, the task drawn even if it is past the first five, then glide to it, open its updates and mark
  // it read.
  function goTo(x, refresh) {
    tagFilter = 'all';
    focusTask = x.id;
    refresh();
    requestAnimationFrame(() => {
      const row = document.querySelector(`.td-task[data-task-id="${x.id}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      row.classList.add('is-flash');
      setTimeout(() => row.classList.remove('is-flash'), 1800);
      if (row.openThread) row.openThread();
      x.news = []; x.unread = 0; (x.history || []).forEach((n) => { n.isNew = false; });
      // Redraw once it is read: the notification, the counts and the dot go (its updates stay open, see portal-ui.js openThreads).
      setTimeout(() => { refresh(); const again = document.querySelector(`.td-task[data-task-id="${x.id}"]`); if (again) again.scrollIntoView({ block: 'center' }); }, 700);
    });
  }
  // What needs attention: one line per kind of work that has students waiting; a click opens the first few names.
  function attention(sections) {
    const box = el('section', 'td-attn');
    const waiting = sections.filter((x) => x.count > 0);
    const head = el('div', 'td-attn-head');
    head.append(el('h2', '', 'Needs attention'), el('p', '', waiting.length ? 'Students waiting for a next step. Open a line to see who.' : 'Nothing is waiting.'));
    box.append(head);
    waiting.forEach((x) => {
      const d = el('details', 'td-attn-row');
      const s = el('summary');
      const words = el('span', 'td-attn-words');
      words.append(el('b', '', x.title), el('small', '', x.hint));
      s.append(words, el('span', 'td-attn-count', String(x.count)));
      d.append(s);
      const list = el('div', 'td-attn-list');
      x.students.forEach((st) => {
        const a = h('a', { class: 'td-attn-student', href: '/student?id=' + encodeURIComponent(st.id), title: 'Open the student card' });
        a.append(el('span', 'td-av', initials(st.name)));
        const mid = el('span', 'td-attn-mid');
        mid.append(el('b', '', st.name), el('small', '', `${st.detail} · ${st.intake}`));
        a.append(mid, stagePill(st.stage));
        list.append(a);
      });
      if (x.count > x.students.length) list.append(h('a', { class: 'td-attn-more', href: '/students' }, `and ${x.count - x.students.length} more on All Students`));
      d.append(list);
      box.append(d);
    });
    return box;
  }

  // The day at a glance, at the top (the owner, 14 Nov 2026: engaging, like a game): a ring that fills as the person's own tasks are
  // done this week, then what is open for them and how many students wait for a next step. "All caught up" when nothing is open.
  function pulse(tasks, sections) {
    const recent = (x) => x.done && Date.now() - Date.parse(x.doneAt || 0) < 7 * 86400000;
    const mine = tasks.tasks.filter((x) => x.forMe);
    const open = mine.filter((x) => !x.done).length;
    const done = mine.filter(recent).length;
    const waiting = sections.reduce((n, x) => n + x.count, 0);
    const box = el('section', 'td-pulse');
    const share = open + done ? done / (open + done) : 1;
    const ring = el('div', 'td-ring');
    ring.style.setProperty('--p', String(Math.round(share * 100)));
    if (open + done) ring.append(el('b', '', `${Math.round(share * 100)}%`), el('small', '', 'this week')); else ring.append(el('b', 'td-ring-tick', '\u2713'));
    const stat = (n, label, tone) => { const x = el('div', `td-stat${tone ? ' ' + tone : ''}`); x.append(el('b', '', String(n)), el('span', '', label)); return x; };
    const words = el('div', 'td-pulse-words');
    words.append(el('h2', '', open ? `${open} task${open === 1 ? '' : 's'} open for you` : 'All caught up'), el('p', '', open ? 'Tick each one when it is done.' : 'Nothing open for you. Well done.'));
    box.append(ring, words, stat(done, 'done this week', 'good'), stat(waiting, 'students waiting', waiting ? 'warn' : ''));
    return box;
  }

  api('/api/today').then(async (d) => {
    me = d.name || '';
    let tasks = { tasks: [], canAssign: false };
    try { tasks = await api('/api/tasks'); } catch (e) { /* the rest of Today still shows */ }
    document.title = 'Today · ISR';
    const page = el('div', 'td-page');
    const head = el('header', 'td-hello');
    const first = String(d.name || '').split(/\s+/)[0] || '';
    head.append(el('span', 'td-kicker', d.title), el('h1', '', `${greeting()}${first ? ', ' + first : ''}`),
      el('p', '', new Date(d.today + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })));
    const slot = el('div');
    const top = el('div');
    const refresh = async (reload) => {
      if (reload) { try { tasks = await api('/api/tasks'); } catch (e) { /* keep */ } }
      top.replaceChildren(inbox(tasks, refresh), pulse(tasks, d.sections));
      slot.replaceChildren(tasksPanel(tasks, refresh));
    };
    refresh();
    // Admin and the Manager see the students waiting first (the whole consultancy), a team its own tasks first.
    page.append(head, top, ...(tasks.canAssign ? [attention(d.sections), slot] : [slot, attention(d.sections)]));
    view.replaceChildren(page);
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
