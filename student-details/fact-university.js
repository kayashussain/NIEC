// One university's page (the owner, 17 Nov 2026): kept up to date by itself, read by everyone, edited by nobody, except the dates of
// the intakes, which the team may correct. What is shown and in which section is decided in fact-present.js (nothing twice, nothing
// extra); this file draws it:
//
//   the deadlines first, highlighted, each date with the days left (and "Change dates" for the team)
//   one table: entry requirements, English, tuition fee, scholarship, deposit, one row per level
//   the courses, grouped by level, each with Shortlist (for the student chosen at the top; the shortlist waits in the tray at the
//   bottom, see fact-finder.js) and an amber warning when the automatic
//   check found no page for it on the university's website
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

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const has = (s) => String(s || '').trim() !== '';
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const student = () => Boolean(window.Shortlist && window.Shortlist.isStudent());
  const team = () => !student() && !BACKUP && me.role && !(window.Teams && window.Teams.isReadOnly(me));
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

  // ---- the table ----
  function renderTable(doc, view) {
    if (!view.programs.length) return;
    section(doc, 'Entry requirements and fees', (s) => {
      const wrap = el('div', 'table-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Entry requirements and fees');
      const table = el('table', 'programs');
      const headRow = el('tr');
      headRow.append(el('th', '', 'Level'));
      view.columns.forEach(([, label]) => headRow.append(el('th', '', label)));
      const thead = el('thead');
      thead.append(headRow);
      const tbody = el('tbody');
      // A value the same for every level (the English rules of a pathway college) is written once, across the rows.
      const same = Object.fromEntries(view.columns.map(([key]) => [key, view.programs.length > 1 && view.programs.every((p) => p[key] === view.programs[0][key])]));
      view.programs.forEach((p, row) => {
        const tr = el('tr');
        const th = el('th', 'lvl');
        th.scope = 'row';
        th.append(el('b', '', p.name));
        if (has(p.duration)) th.append(el('span', 'lvl-dur', p.duration));
        tr.append(th);
        view.columns.forEach(([key, label]) => {
          if (same[key] && row > 0) return;
          const td = el('td');
          td.dataset.label = label;
          if (same[key]) { td.rowSpan = view.programs.length; td.className = 'all-levels'; }
          if (has(p[key])) richText(td, p[key]);
          else td.append(el('span', 'dim', '-'));
          tr.append(td);
        });
        tbody.append(tr);
      });
      table.append(thead, tbody);
      wrap.append(table);
      s.append(wrap);
      // What the table does not say, under it: a small titled block each ("Entry requirements", "English").
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
      if (team() && window.ShortlistFor) s.append(window.ShortlistFor.bar());
      view.groups.forEach((g) => {
        const items = view.courses.filter((c) => c.group === g);
        if (view.groups.length > 1 || g !== 'Courses') s.append(el('h3', 'course-group', `${g} (${items.length})`));
        const ul = el('ul', 'course-list');
        const LONG = 12;
        items.forEach((c, n) => {
          const li = el('li');
          if (n >= LONG) li.hidden = true;
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
              ok.addEventListener('click', async () => { await fetch('/api/course-watch/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: w.key }) }); watch.warnings = watch.warnings.filter((x) => x !== w); render(); });
              li.append(ok);
            }
          }
          const intake = c.intakes[0] || (view.intakeNames.length === 1 ? view.intakeNames[0] : '');
          if (student() && window.Shortlist.isLinked()) li.append(window.Shortlist.button(uni, c.full || c.course, intake));
          else if (team() && window.ShortlistFor) li.append(window.ShortlistFor.button({ universityId: uni.id, university: uni.name, course: c.full || c.course, intake, level: g }));
          ul.append(li);
        });
        s.append(ul);
        if (items.length > LONG) {
          const more = el('button', 'p-link no-print course-more', `Show all ${items.length} courses`);
          more.type = 'button';
          more.addEventListener('click', () => { ul.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); more.remove(); });
          s.append(more);
        }
      });
    });
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

  // ---- the page ----
  function render() {
    const view = P.present(uni);
    const doc = el('article', 'doc');
    const top = el('header', 'doc-head');
    const titles = el('div');
    titles.append(el('h1', '', view.name));
    const sub = el('div', 'doc-sub');
    if (has(view.city)) sub.append(el('span', '', view.city));
    if (has(view.website)) { const a = el('a', '', view.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); a.href = view.website; a.target = '_blank'; a.rel = 'noopener'; sub.append(a); }
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
    if (team() && window.ShortlistFor) { await window.ShortlistFor.ready(); window.ShortlistFor.onChange(render); window.ShortlistFor.tray(); }
    render();
  }
  if (BACKUP) { const back = document.querySelector('a[href="/fact-file"]'); if (back) back.href = '/fact-file?backup=' + encodeURIComponent(BACKUP); }
  start();
})();
