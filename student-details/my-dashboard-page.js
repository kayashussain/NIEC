// My dashboard: each team's own page (Application, Mock, Follow-up, a branch). How the team's work is going, in the team's own
// words: four figures, this week against last week, where its students are, what is coming up in the next 7 days, the good news
// of the last 30 days and the team's tasks. Admin and the Manager have the full Dashboard instead. A branch's goes deeper (the
// owner, 27 Nov 2026, branch-insights.js): eight totals, applications and offers week by week and month by month, from student to
// visa, the days from application to offer, success rates, how long each step takes, each University and who waits for an offer.
// Every figure opens (the owner, 27 Nov 2026): a press on a week or a month says who did what in it, a press on a total or a step
// lists those students, and "Every student" shows each one's days from application to visa, with a search and a stage filter.
(function () {
  const { el, h, api, initials } = window.Portal;
  const view = document.getElementById('view');
  const shortDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const num = (n) => Number(n || 0).toLocaleString('en-GB');

  function card(title, sub, cls = '') {
    const c = el('section', `md-card ${cls}`.trim());
    const head = el('header', 'md-card-head');
    head.append(el('h2', '', title));
    if (sub) head.append(el('p', '', sub));
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
  const days = (n) => `${num(n)} day${n === 1 ? '' : 's'}`;
  const profile = (id) => '/student?id=' + encodeURIComponent(id);
  let spanKind = 'week'; // which chart: weeks or months

  // ---- Who a figure is made of --------------------------------------------------------------------------------------------
  const longDay = (iso) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;
  const plain = (a, b) => a.name.localeCompare(b.name);
  const newest = (a, b) => (b.day || '').localeCompare(a.day || '') || plain(a, b);
  const at = (p, what, day) => ({ id: p.id, name: p.name, what: what || p.stage, day: day || '' });
  const where = (university, course) => [university, course].filter(Boolean).join(' · ');
  const own = (p) => where(p.university, p.course) || p.stage;
  // The lines behind each total and each step: one for each application, offer or mock, one for each student otherwise.
  const apps = (people, key) => people.flatMap((p) => p.applications.filter((a) => a[key]).map((a) => at(p, where(a.university || 'No University recorded', a.course), a[key]))).sort(newest);
  const those = (people, test, day) => people.filter(test).map((p) => at(p, own(p), day ? day(p) : '')).sort(newest);
  const BEHIND = {
    students: (p) => p.map((x) => at(x, [x.stage, own(x)].filter((v, i, l) => v && l.indexOf(v) === i).join(' · '))).sort(plain),
    applications: (p) => apps(p, 'applied'),
    offers: (p) => apps(p, 'offer'),
    mocks: (p) => p.flatMap((x) => x.mocks.map((d, i) => at(x, `Mock interview ${i + 1}`, d))).sort(newest),
    applied: (p) => those(p, (x) => x.applications.some((a) => a.applied), (x) => x.applied),
    offered: (p) => those(p, (x) => x.applications.some((a) => a.offer), (x) => x.offered),
    mocked: (p) => those(p, (x) => x.mocks.length, (x) => x.mocks[x.mocks.length - 1]),
    passed: (p) => those(p, (x) => x.passed),
    payments: (p) => those(p, (x) => x.paid, (x) => x.paid),
    paid: (p) => those(p, (x) => x.paid, (x) => x.paid),
    cas: (p) => those(p, (x) => x.hasCas, (x) => x.cas),
    visas: (p) => those(p, (x) => x.issued, (x) => x.visa),
    visa: (p) => those(p, (x) => x.issued, (x) => x.visa),
  };

  // One line for a student: the mark, the name (it opens the card), what it is about and the day.
  function personRow(line, ids) {
    const a = studentLink(line.id, '', ids, 'bd-line-person');
    const words = el('span', 'bd-line-words');
    words.append(el('b', '', line.name), el('small', '', line.what || ''));
    a.replaceChildren(el('span', 'bd-line-mark', initials(line.name)), words, el('span', 'bd-line-day', line.day ? longDay(line.day) : ''));
    return a;
  }
  function peopleList(lines, first = 8) {
    const box = el('div', 'bd-lines');
    const ids = [...new Set(lines.map((x) => x.id))];
    lines.slice(0, first).forEach((x) => box.append(personRow(x, ids)));
    if (lines.length > first) {
      const more = h('button', { type: 'button', class: 'bd-more' }, `Show all ${lines.length}`);
      more.addEventListener('click', () => { more.remove(); lines.slice(first).forEach((x) => box.append(personRow(x, ids))); });
      box.append(more);
    }
    return box;
  }

  // The list a total or a step opens, under the block it was pressed in; a second press (or Close) puts it away.
  let open = null; // { key, panel, button }
  function closeList() {
    if (!open) return;
    open.panel.remove();
    open.button.setAttribute('aria-expanded', 'false');
    open = null;
  }
  function showList(button, after, key, title, people) {
    const again = open && open.button === button;
    closeList();
    if (again) return;
    const lines = BEHIND[key](people);
    const panel = card(title, lines.length ? `${num(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}${['passed', 'students'].includes(key) ? '' : ', the newest first'}. A name opens the student card.` : '', 'bd-open');
    const shut = h('button', { type: 'button', class: 'bd-close', 'aria-label': 'Close this list' }, 'Close');
    shut.addEventListener('click', () => { closeList(); button.focus(); });
    panel.querySelector('header').append(shut);
    if (!lines.length) panel.append(el('p', 'md-quiet', 'Nobody yet.'));
    else {
      const search = h('input', { type: 'search', class: 'bd-search', placeholder: 'Search a name or a University', 'aria-label': 'Search this list' });
      let shown = peopleList(lines);
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        const next = q ? lines.filter((x) => `${x.name} ${x.what}`.toLowerCase().includes(q)) : lines;
        const list = next.length ? peopleList(next) : el('p', 'md-quiet', 'No name or University like that.');
        shown.replaceWith(list); shown = list;
      });
      if (lines.length > 8) panel.append(search);
      panel.append(shown);
    }
    after.after(panel);
    button.setAttribute('aria-expanded', 'true');
    open = { key, panel, button };
    panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  function totalsRow(totals, people) {
    const grid = el('div', 'bd-totals');
    totals.forEach((t) => {
      const box = h('button', { type: 'button', class: `bd-total bd-total-${t.key}`, 'aria-expanded': 'false' });
      box.append(el('span', 'bd-total-k', t.label), el('b', 'bd-total-n', num(t.value)), el('small', '', t.note), el('span', 'bd-total-go', 'See who'));
      box.addEventListener('click', () => showList(box, grid, t.key, t.label, people));
      grid.append(box);
    });
    return grid;
  }

  // Everything that happened between two days, kind by kind.
  const EVENTS = [
    ['applications', 'Applications submitted', (p) => apps(p, 'applied')],
    ['offers', 'Offers received', (p) => apps(p, 'offer')],
    ['mocks', 'Mock interviews held', (p) => BEHIND.mocks(p)],
    ['paid', 'Deposits paid', (p) => BEHIND.paid(p)],
    ['cas', 'CAS received', (p) => those(p, (x) => x.cas, (x) => x.cas)],
    ['lodged', 'Visas lodged', (p) => those(p, (x) => x.lodged, (x) => x.lodged)],
    ['visa', 'Visas received', (p) => those(p, (x) => x.visa, (x) => x.visa)],
  ];
  const happened = (people, period) => EVENTS.map(([key, label, lines]) => ({ key, label, lines: lines(people).filter((x) => x.day && x.day >= period.from && x.day <= period.to) })).filter((g) => g.lines.length);
  function periodPanel(people, period) {
    const groups = happened(people, period);
    const box = el('section', 'bd-period');
    box.setAttribute('aria-live', 'polite');
    const head = el('header', 'bd-period-head');
    head.append(el('h3', '', period.title), el('p', '', period.from === period.to ? longDay(period.from) : `${longDay(period.from)} to ${longDay(period.to)}`));
    box.append(head);
    if (!groups.length) { box.append(el('p', 'md-quiet', 'Nothing was recorded in this time. Press another column.')); return box; }
    const grid = el('div', 'bd-events');
    groups.forEach((g) => {
      const part = el('div', `bd-event bd-event-${g.key}`);
      const title = el('h4');
      title.append(el('span', '', g.label), el('i', '', num(g.lines.length)));
      part.append(title, peopleList(g.lines, 5));
      grid.append(part);
    });
    box.append(grid);
    return box;
  }

  // Each student's own days, one row each: the quickest way to see who needs a push.
  const STEPS = [['Applied', (p) => p.applied], ['Offer', (p) => p.offered], ['Mock', (p) => p.mocks[p.mocks.length - 1]], ['Pre-CAS', null], ['Deposit', (p) => p.paid], ['CAS', (p) => p.cas], ['Visa', (p) => p.visa]];
  function everyStudentCard(people) {
    const c = card('Every student', 'The day each one reached each step. A name opens the student card.', 'bd-wide bd-every');
    if (!people.length) { c.append(el('p', 'md-quiet', 'No students yet.')); return c; }
    const stages = [...new Set(people.map((p) => p.stage).filter(Boolean))];
    const search = h('input', { type: 'search', class: 'bd-search', placeholder: 'Search a name or a University', 'aria-label': 'Search your students' });
    const pick = h('select', { class: 'bd-pick', 'aria-label': 'Show one stage' }, h('option', { value: '' }, 'Every stage'), ...stages.map((s) => h('option', { value: s }, s)));
    const tools = el('div', 'bd-every-tools');
    tools.append(search, pick);
    const body = el('div', 'bd-every-body');
    let all = false;
    const last = (p) => [p.applied, p.offered, p.mocks[p.mocks.length - 1], p.paid, p.cas, p.lodged, p.visa].filter(Boolean).sort().pop() || '';
    const sorted = [...people].sort((a, b) => last(b).localeCompare(last(a)) || plain(a, b));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const list = sorted.filter((p) => (!pick.value || p.stage === pick.value) && (!q || `${p.name} ${p.university} ${p.course}`.toLowerCase().includes(q)));
      if (!list.length) { body.replaceChildren(el('p', 'md-quiet', 'No student like that.')); return; }
      const ids = list.map((p) => p.id);
      const rows = list.slice(0, all ? list.length : 10).map((p) => {
        const who = el('div', 'bd-who');
        who.append(studentLink(p.id, p.name, ids, 'bd-name'), el('small', '', own(p)));
        const cells = STEPS.map(([label, day]) => {
          if (!day) return p.passed ? el('span', 'bd-tick is-yes', 'Passed') : p.failed ? el('span', 'bd-tick is-no', 'Not passed') : el('span', 'bd-tick is-none', '-');
          const d = day(p);
          const done = d || (label === 'CAS' && p.hasCas) || (label === 'Visa' && p.issued);
          return done ? el('span', 'bd-tick is-yes', d ? dayMonth(d) : 'Yes') : el('span', 'bd-tick is-none', '-');
        });
        return [who, el('span', 'bd-stage', p.stage || 'No stage'), ...cells];
      });
      const wrap = el('div', 'bd-scroll');
      wrap.append(table(['Student', 'Stage', ...STEPS.map(([label]) => label)], rows, 'bd-steps'));
      const parts = [el('p', 'bd-sum', `${num(list.length)} ${list.length === 1 ? 'student' : 'students'}, the latest news first`), wrap];
      if (list.length > 10) {
        const more = h('button', { type: 'button', class: 'bd-more' }, all ? 'Show fewer' : `Show all ${list.length}`);
        more.addEventListener('click', () => { all = !all; draw(); });
        parts.push(more);
      }
      body.replaceChildren(...parts);
    };
    search.addEventListener('input', draw);
    pick.addEventListener('change', draw);
    c.append(tools, body);
    draw();
    return c;
  }

  // The top of the scale: the next round number, so the lines of the scale are whole numbers.
  const scaleTop = (max) => { const steps = [4, 8, 12, 20, 40, 60, 80, 100, 200, 400, 600, 800, 1000]; return steps.find((s) => s >= max) || Math.ceil(max / 400) * 400; };

  // Applications and offers side by side, week by week or month by month; a pointer or the keyboard on a pair says its figures, and
  // "Show as a table" gives the same figures in rows.
  function chartCard(b) {
    const c = card('Applications and offers', 'Press a week or a month to see who did what in it.', 'bd-chart-card');
    const chosen = { week: -1, month: -1 }; // the column opened in each view; the latest with news until another is pressed
    const tools = el('div', 'bd-tools');
    const legend = el('div', 'bd-legend');
    [['apps', 'Applications submitted'], ['offers', 'Offers received']].forEach(([k, label]) => { const i = el('span', 'bd-key'); i.append(el('i', `bd-swatch bd-${k}`), el('span', '', label)); legend.append(i); });
    const seg = el('div', 'bd-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Show by week or by month');
    const body = el('div', 'bd-chart-body');
    const draw = () => {
      const list = spanKind === 'week' ? b.weeks : b.months;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === spanKind)));
      const total = (k) => list.reduce((n, p) => n + p[k], 0);
      const sum = el('p', 'bd-sum', `${spanKind === 'week' ? 'Last 12 weeks' : 'Last 12 months'}: ${num(total('applications'))} submitted, ${num(total('offers'))} ${total('offers') === 1 ? 'offer' : 'offers'}`);
      const top = scaleTop(Math.max(1, ...list.map((p) => Math.max(p.applications, p.offers))));
      const plot = el('div', 'bd-plot');
      const scale = el('div', 'bd-scale');
      scale.setAttribute('aria-hidden', 'true');
      // The figures of the scale stand outside the part that scrolls, so they stay in view on a phone.
      const axis = el('div', 'bd-axis');
      axis.setAttribute('aria-hidden', 'true');
      const marks = el('div', 'bd-axis-in');
      [4, 3, 2, 1, 0].forEach((i) => {
        const line = el('div', 'bd-line'); line.style.bottom = `${(i / 4) * 100}%`; scale.append(line);
        const mark = el('span', '', num((top / 4) * i)); mark.style.bottom = `${(i / 4) * 100}%`; marks.append(mark);
      });
      axis.append(marks);
      const cols = el('div', 'bd-cols');
      if (chosen[spanKind] < 0) {
        const busy = list.map((p, i) => (happened(b.people, p).length ? i : -1)).filter((i) => i >= 0);
        chosen[spanKind] = busy.length ? busy[busy.length - 1] : list.length - 1;
      }
      let panel = null;
      const choose = (i) => {
        chosen[spanKind] = i;
        cols.querySelectorAll('.bd-col').forEach((x, n) => x.setAttribute('aria-pressed', String(n === i)));
        const next = periodPanel(b.people, list[i]);
        panel.replaceWith(next); panel = next;
      };
      list.forEach((p, i) => {
        const words = `${p.title}: ${p.applications} submitted, ${p.offers} offer${p.offers === 1 ? '' : 's'}. Show who`;
        const col = h('button', { type: 'button', class: `bd-col${i > list.length - 4 ? ' is-end' : i < 3 ? ' is-start' : ''}`, 'aria-pressed': String(i === chosen[spanKind]), 'aria-label': words });
        col.addEventListener('click', () => choose(i));
        const pair = el('div', 'bd-pair');
        [['apps', p.applications], ['offers', p.offers]].forEach(([k, v]) => {
          const bar = el('div', `bd-barv bd-${k}`);
          bar.style.height = `${(v / top) * 100}%`;
          if (v) bar.append(el('span', '', num(v)));
          pair.append(bar);
        });
        const tip = el('div', 'bd-tip');
        tip.append(el('b', '', p.title), el('span', '', `${p.applications} submitted`), el('span', '', `${p.offers} offer${p.offers === 1 ? '' : 's'}`));
        col.append(pair, el('span', 'bd-x', p.label), tip);
        cols.append(col);
      });
      plot.append(scale, cols);
      const more = el('details', 'bd-table-wrap');
      more.append(el('summary', '', 'Show as a table'), table([spanKind === 'week' ? 'Week' : 'Month', 'Submitted', 'Offers'], list.map((p) => [p.title, num(p.applications), num(p.offers)])));
      const scroller = el('div', 'bd-scroll');
      scroller.append(plot);
      const graph = el('div', 'bd-graph');
      graph.append(axis, scroller);
      panel = periodPanel(b.people, list[chosen[spanKind]]);
      body.replaceChildren(sum, graph, panel, more);
      requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; }); // on a narrow screen the newest is in view
    };
    [['week', 'Weeks'], ['month', 'Months']].forEach(([k, label]) => { const x = h('button', { type: 'button', 'data-k': k }, label); x.addEventListener('click', () => { spanKind = k; draw(); }); seg.append(x); });
    tools.append(legend, seg);
    c.append(tools, body);
    draw();
    return c;
  }

  function table(heads, rows, kind = '') {
    const t = el('table', `bd-table${kind ? ` ${kind}` : ''}`);
    const hr = el('tr');
    heads.forEach((x) => { const th = el('th', '', x); th.scope = 'col'; hr.append(th); });
    const thead = el('thead'); thead.append(hr);
    const tb = el('tbody');
    rows.forEach((r) => { const tr = el('tr'); r.forEach((v, i) => { const td = el('td'); td.dataset.k = heads[i]; if (v && v.nodeType) td.append(v); else td.textContent = v; tr.append(td); }); tb.append(tr); });
    t.append(thead, tb);
    return t;
  }

  // One line with a bar: a name, the bar (its length against `max`), the figure and a small word.
  function meter(label, value, max, figure, note) {
    const row = el('div', 'bd-meter');
    const track = el('span', 'bd-track');
    const fill = el('span', 'bd-fill');
    fill.style.width = `${value && max ? Math.max(2, Math.round((value / max) * 100)) : 0}%`;
    track.append(fill);
    row.append(el('span', 'bd-meter-k', label), track, el('b', 'bd-meter-n', figure));
    if (note !== undefined) row.append(el('small', 'bd-meter-s', note));
    return row;
  }

  function journeyCard(b, after) {
    const c = card('From student to visa', 'How many of your students have reached each step. Press one to see who.');
    const total = b.journey[0].students;
    if (!total) { c.append(el('p', 'md-quiet', 'No students yet.')); return c; }
    const list = el('div', 'bd-meters');
    b.journey.forEach((s) => {
      const row = meter(s.label, s.students, total, num(s.students), `${s.share || 0}%`);
      const b2 = h('button', { type: 'button', class: 'bd-step', 'aria-expanded': 'false', 'aria-label': `${s.label}: ${s.students}. Show who` });
      b2.append(row);
      b2.addEventListener('click', () => showList(b2, after(), s.key, s.label, b.people));
      list.append(b2);
    });
    c.append(list);
    return c;
  }

  function offerDaysCard(o) {
    const c = card('Application to offer', 'The days from submitting an application to its offer.');
    if (!o.count) { c.append(el('p', 'md-quiet', 'No offer has been recorded for a submitted application yet.')); return c; }
    const hero = el('div', 'bd-hero');
    hero.append(el('b', '', num(o.average)), el('span', '', `${o.average === 1 ? 'day' : 'days'} on average`), el('small', '', `From ${o.count} application${o.count === 1 ? '' : 's'} with an offer`));
    const facts = el('div', 'bd-facts');
    [['Middle', o.median], ['Fastest', o.fastest], ['Slowest', o.slowest]].forEach(([label, v]) => { const f = el('div'); f.append(el('span', '', label), el('b', '', days(v))); facts.append(f); });
    const list = el('div', 'bd-meters');
    const max = Math.max(...o.bands.map((x) => x.count));
    o.bands.forEach((x) => list.append(meter(x.label, x.count, max, num(x.count))));
    c.append(hero, facts, list);
    return c;
  }

  function ratesCard(rates) {
    const c = card('Success rates', 'Out of those who could reach it.');
    const list = el('div', 'bd-meters');
    rates.forEach((r) => list.append(meter(r.label, r.value || 0, 100, r.value === null ? 'No data' : `${r.value}%`, r.value === null ? 'Nothing to count yet' : r.note)));
    c.append(list);
    return c;
  }

  function stepsCard(steps) {
    const c = card('How long each step takes', 'Average days, where both days are recorded.');
    c.append(table(['Step', 'Average', 'Counted'], steps.map((s) => [s.label, s.average === null ? 'No data' : days(s.average), s.count ? num(s.count) : '0'])));
    return c;
  }

  function universitiesCard(list) {
    const c = card('Universities', 'Where your students applied, and what came back.', 'bd-wide');
    if (!list.length) { c.append(el('p', 'md-quiet', 'No application has been recorded yet.')); return c; }
    const rows = list.map((u) => [u.name, num(u.applications), num(u.offers), u.rate === null ? '-' : `${u.rate}%`, u.days === null ? '-' : days(u.days)]);
    const wrap = el('div', 'bd-scroll');
    const t = table(['University', 'Applications', 'Offers', 'Offer rate', 'Days to offer'], rows.slice(0, 8));
    wrap.append(t);
    c.append(wrap);
    if (rows.length > 8) {
      const more = h('button', { type: 'button', class: 'bd-more' }, `Show all ${rows.length} Universities`);
      more.addEventListener('click', () => { t.replaceWith(table(['University', 'Applications', 'Offers', 'Offer rate', 'Days to offer'], rows)); more.remove(); });
      c.append(more);
    }
    return c;
  }

  // A student's name opens their card over the Dashboard, with the arrows going through the names of the same list.
  function studentLink(id, name, ids, cls) {
    const a = h('a', { class: cls, href: profile(id), title: 'Open the student card' }, name);
    a.addEventListener('click', (e) => {
      if (!window.CardDrawer || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.CardDrawer.open(id, { list: ids });
    });
    return a;
  }

  function waitingCard(list) {
    const c = card('Waiting for an offer', 'Submitted and not answered yet, the longest first.', 'bd-wide');
    if (!list.length) { c.append(el('p', 'md-quiet', 'No application is waiting for an offer.')); return c; }
    const ids = [...new Set(list.map((x) => x.id))];
    const rows = list.map((x) => [studentLink(x.id, x.name, ids, 'bd-name'), x.university, dayMonth(x.applied), el('span', `bd-wait${x.days > 10 ? ' is-long' : ''}`, days(x.days))]);
    const heads = ['Student', 'University', 'Submitted', 'Waiting'];
    const wrap = el('div', 'bd-scroll');
    const t = table(heads, rows.slice(0, 8), 'bd-waiting');
    wrap.append(t);
    c.append(wrap);
    if (rows.length > 8) {
      const more = h('button', { type: 'button', class: 'bd-more' }, `Show all ${rows.length}`);
      more.addEventListener('click', () => { t.replaceWith(table(heads, rows, 'bd-waiting')); more.remove(); });
      c.append(more);
    }
    return c;
  }

  function branchPage(d, page) {
    const b = d.branch;
    const two = (x, y) => { const g = el('div', 'bd-two'); g.append(x, y); return g; };
    let steps = null; // the block a step's list opens under
    steps = two(journeyCard(b, () => steps), offerDaysCard(b.offerDays));
    page.append(totalsRow(b.totals, b.people), chartCard(b), everyStudentCard(b.people), steps, two(ratesCard(b.rates), stepsCard(b.steps)),
      universitiesCard(b.universities), waitingCard(b.waiting));
  }

  api('/api/my-dashboard').then((d) => {
    document.title = 'Dashboard · Student Recruit 360';
    const page = el('div', `md-page${d.branch ? ' bd-page' : ''}`);
    const head = el('header', 'td-hello');
    head.append(el('span', 'td-kicker', d.intake ? `${d.title} · ${d.intake}` : d.title), el('h1', '', 'Dashboard'), el('p', '', d.lead));
    page.append(head);

    if (d.branch) branchPage(d, page);
    else {
      const kpis = el('div', 'md-kpis');
      d.kpis.forEach((k) => { const t = el('div', 'md-kpi'); t.append(el('span', 'md-kpi-label', k.label), el('b', '', num(k.value)), el('small', '', k.note)); kpis.append(t); });
      page.append(kpis);
    }

    // The tasks of the team, in one line, with the way to Today where they are ticked.
    const tk = el('a', 'md-taskline');
    tk.href = '/today';
    tk.append(el('b', '', d.tasks.open ? `${num(d.tasks.open)} open task${d.tasks.open === 1 ? '' : 's'}` : 'No open task'),
      el('span', 'md-taskline-go', 'Open on Today'));
    if (!d.branch) page.append(tk); // a branch's tasks are its Today

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
    grid.append(weekCard(d.week), ...(d.branch ? [] : [stagesCard(d.stages, d.stagesNote)]), // a branch's stages: "From student to visa" and All Students
      peopleCard('Coming up', 'The next 7 days.', d.upcoming, 'Nothing booked for the next 7 days.', (r) => el('span', 'md-date', shortDay(r.date))),
      peopleCard('Good news', 'The last 30 days.', d.wins, 'No news in the last 30 days yet.', (r) => el('span', 'md-date', shortDay(r.date))));
    page.append(grid);
    view.replaceChildren(page);
  }).catch((e) => view.replaceChildren(el('div', 'p-card', e.message)));
})();
