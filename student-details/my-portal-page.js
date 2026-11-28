// A student's own portal (the owner, 20 Nov 2026; see mock-api.js on the server): hello by name, where they are (Applied, Offer,
// Mock interview, Payment, CAS, Visa), every university applied to with its decision and deadline, the mock interviews held so far
// with the team's feedback. The mock interview guides were taken out (the owner, 28 Nov 2026).
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, api } = window.Portal;
  const day = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  let me = null;

  function drawProgress() {
    $('progress').replaceChildren(...me.progress.map((s, i) => {
      const li = el('li', `mp-step is-${s.state}`);
      li.style.setProperty('--i', String(i));
      li.append(el('span', 'mp-dot', s.state === 'done' ? '✓' : String(i + 1)), el('span', 'mp-step-label', s.label));
      if (s.state === 'now') li.setAttribute('aria-current', 'step');
      return li;
    }));
  }

  function drawApps() {
    if (!me.applications.length) { $('apps').replaceChildren(el('p', 'mp-empty', 'Your applications will show here as soon as our team submits them.')); return; }
    $('apps').replaceChildren(...me.applications.map((a, i) => {
      const card = el('article', 'mp-app');
      card.style.setProperty('--i', String(i));
      const kind = a.withdrawn || a.refused ? 'is-no' : a.offer ? 'is-yes' : 'is-wait';
      const top = el('div', 'mp-app-top');
      top.append(el('span', `mp-decision ${kind}`, a.decision));
      if (a.main) top.append(el('span', 'mp-main', 'Main choice'));
      card.append(top, el('h3', 'mp-app-uni', a.university), el('p', 'mp-app-course', a.course || ''));
      const facts = el('dl', 'mp-app-facts');
      const add = (k, v) => { if (!v) return; facts.append(el('dt', '', k), el('dd', '', v)); };
      add('Applied', a.applied ? day(a.applied) : '');
      add('Offer', a.offer ? day(a.offer) : '');
      add('Refused', a.refused ? day(a.refused) : '');
      add('Withdrawn', a.withdrawn ? day(a.withdrawn) : '');
      if (a.deadline) add(`Next deadline (${a.deadline.intake})`, `${a.deadline.when}${typeof a.deadline.days === 'number' ? (a.deadline.days === 0 ? ', today' : a.deadline.days > 0 ? `, ${a.deadline.days} day${a.deadline.days === 1 ? '' : 's'} left` : '') : ''}`);
      card.append(facts);
      if (a.reason) card.append(el('p', 'mp-app-reason', a.reason));
      return card;
    }));
  }

  function drawMocks() {
    const box = $('mocks');
    if (!me.mocks.length && !me.preCas) { box.replaceChildren(el('p', 'mp-empty', 'No mock interviews yet. Your feedback will show here after each one.')); return; }
    const list = el('ol', 'mp-mocks');
    me.mocks.forEach((m) => {
      const li = el('li', 'mp-mock');
      li.append(el('b', '', `Mock ${m.n}`), el('span', 'mp-mock-date', /^\d{4}-\d{2}-\d{2}/.test(m.date) ? day(m.date) : m.date));
      if (m.feedback) li.append(el('p', 'mp-mock-feedback', m.feedback));
      list.append(li);
    });
    box.replaceChildren(list);
    if (me.preCas) box.append(el('p', `mp-precas ${/^pass/i.test(me.preCas) ? 'is-yes' : 'is-no'}`, `University interview: ${me.preCas}`));
  }

  async function load() {
    try { me = await api('/api/my-portal'); } catch (e) { $('apps').replaceChildren(el('p', 'mp-empty', e.message)); return; }
    $('hello').textContent = me.firstName ? `Hi ${me.firstName}` : 'Hi';
    if (!me.linked) {
      $('apps').replaceChildren(el('p', 'mp-empty', 'Your login is not linked to your file yet. Please ask the office.'));
      document.querySelectorAll('.mp-section').forEach((s, i) => { if (i !== 1) s.hidden = true; });
      return;
    }
    $('intake').textContent = me.intake || '';
    drawProgress();
    drawApps();
    drawMocks();
  }
  load();
})();
