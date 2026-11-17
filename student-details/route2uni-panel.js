// One quiet line on the Fact File's list of universities (the owner, 17 Nov 2026: one Fact File, no separate lists): the Fact File is
// kept up to date from the Route2Uni partner portal twice a week (route2uni.js, fact-sync.js) and from the Navitas product toolkit
// (navitas-toolkit.js), when it was last read, what changed
// since the reading before, and any notice or webinar of the portal's Information Hub. Nothing is started by hand (the owner, 17 Nov
// 2026: it runs by itself twice a week). The deadlines are at the top of each university's page. Not for a student's login.
(function () {
  const { el, h, api } = window.Portal;
  const say = (t, bad) => window.NiecUI.toast(t, { type: bad ? 'error' : 'success' });
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const firstLine = (t) => String(t || '').split('\n').map((x) => x.replace(/^[•\-\s]+/, '').trim()).filter(Boolean).slice(0, 2).join(' · ');

  async function draw() {
    let d;
    try { d = await api('/api/route2uni'); } catch (e) { return; } // a student's login, or not available: no panel
    const nav = d.navitas || {};
    if (!d.configured && !d.universities && !d.admin && !nav.fetchedAt) return;
    let box = document.getElementById('r2uPanel');
    if (!box) {
      box = el('section', 'p-card r2u-panel no-print');
      box.id = 'r2uPanel';
      const count = document.getElementById('count');
      count.parentNode.insertBefore(box, count);
    }
    box.replaceChildren();
    const head = el('div', 'r2u-panel-head');
    const words = el('div');
    words.append(el('h2', '', 'Kept up to date by itself, every Monday and Thursday'),
      el('p', 'p-muted p-small', !d.configured ? 'Not connected yet: set ROUTE2UNI_EMAIL and ROUTE2UNI_PASSWORD on the server, then Restart.'
        : d.running ? 'Reading the portal now (a few minutes)...'
          : d.fetchedAt ? `Route2Uni: ${d.universities} universities, last read ${when(d.fetchedAt)}.` : 'Route2Uni: not read yet.'));
    if (d.lastRun && !d.lastRun.ok) words.append(el('div', 'p-notice warn', `The last try did not work: ${d.lastRun.error}`));
    // The course pages (course-sitemap.js): when the last batch ran, and how many courses need their link added by hand.
    if (d.links && d.links.lastRun) words.append(el('p', 'p-muted p-small', `Course pages: last checked ${when(d.links.lastRun.at)}.${d.links.notFound ? ` ${d.links.notFound} course${d.links.notFound === 1 ? '' : 's'} not found (marked in amber on each university's page).` : ''}${d.links.unreadable.length ? ` Website not readable: ${d.links.unreadable.slice(0, 6).join(', ')}${d.links.unreadable.length > 6 ? ' ...' : ''}.` : ''}`));
    // The Navitas product toolkit (navitas-toolkit.js): its UK colleges, each on its own page, read twice a week.
    if (nav.enabled) {
      words.append(el('p', 'p-muted p-small', nav.running ? 'Reading the Navitas product toolkit now...'
        : nav.fetchedAt ? `Navitas: ${nav.colleges} UK colleges, last read ${when(nav.fetchedAt)}.` : 'Navitas: not read yet.'));
      if (nav.lastRun && !nav.lastRun.ok) words.append(el('div', 'p-notice warn', `The last Navitas toolkit reading did not work: ${nav.lastRun.error}`));
    }
    head.append(words);
    box.append(head);

    const tabs = [];
    const hub = [...d.hub.deadlines.map((x) => ['Deadline', x]), ...d.hub.notices.map((x) => ['Notice', x]), ...d.hub.webinars.map((x) => ['Webinar', x])];
    if (hub.length) tabs.push(['hub', `Information Hub (${hub.length})`, () => {
      const ul = el('ul', 'r2u-list');
      hub.forEach(([kind, x]) => {
        const li = el('li');
        li.append(el('b', '', `${kind}: ${x.title}`), el('span', 'r2u-meta', [x.university, x.when && when(x.when) || x.when].filter(Boolean).join(' · ')));
        if (x.details) li.append(el('span', 'r2u-line', x.details.slice(0, 300)));
        if (x.link) { const a = el('a', 'p-link', 'Open'); a.href = x.link; a.target = '_blank'; a.rel = 'noopener'; li.append(a); }
        ul.append(li);
      });
      return ul;
    }]);
    if (d.changes.length) tabs.push(['changes', `What changed (${d.changes.length})`, () => {
      const ul = el('ul', 'r2u-list');
      d.changes.forEach((c) => { const li = el('li'); li.append(el('b', '', c.university), el('span', 'r2u-meta', when(c.at))); c.lines.forEach((l) => li.append(el('span', 'r2u-line', l))); ul.append(li); });
      return ul;
    }]);
    if (!tabs.length) { if (d.configured) box.append(el('span', 'r2u-meta', 'Nothing has changed since the reading before.')); return; }
    const bar = el('div', 'p-tabs r2u-tabs');
    bar.setAttribute('role', 'tablist');
    const body = el('div', 'r2u-body');
    let open = '';
    const show = (k) => {
      open = open === k ? '' : k;
      bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === open)));
      const t = tabs.find((x) => x[0] === open);
      body.replaceChildren(...(t ? [t[2]()] : []));
    };
    tabs.forEach(([k, label]) => { const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, label); b.dataset.k = k; b.addEventListener('click', () => show(k)); bar.append(b); });
    box.append(bar, body);
    if (d.running) setTimeout(draw, 20000);
  }
  if (!new URLSearchParams(location.search).get('backup')) draw();
})();
