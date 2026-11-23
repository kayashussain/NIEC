// Small helpers shared by the portal pages (student card, templates, B2B partners, the decision pages and
// the Universities' option finder). Loaded as window.Portal after session.js and ui.js.
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


  // The red asterisk after the label of anything that must be filled in (the owner, 18 Nov 2026: every required detail is marked).
  function requiredMark() { const m = el('b', 'p-req', ' *'); m.setAttribute('aria-hidden', 'true'); m.title = 'Required'; return m; }
  // A labelled box of a form. kind: text | date | number | area | select (choices: [value] or [[value, label]]).
  function field(label, { kind = 'text', value = '', choices = [], placeholder = '', max = 300, list = '', hint = '', wide = false, disabled = false, required = false } = {}) {
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
    const lab = el('span', 'p-label', label);
    if (required) { lab.append(requiredMark()); input.setAttribute('aria-required', 'true'); }
    wrap.append(lab, input);
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
        if (d.classList.contains('is-closing')) return; // the first answer stands: a click during the fade cannot replace it
        result = value;
        const quick = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (quick) { d.close(); return; }
        d.classList.add('is-closing');
        setTimeout(() => d.close(), 160);
      };
      const head = el('div', 'p-dialog-head');
      const x = h('button', { type: 'button', class: 'p-x', 'aria-label': 'Close', onclick: () => { if (!d.dataset.busy) close(); } }, '×');
      head.append(el('h2', '', title), x);
      const body = el('div', 'p-dialog-body');
      d.append(head, body);
      d.addEventListener('close', () => { d.remove(); resolve(result); });
      d.addEventListener('mousedown', (e) => { if (e.target === d && !d.dataset.busy) close(); });
      // Escape closes with the same short animation as the close button, not the browser's instant close.
      d.addEventListener('cancel', (e) => { e.preventDefault(); if (!d.dataset.busy) close(); }); // a window marked busy (a save is on its way) cannot be dismissed
      document.body.append(d);
      build(body, close);
      d.showModal();
      // The cursor starts in the first box to fill (as on a Mac), not on the close button; a date box is skipped (it would open its
      // calendar), and a window with nothing to fill starts on its main button.
      const first = body.querySelector('input:not([type="hidden"]):not([type="date"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])') || body.querySelector('.btn-primary:not([disabled])');
      if (first && !body.contains(document.activeElement)) { try { first.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
    });
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
  // The updates of a task. `always` (an open task anyone may write on, the owner, 15 Nov 2026): the latest two updates and the box to
  // write one sit right on the task. Otherwise they fold behind one button ("2", "Update"), and something new opens them by itself.
  function taskThread(task, { rowId, me, canWrite, unread = 0, teams = [], today = '', always = false }) {
    const labelOf = (id) => (teams.find((t) => t.id === id) || { label: id === 'head' ? 'Admin' : id }).label;
    const box = el('div', 'tk-thread');
    const list = el('ol', 'tk-list');
    // A move to another day with nothing written is not an update (the owner, 20 Nov 2026: the thread was confusing): the day it waits
    // for is the small blue pill on the task, so only real words are listed.
    const comments = () => (Array.isArray(task.comments) ? task.comments : []).filter((c) => !(c.schedule && !String(c.text || '').trim()));
    // `pending`: everything new on the task for the reader (new comments, or the task itself just given to them); `fresh`: the new
    // comments among it, shown on the comments line.
    let pending = unread;
    let fresh = unread; // everything new on the task, as the bell counts it (the owner, 21 Nov 2026: the numbers must agree)
    const toggle = h('button', { class: 'tk-toggle', type: 'button', 'aria-expanded': 'false' });
    const body = el('div', 'tk-body');
    // The line is changed in place (never rebuilt), so a press on it is never lost while it is being clicked.
    const ico = el('span', 'tk-ico'); ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/></svg>';
    const words = el('span');
    const badge = el('span', 'tk-new');
    toggle.append(ico, words, badge);
    const label = () => {
      const n = comments().length;
      words.textContent = n ? String(n) : (canWrite ? 'Update' : '0');
      words.hidden = fresh > 0; // "2 new" says it all, not "3" beside it
      toggle.title = n ? `${n} update${n === 1 ? '' : 's'}${fresh ? `, ${fresh} new` : ''}` : 'Write an update';
      toggle.setAttribute('aria-label', toggle.title);
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
    const LATEST = always ? 2 : 3;
    const draw = () => {
      const all = comments();
      const from = !showAll ? Math.max(0, all.length - Math.max(LATEST, fresh)) : 0;
      const items = all.slice(from).map((c, i) => entry(c, from + i >= all.length - fresh && c.by !== me));
      if (from > 0) {
        const more = h('button', { class: 'tk-earlier', type: 'button' }, `Show all ${all.length} updates`);
        more.addEventListener('click', () => { showAll = true; draw(); });
        items.unshift(el('li', 'tk-earlier-row'));
        items[0].append(more);
      }
      list.replaceChildren(...items);
      if (!all.length) list.append(el('li', 'tk-empty', 'No updates yet.'));
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
      input.rows = 1; input.maxLength = 2000; input.placeholder = comments().length ? 'Write an update' : 'Write the first update';
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
          input.placeholder = 'Write an update';
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
      // One rectangular box, the words at the left and Post at the right (the owner, 15 Nov 2026).
      input.title = 'Ctrl+Enter to post';
      form.append(input, send);
      inner.append(form);
    }
    label(); draw();
    box.markRead = markRead; // read from a notification (Today)
    box.badge = badge; // shown at the task's top right when something is new
    if (always) { list.hidden = !comments().length; box.classList.add('is-open', 'is-always'); box.append(body); return box; }
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
      body.append(el('p', 'p-muted p-small', 'The task and its updates move to the new team.'));
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
  // The "Mark as done?" window (the owner, 16 Nov 2026: nothing is filled in by itself; the team is asked, checks, then it is saved).
  // Step 1 shows what ISR already knows about the student (every application with its days) and asks what the task's tag needs, with
  // no answer chosen and no day filled in. Step 2 shows the server's own list of exactly what will change, what stays as it is and
  // anything that does not add up; only "Yes, this is correct" saves it. A task with nothing to ask (Documents, Other) takes one
  // optional line and is done. Resolves the confirmed answers ({ ..., confirmed: true }) or null when Not yet is pressed.
  function doneDialog(t, o) {
    let answer = null;
    const url = `/api/cards/${encodeURIComponent(o.rowId)}/tasks/${t.id}`;
    const tag = tagOf(t, o.stage);
    const asks = ['application', 'offer', 'noc', 'mock', 'medical', 'payment', 'visa'].includes(tag);
    return dialog('Mark as done?', (body, close) => {
      // An application task names its university and course below, so only the student is named here.
      // An application task and an Offer request show only the student's name here (their university and course follow): no long sentence.
      const isOfferReq = /^Offer request: /.test(String(t.text || ''));
      const taskLine = el('p', 'td-done-task', t.app || isOfferReq ? (o.student ? niceName(o.student.name) : '') : `${o.student ? niceName(o.student.name) + ': ' : ''}“${t.text.length > 160 ? t.text.slice(0, 157) + '...' : t.text}”`);
      body.append(taskLine);
      // The Application Team's own look (the owner, 23 Nov 2026): the window carries a class, and a two-step window says which step it is on.
      const dlg = body.closest('dialog');
      const dlgHead = dlg && dlg.querySelector('.p-dialog-head');
      let stepNo = null;
      const appLook = () => { if (dlg) dlg.classList.add('td-done-app'); };
      if (o.app) appLook();
      const ask = el('div', 'td-done-step');
      const sure = el('div', 'td-done-step');
      sure.hidden = true;
      body.append(ask, sure);
      const msg = el('div', 'p-msg');
      // The message is shown where the person is looking: scrolled into view and announced (a long window hid it below the buttons).
      const fail = (e) => { msg.textContent = e.message || String(e); msg.className = 'p-msg error'; msg.setAttribute('role', 'alert'); try { msg.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { /* older browsers */ } };
      const wait = el('p', 'p-muted p-small', 'Loading what ISR knows about this student...');
      ask.append(wait);
      api(url, { finishState: true }).then((r) => { wait.remove(); if (r.state && r.state.appTeam) appLook(); build(r.state); }).catch((e) => { wait.remove(); ask.append(msg); fail(e); });

      function build(state) {
        const form = el('div', 'p-form td-done-form');
        ask.append(form);
        const today = (state && state.today) || o.today || new Date().toISOString().slice(0, 10);
        const sheet = (state && state.sheet) || {};
        // A short question answered with pills; nothing is chosen until the person chooses.
        const question = (label, choices, onChange) => {
          const w = el('div', 'p-field p-wide');
          const ql = el('span', 'p-label', label); ql.append(requiredMark()); // an answer is required
          w.append(ql);
          const p = picker(choices, '', (k) => `td-prio td-answer ans-${k}`, label);
          p.node.addEventListener('click', () => setTimeout(() => onChange && onChange(p.value()), 0));
          w.append(p.node);
          form.append(w);
          return p;
        };
        const show = (nodes, on) => [].concat(nodes).forEach((n) => { n.hidden = !on; });
        const dateField = (label, max) => { const f = field(label, { kind: 'date', value: '' }); if (max) f.input.max = max; form.append(f.wrap); return f; };
        // What is on the sheet now, in one quiet line, so the team answers knowing it.
        const nowLine = (cols) => {
          const bits = cols.filter((c) => String(sheet[c] || '').trim()).map((c) => `${(state.labels || {})[c] || c}: ${day(sheet[c])}`);
          if (bits.length) form.append(el('p', 'p-muted p-small p-wide td-done-now', `Now on All Students: ${bits.join(' · ')}`));
        };
        let read = () => ({});
        let fallbackNote = () => ''; // words supplied when the person writes none (an Offer request that is not answered yet)
        let onWhat = () => {}; // the answer chosen changes what the notes box asks
        const specificFrom = form.children.length; // everything added from here to the "What was done?" box belongs to the task's own question
        let check = () => '';
        let noNotes = false; // the Offer request window has no notes box (the owner, 20 Nov 2026)
        let notesOptional = false; // the application window has an optional notes box, as in F5 (the owner, 23 Nov 2026)
        // The Application Team's window follows the approved design F5 for every kind of task (the owner, 23-24 Nov 2026): the student's
        // name in the header, What happened, the day it happened and Notes (optional), then Check before saving. Other teams keep theirs.
        const F5 = Boolean(dlg && dlg.classList.contains('td-done-app'));
        if (F5 && o.student && o.student.name) { taskLine.textContent = niceName(o.student.name); if (dlgHead) dlgHead.append(taskLine); }
        // The university and course the task is about: shown when the task names them; a task typed by hand gets two boxes to fill.
        const courseBlock = (c) => {
          if (c && c.university) {
            const who = el('div', 'p-wide td-course');
            who.append(el('b', '', c.university), c.course ? el('span', 'td-sofar-course', c.course) : '');
            form.append(who);
            return () => ({ university: c.university, course: c.course || '' });
          }
          const listId = `td-unis-${t.id}`;
          form.append(datalist(listId, (state && state.universities) || []));
          const uf = field('University', { max: 160, list: listId, required: true, placeholder: 'Choose or type the university' });
          const cf = field('Course', { max: 240, placeholder: 'The course applied for' });
          form.append(uf.wrap, cf.wrap);
          return () => ({ university: uf.input.value.trim().replace(/\s+/g, ' '), course: cf.input.value.trim().replace(/\s+/g, ' ') });
        };
        if (F5 && tag === 'application') {
          const target = courseBlock((state && state.courseTask) || t.app);
          const q = question('What happened', [['submitted', 'Applied'], ['notsubmitted', 'Not submitted']], (v) => show(why.node.parentNode, v === 'notsubmitted'));
          const why = question('Why', [['noteligible', 'Not eligible'], ['agent', 'Already applied through another agent'], ['nocourse', 'The course is not available'], ['closed', 'Applications are closed']]);
          show(why.node.parentNode, false);
          const dayF = field('Day it happened', { kind: 'date', value: today, required: true });
          dayF.input.max = today;
          form.append(dayF.wrap);
          q.set('submitted');
          notesOptional = true;
          // The Why chosen goes to the server as its own answer: it is the reason kept on the university, and the note says it with
          // anything typed in Notes (the owner, 24 Nov 2026).
          read = () => {
            const c = target();
            if (!c.university) return {};
            const line = { university: c.university, course: c.course, date: dayF.input.value };
            if (q.value() === 'submitted') return { app: 'record', date: dayF.input.value, unis: [{ ...line, what: 'submitted' }] };
            if (q.value() === 'notsubmitted' && why.value()) return { app: 'record', date: dayF.input.value, unis: [{ ...line, what: 'notsubmitted', why: why.value() }] };
            return {};
          };
          check = () => {
            const c = target();
            return !c.university ? 'Write the university.' : !q.value() ? 'Choose what happened.' : q.value() === 'submitted' && !c.course ? 'Write the course.'
              : q.value() === 'notsubmitted' && !why.value() ? 'Choose why it was not submitted.' : !dayF.input.value ? 'Choose the day it happened.' : '';
          };
        } else if (F5 && tag === 'offer') {
          const target = courseBlock(state && state.offerTask);
          const q = question('What happened', [['conditional', 'Conditional offer'], ['unconditional', 'Unconditional offer'], ['refused', 'Application rejected'], ['closed', 'Application closed']]);
          const dayF = field('Day it happened', { kind: 'date', value: today, required: true });
          dayF.input.max = today;
          form.append(dayF.wrap);
          notesOptional = true;
          fallbackNote = () => { const c = target(); return q.value() === 'refused' ? `Application to ${c.university} rejected.` : q.value() === 'closed' ? `Applications to ${c.university} are closed: the deadline has passed.` : ''; };
          // Application closed is kept as withdrawn on that university (the application no longer goes on), with the reason in its note.
          read = () => { const c = target(); return c.university && q.value() ? { app: 'record', date: dayF.input.value, unis: [{ university: c.university, course: c.course, what: q.value() === 'closed' ? 'withdrawn' : q.value(), date: dayF.input.value }] } : {}; };
          check = () => (!target().university ? 'Write the university.' : !q.value() ? 'Choose what happened.' : !dayF.input.value ? 'Choose the day it happened.' : '');
        } else if (t.app || (state && state.courseTask)) {
          // Other teams (Admin, the Manager, the student card): one application, one university and course (the owner, 20 Nov 2026), the
          // answer one of five with its day (21 Nov 2026), no notes, then Save.
          const c = t.app || state.courseTask;
          const who = el('div', 'p-wide td-course');
          who.append(el('b', '', c.university), c.course ? el('span', 'td-sofar-course', c.course) : '');
          const chips = [c.intake, c.level, c.location].filter(Boolean);
          if (chips.length) { const cs = el('span', 'td-app-chips'); chips.forEach((x) => cs.append(el('span', '', x))); who.append(cs); }
          form.append(who);
          const q = question('Result', [['submitted', 'Application submitted'], ['noteligible', 'Not eligible'], ['agent', 'Already applied through another agent'], ['nocourse', 'Course not available'], ['closed', 'Application closed']]);
          const dayF = field('Date', { kind: 'date', value: today, required: true });
          dayF.input.max = today;
          form.append(dayF.wrap);
          q.set('submitted');
          noNotes = true;
          read = () => (q.value() === 'submitted' ? { app: 'record', date: dayF.input.value, unis: [{ university: c.university, course: c.course, what: 'submitted', date: dayF.input.value }] }
            : q.value() ? { app: 'record', date: dayF.input.value, unis: [{ university: c.university, course: c.course, what: 'notsubmitted', why: q.value(), date: dayF.input.value }] } : {});
          check = () => (!q.value() ? 'Choose the result.' : !dayF.input.value ? 'Choose the date.' : '');
        } else if (state && state.offerTask) {
          // The Offer request for other teams (the owner, 21 Nov 2026): what the university said, with its day. No notes.
          const c = state.offerTask;
          const who = el('div', 'p-wide td-course');
          who.append(el('b', '', c.university), c.course ? el('span', 'td-sofar-course', c.course) : '');
          const chips = [c.intake, c.applied ? `Applied ${day(c.applied)}` : ''].filter(Boolean);
          if (chips.length) { const cs = el('span', 'td-app-chips'); chips.forEach((x) => cs.append(el('span', '', x))); who.append(cs); }
          form.append(who);
          const q = question('Has the student received the offer letter?', [['conditional', 'Conditional offer'], ['unconditional', 'Unconditional offer'], ['refused', 'Application rejected'], ['closed', 'Application closed']]);
          const dayF = field('Date', { kind: 'date', value: today, required: true });
          dayF.input.max = today;
          form.append(dayF.wrap);
          noNotes = true;
          const NOTE = { refused: `Application to ${c.university} rejected.`, closed: `Applications to ${c.university} are closed: the deadline has passed.` };
          fallbackNote = () => NOTE[q.value()] || '';
          read = () => (q.value() ? { app: 'record', date: dayF.input.value, unis: [{ university: c.university, course: c.course, what: q.value() === 'closed' ? 'withdrawn' : q.value(), date: dayF.input.value }] } : {});
          check = () => (!q.value() ? 'Choose what the university said.' : !dayF.input.value ? 'Choose the date.' : '');
        } else if (tag === 'application' || tag === 'offer') {
          // So far: every application ISR knows, each with its days; a press on one starts a line for it below.
          const apps = state.applications || [];
          const listId = `td-unis-${t.id}`;
          form.append(datalist(listId, state.universities || []));
          const so = el('div', 'p-wide td-sofar');
          // Listed for Admin and the Manager only (the server says): a team records what its task is about (the owner, 21 Nov 2026).
          so.hidden = !(state && state.showSoFar);
          so.append(el('span', 'p-label', apps.length ? 'Applications so far (press one to record news for it)' : 'No application is recorded yet.'));
          apps.forEach((a) => {
            const line = h('button', { class: 'td-sofar-row', type: 'button', title: 'Record something for this university' });
            line.append(el('b', '', a.university), a.course ? el('span', 'td-sofar-course', a.course) : '');
            const pills = el('span', 'td-sofar-pills');
            if (a.applied) pills.append(el('span', 'p-applied', `Applied ${day(a.applied)}`));
            if (a.offer) pills.append(el('span', 'p-applied is-offer', `${a.offerType ? a.offerType + ' offer' : 'Offer'} ${day(a.offer)}`));
            if (a.refused) pills.append(el('span', 'p-applied is-refused', `Refused ${day(a.refused)}`));
            if (a.withdrawn) pills.append(el('span', 'p-applied is-refused', `Withdrawn ${day(a.withdrawn)}`));
            if (a.skipped) pills.append(el('span', 'p-applied is-refused', `Not submitted ${day(a.skipped)}`));
            if (a.onSheet) pills.append(el('span', 'td-sofar-sheet', 'On All Students'));
            line.append(pills);
            line.addEventListener('click', () => { const r = rows.find((x) => !x.uf.input.value.trim()) || addRow(); r.uf.input.value = a.university; r.cf.input.value = a.course || ''; r.what.input.focus(); });
            so.append(line);
          });
          form.append(so);
          // What happened now: one line per university, as many as needed, each with its own answer; one day for all.
          const box = el('div', 'p-wide td-unis');
          box.append(el('span', 'p-label', tag === 'offer' ? 'Has the student received the offer letter? Choose what the university said' : 'What happened? One line per university'));
          const rows = [];
          const WHAT = [['submitted', 'Applied'], ['conditional', 'Conditional offer'], ['unconditional', 'Unconditional offer'], ['refused', 'Refused'], ['withdrawn', 'Withdrawn'], ['notsubmitted', 'Not submitted (say why in the note)']];
          const more = h('button', { class: 'btn btn-sm td-uni-more', type: 'button', onclick: () => addRow().uf.input.focus() }, '+ Another university');
          function addRow(u = '', c = '', given = false) {
            const r = el('div', 'td-uni-row td-uni-row-3');
            const uf = field('', { value: u, max: 160, placeholder: 'University', list: listId });
            const cf = field('', { value: c, max: 240, placeholder: 'Course' });
            const what = field('', { kind: 'select', choices: WHAT, value: '' });
            // Its own day: an application today, another university's offer weeks ago (they are never the same day by default).
            const dayF = field('Day it happened', { kind: 'date', value: tag === 'application' ? today : '' });
            dayF.input.max = today; dayF.input.setAttribute('aria-label', 'Day it happened');
            dayF.wrap.classList.add('td-uni-day'); // its own line under the three boxes (theme.css)
            uf.input.setAttribute('aria-label', 'University'); cf.input.setAttribute('aria-label', 'Course'); what.input.setAttribute('aria-label', 'What happened');
            // A university chosen from the list brings its course with it.
            uf.input.addEventListener('change', () => { const k = apps.find((a) => a.university.toLowerCase() === uf.input.value.trim().toLowerCase()); if (k && !cf.input.value.trim()) cf.input.value = k.course || ''; });
            r.append(uf.wrap, cf.wrap, what.wrap, dayF.wrap);
            const x = { r, uf, cf, what, dayF };
            if (given) {
              // A course given to the team: the university and course are already here, and the answer starts as Applied. The cross says
              // the student is not eligible: it is not submitted, and the reason is started in the note (the owner, 18 Nov 2026).
              what.input.value = 'submitted';
              const no = h('button', { class: 'td-uni-x', type: 'button', title: 'Not eligible: do not submit to this university', 'aria-label': `Not eligible for ${u}: do not submit`, 'aria-pressed': 'false' }, '✗');
              no.addEventListener('click', () => {
                const off = no.getAttribute('aria-pressed') === 'true';
                no.setAttribute('aria-pressed', String(!off));
                what.input.value = off ? 'submitted' : 'notsubmitted';
                no.classList.toggle('is-on', !off);
                const line = `${uf.input.value.trim()}${cf.input.value.trim() ? ` (${cf.input.value.trim()})` : ''}: not submitted, the student is not eligible (entry requirements not met).`;
                if (!off && !words.input.value.includes(line)) words.input.value = [words.input.value.trim(), line].filter(Boolean).join(' ');
                if (off) words.input.value = words.input.value.replace(line, '').replace(/\s{2,}/g, ' ').trim();
                words.input.focus(); words.input.setSelectionRange(words.input.value.length, words.input.value.length);
              });
              what.input.addEventListener('change', () => { no.setAttribute('aria-pressed', String(what.input.value === 'notsubmitted')); no.classList.toggle('is-on', what.input.value === 'notsubmitted'); });
              r.append(no);
            } else if (rows.length || (state.assigned || []).length) r.append(h('button', { class: 'td-uni-x', type: 'button', 'aria-label': 'Remove this line', onclick: () => { r.remove(); rows.splice(rows.indexOf(x), 1); } }, '×'));
            rows.push(x);
            more.before(r);
            return x;
          }
          box.append(more);
          form.append(box);
          // A first application starts with the sheet's university written in; what happened is always chosen by the person.
          // The courses given to the Application Team start with a line each (the owner, 17 Nov 2026): the team chooses Applied, or
          // Not submitted (for example not eligible) and says why in the note.
          // An Offer request task names its university and course: the line starts with them, and the answer is the university's reply.
          const fromTask = tag === 'offer' ? /from (.+?)(?: \((.+)\))?\?$/.exec(String(t.text || '')) : null;
          const assigned = tag === 'offer' ? [] : (state.assigned || []);
          if (fromTask) addRow(fromTask[1], fromTask[2] || '');
          else if (assigned.length) assigned.forEach((a) => addRow(a.university, a.course || '', true));
          else if (state && state.showSoFar && sheet['UNIVERSITY NAME'] && !apps.some((a) => a.onSheet && a.applied)) addRow(sheet['UNIVERSITY NAME'] || '', sheet['COURSE NAME'] || ''); // the student's university on All Students, not yet recorded as applied (Admin and the Manager)
          else addRow();
          const on = dateField('On (the day it happened)', today);
          if (tag === 'application') on.input.value = today; // the day the application is submitted is today unless it is changed (the owner, 18 Nov 2026)
          on.wrap.hidden = true; // every line has its own day above; this one is only the fallback for a line left without one
          form.append(el('p', 'p-muted p-small p-wide', (state.assigned || []).length ? 'The universities and courses are filled in, each with its own day (today to start with: change it for an offer that came earlier). Each starts as Applied: press ✗ beside one the student is not eligible for, and say why in the note.' : 'Leave the lines empty if there is nothing to record: only the note is saved.'));
          const filled = () => rows.map((x) => ({ university: x.uf.input.value.trim(), course: x.cf.input.value.trim(), what: x.what.input.value, date: x.dayF.input.value })).filter((x) => x.university || x.what);
          read = () => (filled().length ? { app: 'record', date: on.input.value, unis: filled() } : {});
          check = () => {
            const f = filled();
            const noWhat = f.find((x) => !x.what); const noName = f.find((x) => !x.university);
            const noCourse = f.find((x) => ['submitted', 'conditional', 'unconditional', 'offer'].includes(x.what) && !x.course);
            const needsWhy = f.find((x) => ['notsubmitted', 'refused', 'withdrawn'].includes(x.what));
            const why = words.input.value.trim().length >= minNote;
            return noWhat ? `Choose what happened with ${noWhat.university}.` : noName ? 'Name the university on each line.' : noCourse ? `Write the course for ${noCourse.university}.` : f.find((x) => !x.date && !on.input.value) ? `Choose the day for ${f.find((x) => !x.date && !on.input.value).university}.` : needsWhy && !why ? 'Say why in the note below (not submitted, refused or withdrawn).' : '';
          };
        } else if (tag === 'noc') {
          // Pending or Received; Received asks for the NOC number, the NOC account's login number (the owner, 21 Nov 2026). Then comments.
          nowLine(['NOC', 'NOC NUMBER']);
          const q = question(F5 ? 'What happened' : 'NOC', [['Pending', F5 ? 'NOC pending' : 'Pending'], ['Received', F5 ? 'NOC received' : 'Received']], (v) => show(num.wrap, v === 'Received'));
          const num = field('NOC number (the NOC account login number)', { max: 60, required: true, value: (state && state.sheet && state.sheet['NOC NUMBER']) || '', placeholder: 'e.g. NOC-123456' });
          form.append(num.wrap);
          show(num.wrap, false);
          read = () => (q.value() ? { noc: q.value(), ...(q.value() === 'Received' ? { nocNumber: num.input.value.trim() } : {}) } : {});
          check = () => (!q.value() ? 'Choose Pending or Received.' : q.value() === 'Received' && !num.input.value.trim() ? 'Write the NOC number.' : '');
        } else if (tag === 'mock') {
          nowLine(['MOCK SCHEDULE 1', 'MOCK SCHEDULE 2', 'MOCK SCHEDULE 3', 'MOCK SCHEDULE 4', 'PRE CAS INTERVIEW']);
          const q = question('What happened?', [['set', 'Mock set for a day'], ['feedback', 'Feedback of a mock'], ['precas', 'Pre-CAS result'], ['none', 'Nothing to record']], (v) => {
            show([date.wrap, rem], v === 'set'); show([slot.wrap, fb.wrap], v === 'feedback'); show(res, v === 'precas');
          });
          const date = dateField('Mock interview on');
          const rem = el('label', 'p-check p-wide');
          const remind = el('input'); remind.type = 'checkbox'; remind.checked = true;
          rem.append(remind, el('span', '', 'Remind the team to write the feedback on that day'));
          form.append(rem);
          const said = /mock interview (\d)/i.exec(String(t.text || ''));
          const slot = field('Which mock', { kind: 'select', choices: [['1', 'Mock 1'], ['2', 'Mock 2'], ['3', 'Mock 3'], ['4', 'Mock 4']], value: said ? said[1] : String(state.nextFeedback || '') });
          const fb = field('Feedback', { kind: 'area', max: 1500, wide: true, placeholder: 'e.g. Confident; work on the finance answers.' });
          fb.input.rows = 3;
          form.append(slot.wrap, fb.wrap);
          const res = el('div', 'p-field p-wide');
          const result = picker([['Passed', 'Passed'], ['Fail', 'Fail']], '', (k) => `td-prio td-answer ans-${k}`, 'Pre-CAS result');
          res.append(el('span', 'p-label', 'Pre-CAS result'), result.node);
          form.append(res);
          show([date.wrap, rem, slot.wrap, fb.wrap, res], false);
          read = () => (q.value() === 'set' ? { mock: 'set', date: date.input.value, remind: remind.checked } : q.value() === 'feedback' ? { mock: 'feedback', slot: Number(slot.input.value), feedback: fb.input.value.trim() } : q.value() === 'precas' ? { mock: 'precas', result: result.value() } : {});
          check = () => (!q.value() ? 'Choose what happened.' : q.value() === 'set' && !date.input.value ? 'Choose the day of the mock interview.' : q.value() === 'feedback' && !slot.input.value ? 'Choose which mock.' : q.value() === 'feedback' && !fb.input.value.trim() ? 'Write the feedback.' : q.value() === 'precas' && !result.value() ? 'Choose Passed or Fail.' : '');
        } else if (tag === 'medical') {
          // The Medical Report as All Students has it: Pending, Booked (with the day) or Received (the owner, 18 Nov 2026). On the day of the
          // test ISR's own "is the report received?" task keeps its meaning: Pending there is "not received yet".
          nowLine(['MEDICAL REPORT']);
          const isCheck = Boolean(F().isReportCheck && F().isReportCheck(t));
          const q = question(F5 ? 'What happened' : 'Medical report', F5 ? [['booked', 'Medical booked'], ['received', 'Report received'], ['pending', 'Not yet']] : [['pending', 'Pending'], ['booked', 'Booked'], ['received', 'Received']], (v) => { show(date.wrap, v === 'booked'); });
          const date = field('Booked for', { kind: 'date', value: '', required: true });
          form.append(date.wrap);
          show(date.wrap, false);
          read = () => (q.value() === 'booked' ? { medical: 'booked', date: date.input.value } : q.value() === 'received' ? { medical: 'received' } : q.value() === 'pending' ? { medical: isCheck ? 'waiting' : 'pending' } : {});
          check = () => (!q.value() ? 'Choose Pending, Booked or Received.' : q.value() === 'booked' && !date.input.value ? 'Choose the day the medical is booked for.' : '');
        } else if (tag === 'payment') {
          nowLine(['PAYMENT DATE', 'TUITION FEE DEPOSIT(1st Installment)', 'TUITION FEE DEPOSIT(2nd Installment)', 'TUITION FEE DEPOSIT(3rd Installment)']);
          const q = question('Was a payment made?', [['yes', 'Yes, paid'], ['no', 'No']], (v) => show([date.wrap, amount.wrap], v === 'yes'));
          const date = dateField('Paid on', today);
          const amount = field('Amount paid', { max: 20, placeholder: 'e.g. 5000' });
          amount.input.inputMode = 'decimal';
          form.append(amount.wrap);
          show([date.wrap, amount.wrap], false);
          read = () => (q.value() === 'yes' ? { paid: true, date: date.input.value, amount: amount.input.value.trim() } : {});
          check = () => (!q.value() ? 'Choose Yes or No.' : q.value() === 'yes' && !date.input.value ? 'Choose the day it was paid.' : q.value() === 'yes' && !(Number(amount.input.value.replace(/[^\d.]/g, '')) > 0) ? 'Write the amount paid, in numbers.' : '');
        } else if (tag === 'visa') {
          nowLine(['CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE']);
          const q = question('Which step is done?', [['casRequested', 'CAS requested'], ['casReceived', 'CAS received'], ['lodged', 'Visa lodged'], ['vfs', 'VFS attended'], ['visa', 'Visa received'], ['refused', 'Visa refused'], ['none', 'Nothing to record']], (v) => show(date.wrap, v !== 'none'));
          const date = dateField('On', today);
          read = () => (q.value() && q.value() !== 'none' ? { step: q.value(), date: date.input.value } : {});
          check = () => (!q.value() ? 'Choose the step.' : q.value() !== 'none' && !date.input.value ? 'Choose the day.' : q.value() === 'refused' && words.input.value.trim().length < minNote ? 'Say why the visa was refused, in the note below.' : '');
        }
        // Few questions, then Save, for the other teams. The Application Team's window is always two steps with Check before saving (F5).
        const simple = !F5 && (Boolean(t.app || (state && (state.courseTask || state.offerTask))) || tag === 'noc' || tag === 'medical');
        if (F5 && asks) notesOptional = true;
        if (F5 && !simple && dlgHead && !stepNo) { stepNo = el('span', 'td-done-stepno', 'Step 1 of 2'); dlgHead.insertBefore(stepNo, dlgHead.querySelector('.p-x')); }
        // What was done: needed when the task records nothing else (the owner, 17 Nov 2026), so the next person knows.
        const minNote = (state && state.minNote) || 8;
        const words = field(asks ? 'What was done? (required unless you record something above)' : 'What was done?', { kind: 'area', max: 2000, wide: true, placeholder: tag === 'application' ? 'e.g. Application ID 12345.' : tag === 'noc' ? 'e.g. Documents uploaded.' : tag === 'medical' ? 'e.g. The student will bring the report on Monday.' : 'e.g. Sent the document checklist on WhatsApp.' });
        words.input.rows = 2; words.input.dataset.words = '1'; words.input.dataset.was = words.input.placeholder;
        form.append(words.wrap);
        if (simple || notesOptional) { const l = words.wrap.querySelector('.p-label'); l.replaceChildren(!F5 && (tag === 'noc' || tag === 'medical') ? 'Comments (optional)' : 'Notes (optional)'); words.input.placeholder = 'Anything the next person should know.'; }
        if (noNotes) words.wrap.hidden = true;
        // (No "when should someone get back" question: the owner removed it from every kind of task, 18 Nov 2026.)
        ask.append(msg);
        if (!noNotes && (asks || F5) && !simple) ask.append(el('p', 'p-muted p-small', 'Nothing is saved until you check it on the next step.'));
        const foot = el('div', 'p-dialog-foot');
        const next = h('button', { class: 'btn btn-primary', type: 'button' }, simple ? 'Save' : asks || F5 ? 'Next: check' : 'Yes, it is done');
        next.addEventListener('click', async () => {
          const problem = check();
          if (problem) { fail({ message: problem }); return; }
          const recorded = Object.keys(read()).length > 0;
          if (!recorded && words.input.value.trim().length < minNote) { fail({ message: 'Write in a few words what was done, so the next person knows.' }); words.input.focus(); return; }
          // The words the window supplies (an offer refused, an application closed) come first, then anything typed in Notes.
          const answers = { ...read(), note: [fallbackNote(), words.input.value.trim()].filter(Boolean).join(' ') };
          // The simple windows save at once: the few answers are already clear (no second check screen).
          if (simple) { answer = { ...answers, confirmed: true }; close(true); return; }
          if (!asks && !F5) { answer = answers; close(true); return; }
          next.disabled = true;
          try { const r = await api(url, { done: true, finish: answers, preview: true }); msg.textContent = ''; msg.className = 'p-msg'; review(r.preview, answers); } catch (e) { fail(e); }
          next.disabled = false;
        });
        foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Not yet'), next);
        ask.append(foot);
      }

      // Step 2: exactly what will be saved, from the server, to be confirmed.
      function review(p, answers) {
        sure.replaceChildren();
        sure.append(el('h3', 'td-check-title', 'Check before saving'));
        const block = (title, items, cls) => {
          if (!items.length) return;
          const b = el('div', `td-check-block ${cls || ''}`);
          b.append(el('span', 'p-label', title));
          const ul = el('ul', 'td-check-list');
          items.forEach((x) => ul.append(x.nodeType ? x : el('li', '', x)));
          b.append(ul);
          sure.append(b);
        };
        // The Application Team's check is drawn as F5 draws it (the owner, 24 Nov 2026): each line in two columns, what on the left and
        // the value on the right ("University of Greenwich (BSc Computing) ...... Applied on 23 Nov 2026").
        const F5look = Boolean(dlg && dlg.classList.contains('td-done-app'));
        const two = (left, right) => { const li = el('li', 'td-check-two'); li.append(el('span', 'td-check-l', left), el('span', 'td-check-r', right)); return li; };
        const split = (s, at) => { const i = at(s); return F5look && i > 0 ? two(s.slice(0, i), s.slice(i + 2)) : s; };
        block('Please look at this first', p.warnings, 'is-warn');
        block('Changes on All Students', p.changes.map((c) => {
          const li = el('li', `td-check-change${F5look ? ' td-check-two' : ''}`);
          const from = el('span', c.from === '(empty)' ? 'td-check-from is-empty' : 'td-check-from', c.from); const arrow = el('span', 'td-check-arrow', '→'); const to = el('span', 'td-check-to', c.to);
          if (F5look) { const r = el('span', 'td-check-r'); r.append(from, arrow, to); li.append(el('b', 'td-check-l', c.label), r); } else li.append(el('b', '', c.label), from, arrow, to);
          return li;
        }));
        block('University options', p.options.map((s) => split(s, (x) => x.lastIndexOf(': '))));
        block('A new task for the team', [...(p.remind ? [p.remind] : []), ...(p.offerTasks || [])]);
        block('Stays as it is', p.kept.map((s) => split(s, (x) => (/^(University|Course): /.test(x) ? x.indexOf(': ') : -1))), 'is-quiet');
        block('Note on the student', p.note ? [p.note + (p.remarks && !F5look ? ' (also shown in Remarks)' : '')] : []);
        if (!p.changes.length && !p.options.length && !p.remind) sure.append(el('p', 'p-muted', `Nothing changes on All Students. The task is marked done${p.note ? ' and the note is saved' : ''}.`));
        const foot = el('div', 'p-dialog-foot');
        const yes = h('button', { class: 'btn btn-primary', type: 'button' }, 'Yes, this is correct');
        yes.addEventListener('click', () => { answer = { ...answers, confirmed: true }; close(true); });
        foot.append(h('button', { class: 'btn', type: 'button', onclick: () => { sure.hidden = true; ask.hidden = false; if (stepNo) stepNo.textContent = 'Step 1 of 2'; } }, 'Back'), yes);
        sure.append(foot);
        ask.hidden = true;
        sure.hidden = false;
        if (stepNo) stepNo.textContent = 'Step 2 of 2';
        yes.focus();
      }
    }, { wide: tag === 'application' || tag === 'offer' }).then(() => answer);
  }
  // Reopening a task that recorded something (the owner, 16 Nov 2026): it says what the task recorded and offers to put it back, so a
  // wrong answer is corrected in one step. Resolves { revert: true }, {} (only reopen) or null (cancelled).
  function reopenDialog(t) {
    const w = t.wrote || {};
    const label = (c) => (root.CardFields && root.CardFields.columnLabel ? root.CardFields.columnLabel(c) : c);
    const lines = Object.entries(w.columns || {}).filter(([c]) => c !== 'REMARKS').map(([c, [from, to]]) => `${label(c)}: ${to ? day(to) : '(empty)'} (was ${from ? day(from) : 'empty'})`);
    if ((w.options || []).length) lines.push(`University options: ${w.options.length} line${w.options.length === 1 ? '' : 's'}`);
    if (w.remind) lines.push('The task it gave the team');
    if (!lines.length) return root.NiecUI.confirm('Reopen this task? It goes back to the team as not done.', { confirmText: 'Reopen' }).then((ok) => (ok ? {} : null));
    let out = null;
    return dialog('Reopen this task?', (body, close) => {
      body.append(el('p', '', 'When it was marked done, it recorded:'));
      const ul = el('ul', 'td-check-list');
      lines.forEach((x) => ul.append(el('li', '', x)));
      body.append(ul, el('p', 'p-muted p-small', 'Put it back if the answer was wrong. Anything changed by hand since stays as it is.'));
      const foot = el('div', 'p-dialog-foot');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', onclick: () => { out = {}; close(); } }, 'Only reopen'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { out = { revert: true }; close(); } }, 'Reopen and put it back'));
      body.append(foot);
    }).then(() => out);
  }
  // One task, the same on Today and on the student card (the owner, 15 Nov 2026: "as Apple would make it"): a round tick; the task
  // in semibold; beside it, on the right, its updates (a speech bubble with how many, a red count when something is new) and "...";
  // under it one grey line with the tag, the student and the stage; then who gave it to whom and
  // when, in small grey type. The updates open under the task.
  //   o: { rowId, me, teams, mayTick, tickTitle, canWrite, canChange, unread, stage, student: { name, href } | null, fromName,
  //        toName, actions: [[label, onClick, danger]], onTick: async (done) => {}, onChanged }
  // What to do, said plainly (the owner, 20 Nov 2026: the Offer request and Application tasks were confusing): an Offer request reads
  // "Ask for the offer letter" with the university and course under it; an Application task "Submit the application" with the
  // university, intake, level, location and course as small chips, then the comments of whoever gave it.
  function taskText(t) {
    const box = el('div', 'td-task-text');
    // An Offer request carries the application it chases (offerFor, from 21 Nov 2026); an older one is read from its words.
    const offer = t.offerFor && t.offerFor.university ? [null, t.offerFor.university, t.offerFor.course || ''] : /^Offer request: has the student received the offer letter from (.+?)(?: \((.+)\))?\?$/.exec(String(t.text || ''));
    if (offer) {
      box.classList.add('is-structured');
      box.append(el('b', 'td-task-title', 'Ask for the offer letter'));
      const what = el('div', 'td-task-chips'); what.append(el('span', 'is-uni', offer[1])); if (offer[2]) what.append(el('span', '', offer[2]));
      box.append(what);
      return box;
    }
    if (t.app) {
      box.classList.add('is-structured');
      box.append(el('b', 'td-task-title', 'Submit the application'));
      const what = el('div', 'td-task-chips');
      what.append(el('span', 'is-uni', t.app.university));
      [t.app.course, t.app.level, t.app.intake, t.app.location].filter(Boolean).forEach((x) => what.append(el('span', '', x)));
      box.append(what);
      const extra = String(t.text || '').split('\n').slice(1).join(' ').trim();
      if (extra) box.append(el('p', 'td-task-note', extra));
      return box;
    }
    box.textContent = t.text;
    return box;
  }
  function taskCard(t, o) {
    const r = el('div', `td-task${t.done ? ' is-done' : ''}${o.unread ? ' has-unread' : ''}`);
    r.dataset.taskId = t.id;
    const tick = h('button', { class: 'td-check', type: 'button', 'aria-pressed': String(t.done), title: o.mayTick ? (t.done ? 'Mark as not done' : 'Mark as done') : (o.tickTitle || ''), 'aria-label': t.done ? 'Mark as not done' : 'Mark as done', disabled: !o.mayTick });
    tick.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    tick.addEventListener('click', async () => {
      // Done is asked once more (the owner, 15 Nov 2026), so a task is never ticked by a slip of the mouse; the same window asks what
      // the task's tag needs (doneDialog) and the answers go with the tick, so the team writes them once.
      let finish = null;
      if (!t.done && root.NiecUI) {
        finish = await doneDialog(t, o);
        if (!finish) return;
      } else if (t.done && t.wrote && root.NiecUI) {
        finish = await reopenDialog(t);
        if (!finish) return;
      }
      tick.disabled = true;
      // The circle turns blue with a tick and the row folds away, and only then is the list redrawn (the next task never jumps).
      const quick = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!t.done) { r.classList.add('is-ticking'); celebrate(tick); }
      const folded = new Promise((ok) => setTimeout(ok, t.done || quick ? 0 : 520));
      try { await o.onTick(!t.done, folded, finish); } catch (e) { r.classList.remove('is-ticking'); tick.disabled = false; }
    });
    const mid = el('div', 'td-task-mid');
    const top = el('div', 'td-task-top');
    // The student first, then what to do (the owner, 15 Nov 2026): the team sees at once whose task it is, with the student's
    // name in bold and the stage on top, and the task under it in a calmer weight. On the student's own card the task stands alone.
    const head = el('div', 'td-head-main');
    if (o.student) {
      const who = el('div', 'td-who');
      const name = h('a', { class: 'td-who-name', href: o.student.href, title: 'Open the student card' }, niceName(o.student.name));
      if (o.unread) { const dot = el('span', 'td-new-dot'); dot.title = 'Something new'; who.append(dot); }
      who.append(name);
      if (o.stage) who.append(el('span', 'td-who-stage', o.stage));
      head.append(who);
      r.classList.add('has-student');
    }
    head.append(taskText(t));
    top.append(head);
    const side = el('div', 'td-side');
    top.append(side);
    // One quiet line under the task (the owner, 15 Nov 2026: the tasks looked overwhelming): the day it waits for and the tag, then
    // who gave it to whom and when. Everything else stays out of sight until it is asked for.
    const sub = el('div', 'td-sub td-meta');
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
    sub.append(route);
    // The updates fold away behind one button at the task's top right ("2 updates", "Add an update", a red "N new"); what is new opens
    // by itself. While folded, the latest update shows as one grey line, so the task still says where it stands.
    const always = !t.done && Boolean(o.canWrite);
    const thread = taskThread(t, { rowId: o.rowId, me: o.me, canWrite: o.canWrite && !t.done, unread: o.unread || 0, teams: o.teams, today: o.today, always });
    const toggle = always ? null : thread.querySelector('.tk-toggle');
    if (toggle) side.append(toggle);
    else if (o.unread && thread.badge) side.append(thread.badge);
    const menu = taskMenu(o.actions || []);
    if (menu) side.append(menu);
    mid.append(top, sub);
    const all = Array.isArray(t.comments) ? t.comments : [];
    const last = all[all.length - 1];
    if (last && last.text && toggle) {
      const peek = h('button', { class: 'td-last', type: 'button', title: 'Open the updates' });
      peek.append(el('b', '', last.by === o.me ? 'You' : (last.by || 'Someone')), el('span', '', last.text));
      peek.addEventListener('click', () => toggle.click());
      mid.append(peek);
    }
    mid.append(thread);
    r.append(tick, mid);
    // From a notification: open the updates and mark the task read.
    r.openThread = () => { if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click(); else thread.markRead(); if (thread.badge && always) thread.badge.hidden = true; };
    // Read only when the person opens its updates, writes one, or presses its notification: never by touching or scrolling past the
    // task (on a phone that cleared the notifications before anyone had read them).
    return r;
  }

  // ---- what a task is about, and the order the tasks are listed in ----
  const F = () => root.CardFields || {};
  const TAGS = () => (F().TASK_TAGS || [['other', 'Other']]);
  const tagOf = (task, stage) => (F().taskTag ? F().taskTag(task, stage) : (task.tag || 'other'));
  const tagLabel = (id) => (TAGS().find(([k]) => k === id) || [id, 'Other'])[1];
  // The order of a list: a task with something new on it first, then the one waiting longest (no priorities, the owner, 15 Nov 2026).
  // The order of tasks everywhere (the owner, 17 Nov 2026): the oldest first and the newest last, like the Application Team's list, for
  // every account. Something new on a task shows as its blue dot; it no longer moves the task up the list.
  function taskPriority(t) {
    return 1e12 - 1 - Math.min(1e12 - 1, Date.parse(t.at || 0) / 1000 || 0);
  }

  // The tag as a small pill; whoever may change it presses it to choose again.
  function taskBadges(task, { rowId, stage, canChange, onChanged }) {
    const line = el('div', 'td-tag-line');
    const tag = tagOf(task, stage);
    const open = (e) => { e.stopPropagation(); changeTask(task, { rowId, tag }).then((done) => { if (done && onChanged) onChanged(); }); };
    const pill = (cls, text) => { const b = h('button', { class: cls, type: 'button', disabled: !canChange, title: canChange ? 'Change the tag' : '' }, text); if (canChange) b.addEventListener('click', open); return b; };
    line.append(pill(`td-tag tag-${tag}`, tagLabel(tag)));
    return line;
  }
  // Edit a task after it was given (the owner, 15 Nov 2026): its words, how important it is and what it is about. The team to do it is
  // changed with Reassign. Resolves true once saved.
  function editTask(task, { rowId, stage }) {
    return dialog('Edit the task', (body, close) => {
      const words = field('What should they do?', { kind: 'area', max: 2000, wide: true, value: task.text });
      words.input.rows = 3;
      // The tag is chosen by hand here too (the owner, 15 Nov 2026); an older task with none shows the one it was shown with.
      const tg = tagPicker(tagOf(task, stage));
      const field2 = (label, ...nodes) => { const w = el('div', 'p-field p-wide'); w.append(el('span', 'p-label', label), ...nodes); return w; };
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save changes');
      ok.addEventListener('click', async () => {
        if (!words.input.value.trim()) { msg.textContent = 'Write what should be done.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { text: words.input.value, tag: tg.value() }); close(true); } catch (err) { msg.textContent = err.message; msg.className = 'p-msg error'; ok.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form'); g.append(words.wrap, field2('What is it about?', tg.node));
      body.append(g, el('p', 'p-muted p-small', 'The team is told it was edited.'), msg, foot);
      setTimeout(() => { words.input.focus(); words.input.setSelectionRange(words.input.value.length, words.input.value.length); }, 0);
    });
  }
  // Move a task to another day (the team it is with, whoever gave it, Admin, the Manager): only the calendar, the day is picked there
  // (the owner, 15 Nov 2026). A task moved earlier can be brought back to today. Resolves true once moved.
  function scheduleTask(task, { rowId, today }) {
    const add = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const moved = task.doOn && task.doOn > today;
    return dialog('Reschedule', (body, close) => {
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
      body.append(el('p', 'p-muted p-small', 'It comes back to Today on that day.'), g, msg, foot);
    });
  }
  function changeTask(task, { rowId, tag }) {
    return dialog('Change the tag', (body, close) => {
      const tg = tagPicker(tag);
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try { await api(`/api/cards/${encodeURIComponent(rowId)}/tasks/${task.id}`, { tag: tg.value() }); close(true); } catch (err) { ok.disabled = false; if (root.NiecUI) root.NiecUI.toast(err.message, { type: 'error' }); }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      body.append(tg.node, foot);
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
  // Only the tags still offered (card-fields.js TASK_TAGS_CHOOSABLE); a task that already has an older tag (Payment ...) keeps it offered.
  const tagPicker = (initial) => {
    const start = initial === undefined ? 'other' : initial;
    const offered = F().TASK_TAGS_CHOOSABLE || TAGS();
    const choices = start && !offered.some(([k]) => k === start) ? [...offered, ...TAGS().filter(([k]) => k === start)] : offered;
    return picker(choices, start, (k) => `td-tag tag-${k}`, 'What the task is about');
  };
  // A few words of thanks when a task is ticked, not the same line every time.
  const CHEERS = ['Done. Nice work.', 'Ticked off. Well done.', 'One less to think about.', 'Great job, that is done.', 'Done. The student is a step closer.', 'Nicely done.'];
  const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
  // A small, happy burst of soft coloured dots from where a task was ticked (nothing moves for people who ask for less motion).
  function celebrate(from) {
    if (!from || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const r = window.isrPos ? window.isrPos.rect(from) : from.getBoundingClientRect(); // page pixels, whatever the Text size
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
  // WhatsApp a student (the owner, 17 Nov 2026): on a computer with the person's phone connected, the phone gets a notification and
  // one tap opens the chat there; otherwise WhatsApp opens on this device (see phone-link.js). `number`: digits with the country
  // code, as card-fields.js whatsappNumber gives it; `text`: the message to start with (Follow-up); `id`: the student's row.
  function whatsapp(number, name, text, id) {
    if (root.PhoneLink) { root.PhoneLink.openChat({ id, number, name, text }); return; }
    window.open(`https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
  }
  root.Portal = { requiredMark, doneDialog, whatsapp, niceName, reopenDialog, taskThread, taskRoute, handOn, editTask, scheduleTask, dayLabel, taskMenu, taskCard, taskBadges, tagPicker, taskPriority, tagOf, tagLabel, celebrate, cheer, el, h, api, day, when, stageKind, stagePill, initials, number, rupees, percent, field, datalist, dialog };
})(this);
