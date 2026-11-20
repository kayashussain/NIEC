// Universities list: every university as a card, and a search box that also finds courses ("cyber security" shows who teaches it).
// The list is kept by the automatic readings only (the owner, 17 Nov 2026): nobody adds a university here.
(function () {
  const $ = (id) => document.getElementById(id);
  let list = [];
  let query = '';
  let loadedOnce = false;
  // ?backup=ID: this is an earlier daily backup, read only (see backup-bar.js).
  const BACKUP = new URLSearchParams(location.search).get('backup') || '';
  const API = BACKUP ? '/api/restore/snapshot/' + encodeURIComponent(BACKUP) + '/facts' : '/api/facts';
  let searchTimer = null;
  let searchSeq = 0; // answers arriving out of order: only the latest search is shown
  // The filters above the cards (the owner, 17 Nov 2026: find the right university in seconds), kept in this browser.
  const FKEY = 'isrFactFilters';
  // Two lists only, Universities and Pathway colleges, never both mixed (the owner, 17 Nov 2026: "remove All"). A choice of "all"
  // kept in a browser from before becomes Universities.
  const KINDS = ['university', 'pathway'];
  const filters = (() => { try { return { kind: 'university', intake: '', ...JSON.parse(localStorage.getItem(FKEY) || '{}') }; } catch (e) { return { kind: 'university', intake: '' }; } })();
  if (!KINDS.includes(filters.kind)) filters.kind = 'university';
  const kindOf = (u) => (u.kind === 'pathway' ? 'pathway' : 'university');
  const saveFilters = () => { try { localStorage.setItem(FKEY, JSON.stringify(filters)); } catch (e) { /* kept for this page only */ } };
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const intakeOrder = (n) => { const m = /([A-Za-z]{3,9})\s+(\d{4})/.exec(n || ''); return m ? +m[2] * 12 + Math.max(0, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())) : 1e9; };
  const urgency = (days) => (days <= 7 ? 'is-urgent' : days <= 30 ? 'is-soon' : '');
  const left = (days) => (days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`);
  // The next deadline, on a card: "Apply by 4 Dec 2026 · January 2027" and the days left.
  function nextLine(u) {
    const n = el('div', 'uc-next');
    if (!u.next) return null;
    const t = el('span', 'uc-next-text');
    t.append('Apply by ', el('b', '', u.next.when), el('span', 'uc-next-intake', u.next.intake));
    n.append(t, el('span', `uc-days ${urgency(u.next.days)}`.trim(), left(u.next.days)));
    return n;
  }
  function shown() {
    let out = list.filter((u) => kindOf(u) === filters.kind && (!filters.intake || (u.intakes || []).includes(filters.intake)));
    // Always the nearest deadline first (the owner, 20 Nov 2026: no Sort menu).
    if (!query) out = out.slice().sort((a, b) => (a.next ? a.next.days : 1e6) - (b.next ? b.next.days : 1e6) || a.name.localeCompare(b.name));
    return out;
  }
  function drawBar() {
    const bar = $('ffBar');
    bar.hidden = !loadedOnce || !all.length;
    // Each side of the switch says how many it holds (of the search, while searching), so a match on the other side is never missed.
    bar.querySelectorAll('#ffKind button').forEach((b) => {
      const on = b.dataset.k === filters.kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      const n = list.filter((u) => kindOf(u) === b.dataset.k).length;
      b.replaceChildren(el('span', '', b.dataset.k === 'pathway' ? 'Pathway colleges' : 'Universities'), el('span', 'ff-n', String(n)));
    });
    const sel = $('ffIntake');
    const names = [...new Set(all.flatMap((u) => u.intakes || []))].sort((a, b) => intakeOrder(a) - intakeOrder(b) || a.localeCompare(b));
    if (filters.intake && !names.includes(filters.intake)) filters.intake = '';
    sel.replaceChildren(new Option('Any intake', ''), ...names.map((n) => new Option(n, n)));
    sel.value = filters.intake;
    $('ffClear').hidden = !filters.intake;
    // How many deadlines of this list close in the next two weeks, with one click to see them first.
    const soon = all.filter((u) => kindOf(u) === filters.kind && u.next && u.next.days <= 14);
    const word = filters.kind === 'pathway' ? ['pathway college closes', 'pathway colleges close'] : ['university closes', 'universities close'];
    const box = $('ffSoon');
    box.hidden = !soon.length || query !== '';
    if (!box.hidden) box.replaceChildren(el('span', 'ff-soon-dot'), el('span', '', `${soon.length} ${word[soon.length === 1 ? 0 : 1]} applications in the next 14 days.`));
  }
  let all = []; // every university (the list without a search), for the intake menu and the closing-soon line

  const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Two letters from the university's name ("University of West London" -> "WL"), for the little badge on its card.
  function monogram(name) {
    const words = String(name || '').replace(/\(.*?\)/g, ' ').split(/[^A-Za-z]+/).filter((w) => w && !/^(of|the|and|for|in)$/i.test(w) && !/^university$/i.test(w));
    const pick = words.length ? words : String(name || '?').split(/\s+/);
    return (pick.length > 1 ? pick[0][0] + pick[pick.length - 1][0] : String(pick[0] || '?').slice(0, 2)).toUpperCase();
  }

  // Whether this account shortlists for students (the team; not a student's own login, not a view-only account, not a backup).
  let team = false;
  const expanded = new Set(); // universities whose whole course list is open
  const uniHref = (u) => '/fact-file?u=' + encodeURIComponent(u.id) + (BACKUP ? '&backup=' + encodeURIComponent(BACKUP) : '');

  // A university of the list. While searching a course ("nursing"), the card lists every matching course with its level and intake,
  // each with Shortlist for the team, so nobody opens university after university (the owner, 17 Nov 2026).
  // The university's logo where its partner gives one (the owner, 20 Nov 2026), else its initials.
  function mono(u) {
    const m = el('span', 'uni-mono' + (u.logo ? ' has-logo' : ''), u.logo ? '' : monogram(u.name));
    if (u.logo) { const i = el('img'); i.src = u.logo; i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); m.classList.remove('has-logo'); m.textContent = monogram(u.name); }); m.append(i); }
    return m;
  }
  function card(u) {
    const courses = query && u.courses && u.courses.length ? u.courses : null;
    if (courses) return boardCard(u, courses);
    // A card: the badge and the name with the city, the intakes, the next deadline when one is open, then how many courses.
    const a = el('a', 'uni-card uc-card has-cover' + (kindOf(u) === 'pathway' ? ' is-pathway' : ''));
    a.href = uniHref(u);
    // A wide picture of the university at the top of its card (the owner, 20 Nov 2026: big, engaging cards); a soft colour where there is none.
    const cover = el('div', 'uc-cover' + (u.cover ? '' : ' is-blank'));
    if (u.cover) { const i = el('img'); i.src = u.cover; i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); cover.classList.add('is-blank'); }); cover.append(i); }
    a.append(cover);
    const head = el('div', 'uc-head');
    const title = el('div', 'uc-title');
    title.append(el('h2', '', u.name), el('div', 'city', u.city || u.profileCity || 'Details not added yet'));
    head.append(mono(u), title);
    a.append(head);

    if (u.intakes.length) {
      const chips = el('div', 'chips');
      u.intakes.forEach((n) => chips.append(el('span', 'chip', n)));
      a.append(chips);
    }
    const next = nextLine(u);
    if (next) a.append(next);
    else if (u.deadline) a.append(el('div', 'uc-deadline', u.deadline));
    const foot = el('div', 'uc-foot');
    foot.append(el('span', 'uc-count', u.courseCount ? `${u.courseCount} course${u.courseCount === 1 ? '' : 's'}` : 'Courses not listed yet'));
    if (!u.next && !u.deadline) foot.append(el('span', 'uc-nodate', 'No open deadline'));
    a.append(foot);
    if (u.updatedAt && (Date.now() - new Date(u.updatedAt).getTime()) > 90 * 86400000) a.append(el('div', 'updated', 'Last updated ' + when(u.updatedAt) + ', check it'));
    return a;
  }
  function boardCard(u, courses) {
    const c = el('article', 'uni-card is-board' + (kindOf(u) === 'pathway' ? ' is-pathway' : ''));
    const top = el('div', 'ub-top');
    const name = el('a', 'ub-name', u.name);
    name.href = uniHref(u);
    const words = el('div', 'ub-words');
    words.append(name, el('span', 'city', [u.city, u.intakes.join(', ')].filter(Boolean).join(' · ')));
    top.append(mono(u), words);
    const open = el('a', 'btn btn-sm ub-open', 'Open');
    open.href = uniHref(u);
    top.append(open);
    c.append(top);
    const next = nextLine(u);
    if (next) c.append(next);
    c.append(el('div', 'ub-count', `${courses.length} matching course${courses.length === 1 ? '' : 's'}`));
    const ul = el('ul', 'ub-courses');
    const SHOW = 6;
    courses.forEach((co, n) => {
      const li = el('li');
      if (n >= SHOW && !expanded.has(u.id)) li.hidden = true;
      const t = el('div', 'ub-course');
      t.append(el('span', 'ub-course-name', co.course));
      const level = co.level && window.FactPresent ? window.FactPresent.levelGroup(co.level) : co.level;
      const meta = [level, co.intakes.join(', ')].filter(Boolean).join(' · ');
      if (meta) t.append(el('span', 'ub-meta', meta));
      li.append(t);
      if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: u.id, name: u.name }, co.course, co.intakes[0] || ''));
      else if (team) li.append(window.ShortlistFor.button({ universityId: u.id, university: u.name, course: co.course, intake: co.intakes[0] || (u.intakes.length === 1 ? u.intakes[0] : ''), level: level || '' }));
      ul.append(li);
    });
    c.append(ul);
    if (courses.length > SHOW && !expanded.has(u.id)) {
      const more = el('button', 'p-link ub-more', `Show all ${courses.length}`);
      more.type = 'button';
      more.addEventListener('click', () => { expanded.add(u.id); ul.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); more.remove(); });
      c.append(more);
    }
    return c;
  }

  function skeletons() {
    $('cards').replaceChildren(...Array.from({ length: 9 }, () => {
      const c = el('div', 'uni-card skeleton');
      c.setAttribute('aria-hidden', 'true');
      c.append(el('span', 'ui-skeleton line-lg'), el('span', 'ui-skeleton line-sm'), el('span', 'ui-skeleton line-chip'));
      return c;
    }));
  }

  function render() {
    const box = $('cards');
    drawBar();
    const rows = shown();
    const filtered = Boolean(filters.intake) || rows.length !== list.length;
    const noun = (n) => (filters.kind === 'pathway' ? (n === 1 ? 'pathway college' : 'pathway colleges') : (n === 1 ? 'university' : 'universities'));
    $('count').textContent = loadedOnce && list.length ? `${rows.length} ${noun(rows.length)}${query ? (rows.length === 1 ? ' matches' : ' match') : ''}${filters.intake ? ' with a ' + filters.intake + ' intake' : ''}` : '';
    if (!rows.length) {
      const empty = el('div', 'ui-empty');
      const why = filtered && list.length;
      empty.append(el('span', 'ui-empty-icon', query || why ? '🔍' : '🎓'), el('strong', '', why ? `No ${noun(1)} with these filters` : query ? 'No university matches' : 'No universities yet'),
        el('span', '', why ? `Try ${filters.kind === 'pathway' ? 'Universities' : 'Pathway colleges'} above, choose "Any intake", or press Clear filters.` : query ? 'Try a university name, a city or a course such as "data science".' : 'The universities appear here after the first automatic reading.'));
      box.replaceChildren(empty);
      return;
    }
    const board = Boolean(query) && rows.some((u) => u.courses && u.courses.length);
    box.classList.toggle('is-board', board);
    const out = rows.map(card);
    // No "Choose the student first" bar (the owner, 20 Nov 2026): Shortlist asks for the student, and the shortlist sits at the bottom.
    box.replaceChildren(...out);
  }

  async function load() {
    const seq = ++searchSeq;
    try {
      const res = await fetch(API + (query ? '?q=' + encodeURIComponent(query) : ''), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (seq !== searchSeq) return;
      list = data;
      if (!query) all = data;
      loadedOnce = true;
      $('msg').textContent = '';
      render();
    } catch (e) {
      if (seq !== searchSeq) return;
      $('msg').textContent = 'Could not load Universities. Please reload the page.';
      $('msg').className = 'msg error';
      if (!loadedOnce) $('cards').replaceChildren();
    }
  }

  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    query = $('search').value.trim().slice(0, 100);
    searchTimer = setTimeout(load, 180);
  });
  $('ffKind').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; filters.kind = b.dataset.k; saveFilters(); render(); });
  $('ffIntake').addEventListener('change', () => { filters.intake = $('ffIntake').value; saveFilters(); render(); });
  $('ffClear').addEventListener('click', () => { Object.assign(filters, { intake: '' }); saveFilters(); render(); });
  // Esc in the search box clears it.
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('search').value) { $('search').value = ''; query = ''; load(); } });
  // "/" jumps to the search box, like on most sites.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $('search').focus();
    }
  });
  // The option finder for a student, above the list (not on an earlier backup, which is only looked at).
  skeletons();
  load();
  // Who can go where (finder.js): at the top of Universities, for the team and for a student's own login.
  if (window.Finder && !BACKUP) {
    const box = document.createElement('div');
    box.id = 'finderBox';
    const anchor = document.querySelector('.page-head');
    anchor.after(box);
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(async (me) => {
      const student = me.role === 'student';
      if (!student && window.ShortlistFor && !(window.TeamRules && window.TeamRules.isReadOnly(me))) {
        await window.ShortlistFor.ready();
        team = true;
        window.ShortlistFor.tray();
        window.ShortlistFor.onChange(render);
        if (loadedOnce) render();
      }
      window.Finder.mount(box, student
        ? { title: 'Find the universities you can go to', intro: 'Enter your level, your grade, your study gap and your English test. Press "I am interested" on the courses you like.' }
        : { title: 'Find universities for a student', shortlist: Boolean(window.ShortlistFor) && !(window.TeamRules && window.TeamRules.isReadOnly(me)) });
      const shortlist = document.getElementById('shortlist');
      if (shortlist) box.before(shortlist); // a student's welcome and shortlist first
    }).catch(() => {});
  }
})();

// A line under the search box when the weekly check of the course pages has warnings (the details are on each university's page).
fetch('/api/course-watch', { cache: 'no-store' }).then((r) => r.json()).then((r) => {
  if (!r.summary || !r.summary.warnings) return;
  const count = document.getElementById('count');
  const note = document.createElement('div');
  note.className = 'p-notice warn';
  note.textContent = `${r.summary.warnings} course page${r.summary.warnings === 1 ? '' : 's'} need${r.summary.warnings === 1 ? 's' : ''} a look (gone, renamed or changed).`;
  count.parentNode.insertBefore(note, count);
}).catch(() => {});
