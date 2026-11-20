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
    const level = field('Level', { kind: 'select', choices: [['', 'Choose...'], ...F.STUDY_LEVELS.map((x) => [x, x])], value: prefill.level || '' });
    const grade = field('Grade', { value: prefill.grade || '', placeholder: '3.1 or 68%', max: 20 });
    const gap = field('Gap (years)', { value: prefill.gap || '', placeholder: '2', max: 3 });
    gap.input.inputMode = 'numeric';
    const test = field('English', { kind: 'select', choices: [['', 'Any'], ...F.ENGLISH_TESTS.map((x) => [x, x])], value: F.ENGLISH_TESTS.find((x) => x.toLowerCase() === String(prefill.test || '').toLowerCase()) || prefill.test || '' });
    const score = field('Score', { value: prefill.score || '', placeholder: '6.5', max: 10 });
    // The lowest band of the four parts (the owner, 17 Nov 2026): a university asking 59 in each part refuses a 57 in one.
    const band = field('Lowest band', { value: prefill.band || '', placeholder: '6.0', max: 10 });
    const subject = field('Subject', { value: prefill.subject || '', placeholder: 'Nursing, business', max: 80 });
    form.append(level.wrap, grade.wrap, gap.wrap, test.wrap, score.wrap, band.wrap, subject.wrap);
    const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Find');
    const bar = el('div', 'fd-bar');
    bar.append(go);
    if (onSave) bar.append(h('button', { class: 'btn', type: 'button', onclick: async () => { try { await onSave(values()); window.NiecUI.toast('Saved on the student card'); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } } }, 'Save these details on the card'));
    wrap.append(form, bar);
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
      if (!v.level) { out.replaceChildren(el('p', 'p-muted', 'Choose the level.')); level.input.focus(); return; }
      go.disabled = true;
      out.replaceChildren(el('p', 'p-muted', 'Checking...'));
      try { last = await api('/api/eligibility', v); draw(); } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); }
      go.disabled = false;
    }
    function draw() {
      const d = last;
      out.replaceChildren();
      if (!d.results.length) { out.append(el('p', 'p-muted', 'No match.')); return; }
      const pills = el('div', 'fd-filter');
      pills.setAttribute('role', 'tablist');
      [['all', `All (${d.results.length})`], ['yes', `Eligible (${d.counts.yes})`], ['check', `To check (${d.counts.check})`], ['no', `Not eligible (${d.counts.no})`]].forEach(([k, label]) => {
        const b = h('button', { class: 'td-filter-pill', type: 'button', role: 'tab', 'aria-selected': String(filter === k) }, label);
        b.addEventListener('click', () => { filter = k; draw(); });
        pills.append(b);
      });
      out.append(pills);
      d.results.filter((r) => filter === 'all' || r.status === filter).forEach((r) => out.append(card(r)));

    }
    function card(r) {
      const c = el('article', `fd-uni ${STATUS[r.status][1]}`);
      // The university's picture and logo at the top of its result (the owner, 20 Nov 2026: bigger, clearer cards).
      if (r.cover) { const cv = el('div', 'fd-cover'); const im = el('img'); im.src = r.cover; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.addEventListener('error', () => cv.remove()); cv.append(im); c.append(cv); }
      const top = el('div', 'fd-uni-top');
      if (r.logo) { const lg = el('span', 'fd-logo'); const im = el('img'); im.src = r.logo; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.addEventListener('error', () => lg.remove()); lg.append(im); top.append(lg); }
      const name = el('a', 'fd-uni-name', r.name);
      name.href = '/fact-file?u=' + encodeURIComponent(r.id);
      if (onAdd) { name.target = '_blank'; name.rel = 'noopener'; }
      const t = el('div');
      t.append(name, el('span', 'fd-city', [r.city, r.intake && `${r.intake.name}${r.intake.deadline ? `, apply by ${r.intake.deadline}` : ''}`].filter(Boolean).join(' · ')));
      t.classList.add('fd-uni-words');
      top.append(t, el('span', `fd-status ${STATUS[r.status][1]}`, STATUS[r.status][0]));
      c.append(top);
      const why = el('ul', 'fd-why');
      r.reasons.forEach((x) => why.append(el('li', x.ok === true ? 'is-ok' : x.ok === false ? 'is-bad' : 'is-ask', x.text)));
      if (r.reasons.length) c.append(why);
      const money = el('div', 'fd-money');
      [['Fee', r.fee], ['Scholarship', r.scholarship], ['Deposit', r.deposit]].forEach(([k, v]) => { if (v) { const m = el('div'); m.append(el('span', '', k), el('b', '', v.split('\n').slice(0, 2).join(' · '))); money.append(m); } });
      if (money.children.length) c.append(money);
      if (r.courses.length) {
        const list = el('ul', 'fd-courses');
        const show = (n) => {
          list.replaceChildren(...r.courses.slice(0, n).map((co) => {
            const li = el('li');
            // The course's own page on the university's website, when known (course-sitemap.js).
            const nameEl = co.link ? h('a', { class: 'fd-course', href: co.link, target: '_blank', rel: 'noopener' }, co.name) : el('span', 'fd-course', co.name);
            li.append(nameEl, el('span', 'fd-meta', [co.campus, co.intake].filter(Boolean).join(' · ')));
            if (onAdd) {
              const add = h('button', { class: 'btn btn-sm', type: 'button' }, addLabel);
              add.addEventListener('click', async () => { add.disabled = true; try { await onAdd(r, co); add.textContent = 'Added ✓'; } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); add.disabled = false; } });
              li.append(add);
            } else if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: r.id, name: r.name }, co.name, co.intake || ''));
            else if (shortlist) li.append(window.ShortlistFor.button({ universityId: r.id, university: r.name, course: co.name, intake: co.intake || (r.intake && r.intake.name) || '', level: values().level, link: co.link || '', fee: (r.fee || '').split('\n')[0], scholarship: (r.scholarship || '').split('\n')[0], deposit: (r.deposit || '').split('\n')[0] }));
            return li;
          }));
          if (n < r.total) list.append(h('li', { class: 'fd-more' }, h('button', { class: 'p-link', type: 'button', onclick: () => show(n + 40) }, `Show ${Math.min(40, r.total - n)} more of ${r.total} courses`)));
        };
        show(Math.min(6, r.courses.length));
        c.append(el('div', 'fd-label', `${r.total} course${r.total === 1 ? '' : 's'} at this level`), list);
      }
      return c;
    }
    go.addEventListener('click', run);
    [grade.input, gap.input, score.input, band.input, subject.input].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
    level.input.addEventListener('change', () => { if (last) run(); });
    if (shortlist) window.ShortlistFor.onChange(() => { if (last) draw(); });
    if (prefill.level) run();
    return { run, values };
  }

  window.Finder = { mount };
})();
