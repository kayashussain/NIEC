// A student's own portal (the owner, 20 Nov 2026; see mock-api.js on the server): hello by name, where they are (Applied, Offer,
// Mock interview, Payment, CAS, Visa), every university applied to with its decision and deadline, the mock interviews held so far
// with the team's feedback, and the mock interview guide of each university, read phase by phase (guide-view.js).
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, api } = window.Portal;
  const day = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  let me = null;
  let chosen = '';

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
      if (a.guide) {
        const b = el('button', 'btn mp-app-guide', 'Open the interview guide');
        b.type = 'button';
        b.addEventListener('click', () => { choose(a.guide); $('guideTitle').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        card.append(b);
      }
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

  // The guides: one per university applied to that has one, and the guide every student reads.
  function drawSwitch() {
    const seen = new Set();
    const options = me.applications.filter((a) => a.guide && !seen.has(a.guide) && seen.add(a.guide)).map((a) => [a.guide, a.university]);
    if (!options.length && me.coreGuide) options.push(['core', 'Every university']);
    if (!options.length) { $('switch').replaceChildren(); $('guide').replaceChildren(el('p', 'mp-empty', 'Your guide is being prepared by our team. Please check again soon.')); return false; }
    if (!options.some(([k]) => k === chosen)) chosen = options[0][0];
    $('switch').hidden = options.length < 2;
    $('switch').replaceChildren(...options.map(([key, name]) => {
      const b = el('button', 'mp-seg', name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(key === chosen));
      b.addEventListener('click', () => choose(key));
      return b;
    }));
    return true;
  }

  async function choose(key) {
    chosen = key;
    if (!drawSwitch()) return;
    $('guide').replaceChildren(el('p', 'p-muted', 'Loading the guide…'));
    try {
      const view = await api(`/api/my-portal/guide/${encodeURIComponent(chosen)}`);
      window.GuideView.render($('guide'), view, {
        read: view.read || {},
        onRead: async (phase) => (await api('/api/my-portal/read', { guide: chosen, phase })).read,
      });
    } catch (e) { $('guide').replaceChildren(el('p', 'mp-empty', e.message)); }
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
    if (drawSwitch()) choose(chosen);
  }
  load();
})();
