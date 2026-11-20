// One university's page (the owner, 17 Nov 2026): kept up to date by itself, read by everyone, edited by nobody, except the dates of
// the intakes, which the team may correct. What is shown and in which section is decided in fact-present.js (nothing twice, nothing
// extra); this file draws it:
//
//   the deadlines first, highlighted, each date with the days left (and "Change dates" for the team)
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
    if (team()) {
      const edit = el('button', 'btn btn-sm no-print', 'Change dates');
      edit.type = 'button';
      edit.addEventListener('click', editDeadlines);
      head.append(edit);
    }
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

  // The team corrects the dates: per intake, "Apply by" and the other dates, one per line ("CAS deadline: 27 November 2026").
  function editDeadlines() {
    window.Portal.dialog('Change the dates', (body, close) => {
      body.append(el('p', 'p-muted p-small', 'One date per line, for example "CAS deadline: 27 November 2026". The automatic reading keeps your dates until the university changes its own.'));
      const rows = (uni.intakes || []).map((i) => ({ id: i.id, name: i.name, deadline: i.deadline || '', deadlines: i.deadlines || '' }));
      const forms = [];
      const list = el('div', 'dl-edit');
      const add = (r) => {
        const block = el('fieldset', 'dl-edit-block');
        const name = window.Portal.field('Intake', { value: r.name, max: 120, placeholder: 'e.g. September 2027' });
        name.input.disabled = Boolean(r.id);
        const by = window.Portal.field('Apply by', { value: r.deadline, max: 120, placeholder: 'e.g. 30 June 2027' });
        const dates = window.Portal.field('Other dates', { kind: 'area', value: r.deadlines, max: 4000, placeholder: 'Deposit deadline: 15 July 2027\nCAS deadline: 1 August 2027' });
        dates.input.rows = 4;
        block.append(name.wrap, by.wrap, dates.wrap);
        forms.push({ id: r.id, name, by, dates });
        list.append(block);
      };
      rows.forEach(add);
      const more = el('button', 'btn btn-sm', 'Add an intake');
      more.type = 'button';
      more.addEventListener('click', () => add({ name: '', deadline: '', deadlines: '' }));
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const save = el('button', 'btn btn-primary', 'Save the dates');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const intakes = forms.map((f) => ({ id: f.id, name: f.name.input.value.trim(), deadline: f.by.input.value.trim(), deadlines: f.dates.input.value.trim() })).filter((x) => x.id || x.name);
          const res = await fetch(`/api/facts/${uni.id}/deadlines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intakes }) });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Could not save the dates.');
          uni = json;
          close(true);
          render();
          window.NiecUI.toast('Dates saved. Everyone sees them now.', { type: 'success' });
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; save.disabled = false; }
      });
      const cancel = el('button', 'btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => close());
      foot.append(cancel, save);
      body.append(list, more, msg, foot);
    }, { wide: true });
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


  // ---- the partner's January 2027 page (the owner, 20 Nov 2026) ----
  // A university or international college read from the partner it is applied through: a picture at the top with the logo, the name,
  // where it is and the Apply button (the partner's portal); four facts (location, intake, apply through, next deadline); the video and
  // pictures; about; one wide card per level (entry, English, fee, scholarship, more) in the order foundation, year one, undergraduate,
  // postgraduate, pre-masters, masters by research; every January 2027 course by level, each with Shortlist, with a picture between the
  // levels; the documents needed to apply; the deadlines; and where the details came from.
  const LEVEL_ORDER = ['International Foundation Year', 'International Year One', 'Undergraduate', 'Postgraduate', 'Pre-Masters', 'Masters by Research', 'Other courses'];
  function img(src, cls, alt = '') { const i = el('img', cls); i.src = src; i.alt = alt; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); }); return i; }
  function copyBtn(value, label) {
    const b = el('button', 'up-copy no-print', label || 'Copy');
    b.type = 'button';
    b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); window.NiecUI.toast('Copied', { type: 'success' }); } catch (e) { window.NiecUI.toast('Could not copy.', { type: 'error' }); } });
    return b;
  }
  function applyButton(cls) {
    if (!applyVia) return null;
    if (applyVia.portal) { const a = el('a', `btn btn-primary ${cls || ''}`, `Apply through ${applyVia.direct ? 'the portal' : applyVia.partner}`); a.href = applyVia.portal; a.target = '_blank'; a.rel = 'noopener'; return a; }
    if (applyVia.email) { const a = el('a', `btn btn-primary ${cls || ''}`, `Apply by email to ${applyVia.partner}`); a.href = 'mailto:' + applyVia.email; return a; }
    return null;
  }
  function renderProfile() {
    const P0 = uni.profile;
    const doc = el('article', 'doc up-doc');
    const startMonth = (() => { const c = {}; P0.courses.forEach((x) => { if (x.start) c[x.start] = (c[x.start] || 0) + 1; }); return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [''])[0]; })();
    const city = P0.city || uni.city;

    // the top: picture, logo, name, place, Apply
    const hero = el('header', 'up-hero');
    const pic = P0.banner || P0.photos[0];
    if (pic) hero.append(img(pic, 'up-hero-img'));
    const inner = el('div', 'up-hero-inner');
    const id = el('div', 'up-id');
    const logo = el('div', 'up-logo');
    const initials = () => el('span', '', (uni.name.match(/\b[A-Z]/g) || ['U']).slice(0, 3).join(''));
    if (P0.logo) { const l = img(P0.logo, '', `${uni.name} logo`); l.addEventListener('error', () => logo.append(initials())); logo.append(l); } else logo.append(initials());
    const words = el('div', 'up-titles');
    words.append(el('h1', '', uni.name));
    const sub = el('div', 'up-sub');
    if (has(city)) sub.append(el('span', '', city));
    sub.append(el('span', 'up-chip', P0.type === 'college' ? 'International college' : 'University'), el('span', 'up-chip', `${P0.intake} intake`));
    words.append(sub);
    id.append(logo, words);
    inner.append(id);
    const go = applyButton('up-apply');
    if (go) inner.append(go);
    hero.append(inner);
    doc.append(hero);

    // four facts
    const facts = el('section', 'up-facts');
    const fact = (label, value, extra) => { const f = el('div', 'up-fact'); f.append(el('span', 'up-fact-label', label), el('b', '', value || 'Not given')); if (extra) f.append(extra); facts.append(f); return f; };
    fact('Location', city);
    fact('Current intake', P0.intake, startMonth ? el('small', '', `Most courses start ${startMonth}`) : null);
    if (applyVia) {
      const more = el('div', 'up-fact-more');
      if (applyVia.portal) { const a = el('a', '', 'Open the portal'); a.href = applyVia.portal; a.target = '_blank'; a.rel = 'noopener'; more.append(a); }
      if (applyVia.email) { more.append(el('span', '', applyVia.email), copyBtn(applyVia.email)); }
      if (applyVia.login) {
        if (applyVia.login.user) { const r = el('div', 'up-login'); r.append(el('span', '', `User: ${applyVia.login.user}`), copyBtn(applyVia.login.user)); more.append(r); }
        if (applyVia.login.password) { const r = el('div', 'up-login'); r.append(el('span', '', 'Password: ••••••••'), copyBtn(applyVia.login.password, 'Copy password')); more.append(r); }
      }
      fact('Apply through', applyVia.direct ? `${applyVia.partner} (direct)` : applyVia.partner, more);
    }
    fact('Next deadline', P0.deadlines[0] ? P0.deadlines[0].replace(/^application deadline\s*[-:]\s*/i, '') : '', P0.deadlines.length > 1 ? el('small', '', 'Every date is below') : null);
    doc.append(facts);

    if (applyVia && applyVia.contacts && applyVia.contacts.length) {
      const c = el('section', 'up-section up-contacts');
      c.append(el('h2', '', `Contact at ${applyVia.partner}`));
      const list = el('div', 'up-contact-list');
      applyVia.contacts.forEach((p) => { const d = el('div', 'up-contact'); d.append(el('b', '', p.name || 'Contact')); if (p.email) { const a = el('a', '', p.email); a.href = 'mailto:' + p.email; d.append(a); } if (p.phone) d.append(el('span', '', p.phone)); list.append(d); });
      c.append(list);
      doc.append(c);
    }

    // video and pictures
    const pics = P0.photos.filter((x) => x !== pic);
    if (P0.video || pics.length) {
      const m = el('section', 'up-media no-print');
      if (P0.video) {
        const f = el('iframe', 'up-video');
        f.src = P0.video.replace('www.youtube.com', 'www.youtube-nocookie.com');
        f.title = `${uni.name} video`; f.loading = 'lazy'; f.allow = 'accelerometer; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
        m.append(f);
      }
      if (pics.length) { const g = el('div', 'up-photos'); pics.slice(0, P0.video ? 4 : 6).forEach((x) => g.append(img(x, '', `${uni.name}`))); m.append(g); }
      doc.append(m);
    }
    if (has(P0.about)) {
      const a = el('section', 'up-section up-about');
      a.append(el('h2', '', `About ${uni.name}`));
      const t = el('div', 'up-about-text');
      P0.about.split('\n').filter(Boolean).forEach((l) => t.append(el('p', '', l)));
      a.append(t);
      const meta = [P0.founded && `Founded ${P0.founded}`, P0.students && `${Number(P0.students).toLocaleString('en-GB')} students`, P0.international && `${Number(P0.international).toLocaleString('en-GB')} international students`].filter(Boolean);
      if (meta.length) a.append(el('p', 'up-about-meta', meta.join(' · ')));
      if (has(P0.website)) { const w = el('a', 'up-web', String(P0.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); w.href = /^https?:/.test(P0.website) ? P0.website : 'https://' + P0.website; w.target = '_blank'; w.rel = 'noopener'; a.append(w); }
      doc.append(a);
    }

    // entry requirements: one wide card per level, in the owner's order
    const levels = [...P0.levels].sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level));
    if (levels.length) {
      const sec = el('section', 'up-section');
      sec.append(el('h2', '', 'Entry requirements'));
      levels.forEach((L) => {
        const card = el('div', 'up-level');
        const head = el('div', 'up-level-head');
        const n = P0.courses.filter((c) => c.level === L.level).length;
        head.append(el('h3', '', L.level), el('span', 'up-count', n ? `${n} course${n === 1 ? '' : 's'} in ${P0.intake}` : 'No course listed for this intake'));
        card.append(head);
        const grid = el('dl', 'up-level-grid');
        [['Entry requirement', L.academic], ['English', L.english], ['Tuition fee', L.tuition], ['Scholarship', L.scholarship], ['Additional details', L.extra]].forEach(([k, v]) => {
          const d = el('div');
          d.append(el('dt', '', k));
          const dd = el('dd');
          if (has(v)) v.split('\n').filter(Boolean).forEach((line) => dd.append(el('p', '', line))); else dd.append(el('span', 'dim', 'Not given'));
          d.append(dd);
          grid.append(d);
        });
        card.append(grid);
        sec.append(card);
      });
      doc.append(sec);
    }

    // the January 2027 courses, every one, by level, a picture between the levels
    if (P0.courses.length) {
      const sec = el('section', 'up-section up-courses');
      const top = el('div', 'up-courses-head');
      top.append(el('h2', '', `Courses for ${P0.intake} (${P0.courses.length})`));
      const box = el('input', 'search no-print');
      box.type = 'search'; box.placeholder = 'Find a course, e.g. nursing'; box.setAttribute('aria-label', 'Find a course');
      top.append(box);
      sec.append(top);
      const groups = LEVEL_ORDER.filter((g) => P0.courses.some((c) => c.level === g));
      const between = [...pics];
      groups.forEach((g, gi) => {
        const items = P0.courses.filter((c) => c.level === g);
        const block = el('div', 'up-group');
        block.append(el('h3', 'up-group-head', `${g} (${items.length})`));
        const grid = el('div', 'up-course-grid');
        items.forEach((c) => {
          const card = el('div', 'up-course');
          card.dataset.name = c.name.toLowerCase();
          card.append(el('b', 'up-course-name', c.name));
          const meta = [c.start && `Starts ${c.start}`, c.duration, c.fee, c.campus].filter(Boolean);
          if (meta.length) card.append(el('span', 'up-course-meta', meta.join(' · ')));
          if (c.deadline) card.append(el('span', 'up-course-deadline', `Apply by ${c.deadline}`));
          if (team() && window.ShortlistFor) card.append(window.ShortlistFor.button({ universityId: uni.id, university: uni.name, course: c.name, intake: P0.intake, level: g }));
          else if (student() && window.Shortlist && window.Shortlist.isLinked()) card.append(window.Shortlist.button(uni, c.name, P0.intake));
          grid.append(card);
        });
        block.append(grid);
        sec.append(block);
        if (gi < groups.length - 1 && between.length) sec.append(img(between.shift(), 'up-band no-print', ''));
      });
      const none = el('p', 'up-none', 'No course matches.');
      none.hidden = true;
      sec.append(none);
      box.addEventListener('input', () => {
        const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        sec.querySelectorAll('.up-group').forEach((b) => { let n = 0; b.querySelectorAll('.up-course').forEach((c) => { const hit = words.every((w) => c.dataset.name.includes(w)); c.hidden = !hit; if (hit) n += 1; }); b.hidden = n === 0; shown += n; });
        sec.querySelectorAll('.up-band').forEach((x) => { x.hidden = words.length > 0; });
        none.hidden = shown > 0;
      });
      doc.append(sec);
    }

    // the documents needed to apply
    if (P0.documents.length) {
      const sec = el('section', 'up-section');
      sec.append(el('h2', '', 'Documents needed for the application'));
      if (P0.documentsUsual) sec.append(el('p', 'up-note', `The usual documents for a UK application. Check ${applyVia ? applyVia.partner : 'the partner'}'s portal for anything extra.`));
      const ul = el('ul', 'up-docs');
      P0.documents.forEach((d) => ul.append(el('li', '', d)));
      sec.append(ul);
      doc.append(sec);
    }
    // the deadlines: the partner's, or the dates the team changed (Change dates, the only thing the team edits on a page)
    const teamDates = (uni.intakes || []).some((i) => i.editedAt && (i.deadline || i.deadlines));
    if (P0.deadlines.length && !teamDates) {
      const sec = el('section', 'up-section');
      const head = el('div', 'up-courses-head');
      head.append(el('h2', '', `Deadlines for ${P0.intake}`));
      if (team()) { const edit = el('button', 'btn btn-sm no-print', 'Change dates'); edit.type = 'button'; edit.addEventListener('click', editDeadlines); head.append(edit); }
      sec.append(head);
      const ul = el('ul', 'up-deadlines');
      P0.deadlines.forEach((d) => ul.append(el('li', '', d)));
      sec.append(ul);
      doc.append(sec);
    } else {
      const wrap = el('div', 'up-section');
      renderDeadlines(wrap, P.present(uni));
      doc.append(wrap);
    }
    if (go) { const end = el('div', 'up-end no-print'); end.append(applyButton('')); doc.append(end); }
    doc.append(el('p', 'up-source', `Details from ${P0.from || 'the partner'}${P0.at ? `, read on ${when(P0.at)}` : ''}. Applied through ${applyVia ? applyVia.partner : 'the chosen partner'}.`));
    $('view').replaceChildren(doc);
    document.title = `${uni.name} · Fact File · ISR`;
    const bar = $('toolbar');
    const copy = el('button', 'btn', 'Copy summary');
    copy.type = 'button';
    copy.addEventListener('click', () => copyProfileSummary());
    const print = el('button', 'btn', 'Print or save as PDF');
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    bar.replaceChildren(copy, print);
  }
  // The same short summary to paste into WhatsApp or an email as on the other pages, from the partner's details.
  async function copyProfileSummary() {
    const P0 = uni.profile;
    const out = [`*${uni.name}*${has(P0.city) ? ` (${P0.city})` : ''}`];
    if (has(P0.website)) out.push(String(P0.website));
    out.push(`${P0.intake} intake`);
    P0.deadlines.slice(0, 3).forEach((d) => out.push(d));
    [...P0.levels].sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level)).forEach((L) => {
      out.push('', `*${L.level}*`);
      [['Tuition fee', L.tuition], ['Scholarship', L.scholarship], ['Entry', L.academic], ['English', L.english]].forEach(([k, v]) => { if (has(v)) out.push(`${k}: ${flat(v)}`); });
    });
    try { await navigator.clipboard.writeText(out.join('\n')); window.NiecUI.toast('Summary copied. Paste it into WhatsApp or an email.', { type: 'success' }); } catch (e) { window.NiecUI.toast('Could not copy.', { type: 'error' }); }
  }

  // ---- the page ----
  function render() {
    if (uni.profile && !BACKUP) { renderProfile(); return; }
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
    document.title = `${view.name} · Fact File · ISR`;

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
      if (!uniRes.ok) { say('That university is not in the Fact File.', true); return; }
      me = await meRes.json();
      uni = await uniRes.json();
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
