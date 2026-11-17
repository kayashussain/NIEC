// Shortlisting from the Fact File for a student (the owner, 17 Nov 2026: "shortlist instead of submit the application"). The team
// chooses the student once ("Shortlist for: ..." at the top of the courses, kept while the browser tab is open); each course then has
// Shortlist, which puts it into the student's University options (and takes it out again). On the student's card the shortlist is
// numbered and sent to the Application Team in one go (student-page.js).
//
// Also the look-up of a course's page on the university's website for the student card (SendToStudent.lookupLink).
(function (root) {
  const { el, h, api, field, dialog } = root.Portal;
  const say = (t, e) => root.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const KEY = 'isrShortlistFor';
  const state = { student: null, options: [], listeners: [] };
  const optKey = (universityId, course, intake) => `${universityId}|${String(course).toLowerCase()}|${String(intake || '').toLowerCase()}`;
  const changed = () => state.listeners.forEach((f) => f());

  function remembered() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function remember(s) { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) { /* kept for this page only */ } }

  async function loadOptions() {
    if (!state.student) { state.options = []; return; }
    try { const r = await api(`/api/cards/${encodeURIComponent(state.student.id)}`); state.options = (r.card && r.card.options) || []; } catch (e) { state.student = null; remember(null); state.options = []; }
  }

  // Pick one student from the ones this account sees (by name, email or phone number).
  function pickStudent() {
    return dialog('Shortlist for which student?', (body, close) => {
      const q = field('Search', { placeholder: 'Name, email or phone number', max: 100 });
      const results = el('div', 'p-pick-list');
      body.append(q.wrap, results);
      let timer;
      const run = async () => {
        try {
          const r = await api('/api/students/search?q=' + encodeURIComponent(q.input.value));
          results.replaceChildren(...(r.students.length ? r.students.map((s) => {
            const b = el('button', 'p-pick');
            b.type = 'button';
            const t = el('span');
            t.append(el('b', '', s.name), el('small', '', [s.stage, s.intake, s.email].filter(Boolean).join(' · ')));
            b.append(el('span', 'p-avatar sm', root.Portal.initials(s.name)), t);
            b.addEventListener('click', () => close({ id: s.id, name: s.name }));
            return b;
          }) : [el('div', 'p-empty', 'No student found.')]));
        } catch (e) { results.replaceChildren(el('div', 'p-notice bad', e.message)); }
      };
      q.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
      run();
      setTimeout(() => q.input.focus(), 30);
    });
  }
  async function choose() {
    const s = await pickStudent();
    if (!s) return false;
    state.student = s;
    remember(s);
    await loadOptions();
    changed();
    return true;
  }

  // "Shortlist for: Ram Sharma (3) · Change · Open the card", or the button to choose the student.
  function bar() {
    const box = el('div', 'sl-for no-print');
    if (!state.student) {
      box.append(el('span', 'sl-for-text', 'Shortlist courses for a student:'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => choose() }, 'Choose the student'));
      return box;
    }
    const n = state.options.length;
    const t = el('span', 'sl-for-text');
    t.append('Shortlisting for ', el('b', '', state.student.name), ` (${n} course${n === 1 ? '' : 's'})`);
    const open = h('a', { class: 'btn btn-sm btn-primary', href: `/student?id=${encodeURIComponent(state.student.id)}#options` }, 'Open the card to send');
    box.append(t, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose() }, 'Change student'), open);
    return box;
  }

  // Shortlist / Shortlisted beside a course.
  function button(o) {
    const found = () => state.options.find((x) => optKey(x.universityId, x.course, x.intake) === optKey(o.universityId, o.course, o.intake));
    const on = found();
    const b = h('button', { class: `sl-pick no-print${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(on)) }, on ? '✓ Shortlisted' : 'Shortlist');
    b.addEventListener('click', async () => {
      if (!state.student && !(await choose())) return;
      b.disabled = true;
      try {
        const now = found();
        if (now) {
          if (now.sent || now.applied) { say('Already sent to the Application Team: change it on the student card.', true); b.disabled = false; return; }
          await api(`/api/cards/${encodeURIComponent(state.student.id)}/options/${now.id}/delete`, {});
          say(`Taken off ${state.student.name}'s shortlist`);
        } else {
          await api(`/api/cards/${encodeURIComponent(state.student.id)}/options`, { universityId: o.universityId, university: o.university, course: o.course, level: o.level || '', intake: o.intake || '', fee: o.fee || '', deposit: o.deposit || '', scholarship: o.scholarship || '', link: o.link || '' });
          say(`Shortlisted for ${state.student.name}`);
        }
        await loadOptions();
        changed();
      } catch (e) { say(e.message, true); b.disabled = false; }
    });
    return b;
  }

  const ready = async () => { state.student = remembered(); await loadOptions(); };
  root.ShortlistFor = { ready, bar, button, onChange: (f) => state.listeners.push(f), current: () => state.student };

  // Looks the course page up on the university's website (the server does the search); resolves to a link or ''.
  async function lookupLink(o) {
    try { const r = await api('/api/course-link', { universityId: o.universityId, university: o.university, course: o.course }); return r.link || ''; } catch (e) { return ''; }
  }
  root.SendToStudent = { lookupLink };
})(this);
