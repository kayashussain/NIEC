// My dashboard: each team's own page (Application, Mock, Follow-up, a branch). How the team's work is going, in the team's own
// words: four figures, this week against last week, where its students are, what is coming up in the next 7 days, the good news
// of the last 30 days and the team's tasks. Admin and the Manager have the full Dashboard instead.
// A branch's is its performance for head office to read (the owner, 28 Nov 2026), one intake at a time, in the look of Today:
// eight figures, conversion step by step, intake by intake with what to expect next, a table of universities, intake performance and
// growth, and the students by application and step by step. Every number comes ready-made from branch-insights.js. A figure opens the
// list of who it is made of (the current intake only: an earlier intake is shown in numbers).
(function () {
  const { el, h, api, initials, dialog } = window.Portal;
  const view = document.getElementById('view');
  const shortDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const num = (n) => Number(n || 0).toLocaleString('en-GB');

  // The "?" of a branch Dashboard card: what the card means, only when asked for (hover, focus or tap). The words are also the
  // button's name, so a screen reader reads them; the bubble itself is hidden from it so they are not read twice.
  function help(text) {
    const q = h('span', { class: 'bd-q', tabindex: '0', role: 'button', 'aria-label': text }, '?');
    q.append(el('span', 'bd-tip', text));
    q.lastChild.setAttribute('aria-hidden', 'true');
    return q;
  }

  function card(title, sub, cls = '') {
    const c = el('section', `md-card ${cls}`.trim());
    const head = el('header', 'md-card-head');
    head.append(el('h2', '', title));
    if (sub) head.append(cls.split(' ').includes('bd-card') ? help(sub) : el('p', '', sub));
    c.append(head);
    return c;
  }

  // This week against the week before: the figure, and a calm word on the change (never red: a quieter week is not a failure).
  function weekCard(week) {
    const c = card('This week', 'The last 7 days, next to the 7 days before.');
    const grid = el('div', 'md-week');
    week.forEach((w) => {
      const box = el('div', 'md-week-item');
      const diff = w.now - w.before;
      const trend = diff > 0 ? `${diff} more than last week` : diff < 0 ? `${-diff} fewer than last week` : (w.now ? 'The same as last week' : 'None yet this week');
      box.append(el('b', '', num(w.now)), el('span', 'md-week-label', w.label), el('small', `md-trend ${diff > 0 ? 'up' : ''}`, trend));
      grid.append(box);
    });
    c.append(grid);
    return c;
  }

  // Where the team's students are: one bar per stage, as long as its share of the largest.
  function stagesCard(stages, note) {
    const shown = stages.filter((s) => s.count > 0);
    const c = card('Where the students are', note);
    if (!shown.length) { c.append(el('p', 'md-quiet', 'No students at these stages yet.')); return c; }
    const max = Math.max(...shown.map((s) => s.count));
    const list = el('div', 'md-bars');
    shown.forEach((s) => {
      const row = el('div', 'md-bar');
      const track = el('span', 'md-bar-track');
      const fill = el('span', 'md-bar-fill');
      fill.style.width = `${Math.max(4, Math.round((s.count / max) * 100))}%`;
      track.append(fill);
      row.append(el('span', 'md-bar-label', s.stage), track, el('b', 'md-bar-n', num(s.count)));
      list.append(row);
    });
    c.append(list);
    return c;
  }

  function peopleCard(title, sub, rows, empty, side) {
    const c = card(title, sub);
    if (!rows.length) { c.append(el('p', 'md-quiet', empty)); return c; }
    const list = el('div', 'md-people');
    rows.forEach((r) => {
      const a = h('a', { class: 'md-person', href: '/student?id=' + encodeURIComponent(r.id), title: 'Open the student card' });
      a.append(el('span', 'td-av', initials(r.name)));
      const mid = el('span', 'md-person-mid');
      mid.append(el('b', '', r.name), el('small', '', r.what));
      a.append(mid, side(r));
      list.append(a);
    });
    c.append(list);
    return c;
  }

  // ---- A branch's Dashboard ----------------------------------------------------------------------------------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // "Sep", as everywhere else (not "Sept")
  const dayMonth = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  const longDay = (iso) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;
  const count = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
  const days = (n) => count(n, 'day');
  const profile = (id) => '/student?id=' + encodeURIComponent(id);


  // ---- A window over the page ---------------------------------------------------------------------------------------------
  // Every list opens in one: a name in it opens the student card, and closing the card brings the window back as it was.
  function sheet(title, build, kind = '') {
    const kept = {}; // what was typed or chosen in the window, for when it comes back
    const show = () => {
      dialog(title, (body, close) => {
        const d = body.closest('dialog');
        d.classList.add('bd-dialog');
        if (kind) d.classList.add(kind);
        d.shut = close;
        d.again = show;
        build(body, kept);
      }, { wide: true });
      // On a touch screen the keyboard stays away until the search box is pressed, so the list is in view.
      if (window.matchMedia('(pointer: coarse)').matches && document.activeElement) document.activeElement.blur();
    };
    show();
  }

  // A student's name opens their card over the Dashboard.
  function studentLink(id, ids, cls) {
    const a = h('a', { class: cls, href: profile(id), title: 'Open the student card' });
    a.addEventListener('click', (e) => {
      if (!window.CardDrawer || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const open = a.closest('dialog');
      if (!open) { window.CardDrawer.open(id, { list: ids }); return; }
      // A window lies above everything, so it steps aside for the card and returns when the card is closed.
      open.addEventListener('close', () => setTimeout(() => window.CardDrawer.open(id, { list: ids, onClose: open.again }), 0), { once: true });
      open.shut();
    });
    return a;
  }

  // ---- Who a figure is made of --------------------------------------------------------------------------------------------
  // The lines behind each figure, from the students of the current intake (branch-insights.js): one line for each application, offer
  // or student, so a list always has as many lines as its figure says.
  const plain = (a, b) => a.name.localeCompare(b.name);
  const newest = (a, b) => (b.day || '').localeCompare(a.day || '') || plain(a, b);
  const line = (p, what, day) => ({ id: p.id, name: p.name, what: what || p.stage, day: day || '' });
  const uniName = (p) => p.university || 'No University recorded';
  const those = (people, test, what, day) => people.filter(test).map((p) => line(p, what(p), day ? day(p) : '')).sort(newest);
  const BEHIND = {
    students: (p) => p.map((x) => line(x, [x.stage, x.university].filter((v, i, l) => v && l.indexOf(v) === i).join(' · '))).sort(plain),
    applications: (p) => p.flatMap((x) => x.applications.map((a) => line(x, a.university || 'No University recorded', a.applied || a.offer))).sort(newest),
    offers: (p) => p.flatMap((x) => x.applications.filter((a) => a.offer).map((a) => line(x, a.university || 'No University recorded', a.offer))).sort(newest),
    mocks: (p) => those(p, (x) => x.r.mocked, (x) => (x.mocks ? count(x.mocks, 'mock interview') : 'Mock interview'), (x) => x.lastMock),
    passed: (p) => those(p, (x) => x.r.passed, uniName),
    payments: (p) => those(p, (x) => x.r.paid, uniName, (x) => x.paid),
    cas: (p) => those(p, (x) => x.r.cas, uniName, (x) => x.cas),
    visas: (p) => those(p, (x) => x.r.visa, uniName, (x) => x.visa),
  };

  // One line for a student: the mark, the name, what it is about and, at the end, the day or how long it has waited.
  function personRow(line, ids, end) {
    const a = studentLink(line.id, ids, 'bd-line-person');
    const words = el('span', 'bd-line-words');
    words.append(el('b', '', line.name), el('small', '', line.what || ''));
    a.append(el('span', 'bd-line-mark', initials(line.name)), words, end || el('span', 'bd-line-day', line.day ? longDay(line.day) : ''));
    return a;
  }
  function peopleList(lines, first = 40, make = personRow) {
    const box = el('div', 'bd-lines');
    const ids = [...new Set(lines.map((x) => x.id))];
    lines.slice(0, first).forEach((x) => box.append(make(x, ids)));
    if (lines.length > first) {
      const more = h('button', { type: 'button', class: 'bd-more' }, `Show all ${num(lines.length)}`);
      more.addEventListener('click', () => { more.remove(); lines.slice(first).forEach((x) => box.append(make(x, ids))); });
      box.append(more);
    }
    return box;
  }

  // A list in a window, with a search when it is long.
  function listBody(body, kept, lines, { empty = 'Nobody yet.', make = personRow } = {}) {
    if (!lines.length) { body.append(el('p', 'md-quiet', empty)); return; }
    let shown = el('div');
    const draw = () => {
      const q = (kept.q || '').trim().toLowerCase();
      const next = q ? lines.filter((x) => `${x.name} ${x.what}`.toLowerCase().includes(q)) : lines;
      const list = next.length ? peopleList(next, 40, make) : el('p', 'md-quiet', 'No name or University like that.');
      shown.replaceWith(list);
      shown = list;
    };
    if (lines.length > 6) {
      const search = h('input', { type: 'search', class: 'bd-search', placeholder: 'Search a name or a University', 'aria-label': 'Search this list' });
      search.value = kept.q || '';
      search.addEventListener('input', () => { kept.q = search.value; draw(); });
      body.append(search);
    }
    body.append(shown);
    draw();
  }

  // ---- The Dashboard of a branch, intake by intake -----------------------------------------------------------------------------
  // Everything is shown as it was worked out (branch-insights.js); this page works out nothing but a bar's length. Colours come only
  // from the global tokens (shared/apple.css), so light and dark follow the rest of the portal.
  const P = (v) => (v === null || v === undefined ? '-' : `${v}%`);
  const when = (iso) => (iso ? dayMonth(iso) : '-');
  const ratePill = (v) => (v === null || v === undefined ? el('span', 'bd-none', '-') : el('span', `bd-pill ${v >= 60 ? 'is-good' : v < 40 ? 'is-low' : ''}`.trim(), P(v)));
  const change = (c, running) => {
    if (c === null || c === undefined) return el('span', 'bd-chg', '-');
    return el('span', `bd-chg ${c >= 0 ? 'is-up' : 'is-down'}`, `${c >= 0 ? '+' : ''}${c}%${running ? ' so far' : ''}`);
  };
  const cell = (...kids) => { const td = el('td'); td.append(...kids.filter((k) => k !== null && k !== undefined && k !== '').map((k) => (typeof k === 'string' ? document.createTextNode(k) : k))); return td; };
  function tableOf(heads, rows, cls = '', groups = null) {
    const wrap = el('div', 'bd-scroll');
    const t = el('table', `bd-table ${cls}`.trim());
    const hr = el('tr');
    heads.forEach((x) => hr.append(el('th', '', x)));
    const thead = el('thead');
    if (groups) { const gr = el('tr', 'bd-groups'); groups.forEach(([label, span]) => { const th = el('th', '', label); th.colSpan = span; gr.append(th); }); thead.append(gr); }
    thead.append(hr);
    t.append(thead);
    const body = el('tbody');
    rows.forEach((r) => { const tr = el('tr', r.cls || ''); r.cells.forEach((c) => tr.append(c)); body.append(tr); });
    t.append(body);
    wrap.append(t);
    return wrap;
  }
  let chosen = ''; // the intake tab: its name; '' is the current intake
  let appTab = 'applied';

  // The eight figures, in one strip. A figure of the current intake opens the list of who it is made of.
  // The three bars under a figure: this intake and the two before it (oldest first), this one in blue. "J27" is Jan 2027.
  const shortLabel = (label) => { const x = /^([A-Za-z]{3}) \d{2}(\d{2})$/.exec(label); return x ? x[1][0] + x[2] : label; };
  function miniBars(values, labels) {
    const NS = 'http://www.w3.org/2000/svg';
    const w = 12; const gap = 5; const ht = 34;
    const top = Math.max(1, ...values);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(values.length * w + (values.length - 1) * gap));
    svg.setAttribute('height', String(ht));
    values.forEach((v, i) => {
      const bar = Math.max(3, (v / top) * ht);
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(i * (w + gap)));
      r.setAttribute('y', String(ht - bar));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(bar));
      r.setAttribute('rx', '3');
      r.setAttribute('class', i === values.length - 1 ? 'bd-mb is-now' : 'bd-mb');
      svg.append(r);
    });
    const box = el('span', 'bd-mini');
    box.setAttribute('aria-hidden', 'true');
    const words = el('em');
    labels.forEach((l) => words.append(el('span', '', l)));
    box.append(svg, words);
    return box;
  }

  function figures(it, intakes) {
    const m = it.m;
    const at = intakes.indexOf(it);
    const trend = intakes.slice(Math.max(0, at), at + 3).reverse(); // intakes are newest first
    const list = [
      ['students', m.students, 'Total students', m.deferredIn ? `${m.deferredIn} deferred in` : 'In this intake'],
      ['applications', m.applications, 'Applications submitted', `From ${count(m.applied, 'student')}`],
      ['offers', m.offers, 'Offers received', `To ${count(m.offered, 'student')}`],
      ['mocks', m.mocked, 'Mock interviews conducted', 'Students prepared'],
      ['passed', m.passed, 'Interviews passed', `Of ${count(m.fin, 'final interview')}`],
      ['payments', m.paid, 'Payments received', 'Deposits paid'],
      ['cas', m.cas, 'CAS received', `${P(pctOf(m.cas, m.students))} of students`],
      ['visas', m.visas, 'Visas received', m.visaNo ? `${num(m.visaNo)} refused` : 'None refused'],
    ];
    const KEY = { students: 'students', applications: 'applications', offers: 'offers', mocks: 'mocked', passed: 'passed', payments: 'paid', cas: 'cas', visas: 'visas' };
    const strip = el('div', 'bd-strip');
    list.forEach(([key, value, label, note]) => {
      const inner = [el('span', 'bd-fig-label', label), el('b', '', num(value)), el('small', '', note)];
      if (trend.length > 1) inner.push(miniBars(trend.map((i) => i.m[KEY[key]] || 0), trend.map((i) => shortLabel(i.label))));
      if (!it.people) { const box = el('div', `bd-fig bd-fig-${key}`); box.append(...inner); strip.append(box); return; }
      const box = h('button', { type: 'button', class: `bd-fig bd-fig-${key}`, title: `${label}: who`, 'aria-label': `${label}: ${value}. Show who` });
      box.append(...inner);
      box.addEventListener('click', () => sheet(label, (body, kept) => listBody(body, kept, BEHIND[key](it.people))));
      strip.append(box);
    });
    return strip;
  }
  const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : null);

  // Conversion, step by step: how many students reached each step, and what share of the step before moved on (a chip: green from
  // 60%, amber below). What the card means, the offers per student and how long an offer takes sit behind its "?".
  function funnelCard(it) {
    const m = it.m;
    const days = m.offerDays;
    const tip = `Students who reached each step. The chip at the end is the share of the step before; amber marks a step where fewer than 60% moved on. ${count(m.offers, 'offer')} ${m.offers === 1 ? 'goes' : 'go'} to ${count(m.offered, 'student')}, because a student can get offers from more than one university.${days.count ? ` An offer takes ${count(days.average, 'day')} on average (middle ${count(days.median, 'day')}), from ${count(days.count, 'offer')} with both days recorded.` : ''}${it.current ? ' This intake is still running, so its later steps will fill in.' : ''}`;
    const c = card('Conversion', tip, 'bd-card');
    const top = Math.max(1, it.funnel[0].n);
    const box = el('div', 'bd-funnel');
    it.funnel.forEach((f, i) => {
      const row = el('div', 'bd-step');
      const track = el('span', 'bd-track');
      const fill = el('span', 'bd-fill');
      fill.style.width = `${Math.max(f.n ? 1 : 0, (f.n / top) * 100)}%`;
      track.append(fill);
      const chip = i ? el('span', `bd-step-share${f.low ? ' is-low' : f.share === null ? '' : ' is-good'}`, f.share === null ? '-' : `${f.share}%`) : el('span');
      row.append(el('span', 'bd-step-label', f.label), track, el('b', 'bd-step-n', num(f.n)), chip);
      box.append(row);
    });
    c.append(box);
    return c;
  }

  // The four ratios, as rings: a ring is filled as far as the percentage, with the working underneath.
  function ringOf(value, tone) {
    const NS = 'http://www.w3.org/2000/svg';
    const r = 44; const circ = 2 * Math.PI * r;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 112 112');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `bd-ring is-${tone}`);
    const back = document.createElementNS(NS, 'circle');
    const front = document.createElementNS(NS, 'circle');
    [back, front].forEach((x) => { x.setAttribute('cx', '56'); x.setAttribute('cy', '56'); x.setAttribute('r', String(r)); x.setAttribute('fill', 'none'); x.setAttribute('stroke-width', '12'); });
    back.setAttribute('class', 'bd-ring-back');
    front.setAttribute('class', 'bd-ring-front');
    front.setAttribute('stroke-linecap', 'round');
    front.setAttribute('transform', 'rotate(-90 56 56)');
    const filled = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
    front.setAttribute('stroke-dasharray', `${((circ * filled) / 100).toFixed(1)} ${circ.toFixed(1)}`);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '56'); text.setAttribute('y', '63'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'bd-ring-text');
    text.textContent = P(value);
    svg.append(back);
    if (filled > 0) svg.append(front); // a ring at nothing is an empty track, not a dot
    svg.append(text);
    return svg;
  }
  function ratiosCard(it) {
    const m = it.m;
    const c = card('Ratios', 'Offer ratio: offers divided by applications. Interview pass ratio: passed divided by final interviews. Visa ratio: received divided by visas decided. Conversion: visas divided by all students.', 'bd-card');
    const grid = el('div', 'bd-rings');
    [[m.offerRate, 'blue', 'Offer ratio', `${count(m.offers, 'offer')} from ${count(m.applications, 'application')}`],
      [m.passRate, 'good', 'Interview pass ratio', `${num(m.passed)} passed of ${count(m.fin, 'final interview')}`],
      [m.visaRate, 'purple', 'Visa ratio', `${num(m.visas)} received of ${num(m.visas + m.visaNo)} decided`],
      [m.conversion, 'ink', 'Conversion', `${count(m.visas, 'visa')} from ${count(m.students, 'student')}`]].forEach(([v, tone, l, s]) => {
      const r = el('div', 'bd-ringbox');
      r.append(ringOf(v, tone), el('b', '', l), el('small', '', s));
      grid.append(r);
    });
    c.append(grid);
    return c;
  }

  // Intake by intake: a group of four bars for each intake, oldest first, then the two intakes to come (dashed, expected). The
  // numbers sit on the bars; how the expected ones are worked out sits behind the "?".
  function chartCard(d) {
    const ex = d.expected;
    let tip = 'How each intake went, with the share of its students who got a visa.';
    if (ex) {
      const g = ex.growth;
      const r = ex.rates;
      tip += ` The two dashed groups are the next intakes, expected and not recorded. New students: each intake has brought ${Math.abs(g)}% ${g < 0 ? 'fewer' : 'more'} new students than the one before, on average, and that is carried on. Offers, interviews passed and visas: new students times what ${ex.basis.join(' and ')} achieved for each student (${r.offers.toFixed(1)} offers, ${r.passed.toFixed(1)} interviews passed and ${r.visas.toFixed(1)} visas for every student, on average). A rough guide, not a target; students who defer in come on top.`;
    } else {
      tip += ' There are not enough intakes yet to say what the next ones will bring. Once there is an earlier intake with students, the two to come are shown here.';
    }
    const c = card('Intake by intake', tip, 'bd-card');
    const real = [...d.intakes].reverse();
    const groups = real.map((i) => ({ label: i.label, vals: [i.m.students, i.m.offers, i.m.passed, i.m.visas], foot: `${i.current ? 'Running' : 'Complete'}${i.m.conversion === null ? '' : ` · ${i.m.conversion}% to a visa`}`, dash: false }));
    if (ex) ex.next.forEach((n) => groups.push({ label: n.label, vals: [n.students, n.offers, n.passed, n.visas], foot: `Expected${n.students ? ` · ${P(pctOf(n.visas, n.students))} to a visa` : ''}`, dash: true }));
    const max = Math.max(1, ...groups.flatMap((g) => g.vals));
    const key = el('div', 'bd-key');
    [['students', 'Students'], ['offers', 'Offers received'], ['passed', 'Interviews passed'], ['visas', 'Visas received']].forEach(([k, l]) => key.append(el('span', `bd-key-${k}`, l)));
    const chart = el('div', 'bd-chart');
    groups.forEach((g) => {
      const col = el('div', `bd-group${g.dash ? ' is-expected' : ''}`);
      const bars = el('div', 'bd-bars');
      ['students', 'offers', 'passed', 'visas'].forEach((k, i) => {
        const bar = el('div', `bd-bar bd-bar-${k}`);
        const fill = el('span', 'bd-bar-fill');
        fill.style.height = `${Math.max(g.vals[i] ? 2 : 0, (g.vals[i] / max) * 100)}%`;
        bar.append(el('small', '', num(g.vals[i])), fill);
        bars.append(bar);
      });
      col.append(bars, el('b', 'bd-group-label', g.label), el('span', 'bd-group-foot', g.foot));
      chart.append(col);
    });
    c.append(key, chart);
    return c;
  }

  // One line for each university the branch applied to, ending with the intake's own total.
  function universitiesCard(it) {
    const m = it.m;
    const c = card(`Universities · ${it.name}`, 'One line for each university the branch applied to. A student who applies to three universities is three applications, one at each, however many courses they chose there. Offer rate: offers divided by applications. Pass rate: passed divided by final interviews. Visa rate: received divided by visas decided.', 'bd-card');
    const rows = it.universities.map((u) => ({ cells: [cell(el('b', '', u.name)), cell(String(u.applications)), cell(String(u.offers)), cell(ratePill(u.offerRate)), cell(String(u.fin)), cell(String(u.passed)), cell(ratePill(u.passRate)), cell(String(u.lodged)), cell(String(u.visas)), cell(ratePill(u.visaRate))] }));
    if (!rows.length) { c.append(el('p', 'md-quiet', 'No application has been made yet.')); return c; }
    rows.push({ cls: 'is-total', cells: [cell(el('b', '', 'All universities')), cell(String(m.applications)), cell(String(m.offers)), cell(ratePill(m.offerRate)), cell(String(m.fin)), cell(String(m.passed)), cell(ratePill(m.passRate)), cell(String(m.lodged)), cell(String(m.visas)), cell(ratePill(m.visaRate))] });
    c.append(tableOf(['University', 'Applications submitted', 'Offers received', 'Offer rate', 'Final interviews', 'Interviews passed', 'Pass rate', 'Applied for visa', 'Visas received', 'Visa rate'], rows, 'bd-unis', [['', 1], ['Application', 3], ['Interview', 3], ['Visa', 3]]));
    return c;
  }

  // The only place intakes are compared: one panel for each intake, with the change since the intake before it. A running intake's
  // changes are grey: it is part-way through, so a drop against a finished intake is not a verdict.
  const GROWTH_LABELS = ['Students', 'Applications', 'Offers', 'Final interviews', 'Interviews passed', 'Applied for visa', 'Visas'];
  function growthCard(it) {
    const c = card('Intake performance and growth', 'Each intake with the change since the intake before it. This tab compares the intakes up to its own. Student growth leaves out students who deferred in, because they were recruited in an earlier intake. A running intake is still part-way through, so its changes are grey.', 'bd-card');
    const grid = el('div', 'bd-int');
    it.growth.forEach((r) => {
      const running = r.tag === 'Still running';
      const panel = el('div', 'bd-ic');
      const head = el('div', 'bd-ic-head');
      head.append(el('span', '', r.name));
      if (r.tag) head.append(el('span', `bd-pill ${r.tag === 'Strongest' ? 'is-good' : r.tag === 'Weakest' ? 'is-low' : ''}`.trim(), running ? 'Running' : r.tag));
      const sub = [r.deferredIn ? `${r.deferredIn} deferred in` : '', r.deferredOut ? `${r.deferredOut} deferred out` : ''].filter(Boolean);
      panel.append(head, el('b', 'bd-ic-big', P(r.conversion.value)), el('span', 'bd-ic-cap', ['converted to a visa', ...sub].join(' · ')));
      r.cells.forEach((x, i) => {
        const row = el('div', 'bd-ic-row');
        const chg = x.change === null || x.change === undefined ? h('span', { class: 'bd-dl is-none', 'aria-hidden': 'true' }, '0%') : el('span', `bd-dl${running ? ' is-run' : x.change >= 0 ? '' : ' is-down'}`, `${x.change >= 0 ? '+' : '-'}${Math.abs(x.change)}%`);
        const val = el('b', '', num(x.value));
        val.append(chg);
        row.append(el('span', '', GROWTH_LABELS[i] || x.key), val);
        panel.append(row);
      });
      grid.append(panel);
    });
    c.append(grid);
    return c;
  }

  // "Show all N": a long list shows its first lines and the rest on a press.
  function limited(wrap, rows, first = 12) {
    const body = wrap.querySelector('tbody');
    rows.slice(0, first).forEach((r) => body.append(r));
    if (rows.length > first) {
      const more = h('button', { type: 'button', class: 'bd-more' }, `Show all ${num(rows.length)}`);
      more.addEventListener('click', () => { more.remove(); rows.slice(first).forEach((r) => body.append(r)); });
      wrap.after(more);
    }
  }
  const trOf = (cells) => { const tr = el('tr'); cells.forEach((c) => tr.append(c)); return tr; };
  const nameCell = (p, ids) => { const box = el('span', 'bd-who'); box.append(studentLink(p.id, ids, 'bd-name')); box.firstChild.textContent = p.name; if (p.from) box.append(el('small', '', `Deferred from ${p.from}`)); return cell(box); };

  // One line for each university a student applied to, so a student appears once for each.
  function applicationsCard(it) {
    const c = card('Students by application', 'One line for each university a student applied to, so a student appears once for each. The tabs filter the same list.', 'bd-card');
    const offers = it.applications.filter((a) => a.offer);
    const tabs = el('div', 'bd-tabs');
    [['applied', 'Application submitted', it.applications.length], ['offer', 'Offer received', offers.length]].forEach(([k, label, n]) => {
      const b = h('button', { type: 'button', class: 'bd-tab', 'aria-pressed': String(appTab === k) }, `${label} (${num(n)})`);
      b.addEventListener('click', () => { appTab = k; drawAll(); });
      tabs.append(b);
    });
    c.append(tabs);
    const list = appTab === 'offer' ? offers : it.applications;
    if (!list.length) { c.append(el('p', 'md-quiet', appTab === 'offer' ? 'No offer yet.' : 'No application yet.')); return c; }
    const ids = [...new Set(list.map((a) => a.id))];
    const table = tableOf(['Student', 'University', 'Applied on', 'University answer', 'Answered on', 'Days to answer'], [], 'bd-apps');
    const answer = (a) => el('span', `bd-pill ${a.offer ? 'is-good' : a.refused ? 'is-low' : ''}`.trim(), a.offer ? 'Offer received' : a.refused ? 'Refused' : 'No answer yet');
    limited(table, list.map((a) => trOf([nameCell(a, ids), cell(a.university), cell(when(a.applied)), cell(answer(a)), cell(when(a.offer || a.refused)),
      cell(a.days === null ? '-' : a.waiting ? el('span', `bd-pill${a.days > 30 ? ' is-low' : ''}`, `${count(a.days, 'day')} waiting`) : count(a.days, 'day'))])));
    c.append(table);
    return c;
  }

  // One line for each student: the day each step was done, the newest news first.
  function everyStudentCard(it) {
    const c = card('Every student, step by step', 'One line for each student: the day each step was done, newest news first. The university is the one the student goes forward with; the others they applied to are in the list above. A student who deferred in starts again at the beginning.', 'bd-card');
    const people = it.people;
    if (!people.length) { c.append(el('p', 'md-quiet', 'No student yet.')); return c; }
    const last = (p) => [p.applied, p.offered, p.lastMock, p.paid, p.cas, p.lodged, p.visa].filter(Boolean).sort().pop() || '';
    const sorted = [...people].sort((a, b) => last(b).localeCompare(last(a)) || plain(a, b));
    const ids = sorted.map((p) => p.id);
    const step = (day, reached) => (day ? dayMonth(day) : reached ? 'Done' : '-');
    const table = tableOf(['Student', 'University', 'Applied', 'Offer received', 'Last mock interview', 'Final interview result', 'Deposit paid', 'CAS received', 'Visa applied', 'Visa received'], [], 'bd-steps');
    limited(table, sorted.map((p) => trOf([nameCell(p, ids),
      cell(p.university || '-', p.more ? el('small', 'bd-more-uni', `+${p.more} more applied`) : null),
      cell(step(p.applied, p.r.applied)), cell(step(p.offered, p.r.offered)), cell(p.lastMock ? when(p.lastMock) : p.r.mocked ? 'Done' : '-', p.mocks > 1 ? el('small', 'bd-more-uni', `${p.mocks} held`) : null),
      cell(p.result || (p.r.fin ? 'Done' : '-')), cell(step(p.paid, p.r.paid)), cell(step(p.cas, p.r.cas)), cell(step(p.lodged, p.r.lodged)), cell(p.r.visaNo ? 'Refused' : step(p.visa, p.r.visa))])), 15);
    c.append(table);
    return c;
  }

  let drawAll = () => {};
  function branchPage(d, page) {
    const draw = () => {
      const it = d.branch.intakes.find((i) => i.name === chosen) || d.branch.intakes[0];
      const head = el('header', 'tda-top bd-top');
      const words = el('div', 'bd-top-words');
      words.append(el('span', 'tda-date', `${d.title} · ${it.name}`), el('h1', '', 'Dashboard'));
      head.append(words);
      if (d.branch.intakes.length > 1) {
        const seg = el('div', 'tda-seg');
        seg.setAttribute('role', 'tablist');
        seg.setAttribute('aria-label', 'Which intake');
        d.branch.intakes.forEach((i) => {
          const b = h('button', { class: 'tda-view', type: 'button', role: 'tab', 'aria-selected': String(i === it) }, i.label);
          b.addEventListener('click', () => { chosen = i.name; draw2(); });
          seg.append(b);
        });
        head.append(seg);
      }
      const two = el('div', 'bd-two');
      two.append(funnelCard(it), ratiosCard(it));
      const out = [head, figures(it, d.branch.intakes), two, chartCard(d.branch), universitiesCard(it), growthCard(it)];
      if (it.people) out.push(applicationsCard(it), everyStudentCard(it));
      else out.push(el('p', 'bd-quiet', `Names and lists are shown for the current intake (${d.branch.intakes[0].label}). An earlier intake is shown in numbers.`));
      page.replaceChildren(...out);
    };
    const draw2 = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };
    drawAll = draw2;
    draw();
  }

  api('/api/my-dashboard').then((d) => {
    document.title = 'Dashboard · Student Recruit 360';
    const page = el('div', `md-page${d.branch ? ' bd-page' : ''}`);
    if (d.branch) { branchPage(d, page); view.replaceChildren(page); return; }
    const head = el('header', 'td-hello');
    head.append(el('span', 'td-kicker', d.intake ? `${d.title} · ${d.intake}` : d.title), el('h1', '', 'Dashboard'));
    head.append(el('p', '', d.lead));
    page.append(head);
    const kpis = el('div', 'md-kpis');
    d.kpis.forEach((k) => { const t = el('div', 'md-kpi'); t.append(el('span', 'md-kpi-label', k.label), el('b', '', num(k.value)), el('small', '', k.note)); kpis.append(t); });
    page.append(kpis);

    // The tasks of the team, in one line, with the way to Today where they are ticked.
    const tk = el('a', 'md-taskline');
    tk.href = '/today';
    tk.append(el('b', '', d.tasks.open ? `${num(d.tasks.open)} open task${d.tasks.open === 1 ? '' : 's'}` : 'No open task'),
      el('span', 'md-taskline-go', 'Open on Today'));
    page.append(tk);

    // What waits for the team now: one row per kind of work, the count and the first students, each opening their card.
    if (d.todo && d.todo.length) {
      const c = card('Needs attention', 'Longest waiting first.', 'md-todo');
      const list = el('div', 'md-todo-list');
      d.todo.forEach((x) => {
        const row = el('div', 'md-todo-row');
        const words = el('div', 'md-todo-words');
        words.append(el('b', '', x.title), el('small', '', x.hint));
        const names = el('div', 'md-todo-names');
        // The first three names; "+N more" shows the rest in place (the owner, 17 Nov 2026). A name opens the card over the Dashboard,
        // with ‹ › through every student of this row (card-drawer.js); a Ctrl click still opens it in a new tab.
        const ids = x.students.map((r) => r.id);
        const nameLink = (r) => {
          const a = h('a', { class: 'md-todo-name', href: '/student?id=' + encodeURIComponent(r.id), title: r.detail || 'Open the student card' }, r.name);
          a.addEventListener('click', (e) => {
            if (!window.CardDrawer || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            window.CardDrawer.open(r.id, { list: ids });
          });
          return a;
        };
        x.students.slice(0, 3).forEach((r) => names.append(nameLink(r)));
        if (x.students.length > 3) {
          const more = h('button', { class: 'md-todo-more', type: 'button', 'aria-expanded': 'false' }, `+${num(x.students.length - 3)} more`);
          more.addEventListener('click', () => { more.replaceWith(...x.students.slice(3).map(nameLink)); });
          names.append(more);
        } else if (x.count > x.students.length) names.append(el('span', 'md-todo-more', `+${num(x.count - x.students.length)} more`));
        words.append(names);
        row.append(el('span', 'md-todo-n', num(x.count)), words);
        list.append(row);
      });
      c.append(list);
      page.append(c);
    }
    const grid = el('div', 'md-grid');
    grid.append(weekCard(d.week), stagesCard(d.stages, d.stagesNote),
      peopleCard('Coming up', 'The next 7 days.', d.upcoming, 'Nothing booked for the next 7 days.', (r) => el('span', 'md-date', shortDay(r.date))),
      peopleCard('Good news', 'The last 30 days.', d.wins, 'No news in the last 30 days yet.', (r) => el('span', 'md-date', shortDay(r.date))));
    page.append(grid);
    view.replaceChildren(page);
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
