// "Find universities for a student" (the owner, 17 Nov 2026): the study level, GPA or percentage, study gap and English test of a
// student, checked against every university in Universities at once (eligibility.js, /api/eligibility). The answer: Eligible, To
// check (close, or a rule a person decides: a waiver, a gap not stated) and Not eligible, each university with the reasons in plain
// words (what meets the rule, what the student would need), its fee, scholarship and deposit for that level, the open intake with its
// deadline, and its courses of that level (narrowed by a subject). Used on Universities, on the student card (University options,
// filled in from the card, with Add), on Universities for the team (with Shortlist, for the student chosen: fact-finder.js) and on a
// student's own login (with I am interested).
//
//   window.Finder.mount(box, { prefill, onAdd(result, course), addLabel, onSave(values), shortlist, multi })
//
// `multi` (a branch's Universities, the owner, 27 Nov 2026): several levels at once (Foundation and Year One together), every filter
// in use as a chip under the form, removed one by one or all with "Clear all filters". A University that answers for more than one
// level has a switch on its card, one button for each level with that level's answer.
(function () {
  const { el, h, api, field } = window.Portal;
  const F = window.CardFields;
  const STATUS = { yes: ['Eligible', 'is-yes'], check: ['To check', 'is-check'], no: ['Not eligible', 'is-no'] };

  const RANK = { yes: 0, check: 1, no: 2 };
  // The answers of several levels as one list: each University once, shown with its best answer, the others behind the switch on its card.
  function merge(answers) {
    const by = new Map();
    answers.forEach(({ level, d }) => d.results.forEach((r) => { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push({ ...r, level }); }));
    const days = (r) => (r.intake && typeof r.intake.days === 'number' ? r.intake.days : 1e6);
    const results = [...by.values()].map((list) => ({ ...list.slice().sort((a, b) => RANK[a.status] - RANK[b.status])[0], levels: list }));
    results.sort((a, b) => RANK[a.status] - RANK[b.status] || days(a) - days(b) || a.name.localeCompare(b.name));
    const counts = { yes: 0, check: 0, no: 0 };
    results.forEach((r) => { counts[r.status] += 1; });
    return { results, counts };
  }

  function mount(box, { prefill = {}, onAdd = null, addLabel = 'Add', onSave = null, title = 'Find universities for a student', intro = '', shortlist = false, multi = false } = {}) {
    const wrap = el('section', `p-card fd-card${multi ? ' fd-multi' : ''}`);
    const head = el('div', 'fd-head');
    const words = el('div');
    // One title and no explanation (the owner, 20 Nov 2026: short, one-word labels).
    words.append(el('h2', '', title));
    if (intro) words.append(el('p', 'p-muted p-small', intro));
    head.append(words);
    wrap.append(head);
    const form = el('div', 'fd-form');
    // The level as one row of pills to tap (the owner, 20 Nov 2026: a finder that is quick and clear), the rest in one row under it.
    const level = { input: { value: F.STUDY_LEVELS.includes(prefill.level) ? prefill.level : '', focus: () => levelRow.querySelector('button').focus() } };
    const levelRow = el('div', 'fd-levels');
    levelRow.setAttribute('role', multi ? 'group' : 'radiogroup');
    levelRow.setAttribute('aria-label', multi ? 'Levels (choose one or more)' : 'Level');
    const SHORT = { 'International Year 1': 'Year One', 'Top-up (final year)': 'Top-up', 'Masters by Research or PhD': 'Research or PhD' };
    // The levels chosen in `multi`, always in the order of the pills.
    const chosen = new Set(level.input.value ? [level.input.value] : []);
    const picked = () => F.STUDY_LEVELS.filter((x) => chosen.has(x));
    const paintLevels = () => {
      level.input.value = picked()[0] || '';
      levelRow.querySelectorAll('button').forEach((y) => { const on = chosen.has(y.dataset.level); y.classList.toggle('is-on', on); y.setAttribute('aria-pressed', String(on)); });
    };
    F.STUDY_LEVELS.forEach((x) => {
      const on = level.input.value === x;
      const b = h('button', multi ? { type: 'button', 'aria-pressed': String(on), 'data-level': x, class: on ? 'is-on' : '' } : { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'is-on' : '' }, SHORT[x] || x);
      b.addEventListener('click', () => {
        if (multi) { if (chosen.has(x)) chosen.delete(x); else chosen.add(x); paintLevels(); afterChange(); return; }
        // Pressing the chosen level again lets go of it and clears the results (the owner, 25 Nov 2026: the filter could not be cleared without reloading the page).
        if (level.input.value === x) { clearAll({ keepFields: true }); return; }
        level.input.value = x;
        levelRow.querySelectorAll('button').forEach((y) => { const on = y === b; y.classList.toggle('is-on', on); y.setAttribute('aria-checked', String(on)); });
        run();
      });
      levelRow.append(b);
    });
    const grade = field('Grade', { value: prefill.grade || '', placeholder: '3.1 or 68%', max: 20 });
    const gap = field('Gap (years)', { value: prefill.gap || '', placeholder: '2', max: 3 });
    gap.input.inputMode = 'numeric';
    const test = field('English', { kind: 'select', choices: [['', 'Any'], ...F.ENGLISH_TESTS.map((x) => [x, x])], value: F.ENGLISH_TESTS.find((x) => x.toLowerCase() === String(prefill.test || '').toLowerCase()) || prefill.test || '' });
    const score = field('Score', { value: prefill.score || '', placeholder: '6.5', max: 10 });
    // The lowest band of the four parts (the owner, 17 Nov 2026): a university asking 59 in each part refuses a 57 in one.
    const band = field('Lowest band', { value: prefill.band || '', placeholder: '6.0', max: 10 });
    const subject = field('Subject', { value: prefill.subject || '', placeholder: 'Nursing, business', max: 80 });
    form.append(grade.wrap, gap.wrap, test.wrap, score.wrap, band.wrap, subject.wrap);
    const go = h('button', { class: 'btn btn-primary fd-go', type: 'button' }, 'Find');
    const clear = h('button', { class: 'btn fd-clear', type: 'button', title: 'Clear the level, the boxes and the results' }, 'Clear');
    form.append(go, clear);
    const bar = el('div', 'fd-bar');
    if (onSave) bar.append(h('button', { class: 'btn', type: 'button', onclick: async () => { try { await onSave(values()); window.NiecUI.toast('Saved on the student card'); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, 'Save these details on the card'));
    wrap.append(levelRow, form);
    // The filters in use, each one removable, and all of them at once.
    const active = el('div', 'fd-active');
    active.hidden = true;
    active.setAttribute('role', 'group');
    active.setAttribute('aria-label', 'Filters in use');
    if (multi) { clear.hidden = true; wrap.append(active); }
    if (bar.children.length) wrap.append(bar);
    const out = el('div', 'fd-out');
    wrap.append(out);
    box.replaceChildren(wrap);
    const values = () => ({ level: level.input.value, grade: grade.input.value.trim(), gap: gap.input.value.trim(), test: test.input.value, score: score.input.value.trim(), band: band.input.value.trim(), subject: subject.input.value.trim() });
    const showScore = () => { score.wrap.hidden = band.wrap.hidden = !test.input.value || /moi|waiver|not taken/i.test(test.input.value); };
    test.input.addEventListener('change', showScore);
    showScore();

    let filter = 'all';
    let last = null;
    let asking = 0; // answers arriving out of order: only the latest filters are shown
    function drawActive() {
      if (!multi) return;
      const v = values();
      const items = picked().map((x) => [SHORT[x] || x, () => { chosen.delete(x); paintLevels(); }]);
      if (v.grade) items.push([`Grade ${v.grade}`, () => { grade.input.value = ''; }]);
      if (v.gap) items.push([`Gap ${v.gap} ${v.gap === '1' ? 'year' : 'years'}`, () => { gap.input.value = ''; }]);
      if (v.test) items.push([[v.test, score.wrap.hidden ? '' : v.score, !band.wrap.hidden && v.band ? `lowest band ${v.band}` : ''].filter(Boolean).join(' '), () => { test.input.value = ''; score.input.value = ''; band.input.value = ''; showScore(); }]);
      if (v.subject) items.push([`Subject: ${v.subject}`, () => { subject.input.value = ''; }]);
      active.hidden = !items.length;
      const chips = items.map(([label, drop], i) => {
        const b = h('button', { type: 'button', class: 'fd-chip', 'aria-label': `Remove the filter ${label}`, title: 'Remove this filter' }, el('span', '', label), el('i', '', '\u00d7'));
        b.addEventListener('click', () => {
          drop();
          afterChange();
          const next = active.querySelectorAll('.fd-chip')[i] || active.querySelector('.fd-chip') || levelRow.querySelector('button');
          next.focus();
        });
        return b;
      });
      const all = h('button', { type: 'button', class: 'fd-clear-all' }, 'Clear all filters');
      all.addEventListener('click', () => { clearAll(); levelRow.querySelector('button').focus(); });
      active.replaceChildren(el('span', 'fd-active-k', 'Filters'), ...chips, all);
    }
    // A filter was added or taken away: the results follow at once.
    function afterChange() {
      drawActive();
      if (picked().length) { run(); return; }
      asking += 1; last = null; filter = 'all'; out.classList.remove('is-busy'); go.disabled = false; out.replaceChildren();
    }
    async function run() {
      const v = values();
      drawActive();
      if (!v.level) { out.replaceChildren(el('p', 'fd-hint', multi ? 'Choose one level or more.' : 'Choose a level.')); level.input.focus(); return; }
      asking += 1;
      const mine = asking;
      go.disabled = true;
      out.classList.add('is-busy');
      try {
        const answer = multi ? merge(await Promise.all(picked().map(async (x) => ({ level: x, d: await api('/api/eligibility', { ...v, level: x }) })))) : await api('/api/eligibility', v);
        if (mine !== asking) return;
        last = answer;
        if (filter !== 'all' && !last.counts[filter]) filter = 'all';
        draw();
      } catch (e) { if (mine !== asking) return; out.replaceChildren(el('div', 'p-notice bad', e.message)); }
      out.classList.remove('is-busy');
      go.disabled = false;
    }
    function draw() {
      const d = last;
      out.replaceChildren();
      if (!d.results.length) { out.append(el('p', 'fd-hint', 'No university matches.')); return; }
      // The three answers as large tiles that also filter (one tile again shows all).
      const tiles = el('div', 'fd-tiles');
      tiles.setAttribute('role', 'tablist');
      [['yes', 'Eligible'], ['check', 'To check'], ['no', 'Not eligible']].forEach(([k, label]) => {
        const b = h('button', { class: `fd-tile ${STATUS[k][1]}${filter === k ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filter === k) });
        b.append(el('b', '', String(d.counts[k])), el('span', '', label));
        b.disabled = !d.counts[k];
        b.addEventListener('click', () => { filter = filter === k ? 'all' : k; draw(); });
        tiles.append(b);
      });
      out.append(tiles);
      const grid = el('div', 'fd-grid');
      d.results.filter((r) => filter === 'all' || r.status === filter).forEach((r, i) => { const c = card(r); c.style.setProperty('--i', String(Math.min(i, 12))); grid.append(c); });
      out.append(grid);
    }
    const media = (u) => (/^https:\/\//.test(String(u || '')) ? `/api/media?u=${encodeURIComponent(u)}` : u); // the server's kept copy (media-cache.js)
    const imgOf = (src, cls) => { const im = el('img', cls || ''); im.src = media(src); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; return im; };
    const initials = (name) => (String(name).match(/\b[A-Z]/g) || ['U']).slice(0, 3).join('');
    function card(r) {
      const c = el('article', `fd-uni ${STATUS[r.status][1]}`);
      const atLevel = r.level || values().level; // the level this card answers for
      // The picture with the logo and the answer on it, then the name, the place and the deadline.
      const cv = el('div', 'fd-cover' + (r.cover ? '' : ' is-blank'));
      if (r.cover) { const im = imgOf(r.cover); im.addEventListener('error', () => { im.remove(); cv.classList.add('is-blank'); }); cv.append(im); }
      cv.append(el('span', `fd-status ${STATUS[r.status][1]}`, STATUS[r.status][0]));
      const lg = el('span', 'fd-logo');
      if (r.logo) { const im = imgOf(r.logo); im.addEventListener('error', () => { im.remove(); lg.append(el('i', '', initials(r.name))); }); lg.append(im); } else lg.append(el('i', '', initials(r.name)));
      cv.append(lg);
      c.append(cv);
      const top = el('div', 'fd-uni-top');
      const name = el('a', 'fd-uni-name', r.name);
      name.href = '/fact-file?u=' + encodeURIComponent(r.id);
      if (onAdd) { name.target = '_blank'; name.rel = 'noopener'; }
      const place = el('div', 'fd-place');
      place.append(el('span', 'fd-pin', (r.campuses && r.campuses.length ? r.campuses : [r.city]).filter(Boolean).slice(0, 3).join(', ') || 'UK'));
      if (r.intake && r.intake.name) place.append(el('span', 'fd-cal', r.intake.name));
      top.append(name, place);
      if (r.intake && r.intake.deadline) {
        const dl = el('div', 'fd-deadline');
        const days = r.intake.days;
        dl.append(el('span', '', 'Apply by'), el('b', '', r.intake.deadline));
        if (typeof days === 'number') dl.append(el('em', days <= 7 ? 'is-urgent' : days <= 30 ? 'is-soon' : '', days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`));
        top.append(dl);
      }
      c.append(top);
      if (multi && r.levels) {
        const tabs = el('div', 'fd-card-levels');
        tabs.setAttribute('role', 'group');
        tabs.setAttribute('aria-label', `${r.name}: the answer for each level`);
        r.levels.forEach((x) => {
          const b = h('button', { type: 'button', class: `${STATUS[x.status][1]}${x.level === atLevel ? ' is-on' : ''}`, 'aria-pressed': String(x.level === atLevel) }, el('b', '', SHORT[x.level] || x.level), el('span', '', STATUS[x.status][0]));
          b.addEventListener('click', () => {
            if (x.level === atLevel) return;
            const next = card({ ...x, levels: r.levels });
            next.style.cssText = c.style.cssText;
            next.classList.add('is-swapped');
            c.replaceWith(next);
            const on = next.querySelector('.fd-card-levels button[aria-pressed="true"]');
            if (on) on.focus({ preventScroll: true });
          });
          tabs.append(b);
        });
        c.append(tabs);
      }
      const why = el('ul', 'fd-why');
      r.reasons.forEach((x) => why.append(el('li', x.ok === true ? 'is-ok' : x.ok === false ? 'is-bad' : 'is-ask', x.text)));
      if (r.reasons.length) c.append(why);
      const money = el('div', 'fd-money');
      // Written plainly: "Gross Fee £16,020" is £16,020, "£2,000/- per year" is £2,000 per year, "upto" is "Up to".
      const tidyMoney = (v) => String(v || '').split('\n')[0].replace(/\/-/g, '').replace(/\bupto\b/gi, 'Up to').replace(/^gross fee:?\s*/i, '').replace(/^scholarships?\s*(of|:|-)?\s*/i, '').replace(/\s{2,}/g, ' ').trim();
      [['Tuition', r.fee], ['Scholarship', r.scholarship], ['Deposit', r.deposit]].forEach(([k, v]) => { if (v) { const m = el('div'); const t = tidyMoney(v); m.append(el('span', '', k), el('b', '', t.length > 70 ? `${t.slice(0, 68)}...` : t)); if (t.length > 70) m.title = t; money.append(m); } });
      if (money.children.length) c.append(money);
      if (r.courses.length) {
        // The three most relevant courses (those matching the subject when one is typed) are shown; "See all" opens the university's
        // page with its own search set to the subject (the owner, 20 Nov 2026: three, not seven, the best matches first).
        const box = el('div', 'fd-course-box');
        const head = el('div', 'fd-course-head');
        head.append(el('b', '', values().subject ? `${r.total} matching course${r.total === 1 ? '' : 's'}` : `${r.total} course${r.total === 1 ? '' : 's'}`));
        box.append(head);
        const list = el('ul', 'fd-courses');
        r.courses.slice(0, 3).forEach((co) => {
          const li = el('li');
          const words = el('div', 'fd-course-words');
          // The course's own page on the university's website, when known (course-sitemap.js).
          // Shown without the partner's code at the end ("(NN41)", "(CID921)"); the shortlist keeps the full name.
          const shown = String(co.name).replace(/\s*\((?:CID)?[A-Z]{1,4}\d{1,4}[A-Z]{0,2}\)/g, '').replace(/\s{2,}/g, ' ').trim();
          words.append(co.link ? h('a', { class: 'fd-course', href: co.link, target: '_blank', rel: 'noopener' }, shown) : el('span', 'fd-course', shown));
          const chips = el('div', 'fd-chips');
          chips.append(el('span', 'fd-cal', String(co.intakes || co.intake || '').split(/,\s*/).map((x) => x.slice(0, 3)).join(', ') + ' 2027'));
          if (co.campus) chips.append(el('span', 'fd-pin', co.campus));
          if (co.fee) chips.append(el('span', 'fd-fee', String(co.fee).replace(/^gross fee:?\s*/i, '').replace(/\/-/g, '')));
          words.append(chips);
          li.append(words);
          if (onAdd) {
            const add = h('button', { class: 'btn btn-sm', type: 'button' }, addLabel);
            add.addEventListener('click', async () => { add.disabled = true; try { await onAdd(r, co); add.textContent = 'Added ✓'; } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); add.disabled = false; } });
            li.append(add);
          } else if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: r.id, name: r.name }, co.full || co.name, co.intake || ''));
          else if (shortlist) li.append(window.ShortlistFor.button({ universityId: r.id, university: r.name, course: co.full || co.name, intake: co.intake || (r.intake && r.intake.name) || '', level: atLevel, link: co.link || '', fee: (co.fee || r.fee || '').split('\n')[0], scholarship: (co.scholarship || r.scholarship || '').split('\n')[0], deposit: (r.deposit || '').split('\n')[0] }));
          list.append(li);
        });
        box.append(list);
        if (r.total > 3) {
          const more = h('a', { class: 'fd-see-all', href: `/fact-file?u=${encodeURIComponent(r.id)}&level=${encodeURIComponent(atLevel)}${values().subject ? `&q=${encodeURIComponent(values().subject)}` : ''}#courses` }, `See all ${r.total} courses`);
          if (onAdd) { more.target = '_blank'; more.rel = 'noopener'; }
          box.append(more);
        }
        c.append(box);
      }
      return c;
    }
    // Clear: the level, every box and the results go, so the page is as it was when it opened.
    function clearAll({ keepFields = false } = {}) {
      chosen.clear();
      level.input.value = '';
      levelRow.querySelectorAll('button').forEach((y) => { y.classList.remove('is-on'); y.setAttribute(multi ? 'aria-pressed' : 'aria-checked', 'false'); });
      if (!keepFields) { grade.input.value = ''; gap.input.value = ''; test.input.value = ''; score.input.value = ''; band.input.value = ''; subject.input.value = ''; showScore(); }
      asking += 1; filter = 'all'; last = null;
      out.classList.remove('is-busy'); go.disabled = false;
      out.replaceChildren();
      drawActive();
    }
    if (multi) [grade.input, gap.input, test.input, score.input, band.input, subject.input].forEach((x) => x.addEventListener('change', drawActive));
    clear.addEventListener('click', () => clearAll());
    go.addEventListener('click', run);
    [grade.input, gap.input, score.input, band.input, subject.input].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
    if (shortlist) window.ShortlistFor.onChange(() => { if (last) draw(); });
    if (prefill.level) run();
    return { run, values };
  }

  window.Finder = { mount };
})();
