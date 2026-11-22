// One university's page (the owner, 17 Nov 2026): kept up to date by itself, read by everyone, edited by nobody, except the dates of
// the intakes, which the team may correct. What is shown and in which section is decided in fact-present.js (nothing twice, nothing
// extra); this file draws it:
//
//   the deadlines first, highlighted, each date with the days left (read automatically: nobody changes them, the owner, 20 Nov 2026)
//   one table: entry requirements, English, tuition fee, scholarship, deposit, one row per level
//   the courses, grouped by level, each with Shortlist (for the student chosen at the top; the shortlist waits in the tray at the
//   bottom, see fact-finder.js) and an amber warning when the automatic
//   check found no page for it on the university's website
//   under the name, "Apply through" and the partner, for Admin and the Application Team (apply-through.js)
//   then the overview, the application steps, the interview (the team only), location, payments and notes, when there are any.
//
// Everything is put on the page as text, never as HTML. Printing gives a clean document.
(function () {
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('u');
  // ?backup=ID: an earlier daily backup, read only (see backup-bar.js).
  const BACKUP = new URLSearchParams(location.search).get('backup') || '';
  const P = window.FactPresent;
  let uni = null;
  let me = {};
  let courseData = null;
  let watch = { warnings: [], admin: false };
  // Which partner this university is applied through (Apply through, the owner, 20 Nov 2026): only Admin and the Application Team
  // are told; for everyone else the server answers 403 and nothing is shown.
  let applyVia = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const has = (s) => String(s || '').trim() !== '';
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const student = () => Boolean(window.Shortlist && window.Shortlist.isStudent());
  const team = () => !student() && !BACKUP && me.role && !(window.TeamRules && window.TeamRules.isReadOnly(me));
  function say(text, error) { const m = $('msg'); m.textContent = text || ''; m.className = 'no-print msg' + (error ? ' error' : ''); }

  // Text with "## " headings and "- " bullets, as headings, lists and paragraphs.
  function richText(parent, text, { sub = false } = {}) {
    let list = null;
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      const heading = /^##\s+(.*)$/.exec(line);
      if (heading) { list = null; parent.append(el(sub ? 'h4' : 'h3', '', heading[1])); return; }
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) { list = el('ul'); parent.append(list); }
        list.append(linked(el('li'), bullet[1]));
      } else {
        list = null;
        if (line) parent.append(linked(el('p'), line));
      }
    });
  }
  // A web address in the text as a link (payment and accommodation pages); "Fees page: https://..." as a link named "Fees page".
  function linked(node, text) {
    const named = /^([^:]{2,40}):\s*(https?:\/\/[^\s<>"']+)\s*$/.exec(String(text));
    if (named) { const a = el('a', '', named[1]); a.href = named[2]; a.target = '_blank'; a.rel = 'noopener'; node.append(a); return node; }
    String(text).split(/(https?:\/\/[^\s<>"')]+)/).forEach((part, i) => {
      if (i % 2) { const a = el('a', '', part.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); a.href = part; a.target = '_blank'; a.rel = 'noopener'; node.append(a); } else if (part) node.append(part);
    });
    return node;
  }
  function section(doc, title, fill) {
    const s = el('section');
    s.append(el('h2', '', title));
    fill(s);
    doc.append(s);
    return s;
  }

  // ---- the deadlines ----
  const countdown = (days) => {
    if (days === null || days === undefined) return null;
    const c = el('span', `dl-left ${days < 0 ? 'is-past' : days <= 7 ? 'is-urgent' : days <= 30 ? 'is-soon' : ''}`.trim(),
      days < 0 ? 'Passed' : days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`);
    return c;
  };
  function renderDeadlines(doc, view) {
    const box = el('section', 'dl-band');
    box.setAttribute('aria-label', 'Deadlines');
    const head = el('div', 'dl-head');
    head.append(el('h2', '', 'Deadlines'));
    box.append(head);
    if (!view.deadlines.some((d) => d.applyBy || d.dates.length)) { box.append(el('p', 'dl-none', 'No dates yet.')); doc.append(box); return; }
    const grid = el('div', 'dl-grid');
    view.deadlines.filter((d) => d.applyBy || d.dates.length).forEach((d) => {
      // An intake whose dates have all passed is shown small, after the others.
      const all = [d.applyBy, ...d.dates].filter((x) => x && x.days !== null && x.days !== undefined);
      const over = !(d.applyBy && d.applyBy.closed) && all.length > 0 && all.every((x) => x.days < 0);
      const card = el('div', `dl-card${over ? ' is-over' : ''}${d.applyBy && d.applyBy.closed ? ' is-closed' : ''}`);
      card.append(el('div', 'dl-intake', d.name));
      if (over) { card.append(el('div', 'dl-over', 'All dates have passed')); grid.append(card); return; }
      if (d.applyBy) {
        const main = el('div', 'dl-main');
        main.append(el('span', 'dl-label', d.applyBy.closed ? 'Applications' : 'Apply by'), el('b', 'dl-date', d.applyBy.when));
        const c = countdown(d.applyBy.days);
        if (c) main.append(c);
        card.append(main);
        if (has(d.applyBy.note)) card.append(el('div', 'dl-note', d.applyBy.note));
      }
      if (d.dates.length) {
        const ul = el('ul', 'dl-list');
        d.dates.forEach((x) => {
          const li = el('li', x.days !== null && x.days < 0 ? 'is-past' : '');
          li.append(el('span', 'dl-what', x.label));
          if (x.when) li.append(el('b', '', x.when));
          const c = countdown(x.days);
          if (c) li.append(c);
          ul.append(li);
        });
        card.append(ul);
      }
      if (d.edited) card.append(el('div', 'dl-edited', `Dates changed by ${d.edited.by || 'the team'}, ${when(d.edited.at)}`));
      grid.append(card);
    });
    // The open intakes first, the closed and passed ones after.
    [...grid.children].filter((c) => c.classList.contains('is-over')).forEach((c) => grid.append(c));
    box.append(grid);
    doc.append(box);
  }

  // ---- entry requirements and fees: one card per level ----
  // A wide table with five columns of long text was crushed and ran off the page (the owner, 17 Nov 2026: make it easy to read), so
  // each level is a card with its facts one under another. A value the same for every level is written once, above the cards.
  function renderTable(doc, view) {
    if (!view.programs.length) return;
    section(doc, 'Entry requirements and fees', (s) => {
      const same = Object.fromEntries(view.columns.map(([key]) => [key, view.programs.length > 1 && has(view.programs[0][key]) && view.programs.every((p) => p[key] === view.programs[0][key])]));
      const shared = view.columns.filter(([key]) => same[key]);
      if (shared.length) {
        const box = el('dl', 'lvl-shared');
        shared.forEach(([key, label]) => { const row = el('div'); row.append(el('dt', '', `${label}, every level`)); const dd = el('dd'); richText(dd, view.programs[0][key]); row.append(dd); box.append(row); });
        s.append(box);
      }
      const grid = el('div', 'lvl-cards');
      view.programs.forEach((p) => {
        const card = el('article', 'lvl-card');
        const head = el('header', 'lvl-head');
        head.append(el('h3', '', p.name));
        if (has(p.duration)) head.append(el('span', 'lvl-dur', p.duration));
        card.append(head);
        const dl = el('dl', 'lvl-facts');
        view.columns.forEach(([key, label]) => {
          if (same[key]) return;
          const row = el('div', `lvl-row lvl-${key}`);
          row.append(el('dt', '', label));
          const dd = el('dd');
          if (has(p[key])) richText(dd, p[key]); else dd.append(el('span', 'dim', 'Not given'));
          row.append(dd);
          dl.append(row);
        });
        card.append(dl);
        grid.append(card);
      });
      s.append(grid);
      // What the cards do not say, under them: a small titled block each ("Entry requirements", "English").
      view.more.forEach(([title, text]) => { const m = el('div', 'more-block'); m.append(el('h3', '', title)); richText(m, text, { sub: true }); s.append(m); });
    });
  }

  // ---- the courses ----
  function linkOf(name) {
    if (!courseData) return { link: '', notFound: false };
    const all = [...(courseData.general || []), ...Object.values(courseData.intakes || {}).flat()];
    const hit = all.find((c) => c.course.toLowerCase() === name.toLowerCase());
    return hit ? { link: hit.link, notFound: hit.notFound } : { link: '', notFound: false };
  }
  function renderCourses(doc, view) {
    if (!view.courses.length) return;
    section(doc, `Courses (${view.courses.length})`, (s) => {
      // A filter for a long list: "nursing" shows only those courses, every group opened (the owner, 17 Nov 2026).
      if (view.courses.length > 12) {
        const wrap = el('div', 'course-filter no-print');
        const box = el('input', 'search');
        box.type = 'search';
        box.placeholder = `Filter the ${view.courses.length} courses, e.g. nursing`;
        box.setAttribute('aria-label', 'Filter the courses');
        box.value = courseQuery;
        const info = el('span', 'course-filter-info');
        info.setAttribute('aria-live', 'polite');
        wrap.append(box, info);
        s.append(wrap);
        box.addEventListener('input', () => { courseQuery = box.value; filterCourses(s, info); });
        setTimeout(() => filterCourses(s, info), 0);
      }
      view.groups.forEach((g) => {
        const items = view.courses.filter((c) => c.group === g);
        if (view.groups.length > 1 || g !== 'Courses') s.append(el('h3', 'course-group', `${g} (${items.length})`));
        const ul = el('ul', 'course-list');
        items.forEach((c) => {
          const li = el('li');
          li.dataset.name = `${c.course} ${c.intakes.join(' ')}`.toLowerCase();
          const { link, notFound } = linkOf(c.full || c.course);
          const name = el(link ? 'a' : 'span', 'course-name', c.course);
          if (link) { name.href = link; name.target = '_blank'; name.rel = 'noopener'; }
          li.append(name);
          if (c.intakes.length) li.append(el('span', 'course-intakes', c.intakes.join(' · ')));
          // Not found on the university's website by the automatic check (course-sitemap.js): only then does the team look.
          if (notFound && !student()) li.append(el('span', 'course-warn', 'Course page not found'));
          // The weekly check of the course pages (course-watch.js): a page gone or changed, until Admin confirms it.
          const w = !student() && watch.warnings.find((x) => String(x.course).toLowerCase() === (c.full || c.course).toLowerCase());
          if (w) {
            const tag = el('span', 'course-warn', { inactive: 'Course page gone', unclear: 'Course page no longer matches', changed: 'Course page changed' }[w.status] || 'Course page to check');
            tag.title = w.note || '';
            li.append(tag);
            if (watch.admin) {
              const ok = el('button', 'p-link no-print', 'Checked');
              ok.type = 'button';
              ok.addEventListener('click', async () => { let done = false; try { done = (await fetch('/api/course-watch/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: w.key }) })).ok; } catch (e) { /* offline */ } if (!done) { window.NiecUI.toast('That did not work. Try again.', { type: 'error' }); return; } watch.warnings = watch.warnings.filter((x) => x !== w); render(); });
              li.append(ok);
            }
          }
          const intake = c.intakes[0] || (view.intakeNames.length === 1 ? view.intakeNames[0] : '');
          if (student() && window.Shortlist.isLinked()) li.append(window.Shortlist.button(uni, c.full || c.course, intake));
          else if (team() && window.ShortlistFor) li.append(window.ShortlistFor.button({ universityId: uni.id, university: uni.name, course: c.full || c.course, intake, level: g }));
          ul.append(li);
        });
        ul.dataset.group = g;
        s.append(ul);
      });
    });
  }
  // Shows only the courses with every word typed; with nothing typed, every course (no Show all: the owner, 20 Nov 2026).
  let courseQuery = '';
  function filterCourses(s, info) {
    const words = courseQuery.toLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    s.querySelectorAll('ul.course-list').forEach((ul) => {
      let inGroup = 0;
      ul.querySelectorAll('li').forEach((li) => {
        const hit = words.every((w) => li.dataset.name.includes(w));
        li.hidden = words.length ? !hit : false;
        if (hit) inGroup += 1;
      });
      count += inGroup;
      const off = words.length > 0 && inGroup === 0;
      ul.hidden = off;
      const head = ul.previousElementSibling;
      if (head && head.classList.contains('course-group')) head.hidden = off;
      const more = ul.nextElementSibling;
      if (more && more.classList.contains('course-more')) more.hidden = words.length > 0;
    });
    info.textContent = words.length ? (count ? `${count} course${count === 1 ? '' : 's'} match` : 'No course matches') : '';
  }

  // ---- sharing ----
  // A short summary to paste into WhatsApp or an email (*bold* for WhatsApp): the deadlines, then per level the fee, scholarship,
  // entry and English, from the same clean view as the page.
  const flat = (t) => String(t || '').split('\n').map((l) => l.replace(/^\s*(?:[-*\u2022]\s+|##\s+)/, '').trim()).filter(Boolean).join('; ');
  function summaryText(view) {
    const out = [`*${view.name}*${has(view.city) ? ` (${view.city})` : ''}`];
    if (has(view.website)) out.push(view.website);
    view.deadlines.filter((d) => d.applyBy).forEach((d) => out.push(`${d.name}: ${d.applyBy.closed ? 'closed' : `apply by ${d.applyBy.when}`}`));
    view.programs.forEach((p) => {
      out.push('', `*${p.name}${has(p.duration) ? ` (${p.duration})` : ''}*`);
      [['Tuition fee', p.tuition], ['Scholarship', p.scholarship], ['Entry', p.academic], ['English', p.english], ['Deposit', p.deposit]]
        .forEach(([label, value]) => { if (has(value)) out.push(`${label}: ${flat(value)}`); });
    });
    return out.join('\n');
  }
  async function copySummary(view) {
    try { await navigator.clipboard.writeText(summaryText(view)); window.NiecUI.toast('Summary copied. Paste it into WhatsApp or an email.', { type: 'success' }); } catch (e) { window.NiecUI.toast('Could not copy.', { type: 'error' }); }
  }


  // ---- the university page (the owner, 20 Nov 2026) ----
  // Every university and international college with a profile is drawn this way: a large picture with the logo, the name and the place
  // and, for Admin and the Application Team, one "Apply now" button that opens a window with how to apply (the partner, the portal link
  // or email, the username and password to copy; never a student or a shortlist, the owner, 21 Nov 2026); four facts (location, intake, deadline, tuition from); the video and pictures; a short about
  // with the key points; one card per level (fee and scholarship first, then the entry and English requirements and the rest) in the
  // order foundation, year one, undergraduate, postgraduate, pre-masters, masters by research; every January 2027 course by level, each
  // with Shortlist (Share for the Application Team, the owner, 21 Nov 2026); and the deadlines. The courses and requirements are the partner's January 2027 figures, or, for a direct route
  // (`own`), the university page's own figures. Nothing says which partner it is applied through: that is only in the Apply window.
  // The levels, their order and each course's level are read the same way here, in Assign task and on the server (fact-present.js).
  const { LEVEL_ORDER, levelOf } = P;
  const PATHWAY_RE = /international college|\bISC\b|study centre|oncampus|pathway|\bINTO\b|\bKaplan\b/i;
  const Q1 = /\b(jan(uary)?|feb(ruary)?|mar(ch)?)\s*2027\b/i;
  // "January 2027, February 2027" -> "Jan, Feb 2027".
  // A course's name without the partner's code at its end: "(NN41)", "(CID921)".
  const cleanName = (n) => String(n || '').replace(/\s*\((?:CID)?[A-Z]{1,4}\d{1,4}[A-Z]{0,2}\)/g, '').replace(/\s{2,}/g, ' ').trim();
  // "£2,000/- per year", "upto £5,000", "Gross Fee £16,020": written plainly.
  const tidyMoney = (v) => String(v || '').replace(/\/-/g, '').replace(/\bupto\b/gi, 'Up to').replace(/^gross fee:?\s*/i, '').replace(/\s{2,}/g, ' ').trim();
  const firstLine = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  // Read as numbers: "IELTS: 6 overall (no band below 5.5)" and "IELTS: 6.0 overall (5.5 in each component)" are the same rule.
  const TESTS = [['IELTS UKVI', /ielts\s*ukvi/i], ['IELTS', /ielts/i], ['PTE', /\bpte\b/i], ['TOEFL', /toefl/i], ['Duolingo', /duolingo/i]];
  const testsOf = (v) => {
    const out = {};
    String(v || '').split('\n').forEach((line) => {
      const t = TESTS.find(([, re]) => re.test(line));
      if (!t || out[t[0]]) return;
      const nums = (line.replace(/^[^:]*:/, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length) out[t[0]] = nums.slice(0, 2);
    });
    return out;
  };
  // The grade asked: the first percentage of each line (after its label), the lowest of the lines ("Grade 12: 60%, no subject below 40%" is 60).
  const pctOf = (v) => Math.min(...String(v || '').split('\n').map((line) => { const m = /(\d{2})\s*%/.exec(line.replace(/^[^:]*:/, '')); return m ? parseInt(m[1], 10) : 999; }));
  // A course's own requirement is shown when it asks more than its level's general one (the owner, 20 Nov 2026: "IELTS 6.0 with
  // no band below 5.5 for the level, but 7.0 with no band below 7.0 for one course"): a higher overall score, a higher lowest band
  // where both give one, or a higher percentage. When the level gives none, the course's own is shown.
  const differs = (mine, general, kind) => {
    if (!String(mine || '').trim()) return false;
    if (!String(general || '').trim()) return true;
    if (kind === 'English') { const a = testsOf(mine); const b = testsOf(general); return Object.keys(a).some((k) => b[k] && (a[k][0] > b[k][0] || (a[k].length > 1 && b[k].length > 1 && a[k][1] > b[k][1]))); }
    const a = pctOf(mine); const b = pctOf(general);
    return a < 999 && b < 999 && a > b;
  };
  // "36 months" -> "3 years", "42 months" -> "3 years 6 months", "12 months" -> "1 year".
  const years = (d) => {
    const m = /^(\d+)\s*months?$/i.exec(String(d).trim());
    if (!m || +m[1] < 12) return String(d);
    const y = Math.floor(+m[1] / 12); const r = +m[1] % 12;
    return `${y} year${y === 1 ? '' : 's'}${r ? ` ${r} month${r === 1 ? '' : 's'}` : ''}`;
  };
  const shortIntake = (s) => { const ms = String(s || '').split(/,\s*/).map((x) => x.trim().slice(0, 3)).filter(Boolean); return ms.length ? `${ms.join(', ')} 2027` : ''; };
  // A short key for a level's colour on the page.
  const lv0 = (name) => ({ 'International Foundation Year': 'ify', 'International Year One': 'iy1', Undergraduate: 'ug', Postgraduate: 'pg', 'Pre-Masters': 'pm', 'Extended Masters': 'em', 'Masters by Research': 'mr', PhD: 'phd' }[LEVEL_ORDER.includes(name) ? name : levelOf(name)] || 'other');
  const media = (u) => (/^https:\/\//.test(String(u || '')) ? `/api/media?u=${encodeURIComponent(u)}` : u); // the server's kept copy (media-cache.js)
  function img(src, cls, alt = '') { const i = el('img', cls); i.src = media(src); i.alt = alt; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); }); return i; }
  function copyBtn(value, label) {
    const b = el('button', 'up-copy no-print', label || 'Copy');
    b.type = 'button';
    b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); b.textContent = 'Copied'; setTimeout(() => { b.textContent = label || 'Copy'; }, 1400); } catch (e) { window.NiecUI.toast('Could not copy.', { type: 'error' }); } });
    return b;
  }
  // Lines once each, whatever their spacing or capitals ("IELTS: 6.0 overall" given twice by the partner is shown once).
  const uniq = (lines) => { const seen = new Set(); return lines.map((l) => String(l).trim()).filter((l) => { const k = l.toLowerCase().replace(/[^a-z0-9]+/g, ''); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  const money = (t) => (String(t || '').match(/£\s?[\d,]{3,}/g) || []).map((x) => Number(x.replace(/[^\d]/g, ''))).filter((n) => n >= 500 && n < 100000);
  const pretty = (n) => `£${n.toLocaleString('en-GB')}`;
  // The Apply window (Admin and the Application Team): where and how to apply, with the login to copy.
  function applyWindow() {
    const A = applyVia;
    window.Portal.dialog(`Apply to ${uni.name}`, (body, close) => {
      const steps = el('ol', 'up-steps');
      const step = (title, ...rest) => { const li = el('li'); const t = el('div', 'up-step-text'); t.append(el('b', '', title), ...rest); li.append(t); steps.append(li); return li; };
      if (A.portal) {
        const go = el('a', 'btn btn-primary', 'Open the portal'); go.href = A.portal; go.target = '_blank'; go.rel = 'noopener';
        step(A.partner, go);
      } else if (A.email) {
        const row = el('div', 'up-cred'); row.append(el('span', '', A.email), copyBtn(A.email));
        step(`Send the application to ${A.partner}`, row);
      } else {
        step(A.partner, el('span', 'up-step-sub', 'No portal saved yet: Admin adds it on Partners.'));
      }
      if (A.login && (A.login.user || A.login.password)) {
        const box = el('div', 'up-creds');
        if (A.login.user) { const r = el('div', 'up-cred'); r.append(el('span', 'up-cred-k', 'Username'), el('code', '', A.login.user), copyBtn(A.login.user)); box.append(r); }
        if (A.login.password) {
          const r = el('div', 'up-cred'); const code = el('code', '', '••••••••••');
          const show = el('button', 'up-copy', 'Show'); show.type = 'button';
          show.addEventListener('click', () => { const on = show.textContent === 'Show'; code.textContent = on ? A.login.password : '••••••••••'; show.textContent = on ? 'Hide' : 'Show'; });
          r.append(el('span', 'up-cred-k', 'Password'), code, show, copyBtn(A.login.password));
          box.append(r);
        }
        step('Log in', box);
      }
      // Only where to apply and the login (the owner, 21 Nov 2026, for everyone): no student, no shortlisted course, no contact people.
      body.append(steps);
      const foot = el('div', 'p-dialog-foot');
      const done = el('button', 'btn', 'Close'); done.type = 'button'; done.addEventListener('click', () => close());
      foot.append(done);
      body.append(foot);
    });
  }
  function renderProfile() {
    const P0 = uni.profile;
    const view = P.present(uni);
    const data = P.pageData(uni);
    const doc = el('article', 'doc up-doc');
    const city = P0.city || uni.city;
    const campuses = P.campusesOf(uni, data.courses);
    // The general requirement card of a level (by its category), for the course cards.
    const levelFor = (g) => data.levels.find((l) => l.level === g) || data.levels.find((l) => (levelOf(l.level) || '') === g) || {};
    const fees = [...data.courses.flatMap((c) => money(c.fee)), ...data.levels.flatMap((l) => money(l.tuition))];
    const deadline = P0.own ? (view.deadlines.find((d) => d.applyBy && Q1.test(d.name)) || view.deadlines.find((d) => d.applyBy) || null) : null;
    // The next date still open (a date that has passed is never shown as "Apply by"), else "Closed".
    // The first application deadline still to come (a deposit or CAS date never stands in for it once the deadline has passed).
    const nextPartner = P.nextApplyBy(P0.deadlines);
    const openOwn = deadline && deadline.applyBy && !deadline.applyBy.closed && typeof deadline.applyBy.days === 'number' && deadline.applyBy.days >= 0 ? deadline : (P0.own ? view.deadlines.find((d) => Q1.test(d.name) && d.applyBy && !d.applyBy.closed && d.applyBy.days >= 0) : null);
    const shortDate = (t) => String(t || '').replace(/\b(January|February|March|April|June|July|August|September|October|November|December)\b/g, (m) => m.slice(0, 3));
    const anyDate = P0.own ? view.deadlines.some((d) => d.applyBy) : (P0.deadlines || []).length > 0;
    const deadlineText = openOwn ? shortDate(openOwn.applyBy.when) : nextPartner ? nextPartner.when : (anyDate ? 'Closed' : '');
    const daysText = openOwn ? openOwn.applyBy.days : nextPartner ? nextPartner.days : null;

    // the top: picture, logo, name, place, Apply now
    const hero = el('header', 'up-hero' + (P0.banner ? '' : ' no-pic'));
    // The top pictures slide one into the next on their own (the owner, 20 Nov 2026: sliding, not zooming).
    clearInterval(heroTimer);
    clearInterval(galleryTimer);
    // The cover takes the first three pictures and the gallery the others, so no picture is shown twice (the reviewer, 20 Nov 2026).
    const allPics = [P0.banner, ...P0.photos].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k);
    // Up to four pictures all go to the cover; with more, the cover takes three and the gallery the rest (never a gallery of one).
    const heroCount = allPics.length <= 4 ? allPics.length : 3;
    const slides = allPics.slice(0, heroCount);
    // A picture that does not load, or is too small to fill the cover sharply, leaves the cover with its dot; with none left the
    // cover shows its blue colour. So no slide is ever empty, black or white (the owner, 20 Nov 2026).
    const dots = el('div', 'up-dots no-print');
    dots.style.setProperty('--dur', `${HERO_MS}ms`);
    let at = 0;
    const dotList = () => [...dots.querySelectorAll('.up-dot')];
    const heroImgs = () => [...hero.querySelectorAll('.up-hero-img')];
    const show = (k) => {
      const all = heroImgs(); if (!all.length) return;
      const last = at; at = (k + all.length) % all.length;
      all.forEach((x, n) => { x.classList.toggle('is-on', n === at); x.classList.toggle('is-out', n === last && n !== at); });
      dotList().forEach((x, n) => { x.classList.remove('is-on'); x.removeAttribute('aria-current'); if (n === at) { void x.offsetWidth; x.classList.add('is-on'); x.setAttribute('aria-current', 'true'); } });
    };
    // A pause button beside the dots (moving pictures must be stoppable); paused, the dot stops filling.
    let heroPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heroPlay = el('button', 'up-play-toggle up-hero-play no-print');
    heroPlay.type = 'button';
    const showHeroPlay = () => { heroPlay.classList.toggle('is-paused', heroPaused); heroPlay.setAttribute('aria-label', heroPaused ? 'Play the cover pictures' : 'Pause the cover pictures'); dots.classList.toggle('is-held', heroPaused); };
    heroPlay.addEventListener('click', () => { heroPaused = !heroPaused; showHeroPlay(); show(at); tick(); });
    showHeroPlay();
    const tick = () => { clearInterval(heroTimer); if (heroImgs().length > 1 && !heroPaused) heroTimer = setInterval(() => { if (!document.hidden) show(at + 1); }, HERO_MS); };
    const drop = (im) => {
      const n = heroImgs().indexOf(im); if (n < 0) return;
      im.remove(); if (dotList()[n]) dotList()[n].remove();
      if (!heroImgs().length) { hero.classList.add('no-pic'); dots.remove(); clearInterval(heroTimer); return; }
      dots.hidden = heroImgs().length < 2;
      if (n === at || at >= heroImgs().length) { at = 0; show(0); } else if (n < at) at -= 1;
      tick();
    };
    slides.forEach((src, k) => {
      const im = img(src, 'up-hero-img' + (k === 0 ? ' is-on' : ''), '');
      im.loading = 'eager';
      im.addEventListener('error', () => drop(im));
      im.addEventListener('load', () => { if (im.naturalWidth < 560) drop(im); });
      hero.append(im);
      const d = el('button', `up-dot${k === 0 ? ' is-on' : ''}`); d.type = 'button'; d.setAttribute('aria-label', `Picture ${k + 1}`);
      d.addEventListener('click', () => { show(dotList().indexOf(d)); tick(); });
      dots.append(d);
    });
    if (slides.length > 1) { dots.prepend(heroPlay); hero.append(dots); }
    tick();
    const inner = el('div', 'up-hero-inner');
    const id = el('div', 'up-id');
    const logo = el('div', 'up-logo');
    const initials = () => el('span', '', (uni.name.match(/\b[A-Z]/g) || ['U']).slice(0, 3).join(''));
    if (P0.logo) { const l = img(P0.logo, '', `${uni.name} logo`); l.addEventListener('error', () => logo.append(initials())); logo.append(l); } else logo.append(initials());
    const words = el('div', 'up-titles');
    words.append(el('h1', '', uni.name));
    const sub = el('div', 'up-sub');
    if (has(city)) sub.append(el('span', 'up-place', city));
    sub.append(el('span', 'up-chip', P0.type === 'college' ? 'International college' : 'University'));
    words.append(sub);
    id.append(logo, words);
    inner.append(id);
    if (applyVia) { const go = el('button', 'btn btn-primary up-apply no-print', 'Apply now'); go.type = 'button'; go.addEventListener('click', applyWindow); inner.append(go); }
    hero.append(inner);
    doc.append(hero);

    // four facts
    const facts = el('section', 'up-facts up-reveal');
    const fact = (label, value, small) => { const f = el('div', 'up-fact'); f.append(el('span', 'up-fact-label', label), el('b', value ? '' : 'is-none', value || 'Not given')); if (small) f.append(el('small', '', small)); facts.append(f); };
    fact('Location', city);
    fact('Intake', data.intake, campuses.length > 1 ? `${campuses.length} campuses` : null);
    fact('Apply by', deadlineText, typeof daysText === 'number' ? (daysText === 0 ? 'Today' : daysText === 1 ? '1 day left' : `${daysText} days left`) : null);
    fact('Tuition from', fees.length ? `${pretty(Math.min(...fees))} a year` : '', data.courses.length ? `${data.courses.length} courses` : null);
    doc.append(facts);

    // video and pictures (the owner, 20 Nov 2026): the pictures fill one large frame edge to edge (no blurred bands) and fade one into
    // the next on their own, with a bar under each that fills while it is shown; a click on a bar goes to it, the mouse over the frame
    // holds it. The video has its own frame beside them and plays only when pressed.
    const pics = allPics.slice(heroCount);
    if (pics.length > 1 || P0.video) {
      const m = el('section', 'up-section up-gallery no-print up-reveal');
      m.append(el('h2', '', P0.video ? 'See the campus' : 'Pictures'));
      const row = el('div', 'up-media' + (P0.video && pics.length > 1 ? ' has-both' : ''));
      if (pics.length > 1) {
        const film = el('div', 'up-film');
        const wrap = el('div', 'up-film-wrap');
        const bars = el('div', 'up-bars');
        const count = el('span', 'up-count', `1 / ${pics.length}`);
        pics.forEach((src, k) => {
          const f = img(src, 'up-frame' + (k === 0 ? ' is-on' : ''), `${uni.name}, picture ${k + 1}`);
          f.loading = k < 2 ? 'eager' : 'lazy';
          const b = el('button', k === 0 ? 'is-on' : ''); b.type = 'button'; b.setAttribute('aria-label', `Picture ${k + 1}`);
          b.append(el('i'));
          b.addEventListener('click', () => { go([...bars.children].indexOf(b)); restart(); });
          // A picture that does not load or is too small to fill the frame sharply leaves with its bar (no empty slide).
          const dropF = () => {
            const n = [...film.querySelectorAll('.up-frame')].indexOf(f); if (n < 0) return;
            f.remove(); b.remove();
            const left = film.querySelectorAll('.up-frame').length;
            if (!left) { wrap.remove(); row.classList.remove('has-both'); if (!row.children.length) m.remove(); return; }
            bars.hidden = count.hidden = left < 2;
            if (n <= at) at = Math.max(0, at - 1);
            go(at); restart();
          };
          f.addEventListener('error', dropF);
          f.addEventListener('load', () => { if (f.naturalWidth < 560 || f.naturalWidth / f.naturalHeight > 2.7) dropF(); });
          film.append(f);
          bars.append(b);
        });
        let at = 0;
        const go = (k) => {
          const frames = [...film.querySelectorAll('.up-frame')];
          if (!frames.length) return;
          at = (k + frames.length) % frames.length;
          frames.forEach((x, n) => x.classList.toggle('is-on', n === at));
          [...bars.children].forEach((x, n) => { x.classList.remove('is-on'); if (n === at) { void x.offsetWidth; x.classList.add('is-on'); } });
          count.textContent = `${at + 1} / ${frames.length}`;
        };
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        // It moves only while it can be seen, is not paused with the button, and the mouse is not resting on it.
        let paused = still; let seen = true;
        const held = () => paused || !seen || film.matches(':hover');
        const restart = () => { clearInterval(galleryTimer); film.classList.toggle('is-held', held()); if (!held()) galleryTimer = setInterval(() => { if (!document.hidden && !held()) go(at + 1); }, GALLERY_MS); };
        film.addEventListener('mouseenter', () => film.classList.add('is-held'));
        film.addEventListener('mouseleave', () => { go(at); restart(); });
        const play = el('button', 'up-play-toggle no-print');
        play.type = 'button';
        const showPlay = () => { play.classList.toggle('is-paused', paused); play.setAttribute('aria-label', paused ? 'Play the pictures' : 'Pause the pictures'); };
        play.addEventListener('click', (e) => { e.stopPropagation(); paused = !paused; showPlay(); go(at); restart(); });
        showPlay();
        film.append(play);
        // The arrow keys move between the pictures once the frame has the focus.
        film.tabIndex = 0;
        film.setAttribute('role', 'region');
        film.setAttribute('aria-roledescription', 'carousel');
        film.setAttribute('aria-label', `${uni.name} pictures`);
        film.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(at + (e.key === 'ArrowRight' ? 1 : -1)); restart(); } });
        if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { seen = en.isIntersecting; if (seen) go(at); restart(); }, { threshold: 0.35 }).observe(film);
        // a swipe on a phone moves too
        let x0 = null;
        film.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        film.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { go(at + (dx < 0 ? 1 : -1)); restart(); } x0 = null; });
        film.append(count);
        wrap.style.setProperty('--dur', `${GALLERY_MS}ms`);
        wrap.append(film, bars);
        row.append(wrap);
        restart();
      }
      if (P0.video) {
        const id2 = (P0.video.match(/embed\/([\w-]{11})/) || [])[1];
        const v = el('button', 'up-watch');
        v.type = 'button';
        v.setAttribute('aria-label', `Play the ${uni.name} video`);
        if (id2) v.append(img(`https://i.ytimg.com/vi/${id2}/hqdefault.jpg`, 'up-watch-img', ''));
        v.append(el('span', 'up-play'), el('span', 'up-watch-label', 'Watch the video'));
        v.addEventListener('click', () => {
          const f = el('iframe', 'up-video');
          f.src = P0.video.replace('www.youtube.com', 'www.youtube-nocookie.com') + '?rel=0&modestbranding=1&autoplay=1';
          f.title = `${uni.name} video`; f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
          const box = el('div', 'up-watch is-playing');
          box.append(f);
          v.replaceWith(box);
        });
        row.append(v);
      }
      m.append(row);
      doc.append(m);
    }
    // a short about and the key points
    if (has(P0.about) || P0.keyPoints.length) {
      const a = el('section', 'up-section up-about up-reveal');
      const left = el('div');
      left.append(el('h2', '', 'About'));
      if (has(P0.about)) P0.about.split('\n').filter(Boolean).slice(0, 2).forEach((l) => left.append(el('p', 'up-about-text', l)));
      if (has(P0.website)) { const w = el('a', 'up-web', String(P0.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); w.href = /^https?:/.test(P0.website) ? P0.website : 'https://' + P0.website; w.target = '_blank'; w.rel = 'noopener'; left.append(w); }
      a.append(left);
      if (P0.keyPoints.length) { const ul = el('ul', 'up-points'); P0.keyPoints.forEach((k) => ul.append(el('li', '', k))); a.append(ul); }
      doc.append(a);
    }

    // entry requirements: one card per level
    const catOf = (l) => (LEVEL_ORDER.includes(l.level) ? l.level : (levelOf(l.level) || 'Other courses'));
    const levels = [...data.levels].filter((l) => P0.own || !data.courses.length || data.courses.some((c) => c.level === catOf(l))).sort((x, y) => { const i = (l) => { const k = LEVEL_ORDER.indexOf(l.level); return k < 0 ? LEVEL_ORDER.indexOf(levelOf(l.level) || 'Other courses') : k; }; return i(x) - i(y); });
    if (levels.length) {
      const sec = el('section', 'up-section');
      sec.append(el('h2', '', 'Entry requirements'));
      levels.forEach((L) => {
        const card = el('div', 'up-level up-reveal');
        card.dataset.level = lv0(L.level);
        const head = el('div', 'up-level-head');
        const lv = LEVEL_ORDER.includes(L.level) ? L.level : (levelOf(L.level) || '');
        const n = data.courses.filter((c) => c.level === lv).length;
        // The level by its category in the owner's order, with the university's own name for it under it when different.
        const h3 = el('h3', '', lv && lv !== 'Other courses' ? lv : L.level);
        if (lv && lv !== L.level && lv !== 'Other courses') h3.append(el('small', 'up-level-own', L.level));
        head.append(h3);
        // How many of the level's courses ask more than this card (each says so on its own card).
        const more = data.courses.filter((c) => c.level === lv && (differs(c.english, L.english, 'English') || differs(c.academic, L.academic, 'Entry'))).length;
        // One pill: the number of courses, and how many of them ask more than this card (each says so on its own card).
        if (n) { const a = el('a', 'up-level-link no-print'); a.append(el('span', '', `${n} course${n === 1 ? '' : 's'}`)); if (more && L.english) { a.append(el('em', 'up-level-more', `${more} ask${more === 1 ? 's' : ''} more`)); a.title = 'Each course that asks more shows its own requirement on its card'; } a.href = '#lvl-' + (lv || L.level).replace(/\W+/g, '-'); head.append(a); }
        card.append(head);
        const money2 = el('div', 'up-money');
        [['Tuition fee', L.tuition], ['Scholarship', L.scholarship]].forEach(([k, v]) => {
          const t = el('div', 'up-money-tile');
          t.append(el('span', 'up-money-k', k));
          const amounts = money(v);
          t.append(el('b', `up-money-v${amounts.length || has(v) ? '' : ' is-none'}`, amounts.length ? (k === 'Tuition fee' && amounts.length > 1 ? `${pretty(Math.min(...amounts))} to ${pretty(Math.max(...amounts))}` : pretty(k === 'Tuition fee' ? Math.min(...amounts) : Math.max(...amounts))) : (has(v) ? '' : 'Not given')));
          // The words under the amount, without a line that only repeats the amount.
          const extra = uniq(String(v || '').split('\n').map(tidyMoney)).filter((line) => !/^(gross fee:?\s*|ranges from\s*|up to\s*|scholarship (of|upto|up to)?\s*)?£\s?[\d,]+(\s*(to|-)\s*£\s?[\d,]+)?(\s*(a|per|each)\s*year)?\.?$/i.test(line.replace(/^[-*•]\s+/, '').trim()));
          if (extra.length) { const d = el('div', 'up-money-d'); extra.slice(0, 4).forEach((line) => d.append(el('p', '', line.replace(/^[-*•]\s+/, '')))); t.append(d); }
          money2.append(t);
        });
        card.append(money2);
        const reqs = el('div', 'up-reqs');
        [['Entry requirement', L.academic, 'up-ic-cap'], ['English', L.english, 'up-ic-lang']].forEach(([k, v, ic]) => {
          const b = el('div', 'up-req');
          b.append(el('span', `up-req-k ${ic}`, k));
          if (has(v)) { const ul = el('ul'); uniq(String(v).split('\n')).forEach((line) => ul.append(el('li', '', line.replace(/^[-*•]\s+/, '')))); b.append(ul); } else b.append(el('p', 'dim', 'Not given'));
          reqs.append(b);
        });
        card.append(reqs);
        if (has(L.extra)) { const chips = el('div', 'up-extra'); String(L.extra).split('\n').filter(Boolean).forEach((x) => chips.append(el('span', '', x))); card.append(chips); }
        sec.append(card);
      });
      doc.append(sec);
    }

    // every January 2027 course, by level
    if (data.courses.length) {
      const sec = el('section', 'up-section up-courses');
      sec.id = 'courses';
      const top = el('div', 'up-courses-head');
      top.append(el('h2', '', `Courses for ${data.intake}`));
      const box = el('input', 'search no-print');
      box.type = 'search'; box.placeholder = `Search ${data.courses.length} courses`; box.setAttribute('aria-label', 'Search the courses');
      top.append(box);
      sec.append(top);
      let onlyLevels = null; // set when opened from Find universities for one level
      const groups = LEVEL_ORDER.filter((g) => data.courses.some((c) => c.level === g));
      const jump = el('div', 'up-jump no-print');
      groups.forEach((g) => { const a = el('a', '', `${g} · ${data.courses.filter((c) => c.level === g).length}`); a.href = '#lvl-' + g.replace(/\W+/g, '-'); jump.append(a); });
      if (groups.length > 1) sec.append(jump);
      groups.forEach((g) => {
        const items = data.courses.filter((c) => c.level === g).sort((x, y) => x.name.localeCompare(y.name));
        const block = el('div', 'up-group');
        block.dataset.level = g;
        block.id = 'lvl-' + g.replace(/\W+/g, '-');
        const gh = el('div', 'up-group-head');
        // A pathway page (its requirement cards are foundation, year one or pre-masters) lists the degrees students progress to:
        // those are named so, not shown as if the page offered direct entry at that level.
        const PATHWAYS = ['International Foundation Year', 'International Year One', 'Pre-Masters'];
        const progression = data.levels.length && data.levels.every((l) => PATHWAYS.includes(catOf(l))) && !PATHWAYS.includes(g);
        const countEl = el('span', 'up-group-count', `${items.length} course${items.length === 1 ? '' : 's'}`);
        gh.append(el('h3', '', progression ? `${g} degrees you progress to` : g), countEl);
        block.append(gh);
        const grid = el('div', 'up-course-grid');
        items.forEach((c) => {
          const card = el('div', 'up-course up-reveal');
          card.style.setProperty('--d', `${(grid.children.length % 6) * 50}ms`);
          card.dataset.name = c.name.toLowerCase();
          card.append(el('b', 'up-course-name', cleanName(c.name)));
          // Every course says when it starts, where, how long, what it costs and its scholarship (the owner, 20 Nov 2026), and its own
          // requirement when it asks more than the level's general one (a 7.0 IELTS where the level asks 6.0).
          const L = levelFor(g);
          const where = el('div', 'up-course-where');
          where.append(el('span', 'up-c-intake', shortIntake(c.start || data.intake)), el('span', 'up-c-campus', c.campus || campuses[0] || uni.city || 'UK'));
          if (c.duration) where.append(el('span', 'up-c-time', years(c.duration)));
          card.append(where);
          const fee = tidyMoney(c.fee || firstLine(L.tuition));
          // "Scholarship of £4,000" in the Scholarship tile reads "£4,000"; "Upto" reads "Up to".
          const sch = tidyMoney(c.scholarship || firstLine(L.scholarship)).replace(/^scholarships?\s*(of|:|-)?\s*/i, '');
          const money2 = el('div', 'up-course-money');
          const tile = (k, v, cls) => { const t = el('div', `up-cm ${cls}`); t.append(el('span', '', k), el('b', '', v || 'Not given')); if (!v) t.classList.add('is-none'); money2.append(t); return t; };
          // Every course card shows its tuition fee and its scholarship, "Not given" when there is none (the owner, 21 Nov 2026).
          tile('Tuition fee', fee, 'is-fee');
          { const full = sch; const short = sch.length > 60 ? (sch.split(/(?<=\))\s|\.\s|;\s/)[0] || sch).slice(0, 70) : sch; const st = tile('Scholarship', short, 'is-sch'); if (short !== full) st.title = full; if (sch && !c.scholarship && L.scholarship) st.title = L.scholarship; }
          if (money2.children.length === 1) money2.classList.add('is-one');
          if (money2.children.length) card.append(money2);
          // Only what asks more: the English tests whose score or band is higher than the level's, the grade when higher.
          const higherTests = (mine, general) => { if (!String(general || '').trim()) return String(mine || '').split('\n').filter(Boolean); const b = testsOf(general); return String(mine || '').split('\n').filter((line) => { const a = testsOf(line); return Object.keys(a).some((k) => b[k] && (a[k][0] > b[k][0] || (a[k].length > 1 && b[k].length > 1 && a[k][1] > b[k][1]))); }); };
          const own = [['English', higherTests(c.english, L.english).join('\n'), L.english], ['Entry', c.academic, L.academic]].filter(([k, mine, general]) => differs(mine, general, k));
          if (own.length) {
            const req = el('div', 'up-course-req');
            req.append(el('span', 'up-req-tag', 'Course requirement'));
            own.forEach(([k, v]) => { const line = el('div', 'up-req-line'); line.append(el('b', '', k), el('span', '', String(v).split('\n').slice(0, 2).join(' · '))); req.append(line); });
            card.append(req);
          }
          const foot = el('div', 'up-course-foot');
          if (c.deadline) {
            const d = P.parseDate(c.deadline); const left = d ? P.daysLeft(d.date) : null;
            foot.append(el('span', `up-course-deadline${left !== null && left < 0 ? ' is-closed' : left !== null && left <= 14 ? ' is-soon' : ''}`, left !== null && left < 0 ? `Closed ${c.deadline.replace(/ \d{4}$/, '')}` : `Apply by ${c.deadline}`));
          }
          if (team() && window.ShortlistFor) foot.append(window.ShortlistFor.button({ universityId: uni.id, university: uni.name, course: c.full || c.name, intake: String(c.start || data.intake).split(', ')[0], level: g, fee, scholarship: sch, duration: c.duration ? years(c.duration) : '', location: c.campus || campuses[0] || uni.city || '', deadline: c.deadline || '' }));
          else if (student() && window.Shortlist && window.Shortlist.isLinked()) foot.append(window.Shortlist.button(uni, c.full || c.name, String(c.start || data.intake).split(', ')[0]));
          if (foot.children.length) card.append(foot);
          grid.append(card);
        });
        block.append(grid);
        sec.append(block);
      });
      const none = el('p', 'up-none', 'No course matches.');
      none.hidden = true;
      sec.append(none);
      box.addEventListener('input', () => {
        const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        sec.querySelectorAll('.up-group').forEach((b) => { let n = 0; const inLevel = !onlyLevels || onlyLevels.includes(b.dataset.level); const total = b.querySelectorAll('.up-course').length; b.querySelectorAll('.up-course').forEach((c) => { const hit = inLevel && words.every((w) => c.dataset.name.includes(w)); c.hidden = !hit; if (hit) n += 1; }); b.hidden = n === 0; shown += n; const ce = b.querySelector('.up-group-count'); if (ce) ce.textContent = n === total ? `${total} course${total === 1 ? '' : 's'}` : `${n} of ${total} courses`; });
        sec.querySelectorAll('.up-jump').forEach((x) => { x.hidden = words.length > 0 || Boolean(onlyLevels); });
        levelNote.hidden = !onlyLevels;
        none.hidden = shown > 0;
      });
      // Opened from Find universities with a subject ("See all"): the search is set to it and the courses come into view.
      const asked = new URLSearchParams(location.search).get('q');
      // ... and only the level the student was checked for (the finder's levels are the student card's).
      const LEVEL_MAP = { Foundation: ['International Foundation Year'], 'International Year 1': ['International Year One'], 'Top-up (final year)': ['Undergraduate'], Undergraduate: ['Undergraduate'], 'Pre-Masters': ['Pre-Masters'], Postgraduate: ['Postgraduate', 'Extended Masters'], 'Masters by Research or PhD': ['Masters by Research', 'PhD'] };
      onlyLevels = LEVEL_MAP[new URLSearchParams(location.search).get('level')] || null;
      const levelNote = el('div', 'up-level-note no-print');
      levelNote.hidden = true;
      if (onlyLevels) {
        const all = el('button', 'p-link', 'Show every level');
        all.type = 'button';
        all.addEventListener('click', () => { onlyLevels = null; box.dispatchEvent(new Event('input')); });
        levelNote.append(el('span', '', `Showing ${onlyLevels.join(' and ')} only`), all);
        top.after(levelNote);
      }
      if (onlyLevels && !asked) { box.dispatchEvent(new Event('input')); setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); }
      if (asked) { box.value = asked.replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); box.dispatchEvent(new Event('input')); setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); }
      doc.append(sec);
    }

    // the deadlines for the intake (the partner's, or the page's own; read automatically, nobody changes them)
    const teamDates = (uni.intakes || []).some((i) => i.editedAt && (i.deadline || i.deadlines));
    if (!P0.own && P0.deadlines.length && !teamDates) {
      const sec = el('section', 'up-section');
      const head = el('div', 'up-courses-head');
      head.append(el('h2', '', `Deadlines for ${data.intake}`));
      sec.append(head);
      const ul = el('ul', 'up-deadlines');
      P0.deadlines.forEach((d) => ul.append(el('li', '', d)));
      sec.append(ul);
      doc.append(sec);
    } else {
      const wrap = el('div', 'up-section');
      // Only the January, February and March 2027 intakes (the owner, 20 Nov 2026).
      renderDeadlines(wrap, { ...view, deadlines: view.deadlines.filter((d) => Q1.test(d.name)) });
      doc.append(wrap);
    }
    $('view').replaceChildren(doc);
    motion(doc);
    document.title = `${uni.name} · Universities · ISR`;
    const bar = $('toolbar');
    const copy = el('button', 'btn', 'Copy summary');
    copy.type = 'button';
    copy.addEventListener('click', () => copyProfileSummary(data));
    const print = el('button', 'btn', 'Print or save as PDF');
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    bar.replaceChildren(copy, print);
  }
  // Things come into view as the page is scrolled (each card rises and fades in, a little after the one before), and the amounts in
  // the four tiles count up once. Nothing moves for a reader who asked for less motion; anything not yet shown appears after a moment
  // anyway, so the page is never left half empty (printing shows everything).
  let heroTimer = null;
  let galleryTimer = null;
  // 🔴 CSS CHANGED (2026-11-20): how long each gallery picture is shown (the bar under it fills in the same time) | from: 4.5 seconds | to: 3.5 seconds
  // 🔴 CSS CHANGED (2026-11-20): the cover dots fill in this time (set as --dur from here) | from: plain dots | to: the active dot fills like a progress bar over 4.5 seconds
  const HERO_MS = 4500; // each cover picture (one second faster, the owner, 20 Nov 2026)
  const GALLERY_MS = 3500; // how long each picture of the gallery is shown (the owner, 20 Nov 2026: one second faster)
  function motion(doc) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parts = [...doc.querySelectorAll('.up-reveal')];
    if (reduce || !('IntersectionObserver' in window)) { parts.forEach((x) => x.classList.add('is-in')); return; }
    document.documentElement.classList.add('up-motion');
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    parts.forEach((x) => io.observe(x));
    window.addEventListener('beforeprint', () => parts.forEach((x) => x.classList.add('is-in')));
    doc.querySelectorAll('.up-fact b').forEach((b) => {
      const m = /^£([\d,]+)(.*)$/.exec(b.textContent);
      if (!m) return;
      const end = Number(m[1].replace(/,/g, '')); const rest = m[2]; const t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / 900); b.textContent = `£${Math.round(end * (1 - Math.pow(1 - k, 3))).toLocaleString('en-GB')}${rest}`; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  // The same short summary to paste into WhatsApp or an email as on the other pages.
  async function copyProfileSummary(data) {
    const P0 = uni.profile;
    const out = [`*${uni.name}*${has(P0.city || uni.city) ? ` (${P0.city || uni.city})` : ''}`];
    if (has(P0.website)) out.push(String(P0.website));
    out.push(`${data.intake} intake`);
    P0.deadlines.slice(0, 3).forEach((d) => out.push(d));
    data.levels.forEach((L) => {
      out.push('', `*${L.level}*`);
      [['Tuition fee', L.tuition], ['Scholarship', L.scholarship], ['Entry', L.academic], ['English', L.english]].forEach(([k, v]) => { if (has(v)) out.push(`${k}: ${flat(v)}`); });
    });
    try { await navigator.clipboard.writeText(out.join('\n')); window.NiecUI.toast('Summary copied. Paste it into WhatsApp or an email.', { type: 'success' }); } catch (e) { window.NiecUI.toast('Could not copy.', { type: 'error' }); }
  }

  // ---- the page ----
  function render() {
    // Every university in the one page layout (the owner, 20 Nov 2026): a page with no partner profile gets an empty one of its own,
    // so its own requirements, courses and dates show the same way.
    if (!BACKUP) {
      if (!uni.profile) uni.profile = { own: true, type: PATHWAY_RE.test(uni.name) ? 'college' : 'university', intake: 'January 2027', logo: '', banner: '', photos: [], video: '', about: '', keyPoints: [], website: uni.website || '', city: uni.city || '', deadlines: [], levels: [], courses: [] };
      renderProfile(); return;
    }
    const view = P.present(uni);
    const doc = el('article', 'doc');
    const top = el('header', 'doc-head');
    const titles = el('div');
    titles.append(el('h1', '', view.name));
    const sub = el('div', 'doc-sub');
    if (has(view.city)) sub.append(el('span', '', view.city));
    if (has(view.website)) { const a = el('a', '', view.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); a.href = view.website; a.target = '_blank'; a.rel = 'noopener'; sub.append(a); }
    if (applyVia) sub.append(el('span', '', `Apply through: ${applyVia.partner}`));
    if (sub.children.length) titles.append(sub);
    top.append(titles);
    doc.append(top);

    renderDeadlines(doc, view);
    renderTable(doc, view);
    renderCourses(doc, view);
    // What is particular to one intake (its own requirements and notes); its dates are at the top.
    const particular = view.deadlines.filter((d) => has(d.requirements) || has(d.notes));
    if (particular.length) {
      section(doc, particular.length === 1 ? `${particular[0].name} intake` : 'Intakes', (s) => {
        particular.forEach((d) => {
          if (particular.length > 1) s.append(el('h3', '', d.name));
          if (has(d.requirements)) richText(s, d.requirements);
          if (has(d.notes)) richText(s, d.notes);
        });
      });
    }
    if (has(view.overview)) section(doc, 'Why students choose it', (s) => richText(s, view.overview));
    if (view.process.length) {
      section(doc, 'How to apply', (s) => {
        const ol = el('ol', 'steps');
        view.process.forEach((p) => { const li = el('li'); li.append(el('div', 'step-title', p.title)); if (has(p.detail)) { const d = el('div'); richText(d, p.detail); li.append(d); } ol.append(li); });
        s.append(ol);
      });
    }
    // The interview questions are long: folded, opened when needed.
    if (has(view.interview)) {
      section(doc, 'Interview', (s) => {
        const d = el('details', 'fold');
        d.append(el('summary', '', 'Show the interview preparation'));
        richText(d, view.interview);
        s.append(d);
      });
    }
    if (has(view.location)) section(doc, 'Location', (s) => richText(s, view.location));
    if (has(view.notes)) section(doc, 'Payments and other information', (s) => richText(s, view.notes));
    if (view.updatedAt) doc.append(el('div', 'foot', `Updated ${when(view.updatedAt)}`));

    // A bar to jump between the sections of a long page.
    const heads = [...doc.querySelectorAll('section > h2, section > .dl-head > h2')];
    const view$ = $('view');
    view$.replaceChildren();
    if (heads.length >= 4) {
      const toc = el('nav', 'toc no-print');
      toc.setAttribute('aria-label', 'On this page');
      heads.forEach((h, i) => {
        const sec = h.closest('section');
        sec.id = `sec-${i}`;
        const a = el('a', '', h.textContent.replace(/\s*\(\d+\)$/, ''));
        a.href = `#sec-${i}`;
        a.addEventListener('click', (e) => { e.preventDefault(); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        toc.append(a);
      });
      view$.append(toc);
      // The section being read is lit in the index, so the team always sees where they are on a long page.
      if ('IntersectionObserver' in window) {
        const links = [...toc.querySelectorAll('a')];
        const seen = new Map();
        const io = new IntersectionObserver((entries) => {
          entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
          const first = heads.map((h) => h.closest('section').id).find((id) => seen.get(id));
          if (!first) return;
          links.forEach((a) => { const on = a.getAttribute('href') === '#' + first; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        }, { rootMargin: '-70px 0px -55% 0px' });
        heads.forEach((h) => io.observe(h.closest('section')));
      }
    }
    view$.append(doc);
    document.title = `${view.name} · Universities · ISR`;

    const bar = $('toolbar');
    bar.replaceChildren();
    const copy = el('button', 'btn', 'Copy summary');
    copy.type = 'button';
    copy.addEventListener('click', () => copySummary(view));
    bar.append(copy);
    const print = el('button', 'btn', 'Print or save as PDF');
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    bar.append(print);
  }

  async function start() {
    if (!id) { location.replace('/fact-file' + (BACKUP ? '?backup=' + encodeURIComponent(BACKUP) : '')); return; }
    try {
      const [meRes, uniRes] = await Promise.all([fetch('/api/me', { cache: 'no-store' }), fetch((BACKUP ? '/api/restore/snapshot/' + encodeURIComponent(BACKUP) + '/facts/' : '/api/facts/') + encodeURIComponent(id), { cache: 'no-store' })]);
      if (!uniRes.ok) { say('That university is not in Universities.', true); return; }
      me = await meRes.json();
      uni = await uniRes.json();
      // The Application Team shares a course instead of shortlisting it (fact-finder.js): told before anything is drawn.
      if (window.ShortlistFor && window.ShortlistFor.useMe) window.ShortlistFor.useMe(me);
    } catch (e) {
      say('Could not load this page. Please reload.', true);
      return;
    }
    if (window.Shortlist) await window.Shortlist.ready;
    if (!BACKUP) { try { const r = await fetch('/api/fact-courses?university=' + encodeURIComponent(id), { cache: 'no-store' }); if (r.ok) courseData = await r.json(); } catch (e) { courseData = null; } }
    if (!BACKUP && !student()) { try { const r = await fetch('/api/course-watch?university=' + encodeURIComponent(id), { cache: 'no-store' }); if (r.ok) watch = await r.json(); } catch (e) { /* the page works without it */ } }
    if (!BACKUP && !student()) { try { const r = await fetch('/api/apply-through/find?name=' + encodeURIComponent(uni.name || ''), { cache: 'no-store' }); if (r.ok) applyVia = (await r.json()).entry; } catch (e) { applyVia = null; } }
    if (team() && window.ShortlistFor) { await window.ShortlistFor.ready(); window.ShortlistFor.onChange(render); window.ShortlistFor.tray(); }
    render();
  }
  if (BACKUP) { const back = document.querySelector('a[href="/fact-file"]'); if (back) back.href = '/fact-file?backup=' + encodeURIComponent(BACKUP); }
  start();
})();
