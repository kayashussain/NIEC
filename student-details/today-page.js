// Today: the first screen, kept quiet on purpose. Two things only:
//   1. the tasks, one list at a time behind a switch: Today and Upcoming (this person's: their team's, or for Admin the tasks the
//      team gave them), You gave, and (Admin and the Manager) Given by others, or (a team) Reassigned; each task is one compact card
//      that says whose student it is, who gave it to whom, and folds its updates away (the owner, 15 Nov 2026);
//   2. what needs attention: one short list, a line per kind of work with how many students wait, opened with a click.
// The numbers, charts and buttons live on the Dashboard and on All Students, not here.
(function () {
  const { el, h, api, initials, stagePill, handOn, taskPriority, tagOf, tagLabel } = window.Portal;
  const view = document.getElementById('view');
  if (new URLSearchParams(location.search).get('notice') === 'admin') {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => { if (window.NiecUI) window.NiecUI.toast('That page is for Admin only.', { type: 'error' }); }, 300);
  }
  const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
  const shortDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let me = '';

  // Calm by design (the owner, 15 Nov 2026): the tasks can be narrowed to one kind (Payment, Application, NOC ...); each list shows
  // something new first, then the one waiting longest. There are no priorities (the owner, 15 Nov 2026: they added a choice and
  // showed nowhere).
  let tagFilter = 'all';
  let taskView = ''; // 'mine' (Today), 'upcoming', 'gave', 'others' or 'passed': which tasks are shown
  // Search (the owner, 15 Nov 2026): a student's name, or any word of a task or its tag, narrows every list at once.
  let searchQ = '';
  const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Admin and the Manager see the tasks as a Board only, a column per team (the owner, 15 Nov 2026: no List, no "done this week").
  const matches = (x) => (!searchQ || fold(`${x.student} ${x.text} ${tagLabel(tagOf(x, x.stage))} ${x.stage}`).includes(fold(searchQ)));
  const expanded = new Set();
  // The task a notification was pressed for (its later day opens if it waits there).
  let focusTask = null;
  // One task (portal-ui.js taskCard): the tick (only for whoever the task is for), what to do, its updates, the student, who gave it to
  // whom and when.
  function taskRow(t, refresh) {
    const fromName = t.by === me ? 'You' : t.by || 'Someone';
    // Who has it, by name (the owner, 15 Nov 2026: "Parvati", not "your team"); the team's name when nobody has it as their own team.
    const toName = peopleOf(t.team, t.teamLabel);
    return window.Portal.taskCard(t, {
      rowId: t.studentId, me, teams: allTeams, stage: t.stage, unread: t.unread || 0, canWrite: true, today: todayIso,
      mayTick: t.forMe || (canAssignAll && !t.given), tickTitle: `${t.teamLabel} ticks it when it is done`,
      canChange: t.forMe || t.by === me || canAssignAll,
      student: { name: t.student, href: '/student?id=' + encodeURIComponent(t.studentId) }, fromName, toName,
      actions: [
        !t.done && (t.forMe || t.by === me || canAssignAll) && [t.doOn && t.doOn > todayIso ? 'Change the day' : 'Move to another day', async () => { if (await window.Portal.scheduleTask(t, { rowId: t.studentId, today: todayIso })) { window.NiecUI.toast('Moved. It waits under Upcoming.', { type: 'success' }); refresh(true); } }],
        (canAssignAll || t.by === me) && ['Edit the task', async () => { if (await window.Portal.editTask(t, { rowId: t.studentId, stage: t.stage })) { window.NiecUI.toast('Task updated. The team is told.', { type: 'success' }); refresh(true); } }],
        t.mayHand && ['Reassign to another team', async () => { if (await handOn(t, { rowId: t.studentId, teams: handTeams })) { window.NiecUI.toast('Reassigned. You can still follow it here.', { type: 'success' }); refresh(true); } }],
        (canAssignAll || t.by === me) && ['Remove the task', async () => { if (await window.NiecUI.confirm('Remove this task and its updates?', { danger: true, confirmText: 'Remove' })) { try { await api(`/api/cards/${encodeURIComponent(t.studentId)}/tasks/${t.id}/delete`, {}); refresh(true); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, true],
      ],
      onTick: async (done, folded, finish) => {
        try {
          await api(`/api/cards/${encodeURIComponent(t.studentId)}/tasks/${t.id}`, { done, ...(finish ? { finish } : {}) });
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
  let handTeams = []; // where this person may reassign a task (never their own team)
  // The people a team's tasks go to ("Parvati", "Parvati, Sovat", "Parvati, Sovat +2"); "You" when it is this person alone.
  function peopleOf(team, fallback) {
    const names = ((allTeams.find((x) => x.id === team) || {}).members || []).map((n) => (n === me ? 'You' : n));
    if (!names.length) return fallback || team;
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }

  // One list of tasks under its own heading, the oldest first and the newest last; the ones done in the last 7 days fold away at the bottom.
  // The tasks sit in one calm list, a hairline between each (the owner, 15 Nov 2026: not a separate box per task).
  function listOf(items, refresh) { const l = el('div', 'td-list'); items.forEach((x) => l.append(taskRow(x, refresh))); return l; }
  // Tasks grouped by their day, each day under a small heading.
  function byDay(items, refresh, into) {
    let day = ''; let l = null;
    items.forEach((x) => { if (x.doOn !== day) { day = x.doOn; into.append(el('div', 'td-day', window.Portal.dayLabel(day, todayIso))); l = el('div', 'td-list'); into.append(l); } l.append(taskRow(x, refresh)); });
  }
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
    const head = el('div', 'td-group-head');
    // No sentence above the list (the owner, 15 Nov 2026: only what is needed); just what is new or urgent.
    head.append(el('div'));
    const chips = el('div', 'td-sum');
    // What is new shows as a blue dot on the task and a red dot on the switch, so no extra chip here.
    head.append(chips);
    g.append(head);
    if (mode === 'upcoming') {
      if (!upcoming.length) g.append(emptyNote(searchQ ? `No later task matches \u201c${searchQ}\u201d.` : 'Nothing planned for later days.'));
      byDay(upcoming, refresh, g);
      return g;
    }
    if (!open.length) {
      const kind = tagFilter !== 'all' ? ` about ${tagLabel(tagFilter).toLowerCase()}` : '';
      const where = mode === 'today' ? 'under Upcoming' : 'below';
      g.append(emptyNote(upcoming.length ? `Nothing${kind} for today. ${upcoming.length} on later days, ${where}.` : searchQ ? `No task for today matches \u201c${searchQ}\u201d.` : kind ? `Nothing${kind} for today.` : emptyText));
    }
    // Every open task shows, however many (the owner, 15 Nov 2026: no "Show all"); a task done leaves Today (it stays on the student's
    // card); the later ones are under the Upcoming switch, or folded under the list in You gave and the others.
    if (open.length) g.append(listOf(open, refresh));
    if (upcoming.length && mode !== 'today') {
      const key = 'up:' + title;
      const shown = expanded.has(key) || upcoming.some((x) => x.id === focusTask) || !open.length;
      const tg = h('button', { class: 'td-up-toggle', type: 'button', 'aria-expanded': String(shown) });
      tg.append(el('span', 'td-up-chev'), el('span', '', `Later days (${upcoming.length})`), el('small', '', `next: ${window.Portal.dayLabel(upcoming[0].doOn, todayIso)}`));
      tg.addEventListener('click', () => { if (shown) expanded.delete(key); else expanded.add(key); refresh(); });
      g.append(tg);
      if (shown) { const box = el('div', 'td-upcoming'); byDay(upcoming, refresh, box); g.append(box); }
    }
    return g;
  }

  // ---- the Board (Admin and the Manager) ----
  // A column per team, the team's open tasks as small tiles (the student, the task, its tag, how long it has waited, its updates), the
  // oldest first and the newest last. A press opens the whole task (tick, updates, Edit, Reassign) in a window.
  const daysOpen = (x) => { const t = Date.parse(x.at); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : 0; };
  function tile(x, refresh) {
    const later = x.doOn && todayIso && x.doOn > todayIso;
    const n = (x.comments || []).filter((c) => c.text).length;
    const d = daysOpen(x);
    const b = h('button', { class: `tb-tile${x.unread ? ' is-new' : ''}`, type: 'button', title: 'Open the task' });
    const top = el('div', 'tb-tile-top');
    top.append(el('b', 'tb-student', window.Portal.niceName ? window.Portal.niceName(x.student) : x.student), el('span', 'tb-stage', x.stage || ''));
    const what = el('div', 'tb-text', x.text);
    const meta = el('div', 'tb-meta');
    const tg = tagOf(x, x.stage);
    meta.append(el('span', `tb-tag tag-${tg}`, tagLabel(tg)));
    if (later) meta.append(el('span', 'tb-age is-later', window.Portal.dayLabel(x.doOn, todayIso)));
    else meta.append(el('span', `tb-age${d >= 3 ? ' is-slow' : ''}`, d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`));
    if (n) { const u = el('span', 'tb-updates'); u.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/></svg>'; u.append(String(n)); meta.append(u); }
    // The latest word on it, in one grey line ("Asha: submitted on the portal"), so the progress shows without opening it.
    const last = (x.comments || []).filter((c) => c.text).slice(-1)[0];
    b.append(top, what);
    if (last) b.append(el('div', 'tb-last', `${last.by === me ? 'You' : String(last.by || '').split(/\s+/)[0]}: ${last.text}`));
    b.append(meta);
    b.addEventListener('click', () => {
      window.Portal.dialog(window.Portal.niceName ? window.Portal.niceName(x.student) : x.student, (body, close) => {
        body.classList.add('tb-dialog-body');
        body.append(taskRow(x, () => close()));
        const foot = el('div', 'p-dialog-foot');
        const open = h('a', { class: 'btn', href: '/student?id=' + encodeURIComponent(x.studentId) }, 'Open the student card');
        foot.append(open, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, 'Close'));
        body.append(foot);
      }).then(() => refresh(true));
    });
    return b;
  }
  function boardOf(t, refresh) {
    const list = t.tasks.filter((x) => !x.done && matches(x) && (tagFilter === 'all' || tagOf(x, x.stage) === tagFilter));
    // The columns: tasks for this person first ("For you"), then every team in the order of the teams list, then any other.
    const order = ['head', ...allTeams.map((x) => x.id).filter((id) => id !== 'head')];
    const cols = new Map();
    list.forEach((x) => { const k = x.forMe && x.team === 'head' ? 'head' : x.team; if (!cols.has(k)) cols.set(k, []); cols.get(k).push(x); });
    // Admin always has a "For you" column first, also when nothing is given to them yet, so they always know where their own tasks are.
    if (t.isHead && !cols.has('head') && !searchQ && tagFilter === 'all') cols.set('head', []);
    const keys = [...cols.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const wrap = el('div', 'tb-board');
    if (!keys.length || (keys.length === 1 && !cols.get(keys[0]).length)) { wrap.replaceChildren(); wrap.append(emptyNote(searchQ || tagFilter !== 'all' ? 'No task matches.' : 'Every team is up to date.')); return wrap; }
    keys.forEach((k) => {
      const items = cols.get(k);
      // The oldest first, the newest last (the owner, 17 Nov 2026), whatever is new on it (its blue dot shows that).
      const open = items.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      const slow = open.filter((x) => daysOpen(x) >= 3).length;
      const label = k === 'head' ? 'For you' : ((allTeams.find((x) => x.id === k) || {}).label || (items[0] && items[0].teamLabel) || k).replace(/\s*\(.*\)$/, '');
      const col = el('section', 'tb-col');
      const head = el('header', 'tb-col-head');
      const name = el('div', 'tb-col-name');
      name.append(el('span', 'tb-col-dot'), el('b', '', label), el('span', 'tb-col-n', String(open.length)));
      head.append(name);
      const sub = el('div', 'tb-col-sub');
      sub.append(el('span', '', k === 'head' ? 'Given to you' : peopleOf(k, label)));
      if (slow) sub.append(el('span', 'tb-col-slow', `${slow} waiting 3+ days`));
      head.append(sub);
      col.append(head);
      const body = el('div', 'tb-col-body');
      if (!open.length) body.append(el('div', 'tb-col-empty', 'Nothing for you right now.'));
      open.forEach((x) => body.append(tile(x, refresh)));
      col.append(body);
      wrap.append(col);
    });
    return wrap;
  }
  // The kinds of task in one row of pills (All, Application, NOC ...), with how many open in each.
  function kindPills(items, refresh) {
    const count = {};
    items.forEach((x) => { const k = tagOf(x, x.stage); count[k] = (count[k] || 0) + 1; });
    const kinds = Object.keys(count);
    if (kinds.length < 2 && tagFilter === 'all') return null;
    const bar = el('div', 'td-filter');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Show the tasks about');
    const pill = (k, label, n) => {
      const b = h('button', { class: `td-filter-pill${k === 'all' ? '' : ' tag-' + k}`, type: 'button', role: 'tab', 'aria-selected': String(tagFilter === k) }, label);
      if (n) b.append(el('span', 'td-filter-n', String(n)));
      b.addEventListener('click', () => { tagFilter = k; refresh(); });
      bar.append(b);
    };
    pill('all', 'All', 0);
    ((window.CardFields && window.CardFields.TASK_TAGS) || []).forEach(([k, label]) => { if (count[k] || tagFilter === k) pill(k, label, count[k] || 0); });
    return bar;
  }

  function tasksPanel(t, refresh) {
    canAssignAll = Boolean(t.canAssign);
    todayIso = t.today || todayIso;
    allTeams = t.teams || [];
    handTeams = t.handTeams || [];
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
      q.type = 'search'; q.placeholder = 'Search tasks by student name or word   ( / )'; q.value = searchQ;
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
    // The Board, for Admin and the Manager: the kind pills, then a column per team.
    if (canAssignAll && t.tasks.length) {
      const pills = kindPills(t.tasks.filter((x) => !x.done && matches(x)), refresh);
      if (pills) box.append(pills);
      box.append(boardOf(t, refresh));
      return box;
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
    const todayHint = '';
    const VIEWS = [
      ['mine', 'Today', forMe, todayHint, 'No task for today.', showMine, 'today'],
      ['upcoming', 'Upcoming', forMe, '', '', showMine && forMe.some((x) => !x.done && later(x)), 'upcoming'],
      ['gave', 'You gave', gave, '', 'Every task you gave is done.', t.canAssign || gave.length, ''],
      ['others', 'Given by others', others, '', 'All done.', others.length, ''],
      ['passed', 'Reassigned', passed, '', 'All done.', passed.length, ''],
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
      box.append(el('p', 'td-inbox-empty', 'Nothing yet.'));
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
  // Go to one task: every kind shown, then glide to it, open its updates and mark
  // it read.
  // A person in two or more teams with no own team chooses it here, once (the owner, 15 Nov 2026: the Application Team kept seeing
  // the Mock Team's tasks and work). Admin and the Manager are told who has not chosen yet.
  function ownTeamCard(t) {
    const from = t.mineFrom || {};
    if (!t.canAssign && from.allTeams > 1 && !from.ownChosen && (from.choices || []).length > 1) {
      const c = el('section', 'td-own');
      c.append(el('h2', '', 'Which team do you belong to?'), el('p', '', 'Choose your own team: only its tasks come to you.'));
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
      c.append(el('h2', '', `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} no own team yet`), el('p', '', `In more than one team with no own team chosen. Set it in Users.`));
      const go = h('a', { class: 'btn', href: '/users' }, 'Open Users');
      c.append(go);
      return c;
    }
    return null;
  }
  let closeInbox = () => {};
  function goTo(x, refresh) {
    closeInbox();
    // A done task is no longer on Today: it is on the student's card.
    if (x.done) { api(`/api/cards/${encodeURIComponent(x.studentId)}/tasks/${x.id}`, { seen: true }).catch(() => {}).then(() => { location.href = '/student?id=' + encodeURIComponent(x.studentId); }); return; }
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
    head.append(el('h2', '', 'Needs attention'));
    if (!waiting.length) head.append(el('p', '', 'Nothing is waiting.'));
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

  // The day at a glance, at the top: how many tasks are open, how many have waited 3 days or more and how many students wait for a
  // next step. "All caught up" when nothing is open.
  function pulse(tasks, sections, waitingCount) {
    // Admin and the Manager see the whole team's work here, not only their own tasks. What is done is in the students' notes, so
    // nothing here counts it (the owner, 15 Nov 2026).
    const mine = tasks.canAssign ? tasks.tasks : tasks.tasks.filter((x) => x.forMe);
    const later = (x) => x.doOn && tasks.today && x.doOn > tasks.today;
    const openList = mine.filter((x) => !x.done && !later(x));
    const open = openList.length;
    const upcoming = mine.filter((x) => !x.done && later(x)).length;
    const slow = openList.filter((x) => Date.now() - Date.parse(x.at || 0) >= 3 * 86400000).length;
    const waiting = typeof waitingCount === 'number' ? waitingCount : sections.reduce((n, x) => n + x.count, 0);
    const box = el('section', 'td-pulse');
    const stat = (n, label, tone) => { const x = el('div', `td-stat${tone ? ' ' + tone : ''}`); x.append(el('b', '', String(n)), el('span', '', label)); return x; };
    const words = el('div', 'td-pulse-words');
    words.append(el('h2', '', open ? `${open} task${open === 1 ? '' : 's'} ${tasks.canAssign ? 'open across the teams' : 'for today'}` : 'All caught up'));
    if (upcoming) words.append(el('p', '', `${upcoming} more on later days`));
    box.append(words, stat(slow, 'waiting 3+ days', slow ? 'warn' : ''), stat(waiting, 'students waiting', waiting ? 'warn' : ''));
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
      bell.setAttribute('aria-label', fresh ? `Notifications, ${fresh > 99 ? '99+' : fresh} new` : 'Notifications');
      bell.classList.toggle('has-new', fresh > 0);
      drawPop();
      const own = ownTeamCard(tasks);
      page.classList.toggle('is-board', Boolean(tasks.canAssign));
      top.replaceChildren(...(own ? [own] : []), pulse(tasks, d.sections, d.waiting));
      slot.replaceChildren(tasksPanel(tasks, refresh));
    };
    refresh();
    // The day at a glance, then the tasks, then Needs attention, for everyone (the owner, 15 Nov 2026).
    page.append(head, top, slot, attention(d.sections));
    view.replaceChildren(page);

    // A student's name opens their card over Today (card-drawer.js), with ‹ › to go through every student on the page in order, so
    // nobody leaves Today and comes back (the owner, 17 Nov 2026: less work). Closing it brings the tasks up to date. A Ctrl or
    // middle click still opens the card in a new tab.
    const busy = () => Boolean(document.querySelector('.p-drawer, .p-dialog, dialog[open]')) || popOpen;
    page.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/student?id="]');
      if (!a || !window.CardDrawer || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const idOf = (x) => new URL(x.href, location.origin).searchParams.get('id');
      const ids = [...new Set([...page.querySelectorAll('a[href^="/student?id="]')].map(idOf).filter(Boolean))];
      e.preventDefault();
      window.CardDrawer.open(idOf(a), { list: ids, onClose: () => refresh(true) });
    });
    // Today stays open all day: the tasks are read again every minute while the page is in view, and at once when it comes back
    // into view, but never while someone is in a box (an update, the search) or has a card or a window open.
    const typing = () => { const x = document.activeElement; return Boolean(x && /^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName)); };
    const quiet = () => { if (!document.hidden && !busy() && !typing()) refresh(true); };
    setInterval(quiet, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) quiet(); });
    // "/" jumps to the task search, as on the Fact File.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || busy()) return;
      const q = page.querySelector('.td-search-input');
      if (q) { e.preventDefault(); q.focus(); }
    });
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
