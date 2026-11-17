// The Route2Uni panel on the Fact File's list of universities (route2uni.js reads the partner portal twice a week): when it was
// last read, the deadlines of the open intakes, the Information Hub (deadlines, notices, webinars), what changed since the reading
// before, and for Admin "Check now" and the portal's universities that have no Fact File page yet ("Add"). Not for a student's
// login.
(function () {
  const { el, h, api } = window.Portal;
  const say = (t, bad) => window.NiecUI.toast(t, { type: bad ? 'error' : 'success' });
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const firstLine = (t) => String(t || '').split('\n').map((x) => x.replace(/^[•\-\s]+/, '').trim()).filter(Boolean).slice(0, 2).join(' · ');

  async function draw() {
    let d;
    try { d = await api('/api/route2uni'); } catch (e) { return; } // a student's login, or not available: no panel
    if (!d.configured && !d.universities && !d.admin) return;
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
    words.append(el('h2', '', 'Route2Uni'),
      el('p', 'p-muted p-small', !d.configured ? 'Not connected yet: set ROUTE2UNI_EMAIL and ROUTE2UNI_PASSWORD on the server, then Restart.'
        : d.running ? 'Reading the portal now (a few minutes)...'
          : d.fetchedAt ? `${d.universities} universities, read ${when(d.fetchedAt)}. Read again by itself every Monday and Thursday.` : 'Not read yet.'));
    if (d.lastRun && !d.lastRun.ok) words.append(el('div', 'p-notice warn', `The last try did not work: ${d.lastRun.error}`));
    head.append(words);
    if (d.admin && d.configured) {
      const go = h('button', { class: 'btn btn-sm', type: 'button', disabled: d.running }, d.running ? 'Reading...' : 'Check now');
      go.addEventListener('click', async () => { go.disabled = true; try { await api('/api/route2uni/run', {}); say('Reading Route2Uni. This takes a few minutes.'); setTimeout(draw, 1500); } catch (e) { say(e.message, true); go.disabled = false; } });
      head.append(go);
    }
    box.append(head);

    const tabs = [];
    if (d.deadlines.length) tabs.push(['deadlines', `Deadlines (${d.deadlines.length})`, () => {
      const ul = el('ul', 'r2u-list');
      d.deadlines.forEach((x) => { const li = el('li'); li.append(el('b', '', x.university), el('span', 'r2u-meta', x.intake), el('span', 'r2u-line', firstLine(x.deadline))); ul.append(li); });
      return ul;
    }]);
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
    if (d.admin && d.missing.length) tabs.push(['missing', `Not in the Fact File (${d.missing.length})`, () => {
      const ul = el('ul', 'r2u-list');
      d.missing.forEach((u) => {
        const li = el('li', 'r2u-missing');
        const t = el('div'); t.append(el('b', '', u.name), el('span', 'r2u-meta', [u.cities.join(', '), `${u.courses} courses`].filter(Boolean).join(' · ')));
        const add = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Add to the Fact File');
        add.addEventListener('click', async () => { add.disabled = true; try { const r = await api('/api/route2uni/add', { id: u.id }); location.href = '/fact-file?u=' + r.id; } catch (e) { say(e.message, true); add.disabled = false; } });
        li.append(t, add);
        ul.append(li);
      });
      return ul;
    }]);
    if (!tabs.length) return;
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
