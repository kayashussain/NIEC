// All Students as a student list, for the Application Team only (the owner, 24 Nov 2026, the Apple look). header.js loads this file on the
// All Students page for that team. It reads /api/students-overview (read only) and shows one row for each student: the stage, where each
// application stands, the next task for the team and the missing details. "Show as the sheet" brings the full sheet back, as it was.
// Everything is put on the page as text, never as HTML.
(function () {
  const main = document.getElementById('main');
  if (!main || document.getElementById('appleStudents')) return;
  const KEY = 'niecAppleStudentsView';
  const root = document.documentElement;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  let view = 'list';
  try { view = localStorage.getItem(KEY) === 'sheet' ? 'sheet' : 'list'; } catch (e) { /* the list */ }
  let data = null; let filter = 'all'; let query = '';

  const wrap = el('section', 'as-wrap');
  wrap.id = 'appleStudents';
  main.prepend(wrap);
  const setView = (v) => { view = v; try { localStorage.setItem(KEY, v); } catch (e) { /* not kept */ } root.classList.toggle('apple-list-on', v === 'list'); draw(); };
  root.classList.toggle('apple-list-on', view === 'list');

  const day = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const has = (s, kind) => s.apps.some((a) => a.kind === kind);
  const FILTERS = [
    ['all', 'All', () => true],
    ['apply', 'To apply', (s) => has(s, 'wait') || (s.stage === 'Application Stage' && !s.apps.length)],
    ['wait', 'Waiting for an offer', (s) => has(s, 'sent') && !has(s, 'ok')],
    ['offer', 'Offer received', (s) => has(s, 'ok')],
    ['no', 'Not submitted', (s) => s.apps.some((a) => a.kind === 'no' && a.label === 'Not submitted')],
    ['miss', 'Missing details', (s) => s.missing > 0],
  ];

  function bar() {
    const b = el('div', 'as-switch');
    [['list', 'Student list'], ['sheet', 'The sheet']].forEach(([k, label]) => {
      const btn = el('button', `as-sw${view === k ? ' is-on' : ''}`, label);
      btn.type = 'button'; btn.setAttribute('aria-pressed', String(view === k));
      btn.addEventListener('click', () => { if (view !== k) setView(k); });
      b.append(btn);
    });
    return b;
  }

  function draw() {
    wrap.replaceChildren();
    if (view === 'sheet') { wrap.classList.add('is-slim'); wrap.append(bar()); return; }
    wrap.classList.remove('is-slim');
    const top = el('div', 'as-top');
    const left = el('div', '');
    left.append(el('div', 'as-eyebrow', data ? `${data.students.length} students with the Application Team` : 'Loading the students...'), el('h1', 'as-title', 'All Students'));
    top.append(left, bar());
    wrap.append(top);
    if (!data) { const sk = el('div', 'as-card'); for (let i = 0; i < 7; i += 1) sk.append(el('div', 'as-skel')); wrap.append(sk); return; }
    const tools = el('div', 'as-tools');
    const search = el('input', 'as-search'); search.type = 'search'; search.placeholder = 'Search students'; search.value = query; search.setAttribute('aria-label', 'Search students, universities or courses');
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); rows(); });
    const seg = el('div', 'as-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show');
    FILTERS.forEach(([k, label, fn]) => {
      const n = data.students.filter(fn).length;
      const btn = el('button', `as-sw${filter === k ? ' is-on' : ''}`, label);
      btn.type = 'button'; btn.setAttribute('aria-pressed', String(filter === k));
      btn.append(el('span', 'as-n', ` ${n}`));
      btn.addEventListener('click', () => { filter = k; draw(); });
      seg.append(btn);
    });
    tools.append(search, seg);
    wrap.append(tools);
    const head = el('div', 'as-head');
    ['Student', 'Stage', 'Applications', 'Next for the team', 'Details'].forEach((t) => head.append(el('span', '', t)));
    wrap.append(head);
    const card = el('div', 'as-card'); card.id = 'asRows';
    wrap.append(card);
    rows();
  }

  function rows() {
    const box = document.getElementById('asRows'); if (!box || !data) return;
    const fn = (FILTERS.find((f) => f[0] === filter) || FILTERS[0])[2];
    const list = data.students.filter(fn).filter((s) => !query || [s.name, ...s.apps.flatMap((a) => [a.university, a.course])].join(' ').toLowerCase().includes(query));
    box.replaceChildren();
    if (!list.length) { box.append(el('div', 'as-empty', query || filter !== 'all' ? 'No student matches.' : 'No students yet.')); return; }
    list.slice(0, 300).forEach((s) => {
      const a = el('a', 'as-row'); a.href = '/student?id=' + encodeURIComponent(s.id);
      const who = el('span', 'as-who');
      who.append(el('span', 'as-av', initials(s.name)));
      const nm = el('span', 'as-nm'); nm.append(el('b', '', s.name), el('span', 'as-sub', s.intake));
      who.append(nm);
      const stage = el('span', 'as-stage'); stage.append(el('span', 'as-chip', (s.stage || '').replace(/ Stage$/, '') || 'No stage'));
      const apps = el('span', 'as-apps');
      if (!s.apps.length) apps.append(el('span', 'as-sub', 'No application yet'));
      s.apps.slice(0, 3).forEach((p) => {
        const line = el('span', 'as-app');
        line.append(el('span', 'as-uni', p.university), el('span', `as-tag is-${p.kind}`, `${p.label}${p.at && p.kind !== 'wait' ? ` ${day(p.at)}` : ''}`));
        if (p.reason) line.title = p.reason;
        apps.append(line);
      });
      if (s.apps.length > 3) apps.append(el('span', 'as-sub', `and ${s.apps.length - 3} more`));
      const next = el('span', 'as-next');
      if (s.next) { next.title = s.next.text; next.append(el('span', 'as-nt', s.next.text), el('span', `as-sub${!s.next.later && s.next.days >= 3 ? ' is-late' : ''}`, s.next.later ? `On ${day(s.next.doOn)}` : s.next.days >= 3 ? `Waiting ${s.next.days} days` : s.next.days === 0 ? 'New today' : `${s.next.days} day${s.next.days === 1 ? '' : 's'}`)); }
      else next.append(el('span', 'as-sub', 'Nothing for the team'));
      const miss = el('span', `as-miss${s.missing ? ' is-miss' : ''}`, s.missing ? `${s.missing} missing` : 'All in');
      a.append(who, stage, apps, next, miss, el('span', 'as-chev'));
      box.append(a);
    });
    if (list.length > 300) box.append(el('div', 'as-empty', `Showing the first 300 of ${list.length}. Search to narrow the list.`));
  }

  draw();
  fetch('/api/students-overview', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('The list could not be loaded.'))))
    .then((d) => { data = d; draw(); })
    .catch(() => { root.classList.remove('apple-list-on'); view = 'sheet'; draw(); }); // the sheet stays usable
})();
