// Interview guidelines (the owner, 22 Nov 2026; mock-guidelines.js and mock-team-api.js on the server): every University in
// Universities is listed by itself, with a search. A University opens its files, by kind (credibility interview guidelines, UKVI
// interview guidelines, interview questions, other), each with where it came from and Download. Admin and the Mock Team upload (a
// file, its kind, where it came from and a title) and remove; the Manager downloads.
(function () {
  const { el, h, api } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const toast = (t, type = 'success') => window.NiecUI.toast(t, { type });
  let data = null;
  let chosen = '';
  let q = '';

  const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' }); } catch (e) { return ''; } };
  const filesOf = (name) => data.files.filter((f) => f.university.toLowerCase() === String(name).toLowerCase());

  function draw() {
    const view = $('view');
    const grid = el('div', 'mt-guides');
    grid.append(listCard(), uniCard());
    view.replaceChildren(grid);
  }
  // The Mock Team's page is the approved Apple design (24 Nov 2026); Admin and the Manager keep the page as it was.
  const mockLook = () => document.documentElement.classList.contains('app-mock');
  let only = 'all'; // all | has | none (the switch above the list, the owner approved it 24 Nov 2026)
  function listCard() {
    const card = el('section', 'p-card mt-unis');
    const search = h('input', { type: 'search', class: 'p-input', placeholder: 'Search a University', 'aria-label': 'Search a University', value: q });
    const list = el('div', 'mt-uni-list');
    const fill = () => {
      list.replaceChildren();
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = data.universities.filter((u) => words.every((w) => u.name.toLowerCase().includes(w)) && (!mockLook() || only === 'all' || (only === 'has') === Boolean(filesOf(u.name).length)));
      let letter = '';
      shown.forEach((u) => {
        const n = filesOf(u.name).length;
        const l = u.name.replace(/^University of /i, '').charAt(0).toUpperCase();
        if (mockLook() && l !== letter) { letter = l; list.append(el('div', 'mt-uni-letter', l)); }
        list.append(h('button', { type: 'button', class: `mt-uni${u.name === chosen ? ' is-on' : ''}${n ? '' : ' is-empty'}`, 'aria-pressed': String(u.name === chosen), onclick: () => { chosen = u.name; draw(); } },
          el('span', 'mt-uni-name', u.name), n ? el('span', 'mt-uni-n', String(n)) : (mockLook() ? '' : el('span', 'mt-uni-n is-none', 'none yet'))));
      });
      if (!shown.length) list.append(el('p', 'mt-empty', 'No University has that name.'));
    };
    search.addEventListener('input', () => { q = search.value; fill(); });
    fill();
    const withN = data.universities.filter((u) => filesOf(u.name).length).length;
    const seg = el('div', 'mt-seg');
    [['all', 'All', data.universities.length], ['has', 'With guidelines', withN], ['none', 'None yet', data.universities.length - withN]].forEach(([k, label, n]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(only === k) }, label, el('span', 'mt-seg-n', String(n)));
      b.addEventListener('click', () => { only = k; draw(); });
      seg.append(b);
    });
    if (mockLook()) card.append(seg, search, list);
    else {
      const count = el('p', 'mt-hint');
      const say = () => { const n = list.querySelectorAll('.mt-uni').length; count.textContent = q.trim() ? `${n} of ${data.universities.length} Universities` : `${data.universities.length} Universities, from your Universities list`; };
      search.addEventListener('input', say); say();
      card.append(search, count, list);
    }
    return card;
  }
  function uniCard() {
    const card = el('section', 'p-card mt-uni-card');
    if (!chosen) { card.append(el('h2', '', 'Choose a University'), el('p', 'mt-hint', 'Its interview guidelines open here.')); return card; }
    const files = filesOf(chosen);
    const head = el('div', 'mt-list-head');
    head.append(h('div', {}, el('h2', '', chosen), el('p', 'mt-hint', files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'No guideline yet')));
    card.append(head);
    if (data.canUpload) {
      const open = h('button', { type: 'button', class: 'btn btn-primary' }, 'Upload a guideline');
      head.append(open);
      const form = uploadForm();
      form.hidden = true;
      open.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('select').focus(); });
      card.append(form);
    }
    data.kinds.forEach((kind) => {
      const mine = files.filter((f) => f.kind === kind);
      const head2 = el('div', 'mt-kind-head');
      head2.append(el('h3', 'mt-kind', kind));
      if (!mockLook() && !mine.length) return;
      if (!mine.length && data.canUpload) {
        head2.append(h('button', { type: 'button', class: 'mt-kind-add', onclick: () => { const form = card.querySelector('.mt-upload'); if (form) { form.hidden = false; const sel = form.querySelector('select'); sel.value = kind; sel.focus(); } } }, 'Add'));
      }
      card.append(head2);
      if (!mine.length) card.append(el('p', 'mt-kind-none', 'None yet'));
      mine.forEach((f) => card.append(fileRow(f)));
    });
    return card;
  }
  function fileRow(f) {
    const row = el('div', 'mt-file');
    row.append(el('span', 'mt-file-type', f.type),
      h('div', { class: 'mt-file-words' }, el('span', 'mt-file-title', f.title), el('span', 'mt-hint', `${f.source}${f.by ? ` | uploaded by ${f.by}` : ''}${f.at ? `, ${day(f.at)}` : ''}`)),
      h('a', { class: 'btn', href: `/api/guidelines/${f.id}`, download: f.name }, 'Download'));
    if (data.canUpload) {
      row.append(h('button', { type: 'button', class: 'mt-x', 'aria-label': `Remove ${f.title}`, title: 'Remove', onclick: async () => {
        if (!(await window.NiecUI.confirm(`Remove "${f.title}" from ${f.university}?`, { danger: true, confirmText: 'Remove' }))) return;
        try { await api(`/api/guidelines/${f.id}/delete`, {}); toast('Removed.'); await load(); } catch (e) { toast(e.message, 'error'); }
      } }, '×'));
    }
    return row;
  }
  function uploadForm() {
    const box = el('div', 'mt-upload');
    const kind = h('select', { class: 'p-input', id: 'mtKind' }, ...data.kinds.map((k) => h('option', { value: k }, k)));
    const source = h('select', { class: 'p-input', id: 'mtSource' }, ...data.sources.map((s) => h('option', { value: s }, s)));
    const title = h('input', { class: 'p-input', id: 'mtTitle', maxlength: '160', placeholder: 'For example: Credibility interview guide, Jan 2027' });
    const file = h('input', { type: 'file', id: 'mtFile', accept: '.pdf,.doc,.docx,.png,.jpg,.jpeg' });
    const go = h('button', { type: 'button', class: 'btn btn-primary' }, 'Upload');
    const err = el('p', 'p-msg error');
    const lab = (id, words) => h('label', { class: 'mt-label', for: id }, words);
    box.append(el('p', 'mt-hint', 'A PDF, a Word document or a picture, up to 10 MB.'),
      h('div', { class: 'mt-three' }, h('div', {}, lab('mtKind', 'Kind of guideline'), kind), h('div', {}, lab('mtSource', 'Where it came from'), source), h('div', {}, lab('mtTitle', 'Title'), title)),
      h('div', { class: 'mt-upload-bar' }, file, go), err);
    go.addEventListener('click', async () => {
      err.textContent = '';
      const f = file.files && file.files[0];
      if (!f) { err.textContent = 'Choose the file first.'; file.focus(); return; }
      if (f.size > 10 * 1024 * 1024) { err.textContent = 'That file is too large (the limit is 10 MB).'; return; }
      const u = data.universities.find((x) => x.name === chosen) || {};
      const params = new URLSearchParams({ university: chosen, universityId: u.id || '', kind: kind.value, source: source.value, title: title.value, name: f.name });
      go.disabled = true; go.textContent = 'Uploading…';
      try {
        const res = await fetch(`/api/guidelines?${params}`, { method: 'POST', body: f });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'The file could not be uploaded.');
        toast('Uploaded.');
        await load();
      } catch (e) { err.textContent = e.message; go.disabled = false; go.textContent = 'Upload'; }
    });
    return box;
  }
  async function load() {
    try {
      data = await api('/api/guidelines');
      // A link from a task on Today names the University (?university=...): it opens that University's files (the owner, 23 Nov 2026).
      const asked = (() => { try { return new URLSearchParams(location.search).get('university') || ''; } catch (e) { return ''; } })().trim().toLowerCase();
      if (!chosen && asked) chosen = (data.universities.find((u) => u.name.toLowerCase() === asked) || {}).name || '';
      if (!chosen) chosen = (data.universities.find((u) => filesOf(u.name).length) || {}).name || '';
      draw();
    } catch (e) { $('view').replaceChildren(el('p', 'p-msg error', e.message)); }
  }
  new MutationObserver(() => { if (data) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  load();
})();
