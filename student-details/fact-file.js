// Universities list (the owner approved the design on 28 Nov 2026, built the same day): a search like UCAS's, What (a university, a
// city or a course: "cyber security" shows who teaches it), Where (a town or postcode) and How far; All filters (type, year and intake,
// study mode, qualification, subject, location and distance, university or college, application deadline) with three of them also as
// quick lists; every filter chosen shown under the search with a cross, and Clear all; every university as one card, nearest deadline
// first; with a place, a UK map that zooms to the distance circle with a numbered red pin for each place inside it.
// The list is kept by the automatic readings only (the owner, 17 Nov 2026): nobody adds a university here.
(function () {
  const $ = (id) => document.getElementById(id);
  const Places = window.UkPlaces;
  // ?backup=ID: this is an earlier daily backup, read only (see backup-bar.js).
  const BACKUP = new URLSearchParams(location.search).get('backup') || '';
  const API = BACKUP ? '/api/restore/snapshot/' + encodeURIComponent(BACKUP) + '/facts' : '/api/facts';
  const media = (u) => (/^https:\/\//.test(String(u || '')) ? `/api/media?u=${encodeURIComponent(u)}` : u); // the server's kept copy (media-cache.js)
  const uniHref = (u) => '/fact-file?u=' + encodeURIComponent(u.id) + (BACKUP ? '&backup=' + encodeURIComponent(BACKUP) : '');
  const kindOf = (u) => (u.kind === 'pathway' ? 'Pathway colleges' : 'Universities');
  const LEVELS = ['Foundation', 'Year One', 'Top-up', 'Undergraduate', 'Pre-Masters', 'Postgraduate', 'Research or PhD'];
  const SUBJECTS = ['Nursing', 'Health', 'Business', 'Accounting and finance', 'Computing', 'Data science and AI', 'Engineering', 'Law', 'Psychology', 'Art, design and media', 'Education', 'Pharmacy', 'Science'];
  const MODES = ['Full-time', 'Part-time', 'Online or distance', 'With a placement year'];
  // The intake worked on (intake-window.js): its months, and the ones listed even when no university has a course in them.
  const WORKED = window.IntakeWindow.of();
  const INTAKES = WORKED.names.map((n) => `${n} ${WORKED.year}`);
  const ALWAYS = WORKED.season === 'January' ? INTAKES.slice(0, 2) : [WORKED.label];

  let list = []; // what the server answered (every university, or those matching the search)
  let query = '';
  let loadedOnce = false;
  let searchTimer = null;
  let searchSeq = 0; // answers arriving out of order: only the latest search is shown
  let team = false; // whether this account shortlists for students
  let mine = null; // a branch's own students at each University (the owner, 27 Nov 2026)
  const expanded = new Set(); // universities whose whole matching course list is open

  // Everything chosen. Lists can hold several choices; a place applies when Search (or Use) is pressed.
  const S = { place: '', here: null, radius: '', types: [], years: [], intakes: [], modes: [], levels: [], subjects: [], countries: [], regions: [], unis: [], closing: '',
    soon: false, onlyMine: false, sort: 'deadline', pop: '', modal: false, tab: 'type', zoom: 1, uniFind: '', subjectFind: '' };
  const blank = () => Object.assign(S, { place: '', here: null, radius: '', types: [], years: [], intakes: [], modes: [], levels: [], subjects: [], countries: [], regions: [], unis: [], closing: '', sort: 'deadline', zoom: 1 });

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const svg = (markup) => { const s = el('span', 'us-ico'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = markup; return s; }; // fixed drawings written here, never data
  const ICON = {
    x: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    tick: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    campus: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M8 26L32 12l24 14z"/><path d="M12 26v22M22 26v22M32 26v22M42 26v22M52 26v22M6 52h52M10 48h44"/></svg>',
    fit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };
  const urgency = (days) => (days <= 7 ? 'is-urgent' : days <= 30 ? 'is-soon' : '');
  const left = (days) => (days === 0 ? 'Closes today' : days === 1 ? '1 day left' : `${days} days left`);
  const milesText = (m) => (m < 1 ? 'Under 1 mile' : Math.round(m) === 1 ? '1 mile' : `${Math.round(m)} miles`);
  const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Two letters from the university's name ("University of West London" -> "WL"), for its badge when there is no logo.
  function monogram(name) {
    const words = String(name || '').replace(/\(.*?\)/g, ' ').split(/[^A-Za-z]+/).filter((w) => w && !/^(of|the|and|for|in)$/i.test(w) && !/^university$/i.test(w));
    const pick = words.length ? words : String(name || '?').split(/\s+/);
    return (pick.length > 1 ? pick[0][0] + pick[pick.length - 1][0] : String(pick[0] || '?').slice(0, 2)).toUpperCase();
  }
  function mono(u) {
    const m = el('span', 'us-logo' + (u.logo ? ' has-logo' : ''), u.logo ? '' : monogram(u.name));
    if (u.logo) { const i = el('img'); i.src = media(u.logo); i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); m.classList.remove('has-logo'); m.textContent = monogram(u.name); }); m.append(i); }
    return m;
  }

  // ---------- where each place is, and the filters ----------
  const placeMemo = new Map();
  function campusesOf(u) {
    const k = u.id + '|' + u.city + '|' + (u.profileCity || '');
    if (!placeMemo.has(k)) { const c = Places.campuses([u.city, u.profileCity].join(' / ')); placeMemo.set(k, c.length ? c : Places.campuses(u.name)); }
    return placeMemo.get(k);
  }
  const awayOf = (u) => { const c = campusesOf(u); return S.here && c.length ? Math.min(...c.map((t) => Places.miles(S.here, t))) : null; };
  const anyOf = (picked, f) => !picked.length || picked.some(f);
  const passes = (skip) => (u) => (skip === 'type' || anyOf(S.types, (x) => x === kindOf(u)))
    && (skip === 'year' || anyOf(S.years, (x) => x === String(WORKED.year)))
    && (skip === 'intake' || anyOf(S.intakes, (x) => (u.intakes || []).includes(x)))
    && (skip === 'mode' || anyOf(S.modes, (x) => (u.modes || []).includes(x)))
    && (skip === 'level' || anyOf(S.levels, (x) => (u.levels || []).includes(x)))
    && (skip === 'subject' || anyOf(S.subjects, (x) => (u.subjects || []).includes(x)))
    && (skip === 'country' || anyOf(S.countries, (x) => campusesOf(u).some((c) => c.country === x)))
    && (skip === 'region' || anyOf(S.regions, (x) => campusesOf(u).some((c) => c.region === x)))
    && (skip === 'uni' || anyOf(S.unis, (x) => x === u.name))
    && (skip === 'radius' || !S.here || !S.radius || (awayOf(u) !== null && awayOf(u) <= +S.radius))
    && (skip === 'closing' || !S.closing || (u.next && u.next.days <= +S.closing))
    && (skip === 'page' || ((!S.soon || (u.next && u.next.days <= 14)) && (!S.onlyMine || (mine && mine[u.id]))));
  function shown() {
    const out = list.filter(passes(''));
    const byDeadline = (a, b) => (a.next ? a.next.days : 1e6) - (b.next ? b.next.days : 1e6) || a.name.localeCompare(b.name);
    if (S.sort === 'near' && S.here) return out.sort((a, b) => (awayOf(a) ?? 1e6) - (awayOf(b) ?? 1e6) || byDeadline(a, b));
    if (S.sort === 'az') return out.sort((a, b) => a.name.localeCompare(b.name));
    return query ? out : out.sort(byDeadline); // a search keeps the server's order (best match first)
  }
  const inside = (u) => Boolean(S.here && S.radius) && awayOf(u) !== null && awayOf(u) <= +S.radius;

  // The options of a filter, each with how many places it would show with the other filters as they are.
  function options(key, values, skip, test, note) {
    const base = list.filter(passes(skip));
    return values.map((x) => ({ label: x, n: base.filter((u) => test(u, x)).length, note: note ? note(x) : null, on: S[key].includes(x), toggle: () => { S[key] = S[key].includes(x) ? S[key].filter((y) => y !== x) : S[key].concat(x); render(); } }));
  }
  const OPTS = {
    type: () => options('types', ['Universities', 'Pathway colleges'], 'type', (u, x) => kindOf(u) === x),
    year: () => options('years', [String(WORKED.year), String(WORKED.year + 1)], 'year', (u, x) => x === String(WORKED.year)),
    intake: () => options('intakes', INTAKES, 'intake', (u, x) => (u.intakes || []).includes(x)).filter((o) => o.n || o.on || ALWAYS.includes(o.label)),
    mode: () => options('modes', MODES, 'mode', (u, x) => (u.modes || []).includes(x)),
    level: () => options('levels', LEVELS, 'level', (u, x) => (u.levels || []).includes(x)),
    subject: () => options('subjects', SUBJECTS.filter((x) => !S.subjectFind || x.toLowerCase().includes(S.subjectFind.toLowerCase())), 'subject', (u, x) => (u.subjects || []).includes(x)),
    country: () => options('countries', Places.COUNTRIES, 'country', (u, x) => campusesOf(u).some((c) => c.country === x)),
    region: () => options('regions', Places.REGIONS, 'region', (u, x) => campusesOf(u).some((c) => c.region === x)),
    uni: () => options('unis', [...new Set(list.map((u) => u.name))].sort((a, b) => a.localeCompare(b)).filter((x) => !S.uniFind || x.toLowerCase().includes(S.uniFind.toLowerCase())), 'uni', (u, x) => u.name === x,
      (x) => { const u = list.find((v) => v.name === x); return u ? (campusesOf(u)[0] || {}).name || u.city || '' : ''; })
  };
  const picks = () => ({ type: S.types.length, intake: S.years.length + S.intakes.length, mode: S.modes.length, level: S.levels.length, subject: S.subjects.length, where: S.countries.length + S.regions.length + (S.here ? 1 : 0), uni: S.unis.length, deadline: S.closing ? 1 : 0 });

  // A list of options, Apple style: the name, how many places, a blue tick when chosen.
  function optionList(opts, cls) {
    const box = el('div', 'us-list' + (cls ? ' ' + cls : ''));
    opts.forEach((o) => {
      const b = el('button', 'us-row' + (o.on ? ' is-on' : '') + (!o.n && !o.on ? ' is-none' : ''));
      b.type = 'button';
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', String(o.on));
      b.append(el('span', 'us-row-label', o.label), el('span', 'us-row-n', o.note != null ? o.note : String(o.n)));
      const t = svg(o.on ? ICON.tick : ''); t.classList.add('us-row-tick'); b.append(t);
      b.addEventListener('click', o.toggle);
      box.append(b);
    });
    return box;
  }
  function seg(values, current, pick) {
    const g = el('div', 'us-seg');
    g.setAttribute('role', 'radiogroup');
    values.forEach(([v, label]) => { const b = el('button', 'us-seg-b' + (current === v ? ' is-on' : ''), label); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(current === v)); b.addEventListener('click', () => pick(v)); g.append(b); });
    return g;
  }

  // ---------- the quick lists under the search ----------
  const QUICK = [['intake', 'Year and intake'], ['mode', 'Study mode'], ['uni', 'University or college']];
  function drawQuick() {
    const box = $('usQuick');
    const p = picks();
    const all = el('button', 'us-all');
    all.type = 'button';
    all.append(svg(ICON.sliders), el('span', '', 'All filters'));
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    if (total) all.append(el('span', 'us-all-n', String(total)));
    all.addEventListener('click', () => { S.pop = ''; openModal('type'); });
    const items = [all];
    QUICK.forEach(([key, label]) => {
      const wrap = el('span', 'us-pop-wrap');
      const b = el('button', 'us-pill' + (p[key] || S.pop === key ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-expanded', String(S.pop === key));
      b.append(el('span', '', p[key] ? `${label} · ${p[key]}` : label), svg(ICON.down));
      b.addEventListener('click', (e) => { e.stopPropagation(); S.pop = S.pop === key ? '' : key; drawQuick(); });
      wrap.append(b);
      if (S.pop === key) wrap.append(popover(key, label));
      items.push(wrap);
    });
    box.replaceChildren(...items);
  }
  function popover(key, label) {
    const pop = el('div', 'us-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', label);
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.append(el('p', 'us-pop-title', label));
    const body = el('div', 'us-pop-body');
    const fill = () => {
      if (key === 'intake') body.replaceChildren(optionList(OPTS.year()), optionList(OPTS.intake()));
      else body.replaceChildren(optionList(OPTS[key](), key === 'uni' ? 'is-scroll' : ''));
    };
    if (key === 'uni') {
      const f = findBox(ICON.search, 'Type a name', S.uniFind, (v) => { S.uniFind = v; fill(); });
      pop.append(f);
    }
    fill();
    pop.append(body);
    const foot = el('div', 'us-pop-foot');
    const clear = el('button', 'us-link', 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', () => { if (key === 'intake') { S.years = []; S.intakes = []; } else S[{ mode: 'modes', uni: 'unis' }[key]] = []; render(); });
    const done = el('button', 'us-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => { S.pop = ''; drawQuick(); });
    foot.append(clear, done);
    pop.append(foot);
    return pop;
  }
  function findBox(icon, placeholder, value, onInput, extra) {
    const l = el('label', 'us-find');
    l.append(svg(icon));
    const i = el('input');
    i.value = value;
    i.placeholder = placeholder;
    i.setAttribute('aria-label', placeholder);
    i.autocomplete = 'off';
    i.addEventListener('input', () => onInput(i.value));
    l.append(i);
    if (extra) l.append(extra);
    return l;
  }
  document.addEventListener('click', () => { if (S.pop) { S.pop = ''; drawQuick(); } });

  // ---------- the chosen filters ----------
  function drawChips() {
    const chips = [];
    const add = (label, remove) => chips.push([label, remove]);
    const drop = (key, v) => () => { S[key] = S[key].filter((x) => x !== v); render(); };
    [['types'], ['years'], ['intakes'], ['modes'], ['levels'], ['subjects'], ['countries'], ['regions', ', England'], ['unis']].forEach(([key, tail]) => S[key].forEach((v) => add(v + (tail || ''), drop(key, v))));
    if (S.here) add((S.radius ? `Within ${S.radius} miles of ` : 'Near ') + S.here.name, () => { S.here = null; S.place = ''; S.radius = ''; $('usPlace').value = ''; $('usRadius').value = ''; if (S.sort === 'near') S.sort = 'deadline'; render(); });
    if (S.closing) add(`Closing within ${S.closing} days`, () => { S.closing = ''; render(); });
    const box = $('usChips');
    box.hidden = !chips.length;
    if (!chips.length) { box.replaceChildren(); return; }
    const out = [el('span', 'us-chips-label', 'Selected')];
    chips.forEach(([label, remove]) => {
      const c = el('span', 'us-chip', label);
      const x = el('button', 'us-chip-x');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove ' + label);
      x.append(svg(ICON.x));
      x.addEventListener('click', remove);
      c.append(x);
      out.push(c);
    });
    const clear = el('button', 'us-link', 'Clear all');
    clear.type = 'button';
    clear.addEventListener('click', clearAll);
    out.push(clear);
    box.replaceChildren(...out);
  }
  function clearAll() { blank(); $('usPlace').value = ''; $('usRadius').value = ''; $('usBad').hidden = true; render(); }

  // ---------- the bar above the cards ----------
  function drawBar(rows) {
    const bar = $('usBar');
    bar.hidden = !loadedOnce || !list.length;
    if (bar.hidden) return;
    const items = [];
    const soonN = list.filter(passes('page')).filter((u) => u.next && u.next.days <= 14).length;
    const soon = el('button', 'us-soon' + (S.soon ? ' is-on' : ''));
    soon.type = 'button';
    soon.setAttribute('aria-pressed', String(S.soon));
    soon.append(el('span', 'us-soon-dot'), el('span', '', 'Closing in 14 days'), el('span', 'us-soon-n', String(soonN)));
    soon.addEventListener('click', () => { S.soon = !S.soon; render(); });
    items.push(soon);
    if (mine) {
      const n = list.filter((u) => mine[u.id]).length;
      if (n || S.onlyMine) {
        const b = el('button', 'us-mine' + (S.onlyMine ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(S.onlyMine));
        b.append(el('span', '', 'With your students'), el('span', 'us-mine-n', String(n)));
        b.addEventListener('click', () => { S.onlyMine = !S.onlyMine; render(); });
        items.push(b);
      }
    }
    items.push(el('span', 'us-grow'));
    items.push(el('span', 'us-total', `${rows.length} ${rows.length === 1 ? 'place' : 'places'}`));
    const sl = el('label', 'us-sort', 'Sort');
    const sel = el('select');
    [['deadline', 'Closing date']].concat(S.here ? [['near', 'Nearest first']] : []).concat([['az', 'A to Z']]).forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.append(o); });
    sel.value = S.sort === 'near' && !S.here ? 'deadline' : S.sort;
    sel.addEventListener('change', () => { S.sort = sel.value; render(); });
    sl.append(sel);
    items.push(sl);
    bar.replaceChildren(...items);
  }

  // ---------- the cards ----------
  function nextLine(u) {
    const n = el('div', 'us-foot');
    if (u.next) {
      const t = el('span', 'us-by');
      t.append('Apply by ', el('b', '', u.next.when));
      n.append(t, el('span', `us-days ${urgency(u.next.days)}`.trim(), left(u.next.days)));
    } else n.append(el('span', 'us-none', u.closed ? 'Applications closed' : 'No open deadline'));
    return n;
  }
  function mineWords(m) {
    if (m.applications) return `${m.applications} applied, ${m.offers} offer${m.offers === 1 ? '' : 's'}`;
    const n = m.students.filter((x) => x.state === 'chosen').length;
    return n ? `${n} chose it, not applied yet` : `${m.students.length} on record`;
  }
  const TINTS = ['is-t0', 'is-t1', 'is-t2', 'is-t3', 'is-t4'];
  function tags(u) {
    const t = el('div', 'us-tags');
    if (u.kind === 'pathway') t.append(el('span', 'us-tag is-path', 'Pathway college'));
    const a = awayOf(u);
    if (a !== null) t.append(el('span', 'us-tag' + (inside(u) ? ' is-in' : ''), milesText(a) + ' away'));
    if (mine && mine[u.id]) t.append(el('span', 'us-tag is-mine', 'Your students: ' + mineWords(mine[u.id])));
    return t.childNodes.length ? t : null;
  }
  function cover(u, i) {
    const c = el('div', 'us-cover ' + TINTS[i % TINTS.length] + (u.cover ? '' : ' is-blank'));
    const blankArt = () => { c.classList.add('is-blank'); c.append(svg(ICON.campus)); };
    if (u.cover) { const img = el('img'); img.src = media(u.cover); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => { img.remove(); blankArt(); }); c.append(img); } else blankArt();
    return c;
  }
  function card(u, i) {
    const a = el('a', 'uni-card us-card');
    a.href = uniHref(u);
    a.append(cover(u, i));
    const body = el('div', 'us-body');
    body.append(mono(u), el('h2', 'us-name', u.name));
    const where = (campusesOf(u)[0] || {}).name;
    body.append(el('div', 'us-meta', [u.city || u.profileCity || where || 'Place not given', u.courseCount ? `${u.courseCount} course${u.courseCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')));
    if (u.intakes && u.intakes.length) body.append(el('div', 'us-meta', 'Starts ' + u.intakes.join(' and ')));
    const t = tags(u);
    if (t) body.append(t);
    if (u.updatedAt && (Date.now() - new Date(u.updatedAt).getTime()) > 90 * 86400000) body.append(el('div', 'updated', 'Last updated ' + when(u.updatedAt) + ', check it'));
    a.append(body, nextLine(u));
    return a;
  }
  // A course search ("nursing"): each place lists its matching courses, each with its level and intake and Shortlist for the team,
  // so nobody opens university after university (the owner, 17 Nov 2026).
  function boardCard(u, i) {
    const c = el('article', 'uni-card is-board us-card');
    c.append(cover(u, i));
    const body = el('div', 'us-body');
    body.append(mono(u));
    const name = el('a', 'ub-name us-name', u.name);
    name.href = uniHref(u);
    body.append(name, el('div', 'us-meta', [u.city || u.profileCity, `${u.courses.length} matching course${u.courses.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')));
    const t = tags(u);
    if (t) body.append(t);
    const ul = el('ul', 'ub-courses us-courses');
    const SHOW = 3;
    u.courses.forEach((co, n) => {
      const li = el('li');
      if (n >= SHOW && !expanded.has(u.id)) li.hidden = true;
      const words = el('div', 'ub-course');
      words.append(el('span', 'ub-course-name', co.course));
      const level = co.level && window.FactPresent ? window.FactPresent.levelGroup(co.level) : co.level;
      const meta = [level, (co.intakes || []).join(', ')].filter(Boolean).join(' · ');
      if (meta) words.append(el('span', 'ub-meta', meta));
      li.append(words);
      if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: u.id, name: u.name }, co.course, (co.intakes || [])[0] || ''));
      else if (team) li.append(window.ShortlistFor.button({ universityId: u.id, university: u.name, course: co.course, intake: (co.intakes || [])[0] || (u.intakes.length === 1 ? u.intakes[0] : ''), level: level || '' }));
      ul.append(li);
    });
    body.append(ul);
    if (u.courses.length > SHOW && !expanded.has(u.id)) {
      const more = el('button', 'us-link ub-more', `Show all ${u.courses.length}`);
      more.type = 'button';
      more.addEventListener('click', () => { expanded.add(u.id); ul.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); more.remove(); });
      body.append(more);
    }
    c.append(body, nextLine(u));
    return c;
  }
  function skeletons() {
    $('cards').replaceChildren(...Array.from({ length: 8 }, () => {
      const c = el('div', 'uni-card skeleton us-card');
      c.setAttribute('aria-hidden', 'true');
      c.append(el('span', 'ui-skeleton line-lg'), el('span', 'ui-skeleton line-sm'), el('span', 'ui-skeleton line-chip'));
      return c;
    }));
  }

  // ---------- the UK map ----------
  const K = 60, COS = Math.cos(54.5 * Math.PI / 180), LON0 = -8.6, LAT0 = 59.4;
  const base = (lat, lon) => [(lon - LON0) * COS * K, (LAT0 - lat) * K];
  const BW = (2.0 - LON0) * COS * K, BH = (LAT0 - 49.8) * K;
  let mapSeq = 0;
  function drawMap(W, H) {
    const id = 'usMap' + (++mapSeq);
    const fit = Math.min(W / BW, H / BH) * 0.96;
    const R = S.here && S.radius ? (+S.radius / 69.05) * K : 0;
    let z = fit, c = [BW / 2, BH / 2];
    if (S.here) { c = base(S.here.lat, S.here.lon); z = R ? Math.min(W, H) / (R * 2 * 1.75) : fit * 2.4; }
    z = Math.max(fit, Math.min(fit * 9, z * S.zoom));
    if (z <= fit * 1.001) c = [BW / 2, BH / 2];
    const P = (lat, lon) => { const b = base(lat, lon); return [(b[0] - c[0]) * z + W / 2, (b[1] - c[1]) * z + H / 2]; };
    const ring = (pts) => pts.map((p, i) => { const xy = P(p[1], p[0]); return (i ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1); }).join(' ') + 'Z';
    const hx = S.here ? P(S.here.lat, S.here.lon) : [0, 0];
    const rpx = R * z;
    const box = el('div', 'us-map');
    box.style.width = W + 'px';
    box.style.height = H + 'px';
    const art = `<svg width="${W}" height="${H}" class="us-map-art" aria-hidden="true"><defs><filter id="${id}l" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#4a6a8a" flood-opacity=".22"/></filter><radialGradient id="${id}r"><stop offset="0%" stop-color="#0071e3" stop-opacity=".04"/><stop offset="100%" stop-color="#0071e3" stop-opacity=".16"/></radialGradient></defs>`
      + `<path class="us-map-ie" d="${ring(Places.OUTLINE.ireland)}"/><path class="us-map-land" d="${Places.OUTLINE.land.map(ring).join(' ')}" filter="url(#${id}l)"/>`
      + (rpx ? `<circle cx="${hx[0].toFixed(1)}" cy="${hx[1].toFixed(1)}" r="${rpx.toFixed(1)}" fill="url(#${id}r)" stroke="#0071e3" stroke-width="2"/>` : '') + '</svg>';
    box.insertAdjacentHTML('beforeend', art); // numbers worked out here and the fixed outline, no data from outside
    const at = (cls, x, y) => { const s = el('span', cls); s.style.left = x + 'px'; s.style.top = y + 'px'; return s; };
    // One mark for each town: a red pin with how many places are there when the town is inside the circle, a small dot when it is
    // not. A town on top of the student's place sits just above the blue dot, so neither hides the other.
    const marks = [];
    towns(list.filter(passes('radius'))).forEach((g) => {
      const xy = P(g.town.lat, g.town.lon);
      let x = xy[0], y = xy[1];
      if (S.here && Math.hypot(x - hx[0], y - hx[1]) < 18) { x = hx[0]; y = hx[1] - 26; }
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
      const m = at(g.inside ? 'us-pin' + (g.places.length > 9 ? ' is-wide' : '') : 'us-dot' + (S.here && S.radius ? '' : ' is-red'), x, y);
      m.title = `${g.town.name}: ${g.places.map((u) => u.name).join(', ')}` + (S.here ? ` (${milesText(g.away)})` : '');
      if (g.inside) { m.textContent = String(g.places.length); m.style.zIndex = String(10 + Math.min(40, g.places.length)); }
      marks.push({ x, y, m });
    });
    // Big cities, where they do not sit on a pin or the student's place.
    Places.OUTLINE.cities.forEach((t) => {
      const [x, y] = P(t.lat, t.lon);
      if (x < 10 || x > W - 90 || y < 16 || y > H - 56) return;
      if (S.here && Math.hypot(x - hx[0], y - hx[1]) < 40) return;
      if (marks.some((p) => p.y > y - 16 && p.y < y + 16 && p.x > x - 14 && p.x < x + 80)) return;
      const name = at('us-city', x, y);
      name.textContent = t.name;
      box.append(name);
    });
    if (rpx) { const l = at('us-ring', hx[0], hx[1] - rpx); l.textContent = `${S.radius} miles`; box.append(l); }
    marks.forEach((p) => box.append(p.m));
    if (S.here) { box.append(at('us-halo', hx[0], hx[1]), at('us-here', hx[0], hx[1])); const l = at('us-here-name', hx[0], hx[1]); l.textContent = S.here.name; box.append(l); }
    const zoom = el('div', 'us-zoom');
    [['+', 'Zoom in', () => { S.zoom = Math.min(6, S.zoom * 1.6); }], ['−', 'Zoom out', () => { S.zoom = Math.max(0.01, S.zoom / 1.6); }], [ICON.fit, 'Show all of the UK', () => { S.zoom = 0.01; }]].forEach(([t, label, f]) => {
      const b = el('button', 'us-zoom-b');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      if (t.startsWith('<')) b.append(svg(t)); else b.textContent = t;
      b.addEventListener('click', () => { f(); drawResults(shown()); if (S.modal) drawModal(); });
      zoom.append(b);
    });
    box.append(zoom);
    const perMile = (K / 69.05) * z;
    const step = [5, 10, 20, 25, 50, 100, 200].find((m) => m * perMile >= 60) || 200;
    const scale = el('div', 'us-scale');
    const bar = el('span', 'us-scale-bar');
    bar.style.width = Math.round(step * perMile) + 'px';
    scale.append(el('span', '', `${step} miles`), bar);
    box.append(scale);
    return box;
  }
  // The places grouped by town: a place with several campuses under the one nearest the student (else its first). Nearest town first.
  function towns(rows) {
    const by = new Map();
    rows.forEach((u) => { const all = campusesOf(u); const t = S.here && all.length > 1 ? all.slice().sort((p, q) => Places.miles(S.here, p) - Places.miles(S.here, q))[0] : all[0]; if (!t) return; if (!by.has(t.name)) by.set(t.name, { town: t, places: [], away: S.here ? Places.miles(S.here, t) : 0 }); by.get(t.name).places.push(u); });
    return [...by.values()].map((g) => Object.assign(g, { inside: g.places.some(inside) })).sort((a, b) => a.away - b.away);
  }
  function mapTitle() {
    if (!S.here) return 'Choose a town or postcode';
    const n = list.filter(passes('')).filter(inside).length;
    return S.radius ? `${n} ${n === 1 ? 'place' : 'places'} within ${S.radius} miles` : `Near ${S.here.name}`;
  }
  function mapPanel(W, H, withChange) {
    const out = el('div', 'us-mappanel');
    const head = el('div', 'us-map-head');
    head.append(el('b', '', mapTitle()));
    if (withChange) { const ch = el('button', 'us-link', 'Change'); ch.type = 'button'; ch.addEventListener('click', () => openModal('where')); head.append(ch); }
    out.append(head, drawMap(W, H));
    // Under the map: the towns inside the circle, with how many places each and how far.
    const near = towns(list.filter(passes('')).filter(inside));
    if (near.length) {
      const ol = el('ol', 'us-near');
      near.slice(0, 6).forEach((g) => { const li = el('li'); li.append(el('span', 'us-near-n', String(g.places.length)), el('span', 'us-near-name', g.town.name), el('span', 'us-near-mi', milesText(g.away))); ol.append(li); });
      out.append(ol);
      if (near.length > 6) out.append(el('p', 'us-near-more', `and ${near.length - 6} more ${near.length - 6 === 1 ? 'town' : 'towns'}`));
    }
    return out;
  }

  // ---------- the results ----------
  function drawResults(rows) {
    const box = $('cards');
    const board = Boolean(query) && rows.some((u) => u.courses && u.courses.length);
    const withMap = Boolean(S.here) && loadedOnce;
    $('usResults').classList.toggle('has-map', withMap);
    const mc = $('usMapCard');
    mc.hidden = !withMap;
    if (withMap) mc.replaceChildren(mapPanel(348, 470, true));
    box.classList.toggle('is-board', board);
    if (!rows.length) {
      const empty = el('div', 'ui-empty us-empty');
      empty.append(el('strong', '', list.length ? 'No university matches' : query ? 'No university matches' : 'No universities yet'),
        el('span', '', list.length ? 'Remove a filter, choose a longer distance, or try another course.' : query ? 'Try a university name, a city or a course such as "data science".' : 'The universities appear here after the first automatic reading.'));
      if (Object.values(picks()).some(Boolean) || S.soon || S.onlyMine) { const b = el('button', 'us-done', 'Clear all filters'); b.type = 'button'; b.addEventListener('click', () => { S.soon = false; S.onlyMine = false; clearAll(); }); empty.append(b); }
      box.replaceChildren(empty);
      return;
    }
    box.replaceChildren(...rows.map((u, i) => (board && u.courses && u.courses.length ? boardCard(u, i) : card(u, i))));
  }

  // ---------- All filters ----------
  const TABS = [['type', 'Type', 'Universities, pathway colleges, or both.'], ['intake', 'Year and intake', 'When the student starts.'], ['mode', 'Study mode', 'How the student will study.'],
    ['level', 'Qualification', 'The level the student will study at.'], ['subject', 'Subject', 'Places that teach any of the subjects chosen.'],
    ['where', 'Location and distance', 'Country, region, and how far the student can travel.'], ['uni', 'University or college', 'Pick one or more by name.'], ['deadline', 'Application deadline', 'Places still open and closing soon.']];
  let modalLast = null;
  function openModal(tab) { modalLast = document.activeElement; S.modal = true; S.tab = tab; drawModal(); const first = $('usModal').querySelector('.us-tab.is-on'); if (first) first.focus(); }
  function closeModal() { S.modal = false; $('usModal').hidden = true; $('usModal').replaceChildren(); document.body.classList.remove('us-locked'); if (modalLast && modalLast.focus) modalLast.focus(); }
  function drawModal() {
    const wrap = $('usModal');
    wrap.hidden = false;
    document.body.classList.add('us-locked');
    const p = picks();
    const shade = el('div', 'us-shade');
    shade.addEventListener('click', closeModal);
    const dlg = el('div', 'us-modal');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', 'All filters');
    const head = el('div', 'us-modal-head');
    const x = el('button', 'us-modal-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.append(svg(ICON.x));
    x.addEventListener('click', closeModal);
    const n = shown().length;
    head.append(el('h2', '', 'All filters'), el('span', 'us-modal-n', `${n} ${n === 1 ? 'place' : 'places'}`), x);
    const nav = el('nav', 'us-tabs');
    nav.setAttribute('aria-label', 'Filter groups');
    TABS.forEach(([key, label]) => {
      const b = el('button', 'us-tab' + (S.tab === key ? ' is-on' : ''));
      b.type = 'button';
      if (S.tab === key) b.setAttribute('aria-current', 'true');
      b.append(el('span', '', label));
      if (p[key]) b.append(el('span', 'us-tab-n', String(p[key])));
      b.addEventListener('click', () => { S.tab = key; drawModal(); });
      nav.append(b);
    });
    const pane = el('div', 'us-pane');
    const [, title, help] = TABS.find(([k]) => k === S.tab);
    const intro = [el('h3', '', title), el('p', 'us-pane-help', help)];
    const label = (t) => el('p', 'us-pane-label', t);
    const lists = el('div');
    if (S.tab === 'type') lists.append(optionList(OPTS.type()));
    if (S.tab === 'intake') lists.append(label('YEAR'), optionList(OPTS.year()), label('INTAKE'), optionList(OPTS.intake()));
    if (S.tab === 'mode') lists.append(optionList(OPTS.mode()));
    if (S.tab === 'level') lists.append(optionList(OPTS.level()));
    if (S.tab === 'deadline') {
      const base = list.filter(passes('closing'));
      lists.append(optionList([['', 'Any time'], ['7', 'Within 7 days'], ['14', 'Within 14 days'], ['30', 'Within 30 days']].map(([v, t]) => ({ label: t, n: base.filter((u) => !v || (u.next && u.next.days <= +v)).length, on: S.closing === v, toggle: () => { S.closing = v; render(); } }))));
    }
    if (S.tab === 'subject' || S.tab === 'uni') {
      const two = el('div', 'us-two');
      const fill = () => { const o = OPTS[S.tab](); const k = Math.ceil(o.length / 2); two.replaceChildren(optionList(o.slice(0, k)), optionList(o.slice(k))); };
      lists.append(findBox(ICON.search, S.tab === 'subject' ? 'Type a subject' : 'Type a university or college', S.tab === 'subject' ? S.subjectFind : S.uniFind, (v) => { if (S.tab === 'subject') S.subjectFind = v; else S.uniFind = v; fill(); }), two);
      fill();
    }
    if (S.tab === 'where') {
      const cols = el('div', 'us-where');
      const leftCol = el('div');
      const use = el('button', 'us-use', 'Use');
      use.type = 'button';
      let typed = S.place;
      const bad = el('p', 'us-bad', 'Town or postcode not found.');
      bad.hidden = true;
      use.addEventListener('click', () => { const f = Places.find(typed); if (typed.trim() && !f) { bad.hidden = false; return; } S.place = typed; S.here = f; S.zoom = 1; $('usPlace').value = typed; if (f) S.sort = 'near'; else if (S.sort === 'near') S.sort = 'deadline'; render(); });
      const fb = findBox(ICON.pin, 'From a town or postcode', S.place, (v) => { typed = v; bad.hidden = true; }, use);
      fb.querySelector('input').setAttribute('list', 'usTowns');
      fb.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') use.click(); });
      leftCol.append(label('HOW FAR CAN THE STUDENT TRAVEL?'), fb, bad,
        seg([['', 'Any'], ['10', '10 mi'], ['25', '25 mi'], ['50', '50 mi'], ['100', '100 mi']], S.radius, (v) => { S.radius = v; S.zoom = 1; $('usRadius').value = v; if (v && S.here) S.sort = 'near'; render(); }),
        label('COUNTRY'), optionList(OPTS.country()), label('REGION IN ENGLAND'), optionList(OPTS.region()));
      const right = el('div', 'us-where-map');
      right.append(mapPanel(372, 450, false));
      cols.append(leftCol, right);
      lists.append(cols);
      intro.length = 0;
      leftCol.prepend(el('h3', '', title), el('p', 'us-pane-help', help));
    }
    pane.append(...intro, lists);
    const body = el('div', 'us-modal-body');
    body.append(nav, pane);
    const foot = el('div', 'us-modal-foot');
    const clear = el('button', 'us-link', 'Clear all');
    clear.type = 'button';
    clear.addEventListener('click', clearAll);
    const show = el('button', 'us-go', `Show ${n} ${n === 1 ? 'result' : 'results'}`);
    show.type = 'button';
    show.addEventListener('click', closeModal);
    foot.append(clear, el('span', 'us-grow'), show);
    dlg.append(head, body, foot);
    const focusedFind = document.activeElement && document.activeElement.closest && document.activeElement.closest('.us-modal .us-find') ? true : false;
    wrap.replaceChildren(shade, dlg);
    if (focusedFind) { const i = dlg.querySelector('.us-find input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.modal) { closeModal(); return; }
    if (S.pop) { S.pop = ''; drawQuick(); }
  });

  // ---------- everything ----------
  function render() {
    const rows = shown();
    drawQuick();
    drawChips();
    drawBar(rows);
    $('count').textContent = '';
    drawResults(rows);
    if (S.modal) drawModal();
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
      $('msg').textContent = 'Could not load Universities. Please reload the page.';
      $('msg').className = 'msg error';
      if (!loadedOnce) $('cards').replaceChildren();
    }
  }

  // What, Where, How far.
  const search = $('search');
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    query = search.value.trim().slice(0, 100);
    $('searchClear').hidden = !search.value;
    searchTimer = setTimeout(load, 180);
  });
  $('searchClear').addEventListener('click', () => { search.value = ''; query = ''; $('searchClear').hidden = true; load(); search.focus(); });
  // Esc in the search box clears it.
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; query = ''; $('searchClear').hidden = true; load(); } });
  const go = () => {
    const typed = $('usPlace').value;
    const f = Places.find(typed);
    $('usBad').hidden = !(typed.trim() && !f);
    if (typed.trim() && !f) return;
    S.place = typed; S.here = f; S.zoom = 1;
    if (f) S.sort = 'near'; else if (S.sort === 'near') S.sort = 'deadline';
    render();
  };
  $('usGo').addEventListener('click', go);
  $('usPlace').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('usPlace').addEventListener('input', () => { $('usBad').hidden = true; });
  $('usRadius').addEventListener('change', () => { S.radius = $('usRadius').value; S.zoom = 1; if (S.radius && S.here) S.sort = 'near'; render(); });
  $('usTowns').replaceChildren(...Places.suggestions().map((t) => { const o = el('option'); o.value = t; return o; }));
  // "/" jumps to the search box, like on most sites.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  skeletons();
  drawQuick();
  load();
  if (!BACKUP && window.TeamRules) {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(async (me) => {
      if (!window.TeamRules.ownTeamBranch(me)) return;
      const r = await fetch('/api/branch-universities', { cache: 'no-store' });
      if (!r.ok) return;
      mine = (await r.json()).universities;
      if (loadedOnce) render();
    }).catch(() => {});
  }
  // Shortlisting from a course search, and Find for a student. The finder is no longer on Universities (the owner, 28 Nov 2026: the
  // search and its filters do that job); it opens only from a student's card ("Find course", ?for=ID, filled in from the card) and on a
  // student's own login, which have no other way to it.
  if (!BACKUP) {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(async (me) => {
      const student = me.role === 'student';
      if (window.ShortlistFor && window.ShortlistFor.useMe) window.ShortlistFor.useMe(me);
      if (!student && window.ShortlistFor && !(window.TeamRules && window.TeamRules.isReadOnly(me))) {
        await window.ShortlistFor.ready();
        team = true;
        window.ShortlistFor.tray();
        window.ShortlistFor.onChange(render);
        if (loadedOnce) render();
      }
      const forId = new URLSearchParams(location.search).get('for');
      if (!window.Finder || (!student && !forId)) return;
      const box = document.createElement('div');
      box.id = 'finderBox';
      document.querySelector('.page-head').after(box);
      let prefill = {};
      if (!student && forId) {
        try {
          const c = await (await fetch('/api/cards/' + encodeURIComponent(forId), { cache: 'no-store' })).json();
          const pp = (c && c.card && c.card.profile) || {};
          prefill = { level: pp.studyLevel || '', grade: pp.grade || '', gap: pp.gapYears || '', test: pp.englishTest || '', score: pp.englishScore || '', band: pp.englishBand || '', subject: pp.subject || '' };
        } catch (e) { prefill = {}; }
      }
      window.Finder.mount(box, student
        ? { title: 'Find the universities you can go to', intro: 'Enter your level, your grade, your study gap and your English test. Press "I am interested" on the courses you like.' }
        : { title: 'Find universities for a student', prefill, shortlist: Boolean(window.ShortlistFor) && !(window.TeamRules && window.TeamRules.isReadOnly(me)) });
      const shortlist = document.getElementById('shortlist');
      if (shortlist) box.before(shortlist); // a student's welcome and shortlist first
    }).catch(() => {});
  }
})();

// A line under the search when the weekly check of the course pages has warnings (the details are on each university's page).
fetch('/api/course-watch', { cache: 'no-store' }).then((r) => r.json()).then((r) => {
  if (!r.summary || !r.summary.warnings) return;
  const count = document.getElementById('count');
  const note = document.createElement('div');
  note.className = 'p-notice warn';
  note.textContent = `${r.summary.warnings} course page${r.summary.warnings === 1 ? '' : 's'} need${r.summary.warnings === 1 ? 's' : ''} a look (gone, renamed or changed).`;
  count.parentNode.insertBefore(note, count);
}).catch(() => {});
