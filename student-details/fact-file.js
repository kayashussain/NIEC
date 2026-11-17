// The Fact File list: every university as a card, and a search box that also finds courses ("cyber security" shows who teaches it).
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
  function card(u) {
    const courses = query && u.courses && u.courses.length ? u.courses : null;
    if (courses) return boardCard(u, courses);
    const a = el('a', 'uni-card');
    a.href = uniHref(u);
    a.append(el('span', 'uni-mono', monogram(u.name)));
    a.append(el('h2', '', u.name));
    if (u.city) a.append(el('div', 'city', u.city));
    if (u.intakes.length) {
      const chips = el('div', 'chips');
      u.intakes.forEach((n) => chips.append(el('span', 'chip', n)));
      a.append(chips);
    }
    if (!u.city && !u.intakes.length) a.append(el('div', 'city', 'Details not added yet'));
    a.append(el('div', 'updated', u.updatedAt && (Date.now() - new Date(u.updatedAt).getTime()) > 90 * 86400000 ? 'Last updated ' + when(u.updatedAt) + ', check it' : ''));
    return a;
  }
  function boardCard(u, courses) {
    const c = el('article', 'uni-card is-board');
    const top = el('div', 'ub-top');
    const name = el('a', 'ub-name', u.name);
    name.href = uniHref(u);
    const words = el('div', 'ub-words');
    words.append(name, el('span', 'city', [u.city, u.intakes.join(', ')].filter(Boolean).join(' · ')));
    top.append(el('span', 'uni-mono', monogram(u.name)), words);
    const open = el('a', 'btn btn-sm ub-open', 'Open');
    open.href = uniHref(u);
    top.append(open);
    c.append(top);
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
    $('count').textContent = loadedOnce && list.length ? (query ? `${list.length} of the universities match` : `${list.length} universities`) : '';
    if (!list.length) {
      const empty = el('div', 'ui-empty');
      empty.append(el('span', 'ui-empty-icon', query ? '🔍' : '🎓'), el('strong', '', query ? 'No university matches' : 'No universities yet'),
        el('span', '', query ? 'Try a university name, a city or a course such as "data science".' : 'The universities appear here after the first automatic reading.'));
      box.replaceChildren(empty);
      return;
    }
    const board = Boolean(query) && list.some((u) => u.courses && u.courses.length);
    box.classList.toggle('is-board', board);
    const out = list.map(card);
    // Above the board: who the courses are shortlisted for.
    if (board && team) { const head = window.ShortlistFor.bar(); head.classList.add('ub-for'); out.unshift(head); }
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
      loadedOnce = true;
      $('msg').textContent = '';
      render();
    } catch (e) {
      if (seq !== searchSeq) return;
      $('msg').textContent = 'Could not load the Fact File. Please reload the page.';
      $('msg').className = 'msg error';
      if (!loadedOnce) $('cards').replaceChildren();
    }
  }

  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    query = $('search').value.trim().slice(0, 100);
    searchTimer = setTimeout(load, 180);
  });
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
  // Who can go where (finder.js): at the top of the Fact File, for the team and for a student's own login.
  if (window.Finder && !BACKUP) {
    const box = document.createElement('div');
    box.id = 'finderBox';
    const anchor = document.querySelector('.page-head');
    anchor.after(box);
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(async (me) => {
      const student = me.role === 'student';
      if (!student && window.ShortlistFor && !(window.Teams && window.Teams.isReadOnly(me))) {
        await window.ShortlistFor.ready();
        team = true;
        window.ShortlistFor.tray();
        window.ShortlistFor.onChange(render);
        if (loadedOnce) render();
      }
      window.Finder.mount(box, student
        ? { title: 'Find the universities you can go to', intro: 'Enter your level, your grade, your study gap and your English test. Press "I am interested" on the courses you like.' }
        : { title: 'Find universities for a student', intro: 'Enter the student\'s level, grade, study gap and English: every university is checked at once, with what the student would need.', shortlist: Boolean(window.ShortlistFor) && !(window.Teams && window.Teams.isReadOnly(me)) });
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
