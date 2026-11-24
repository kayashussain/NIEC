// Bookings (the owner, 22 Nov 2026; mock-bookings.js and mock-team-api.js on the server): the Mock Team's booking link and mocks.
//
//   Upcoming          the booking link to copy, the mocks booked to come (time, student, University, course, which mock, Join in
//                     Teams), the students ready for the final interview and the students whose next mock is not booked yet.
//   Available slots   how long a mock lasts, the weekly slots (copied from one day to others), slots for one date (or a day off) and
//                     the booking rules.
//   Setup             the person's own Microsoft Teams meeting link, the booking link's name, the name students see and the email
//                     their calendar invites go to.
//
// When a mock's time is over, a banner at the top says so (every time Bookings is opened, until answered) and its Answer button opens the window
// that asks: did the student join? (The window no longer opens by itself, the owner, 24 Nov 2026; the Answer button on Today opens it with #answer.) If yes, the feedback
// and the result are required, and they are written to the student's card (MOCK SCHEDULE n and FEEDBACK n) by the server.
(function () {
  const { el, h, api, dialog, requiredMark } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const toast = (t, type = 'success') => window.NiecUI.toast(t, { type });
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MINUTES = [15, 20, 30, 45, 60, 90];
  const AHEAD = [[1, '1 day'], [2, '2 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']];
  const NOTICE = [[60, '1 hour before'], [120, '2 hours before'], [240, '4 hours before'], [1440, '1 day before']];
  let data = null;
  const hash0 = (location.hash || '').replace('#', '');
  let tab = hash0 && hash0 !== 'answer' ? hash0 : 'upcoming';
  let openAnswer = hash0 === 'answer'; // the Answer button on Today comes here and opens the window at once

  const linkOf = (p) => (p && p.slug ? `${location.origin}/book/${p.slug}` : '');
  const niceTime = (t) => { const [hh, mm] = String(t).split(':').map(Number); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

  function drawTabs() {
    const tabs = $('tabs');
    tabs.replaceChildren();
    const list = data.access === 'view' ? [['upcoming', 'Upcoming']] : [['upcoming', 'Upcoming'], ['slots', 'Available slots'], ['setup', 'Setup']];
    if (!list.some(([k]) => k === tab)) tab = 'upcoming';
    list.forEach(([k, label]) => {
      tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; history.replaceState(null, '', `#${k}`); draw(); } }, label));
    });
  }

  function draw() {
    drawTabs();
    const view = $('view');
    const body = tab === 'slots' ? slotsView() : tab === 'setup' ? setupView() : upcomingView();
    const banner = waitingBanner();
    view.replaceChildren(...(banner ? [banner, body] : [body]));
    if (openAnswer && data.waiting.length) { openAnswer = false; history.replaceState(null, '', `#${tab}`); askNext(0); }
  }
  // Mocks that have ended and are not answered: said once, calmly, at the top; the window opens only when the person presses Answer.
  function waitingBanner() {
    if (data.access === 'view' || !data.waiting.length) return null;
    const n = data.waiting.length;
    const words = n === 1 ? `Your mock with ${data.waiting[0].name} has ended. Did the student join?` : `${n} mocks have ended. Did the students join?`;
    return h('section', { class: 'mt-banner', role: 'status' }, el('span', 'mt-banner-dot'), el('span', 'mt-banner-words', words),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => askNext(0) }, 'Answer'));
  }

  // ---- Upcoming ----
  function linkBar() {
    const me = data.me;
    const bar = el('section', 'p-card mt-linkbar');
    if (data.access === 'view') return null;
    if (!me.setUp) {
      bar.append(el('span', 'mt-linkbar-title', 'My booking link'), el('span', 'mt-linkbar-missing', 'Set up your Teams link and your booking link first.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { tab = 'setup'; draw(); } }, 'Set up'));
      return bar;
    }
    const box = h('input', { class: 'p-input mt-linkbox', readonly: true, value: linkOf(me), 'aria-label': 'My booking link' });
    const copy = h('button', { type: 'button', class: 'btn btn-primary' }, 'Copy link');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkOf(me)); } catch (e) { box.select(); document.execCommand('copy'); }
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy link'; }, 1600);
    });
    bar.append(el('span', 'mt-linkbar-title', 'My booking link'), box, copy,
      el('span', 'mt-linkbar-note', `Teams link set | ${me.minutes || 30} min mocks`));
    return bar;
  }

  // A calm monogram (the first letters of the name) so a row is found by eye. Decoration only: the name is always written too.
  const monogram = (name) => {
    const m = el('span', 'mt-av', String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');
    m.setAttribute('aria-hidden', 'true');
    return m;
  };

  function upcomingView() {
    const wrap = el('div', 'mt-upcoming');
    const bar = linkBar();
    if (bar) wrap.append(bar);
    if (!data.mailReady && data.access !== 'view') wrap.append(el('p', 'mt-note', 'Emails to students are off until Admin sets up the consultancy\'s mailbox. Bookings still work, and each booking shows here.'));
    const grid = el('div', 'mt-grid');
    // The mocks to come.
    const card = el('section', 'p-card mt-upcoming-card');
    card.append(el('h2', '', 'Upcoming mocks'));
    if (!data.upcoming.length) card.append(el('p', 'mt-empty', data.me.setUp ? 'No mock is booked yet. Copy your link and send it to a student.' : 'No mock is booked yet.'));
    else {
      const withOwner = data.access !== 'own';
      const table = el('table', 'mt-table');
      const head = h('tr', {}, h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Student, University and course'),
        h('th', { scope: 'col' }, 'Mock'), ...(withOwner ? [h('th', { scope: 'col' }, 'With')] : []), h('th', { scope: 'col' }, h('span', { class: 'p-offscreen' }, 'Join')));
      table.append(h('thead', {}, head));
      const body = el('tbody');
      let lastDay = '';
      const firstNext = data.upcoming[0] && data.upcoming[0].day === new Date().toLocaleDateString('en-CA') ? data.upcoming[0].id : ''; // the one blue button: the next mock, only on the day it is held
      data.upcoming.forEach((b) => {
        if (b.day !== lastDay) {
          lastDay = b.day;
          body.append(h('tr', { class: 'mt-day' }, h('th', { colspan: String(withOwner ? 5 : 4), scope: 'colgroup' }, b.dayLabel)));
        }
        const join = b.teams ? h('a', { class: `btn ${b.id === firstNext ? 'btn-primary' : ''} mt-join`, href: b.teams, target: '_blank', rel: 'noopener' }, 'Join in Teams') : el('span', 'mt-muted', 'No Teams link');
        const actions = h('td', { class: 'mt-actions' }, join);
        if (data.access !== 'view') {
          actions.append(h('button', { type: 'button', class: 'p-link mt-cancel', onclick: () => cancel(b) }, 'Cancel'));
        }
        body.append(h('tr', {},
          h('td', { class: 'mt-time' }, niceTime(b.time)),
          h('td', { class: 'mt-who' }, monogram(b.name), h('div', { class: 'mt-who-words' }, b.rowId ? h('a', { href: `/student?id=${encodeURIComponent(b.rowId)}` }, b.name) : el('span', '', b.name),
            b.rowId ? el('small', 'mt-sub', [b.university, b.course].filter(Boolean).join(' | ') || 'No University yet') : el('small', 'mt-unmatched', 'Not matched to a student yet'))),
          h('td', { class: 'mt-nowrap' }, b.mock ? `Mock ${b.mock} of 4` : '-'),
          ...(withOwner ? [h('td', {}, b.owner || '-')] : []),
          actions));
      });
      table.append(body);
      card.append(h('div', { class: 'mt-table-wrap' }, table));
    }
    grid.append(card);
    // Ready for the final interview, and the next mock to book.
    const side = el('div', 'mt-side');
    side.append(listCard('Ready for the final interview', 'Their last mock said "Ready". Next: the University\'s Pre-CAS interview.', data.ready,
      (s) => `${s.university || 'No University yet'}${s.course ? ` | ${s.course}` : ''} | ${s.held} mock${s.held === 1 ? '' : 's'}`, 'Nobody yet.'));
    side.append(listCard('Next mock to book', 'Their last mock said "Needs another mock", or they did not join, and nothing is booked yet. Copy your link and send it.', data.next,
      (s) => `${s.nextMock ? `Mock ${s.nextMock} next${s.nextMock === 4 ? ' (the last)' : ''}` : ''}${s.noShow ? ' | did not join last time' : ''} | ${s.university || 'No University yet'}${s.course ? ` | ${s.course}` : ''}`, 'Nobody is waiting.'));
    grid.append(side);
    wrap.append(grid);
    return wrap;
  }
  function listCard(title, hint, list, sub, empty) {
    const card = el('section', 'p-card mt-list');
    const head = el('div', 'mt-list-head');
    head.append(el('h2', '', title));
    if (list.length) head.append(el('span', 'mt-count', String(list.length)));
    card.append(head, el('p', 'mt-hint', hint));
    if (!list.length) card.append(el('p', 'mt-empty', empty));
    list.forEach((s) => {
      card.append(h('div', { class: 'mt-person' }, monogram(s.name), h('div', { class: 'mt-person-words' }, h('a', { href: `/student?id=${encodeURIComponent(s.rowId)}` }, s.name), el('span', '', sub(s)))));
    });
    return card;
  }
  async function cancel(b) {
    if (!(await window.NiecUI.confirm(`Cancel the mock with ${b.name} on ${b.dayLabel} at ${niceTime(b.time)}? The student is told by email.`, { danger: true, confirmText: 'Cancel the mock', cancelText: 'Keep it' }))) return;
    try { data = await api(`/api/bookings/${b.id}/cancel`, {}); toast('Cancelled. The student is told.'); draw(); } catch (e) { toast(e.message, 'error'); }
  }

  // ---- the window after a mock ----
  function askNext(i) {
    const b = data.waiting[i];
    if (!b) return;
    const total = data.waiting.length;
    dialog(`Mock${b.mock ? ` ${b.mock}` : ''} with ${b.name} has ended`, (body, close) => {
      body.classList.add('mt-ask');
      if (total > 1) body.append(el('p', 'mt-hint', `${i + 1} of ${total} mocks waiting for an answer`));
      body.append(el('p', 'mt-ask-when', [`${b.dayLabel}, ${niceTime(b.time)}`, b.university, b.course].filter(Boolean).join(' | ')));
      let joined = null; let result = null;
      const seg = (label, choices, onPick) => {
        const box = el('div', 'mt-ask-row');
        const lab = el('span', 'mt-ask-label', label);
        lab.append(requiredMark());
        const group = h('div', { class: 'mt-seg', role: 'radiogroup', 'aria-label': label });
        const buttons = choices.map(([v, words]) => {
          const btn = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, words);
          btn.addEventListener('click', () => { buttons.forEach((x) => x.setAttribute('aria-checked', String(x === btn))); onPick(v); });
          return btn;
        });
        group.append(...buttons);
        box.append(lab, group);
        return box;
      };
      const more = el('div', 'mt-ask-more');
      more.hidden = true;
      const fbLabel = el('label', 'mt-ask-label', 'Feedback');
      fbLabel.append(requiredMark());
      const fb = h('textarea', { class: 'p-input mt-ask-text', rows: '5', maxlength: '2000', id: 'mtFeedback' });
      fbLabel.htmlFor = 'mtFeedback';
      let pick = null;
      if (!b.rowId) {
        const lab = el('label', 'mt-ask-label', 'Which student was it?');
        lab.append(requiredMark());
        pick = h('select', { class: 'p-input', id: 'mtWho' }, h('option', { value: '' }, 'Choose the student'), ...data.students.map((s) => h('option', { value: s.id }, s.name)));
        lab.htmlFor = 'mtWho';
        more.append(lab, pick);
      }
      more.append(fbLabel, fb, seg('Result', [['ready', 'Ready for the final interview'], ['again', 'Needs another mock']], (v) => { result = v; }));
      more.append(el('p', 'mt-ask-note', `Saved on the student's card by itself: the day in Mock Schedule ${b.mock || 'n'} and this feedback in Feedback ${b.mock || 'n'}.`));
      const no = el('p', 'mt-ask-note', 'No feedback is asked. The student goes to "Next mock to book".');
      no.hidden = true;
      body.append(seg('Did the student join the mock?', [[true, 'Yes, joined'], [false, 'No, did not join']], (v) => { joined = v; more.hidden = !v; no.hidden = v; }), more, no);
      const err = el('p', 'p-msg error');
      const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
      const later = h('button', { type: 'button', class: 'btn' }, 'Later');
      later.addEventListener('click', () => close());
      save.addEventListener('click', async () => {
        err.textContent = '';
        if (joined === null) { err.textContent = 'Say whether the student joined.'; return; }
        body.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
        if (joined && pick && !pick.value) { err.textContent = 'Choose the student this mock was with.'; pick.setAttribute('aria-invalid', 'true'); pick.focus(); return; }
        if (joined && !fb.value.trim()) { err.textContent = 'Write the feedback.'; fb.setAttribute('aria-invalid', 'true'); fb.focus(); return; }
        if (joined && !result) { err.textContent = 'Choose the result.'; return; }
        save.disabled = true; save.textContent = 'Saving…';
        body.closest('dialog').dataset.busy = '1';
        try {
          data = await api(`/api/bookings/${b.id}/answer`, { joined, feedback: fb.value, result, rowId: pick ? pick.value : '' });
          delete body.closest('dialog').dataset.busy;
          close('saved');
        } catch (e) {
          delete body.closest('dialog').dataset.busy;
          save.disabled = false; save.textContent = 'Save';
          err.textContent = e.message;
          if (/already answered|was cancelled/i.test(e.message)) setTimeout(() => close('stale'), 1400); // answered in another tab: show the page as it is now
        }
      });
      body.addEventListener('input', (e) => { err.textContent = ''; if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid'); });
      body.addEventListener('click', (e) => { if (e.target.closest('.mt-seg button')) err.textContent = ''; });
      body.append(err, h('div', { class: 'p-bar mt-ask-bar' }, later, save));
    }).then((r) => {
      if (r === 'saved') { toast('Saved on the student\'s card.'); draw(); askNext(0); }
      else if (r === 'stale') { api('/api/bookings').then((d) => { data = d; draw(); if (data.waiting[0]) askNext(0); }).catch(() => {}); }
      else if (data.waiting[i + 1]) askNext(i + 1);
    });
  }

  // ---- Available slots ----
  function slotsView() {
    const me = data.me;
    const weekly = {};
    for (let d = 0; d < 7; d += 1) weekly[d] = ((me.weekly || {})[String(d)] || []).map((w) => [...w]);
    const dates = Object.fromEntries(Object.entries(me.dates || {}).map(([k, v]) => [k, v.map((w) => [...w])]));
    const state = { minutes: me.minutes || 30, ahead: me.ahead || 30, notice: me.notice || 60 };
    const wrap = el('div', 'mt-slots');
    const top = el('div', 'mt-slots-top');
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
    top.append(el('p', 'mt-hint', 'Students see only the slots that are still free, in your booking link.'), save);
    wrap.append(top);
    const grid = el('div', 'mt-grid');
    // Weekly slots.
    const week = el('section', 'p-card mt-week');
    const len = h('select', { class: 'p-input', id: 'mtLength', onchange: (e) => { state.minutes = Number(e.target.value); } }, ...MINUTES.map((m) => h('option', { value: String(m), ...(m === state.minutes ? { selected: true } : {}) }, `${m} min`)));
    const lenLabel = h('label', { class: 'mt-inline', for: 'mtLength' }, 'Each mock lasts', len);
    week.append(h('div', { class: 'mt-list-head' }, el('h2', '', 'Weekly slots'), lenLabel), el('p', 'mt-hint', 'Add as many slots in a day as you like. Copy a day to other days, or give each day its own slots.'));
    const rows = el('div', 'mt-days');
    const drawDays = () => {
      rows.replaceChildren();
      for (let d = 0; d < 7; d += 1) rows.append(dayRow(DAYS[d], weekly[d], drawDays, (targets) => { targets.forEach((t) => { weekly[t] = weekly[d].map((w) => [...w]); }); drawDays(); }, d));
    };
    drawDays();
    week.append(rows);
    grid.append(week);
    // One date, and the rules.
    const side = el('div', 'mt-side');
    const one = el('section', 'p-card mt-list');
    one.append(el('h2', '', 'Slots for one date'), el('p', 'mt-hint', 'Different slots on one date, or a day off. That date uses these instead of the weekly slots.'));
    const dateRows = el('div', 'mt-days');
    const drawDates = () => {
      dateRows.replaceChildren();
      Object.keys(dates).sort().forEach((day) => {
        const label = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        const row = dayRow(label, dates[day], drawDates, null, null, () => { delete dates[day]; drawDates(); });
        dateRows.append(row);
      });
      if (!Object.keys(dates).length) dateRows.append(el('p', 'mt-empty', 'No date of its own yet.'));
    };
    drawDates();
    const pickDay = h('input', { type: 'date', class: 'p-input', 'aria-label': 'The date', min: new Date().toLocaleDateString('en-CA') });
    const add = h('button', { type: 'button', class: 'btn' }, 'Add the date');
    add.addEventListener('click', () => { if (!pickDay.value) { pickDay.focus(); return; } if (!dates[pickDay.value]) dates[pickDay.value] = []; pickDay.value = ''; drawDates(); });
    one.append(dateRows, h('div', { class: 'mt-add-date' }, pickDay, add));
    const rules = el('section', 'p-card mt-list');
    const ahead = h('select', { class: 'p-input', id: 'mtAhead', onchange: (e) => { state.ahead = Number(e.target.value); } }, ...AHEAD.map(([v, l]) => h('option', { value: String(v), ...(v === state.ahead ? { selected: true } : {}) }, l)));
    const notice = h('select', { class: 'p-input', id: 'mtNotice', onchange: (e) => { state.notice = Number(e.target.value); } }, ...NOTICE.map(([v, l]) => h('option', { value: String(v), ...(v === state.notice ? { selected: true } : {}) }, l)));
    rules.append(el('h2', '', 'Booking rules'),
      h('label', { class: 'mt-rule', for: 'mtAhead' }, el('span', '', 'How far ahead students can book'), ahead),
      h('label', { class: 'mt-rule', for: 'mtNotice' }, el('span', '', 'Last time to book, change or cancel, before the mock'), notice),
      el('p', 'mt-hint', 'A slot that is booked disappears for everyone else.'));
    side.append(one, rules);
    grid.append(side);
    wrap.append(grid);
    save.addEventListener('click', async () => {
      const pack = (list) => list.filter((w) => w[0] && w[1]);
      const body = { minutes: state.minutes, ahead: state.ahead, notice: state.notice,
        weekly: Object.fromEntries(Object.entries(weekly).map(([k, v]) => [k, pack(v)])), dates: Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, pack(v)])) };
      save.disabled = true; save.textContent = 'Saving…';
      try { data = await api('/api/bookings/slots', body); save.textContent = 'Saved'; toast('Your slots are saved.'); setTimeout(() => draw(), 700); }
      catch (e) { save.disabled = false; save.textContent = 'Save'; toast(e.message, 'error'); }
    });
    return wrap;
  }
  // One day's slots: each a start and an end, + to add one, a copy button (weekly) or a remove button (one date).
  function dayRow(label, list, redraw, copyTo, dayIndex, removeDate) {
    const row = el('div', 'mt-day-row');
    row.append(el('span', 'mt-day-name', label));
    const slots = el('div', 'mt-day-slots');
    if (!list.length) slots.append(el('span', 'mt-muted', removeDate ? 'Day off' : 'Not free'));
    list.forEach((w, i) => {
      const a = h('input', { type: 'time', class: 'p-input', value: w[0], step: '300', 'aria-label': `${label}, slot ${i + 1} starts` });
      const z = h('input', { type: 'time', class: 'p-input', value: w[1], step: '300', 'aria-label': `${label}, slot ${i + 1} ends` });
      a.addEventListener('change', () => { w[0] = a.value; });
      z.addEventListener('change', () => { w[1] = z.value; });
      const x = h('button', { type: 'button', class: 'mt-x', 'aria-label': `Remove this slot on ${label}`, onclick: () => { list.splice(i, 1); redraw(); } }, '×');
      slots.append(h('span', { class: 'mt-slot' }, a, el('span', 'mt-to', 'to'), z, x));
    });
    const tools = el('div', 'mt-day-tools');
    tools.append(h('button', { type: 'button', class: 'mt-tool', 'aria-label': `Add a slot on ${label}`, title: 'Add a slot', onclick: () => {
      const last = list[list.length - 1];
      const start = last ? last[1] : '10:00';
      const [hh, mm] = start.split(':').map(Number);
      const endMin = Math.min(23 * 60 + 59, hh * 60 + mm + 30); // never past midnight
      const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      list.push([start, end]);
      redraw();
    } }, '+'));
    if (copyTo) {
      const copy = h('button', { type: 'button', class: 'mt-tool', 'aria-label': `Copy ${label}'s slots to other days`, title: 'Copy to other days', 'aria-haspopup': 'true' });
      copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>';
      copy.addEventListener('click', () => copyMenu(copy, label, dayIndex, copyTo));
      tools.append(copy);
    }
    if (removeDate) tools.append(h('button', { type: 'button', class: 'mt-tool', 'aria-label': `Remove ${label}`, title: 'Remove this date', onclick: removeDate }, '×'));
    row.append(slots, tools);
    return row;
  }
  function copyMenu(anchor, label, from, done) {
    document.querySelectorAll('.mt-copy-menu').forEach((m) => m.remove());
    const menu = el('div', 'mt-copy-menu');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', `Copy ${label}'s slots`);
    menu.append(el('small', '', `Copy ${label}'s slots to`));
    const boxes = DAYS.map((d, i) => (i === from ? null : h('input', { type: 'checkbox', value: String(i) }))).filter(Boolean);
    boxes.forEach((b) => menu.append(h('label', { class: 'mt-check' }, b, DAYS[Number(b.value)])));
    const go = h('button', { type: 'button', class: 'btn btn-primary' }, 'Copy');
    go.addEventListener('click', () => { const t = boxes.filter((b) => b.checked).map((b) => Number(b.value)); menu.remove(); if (t.length) done(t); });
    menu.append(go);
    document.body.append(menu);
    const r = window.isrPos.rect(anchor);
    menu.style.left = `${Math.max(8, Math.min(r.right - 240, window.isrPos.width() - 248))}px`;
    menu.style.top = `${r.bottom + 6}px`;
    const away = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', away); } };
    setTimeout(() => document.addEventListener('mousedown', away), 0);
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.remove(); anchor.focus(); } });
    if (boxes[0]) boxes[0].focus();
  }

  // ---- Setup ----
  function setupView() {
    const me = data.me;
    const card = el('section', 'p-card mt-setup');
    card.append(el('h2', '', 'Set up once, then share your link'),
      el('p', 'mt-hint', 'No Microsoft 365 administrator and no company email are needed: a Gmail address is fine.'));
    const step = (n, done, title, ...body) => h('div', { class: 'mt-step' }, h('span', { class: `mt-step-n${done ? ' is-done' : ''}`, 'aria-hidden': 'true' }, done ? '✓' : String(n)), h('div', { class: 'mt-step-body' }, el('h3', '', title), ...body));
    const teams = h('input', { class: 'p-input', id: 'mtTeams', value: me.teams || '', placeholder: 'https://teams.live.com/meet/...', maxlength: '1000' });
    const slug = h('input', { class: 'p-input', id: 'mtSlug', value: me.slug || String(me.name || '').split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'), maxlength: '40' });
    const shown = h('input', { class: 'p-input', id: 'mtShown', value: me.shown || `${String(me.name || '').split(/\s+/)[0]}, Mock Team`, maxlength: '80' });
    const email = h('input', { class: 'p-input', id: 'mtEmail', type: 'email', value: me.email || '', placeholder: 'name@gmail.com', maxlength: '120' });
    const lab = (forId, words) => h('label', { class: 'mt-label', for: forId }, words);
    card.append(
      step(1, Boolean(me.teams), 'Your Microsoft Teams meeting link',
        el('p', 'mt-hint', 'In Teams choose Meet, then Create a meeting link, then Copy, and paste it here. Every mock uses this link, and the Teams lobby keeps the next student waiting until you let them in.'),
        lab('mtTeams', 'Your Teams meeting link'), teams,
        el('p', 'mt-hint mt-teams-note', 'To join as the interviewer, sign in to the Teams app with the Microsoft account that made this meeting. Any other account waits in the lobby.')),
      step(2, Boolean(me.slug), 'Your link, your name and your email',
        h('div', { class: 'mt-three' },
          h('div', {}, lab('mtSlug', 'Booking link'), h('div', { class: 'mt-prefix' }, el('span', '', `${location.host}/book/`), slug)),
          h('div', {}, lab('mtShown', 'Name students see'), shown),
          h('div', {}, lab('mtEmail', 'Email for your calendar invites'), email))),
      step(3, Boolean(me.weekly && Object.keys(me.weekly).length), 'How long, and your slots',
        h('p', { class: 'mt-hint' }, 'Choose them in ', h('button', { type: 'button', class: 'p-link', onclick: () => { tab = 'slots'; draw(); } }, 'Available slots'), '.')),
      step(4, me.setUp, 'Ready', el('p', 'mt-hint', me.setUp ? 'Your link is live. Copy it on Upcoming and send it to a student.' : 'Save this, and your link is live.')),
    );
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
    const err = el('p', 'p-msg error');
    save.addEventListener('click', async () => {
      err.textContent = '';
      if (!teams.value.trim()) { err.textContent = 'Paste your Teams meeting link.'; teams.focus(); return; }
      save.disabled = true; save.textContent = 'Saving…';
      try { data = await api('/api/bookings/setup', { teams: teams.value, slug: slug.value, shown: shown.value, email: email.value }); save.textContent = 'Saved'; toast('Saved. Your booking link is live.'); setTimeout(() => draw(), 700); }
      catch (e) { save.disabled = false; save.textContent = 'Save'; err.textContent = e.message; }
    });
    card.append(err, h('div', { class: 'p-bar' }, save));
    return card;
  }

  async function load() {
    try {
      data = await api('/api/bookings');
      draw();
    } catch (e) {
      $('view').replaceChildren(el('p', 'p-msg error', e.message));
    }
  }
  // Back and forward, or a link to #slots or #setup, open that part of the page.
  window.addEventListener('hashchange', () => {
    const k = (location.hash || '').replace('#', '');
    if (k === 'answer') { if (data && data.waiting.length) { history.replaceState(null, '', `#${tab}`); askNext(0); } return; }
    if (data && k && k !== tab) { tab = k; draw(); }
  });
  load();
})();
