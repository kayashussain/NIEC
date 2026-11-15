// Small helpers shared by the portal pages (student card, templates, B2B partners, the decision pages and
// the Fact File's option finder). Loaded as window.Portal after session.js and ui.js.
// Everything that comes from a student, a template or a partner is put on the page as text, never as HTML.
(function (root) {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // el() with attributes and children in one go: h('button', { class: 'btn', type: 'button', onclick: fn }, 'Save')
  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }

  // GET (no body) or POST (a body). Throws an Error with the server's own sentence when the answer is not OK.
  // The same save sent again while the first is still on its way (a double click) is not sent twice: both callers get the one answer.
  const inFlight = new Map();
  function api(url, body) {
    if (body === undefined) return request(url, body);
    const key = url + '|' + JSON.stringify(body);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = request(url, body).finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
    return p;
  }
  async function request(url, body) {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.error || 'Something went wrong. Please try again.'); e.status = res.status; e.body = json; throw e; }
    return json;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "2026-11-12" or "11/12/2026" (month first, as imported sheets hold dates) as "12 Nov 2026"; anything else as typed.
  function day(v) {
    const s = String(v ?? '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]} ${m[3]}` : s;
  }
  // A moment as "12 Nov 2026, 3:40 pm" in the reader's own time.
  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  // How far a day is from today: "today", "in 3 days", "4 days ago". `today` and `iso` are YYYY-MM-DD.
  function fromToday(iso, today) {
    const n = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
    if (Number.isNaN(n)) return '';
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  // The colour family of a stage, the same as the badges on the sheet.
  function stageKind(stage) {
    const v = String(stage || '').toLowerCase();
    if (!v) return 'gray';
    if (/reject/.test(v)) return 'red';
    if (/issued/.test(v)) return 'green';
    if (/hold|defer|withdrawn/.test(v)) return 'amber';
    return 'blue';
  }
  const stagePill = (stage) => el('span', `p-pill p-pill-${stageKind(stage)}`, stage || 'No stage');
  const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const number = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN'));
  const rupees = (n) => (n === null || n === undefined ? '' : `Rs ${Number(n).toLocaleString('en-IN')}`);
  const percent = (n) => (n === null || n === undefined ? 'n/a' : `${n}%`);

  // Typed text as paragraphs, bullets ("- ") and small headings ("## "), like the Fact File pages.
  function richText(parent, text) {
    let list = null;
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      const heading = /^##\s+(.*)$/.exec(line);
      if (heading) { list = null; parent.append(el('h4', '', heading[1])); return; }
      const bullet = /^[-*]\s+(.*)$/.exec(line);
      if (bullet) { if (!list) { list = el('ul'); parent.append(list); } list.append(el('li', '', bullet[1])); return; }
      list = null;
      if (line) parent.append(el('p', '', line));
    });
    return parent;
  }

  // A labelled box of a form. kind: text | date | number | area | select (choices: [value] or [[value, label]]).
  function field(label, { kind = 'text', value = '', choices = [], placeholder = '', max = 300, list = '', hint = '', wide = false, disabled = false } = {}) {
    let input;
    if (kind === 'select') {
      input = el('select');
      if (!choices.some((c) => (Array.isArray(c) ? c[0] : c) === '')) input.append(h('option', { value: '' }, 'Choose\u2026')); // a blank choice only when the list has none of its own (it reads "Choose...", so the box is never blank)
      choices.forEach((c) => { const [v, t] = Array.isArray(c) ? c : [c, c]; input.append(h('option', { value: v }, t)); });
      if (value && ![...input.options].some((o) => o.value === value)) input.append(h('option', { value }, value)); // an older value stays selectable
      input.value = value || '';
    } else if (kind === 'area') {
      input = el('textarea');
      input.value = value || '';
      input.maxLength = max;
    } else {
      input = el('input');
      input.type = kind === 'date' ? 'date' : 'text';
      if (kind === 'number') input.inputMode = 'numeric';
      input.value = value || '';
      if (kind !== 'date') input.maxLength = max;
      if (list) input.setAttribute('list', list);
    }
    if (placeholder) input.placeholder = placeholder;
    input.disabled = disabled;
    const wrap = el('label', `p-field${wide ? ' p-wide' : ''}`);
    wrap.append(el('span', 'p-label', label), input);
    if (hint) wrap.append(el('span', 'p-hint', hint));
    return { wrap, input };
  }
  function datalist(id, values) {
    const d = el('datalist');
    d.id = id;
    values.forEach((v) => d.append(h('option', { value: v })));
    return d;
  }

  // A dialog in the site's look. build(dialog, close) fills it; resolves with what close(value) was given (undefined when dismissed).
  function dialog(title, build, { wide = false } = {}) {
    return new Promise((resolve) => {
      const d = el('dialog', `p-dialog${wide ? ' p-dialog-wide' : ''}`);
      let result;
      // Closes with a short fade and shrink (as a Mac sheet does); a person who prefers less motion gets it at once.
      const close = (value) => {
        result = value;
        if (d.classList.contains('is-closing')) return;
        const quick = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (quick) { d.close(); return; }
        d.classList.add('is-closing');
        setTimeout(() => d.close(), 160);
      };
      const head = el('div', 'p-dialog-head');
      const x = h('button', { type: 'button', class: 'p-x', 'aria-label': 'Close', onclick: () => close() }, '×');
      head.append(el('h2', '', title), x);
      const body = el('div', 'p-dialog-body');
      d.append(head, body);
      d.addEventListener('close', () => { d.remove(); resolve(result); });
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
      // Escape closes with the same short animation as the close button, not the browser's instant close.
      d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
      document.body.append(d);
      build(body, close);
      d.showModal();
    });
  }

  // Copies text to the clipboard (with the older way as a fallback). true when it worked.
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* the older way below */ }
    const box = el('textarea');
    box.value = text;
    box.className = 'p-offscreen';
    document.body.append(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* not allowed */ }
    box.remove();
    return ok;
  }

  // Asks every few seconds for the answer of a question the server is working on (see ai.js). Resolves with the result.
  async function waitFor(url, { every = 2500, limit = 240000 } = {}) {
    const start = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, every));
      const j = await api(url);
      if (j.status === 'done') return j.result;
      if (j.status === 'failed') throw new Error(j.error || 'The question could not be answered.');
      if (Date.now() - start > limit) throw new Error('The answer is taking too long. Please try again.');
    }
  }

  // The comments on a task (the owner, 14 Nov 2026): the team writes how it went, what it needs (a student's email, a document) or what
  // is in the way, with or without ticking the task, and whoever gave the task answers. Shown on Today and on the student card as a
  // calm record (who, when, what), not a chat. What is new for the reader is marked with a red dot; opening the comments marks them
  // read. `me` is the reader's name; `rowId` the student's card; `unread` how much is new for the reader.
  const openThreads = new Set();
  // A name typed all in capitals (or all small) reads "Sanjip Kumar Mahto" on tasks and notifications; the sheet keeps it as typed.
  const niceName = (name) => String(name || '').split(/\s+/).map((w) => (w.length > 1 && (w === w.toUpperCase() || w === w.toLowerCase()) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  const initialsOf = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  // A day as people say it: "Today", "Tomorrow", else "Wed 18 Nov". `today`: YYYY-MM-DD.
  function dayLabel(iso, today) {
    if (!iso) return 'Today';
    const d = Date.parse(iso + 'T00:00:00Z');
    if (!today) return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const t = Date.parse(today + 'T00:00:00Z');
    const n = Math.round((d - t) / 86400000);
    if (n <= 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  // The updates of a task. `inline` (Today and the student card, the owner, 15 Nov 2026): always open on the task, the latest two
  // updates shown ("Show all N updates" for the rest) and the box to write one right there, no click needed.
  function taskThread(task, { rowId, me, canWrite, unread = 0, teams = [], inline = false, today = '' }) {
    const labelOf = (id) => (teams.find((t) => t.id === id) || { label: id === 'head' ? 'Admin' : id }).label;
    const box = el('div', 'tk-thread');
    const list = el('ol', 'tk-list');
    const comments = () => (Array.isArray(task.comments) ? task.comments : []);
    // `pending`: everything new on the task for the reader (new comments, or the task itself just given to them); `fresh`: the new
    // comments among it, shown on the comments line.
    let pending = unread;
    let fresh = Math.min(unread, comments().filter((c) => c.by !== me).length);
    const toggle = h('button', { class: 'tk-toggle', type: 'button', 'aria-expanded': 'false' });
    const body = el('div', 'tk-body');
    // The line is changed in place (never rebuilt), so a press on it is never lost while it is being clicked.
    const ico = el('span', 'tk-ico'); ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14M5 11.5h14M5 16.5h9"/></svg>';
    const words = el('span');
    const badge = el('span', 'tk-new');
    toggle.append(ico, words, badge);
    const label = () => {
      const n = comments().length;
      words.textContent = n ? `${n} update${n === 1 ? '' : 's'}` : (canWrite ? 'Add an update' : 'No updates');
      badge.textContent = `${fresh} new`;
      badge.hidden = !(fresh > 0);
      toggle.classList.toggle('has-new', fresh > 0);
    };
    const entry = (c, isNew, posted) => {
      const li = el('li', `tk-msg${isNew ? ' is-new' : ''}${posted ? ' is-posted' : ''}`);
      const av = el('span', `tk-av${c.by === me ? ' mine' : ''}`, initialsOf(c.by));
      av.setAttribute('aria-hidden', 'true');
      const main = el('div', 'tk-main');
      const head = el('div', 'tk-head');
      head.append(el('b', '', c.by === me ? 'You' : c.by || 'Someone'), el('time', '', when(c.at)));
      // A hand-on reads as one plain line in the thread: "Mock Team handed this to Application Team", then the reason; a move to
      // another day as "Moved to Wed 18 Nov", then why.
      if (c.handoff) { li.classList.add('is-handoff'); main.append(head, el('p', 'tk-hand', `Reassigned: ${labelOf(c.handoff.from)} \u2192 ${labelOf(c.handoff.to)}`), el('p', 'tk-text', c.text)); }
      else if (c.schedule) { li.classList.add('is-schedule'); main.append(head, el('p', 'tk-hand', c.schedule.to && c.schedule.to > (today || '') ? `Moved to ${dayLabel(c.schedule.to, today)}` : 'Moved back to today')); if (c.text) main.append(el('p', 'tk-text', c.text)); }
      else main.append(head, el('p', 'tk-text', c.text));
      li.append(av, main);
      return li;
    };
    let showAll = false;
    const LATEST = 2;
    const draw = () => {
      const all = comments();
      const from = inline && !showAll ? Math.max(0, all.length - Math.max(LATEST, fresh)) : 0;
      const items = all.slice(from).map((c, i) => entry(c, from + i >= all.length - fresh && c.by !== me));
      if (from > 0) {
        const more = h('button', { class: 'tk-earlier', type: 'button' }, `Show all ${all.length} updates`);
        more.addEventListener('click', () => { showAll = true; draw(); });
        items.unshift(el('li', 'tk-earlier-row'));
        items[0].append(more);
      }
      list.replaceChildren(...items);
      if (!all.length && !inline) list.append(el('li', 'tk-empty', canWrite ? 'Progress, a question or what is needed. Everyone on the task sees it on Today.' : 'No updates yet.'));
      list.hidden = inline && !all.length;
    };
    // Read: the dot goes, here and in the menu (shared/header.js listens for "isr-tasks-read").
    const markRead = () => {
      if (pending <= 0) return;
      pending = 0; fresh = 0; label();
      api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { seen: true })
        .then(() => window.dispatchEvent(new Event('isr-tasks-read'))).catch(() => { /* marked next time */ });
      const row = box.closest('.td-task');
      if (row) { row.classList.remove('has-unread'); const dot = row.querySelector('.td-dot'); if (dot) dot.remove(); }
    };
    const setOpen = (open) => {
      if (open) openThreads.add(task.id); else openThreads.delete(task.id);
      toggle.setAttribute('aria-expanded', String(open));
      box.classList.toggle('is-open', open);
    };
    let input = null;
    // What is new opens by itself so it is seen, but counts as read only once the person deals with it: a click on the comments or
    // on their line, or a comment of their own. So a red dot never disappears by itself.
    toggle.addEventListener('click', () => { markRead(); const open = !box.classList.contains('is-open'); setOpen(open); if (open && input) setTimeout(() => input.focus(), 250); });
    // A click or typing in the updates reads them (a touch to scroll past does not).
    body.addEventListener('click', markRead);
    body.addEventListener('focusin', markRead);
    const inner = el('div', 'tk-inner');
    body.append(inner);
    inner.append(list);
    if (canWrite) {
      const form = el('div', 'tk-compose');
      input = el('textarea', 'tk-input');
      input.rows = 1; input.maxLength = 2000; input.placeholder = inline && !comments().length ? 'Write the first update' : 'Write an update';
      input.setAttribute('aria-label', 'Write an update');
      const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };
      const send = h('button', { class: 'btn btn-primary btn-sm tk-send', type: 'button', disabled: true }, 'Post');
      input.addEventListener('input', () => { grow(); send.disabled = !input.value.trim(); });
      const post = async () => {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true; input.disabled = true;
        try {
          const out = await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { comment: text });
          const now = out && out.card && (out.card.tasks || []).find((t) => t.id === task.id);
          task.comments = now ? now.comments || [] : [...comments(), { by: me, at: new Date().toISOString(), text }];
          input.value = ''; grow();
          fresh = 0;
          const empty = list.querySelector('.tk-empty'); if (empty) empty.remove();
          list.hidden = false;
          list.append(entry(comments()[comments().length - 1], false, true));
          label();
          window.dispatchEvent(new Event('isr-tasks-read'));
        } catch (e) { if (root.NiecUI) root.NiecUI.toast(e.message, { type: 'error' }); }
        input.disabled = false; send.disabled = !input.value.trim(); input.focus();
      };
      send.addEventListener('click', post);
      // Enter adds a line; Ctrl+Enter (or Cmd+Enter) posts, as in Apple's own apps.
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } });
      const bar = el('div', 'tk-compose-bar');
      bar.append(el('small', '', 'Ctrl+Enter to post'), send);
      form.append(input, bar);
      inner.append(form);
    }
    label(); draw();
    box.markRead = markRead; // read from a notification (Today)
    box.badge = badge; // inline: shown at the task's top right when something is new
    if (inline) { box.classList.add('is-inline', 'is-open'); box.append(body); return box; }
    box.append(toggle, body);
    setOpen(openThreads.has(task.id) || fresh > 0);
    return box;
  }

  // The way a task went: "From SK → Mock Team → Application Team", the team it is with now last.
  function taskRoute(task, { fromName, toName, teams = [] }) {
    const labelOf = (id) => (teams.find((t) => t.id === id) || { label: id === 'head' ? 'Admin' : id }).label;
    const route = el('div', 'td-route');
    route.append(el('span', 'td-from-who', fromName));
    (Array.isArray(task.route) ? task.route : []).forEach((id) => route.append(el('span', 'td-arrow', '\u2192'), el('span', 'td-was', labelOf(id))));
    route.append(el('span', 'td-arrow', '\u2192'), el('span', 'td-to-who', toName));
    return route;
  }
  // Hand a task on to another team, in the same task (the owner, 14 Nov 2026): choose the team and say why. Resolves true once done.
  function handOn(task, { rowId, teams = [] }) {
    return dialog('Reassign task', (body, close) => {
      const choices = teams.filter((t) => t.id !== task.team).map((t) => [t.id, t.label]);
      body.append(el('p', 'p-muted p-small', 'The task and its updates move to the new team. Earlier teams keep access.'));
      const team = field('Reassign to', { kind: 'select', choices });
      const why = field('Reason and next step', { kind: 'area', max: 2000, wide: true, placeholder: 'e.g. Mock passed. Please request the CAS.' });
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Reassign');
      ok.addEventListener('click', async () => {
        if (!team.input.value) { msg.textContent = 'Choose the team.'; msg.className = 'p-msg error'; return; }
        if (!why.input.value.trim()) { msg.textContent = 'Add the reason and next step.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { handTo: team.input.value, reason: why.input.value.trim() }); close(true); } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(team.wrap, why.wrap);
      body.append(g, msg, foot);
    });
  }
  // A task's actions, side by side at its top right (Reassign, Remove): small, quiet buttons, never spread across the row.
  function taskActions(list) {
    const box = el('div', 'td-acts');
    list.filter(Boolean).forEach(([label, onClick, danger]) => box.append(h('button', { class: `td-act${danger ? ' danger' : ''}`, type: 'button', onclick: onClick }, label)));
    return box.childNodes.length ? box : null;
  }
  // A task's actions behind one quiet "..." button (Reassign, Remove), so the row stays calm (the owner, 15 Nov 2026).
  function taskMenu(list) {
    const items = list.filter(Boolean);
    if (!items.length) return null;
    const wrap = el('div', 'td-menu-wrap');
    const btn = h('button', { class: 'td-more-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'More for this task', title: 'More' });
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
    const menu = el('div', 'td-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
    items.forEach(([label, onClick, danger]) => {
      const it = h('button', { class: `td-menu-item${danger ? ' danger' : ''}`, type: 'button', role: 'menuitem' }, label);
      it.addEventListener('click', (e) => { e.stopPropagation(); close(); onClick(); });
      menu.append(it);
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu.hidden) { close(); return; }
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true);
      const first = menu.querySelector('button'); if (first) first.focus();
    });
    wrap.append(btn, menu);
    return wrap;
  }
  // One task, the same on Today and on the student card (the owner, 15 Nov 2026: "as Apple would make it"): a round tick; the task
  // in semibold; beside it, on the right, its updates (a speech bubble with how many, a red count when something is new) and "...";
  // under it one grey line with the priority (when not the usual), the tag, the student and the stage; then who gave it to whom and
  // when, in small grey type. The updates open under the task.
  //   o: { rowId, me, teams, mayTick, tickTitle, canWrite, canChange, unread, stage, student: { name, href } | null, fromName,
  //        toName, actions: [[label, onClick, danger]], onTick: async (done) => {}, onChanged }
  function taskCard(t, o) {
    const r = el('div', `td-task${t.done ? ' is-done' : ''}${o.unread ? ' has-unread' : ''}`);
    r.dataset.taskId = t.id;
    if (!t.done && priorityOf(t) === 'super') r.classList.add('is-super');
    const tick = h('button', { class: 'td-check', type: 'button', 'aria-pressed': String(t.done), title: o.mayTick ? (t.done ? 'Mark as not done' : 'Mark as done') : (o.tickTitle || ''), 'aria-label': t.done ? 'Mark as not done' : 'Mark as done', disabled: !o.mayTick });
    tick.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    tick.addEventListener('click', async () => {
      // Done is asked once more (the owner, 15 Nov 2026), so a task is never ticked by a slip of the mouse.
      if (!t.done && root.NiecUI && !(await root.NiecUI.confirm(`${o.student ? niceName(o.student.name) + ': ' : ''}\u201c${t.text.length > 120 ? t.text.slice(0, 117) + '...' : t.text}\u201d\n\nIs this task finished? It moves to Done and ${o.fromName === 'You' ? 'you see' : (o.fromName || 'whoever gave it') + ' sees'} that it is done.`, { title: 'Mark as done?', confirmText: 'Yes, it is done', cancelText: 'Not yet' }))) return;
      tick.disabled = true;
      // The circle turns blue with a tick and the row folds away, and only then is the list redrawn (the next task never jumps).
      const quick = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!t.done) { r.classList.add('is-ticking'); celebrate(tick); }
      const folded = new Promise((ok) => setTimeout(ok, t.done || quick ? 0 : 520));
      try { await o.onTick(!t.done, folded); } catch (e) { r.classList.remove('is-ticking'); tick.disabled = false; }
    });
    const mid = el('div', 'td-task-mid');
    const top = el('div', 'td-task-top');
    // The student first, then what to do (the owner, 15 Nov 2026): the team sees at once whose task it is, with the student's
    // name in bold and the stage on top, and the task under it in a calmer weight. On the student's own card the task stands alone.
    const head = el('div', 'td-head-main');
    if (o.student) {
      const who = el('div', 'td-who');
      const name = h('a', { class: 'td-who-name', href: o.student.href, title: 'Open the student card' }, niceName(o.student.name));
      who.append(name);
      if (o.stage) who.append(el('span', 'td-who-stage', o.stage));
      head.append(who);
      r.classList.add('has-student');
    }
    head.append(el('div', 'td-task-text', t.text));
    top.append(head);
    const side = el('div', 'td-side');
    top.append(side);
    // Priority, tag, student and stage on one line.
    const sub = el('div', 'td-sub');
    const badges = taskBadges(t, { rowId: o.rowId, stage: o.stage, canChange: o.canChange, onChanged: o.onChanged });
    sub.append(...badges.childNodes);
    // Moved to a later day: a small blue pill with the day ("Tomorrow", "Wed 18 Nov").
    if (!t.done && t.doOn && o.today && t.doOn > o.today) sub.prepend(el('span', 'td-when-pill', dayLabel(t.doOn, o.today)));

    const route = taskRoute(t, { fromName: o.fromName, toName: o.toName, teams: o.teams });
    // The day it was given and what followed ("15 Nov · Edited · Open 3 days"), kept together so they wrap as one on a phone.
    const dated = el('span', 'td-route-meta');
    dated.append(el('span', 'td-when', t.at ? new Date(t.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''));
    // How long an open task has waited, from the third day on, so nothing is quietly forgotten.
    const waited = Math.floor((Date.now() - Date.parse(t.at || 0)) / 86400000);
    if (!t.done && waited >= 2 && waited < 400) dated.append(el('span', `td-waiting${waited >= 7 ? ' is-long' : ''}`, `Open ${waited} days`));
    if (t.editedAt) { const ed = el('span', 'td-edited', 'Edited'); ed.title = `Changed by ${t.editedBy || 'someone'}, ${when(t.editedAt)}`; dated.append(ed); }
    if (t.done) dated.append(el('span', 'td-donemark', t.doneBy ? `Done by ${t.doneBy}` : 'Done'));
    route.append(dated);
    // The updates are always open on the task, with the box to write one (the owner, 15 Nov 2026); a done task keeps them folded.
    const thread = taskThread(t, { rowId: o.rowId, me: o.me, canWrite: o.canWrite && !t.done, unread: o.unread || 0, teams: o.teams, inline: !t.done, today: o.today });
    const toggle = thread.querySelector('.tk-toggle');
    if (toggle) side.append(toggle);
    else if (o.unread && thread.badge) side.append(thread.badge);
    const menu = taskMenu(o.actions || []);
    if (menu) side.append(menu);
    mid.append(top, sub, route, thread);
    r.append(tick, mid);
    // From a notification: open the updates and mark the task read.
    r.openThread = () => { if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click(); else thread.markRead(); if (thread.badge) thread.badge.hidden = true; };
    // Read only when the person opens its updates, writes one, or presses its notification: never by touching or scrolling past the
    // task (on a phone that cleared the notifications before anyone had read them).
    return r;
  }

  // ---- what a task is about, how important it is (the owner, 15 Nov 2026), and the order the tasks are listed in ----
  const F = () => root.CardFields || {};
  const TAGS = () => (F().TASK_TAGS || [['other', 'Other']]);
  const PRIORITIES = () => (F().TASK_PRIORITIES || [['super', 'Super priority'], ['high', 'Priority'], ['medium', 'Medium']]);
  const tagOf = (task, stage) => (F().taskTag ? F().taskTag(task, stage) : (task.tag || 'other'));
  const priorityOf = (task) => (F().taskPriorityOf ? F().taskPriorityOf(task) : (task.priority || 'high'));
  const tagLabel = (id) => (TAGS().find(([k]) => k === id) || [id, 'Other'])[1];
  const priorityLabel = (id) => (PRIORITIES().find(([k]) => k === id) || [id, 'Priority'])[1];
  // The order of a list: Super priority, then Priority, then Medium (as chosen by whoever gave the task); inside each, a task with
  // something new on it first, then the one waiting longest. No date or "do first" is worked out by the system any more (the owner,
  // 15 Nov 2026: a task given today was marked "Do first" and everything looked urgent).
  const RANK = { super: 3, high: 2, medium: 1 };
  function taskPriority(t) {
    if (t.done) return -1;
    return (RANK[priorityOf(t)] || 2) * 1e13 + (t.unread ? 1e12 : 0) + (1e12 - 1 - Math.min(1e12 - 1, Date.parse(t.at || 0) / 1000 || 0));
  }
  // The priority (only when it is not the usual Priority, so the eye goes to what matters) and the tag, as two small pills. Whoever may
  // change them presses either to choose again.
  function taskBadges(task, { rowId, stage, canChange, onChanged }) {
    const line = el('div', 'td-tag-line');
    const pr = priorityOf(task);
    const tag = tagOf(task, stage);
    const open = (e) => { e.stopPropagation(); changeTask(task, { rowId, tag, priority: pr }).then((done) => { if (done && onChanged) onChanged(); }); };
    const pill = (cls, text) => { const b = h('button', { class: cls, type: 'button', disabled: !canChange, title: canChange ? 'Press to change what it is about or how important it is' : '' }, text); if (canChange) b.addEventListener('click', open); return b; };
    if (pr !== 'high') line.append(pill(`td-prio prio-${pr}`, priorityLabel(pr)));
    line.append(pill(`td-tag tag-${tag}`, tagLabel(tag)));
    return line;
  }
  // Edit a task after it was given (the owner, 15 Nov 2026): its words, how important it is and what it is about. The team to do it is
  // changed with Reassign. Resolves true once saved.
  function editTask(task, { rowId, stage }) {
    return dialog('Edit the task', (body, close) => {
      const words = field('What should they do?', { kind: 'area', max: 2000, wide: true, value: task.text });
      words.input.rows = 3;
      const pr = priorityPicker(priorityOf(task));
      // The tag follows the words by itself (unless one was pressed on the task), shown in the priority section.
      const auto = el('div', 'p-auto-tag');
      const chosen = root.CardFields && root.CardFields.TASK_TAG_IDS.includes(task.tag);
      const showTag = () => { const k = chosen ? task.tag : (root.CardFields ? root.CardFields.guessTaskTag(words.input.value, task.team, stage) : tagOf(task, stage)); auto.replaceChildren(el('span', 'p-auto-label', chosen ? 'Tag:' : 'Tag, set automatically:'), el('span', `td-tag tag-${k}`, tagLabel(k))); };
      words.input.addEventListener('input', showTag);
      showTag();
      const field2 = (label, ...nodes) => { const w = el('div', 'p-field p-wide'); w.append(el('span', 'p-label', label), ...nodes); return w; };
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save changes');
      ok.addEventListener('click', async () => {
        if (!words.input.value.trim()) { msg.textContent = 'Write what should be done.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { text: words.input.value, priority: pr.value() }); close(true); } catch (err) { msg.textContent = err.message; msg.className = 'p-msg error'; ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(words.wrap, field2('How important is it?', pr.node, auto));
      body.append(g, el('p', 'p-muted p-small', 'The team sees the task marked Edited, with a notification. To give it to another team, use Reassign.'), msg, foot);
      setTimeout(() => { words.input.focus(); words.input.setSelectionRange(words.input.value.length, words.input.value.length); }, 0);
    });
  }
  // Move a task to another day (the team it is with, whoever gave it, Admin, the Manager): only the calendar, the day is picked there
  // (the owner, 15 Nov 2026). A task moved earlier can be brought back to today. Resolves true once moved.
  function scheduleTask(task, { rowId, today }) {
    const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const moved = task.doOn && task.doOn > today;
    return dialog('Move to another day', (body, close) => {
      const date = field('Which day?', { kind: 'date', value: moved ? task.doOn : add(1) });
      date.input.min = add(1);
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const go = async (day) => {
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { schedule: day }); close(true); } catch (err) { msg.textContent = err.message; msg.className = 'p-msg error'; }
      };
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Move');
      ok.addEventListener('click', () => {
        if (!date.input.value || date.input.value <= today) { msg.textContent = 'Choose a day after today.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true; go(date.input.value).then(() => { ok.disabled = false; });
      });
      if (moved) foot.append(h('button', { class: 'btn', type: 'button', onclick: () => go('') }, 'Back to today'));
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(date.wrap);
      body.append(el('p', 'p-muted p-small', 'It waits under Later days and comes back to today\u2019s tasks on that day by itself.'), g, msg, foot);
    });
  }
  function changeTask(task, { rowId, tag, priority }) {
    return dialog('Change the task', (body, close) => {
      const pr = priorityPicker(priority);
      const tg = tagPicker(tag);
      const field2 = (label, node) => { const w = el('div', 'p-field p-wide'); w.append(el('span', 'p-label', label), node); return w; };
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { tag: tg.value(), priority: pr.value() }); close(true); } catch (err) { ok.disabled = false; if (root.NiecUI) root.NiecUI.toast(err.message, { type: 'error' }); }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(field2('How important is it?', pr.node), field2('What is it about?', tg.node));
      body.append(g, foot);
    });
  }
  // A row of pills to choose one of `choices`; `cls(k)` gives each its look.
  function picker(choices, initial, cls, label) {
    let value = initial;
    let touched = false;
    const node = el('div', 'td-tag-pick');
    node.setAttribute('role', 'radiogroup');
    node.setAttribute('aria-label', label);
    const buttons = choices.map(([k, text]) => {
      const b = h('button', { class: cls(k), type: 'button', role: 'radio', 'aria-checked': String(k === value) }, text);
      b.addEventListener('click', () => { touched = true; set(k); });
      node.append(b);
      return [k, b];
    });
    function set(k) { value = k; buttons.forEach(([kk, b]) => b.setAttribute('aria-checked', String(kk === k))); }
    return { node, value: () => value, set: (k) => { if (!touched) set(k); }, touched: () => touched };
  }
  const tagPicker = (initial) => picker(TAGS(), initial || 'other', (k) => `td-tag tag-${k}`, 'What the task is about');
  const priorityPicker = (initial) => picker(PRIORITIES(), initial || 'high', (k) => `td-prio prio-${k}`, 'How important the task is');
  // A few words of thanks when a task is ticked, not the same line every time.
  const CHEERS = ['Done. Nice work.', 'Ticked off. Well done.', 'One less to think about.', 'Great job, that is done.', 'Done. The student is a step closer.', 'Nicely done.'];
  const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
  // A small, happy burst of soft coloured dots from where a task was ticked (nothing moves for people who ask for less motion).
  function celebrate(from) {
    if (!from || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const r = from.getBoundingClientRect();
    const box = el('div', 'isr-burst');
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top + r.height / 2}px`;
    const colours = ['#0071e3', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa'];
    for (let i = 0; i < 14; i += 1) {
      const d = el('i');
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 26 + Math.random() * 22;
      d.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      d.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      d.style.background = colours[i % colours.length];
      box.append(d);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 900);
  }
  root.Portal = { niceName, taskThread, taskRoute, handOn, editTask, scheduleTask, dayLabel, taskActions, taskMenu, taskCard, taskBadges, tagPicker, priorityPicker, taskPriority, tagOf, priorityOf, tagLabel, celebrate, cheer, el, h, api, day, when, fromToday, stageKind, stagePill, initials, number, rupees, percent, richText, field, datalist, dialog, copy, waitFor };
})(this);
