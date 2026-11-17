// "Find universities for a student" (the owner, 17 Nov 2026): the study level, GPA or percentage, study gap and English test of a
// student, checked against every university of the Fact File at once (eligibility.js, /api/eligibility). The answer: Eligible, To
// check (close, or a rule a person decides: a waiver, a gap not stated) and Not eligible, each university with the reasons in plain
// words (what meets the rule, what the student would need), its fee, scholarship and deposit for that level, the open intake with its
// deadline, and its courses of that level (narrowed by a subject). Used on the Fact File, on the student card (University options,
// filled in from the card, with Add) and on a student's own login (with I am interested).
//
//   window.Finder.mount(box, { prefill, onAdd(result, course), addLabel, onSave(values), compact })
(function () {
  const { el, h, api, field } = window.Portal;
  const F = window.CardFields;
  const STATUS = { yes: ['Eligible', 'is-yes'], check: ['To check', 'is-check'], no: ['Not eligible', 'is-no'] };

  function mount(box, { prefill = {}, onAdd = null, addLabel = 'Add', onSave = null, title = 'Find universities for a student', intro = '', applyFor = null, canApply = true } = {}) {
    const wrap = el('section', 'p-card fd-card');
    const head = el('div', 'fd-head');
    const words = el('div');
    words.append(el('h2', '', title), el('p', 'p-muted p-small', intro || 'Enter the student\'s details: every university of the Fact File is checked at once.'));
    head.append(words);
    wrap.append(head);
    const form = el('div', 'fd-form');
    const level = field('Study level', { kind: 'select', choices: [['', 'Choose...'], ...F.STUDY_LEVELS.map((x) => [x, x])], value: prefill.level || '' });
    const grade = field('GPA or percentage', { value: prefill.grade || '', placeholder: 'e.g. 3.1 or 68%', max: 20 });
    const gap = field('Study gap (years)', { value: prefill.gap || '', placeholder: 'e.g. 2', max: 3 });
    gap.input.inputMode = 'numeric';
    const test = field('English', { kind: 'select', choices: [['', 'Any'], ...F.ENGLISH_TESTS.map((x) => [x, x])], value: prefill.test || '' });
    const score = field('Overall score', { value: prefill.score || '', placeholder: 'e.g. 6.5', max: 10 });
    // The lowest band of the four parts (the owner, 17 Nov 2026): a university asking 59 in each part refuses a 57 in one.
    const band = field('Lowest band', { value: prefill.band || '', placeholder: 'e.g. 6.0', max: 10 });
    const subject = field('Subject (optional)', { value: prefill.subject || '', placeholder: 'e.g. nursing, business, data', max: 80 });
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
      if (!v.level) { out.replaceChildren(el('p', 'p-muted', 'Choose the study level, then Find.')); level.input.focus(); return; }
      go.disabled = true;
      out.replaceChildren(el('p', 'p-muted', 'Checking every university...'));
      try { last = await api('/api/eligibility', v); draw(); } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); }
      go.disabled = false;
    }
    function draw() {
      const d = last;
      out.replaceChildren();
      if (!d.results.length) { out.append(el('p', 'p-muted', 'No university of the Fact File has this level' + (values().subject ? ' in this subject. Try another word, or leave the subject empty.' : '.'))); return; }
      const pills = el('div', 'fd-filter');
      pills.setAttribute('role', 'tablist');
      [['all', `All (${d.results.length})`], ['yes', `Eligible (${d.counts.yes})`], ['check', `To check (${d.counts.check})`], ['no', `Not eligible (${d.counts.no})`]].forEach(([k, label]) => {
        const b = h('button', { class: 'td-filter-pill', type: 'button', role: 'tab', 'aria-selected': String(filter === k) }, label);
        b.addEventListener('click', () => { filter = k; draw(); });
        pills.append(b);
      });
      out.append(pills);
      d.results.filter((r) => filter === 'all' || r.status === filter).forEach((r) => out.append(card(r)));
      out.append(el('p', 'p-muted p-small fd-foot', `A guide from the rules as written on the Route2Uni portal${d.readAt ? ` (read ${new Date(d.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}; the university decides. ${d.without ? `${d.without} universities of the Fact File have no rules in numbers yet: see their pages.` : ''}`));
    }
    function card(r) {
      const c = el('article', `fd-uni ${STATUS[r.status][1]}`);
      const top = el('div', 'fd-uni-top');
      const name = el('a', 'fd-uni-name', r.name);
      name.href = '/fact-file?u=' + encodeURIComponent(r.id);
      if (onAdd) { name.target = '_blank'; name.rel = 'noopener'; }
      const t = el('div');
      t.append(name, el('span', 'fd-city', [r.city, r.intake && `${r.intake.name}${r.intake.deadline ? `, apply by ${r.intake.deadline}` : ''}`].filter(Boolean).join(' · ')));
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
            const apply = h('button', { class: 'btn btn-sm btn-primary fd-apply', type: 'button', onclick: () => applyDialog({ university: { id: r.id, name: r.name }, course: co.name, intake: co.intake, student: applyFor }) }, 'Submit application');
            if (onAdd) {
              const add = h('button', { class: 'btn btn-sm', type: 'button' }, addLabel);
              add.addEventListener('click', async () => { add.disabled = true; try { await onAdd(r, co); add.textContent = 'Added ✓'; } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); add.disabled = false; } });
              li.append(add);
            } else if (window.Shortlist && window.Shortlist.isStudent() && window.Shortlist.isLinked()) li.append(window.Shortlist.button({ id: r.id, name: r.name }, co.name, co.intake || ''));
            if (canApply) li.append(apply);
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
    if (prefill.level) run();
    return { run, values };
  }

  // "Submit application" on a course (the owner, 17 Nov 2026): a note, and for the team the student it is for; then the Application
  // Team gets the task (portal-api.js /api/apply). `student`: { id, name } when the student is known (the student card).
  function applyDialog({ university, course, intake, student = null }) {
    const own = window.Shortlist && window.Shortlist.isStudent();
    return window.Portal.dialog('Submit an application', (body, close) => {
      const what = el('div', 'ap-what');
      what.append(el('b', '', course), el('span', '', [university.name, intake].filter(Boolean).join(' · ')));
      body.append(what);
      let chosen = student;
      const pickBox = el('div', 'ap-pick');
      if (!own && !student) {
        const q = field('For which student?', { placeholder: 'Type the name, email or phone', max: 100 });
        const list = el('div', 'ap-results');
        let timer;
        q.input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            if (q.input.value.trim().length < 2) { list.replaceChildren(); return; }
            try {
              const r = await api('/api/students/search?q=' + encodeURIComponent(q.input.value.trim()));
              list.replaceChildren(...(r.students || []).slice(0, 6).map((x) => h('button', { class: 'ap-result', type: 'button', onclick: () => { chosen = { id: x.id, name: x.name }; q.input.value = x.name; list.replaceChildren(el('div', 'ap-chosen', `For ${x.name}${x.stage ? ` · ${x.stage}` : ''}`)); } }, el('b', '', x.name), el('small', '', [x.stage, x.intake, x.email].filter(Boolean).join(' · ')))));
            } catch (e) { list.replaceChildren(el('div', 'p-notice bad', e.message)); }
          }, 200);
        });
        pickBox.append(q.wrap, list);
        body.append(pickBox);
      } else if (student) body.append(el('p', 'ap-chosen', `For ${student.name}`));
      const note = field(own ? 'A note for the team (optional)' : 'A note for the Application Team (optional)', { kind: 'area', max: 1500, placeholder: own ? 'e.g. I prefer the London campus. My IELTS is booked for 10 December.' : 'e.g. Documents are complete. Apply for the January intake.' });
      note.input.rows = 3;
      body.append(note.wrap, el('p', 'p-muted p-small', own ? 'The office gets it as a task and starts your application. We will contact you.' : 'The Application Team gets it as a task, with this note.'));
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const send = h('button', { class: 'btn btn-primary', type: 'button' }, own ? 'Submit my application' : 'Send to the Application Team');
      send.addEventListener('click', async () => {
        if (!own && !chosen) { msg.textContent = 'Choose the student first.'; msg.className = 'p-msg error'; return; }
        send.disabled = true;
        try {
          const r = await api('/api/apply', { universityId: university.id, course, intake: intake || '', note: note.input.value.trim(), studentId: chosen ? chosen.id : '' });
          window.NiecUI.toast(own ? 'Sent. The office will start your application and contact you.' : `Sent to the Application Team for ${r.student}.`);
          close(true);
        } catch (e) { msg.textContent = e.message; msg.className = 'p-msg error'; send.disabled = false; }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), send);
      body.append(msg, foot);
    });
  }

  window.Finder = { mount, applyDialog };
})();
