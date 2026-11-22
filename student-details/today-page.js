// Today: the first screen, kept quiet on purpose (the owner, 21 Nov 2026, "Option A"):
//   1. a team's own tasks behind a switch: Today and Later (a task rescheduled to a later day), and for the Application Team Missing
//      details; each task is one line, the student's name first, then the task, its kind and its course, late ones first; a press opens
//      the course, how to reach the student, the updates and Mark as done, Reschedule, Reassign and View student profile. Admin and
//      the Manager see the Board, a column per team;
//   2. for the other teams, what needs attention: one short list, a line per kind of work with how many students wait.
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
  let taskView = ''; // 'mine' (Today), 'upcoming', 'gave', or 'others': which tasks are shown
  // Search (the owner, 15 Nov 2026): a student's name, or any word of a task or its tag, narrows every list at once.
  let searchQ = '';
  const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Admin and the Manager see the tasks as a Board only, a column per team (the owner, 15 Nov 2026: no List, no "done this week").
  const matches = (x) => (!searchQ || fold(`${x.student} ${x.text} ${tagLabel(tagOf(x, x.stage))} ${x.stage} ${x.course ? `${x.course.university} ${x.course.course}` : ''}`).includes(fold(searchQ)));
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
      // canWrite: only who the server lets write (a view-only Manager reads).
      rowId: t.studentId, me, teams: allTeams, stage: t.stage, unread: t.unread || 0, canWrite: (t.forMe || t.by === me || canAssignAll || t.had), today: todayIso,
      mayTick: t.forMe || (canAssignAll && !t.given), tickTitle: `${t.teamLabel} ticks it when it is done`,
      canChange: t.by === me || canAssignAll, // the tag is changed by whoever gave the task, Admin or the Manager (as the server allows)
      student: { name: t.student, href: '/student?id=' + encodeURIComponent(t.studentId) }, fromName, toName,
      actions: [
        !t.done && (t.forMe || t.by === me || canAssignAll) && ['Reschedule', async () => { if (await window.Portal.scheduleTask(t, { rowId: t.studentId, today: todayIso })) { window.NiecUI.toast('Rescheduled. It waits under Later.', { type: 'success' }); refresh(true); } }],
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
  let canAssignAll = false; // may give, change and remove any task (Admin and a Manager who is not view-only)
  let seesAll = false; // sees every team's tasks on the Board (Admin and every Manager)
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
    items.forEach((x) => { if (x.doOn !== day) { day = x.doOn; into.append(el('h3', 'tdx-group', window.Portal.dayLabel(day, todayIso))); l = el('div', 'tdx-list'); into.append(l); } l.append(rowFor(x, refresh)); });
  }
  function emptyNote(text) {
    const empty = el('div', 'td-empty');
    empty.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    empty.append(el('div', '', text));
    return empty;
  }
  // `mode`: 'today' shows only what is for today (a link points at Later), 'upcoming' only the later days, one heading per day;
  // anything else shows today's tasks with the later ones folded under them.
  function group(title, hint, all, refresh, emptyText, mode) {
    const g = el('div', 'td-group');
    const list = (tagFilter === 'all' ? all : all.filter((x) => tagOf(x, x.stage) === tagFilter)).filter(matches);
    // Today and Later (the owner, 15 and 21 Nov 2026): a task rescheduled to a later day waits under Later and is back under Today on its day.
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
      if (!upcoming.length) g.append(emptyNote(searchQ ? `No later task matches \u201c${searchQ}\u201d.` : 'Nothing is planned for a later day. A task you reschedule waits here.'));
      byDay(upcoming, refresh, g);
      return g;
    }
    if (!open.length) {
      const kind = tagFilter !== 'all' ? ` about ${tagLabel(tagFilter).toLowerCase()}` : '';
      const where = mode === 'today' ? 'under Later' : 'below';
      g.append(emptyNote(upcoming.length ? `Nothing${kind} for today. ${upcoming.length} on later days, ${where}.` : searchQ ? `No task for today matches \u201c${searchQ}\u201d.` : kind ? `Nothing${kind} for today.` : emptyText));
    }
    // Every open task shows, however many (the owner, 15 Nov 2026: no "Show all"); a task done leaves Today (it stays on the student's
    // card); the later ones are under the Later switch, or folded under the list in You gave and the others (Admin and the Manager).
    if (open.length) rowsOf(open, refresh, g);
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

  // ---- Today for a team (the owner, 21 Nov 2026, "Option A"): one line per task, the student's name first and large, then the task,
  // then the course; a press opens what the task needs: the course and how to reach the student, the updates, and four buttons. ----
  const DAY = 86400000;
  const LATE = 3; // days: a task waiting this long is late and listed first
  const opened = new Set(); // the tasks opened on this page (kept when the list is read again every minute)
  let todayData = null; // the /api/today answer: the Missing details list for the Application Team
  const isoDay = (v) => {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' }); } catch (e) { return d.toISOString().slice(0, 10); }
  };
  // How many days a task has waited: from the day it was given, or from the day it was moved to when that is later (a task moved to
  // today is not late at once).
  const waitDays = (x) => {
    const from = [isoDay(x.at), x.doOn || ''].filter(Boolean).sort().pop();
    if (!from || !todayIso) return 0;
    return Math.max(0, Math.round((Date.parse(todayIso + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY));
  };
  const isLate = (x) => waitDays(x) >= LATE;
  const dayShort = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
  // What the task asks, in a few words: "Apply to Coventry University", "Has an offer come from Coventry University?", else its words.
  function titleOf(x) {
    const c = x.course;
    if (x.tag === 'offer' && c) return `Has an offer come from ${c.university}?`;
    if (c && (x.app || /^apply\b/i.test(String(x.text || '')))) return `Apply to ${c.university}`;
    return String(x.text || '').split('\n')[0];
  }
  // The grey line under a closed task: the course, its intake and how many updates.
  function metaOf(x) {
    const c = x.course;
    const n = (x.comments || []).filter((m) => m.text).length;
    // A task with no course of its own says the student's stage and intake instead, so every line reads the same.
    const bits = c ? [c.course, c.intake, x.tag === 'offer' && c.applied ? `applied on ${dayShort(c.applied)}` : ''] : [x.stage, x.intake];
    if (n) bits.push(`${n} update${n === 1 ? '' : 's'}`);
    return bits.filter(Boolean).join(' · ');
  }
  // The course and how to reach the student, in one box. The WhatsApp number opens a chat, the email a new email; a detail not saved
  // says so, with Add (the student's profile).
  function factsOf(x) {
    const box = el('div', 'tdx-facts');
    const c = x.course;
    const cell = (label, value, wide) => { const d = el('div', `tdx-fact${wide ? ' is-wide' : ''}`); d.append(el('span', 'tdx-label', label)); const b = el('b', 'tdx-value'); b.append(value); d.append(b); box.append(d); return d; };
    const missingVal = () => { const w = el('span', 'tdx-missing'); w.append('Not saved '); const a = h('a', { href: '/student?id=' + encodeURIComponent(x.studentId) }, 'Add'); w.append(a); return w; };
    if (c) {
      cell('University', c.university, true);
      cell('Course', c.course || 'Not saved', true);
      cell('Intake', c.intake || 'Not saved');
      if (x.tag === 'offer') cell('Applied on', c.applied ? dayShort(c.applied) : 'Not saved');
      else cell('Level', c.level || 'Not saved');
    }
    const k = x.contact || {};
    cell('Source', k.source || 'Not saved', Boolean(c));
    let phone;
    if (k.wa) {
      phone = h('a', { href: `https://wa.me/${k.wa}`, target: '_blank', rel: 'noopener', title: 'Open a WhatsApp chat with the student' }, k.phone);
      phone.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); window.Portal.whatsapp(k.wa, x.student, '', x.studentId); });
    } else phone = k.phone ? k.phone : missingVal();
    cell('WhatsApp', phone, true).classList.add('is-contact');
    const mail = k.email ? h('a', { href: `mailto:${k.email}`, title: 'Write a new email to the student' }, k.email) : (k.emailText ? k.emailText : missingVal());
    cell('Email', mail, true).classList.add('is-contact');
    return box;
  }
  // One task. `refresh(true)` reads the tasks again.
  function rowFor(x, refresh) {
    const r = el('article', `tdx${x.unread ? ' has-unread' : ''}`);
    r.dataset.taskId = x.id;
    const open = opened.has(x.id) || focusTask === x.id;
    const head = h('div', { class: 'tdx-head', role: 'button', tabindex: '0', 'aria-expanded': String(open), title: open ? 'Close' : 'Open the task' });
    const av = el('span', 'tdx-av', initials(x.student));
    av.setAttribute('aria-hidden', 'true');
    const main = el('div', 'tdx-main');
    const name = h('a', { class: 'tdx-name', href: '/student?id=' + encodeURIComponent(x.studentId), title: 'View student profile' }, window.Portal.niceName ? window.Portal.niceName(x.student) : x.student);
    const nameLine = el('div', 'tdx-name-line');
    if (x.unread && !open) { const dot = el('span', 'tdx-new'); dot.title = 'Something new'; nameLine.append(dot); }
    nameLine.append(name);
    const task = el('p', 'tdx-task');
    task.append(el('span', '', titleOf(x)), el('span', `tdx-kind tag-${tagOf(x, x.stage)}`, tagLabel(tagOf(x, x.stage))));
    main.append(nameLine, task);
    const meta = metaOf(x);
    if (meta) main.append(el('p', 'tdx-meta', meta));
    const w = waitDays(x);
    const later = x.doOn && todayIso && x.doOn > todayIso;
    const age = el('span', `tdx-age${later ? ' is-later' : w >= LATE ? ' is-late' : ''}`, later ? window.Portal.dayLabel(x.doOn, todayIso) : w >= LATE ? `Waiting ${w} days` : w === 0 ? 'New today' : `${w} day${w === 1 ? '' : 's'}`);
    const chev = el('span', 'tdx-chev');
    chev.setAttribute('aria-hidden', 'true');
    head.append(av, main, age, chev);
    r.append(head);
    // Opened or closed, the task's own line stays in view (its close button never scrolls away).
    const toggle = () => {
      if (opened.has(x.id)) opened.delete(x.id); else opened.add(x.id);
      if (focusTask === x.id) focusTask = null;
      refresh();
      const again = document.querySelector(`.tdx[data-task-id="${x.id}"]`);
      if (again) again.scrollIntoView({ block: 'nearest' });
    };
    head.addEventListener('click', (e) => { if (e.target.closest('a')) return; toggle(); });
    head.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); toggle(); } });
    if (!open) return r;

    r.classList.add('is-open');
    const body = el('div', 'tdx-body');
    // An Offer request is made by ISR when the application is submitted; any other task says who gave it.
    const given = el('p', 'tdx-given', x.tag === 'offer' ? `Made by ISR when the application was submitted${x.at ? ` on ${dayShort(isoDay(x.at))}` : ''}` : `Given by ${x.by === me ? 'you' : x.by || 'someone'}${x.at ? ` on ${dayShort(isoDay(x.at))}` : ''}`);
    body.append(given, factsOf(x));
    // The updates: the conversation on the task, and the box to write one.
    const ups = el('div', 'tdx-updates');
    const n = (x.comments || []).filter((m) => m.text).length;
    ups.append(el('p', 'tdx-label', `Updates on this task${n ? ` · ${n}` : ''}`));
    const thread = window.Portal.taskThread(x, { rowId: x.studentId, me, canWrite: !x.done && (x.forMe || x.by === me || canAssignAll), unread: x.unread || 0, teams: allTeams, today: todayIso, always: true });
    ups.append(thread);
    body.append(ups);
    if (x.unread && thread.markRead) { thread.markRead(); r.classList.remove('has-unread'); }
    r.openThread = () => { if (thread.markRead) thread.markRead(); };
    // Mark as done, Reschedule, Reassign, View student profile (the owner, 21 Nov 2026); Edit and Remove for whoever gave it.
    const acts = el('div', 'tdx-actions');
    if (!x.done && (x.forMe || (canAssignAll && !x.given))) {
      const done = h('button', { class: 'btn btn-primary tdx-done', type: 'button' });
      done.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      done.append('Mark as done');
      done.addEventListener('click', async () => {
        const finish = await window.Portal.doneDialog(x, { rowId: x.studentId, stage: x.stage, student: { name: x.student }, today: todayIso });
        if (!finish) return;
        done.disabled = true;
        try {
          await api(`/api/cards/${encodeURIComponent(x.studentId)}/tasks/${x.id}`, { done: true, finish });
          window.NiecUI.toast(window.Portal.cheer(), { type: 'success' });
          opened.delete(x.id);
          refresh(true);
        } catch (e) { done.disabled = false; window.NiecUI.toast(e.message, { type: 'error' }); }
      });
      acts.append(done);
    }
    if (!x.done && (x.forMe || x.by === me || canAssignAll)) {
      acts.append(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await window.Portal.scheduleTask(x, { rowId: x.studentId, today: todayIso })) { window.NiecUI.toast('Rescheduled. It waits under Later.', { type: 'success' }); refresh(true); } } }, 'Reschedule'));
    }
    if (x.mayHand) acts.append(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await handOn(x, { rowId: x.studentId, teams: handTeams })) { window.NiecUI.toast('Reassigned.', { type: 'success' }); refresh(true); } } }, 'Reassign'));
    acts.append(h('a', { class: 'btn tdx-profile', href: '/student?id=' + encodeURIComponent(x.studentId) }, 'View student profile'));
    const mayEdit = canAssignAll || (x.by === me && x.tag !== 'offer'); // an Offer request is ISR's own: Admin may change it
    const menu = window.Portal.taskMenu([
      mayEdit && ['Edit the task', async () => { if (await window.Portal.editTask(x, { rowId: x.studentId, stage: x.stage })) { window.NiecUI.toast('Task updated. The team is told.', { type: 'success' }); refresh(true); } }],
      mayEdit && ['Remove the task', async () => { if (await window.NiecUI.confirm('Remove this task and its updates?', { danger: true, confirmText: 'Remove' })) { try { await api(`/api/cards/${encodeURIComponent(x.studentId)}/tasks/${x.id}/delete`, {}); refresh(true); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, true],
    ]);
    if (menu) acts.append(menu);
    body.append(acts);
    r.append(body);
    return r;
  }
  // A list of tasks; the late ones first under their own heading when there are any (the owner, 21 Nov 2026).
  function rowsOf(items, refresh, into) {
    const late = items.filter(isLate);
    const rest = items.filter((x) => !isLate(x));
    const list = (xs) => { const l = el('div', 'tdx-list'); xs.forEach((x) => l.append(rowFor(x, refresh))); return l; };
    if (late.length) {
      into.append(el('h3', 'tdx-group is-late', `Late, do these first · ${late.length}`), list(late));
      if (rest.length) into.append(el('h3', 'tdx-group', `Today · ${rest.length}`));
    }
    if (rest.length) into.append(list(rest));
  }
  // Missing details (the owner, 21 Nov 2026): every student the Application Team can correct whose application, passport or medical
  // details are missing or do not add up; one line per problem and one button, Fix it.
  function missingPanel(refresh) {
    const box = el('div', 'td-group');
    const all = (todayData && todayData.missing) || [];
    const list = all.filter((m) => !searchQ || fold(`${m.name} ${m.lines.map((l) => l.text).join(' ')}`).includes(fold(searchQ)));
    if (!list.length) { box.append(emptyNote(searchQ ? `No student matches “${searchQ}”.` : 'Nothing is missing. Every detail is in.')); return box; }
    const l = el('div', 'tdx-list');
    list.forEach((m) => {
      const r = el('article', 'tdx tdx-miss');
      const head = el('div', 'tdx-head');
      const av = el('span', 'tdx-av', initials(m.name));
      av.setAttribute('aria-hidden', 'true');
      const main = el('div', 'tdx-main');
      const nameLine = el('div', 'tdx-name-line');
      const shownName = window.Portal.niceName ? window.Portal.niceName(m.name) : m.name;
      // A booking not matched to a student yet (the Mock Team) has no card to open.
      nameLine.append(m.id ? h('a', { class: 'tdx-name', href: '/student?id=' + encodeURIComponent(m.id), title: 'View student profile' }, shownName) : el('span', 'tdx-name', shownName));
      main.append(nameLine, el('p', 'tdx-meta', [m.stage, m.intake].filter(Boolean).join(' · ')));
      const ul = el('ul', 'tdx-problems');
      m.lines.forEach((ln) => ul.append(el('li', '', ln.text)));
      main.append(ul);
      // A line about a Medical task is fixed by finishing that task; everything else on the student's profile.
      const onTask = m.lines.every((ln) => ln.taskId) ? (tasksNow.find((t) => t.id === m.lines[0].taskId) || null) : null;
      // The Mock Team's lines say what to do (Write feedback, Answer, Copy booking link) and where (the owner, 22 Nov 2026).
      const act = (m.lines.find((ln) => ln.action && /^\/[\w-]/.test(ln.action.href || '')) || {}).action;
      const fix = act ? h('a', { class: 'btn btn-primary tdx-fix', href: act.href }, act.label)
        : onTask ? h('button', { class: 'btn btn-primary tdx-fix', type: 'button', onclick: () => goTo(onTask, refresh) }, 'Fix it')
        : h('a', { class: 'btn btn-primary tdx-fix', href: '/student?id=' + encodeURIComponent(m.id) }, 'Fix it');
      head.append(av, main, fix);
      r.append(head);
      l.append(r);
    });
    box.append(l);
    return box;
  }
  let tasksNow = []; // the tasks as last read (Missing details points at a Medical task)

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
    seesAll = Boolean(t.seesAll);
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
    if (t.tasks.length || (todayData && todayData.missing && todayData.missing.length)) {
      const sb = el('div', 'td-search');
      const q = el('input', 'td-search-input');
      q.type = 'search'; q.placeholder = 'Find a student, university or task   ( / )'; q.value = searchQ;
      q.setAttribute('aria-label', 'Find a student, university or task');
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
    if (seesAll && t.tasks.length) {
      const pills = kindPills(t.tasks.filter((x) => !x.done && matches(x)), refresh);
      if (pills) box.append(pills);
      box.append(boardOf(t, refresh));
      return box;
    }
    // Which tasks to see (the owner, 15 Nov 2026): one list at a time, never mixed. The tasks for this person are split in two, Today
    // and Later (rescheduled to a later day); for Admin and the Manager also "You gave" and "Given by others". A task handed on to another
    // team is no longer listed here (the owner, 20 Nov 2026).
    const later = (x) => x.doOn && todayIso && x.doOn > todayIso;
    const forMe = t.tasks.filter((x) => x.forMe);
    const gave = t.tasks.filter((x) => !x.forMe && (x.given || x.by === me));
    const others = t.canAssign ? t.tasks.filter((x) => !x.forMe && x.by !== me) : [];
    const showMine = t.isHead || !t.canAssign || forMe.length;
    const todayHint = '';
    // A team sees only its own tasks (the owner, 21 Nov 2026): Today and Later, and for the Application Team Missing details. Later is
    // always there, so a rescheduled task is never lost. "You gave" stays for Admin and the Manager only.
    const VIEWS = [
      ['mine', 'Today', forMe, todayHint, 'No task for today.', showMine, 'today'],
      ['upcoming', 'Later', forMe, '', '', showMine, 'upcoming'],
      ['missing', 'Missing details', [], '', '', Boolean(todayData && todayData.missing), 'missing'],
      ['gave', 'You gave', gave, '', 'Every task you gave is done.', t.canAssign, ''],
      ['others', 'Given by others', others, '', 'All done.', t.canAssign && others.length, ''],
    ].filter((v) => v[5]);
    // The number on each switch: what is open in it (for Later, the later ones; elsewhere, today's).
    const countOf = (v) => (v[6] === 'missing' ? ((todayData && todayData.missing) || []).length : v[2].filter((x) => !x.done && (v[6] === 'upcoming' ? later(x) : !later(x))).length);
    const freshOf = (v) => v[2].filter((x) => v[6] === 'upcoming' ? later(x) : v[6] === 'today' ? !later(x) : true).reduce((m, x) => m + (x.unread || 0), 0);
    if (!VIEWS.some((v) => v[0] === taskView)) taskView = '';
    if (!taskView) taskView = (VIEWS[0] || ['mine'])[0]; // Today first, always (the owner, 21 Nov 2026)
    if (VIEWS.length > 1) {
      const seg = el('div', 'td-views');
      seg.setAttribute('role', 'tablist');
      seg.setAttribute('aria-label', 'Which tasks');
      VIEWS.forEach((v) => {
        const [k, label] = v;
        const b = h('button', { class: 'td-view', type: 'button', role: 'tab', 'aria-selected': String(taskView === k) }, label);
        const n = countOf(v);
        if (n) b.append(el('span', `td-view-n${v[6] === 'missing' ? ' is-missing' : ''}`, n > 999 ? '999+' : String(n)));
        if (freshOf(v)) { const dot = el('span', 'td-view-dot', ''); dot.title = 'Something new'; b.append(dot); }
        b.addEventListener('click', () => { taskView = k; tagFilter = 'all'; refresh(); });
        seg.append(b);
      });
      head.append(seg);
    }
    const view = VIEWS.find((v) => v[0] === taskView) || ['mine', 'Today', forMe, '', 'Nothing here.', true, 'today'];
    const byKind = Boolean(todayData && todayData.missing); // the Application Team
    if (view[6] === 'missing') { box.append(missingPanel(refresh)); return box; }
    const inView = view[2];
    // The kinds (Application, Mock interview ...) of the tasks in this view, each with how many are for TODAY. A kind whose tasks are
    // all moved to later days says "2 later" in blue, so a count never promises tasks that are not under Today.
    const openAll = inView.filter((x) => !x.done && matches(x) && (view[6] === 'upcoming' ? later(x) : view[6] === 'today' ? !later(x) : true));
    if (!openAll.length) tagFilter = 'all'; // nothing open here: no kind is left chosen
    if (openAll.length) {
      const now = {}; const after = {};
      openAll.forEach((x) => { const k = tagOf(x, x.stage); if (later(x)) after[k] = (after[k] || 0) + 1; else now[k] = (now[k] || 0) + 1; });
      if (tagFilter !== 'all' && !now[tagFilter] && !after[tagFilter]) tagFilter = 'all';
      // The Application Team works one kind at a time (the owner, 21 Nov 2026): no "All", the first kind with tasks is open.
      const order = ((window.CardFields && window.CardFields.TASK_TAGS) || []).map(([k]) => k);
      if (byKind && tagFilter === 'all') tagFilter = order.find((k) => now[k]) || order.find((k) => after[k]) || 'all';
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
      if (!byKind) pill('all', 'All', sum(now), sum(after));
      // One kind only: "All 2, Application 2" says nothing twice, so the row is left out.
      const kinds = new Set([...Object.keys(now), ...Object.keys(after)]);
      ((window.CardFields && window.CardFields.TASK_TAGS) || []).forEach(([k, label]) => { if (now[k] || after[k]) pill(k, label, now[k] || 0, after[k] || 0); });
      if (kinds.size > 1 || tagFilter !== 'all' || byKind) box.append(bar);
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
        try { await api('/api/tasks/seen', { ids: ids.map((x) => x.id) }); } catch (e) { clear.disabled = false; window.NiecUI.toast(e.message || 'Could not mark them as read. Try again.', { type: 'error' }); return; }
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
    taskView = x.forMe ? (!x.done && x.doOn && todayIso && x.doOn > todayIso ? 'upcoming' : 'mine') : (x.given || x.by === me) ? 'gave' : 'others';
    tagFilter = todayData && todayData.missing ? tagOf(x, x.stage) : 'all'; // the Application Team has no "All": the task's own kind
    searchQ = '';
    focusTask = x.id;
    refresh();
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-task-id="${x.id}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      row.classList.add('is-flash');
      setTimeout(() => row.classList.remove('is-flash'), 1800);
      if (row.openThread) row.openThread();
      x.news = []; x.unread = 0; (x.history || []).forEach((n) => { n.isNew = false; });
      // Redraw once it is read: the notification, the counts and the dot go (its updates stay open, see portal-ui.js openThreads).
      setTimeout(() => { refresh(); const again = document.querySelector(`[data-task-id="${x.id}"]`); if (again) again.scrollIntoView({ block: 'center' }); }, 700);
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
  // How many of today's tasks (the person's own, or the whole team's for Admin and the Manager) were finished today, office time.
  function doneTodayOf(tasks) {
    const mine = tasks.canAssign ? tasks.tasks : tasks.tasks.filter((x) => x.forMe);
    const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' }); } catch (e) { return String(iso || '').slice(0, 10); } };
    return mine.filter((x) => x.done && x.doneAt && day(x.doneAt) === tasks.today).length;
  }
  let firstDraw = true; // the first drawing of the page glides in; the quiet refresh every minute does not
  // The day at a glance (the owner, 21 Nov 2026): one plain sentence that says what to do first, and a thin bar of what was finished today.
  // No ring, no number tiles, no confetti (DESIGN.md).
  function pulse(tasks) {
    const mine = tasks.canAssign ? tasks.tasks : tasks.tasks.filter((x) => x.forMe);
    const later = (x) => x.doOn && tasks.today && x.doOn > tasks.today;
    const openList = mine.filter((x) => !x.done && !later(x));
    const open = openList.length;
    const late = openList.filter(isLate).length;
    const upcoming = mine.filter((x) => !x.done && later(x)).length;
    const doneToday = doneTodayOf(tasks);
    const box = el('section', 'td-pulse td-summary');
    const words = el('div', 'td-pulse-words');
    const lead = !open ? 'All caught up.'
      : tasks.canAssign ? `${open} task${open === 1 ? '' : 's'} open across the teams${late ? `, ${late} late` : ''}.`
        : `You have ${open} task${open === 1 ? '' : 's'} today.${late ? ` Start with the ${late === open ? '' : `${late} `}late one${late === 1 ? '' : 's'}.` : ''}`;
    words.append(el('h2', '', lead));
    if (upcoming) words.append(el('p', '', `${upcoming} more on later days.`));
    else if (!open && doneToday) words.append(el('p', '', 'Everything for today is done.'));
    const bar = el('div', 'td-bar');
    const total = doneToday + open;
    bar.append(el('p', 'td-bar-words', total ? `${doneToday} of ${total} done today` : 'Nothing due today'));
    const track = el('div', 'td-bar-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(total || 1)); track.setAttribute('aria-valuenow', String(doneToday));
    track.setAttribute('aria-label', 'Done today');
    const fill = el('div', 'td-bar-fill');
    fill.style.width = `${total ? Math.round((doneToday / total) * 100) : 0}%`;
    track.append(fill);
    bar.append(track);
    box.append(words, bar);
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
    const hi = el('h1', '', `${greeting()}${first ? ', ' : ''}`);
    if (first) hi.append(el('span', 'td-name', first));
    head.append(el('span', 'td-kicker', d.title), hi,
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
    // The bell's number: everything new on the tasks for this person (the same count as the menu's red number).
    const paintBell = () => {
      const fresh = tasks.tasks.reduce((n, x) => n + (x.history || []).filter((m) => m.isNew).length, 0);
      bellCount.textContent = fresh > 99 ? '99+' : String(fresh);
      bellCount.hidden = !fresh;
      bell.setAttribute('aria-label', fresh ? `Notifications, ${fresh > 99 ? '99+' : fresh} new` : 'Notifications');
      bell.classList.toggle('has-new', fresh > 0);
      drawPop();
    };
    // A task read on this page (its updates opened, an update written, Mark all as read): the bell follows at once, without redrawing
    // the tasks (an update being typed is never lost). The owner, 21 Nov 2026: the bell stayed at 10 after reading.
    window.addEventListener('isr-tasks-read', async () => { try { tasks = await api('/api/tasks'); } catch (e) { return; } paintBell(); });
    todayData = d;
    const refresh = async (reload) => {
      if (reload) {
        try { tasks = await api('/api/tasks'); } catch (e) { /* keep */ }
        // Missing details follows too: a detail fixed on the profile leaves the list (the Application Team only).
        if (todayData && todayData.missing) { try { todayData = await api('/api/today'); } catch (e) { /* keep */ } }
      }
      todayIso = tasks.today || d.today || todayIso;
      tasksNow = tasks.tasks || [];
      paintBell();
      const own = ownTeamCard(tasks);
      page.classList.toggle('is-board', Boolean(tasks.canAssign));
      top.replaceChildren(...(own ? [own] : []), pulse(tasks));
      slot.replaceChildren(tasksPanel(tasks, refresh));
      if (window.Motion && firstDraw) window.Motion.reveal(slot, '.tdx-list > *, .tb-col');
      firstDraw = false;
    };
    refresh();
    // The day at a glance, then the tasks. Needs attention stays for the other teams; for the Application Team its lists are the
    // Missing details switch (the owner, 21 Nov 2026), so nothing shows twice.
    page.append(head, top, slot, ...(d.missing ? [] : [attention(d.sections)]));
    view.replaceChildren(page);
    if (window.Motion && !d.missing) window.Motion.reveal(page, '.td-attn-row');

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
    // "/" jumps to the task search, as on Universities.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || busy()) return;
      const q = page.querySelector('.td-search-input');
      if (q) { e.preventDefault(); q.focus(); }
    });
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
