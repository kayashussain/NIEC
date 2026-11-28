// Interview guidelines (the owner, 22 Nov 2026; mock-guidelines.js and mock-team-api.js on the server): every University in
// Universities is listed by itself, with a search. A University opens its files, by kind (credibility interview guidelines, UKVI
// interview guidelines, interview questions, other), each with where it came from and Download. Admin and the Mock Team upload (a
// file, its kind, where it came from and a title) and remove; a branch uploads but removes nothing (28 Nov 2026); every other team reads and downloads (27 Nov 2026). A
// University opens with its first file already on screen: a PDF or a picture as it is, a Word document as its words; a press on
// another file shows that one.
// 26 Nov 2026 (the owner: "make it the next top global brand"): a new look for everyone who opens it, with two tabs only (All and
// With guidelines), each University's logo (its letters where there is none), an open University shown as a heading card, files grouped by kind, and calm
// empty states. What can be done is unchanged.
// 28 Nov 2026 (the owner chose "A, two tall cards"): both cards run to the bottom of the screen; Upload sits beside the page's title;
// the open University's files sit side by side above the file, which fills the rest of its card.
(function () {
  const { el, h, api } = window.Portal;
  const $ = (id) => document.getElementById(id);
  // The owner, 28 Nov 2026: on a laptop the page looked bold and wide next to the approved design, which is drawn 1756 px wide (a 1440 px
  // screen at the portal's usual 82%). Here the page is drawn at the size that keeps that same picture on a narrower screen (never above
  // 82%, never below 65%); a phone and a tablet (under 900 px) keep their own layout.
  const fit = () => {
    const root = document.documentElement;
    if (window.innerWidth < 900) { root.style.removeProperty('zoom'); root.style.removeProperty('--sr360-z'); return; }
    const z = Math.round(Math.max(0.65, Math.min(0.82, window.innerWidth / 1756)) * 100) / 100;
    root.style.zoom = String(z);
    root.style.setProperty('--sr360-z', String(z));
  };
  fit();
  window.addEventListener('resize', fit);
  const toast = (t, type = 'success') => window.NiecUI.toast(t, { type });
  let data = null;
  let chosen = '';
  let q = '';
  let only = 'all'; // all | has (the two tabs above the list)
  let openFile = ''; // the file shown in the reader
  let uploading = false; // the upload form is open in the right card
  const words = new Map(); // what a Word document says, once read
  // A phone or a tablet shows no more than the first page of a PDF inside a page, so there it opens on its own.
  const framesPdf = () => navigator.pdfViewerEnabled !== false && !window.matchMedia('(max-width: 760px)').matches && !(navigator.maxTouchPoints > 1 && /Mac|iPad|iPhone/.test(navigator.userAgent));

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
  // The University's logo beside its name (the owner, 26 Nov 2026), from its page in Universities; the two letters only where there is
  // no logo, or it cannot be shown.
  const media = (u) => (/^https:\/\//.test(u) ? `/api/media?u=${encodeURIComponent(u)}` : u); // the server's kept copy (media-cache.js)
  const mark = (name, extra = '') => {
    const m = h('span', { class: `ig-mark ig-tone-${[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}${extra}`, 'aria-hidden': 'true' }, initials(name));
    const logo = ((data && data.universities.find((u) => u.name === name)) || {}).logo;
    if (!logo) return m;
    const img = el('img');
    img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = media(logo);
    img.addEventListener('error', () => { m.classList.remove('has-logo'); m.replaceChildren(initials(name)); });
    m.classList.add('has-logo');
    m.replaceChildren(img);
    return m;
  };
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
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
    uploadButton();
  }

  // Only the right card, so the list and what is typed in its search stay as they are.
  function redrawMain() {
    const old = document.querySelector('.ig-main');
    if (!old) { draw(); return; }
    old.replaceWith(uniCard());
    uploadButton();
  }

  function toggleUpload() {
    uploading = !uploading;
    redrawMain();
    const to = uploading ? $('mtKind') : document.querySelector('.ig-upload-btn');
    if (to) to.focus();
  }

  // Upload a guideline, beside the page's title, for Admin and the Mock Team, once a University is open.
  function uploadButton() {
    const head = document.querySelector('#page .p-head');
    let b = head.querySelector('.ig-upload-btn');
    if (!data.canUpload || !chosen) { if (b) b.remove(); return; }
    if (!b) { b = h('button', { type: 'button', class: 'btn ig-upload-btn', onclick: toggleUpload }); head.append(b); }
    b.classList.toggle('btn-primary', !uploading); // one main blue button on the screen: the one inside the form
    b.replaceChildren(...(uploading ? [] : [icon('upload')]), el('span', '', uploading ? 'Cancel upload' : 'Upload a guideline'));
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
        list.append(h('button', { type: 'button', class: `ig-uni${u.name === chosen ? ' is-on' : ''}`, 'aria-pressed': String(u.name === chosen), onclick: () => { chosen = u.name; uploading = false; draw(true); } },
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
      b.addEventListener('click', () => { only = k; document.querySelector('.ig-side').replaceWith(listCard()); });
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

  // The open University on the right: its name with Download, full screen and Remove for the file on screen, its files side by side,
  // and the file itself filling the rest of the card.
  function uniCard() {
    const card = el('section', 'ig-panel ig-main');
    if (!chosen) { card.append(empty('doc', 'Choose a University', 'Its interview guidelines open here.')); return card; }
    const files = filesOf(chosen);
    const ordered = [...data.kinds.flatMap((kind) => files.filter((f) => f.kind === kind)), ...files.filter((f) => !data.kinds.includes(f.kind))];
    const file = ordered.find((f) => f.id === openFile) || ordered[0];
    if (file) openFile = file.id;
    const adding = uploading && data.canUpload;
    const line = adding ? 'Every team can read it once it is added.' : file ? `${plural(files.length, 'guideline')} | ${meta(file)}` : 'No guideline yet';
    const head = el('div', 'ig-head');
    head.append(mark(chosen, ' is-big'), h('div', { class: 'ig-head-words' }, el('h2', '', adding ? `Upload to ${chosen}` : chosen), el('p', '', line)));
    if (file && !adding) head.append(actions(file));
    card.append(head);
    if (adding) { card.append(uploadForm()); return card; }
    if (!file) {
      let add = null;
      if (data.canUpload) add = h('button', { type: 'button', class: 'btn btn-primary ig-first', onclick: toggleUpload }, 'Add the first guideline');
      card.append(empty('doc', 'No guidelines yet', data.canUpload ? 'Add the interview guide or questions for this University, so every team can read them.' : 'Nothing has been added for this University.', add));
      return card;
    }
    const row = h('div', { class: 'ig-files', role: 'group', 'aria-label': 'Files' });
    ordered.forEach((f) => row.append(fileTab(f)));
    card.append(row, reader(file));
    return card;
  }

  function actions(f) {
    const box = el('div', 'ig-acts');
    const type = String(f.type).toUpperCase();
    box.append(h('a', { class: 'ig-download', href: `/api/guidelines/${f.id}`, download: f.name }, icon('download'), el('span', '', 'Download')));
    // A Word document is read on the page only: opened on its own the browser would just download it.
    if (type !== 'DOC' && type !== 'DOCX') box.append(h('a', { class: 'ig-round ig-full', href: `/api/guidelines/${f.id}?view=1`, target: '_blank', rel: 'noopener', 'aria-label': 'Open full screen', title: 'Open full screen' }, icon('expand')));
    if (data.canRemove) {
      box.append(h('button', { type: 'button', class: 'ig-round ig-remove', 'aria-label': `Remove ${f.title}`, title: 'Remove', onclick: async () => {
        if (!(await window.NiecUI.confirm(`Remove "${f.title}" from ${f.university}?`, { danger: true, confirmText: 'Remove' }))) return;
        try { await api(`/api/guidelines/${f.id}/delete`, {}); toast('Removed.'); await load(); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash')));
    }
    return box;
  }

  // Show another file: the right card is drawn again, the row of files keeps its place, and on a small screen the screen glides to
  // the file when it is out of sight.
  function show(f) {
    openFile = f.id;
    const row = document.querySelector('.ig-files');
    const left = row ? row.scrollLeft : 0;
    redrawMain();
    const next = document.querySelector('.ig-files');
    if (next) next.scrollLeft = left;
    const on = document.querySelector(`.ig-file[data-file="${f.id}"]`);
    if (on) on.focus({ preventScroll: true });
    const box = document.querySelector('.ig-reader');
    if (box && box.getBoundingClientRect().top > window.innerHeight - 160) box.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function reader(f) {
    const box = h('section', { class: 'ig-reader', 'aria-label': `Reading ${f.title}`, 'data-file': f.id });
    const src = `/api/guidelines/${f.id}?view=1`;
    const type = String(f.type).toUpperCase();
    const body = h('div', { class: 'ig-reader-body', tabindex: '0' }); // it scrolls, so the keyboard can reach it
    box.append(body);
    const note = (title, line, button) => { body.replaceChildren(empty('doc', title, line, button)); };
    if (type === 'PDF') {
      if (framesPdf()) body.append(h('iframe', { class: 'ig-frame', src: `${src}#view=FitH&navpanes=0`, title: f.title }));
      else note('A PDF', 'On this device it opens on its own, with every page.', h('a', { class: 'btn btn-primary ig-first', href: src, target: '_blank', rel: 'noopener' }, 'Open the PDF'));
    } else if (type === 'DOC' || type === 'DOCX') {
      const paint = (doc) => {
        if (doc.kind !== 'word') { note('Cannot be shown here', doc.reason || 'Download it to read it.', get()); return; }
        if (!doc.blocks.length) { note('Nothing to show', 'This document has no words that can be shown here. Download it to read it.', get()); return; }
        body.replaceChildren(page(doc));
      };
      if (words.has(f.id)) paint(words.get(f.id));
      else {
        body.append(h('p', { class: 'ig-loading', role: 'status' }, 'Opening the document…'));
        api(src).then((doc) => { words.set(f.id, doc); if (box.isConnected) paint(doc); }).catch((e) => { if (box.isConnected) note('Cannot be shown here', e.message, get()); });
      }
    } else {
      const img = h('img', { class: 'ig-picture', src, alt: f.title });
      img.addEventListener('error', () => note('Cannot be shown here', 'Download it to see it.', get()));
      body.append(img);
    }
    return box;
  }

  // A Word document as the server read it (docx-preview.js): built with text only, so nothing in a file can run.
  function page(doc) {
    const sheet = el('article', 'ig-page-sheet');
    const runs = (into, list) => list.forEach((r) => {
      if (r.img) { if (/^data:image\/(png|jpeg|gif);base64,/.test(r.img)) into.append(h('img', { src: r.img, alt: r.alt || 'Picture' })); return; }
      let node = document.createTextNode(String(r.s));
      [['u', 'u'], ['i', 'em'], ['b', 'strong']].forEach(([k, tag]) => { if (r[k]) { const w = document.createElement(tag); w.append(node); node = w; } });
      if (r.href && /^(https?:\/\/|mailto:)/i.test(r.href)) { const a = h('a', { href: r.href, target: '_blank', rel: 'noopener noreferrer' }); a.append(node); node = a; }
      into.append(node);
    });
    const blocks = (into, list) => list.forEach((b) => {
      if (b.t === 'table') {
        const t = el('table');
        const tb = el('tbody');
        b.rows.forEach((row) => { const tr = el('tr'); row.forEach((c) => { const td = el('td'); if (c.span) td.colSpan = c.span; blocks(td, c.blocks); tr.append(td); }); tb.append(tr); });
        t.append(tb);
        const wrap = el('div', 'ig-table');
        wrap.append(t);
        into.append(wrap);
        return;
      }
      let node;
      if (b.t === 'h') node = el(`h${Math.min(6, Math.max(1, b.level) + 3)}`, `ig-h ig-h${b.level}`);
      else if (b.t === 'li') {
        node = el('p', 'ig-li');
        node.style.setProperty('--depth', String(b.depth || 0));
        node.append(el('span', 'ig-li-mark', b.label || ''));
      } else node = el('p');
      if (b.align) node.style.textAlign = b.align;
      const into2 = b.t === 'li' ? el('span', 'ig-li-words') : node;
      runs(into2, b.runs);
      if (b.t === 'li') node.append(into2);
      into.append(node);
    });
    blocks(sheet, doc.blocks);
    if (doc.truncated) sheet.append(el('p', 'ig-cut', 'This document is longer than can be shown here. Download it to read the rest.'));
    return sheet;
  }

  const meta = (f) => `${f.source}${f.by ? ` | uploaded by ${f.by}` : ''}${f.at ? `, ${day(f.at)}` : ''}`;

  // One file in the row above the reader.
  function fileTab(f) {
    const tab = h('button', { type: 'button', class: 'ig-file', 'aria-pressed': String(f.id === openFile), title: f.title, onclick: () => show(f) },
      el('span', `ig-type ig-type-${String(f.type).toLowerCase().replace(/[^a-z]/g, '')}`, f.type),
      h('span', { class: 'ig-file-words' }, el('span', 'ig-file-title', f.title), el('span', 'ig-file-meta', f.kind)));
    tab.dataset.file = f.id;
    return tab;
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
        uploading = false;
        openFile = (json.file && json.file.id) || openFile; // the new file is on screen
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
