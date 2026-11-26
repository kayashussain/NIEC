// Interview guidelines (the owner, 22 Nov 2026; mock-guidelines.js and mock-team-api.js on the server): every University in
// Universities is listed by itself, with a search. A University opens its files, by kind (credibility interview guidelines, UKVI
// interview guidelines, interview questions, other), each with where it came from and Download. Admin and the Mock Team upload (a
// file, its kind, where it came from and a title) and remove; the Manager downloads.
// 26 Nov 2026 (the owner: "make it the next top global brand"): a new look for everyone who opens it, with two tabs only (All and
// With guidelines), a monogram for each University, an open University shown as a heading card, files grouped by kind, and calm
// empty states. What can be done is unchanged.
(function () {
  const { el, h, api } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const toast = (t, type = 'success') => window.NiecUI.toast(t, { type });
  let data = null;
  let chosen = '';
  let q = '';
  let only = 'all'; // all | has (the two tabs above the list)

  const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' }); } catch (e) { return ''; } };
  const filesOf = (name) => data.files.filter((f) => f.university.toLowerCase() === String(name).toLowerCase());
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  // A University is filed under the first letter of its name without "University of " or "The ", so the A to Z headings are in order.
  const sortKey = (name) => String(name).replace(/^the\s+/i, '').replace(/^university of\s+/i, '').toLowerCase();
  // Two letters for the round mark beside a name, from the words that tell it apart ("University of East London" reads EL).
  const initials = (name) => {
    const words = String(name).replace(/\(.*?\)/g, ' ').split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(the|university|of|and|at|college|for)$/i.test(w));
    const two = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || String(name)).slice(0, 2);
    return two.toUpperCase();
  };
  const mark = (name, extra = '') => h('span', { class: `ig-mark ig-tone-${[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}${extra}`, 'aria-hidden': 'true' }, initials(name));
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  };
  const icon = (name) => { const s = el('span', 'ig-ico'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`; return s; };

  // Choosing a University redraws the page; the list keeps its place (it used to jump back to A), and the chosen University keeps the
  // keyboard focus when it was picked from the list.
  function draw(keepFocus) {
    const view = $('view');
    const oldList = view.querySelector('.ig-list');
    const top = oldList ? oldList.scrollTop : 0;
    const grid = el('div', 'ig-grid');
    grid.append(listCard(), uniCard());
    view.replaceChildren(grid);
    const list = view.querySelector('.ig-list');
    if (list) list.scrollTop = top;
    if (keepFocus) { const on = view.querySelector('.ig-uni.is-on'); if (on) on.focus({ preventScroll: true }); }
  }

  function listCard() {
    const card = el('section', 'ig-panel ig-side');
    const search = h('input', { type: 'search', class: 'ig-search-box', placeholder: 'Search a University', 'aria-label': 'Search a University', value: q });
    const list = el('div', 'ig-list');
    const fill = () => {
      list.replaceChildren();
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = data.universities
        .filter((u) => words.every((w) => u.name.toLowerCase().includes(w)) && (only === 'all' || filesOf(u.name).length > 0))
        .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'en', { sensitivity: 'base', numeric: true }));
      let letter = '';
      shown.forEach((u) => {
        const n = filesOf(u.name).length;
        const l = (sortKey(u.name).charAt(0).toUpperCase().match(/[A-Z]/) || ['#'])[0];
        if (l !== letter) { letter = l; list.append(el('div', 'ig-letter', l)); }
        list.append(h('button', { type: 'button', class: `ig-uni${u.name === chosen ? ' is-on' : ''}`, 'aria-pressed': String(u.name === chosen), onclick: () => { chosen = u.name; draw(true); } },
          mark(u.name), el('span', 'ig-uni-name', u.name), n ? h('span', { class: 'ig-count', title: plural(n, 'guideline') }, String(n)) : ''));
      });
      if (!shown.length) list.append(el('p', 'ig-none', !q.trim() && only === 'has' ? 'No University has a guideline yet.' : 'No University has that name.'));
    };
    search.addEventListener('input', () => { q = search.value; fill(); });
    fill();
    const withN = data.universities.filter((u) => filesOf(u.name).length).length;
    const seg = el('div', 'ig-tabs');
    [['all', 'All', data.universities.length], ['has', 'With guidelines', withN]].forEach(([k, label, n]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(only === k) }, label, el('span', 'ig-tab-n', String(n)));
      b.addEventListener('click', () => { only = k; draw(); });
      seg.append(b);
    });
    card.append(seg, h('label', { class: 'ig-search' }, icon('search'), search), list);
    return card;
  }

  // A calm panel for "nothing here yet": a round icon, a heading, one line and, when there is one, the button.
  function empty(iconName, title, words, button) {
    const box = el('div', 'ig-empty');
    box.append(h('span', { class: 'ig-empty-ico' }, icon(iconName)), el('h3', '', title), el('p', '', words));
    if (button) box.append(button);
    return box;
  }

  function uniCard() {
    const card = el('section', 'ig-panel ig-main');
    if (!chosen) { card.append(empty('doc', 'Choose a University', 'Its interview guidelines open here.')); return card; }
    const files = filesOf(chosen);
    const head = el('div', 'ig-head');
    head.append(mark(chosen, ' is-big'), h('div', { class: 'ig-head-words' }, el('h2', '', chosen), el('p', '', files.length ? plural(files.length, 'guideline') : 'No guideline yet')));
    card.append(head);
    let first = null;
    if (data.canUpload) {
      const open = h('button', { type: 'button', class: 'btn btn-primary ig-upload-btn' }, icon('upload'), el('span', '', 'Upload a guideline'));
      const form = uploadForm();
      form.hidden = true;
      const toggle = () => {
        form.hidden = !form.hidden;
        open.lastChild.textContent = form.hidden ? 'Upload a guideline' : 'Cancel';
        open.classList.toggle('btn-primary', form.hidden); // one main blue button on the screen: the one inside the panel
        const none = card.querySelector('.ig-empty'); if (none) none.hidden = !form.hidden; // the empty panel waits while the upload is open
        if (!form.hidden) form.querySelector('select').focus();
      };
      open.addEventListener('click', toggle);
      head.append(open);
      card.append(form);
      first = () => { const b = h('button', { type: 'button', class: 'btn btn-primary ig-first' }, 'Add the first guideline'); b.addEventListener('click', toggle); return b; };
    }
    if (!files.length) { card.append(empty('doc', 'No guidelines yet', data.canUpload ? 'Add the interview guide or questions for this University, so the whole team can use them.' : 'Nothing has been added for this University.', first && first())); return card; }
    data.kinds.forEach((kind) => {
      const mine = files.filter((f) => f.kind === kind);
      if (!mine.length) return;
      const group = el('div', 'ig-group');
      group.append(h('div', { class: 'ig-group-head' }, el('h3', '', kind), el('span', 'ig-group-n', String(mine.length))));
      mine.forEach((f) => group.append(fileRow(f)));
      card.append(group);
    });
    return card;
  }

  function fileRow(f) {
    const row = el('div', 'ig-file');
    row.append(el('span', `ig-type ig-type-${String(f.type).toLowerCase().replace(/[^a-z]/g, '')}`, f.type),
      h('div', { class: 'ig-file-words' }, el('span', 'ig-file-title', f.title), el('span', 'ig-file-meta', `${f.source}${f.by ? ` | uploaded by ${f.by}` : ''}${f.at ? `, ${day(f.at)}` : ''}`)),
      h('a', { class: 'btn ig-download', href: `/api/guidelines/${f.id}`, download: f.name }, icon('download'), el('span', '', 'Download')));
    if (data.canUpload) {
      row.append(h('button', { type: 'button', class: 'ig-remove', 'aria-label': `Remove ${f.title}`, title: 'Remove', onclick: async () => {
        if (!(await window.NiecUI.confirm(`Remove "${f.title}" from ${f.university}?`, { danger: true, confirmText: 'Remove' }))) return;
        try { await api(`/api/guidelines/${f.id}/delete`, {}); toast('Removed.'); await load(); } catch (e) { toast(e.message, 'error'); }
      } }, '×'));
    }
    return row;
  }

  function uploadForm() {
    const box = el('div', 'ig-upload');
    const kind = h('select', { class: 'p-input', id: 'mtKind' }, ...data.kinds.map((k) => h('option', { value: k }, k)));
    const source = h('select', { class: 'p-input', id: 'mtSource' }, ...data.sources.map((s) => h('option', { value: s }, s)));
    const title = h('input', { class: 'p-input', id: 'mtTitle', maxlength: '160', placeholder: 'For example: Credibility interview guide, Jan 2027' });
    const file = h('input', { type: 'file', id: 'mtFile', accept: '.pdf,.doc,.docx,.png,.jpg,.jpeg' });
    const go = h('button', { type: 'button', class: 'btn btn-primary' }, 'Upload');
    const err = el('p', 'p-msg error');
    go.disabled = true; // Upload waits until a file is chosen
    file.addEventListener('change', () => { go.disabled = !(file.files && file.files.length); });
    const lab = (id, words) => h('label', { class: 'ig-label', for: id }, words);
    box.append(h('div', { class: 'ig-fields' }, h('div', {}, lab('mtKind', 'Kind of guideline'), kind), h('div', {}, lab('mtSource', 'Where it came from'), source), h('div', { class: 'ig-wide' }, lab('mtTitle', 'Title'), title)),
      h('div', { class: 'ig-upload-bar' }, file, go), el('p', 'ig-hint', 'A PDF, a Word document or a picture, up to 10 MB.'), err);
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
  load();
})();
