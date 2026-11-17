// Data to fix (the owner, 17 Nov 2026): every gap in the students this account sees, on one page, grouped by what is missing.
// Each gap is filled in where it is listed (a day, a passport number, a phone number) and saved straight to All Students or the
// student card, with no card to open; what needs a closer look (dates that do not add up, the source) opens the card.
// "Work through them" opens the first student of a group with Previous and Next on the card, so a whole list is done in a row.
(function () {
  const { el, h, api, stagePill } = window.Portal;
  const view = document.getElementById('view');
  const say = (text, error) => window.NiecUI.toast(text, { type: error ? 'error' : 'success' });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayWords = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : iso; };
  const SHOWN = 8; // rows of a group before "Show all"
  let data = null;
  let only = ''; // the group shown, or '' for all
  const opened = new Set(); // groups showing every row

  const cardHref = (id) => '/student?id=' + encodeURIComponent(id);
  // The students of a group, in order, for Previous and Next on the card (see student-page.js).
  function workThrough(g, startId) {
    const ids = g.students.map((s) => s.id);
    try { sessionStorage.setItem('isrQueue', JSON.stringify({ label: g.title, ids, back: '/data-to-fix' })); } catch (e) { /* the card opens without Previous and Next */ }
    location.href = cardHref(startId || ids[0]);
  }

  function fixer(g, s, row) {
    const f = s.fix;
    const box = el('div', 'df-fix');
    if (!f) {
      box.append(h('a', { class: 'btn btn-sm', href: cardHref(s.id), onclick: (e) => { e.preventDefault(); workThrough(g, s.id); } }, data.readOnly ? 'Open the card' : 'Open the card to fix'));
      return box;
    }
    const input = h('input', { type: f.kind === 'date' ? 'date' : 'text', class: 'df-input', 'aria-label': `${f.label} for ${s.name}`, placeholder: f.label, maxlength: f.max || 200 });
    if (f.kind === 'date' && f.field === 'dob') input.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const ok = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, 'Save');
    const ready = () => { ok.disabled = !input.value.trim(); };
    input.addEventListener('input', ready);
    input.addEventListener('change', ready);
    const go = async () => {
      let v = input.value.trim();
      if (!v) return;
      if (f.upper) v = v.toUpperCase();
      ok.disabled = true;
      try {
        if (f.on === 'profile') await api(`/api/cards/${encodeURIComponent(s.id)}/profile`, { [f.field]: v });
        else await api(`/api/cards/${encodeURIComponent(s.id)}/sheet`, { fields: { [f.field]: v } });
        say(`Saved: ${s.name}, ${f.label.toLowerCase()} ${f.kind === 'date' ? dayWords(v) : v}`);
        done(g, s, row);
      } catch (e) { say(e.message, true); ok.disabled = false; input.focus(); }
    };
    ok.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    box.append(input, ok);
    return box;
  }

  // A gap filled: the row leaves the list softly and the numbers go down.
  function done(g, s, row) {
    g.students = g.students.filter((x) => x !== s);
    g.count = g.students.length;
    data.total -= 1;
    row.classList.add('is-done');
    setTimeout(() => { draw(); }, 420);
  }

  function groupCard(g) {
    const c = el('section', 'p-card df-group');
    c.id = 'g-' + g.key;
    const head = el('div', 'df-group-head');
    const t = el('div', 'df-group-title');
    t.append(el('h2', '', g.title), el('span', 'df-count', String(g.count)));
    head.append(t);
    if (g.count > 1) head.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => workThrough(g) }, 'Work through them'));
    c.append(head, el('p', 'df-hint', g.hint));
    const list = el('ul', 'df-list');
    const rows = opened.has(g.key) ? g.students : g.students.slice(0, SHOWN);
    rows.forEach((s) => {
      const li = el('li', 'df-row');
      const who = el('div', 'df-who');
      const name = h('a', { class: 'df-name', href: cardHref(s.id) }, s.name || 'Student with no name yet');
      const meta = el('div', 'df-meta');
      if (s.stage) meta.append(stagePill(s.stage));
      meta.append(el('span', '', [s.intake, s.university].filter(Boolean).join(' · ')));
      who.append(name, meta);
      const what = el('div', 'df-detail', s.detail);
      li.append(who, what, fixer(g, s, li));
      list.append(li);
    });
    c.append(list);
    if (g.students.length > SHOWN && !opened.has(g.key)) c.append(h('button', { class: 'p-link df-more', type: 'button', onclick: () => { opened.add(g.key); draw(); } }, `Show all ${g.students.length}`));
    return c;
  }

  function draw() {
    const page = el('div', 'df-page');
    const top = el('header', 'df-top');
    top.append(el('div', 'df-eyebrow', 'Keep the records right'), el('h1', '', 'Data to fix'));
    const left = data.groups.filter((g) => g.count);
    const people = new Set(left.flatMap((g) => g.students.map((s) => s.id))).size;
    top.append(el('p', 'df-lead', data.total
      ? `${data.total} ${data.total === 1 ? 'gap' : 'gaps'} in ${people} ${people === 1 ? 'student' : 'students'}. Fill each one in here: it saves straight to All Students and the student card.`
      : 'Nothing to fix. Every student you see has the details their stage needs.'));
    page.append(top);
    if (!data.total) {
      const ok = el('div', 'p-card df-clear');
      ok.append(el('span', 'df-clear-mark', '✓'), el('b', '', 'All clear'), el('span', 'p-muted', 'New gaps appear here as soon as a student moves on without them.'));
      page.append(ok);
      view.replaceChildren(page);
      return;
    }
    // The groups as pills, the biggest first: a click shows only that group.
    const pills = el('div', 'df-pills');
    pills.setAttribute('role', 'group');
    pills.setAttribute('aria-label', 'Show');
    const pill = (key, label, n) => { const b = h('button', { type: 'button', class: 'df-pill' + (only === key ? ' on' : ''), 'aria-pressed': String(only === key), onclick: () => { only = key; draw(); } }, label); if (n !== undefined) b.append(el('span', 'df-pill-n', String(n))); return b; };
    pills.append(pill('', 'All', data.total));
    [...left].sort((a, b) => b.count - a.count).forEach((g) => pills.append(pill(g.key, g.title, g.count)));
    page.append(pills);
    (only ? left.filter((g) => g.key === only) : left).forEach((g) => page.append(groupCard(g)));
    if (only && !left.some((g) => g.key === only)) { only = ''; draw(); return; }
    view.replaceChildren(page);
  }

  async function load() {
    try {
      data = await api('/api/data-to-fix');
      const want = new URLSearchParams(location.search).get('show');
      if (want && data.groups.some((g) => g.key === want)) only = want;
      draw();
    } catch (e) {
      view.replaceChildren(el('div', 'p-card p-msg error', e.message));
    }
  }
  load();
})();
