// My dashboard: each team's own page (Application, Mock, Follow-up, a branch). How the team's work is going, in the team's own
// words: four figures, this week against last week, where its students are, what is coming up in the next 7 days, the good news
// of the last 30 days and the team's tasks. Admin and the Manager have the full Dashboard instead. A branch's goes deeper (the
// owner, 27 Nov 2026, branch-insights.js): eight totals, applications and offers week by week and month by month, from student to
// visa, the days from application to offer, success rates, how long each step takes, each University and who waits for an offer.
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
  const dayMonth = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const days = (n) => `${num(n)} day${n === 1 ? '' : 's'}`;
  const profile = (id) => '/student?id=' + encodeURIComponent(id);
  let spanKind = 'week'; // which chart: weeks or months

  function totalsRow(totals) {
    const grid = el('div', 'bd-totals');
    totals.forEach((t) => {
      const box = el('div', `bd-total bd-total-${t.key}`);
      box.append(el('span', 'bd-total-k', t.label), el('b', 'bd-total-n', num(t.value)), el('small', '', t.note));
      grid.append(box);
    });
    return grid;
  }

  // The top of the scale: the next round number, so the lines of the scale are whole numbers.
  const scaleTop = (max) => { const steps = [4, 8, 12, 20, 40, 60, 80, 100, 200, 400, 600, 800, 1000]; return steps.find((s) => s >= max) || Math.ceil(max / 400) * 400; };

  // Applications and offers side by side, week by week or month by month; a pointer or the keyboard on a pair says its figures, and
  // "Show as a table" gives the same figures in rows.
  function chartCard(b) {
    const c = card('Applications and offers', 'When applications were submitted and offers came in.', 'bd-chart-card');
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
      list.forEach((p, i) => {
        const words = `${p.title}: ${p.applications} submitted, ${p.offers} offer${p.offers === 1 ? '' : 's'}`;
        const col = el('div', `bd-col${i > list.length - 4 ? ' is-end' : i < 3 ? ' is-start' : ''}`);
        col.tabIndex = 0;
        col.setAttribute('role', 'img');
        col.setAttribute('aria-label', words);
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
      body.replaceChildren(sum, graph, more);
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

  function journeyCard(b) {
    const c = card('From student to visa', 'How many of your students have reached each step.');
    const total = b.journey[0].students;
    if (!total) { c.append(el('p', 'md-quiet', 'No students yet.')); return c; }
    const list = el('div', 'bd-meters');
    b.journey.forEach((s) => list.append(meter(s.label, s.students, total, num(s.students), `${s.share || 0}%`)));
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
    page.append(totalsRow(b.totals), chartCard(b), two(journeyCard(b), offerDaysCard(b.offerDays)), two(ratesCard(b.rates), stepsCard(b.steps)),
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
