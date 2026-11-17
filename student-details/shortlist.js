// A student's own login on the Fact File (the owner, 17 Nov 2026): a welcome line, "Your shortlist" (the courses the student chose,
// each with Take off) at the top of both Fact File pages, and "I am interested" beside each course on a university's page (see
// fact-university.js). What the student chooses goes to the University options on their card, and the Application Team gets a
// task to advise (portal-api.js, /api/shortlist). For every other account this file does nothing.
(function () {
  const state = { student: false, linked: false, name: '', items: [], listeners: [] };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const say = (t, bad) => (window.NiecUI && window.NiecUI.toast ? window.NiecUI.toast(t, { type: bad ? 'error' : 'success' }) : null);
  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  const key = (uniId, course, intake) => `${uniId}|${String(course).toLowerCase()}|${String(intake || '').toLowerCase()}`;
  const has = (uniId, course, intake) => state.items.some((o) => key(o.universityId, o.course, o.intake) === key(uniId, course, intake));

  function panel() {
    let box = document.getElementById('shortlist');
    if (!box) {
      box = el('section', 'p-card sl-card no-print');
      box.id = 'shortlist';
      const main = document.querySelector('main');
      const head = main && main.querySelector('.page-head');
      if (head) head.after(box); else if (main) main.prepend(box);
    }
    box.replaceChildren();
    const top = el('div', 'sl-head');
    const words = el('div');
    words.append(el('h2', '', state.name ? `Welcome, ${state.name}` : 'Welcome'),
      el('p', 'p-muted', state.linked
        ? 'Look through the universities and their courses. Press "I am interested" on the courses you like: we see your list and advise you.'
        : 'Look through the universities and their courses, then tell us which ones you like.'));
    top.append(words);
    box.append(top);
    if (!state.linked) return;
    box.append(el('h3', 'sl-title', state.items.length ? `Your shortlist (${state.items.length})` : 'Your shortlist is empty'));
    if (!state.items.length) { box.append(el('p', 'p-muted p-small', 'Open a university and press "I am interested" beside a course.')); return; }
    const ul = el('ul', 'sl-list');
    state.items.forEach((o) => {
      const li = el('li');
      const a = el('a', 'sl-uni', o.university);
      a.href = '/fact-file?u=' + encodeURIComponent(o.universityId);
      const t = el('div', 'sl-text');
      t.append(el('b', '', o.course), a, ...(o.intake ? [el('span', 'p-muted p-small', o.intake)] : []));
      const off = el('button', 'btn btn-sm', 'Take off');
      off.type = 'button';
      off.addEventListener('click', async () => {
        off.disabled = true;
        try { const r = await call(`/api/shortlist/${o.id}/delete`, {}); state.items = r.items; changed(); say('Taken off your shortlist'); } catch (e) { say(e.message, true); off.disabled = false; }
      });
      li.append(t, off);
      ul.append(li);
    });
    box.append(ul);
  }
  function changed() { panel(); state.listeners.forEach((f) => f()); }

  // The button beside a course (fact-university.js asks for it for a student's login).
  function button(uni, course, intake) {
    const b = el('button', 'sl-pick no-print');
    b.type = 'button';
    const draw = () => { const on = has(uni.id, course, intake); b.textContent = on ? '✓ On your shortlist' : 'I am interested'; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); };
    draw();
    state.listeners.push(draw);
    b.addEventListener('click', async () => {
      if (has(uni.id, course, intake)) { const o = state.items.find((x) => key(x.universityId, x.course, x.intake) === key(uni.id, course, intake)); if (o) { try { const r = await call(`/api/shortlist/${o.id}/delete`, {}); state.items = r.items; changed(); } catch (e) { say(e.message, true); } } return; }
      b.disabled = true;
      try { const r = await call('/api/shortlist', { universityId: uni.id, course, intake: intake || '' }); state.items = r.items; changed(); say('Added to your shortlist. We will see it and get back to you.'); } catch (e) { say(e.message, true); }
      b.disabled = false;
    });
    return b;
  }

  const ready = (async () => {
    try {
      const me = await call('/api/me');
      if (me.role !== 'student') return state;
      state.student = true;
      document.body.classList.add('is-student-login');
      const r = await call('/api/shortlist');
      Object.assign(state, { linked: r.linked, name: r.name || '', items: r.items || [] });
      panel();
    } catch (e) { /* the Fact File works without it */ }
    return state;
  })();

  window.Shortlist = { ready, button, isStudent: () => state.student, isLinked: () => state.linked };
})();
