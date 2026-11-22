// The student's booking page (the owner, 22 Nov 2026; mock-team-api.js on the server). No login.
//
//   /book/<name>       pick a day and a free slot, write your name, email and phone, and book. The confirmation shows the Teams link.
//   /booking/<code>    the booking from the email: its time and Teams link, Change the time (the same picker) and Cancel.
//
// It shows nothing but the free times of one Mock Team person, and the student's own booking.
(function () {
  const view = document.getElementById('view');
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const slug = (location.pathname.match(/^\/book\/([a-z0-9-]{3,40})$/) || [])[1] || '';
  const token = (location.pathname.match(/^\/booking\/([A-Za-z0-9_-]{20,40})$/) || [])[1] || '';

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v == null) return;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  async function call(url, body) {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
    return json;
  }
  const logo = () => h('img', { class: 'bk-logo', src: '/brand-logo.png', alt: '', onerror: (e) => e.target.remove() });

  // The picker: a month calendar with the days that have free slots, the free times of the chosen day, then the form.
  function picker(info, { onBook, form = true, button = 'Book' }) {
    const days = info.days || [];
    const byDay = new Map(days.map((d) => [d.day, d]));
    let chosenDay = days[0] ? days[0].day : '';
    let chosenTime = '';
    let month = chosenDay ? chosenDay.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const wrap = h('div', { class: 'bk-picker' });
    const cal = h('section', { class: 'bk-cal', 'aria-label': 'Pick a day' });
    const times = h('section', { class: 'bk-times', 'aria-label': 'Pick a time' });
    const drawCal = () => {
      cal.replaceChildren();
      const [y, m] = month.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1));
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const months = [...new Set(days.map((d) => d.day.slice(0, 7)))];
      const prev = h('button', { type: 'button', class: 'bk-nav', 'aria-label': 'The month before', disabled: months.indexOf(month) <= 0, onclick: () => { month = months[months.indexOf(month) - 1]; drawCal(); } }, '‹');
      const next = h('button', { type: 'button', class: 'bk-nav', 'aria-label': 'The month after', disabled: months.indexOf(month) === -1 || months.indexOf(month) >= months.length - 1, onclick: () => { month = months[months.indexOf(month) + 1]; drawCal(); } }, '›');
      cal.append(h('div', { class: 'bk-cal-head' }, h('h2', {}, 'Pick a day'), h('div', { class: 'bk-month' }, prev, h('span', {}, `${MONTHS[m - 1]} ${y}`), next)));
      const grid = h('div', { class: 'bk-grid', role: 'grid' });
      DOW.forEach((d) => grid.append(h('span', { class: 'bk-dow', role: 'columnheader' }, d)));
      for (let i = 0; i < first.getUTCDay(); i += 1) grid.append(h('span', { class: 'bk-blank' }));
      for (let d = 1; d <= last; d += 1) {
        const iso = `${month}-${String(d).padStart(2, '0')}`;
        const free = byDay.has(iso);
        grid.append(h('button', { type: 'button', class: `bk-day${free ? ' is-free' : ''}${iso === chosenDay ? ' is-on' : ''}`, disabled: !free, 'aria-pressed': String(iso === chosenDay), 'aria-label': free ? `${byDay.get(iso).label}, free` : `${d}, no free time`,
          onclick: () => { chosenDay = iso; chosenTime = ''; drawCal(); drawTimes(); } }, String(d)));
      }
      cal.append(grid, h('p', { class: 'bk-tz' }, 'Times are in Nepal time.'));
    };
    const drawTimes = () => {
      times.replaceChildren();
      const d = byDay.get(chosenDay);
      times.append(h('h2', {}, d ? d.label.replace(/ \d{4}$/, '') : 'No free time'));
      if (!d) { times.append(h('p', { class: 'bk-dim' }, 'There is no free time just now. Please ask the consultancy.')); return; }
      d.times.forEach((t) => times.append(h('button', { type: 'button', class: `bk-time${t.time === chosenTime ? ' is-on' : ''}`, 'aria-pressed': String(t.time === chosenTime), onclick: () => { chosenTime = t.time; drawTimes(); go.textContent = `${button} ${d.label.replace(/ \d{4}$/, '')}, ${t.label}`; } }, t.label)));
    };
    const name = h('input', { id: 'bkName', autocomplete: 'name', maxlength: '80' });
    const email = h('input', { id: 'bkEmail', type: 'email', autocomplete: 'email', maxlength: '120' });
    const phone = h('input', { id: 'bkPhone', type: 'tel', autocomplete: 'tel', maxlength: '30' });
    const msg = h('p', { class: 'bk-msg', role: 'status' });
    const go = h('button', { type: 'button', class: 'bk-go' }, button);
    go.addEventListener('click', async () => {
      msg.textContent = '';
      if (!chosenTime) { msg.textContent = 'Pick a day and a time first.'; return; }
      if (form && !name.value.trim()) { msg.textContent = 'Please write your name.'; name.focus(); return; }
      if (form && !email.value.trim()) { msg.textContent = 'Please write your email address.'; email.focus(); return; }
      go.disabled = true; const was = go.textContent; go.textContent = 'Booking…';
      try { await onBook({ day: chosenDay, time: chosenTime, name: name.value, email: email.value, phone: phone.value }); }
      catch (e) { msg.textContent = e.message; go.disabled = false; go.textContent = was; }
    });
    drawCal(); drawTimes();
    wrap.append(h('div', { class: 'bk-two' }, cal, times));
    const foot = h('section', { class: 'bk-form' });
    if (form) {
      foot.append(
        h('label', { for: 'bkName' }, h('span', {}, 'Your name ', h('b', { 'aria-hidden': 'true' }, '*')), name),
        h('label', { for: 'bkEmail' }, h('span', {}, 'Email ', h('b', { 'aria-hidden': 'true' }, '*')), email),
        h('label', { for: 'bkPhone' }, h('span', {}, 'Phone'), phone));
    }
    foot.append(go);
    wrap.append(foot, msg);
    return wrap;
  }

  function shell(withWho, minutes, ...content) {
    return h('div', { class: 'bk-card' },
      h('aside', { class: 'bk-about' }, logo(), h('p', { class: 'bk-dim' }, withWho), h('h1', {}, 'Mock interview'),
        h('p', {}, `${minutes || 30} minutes`), h('p', {}, 'Online, Microsoft Teams'),
        h('p', { class: 'bk-dim' }, 'Practise for your University\'s credibility interview. Have your offer letter, passport and finance papers near you.')),
      h('div', { class: 'bk-main' }, ...content));
  }
  function done(b, emailed, title) {
    view.replaceChildren(h('div', { class: 'bk-card bk-done' },
      h('div', { class: 'bk-main' }, logo(), h('p', { class: 'bk-tick', 'aria-hidden': 'true' }, '✓'), h('h1', {}, title),
        h('dl', { class: 'bk-facts' },
          h('dt', {}, 'When'), h('dd', {}, `${b.dayLabel}, ${b.timeLabel} (${b.minutes} minutes, Nepal time)`),
          h('dt', {}, 'Where'), h('dd', {}, 'Microsoft Teams, online'),
          h('dt', {}, 'With'), h('dd', {}, b.with),
          ...(b.university ? [h('dt', {}, 'University'), h('dd', {}, b.university)] : []),
          ...(b.course ? [h('dt', {}, 'Course'), h('dd', {}, b.course)] : [])),
        b.teams ? h('a', { class: 'bk-go', href: b.teams, target: '_blank', rel: 'noopener' }, 'Join the mock in Teams') : null,
        h('p', { class: 'bk-dim' }, emailed === false ? 'Keep this page: it has your Teams link. Join 5 minutes early, with your camera on.' : 'We emailed you this with the Teams link. Join 5 minutes early, with your camera on.'))));
  }

  async function bookPage() {
    let info;
    try { info = await call(`/api/book/${slug}`); } catch (e) { view.replaceChildren(h('div', { class: 'bk-card bk-done' }, h('div', { class: 'bk-main' }, logo(), h('h1', {}, 'This link is not open'), h('p', { class: 'bk-dim' }, e.message)))); return; }
    document.title = `Book a mock interview with ${info.with}`;
    view.replaceChildren(shell(info.with, info.minutes, picker(info, {
      onBook: async (x) => { const r = await call(`/api/book/${slug}`, x); history.replaceState(null, '', `/booking/${r.token}`); done(r.booking, r.emailed, 'Your mock interview is booked'); },
      button: 'Book',
    })));
  }

  async function bookingPage() {
    let r;
    try { r = await call(`/api/booking/${token}`); } catch (e) { view.replaceChildren(h('div', { class: 'bk-card bk-done' }, h('div', { class: 'bk-main' }, logo(), h('h1', {}, 'Booking not found'), h('p', { class: 'bk-dim' }, e.message)))); return; }
    const b = r.booking;
    if (b.status !== 'booked') {
      view.replaceChildren(h('div', { class: 'bk-card bk-done' }, h('div', { class: 'bk-main' }, logo(), h('h1', {}, 'This booking is cancelled'),
        h('p', { class: 'bk-dim' }, `It was ${b.dayLabel}, ${b.timeLabel}.`), b.slug ? h('a', { class: 'bk-go', href: `/book/${b.slug}` }, 'Book another time') : null)));
      return;
    }
    done(b, true, 'Your mock interview');
    const main = view.querySelector('.bk-main');
    if (!b.canChange) { main.append(h('p', { class: 'bk-dim' }, 'It is too close to the mock to change it now. Please contact the consultancy if you cannot come.')); return; }
    const change = h('button', { type: 'button', class: 'bk-plain' }, 'Change the time');
    const cancel = h('button', { type: 'button', class: 'bk-plain bk-danger' }, 'Cancel the booking');
    const msg = h('p', { class: 'bk-msg', role: 'status' });
    cancel.addEventListener('click', async () => {
      if (!window.confirm('Cancel your mock interview?')) return;
      cancel.disabled = true;
      try { await call(`/api/booking/${token}/cancel`, {}); bookingPage(); } catch (e) { msg.textContent = e.message; cancel.disabled = false; }
    });
    change.addEventListener('click', async () => {
      let slots;
      try { slots = await call(`/api/booking/${token}/slots`); } catch (e) { msg.textContent = e.message; return; }
      view.replaceChildren(shell(b.with, slots.minutes, h('p', { class: 'bk-dim bk-now' }, `Now: ${b.dayLabel}, ${b.timeLabel}`), picker(slots, {
        form: false, button: 'Move to',
        onBook: async (x) => { const out = await call(`/api/booking/${token}/move`, { day: x.day, time: x.time }); history.replaceState(null, '', `/booking/${out.token}`); done(out.booking, true, 'Your mock interview is moved'); },
      })));
    });
    main.append(h('div', { class: 'bk-actions' }, change, cancel), msg);
  }

  if (token) bookingPage(); else if (slug) bookPage(); else view.replaceChildren(h('p', {}, 'Not found'));
})();
