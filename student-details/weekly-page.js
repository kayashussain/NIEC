// The weekly summary (the owner, 17 Nov 2026): one page for Admin and the Manager to read on a Monday, or print for a meeting.
// The last 7 days against the 7 before, for every intake: how far the students moved, who got a visa or an offer, what the teams
// did, where the new students came from, and what is still open. "Earlier week" and "Later week" move a week at a time.
(function () {
  const { el, h, api, day, stagePill } = window.Portal;
  const view = document.getElementById('view');
  let ago = Math.max(0, Number.parseInt(new URLSearchParams(location.search).get('ago') || '0', 10) || 0);

  const short = (iso) => day(iso).replace(/ \d{4}$/, '');
  // "3 more than the week before" in green, "2 fewer" in orange, "Same as the week before" in grey.
  function change(now, before) {
    const d = now - before;
    const t = el('span', 'wk-change ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same'));
    t.textContent = d === 0 ? 'Same as the week before' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} than the week before (${before})`;
    return t;
  }
  function tile(label, now, before) {
    const c = el('div', 'wk-tile');
    c.append(el('span', 'wk-tile-label', label), el('b', 'wk-tile-n', String(now)), change(now, before));
    return c;
  }
  function people(title, list, empty) {
    const c = el('section', 'p-card wk-card');
    c.append(el('h2', '', title));
    if (!list.length) { c.append(el('p', 'wk-empty', empty)); return c; }
    const ul = el('ul', 'wk-people');
    list.forEach((s) => {
      const li = el('li');
      const a = h('a', { href: '/student?id=' + encodeURIComponent(s.id) }, s.name || 'Student');
      const meta = el('span', 'wk-meta', [s.university, s.intake].filter(Boolean).join(' · '));
      li.append(el('span', 'wk-day', short(s.day)), el('span', 'wk-who', ''), stagePill(s.stage));
      li.children[1].append(a, meta);
      ul.append(li);
    });
    c.append(ul);
    return c;
  }
  function bars(title, list, empty) {
    const c = el('section', 'p-card wk-card');
    c.append(el('h2', '', title));
    if (!list.length) { c.append(el('p', 'wk-empty', empty)); return c; }
    const max = Math.max(...list.map((x) => x.n));
    list.forEach((x) => {
      const r = el('div', 'wk-bar');
      const fill = el('i');
      fill.style.width = `${Math.max(4, Math.round((x.n / max) * 100))}%`;
      const track = el('span', 'wk-track'); track.append(fill);
      r.append(el('span', 'wk-bar-label', x.label), track, el('b', '', String(x.n)));
      c.append(r);
    });
    return c;
  }

  function draw(d) {
    const page = el('div', 'wk-page');
    const top = el('header', 'wk-top');
    const titles = el('div');
    titles.append(el('div', 'wk-eyebrow', d.ago === 0 ? 'This week' : d.ago === 1 ? 'Last week' : `${d.ago} weeks ago`), el('h1', '', 'Weekly summary'),
      el('p', 'wk-lead', `${day(d.from)} to ${day(d.to)}, every intake, compared with ${short(d.prevFrom)} to ${short(d.prevTo)}.`));
    const nav = el('div', 'wk-nav no-print');
    const go = (n) => { ago = n; history.replaceState(null, '', n ? `?ago=${n}` : location.pathname); load(); };
    nav.append(h('button', { class: 'btn', type: 'button', onclick: () => go(Math.min(104, ago + 1)) }, '‹ Earlier week'),
      h('button', { class: 'btn', type: 'button', disabled: ago === 0, onclick: () => go(ago - 1) }, 'Later week ›'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.print() }, 'Print'));
    top.append(titles, nav);
    page.append(top);

    // The headline: the week in one sentence.
    const s = Object.fromEntries(d.steps.map((x) => [x.key, x]));
    const parts = [[s.inquiries.now, 'new student', 'new students'], [s.applications.now, 'application', 'applications'], [s.offers.now, 'offer', 'offers'], [s.visas.now, 'visa', 'visas']]
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    page.append(el('p', 'wk-headline', `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`));

    const tiles = el('div', 'wk-tiles');
    d.steps.forEach((x) => tiles.append(tile(x.label, x.now, x.before)));
    page.append(tiles);

    const grid = el('div', 'wk-grid');
    grid.append(people('Visas received', d.people.visas, 'No visa received this week.'), people('Offers received', d.people.offers, 'No offer received this week.'),
      people('Deposits paid', d.people.payments, 'No deposit paid this week.'), people('Applications submitted', d.people.applications, 'No application submitted this week.'));
    page.append(grid);

    const work = el('section', 'p-card wk-card');
    work.append(el('h2', '', 'The teams\' work'));
    const wt = el('div', 'wk-tiles is-small');
    d.work.forEach((x) => wt.append(tile(x.label, x.now, x.before)));
    work.append(wt);
    const still = el('p', 'wk-still');
    still.append(`Open now: ${d.openTasks} ${d.openTasks === 1 ? 'task' : 'tasks'}, and `, h('a', { href: '/data-to-fix' }, `${d.toFix} ${d.toFix === 1 ? 'gap' : 'gaps'} in Data to fix`), '.');
    work.append(still);
    page.append(work);

    const grid2 = el('div', 'wk-grid');
    grid2.append(bars('Tasks done, by team', d.teams, 'No task was done this week.'), bars('New students, by source', d.sources, 'No new student with a first inquiry day this week.'));
    page.append(grid2);
    page.append(el('p', 'wk-foot', `Made ${day(d.today)}. Each step counts on the day it happened, as written on All Students.`));
    view.replaceChildren(page);
  }

  async function load() {
    try { draw(await api('/api/weekly?ago=' + ago)); } catch (e) { view.replaceChildren(el('div', 'p-card p-msg error', e.message)); }
  }
  load();
})();
