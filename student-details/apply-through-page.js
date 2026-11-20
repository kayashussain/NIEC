// Apply through (the owner, 20 Nov 2026; see apply-through.js on the server): the places two or more B2B partners offer, with no
// direct route, and the partner each one is applied through. Admin changes the partner with the dropdown and it is saved at once;
// the Application Team sees the list only. Universities and international colleges are two tabs: they are never the same place.
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, api, when } = window.Portal;
  let data = { canChange: false, choices: [] };
  let type = 'university';

  function say(text, error) { const m = $('msg'); m.textContent = text || ''; m.className = 'p-msg' + (error ? ' error' : ''); }

  function draw() {
    const q = $('q').value.trim().toLowerCase();
    const of = (t) => data.choices.filter((e) => e.type === t);
    $('nUni').textContent = of('university').length;
    $('nCol').textContent = of('college').length;
    const list = of(type).filter((e) => !q || e.name.toLowerCase().includes(q) || e.partner.toLowerCase().includes(q));
    if (!list.length) {
      const td = el('td', 'p-empty', q ? 'Nothing matches that search.' : 'Nothing to choose here.');
      td.colSpan = 4;
      const tr = el('tr'); tr.append(td); $('rows').replaceChildren(tr);
      return;
    }
    $('rows').replaceChildren(...list.map((e) => {
      const tr = el('tr');
      tr.append(el('td', '', e.name), el('td', 'p-muted', e.options.join(', ')));
      const cell = el('td');
      if (data.canChange) {
        const sel = el('select');
        sel.setAttribute('aria-label', `Apply through for ${e.name}`);
        e.options.forEach((o) => { const opt = el('option', '', o); opt.value = o; if (o === e.partner) opt.selected = true; sel.append(opt); });
        sel.addEventListener('change', () => choose(e, sel));
        cell.append(sel);
      } else {
        cell.append(el('b', '', e.partner));
      }
      tr.append(cell, el('td', 'p-muted p-small', e.changedBy ? `${e.changedBy}, ${when(e.changedAt)}` : ''));
      return tr;
    }));
  }

  async function choose(e, sel) {
    const partner = sel.value;
    sel.disabled = true;
    try {
      const saved = await api(`/api/apply-through/${encodeURIComponent(e.id)}`, { partner });
      Object.assign(e, saved);
      say(`Saved: ${e.name} is applied through ${partner}.`);
      draw();
    } catch (err) {
      sel.value = e.partner;
      sel.disabled = false;
      say(err.message, true);
    }
  }

  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-type]');
    if (!b) return;
    type = b.dataset.type;
    [...$('tabs').children].forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    draw();
  });
  $('q').addEventListener('input', draw);

  api('/api/apply-through').then((d) => {
    data = d;
    if (!d.canChange) $('chip').hidden = false;
    draw();
  }).catch((err) => {
    const td = el('td', 'p-empty', err.message); td.colSpan = 4;
    const tr = el('tr'); tr.append(td); $('rows').replaceChildren(tr);
  });
})();
