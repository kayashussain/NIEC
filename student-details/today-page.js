// Today: the first screen, kept quiet on purpose. Two things only:
//   1. the tasks, one list at a time behind a switch: Today and Upcoming (this person's: their team's, or for Admin the tasks the
//      team gave them), You gave, and (Admin and the Manager) Given by others, or (a team) Reassigned; each task is one compact card
//      that says whose student it is, who gave it to whom, and folds its updates away (the owner, 15 Nov 2026);
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
  let taskView = ''; // 'mine' (Today), 'upcoming', 'gave', 'others' or 'passed': which tasks are shown
  // Search (the owner, 15 Nov 2026): a student's name, or any word of a task or its tag, narrows every list at once.
  let searchQ = '';
  const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const matches = (x) => !searchQ || fold(`${x.student} ${x.text} ${tagLabel(tagOf(x, x.stage))} ${x.stage}`).includes(fold(searchQ));
  const expanded = new Set();
  const FIRST = 5;
  // The task a notification was pressed for: shown even when it is past the first five or among the done ones.
  let focusTask = null;
  // One task (portal-ui.js taskCard): the tick (only for whoever the task is for), what to do, its updates, the student, who gave it to
  // whom and when.
  function taskRow(t, refresh) {
    const fromName = t.by === me ? 'You' : t.by || 'Someone';
    // "your team" (Today already says which team it is), else the team's name.
    const toName = t.forMe ? (t.team === 'head' ? 'you' : 'your team') : t.teamLabel;
    return window.Portal.taskCard(t, {
      rowId: t.studentId, me, teams: allTeams, stage: t.stage, unread: t.unread || 0, canWrite: true, today: todayIso,
      mayTick: t.forMe || (canAssignAll && !t.given), tickTitle: `${t.teamLabel} ticks it when it is done`,
      canChange: t.forMe || t.by === me || canAssignAll,
      student: { name: t.student, href: '/student?id=' + encodeURIComponent(t.studentId) }, fromName, toName,
      actions: [
        !t.done && (t.forMe || t.by === me || canAssignAll) && [t.doOn && t.doOn > todayIso ? 'Change the day' : 'Move to another day', async () => { if (await window.Portal.scheduleTask(t, { rowId: t.studentId, today: todayIso })) { window.NiecUI.toast('Moved. It waits under Upcoming.', { type: 'success' }); refresh(true); } }],
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
  let todayIso = '';
  let allTeams = [];

  // One list of tasks under its own heading, the newest word first; the ones done in the last 7 days fold away at the bottom.
  function emptyNote(text) {
    const empty = el('div', 'td-empty');
    empty.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    empty.append(el('div', '', text));
    return empty;
  }
  // `mode`: 'today' shows only what is for today (a link points at Upcoming), 'upcoming' only the later days, one heading per day;
  // anything else shows today's tasks with the later ones folded under them.
  function group(title, hint, all, refresh, emptyText, mode) {
    const g = el('div', 'td-group');
    const list = (tagFilter === 'all' ? all : all.filter((x) => tagOf(x, x.stage) === tagFilter)).filter(matches);
    // Today and Upcoming (the owner, 15 Nov 2026): a task moved to a later day waits under Upcoming and is back under Today on its day.
    const later = (x) => x.doOn && todayIso && x.doOn > todayIso;
    const openAll = list.filter((x) => !x.done);
    const open = openAll.filter((x) => !later(x)).sort((a, b) => taskPriority(b) - taskPriority(a));
    const upcoming = openAll.filter(later).sort((a, b) => a.doOn.localeCompare(b.doOn) || taskPriority(b) - taskPriority(a));
    const done = list.filter((x) => x.done && Date.now() - Date.parse(x.doneAt || 0) < 7 * 86400000);
    const head = el('div', 'td-group-head');
    const words = el('div');
    if (hint) words.append(el('p', '', hint));
    head.append(words);
    const chips = el('div', 'td-sum');
    const fresh = list.reduce((n, x) => n + (x.unread || 0), 0);
    if (fresh) chips.append(el('span', 'td-chip is-new', `${fresh} new`));
    const urgent = (mode === 'upcoming' ? upcoming : open).filter((x) => priorityOf(x) === 'super').length;
    if (urgent) chips.append(el('span', 'td-chip is-super', `${urgent} super priority`));
    head.append(chips);
    g.append(head);
    if (mode === 'upcoming') {
      if (!upcoming.length) g.append(emptyNote(searchQ ? `No later task matches \u201c${searchQ}\u201d.` : 'Nothing planned for later days. A task moved to another day (the "..." on a task) waits here.'));
      let day = '';
      upcoming.forEach((x) => { if (x.doOn !== day) { day = x.doOn; g.append(el('div', 'td-day', window.Portal.dayLabel(day, todayIso))); } g.append(taskRow(x, refresh)); });
      return g;
    }
    if (!open.length) {
      const kind = tagFilter !== 'all' ? ` about ${tagLabel(tagFilter).toLowerCase()}` : '';
      const where = mode === 'today' ? 'under Upcoming' : 'below';
      g.append(emptyNote(upcoming.length ? `Nothing${kind} for today. ${upcoming.length === 1 ? 'One task was' : `${upcoming.length} tasks were`} moved to a later day: ${upcoming.length === 1 ? 'it is' : 'they are'} ${where}.` : searchQ ? `No task for today matches \u201c${searchQ}\u201d.` : kind ? `Nothing${kind} for today.` : emptyText));
    }
    const many = open.length > FIRST && !expanded.has(title) && !open.slice(FIRST).some((x) => x.id === focusTask);
    (many ? open.slice(0, FIRST) : open).forEach((x) => g.append(taskRow(x, refresh)));
    if (open.length > FIRST) {
      const more = h('button', { class: 'td-more', type: 'button' }, many ? `Show all ${open.length} open tasks` : 'Show only the first five');
      more.addEventListener('click', () => { if (many) expanded.add(title); else expanded.delete(title); refresh(); });
      g.append(more);
    }
    // Upcoming: folded under Today so the eye stays on today; opened, each day under its own small heading.
    if (upcoming.length && mode === 'today') {
      const go = h('button', { class: 'td-up-toggle is-link', type: 'button' });
      go.append(el('span', '', `Upcoming (${upcoming.length})`), el('small', '', `next: ${window.Portal.dayLabel(upcoming[0].doOn, todayIso)}`), el('span', 'td-up-chev'));
      go.addEventListener('click', () => { taskView = 'upcoming'; refresh(); window.scrollTo({ top: document.querySelector('.td-tasks').offsetTop - 12, behavior: 'smooth' }); });
      g.append(go);
    } else if (upcoming.length) {
      const key = 'up:' + title;
      // Open by itself when nothing is left for today, so a count above never points at an empty list.
      const shown = expanded.has(key) || upcoming.some((x) => x.id === focusTask) || !open.length;
      const tg = h('button', { class: 'td-up-toggle', type: 'button', 'aria-expanded': String(shown) });
      tg.append(el('span', 'td-up-chev'), el('span', '', `Upcoming (${upcoming.length})`), el('small', '', `next: ${window.Portal.dayLabel(upcoming[0].doOn, todayIso)}`));
      tg.addEventListener('click', () => { if (shown) expanded.delete(key); else expanded.add(key); refresh(); });
      g.append(tg);
      if (shown) {
        const box = el('div', 'td-upcoming');
        let day = '';
        upcoming.forEach((x) => { if (x.doOn !== day) { day = x.doOn; box.append(el('div', 'td-day', window.Portal.dayLabel(day, todayIso))); } box.append(taskRow(x, refresh)); });
        g.append(box);
      }
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
    todayIso = t.today || todayIso;
    allTeams = t.teams || [];
    if (t.me) me = t.me;
    const box = el('section', 'td-tasks');
    const head = el('div', 'td-tasks-head');
    const titles = el('div');
    titles.append(el('h2', '', 'Tasks'));
    head.append(titles);
    box.append(head);
    // The search box: a student's name or any word of a task. The list redraws as it is typed and the box keeps the cursor.
    if (t.tasks.length) {
      const sb = el('div', 'td-search');
      const q = el('input', 'td-search-input');
      q.type = 'search'; q.placeholder = 'Search tasks by student name or word'; q.value = searchQ;
      q.setAttribute('aria-label', 'Search tasks by student name or word');
      let timer = null;
      q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const at = q.selectionStart;
          searchQ = q.value.trim();
          refresh();
          const again = document.querySelector('.td-search-input');
          if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* not a text box */ } }
        }, 180);
      });
      q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; q.dispatchEvent(new Event('input')); } });
      const field2 = el('label', 'td-search-field');
      const ico = el('span', 'td-search-ico');
      ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
      field2.append(ico, q);
      sb.append(field2);
      if (searchQ) {
        const n = t.tasks.filter((x) => matches(x) && !x.done).length;
        sb.append(el('span', 'td-search-n', n ? `${n} open task${n === 1 ? '' : 's'} found` : 'No open task found'));
      }
      box.append(sb);
    }
    // Which tasks to see (the owner, 15 Nov 2026): one list at a time, never mixed. The tasks for this person are split in two, Today
    // and Upcoming (moved to a later day), then "You gave", and for Admin and the Manager "Given by others"; a team also "Reassigned"
    // (handed on by it).
    const later = (x) => x.doOn && todayIso && x.doOn > todayIso;
    const forMe = t.tasks.filter((x) => x.forMe);
    const gave = t.tasks.filter((x) => !x.forMe && (x.given || x.by === me));
    const others = t.canAssign ? t.tasks.filter((x) => !x.forMe && x.by !== me) : [];
    const passed = t.canAssign ? [] : t.tasks.filter((x) => x.had && !x.forMe && !gave.includes(x));
    const showMine = t.isHead || !t.canAssign || forMe.length;
    const todayHint = t.isHead ? `Tasks the team gave you, ${t.headLabel || 'Admin'}, in order of priority.` : 'Your team\'s tasks for today, in order of priority. Tick the circle when one is done.';
    const VIEWS = [
      ['mine', 'Today', forMe, todayHint, t.isHead ? 'Nothing for you today. When the team gives you a task, it is here.' : 'Nothing for your team today. You are all caught up.', showMine, 'today'],
      ['upcoming', 'Upcoming', forMe, 'Tasks moved to a later day. Each comes back to Today on its day by itself.', '', showMine && forMe.some((x) => !x.done && later(x)), 'upcoming'],
      ['gave', 'You gave', gave, 'The tasks you gave the teams, with their updates.', 'Every task you gave is done.', t.canAssign || gave.length, ''],
      ['others', 'Given by others', others, 'Tasks the Manager or a branch gave a team.', 'Every one of them is done.', others.length, ''],
      ['passed', 'Reassigned', passed, 'Tasks your team handed on to another team. Follow them and post updates here.', 'Every one of them is done.', passed.length, ''],
    ].filter((v) => v[5]);
    // The number on each switch: what is open in it (for Upcoming, the later ones; elsewhere, today's).
    const countOf = (v) => v[2].filter((x) => !x.done && (v[6] === 'upcoming' ? later(x) : !later(x))).length;
    const freshOf = (v) => v[2].filter((x) => v[6] === 'upcoming' ? later(x) : v[6] === 'today' ? !later(x) : true).reduce((m, x) => m + (x.unread || 0), 0);
    if (!VIEWS.some((v) => v[0] === taskView)) taskView = '';
    if (!taskView) taskView = (VIEWS.find((v) => countOf(v)) || VIEWS[0] || ['mine'])[0];
    if (VIEWS.length > 1) {
      const seg = el('div', 'td-views');
      seg.setAttribute('role', 'tablist');
      seg.setAttribute('aria-label', 'Which tasks');
      VIEWS.forEach((v) => {
        const [k, label] = v;
        const b = h('button', { class: 'td-view', type: 'button', role: 'tab', 'aria-selected': String(taskView === k) }, label);
        const n = countOf(v);
        if (n) b.append(el('span', 'td-view-n', String(n)));
        if (freshOf(v)) { const dot = el('span', 'td-view-dot', ''); dot.title = 'Something new'; b.append(dot); }
        b.addEventListener('click', () => { taskView = k; tagFilter = 'all'; refresh(); });
        seg.append(b);
      });
      head.append(seg);
    }
    const view = VIEWS.find((v) => v[0] === taskView) || ['mine', 'Today', forMe, '', 'Nothing here.', true, 'today'];
    const inView = view[2];
    // The kinds (Application, Mock interview ...) of the tasks in this view, each with how many are for TODAY. A kind whose tasks are
    // all moved to later days says "2 later" in blue, so a count never promises tasks that are not under Today.
    const openAll = inView.filter((x) => !x.done && matches(x) && (view[6] === 'upcoming' ? later(x) : view[6] === 'today' ? !later(x) : true));
    if (openAll.length) {
      const now = {}; const after = {};
      openAll.forEach((x) => { const k = tagOf(x, x.stage); if (later(x)) after[k] = (after[k] || 0) + 1; else now[k] = (now[k] || 0) + 1; });
      if (tagFilter !== 'all' && !now[tagFilter] && !after[tagFilter]) tagFilter = 'all';
      const bar = el('div', 'td-filter');
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Show the tasks about');
      const pill = (k, label, n, m) => {
        const b = h('button', { class: `td-filter-pill${k === 'all' ? '' : ' tag-' + k}`, type: 'button', role: 'tab', 'aria-selected': String(tagFilter === k) }, label);
        if (n) b.append(el('span', 'td-filter-n', String(n)));
        else if (m) b.append(el('span', 'td-filter-n is-later', `${m} later`));
        b.addEventListener('click', () => { tagFilter = k; refresh(); });
        bar.append(b);
      };
      const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
      pill('all', 'All', sum(now), sum(after));
      // One kind only: "All 2, Application 2" says nothing twice, so the row is left out.
      const kinds = new Set([...Object.keys(now), ...Object.keys(after)]);
      ((window.CardFields && window.CardFields.TASK_TAGS) || []).forEach(([k, label]) => { if (now[k] || after[k]) pill(k, label, now[k] || 0, after[k] || 0); });
      if (kinds.size > 1 || tagFilter !== 'all') box.append(bar);
    }
    box.append(group(view[0], view[3], inView, refresh, view[4], view[6]));
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
  const NOTE_VERB = { task: (x) => ` gave ${x.forMe && x.team !== 'head' ? 'your team' : 'you'} a new task`, reassigned: () => ' reassigned a task', edited: () => ' changed a task', scheduled: (x, n) => (n.to && n.to > todayIso ? ` moved a task to ${window.Portal.dayLabel(n.to, todayIso)}` : ' moved a task back to today'), done: () => ' marked a task as done', update: () => ' posted an update' };
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
      line.append(el('b', '', n.by === me ? 'You' : n.by), (NOTE_VERB[n.kind] || NOTE_VERB.update)(x, n));
      // The student first, then the task (the owner, 15 Nov 2026).
      const task = el('div', 'td-note-task');
      task.append(el('b', 'td-note-student', window.Portal.niceName(x.student)), el('span', '', x.text));
      words.append(line, task);
      if (n.text) words.append(el('div', 'td-note-text', `\u201c${n.text}\u201d`));
      const side = el('div', 'td-note-side');
      side.append(el('span', 'td-note-when', ago(n.at)));
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
  // A person in two or more teams with no own team chooses it here, once (the owner, 15 Nov 2026: the Application Team kept seeing
  // the Mock Team's tasks and work). Admin and the Manager are told who has not chosen yet.
  function ownTeamCard(t) {
    const from = t.mineFrom || {};
    if (!t.canAssign && from.allTeams > 1 && !from.ownChosen && (from.choices || []).length > 1) {
      const c = el('section', 'td-own');
      c.append(el('h2', '', 'Which team do you belong to?'), el('p', '', 'You can work with the students of all your teams. Choose your own team, so only its tasks and its work list come to your Today. Admin can change it later.'));
      const row = el('div', 'td-own-choices');
      from.choices.forEach((ch) => {
        const b = h('button', { class: 'btn btn-primary', type: 'button' }, ch.label);
        b.addEventListener('click', async () => {
          row.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          try { await api('/api/my-team', { team: ch.id }); window.NiecUI.toast(`Your own team is now the ${ch.label}.`, { type: 'success' }); setTimeout(() => location.reload(), 600); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); row.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
        });
        row.append(b);
      });
      c.append(row);
      return c;
    }
    if (t.canAssign && (t.noOwnTeam || []).length) {
      const c = el('section', 'td-own is-admin');
      const names = t.noOwnTeam;
      c.append(el('h2', '', `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} no own team yet`), el('p', '', `${names.length === 1 ? 'They are' : 'Each is'} in more than one team, so every team's tasks and work list come to ${names.length === 1 ? 'them' : 'each of them'}. Choose their own team in Users (Edit, Their own team), or they choose it themselves on their Today.`));
      const go = h('a', { class: 'btn', href: '/users' }, 'Open Users');
      c.append(go);
      return c;
    }
    return null;
  }
  let closeInbox = () => {};
  function goTo(x, refresh) {
    closeInbox();
    taskView = x.forMe ? (!x.done && x.doOn && todayIso && x.doOn > todayIso ? 'upcoming' : 'mine') : (x.given || x.by === me) ? 'gave' : x.had && !canAssignAll ? 'passed' : 'others';
    tagFilter = 'all';
    searchQ = '';
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
    const later = (x) => x.doOn && tasks.today && x.doOn > tasks.today;
    const open = mine.filter((x) => !x.done && !later(x)).length;
    const upcoming = mine.filter((x) => !x.done && later(x)).length;
    const done = mine.filter(recent).length;
    const waiting = sections.reduce((n, x) => n + x.count, 0);
    const box = el('section', 'td-pulse');
    const share = open + done ? done / (open + done) : 1;
    const ring = el('div', 'td-ring');
    ring.style.setProperty('--p', String(Math.round(share * 100)));
    if (open + done) ring.append(el('b', '', `${Math.round(share * 100)}%`), el('small', '', 'this week')); else ring.append(el('b', 'td-ring-tick', '\u2713'));
    const stat = (n, label, tone) => { const x = el('div', `td-stat${tone ? ' ' + tone : ''}`); x.append(el('b', '', String(n)), el('span', '', label)); return x; };
    const words = el('div', 'td-pulse-words');
    words.append(el('h2', '', open ? `${open} task${open === 1 ? '' : 's'} for today` : 'All caught up for today'), el('p', '', `${open ? 'Tick each one when it is done.' : 'Nothing left for today. Well done.'}${upcoming ? ` ${upcoming} more on later days.` : ''}`));
    // Whose tasks come here: "Tasks of the Application Team". A person in two or more teams with no own team chosen is told so.
    const from = tasks.mineFrom;
    if (from && from.teams && from.teams.length && !tasks.canAssign) {
      if (!(from.allTeams > 1 && !from.ownChosen)) words.append(el('p', 'td-from', `Tasks of the ${from.teams.join(', ')}`));
    }
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
    // Notifications behind a bell at the top right (the owner, 15 Nov 2026): the red count shows what is new; a press opens them over
    // the page, another press, Escape or a click outside closes them, so the page itself starts with the day and the tasks.
    const bellWrap = el('div', 'td-bell-wrap');
    const bell = h('button', { class: 'td-bell', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Notifications', title: 'Notifications' });
    bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
    const bellCount = el('span', 'td-bell-count');
    bell.append(bellCount);
    const pop = el('div', 'td-bell-pop');
    pop.hidden = true;
    bellWrap.append(bell, pop);
    head.append(bellWrap);
    let popOpen = false;
    const outside = (e) => { if (!bellWrap.contains(e.target)) setPop(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setPop(false); bell.focus(); } };
    const drawPop = () => { if (popOpen) pop.replaceChildren(inbox(tasks, refresh)); };
    function setPop(open) {
      popOpen = open;
      pop.hidden = !open;
      bell.setAttribute('aria-expanded', String(open));
      if (open) { drawPop(); document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey, true); }
      else { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); }
    }
    bell.addEventListener('click', () => setPop(!popOpen));
    closeInbox = () => setPop(false);
    const refresh = async (reload) => {
      if (reload) { try { tasks = await api('/api/tasks'); } catch (e) { /* keep */ } }
      todayIso = tasks.today || d.today || todayIso;
      const fresh = tasks.tasks.reduce((n, x) => n + (x.history || []).filter((m) => m.isNew).length, 0);
      bellCount.textContent = fresh > 99 ? '99+' : String(fresh);
      bellCount.hidden = !fresh;
      bell.classList.toggle('has-new', fresh > 0);
      drawPop();
      const own = ownTeamCard(tasks);
      top.replaceChildren(...(own ? [own] : []), pulse(tasks, d.sections));
      slot.replaceChildren(tasksPanel(tasks, refresh));
    };
    refresh();
    // The day at a glance, then the tasks, then Needs attention, for everyone (the owner, 15 Nov 2026).
    page.append(head, top, slot, attention(d.sections));
    view.replaceChildren(page);
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
