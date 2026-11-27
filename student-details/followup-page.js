// All Students for the Follow-up Team (design A2, 21 Nov 2026; design F1, 25 Nov 2026): "Tasks for you" (tasks other teams gave or handed
// to the Follow-up Team), then one list of the current intake's inquiries and deferred students, the students who moved on (view only,
// with their progress and the latest news), and the Stopped ones (Hold and Withdrawn by any team), who can be brought back. Each row says where the student stands (Never contacted,
// Follow-up due, Followed up ...), what was said last, the next follow-up date and the tag (INT, DM, COLD), with Note and No answer.
// Note opens one line under the row: what the student said and the next follow-up date (both needed), then Save note, Defer,
// Withdrawn (which asks why) or Cancel. The rules are the server's (portal-api.js, followList and followAction).
(function () {
  const { el, h, api } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  let data = null;
  let view = 'wait';
  let tag = '';
  let open = ''; // the student whose Note line is open
  let withdrawing = false;
  let returning = false; // the Bring back line, not the Note line
  let draft = { text: '', next: '', reason: '', to: 'Inquiry' };
  let tasks = null; // { tasks, today, me, teams } from the same list every team's Today uses
  const threads = new Set(); // tasks whose updates are open
  const drafts = new Map(); // task id -> an update half written, kept while the list is drawn again

  const VIEWS = [
    ['wait', 'To follow up', (s) => ['new', 'due', 'tried'].includes(s.state)],
    ['ok', 'Followed up', (s) => s.state === 'ok'],
    ['defer', 'Deferred', (s) => s.state === 'defer'],
    ['sent', 'With Application Team', (s) => s.state === 'sent'],
    ['applying', 'Applying', (s) => s.state === 'applying'],
    ['out', 'Stopped', (s) => s.state === 'out'],
    ['all', 'All', () => true],
  ];
  // Never contacted first, then the longest waiting, and a student tried today at the bottom until tomorrow.
  const ORDER = { new: 0, due: 1, tried: 2, ok: 3, defer: 4, sent: 5, applying: 6, out: 7 };
  const dayMs = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const short = (iso) => new Date(dayMs(iso)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ago = (at) => {
    const d = new Date(at);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = Math.round((dayMs(data.today) - dayMs(local)) / 86400000);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
  };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const tagShort = (k) => ((data.tags || []).find((t) => t.key === k) || {}).short || '';

  async function load() {
    try { data = await api('/api/followup'); } catch (e) { $('list').replaceChildren(el('div', 'fu-empty', e.message)); return; }
    $('lead').textContent = `${data.intake ? `${/intake/i.test(data.intake) ? data.intake : `${data.intake} intake`} · ` : ''}click a name to open the student card with every note.`;
    draw();
    loadTasks();
  }

  // ---- Tasks for you: the open tasks for this person's team, from any student (the same task list as every team's Today) ----
  async function loadTasks() {
    try { tasks = await api('/api/tasks'); } catch (e) { const box = $('tasks'); box.hidden = false; box.replaceChildren(el('div', 'fu-tempty', `The tasks could not be loaded: ${e.message}`)); return; }
    drawTasks();
  }
  // The team of the person who gave a task, in plain words.
  const teamOfPerson = (name) => { const t = ((tasks && tasks.teams) || []).find((x) => (x.members || []).includes(name)); return t ? String(t.label).replace(/\s*\(.*\)$/, '') : ''; };
  function drawTasks() {
    const box = $('tasks');
    box.querySelectorAll('[data-thread]').forEach((x) => { const i = x.querySelector('textarea, input[type="text"], input:not([type])'); if (i) drafts.set(x.dataset.thread, i.value); });
    const today = tasks.today;
    const mine = tasks.tasks.filter((t) => t.forMe && !t.done);
    const now = mine.filter((t) => !t.doOn || t.doOn <= today)
      .sort((x, y) => String(x.doOn || x.at).localeCompare(String(y.doOn || y.at)));
    const later = mine.length - now.length;
    box.hidden = false;
    const head = el('div', 'fu-th');
    head.append(el('h2', '', 'Tasks for you'));
    if (now.length) head.append(el('span', 'fu-count', String(now.length)));
    head.append(el('span', 'fu-thint', `Given or handed to your team by other teams${later ? ` · ${later} rescheduled for later` : ''}`));
    if (!now.length) { box.replaceChildren(head, el('div', 'fu-tempty', 'No tasks to do now. New ones from other teams show here.')); return; }
    box.replaceChildren(head, ...now.map(taskRow));
  }
  function taskRow(t) {
    const wrap = el('div');
    const r = el('div', 'fu-task');
    const tick = h('button', { class: 'fu-ck', type: 'button', title: 'Mark as done', 'aria-label': `Mark as done: ${t.text}` });
    tick.addEventListener('click', async () => {
      if (tick.disabled) return;
      tick.disabled = true;
      const finish = await window.Portal.doneDialog(t, { rowId: t.studentId, stage: t.stage, student: { name: t.student }, today: tasks.today });
      if (!finish) { tick.disabled = false; tick.focus(); return; }
      try { await api(`/api/cards/${encodeURIComponent(t.studentId)}/tasks/${t.id}`, { done: true, finish }); say('Marked as done'); await load(); } catch (e) { tick.disabled = false; say(e.message, true); }
    });
    const who = el('div');
    const name = h('button', { class: 'fu-name', type: 'button', title: 'Open the student card' }, t.student);
    name.addEventListener('click', () => window.CardDrawer.open(t.studentId, { onClose: () => load() }));
    who.append(name, el('span', 'fu-small', t.stage || 'No stage'));
    const mid = el('div');
    const last = (t.comments || []).filter((c) => c.text).pop();
    const label = teamOfPerson(t.by);
    const team = label === t.by ? '' : label; // a team labelled with the person's own name (the head) is not said twice
    mid.append(el('div', 'fu-task-text', t.text), el('span', 'fu-small', `From ${t.by || 'someone'}${team ? ` · ${team}` : ''}${last ? ` · latest: ${last.by}: ${String(last.text).slice(0, 90)}` : ''}`));
    const late = t.doOn && t.doOn < tasks.today;
    const given = t.at ? ago(t.at) : '';
    const due = el('span', 'fu-due' + (late ? ' late' : ''), late ? `Due since ${short(t.doOn)}` : t.doOn ? 'Due today' : given ? `Given ${given}` : '');
    const open2 = threads.has(t.id);
    const up = h('button', { class: 'btn' + (open2 ? ' on' : ''), type: 'button', 'aria-expanded': String(open2) }, t.unread ? 'Add update ●' : 'Add update');
    up.addEventListener('click', () => { if (threads.has(t.id)) threads.delete(t.id); else threads.add(t.id); drawTasks(); });
    if (t.unread) up.setAttribute('aria-label', 'Add update, something new');
    r.append(tick, who, mid, due, up);
    wrap.append(r);
    if (open2) {
      const holder = el('div', 'fu-thread'); holder.dataset.thread = t.id;
      const thread = window.Portal.taskThread(t, { rowId: t.studentId, me: tasks.me, canWrite: true, unread: t.unread || 0, teams: tasks.teams, today: tasks.today, always: true });
      holder.append(thread);
      const input = holder.querySelector('textarea, input[type="text"], input:not([type])');
      if (input && drafts.get(t.id)) { input.value = drafts.get(t.id); input.dispatchEvent(new Event('input', { bubbles: true })); }
      wrap.append(holder);
      if (t.unread && thread.markRead) { thread.markRead(); t.unread = 0; up.textContent = 'Add update'; up.removeAttribute('aria-label'); }
    }
    return wrap;
  }

  function draw() {
    const list = data.students;
    $('views').replaceChildren(...VIEWS.map(([k, label, ok]) => {
      const b = h('button', { type: 'button', class: k === view ? 'on' : '', 'aria-pressed': String(k === view) });
      b.append(label, el('i', '', String(list.filter(ok).length)));
      b.addEventListener('click', () => { view = k; close(); draw(); });
      return b;
    }));
    const tagsBox = $('tags');
    tagsBox.replaceChildren(el('span', '', 'Show only'), ...(data.tags || []).map((t) => {
      const b = h('button', { type: 'button', class: 'fu-chip' + (tag === t.key ? ' on' : ''), 'aria-pressed': String(tag === t.key) });
      b.append(`${t.key} (${t.short})`, el('i', '', String(list.filter((s) => s.tag === t.key).length)));
      b.addEventListener('click', () => { tag = tag === t.key ? '' : t.key; close(); draw(); });
      return b;
    }));
    const q = $('find').value.trim().toLowerCase();
    const pick = VIEWS.find((v) => v[0] === view)[2];
    const kind = view === 'all' ? 'all' : view === 'sent' || view === 'applying' ? 'moved' : view === 'out' ? 'stop' : 'live';
    tagsBox.hidden = !(kind === 'live' || kind === 'all');
    const useTag = tagsBox.hidden ? '' : tag; // a tag chosen on another tab never hides students where its chips are not shown
    const shown = list.filter((s) => pick(s) && (!useTag || s.tag === useTag) && (!q || `${s.name} ${s.phone} ${s.words} ${s.remarks} ${s.progress ? `${s.progress.university} ${s.progress.course}` : ''}`.toLowerCase().includes(q)))
      .sort((a, b) => (kind === 'stop' ? String((b.stopped || {}).at || '').localeCompare(String((a.stopped || {}).at || '')) : 0) || ORDER[a.state] - ORDER[b.state] || String((a.next && a.next.date) || (a.last && a.last.at) || '').localeCompare(String((b.next && b.next.date) || (b.last && b.last.at) || '')) || a.no - b.no);
    const box = $('list');
    const COLS = {
      live: ['No.', 'Student', 'Stage', 'Last contact and what was said', 'Next follow-up', 'Tag', ''],
      moved: ['No.', 'Student', 'University and course', 'Progress', 'Latest from the other teams', ''],
      stop: ['No.', 'Student', 'Stage', 'Why they stopped', 'Stopped by', ''],
      all: ['No.', 'Student', 'Stage', 'Where they are', 'List'],
    };
    const head = el('div', `fu-row head ${kind}`);
    COLS[kind].forEach((t) => head.append(el('div', '', t)));
    if (!shown.length) {
      box.replaceChildren(head, el('div', 'fu-empty', q || useTag ? 'No student matches.' : view === 'wait' ? 'Nobody to follow up right now.' : view === 'out' ? 'Nobody is stopped.' : 'Nobody here right now.'));
      return;
    }
    const make = { live: liveRow, moved: movedRow, stop: stopRow, all: allRow }[kind];
    box.replaceChildren(head, ...shown.map(make));
  }

  // The student: the name opens the card, the phone calls; the remarks and the intake a deferred student came from under it.
  function whoOf(s) {
    const who = el('div', 'fu-who');
    const name = h('button', { class: 'fu-name', type: 'button', title: 'Open the student card' }, s.name || 'Student with no name');
    name.addEventListener('click', () => window.CardDrawer.open(s.id, { onClose: () => load() }));
    who.append(name);
    if (s.phone) who.append(h('a', { class: 'fu-phone', href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, title: `Call ${s.name}` }, s.phone));
    if (s.remarks) { const sub = el('span', 'fu-sub', s.remarks); sub.title = s.remarks; who.append(sub); }
    if (s.from) who.append(el('span', 'fu-from', `Deferred from ${s.from}`));
    return who;
  }
  function stageCell(s) {
    const cls = s.stage === 'Withdrawn' ? ' gone' : s.stage === 'Hold' ? ' hold' : ['sent', 'applying'].includes(s.state) ? ' app' : '';
    const stage = el('div'); stage.append(el('span', 'fu-stage' + cls, s.stage || 'No stage'));
    return stage;
  }

  function liveRow(s) {
    const item = el('div', 'fu-item');
    const r = el('div', 'fu-row live');
    const last = el('div', 'fu-last');
    const tries = s.tries ? `${s.tries} ${s.tries === 1 ? 'try' : 'tries'}` : '';
    let pill;
    if (s.state === 'ok') pill = ['ok', `Followed up · ${cap(ago(s.last.at))} · ${s.last.by}`];
    else if (s.state === 'new') pill = ['wait', s.from ? 'Back from last intake, not called yet' : tries ? `Never reached · ${tries}` : 'Never contacted'];
    else if (s.state === 'tried') pill = ['wait', `No answer today · ${tries}`];
    else if (s.state === 'due') pill = ['wait', tries ? `No answer · ${tries}` : s.next ? `Due ${s.next.date >= data.today ? 'today' : `since ${short(s.next.date)}`}` : 'No date set'];
    else pill = ['view', 'Waits for the next intake'];
    const p = el('span', `fu-pill ${pill[0]}`, pill[1]); p.title = pill[1];
    last.append(p);
    if (s.words) { const w = el('div', 'fu-words', s.words); w.title = s.words; last.append(w); }
    const next = el('div', 'fu-next');
    if (s.state === 'defer') next.append(el('span', '', 'Next intake'));
    else if (s.next) next.append(el('b', s.next.date <= data.today || s.state === 'due' ? 'due' : '', short(s.next.date)));
    else next.append(el('span', '', 'Not set'));
    const tg = el('div');
    if (s.canTag) {
      const g = el('div', 'fu-tg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', `Tag of ${s.name}`);
      (data.tags || []).forEach((t) => {
        const b = h('button', { type: 'button', class: s.tag === t.key ? 'on' : '', 'aria-pressed': String(s.tag === t.key), title: t.key, 'aria-label': t.key }, t.short);
        b.addEventListener('click', async () => {
          const to = s.tag === t.key ? '' : t.key;
          g.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          try { await api(`/api/followup/${encodeURIComponent(s.id)}`, { action: 'tag', tag: to }); s.tag = to; } catch (e) { say(e.message, true); }
          draw();
        });
        g.append(b);
      });
      tg.append(g);
    } else if (s.tag) { const c = el('span', 'fu-code', tagShort(s.tag)); c.title = s.tag; tg.append(c); }
    const act = el('div', 'fu-act');
    if (s.canNote) {
      act.append(noteButton(s));
      if (['new', 'due', 'ok'].includes(s.state)) {
        const na = h('button', { class: 'btn', type: 'button', title: 'Writes "Called, no answer" on the card. The student stays orange and comes back tomorrow.' }, 'No answer');
        na.addEventListener('click', async () => {
          na.disabled = true; na.textContent = 'Saving...';
          try { await api(`/api/followup/${encodeURIComponent(s.id)}`, { action: 'try' }); say(`${s.name}: no answer written on the card`); close(); await load(); } catch (e) { say(e.message, true); na.disabled = false; na.textContent = 'No answer'; }
        });
        act.append(na);
      }
    } else act.append(el('span', 'fu-view', 'View only'));
    r.append(el('div', 'fu-num', String(s.no)), whoOf(s), stageCell(s), last, next, tg, act);
    item.append(r);
    if (open === s.id && s.canNote) item.append(strip(s));
    return item;
  }

  // A student who moved on: the university and course, how far (Apply, Mock, Payment, CAS, Visa) and the latest news. View only.
  const STEPS = ['Apply', 'Mock', 'Payment', 'CAS', 'Visa'];
  function movedRow(s) {
    const p = s.progress || { university: '', course: '', step: 0, latest: { text: s.words || '', sub: '', tone: '' } };
    const r = el('div', 'fu-row moved');
    const uni = el('div', 'fu-uni');
    uni.append(el('b', '', p.university || 'No university yet'), el('span', 'fu-small', p.course || s.stage || ''));
    const track = el('ol', 'fu-track');
    track.setAttribute('aria-label', p.step >= STEPS.length ? 'All steps done' : `At ${STEPS[p.step]}, step ${p.step + 1} of ${STEPS.length}`);
    STEPS.forEach((label, i) => { const li = el('li', i < p.step ? 'd' : i === p.step ? 'n' : '', i < p.step ? `\u2713 ${label}` : label); if (i === p.step) li.setAttribute('aria-current', 'step'); track.append(li); });
    const upd = el('div', 'fu-upd');
    upd.append(el('b', p.latest.tone || '', p.latest.text));
    if (p.latest.sub) upd.append(el('span', 'fu-small', p.latest.sub));
    r.append(el('div', 'fu-num', String(s.no)), whoOf(s), uni, track, upd, el('span', 'fu-view', 'View only'));
    return r;
  }

  // A stopped student (Hold or Withdrawn, by any team): why, by whom, a note, and Bring back.
  function stopRow(s) {
    const st = s.stopped || { by: '', team: '', at: '', why: s.words };
    const item = el('div', 'fu-item');
    const r = el('div', 'fu-row stop');
    const why = el('div', 'fu-last'); const w = el('div', 'fu-words', st.why); w.title = st.why; why.append(w);
    const by = el('div', 'fu-small', [st.team || st.by || 'Not recorded', st.team && st.by ? st.by : '', st.at ? short(st.at) : ''].filter(Boolean).join(' · '));
    const act = el('div', 'fu-act');
    if (s.canReturn) {
      const back = h('button', { class: 'btn' + (open === s.id && returning ? ' on' : ''), type: 'button', 'aria-expanded': String(open === s.id && returning) }, 'Bring back');
      back.addEventListener('click', () => { if (open === s.id && returning) close(); else { close(); open = s.id; returning = true; } draw(); focusStrip(); });
      act.append(noteButton(s), back);
    } else act.append(el('span', 'fu-view', 'View only'));
    r.append(el('div', 'fu-num', String(s.no)), whoOf(s), stageCell(s), why, by, act);
    item.append(r);
    if (open === s.id && s.canNote) item.append(returning ? returnStrip(s) : strip(s));
    return item;
  }

  function allRow(s) {
    const r = el('div', 'fu-row all');
    const p = s.progress;
    const where = el('div', 'fu-last');
    const w = el('div', 'fu-words', p ? [p.university, p.latest.text].filter(Boolean).join(' · ') : s.state === 'out' && s.stopped ? s.stopped.why : s.words || 'Nothing written yet');
    w.title = w.textContent; where.append(w);
    r.append(el('div', 'fu-num', String(s.no)), whoOf(s), stageCell(s), where, el('div', 'fu-small', VIEWS.find((v) => v[0] !== 'all' && v[2](s))?.[1] || ''));
    return r;
  }

  const focusStrip = () => { if (open) setTimeout(() => { const t = document.querySelector('.fu-strip textarea'); if (t) t.focus(); }, 0); };
  function noteButton(s) {
    const on = open === s.id && !returning;
    const nb = h('button', { class: 'btn' + (on ? ' on' : ''), type: 'button', 'aria-expanded': String(on) }, 'Note');
    nb.addEventListener('click', () => { if (on) close(); else { close(); open = s.id; } draw(); focusStrip(); });
    return nb;
  }

  // One press instead of the date picker for the usual next follow-up days (review, 27 Nov 2026). The date box stays for any other day.
  const QUICK = [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'In 1 week'], [14, 'In 2 weeks']];
  function quickDates(dateIn) {
    const row = el('div', 'fu-quick'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Next follow-up, quick choice');
    const buttons = QUICK.map(([n, label]) => {
      const day = new Date(dayMs(data.today) + n * 86400000).toISOString().slice(0, 10);
      const b = h('button', { type: 'button', class: 'fu-chip', title: short(day) }, label);
      b.dataset.day = day;
      b.addEventListener('click', () => { dateIn.value = day; dateIn.dispatchEvent(new Event('input', { bubbles: true })); });
      return b;
    });
    const mark = () => buttons.forEach((b) => { const on = b.dataset.day === dateIn.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    dateIn.addEventListener('input', mark);
    mark();
    row.append(el('span', '', 'Next follow-up'), ...buttons);
    return row;
  }
  // Ctrl+Enter (Cmd+Enter on a Mac) in the note box saves it.
  const saveKey = (area, button) => area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !button.disabled) { e.preventDefault(); button.click(); } });

  // The Bring back line: what changed, where to (Inquiry or Defer), and for Inquiry the next follow-up date.
  function returnStrip(s) {
    const box = el('div', 'fu-strip');
    const grid = el('div', 'fu-strip-grid');
    const reqMark = () => { const m = el('b', 'fu-req', ' *'); m.setAttribute('aria-hidden', 'true'); return m; };
    const l1 = el('label'); const t1 = el('span', '', `What changed? What did ${s.name} say?`); t1.append(reqMark());
    const area = h('textarea', { rows: '1', maxlength: '2000', placeholder: 'For example: the new passport has arrived', 'aria-required': 'true' });
    area.value = draft.text;
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(area.scrollHeight + 2, 220)}px`; };
    area.addEventListener('input', () => { draft.text = area.value; area.classList.remove('bad'); grow(); });
    setTimeout(grow, 0);
    l1.append(t1, area);
    const l2 = el('label'); const t2 = el('span', '', 'Move to'); t2.append(reqMark());
    const to = h('select', { 'aria-required': 'true' });
    to.append(h('option', { value: 'Inquiry' }, 'Inquiry'), h('option', { value: 'Defer' }, 'Defer'));
    to.value = draft.to;
    l2.append(t2, to);
    const l3 = el('label'); const t3 = el('span', '', 'Next follow-up'); t3.append(reqMark());
    const dateIn = h('input', { type: 'date', min: new Date(dayMs(data.today) + 86400000).toISOString().slice(0, 10), 'aria-required': 'true' });
    dateIn.value = draft.next;
    dateIn.addEventListener('input', () => { draft.next = dateIn.value; dateIn.classList.remove('bad'); });
    l3.append(t3, dateIn);
    const quick = quickDates(dateIn);
    const showDate = () => { l3.hidden = to.value !== 'Inquiry'; quick.hidden = l3.hidden; };
    to.addEventListener('change', () => { draft.to = to.value; showDate(); }); showDate();
    const err = el('div', 'fu-err'); err.hidden = true; err.setAttribute('role', 'alert');
    const fail = (msg, ...fields) => { err.textContent = msg; err.hidden = false; fields.forEach((f) => { f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad'); }); };
    const btns = el('div', 'fu-btns');
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Bring back');
    ok.addEventListener('click', async () => {
      const needDate = to.value === 'Inquiry';
      const miss = [!area.value.trim() && area, needDate && !dateIn.value && dateIn].filter(Boolean);
      if (miss.length) { fail(miss.length === 2 ? 'Write what changed and choose the next follow-up date.' : miss[0] === area ? 'Write what changed.' : 'Choose the next follow-up date.', ...miss); return; }
      btns.querySelectorAll('button').forEach((b) => { b.disabled = true; }); ok.textContent = 'Saving...';
      try {
        const done = await api(`/api/followup/${encodeURIComponent(s.id)}`, { action: 'return', from: s.stage, text: area.value, to: to.value, next: needDate ? dateIn.value : '' });
        say(`${s.name} is back at ${to.value}${done && done.told ? `. ${String(done.told).replace(/\s*\(.*\)$/, '')} is told` : ''}`); close(); await load();
      } catch (e) {
        btns.querySelectorAll('button').forEach((b) => { b.disabled = false; }); ok.textContent = 'Bring back';
        const field = e.body && e.body.field;
        if ([403, 404, 409].includes(e.status)) { say(e.message, true); close(); await load(); return; } // someone else moved the student
        fail(e.message, ...(field === 'text' ? [area] : field === 'next' ? [dateIn] : field === 'to' ? [to] : []));
      }
    });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => { close(); draw(); });
    btns.append(ok, cancel);
    grid.append(l1, l2, l3, btns);
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); draw(); } });
    saveKey(area, ok);
    box.append(grid, quick, err, el('span', 'fu-hint', s.stopped && s.stopped.team && !/follow-up/i.test(s.stopped.team) ? 'Saved on the student card. The team that stopped the student gets a short task to tell them.' : 'What you write is saved on the student card and its timeline.'));
    return box;
  }

  function close() { open = ''; withdrawing = false; returning = false; draft = { text: '', next: '', reason: '', to: 'Inquiry' }; }

  // The Note line under a row.
  function strip(s) {
    const box = el('div', 'fu-strip');
    const grid = el('div', 'fu-strip-grid');
    const reqMark = () => { const m = el('b', 'fu-req', ' *'); m.setAttribute('aria-hidden', 'true'); return m; };
    const l1 = el('label'); const t1 = el('span', '', `What did ${s.name} say?`); t1.append(reqMark());
    const area = h('textarea', { rows: '1', maxlength: '2000', placeholder: 'Their answer, what was agreed', 'aria-required': 'true' });
    area.value = draft.text;
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(area.scrollHeight + 2, 220)}px`; };
    area.addEventListener('input', () => { draft.text = area.value; area.classList.remove('bad'); grow(); });
    l1.append(t1, area);
    const only = s.state === 'out'; // a withdrawn student: a note only
    const err = el('div', 'fu-err'); err.hidden = true;
    const fail = (msg, ...fields) => { err.textContent = msg; err.hidden = false; const hint = box.querySelector('.fu-hint'); if (hint) hint.hidden = true; fields.forEach((f) => { f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad'); }); };
    const btns = el('div', 'fu-btns');
    const send = async (btn, body, done) => {
      const was = btn.textContent;
      btns.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.textContent = 'Saving...';
      try { await api(`/api/followup/${encodeURIComponent(s.id)}`, body); say(done); close(); await load(); } catch (e) {
        btns.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        btn.textContent = was;
        fail(e.message, ...(e.body && e.body.field === 'text' ? [area] : e.body && e.body.field === 'next' ? [dateIn] : e.body && e.body.field === 'reason' ? [reason] : []));
      }
    };
    let dateIn = null; let reason = null;
    if (withdrawing) {
      const l2 = el('label'); const t2 = el('span', '', 'Why is the student not going on?'); t2.append(reqMark());
      reason = h('select', { 'aria-required': 'true' });
      reason.append(h('option', { value: '' }, 'Choose a reason'), ...(data.reasons || []).map((x) => h('option', { value: x }, x)));
      reason.value = draft.reason;
      reason.addEventListener('change', () => { draft.reason = reason.value; reason.classList.remove('bad'); });
      l2.append(t2, reason);
      const ok = h('button', { class: 'btn red', type: 'button' }, 'Confirm Withdrawn');
      ok.addEventListener('click', () => {
        const miss = [!area.value.trim() && area, !reason.value && reason].filter(Boolean);
        if (miss.length) return fail(miss.length === 2 ? 'Write what the student said and choose a reason.' : miss[0] === area ? 'Write what the student said.' : 'Choose a reason.', ...miss);
        send(ok, { action: 'withdraw', text: area.value, reason: reason.value }, `${s.name} moved to Withdrawn`);
      });
      const back = h('button', { class: 'btn', type: 'button' }, 'Back');
      back.addEventListener('click', () => { withdrawing = false; draw(); });
      btns.append(ok, back);
      grid.append(l1, l2, btns);
    } else {
      const l2 = el('label');
      if (!only) {
        const t2 = el('span', '', 'Next follow-up'); t2.append(reqMark());
        const min = new Date(dayMs(data.today) + 86400000).toISOString().slice(0, 10);
        dateIn = h('input', { type: 'date', min, 'aria-required': 'true' });
        dateIn.value = draft.next;
        dateIn.addEventListener('input', () => { draft.next = dateIn.value; dateIn.classList.remove('bad'); });
        l2.append(t2, dateIn);
      }
      const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save note');
      save.addEventListener('click', () => {
        const miss = [!area.value.trim() && area, !only && !dateIn.value && dateIn].filter(Boolean);
        if (miss.length) return fail(miss.length === 2 ? 'Write what the student said and choose the next follow-up date.' : miss[0] === area ? 'Write what the student said.' : 'Choose the next follow-up date.', ...miss);
        send(save, only ? { action: 'note-only', text: area.value } : { action: 'note', text: area.value, next: dateIn.value }, `Note saved on ${s.name}'s card`);
      });
      btns.append(save);
      saveKey(area, save);
      if (!only && s.state !== 'defer') {
        const def = h('button', { class: 'btn', type: 'button', title: 'Saves the note and moves the student to Defer' }, 'Defer');
        def.addEventListener('click', () => {
          if (!area.value.trim()) return fail('Write what the student said.', area);
          send(def, { action: 'defer', text: area.value }, `${s.name} moved to Defer`);
        });
        btns.append(def);
      }
      if (!only) {
        const wd = h('button', { class: 'btn', type: 'button' }, 'Withdrawn');
        wd.addEventListener('click', () => { draft.text = area.value; withdrawing = true; draw(); setTimeout(() => { const sel = document.querySelector('.fu-strip select'); if (sel) sel.focus(); }, 0); });
        btns.append(wd);
      }
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => { close(); draw(); });
      btns.append(cancel);
      grid.append(l1, l2, btns);
    }
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); draw(); } });
    box.append(grid, ...(dateIn ? [quickDates(dateIn)] : []), err, el('span', 'fu-hint', withdrawing ? 'The stage moves to Withdrawn and the card says why.' : only ? 'A note on the card.' : 'Must be filled: what the student said and the next follow-up date. Defer and Withdrawn change the stage by themselves.'));
    setTimeout(grow, 0);
    return box;
  }

  // The page keeps its proportions at any browser zoom (the owner, 25 Nov 2026), as the student card does: the width it was designed
  // for is scaled to the space there is, so zooming out does not shrink it into the middle. Never below 88% (text stays readable).
  const REF_WIDTH = 1300; // at a usual laptop width the words are the size of the side menu's
  function fitPage() {
    const page = document.querySelector('.fu-page');
    const st = getComputedStyle(page);
    const w = page.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    if (w <= 0) return;
    const z = String(Math.round(Math.min(1.5, Math.max(0.88, w / REF_WIDTH)) * 1000) / 1000);
    [...page.children].forEach((c) => { c.style.zoom = z; });
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestAnimationFrame(fitPage)).observe(document.querySelector('.fu-page')); /* the next frame: resizing inside the notice made Safari report an error */
  fitPage();

  $('find').addEventListener('input', () => { close(); draw(); });
  $('add').addEventListener('click', async () => {
    const me = await fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const made = await window.NewStudent.open({ me, defaultStage: 'Inquiry' });
    if (made) await load();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) { close(); draw(); } });
  // Your email and signature (the student card's Email button sends from them): reached from the card's "set up your email" link.
  function setup() {
    if (location.hash !== '#setup' || !window.SenderSetup) return;
    window.Portal.dialog('Your email and signature', (body, done) => {
      const box = el('div'); body.append(box);
      window.SenderSetup.mount(box, { open: true, only: ['email', 'signature'] }).catch((e) => box.replaceChildren(el('div', 'p-notice bad', e.message)));
      const foot = el('div', 'p-form-actions'); foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done() }, 'Done'));
      body.append(foot);
    }).then(() => { history.replaceState(null, '', '/students'); });
  }
  // The page stays open all day: the list and the tasks are read again every minute while it is in view, and at once when it comes
  // back into view, as Today does, but never while a note or a task's updates are open, someone is in a box, or a card or window is
  // open. Nothing is redrawn when nothing changed. (review, 27 Nov 2026)
  const busy = () => Boolean(open || threads.size || document.querySelector('.p-drawer, .p-dialog, dialog[open]') || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)));
  let reading = false;
  async function quiet() {
    if (document.hidden || reading || !data || !tasks || busy()) return;
    reading = true;
    try {
      const [list, mine] = await Promise.all([api('/api/followup'), api('/api/tasks')]);
      if (!busy()) {
        if (JSON.stringify(list) !== JSON.stringify(data)) { data = list; draw(); }
        if (JSON.stringify(mine) !== JSON.stringify(tasks)) { tasks = mine; drawTasks(); }
      }
    } catch (e) { /* the next minute tries again; what is on the screen stays */ }
    reading = false;
  }
  setInterval(quiet, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) quiet(); });
  load();
  setup();
})();
