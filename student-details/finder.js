// "Find universities for a student" (the owner, 17 Nov 2026): the study level, GPA or percentage, study gap and English test of a
// student, checked against every university in Universities at once (eligibility.js, /api/eligibility). The answer: Eligible, To
// check (close, or a rule a person decides: a waiver, a gap not stated) and Not eligible, each university with the reasons in plain
// words (what meets the rule, what the student would need), its fee, scholarship and deposit for that level, the open intake with its
// deadline, and its courses of that level (narrowed by a subject). Used on Universities, on the student card (University options,
// filled in from the card, with Add), on Universities for the team (with Shortlist, for the student chosen: fact-finder.js) and on a
// student's own login (with I am interested).
//
//   window.Finder.mount(box, { prefill, onAdd(result, course), addLabel, onSave(values), shortlist })
(function () {
  const { el, h, api, field } = window.Portal;
  const F = window.CardFields;
  const STATUS = { yes: ['Eligible', 'is-yes'], check: ['To check', 'is-check'], no: ['Not eligible', 'is-no'] };

  function mount(box, { prefill = {}, onAdd = null, addLabel = 'Add', onSave = null, title = 'Find universities for a student', intro = '', shortlist = false } = {}) {
    const wrap = el('section', 'p-card fd-card');
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
    levelRow.setAttribute('role', 'radiogroup');
    levelRow.setAttribute('aria-label', 'Level');
    const SHORT = { 'International Year 1': 'Year One', 'Top-up (final year)': 'Top-up', 'Masters by Research or PhD': 'Research or PhD' };
    F.STUDY_LEVELS.forEach((x) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(level.input.value === x), class: level.input.value === x ? 'is-on' : '' }, SHORT[x] || x);
      b.addEventListener('click', () => {
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
    form.append(go);
    const bar = el('div', 'fd-bar');
    if (onSave) bar.append(h('button', { class: 'btn', type: 'button', onclick: async () => { try { await onSave(values()); window.NiecUI.toast('Saved on the student card'); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, 'Save these details on the card'));
    wrap.append(levelRow, form);
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
    async function run() {
      const v = values();
      if (!v.level) { out.replaceChildren(el('p', 'fd-hint', 'Choose a level.')); level.input.focus(); return; }
      go.disabled = true;
      out.classList.add('is-busy');
      try { last = await api('/api/eligibility', v); draw(); } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); }
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
    const imgOf = (src, cls) => { const im = el('img', cls || ''); im.src = src; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; return im; };
    const initials = (name) => (String(name).match(/\b[A-Z]/g) || ['U']).slice(0, 3).join('');
    function card(r) {
      const c = el('article', `fd-uni ${STATUS[r.status][1]}`);
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
      const why = el('ul', 'fd-why');
      r.reasons.forEach((x) => why.append(el('li', x.ok === true ? 'is-ok' : x.ok === false ? 'is-bad' : 'is-ask', x.text)));
      if (r.reasons.length) c.append(why);
      const money = el('div', 'fd-money');
      [['Tuition', r.fee], ['Scholarship', r.scholarship], ['Deposit', r.deposit]].forEach(([k, v]) => { if (v) { const m = el('div'); m.append(el('span', '', k), el('b', '', v.split('\n')[0])); money.append(m); } });
      if (money.children.length) c.append(money);
      if (r.courses.length) {
        // The first seven courses (the ones that match the subject when one is typed) are shown; "See all" opens the university's
        // page with its own search set to the subject (the owner, 21 Nov 2026).
        const box = el('div', 'fd-course-box');
        const head = el('div', 'fd-course-head');
        head.append(el('b', '', values().subject ? `${r.total} matching course${r.total === 1 ? '' : 's'}` : `${r.total} course${r.total === 1 ? '' : 's'}`));
        box.append(head);
        const list = el('ul', 'fd-courses');
        r.courses.slice(0, 7).forEach((co) => {
          const li = el('li');
          const words = el('div', 'fd-course-words');
          // The course's own page on the university's website, when known (course-sitemap.js).
          words.append(co.link ? h('a', { class: 'fd-course', href: co.link, target: '_blank', rel: 'noopener' }, co.name) : el('span', 'fd-course', co.name));
          const chips = el('div', 'fd-chips');
          chips.append(el('span', 'fd-cal', String(co.intakes || co.intake || '').split(/,\s*/).map((x) => x.slice(0, 3)).join(', ') + ' 2027'));
          if (co.campus) chips.append(el('span', 'fd-pin', co.campus));
          if (co.fee) chips.append(el('span', 'fd-fee', co.fee));
          words.append(chips);
          li.append(words);
          if (onAdd) {
            const add = h('button', { class: 'btn btn-sm', type: 'button' }, addLabel);
            add.addEventListener('click', async () => { add.disabled = true; try { await onAdd(r, co); add.textContent = 'Added ✓'; } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); add.disabled = false; } });
            li.append(add);
          } else if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: r.id, name: r.name }, co.full || co.name, co.intake || ''));
          else if (shortlist) li.append(window.ShortlistFor.button({ universityId: r.id, university: r.name, course: co.full || co.name, intake: co.intake || (r.intake && r.intake.name) || '', level: values().level, link: co.link || '', fee: (co.fee || r.fee || '').split('\n')[0], scholarship: (co.scholarship || r.scholarship || '').split('\n')[0], deposit: (r.deposit || '').split('\n')[0] }));
          list.append(li);
        });
        box.append(list);
        if (r.total > 7) {
          const more = h('a', { class: 'fd-see-all', href: `/fact-file?u=${encodeURIComponent(r.id)}${values().subject ? `&q=${encodeURIComponent(values().subject)}` : ''}#courses` }, `See all ${r.total} courses`);
          if (onAdd) { more.target = '_blank'; more.rel = 'noopener'; }
          box.append(more);
        }
        c.append(box);
      }
      return c;
    }
    go.addEventListener('click', run);
    [grade.input, gap.input, score.input, band.input, subject.input].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
    if (shortlist) window.ShortlistFor.onChange(() => { if (last) draw(); });
    if (prefill.level) run();
    return { run, values };
  }

  window.Finder = { mount };
})();
