// Partners: Partner Universities, B2B Partners and Agents as one section (the owner, 17 Nov 2026). Each of the three pages keeps its own
// address and list; this adds the switch at the top ("Universities | B2B partners | Agents", each with how many there are), showing only
// the lists this account may open (partner-access.js on the server). One list only (a branch) or an earlier backup: no switch.
(function () {
  if (new URLSearchParams(location.search).get('backup')) return;
  const main = document.querySelector('main');
  if (!main) return;
  const here = document.querySelector('.niec-header') && document.querySelector('.niec-header').dataset.page;
  const TABS = [
    { id: 'direct', href: '/partner-universities', label: 'Universities', api: '/api/direct', hint: 'Universities you hold a direct agreement with' },
    { id: 'b2b', href: '/b2b-partners', label: 'B2B partners', api: '/api/b2b', hint: 'Businesses you send applications through' },
    { id: 'agents', href: '/agents', label: 'Agents', api: '/api/agents', hint: 'Businesses that send you their students' },
    // Admin and the Application Team (the owner, 20 Nov 2026): the places two or more B2B partners offer, and which one to use.
    { id: 'applyThrough', page: 'apply-through', href: '/apply-through', label: 'Apply through', api: '/api/apply-through', hint: 'Which B2B partner each university is applied through, where more than one offers it' },
  ];
  const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // The same total as the list's own "N in the list": those set up, and on B2B Partners the names on the sheet not set up yet.
  const count = (x) => (Array.isArray(x) ? x.length : x && Array.isArray(x.partners) ? x.partners.length + (x.onSheet || []).length : x && typeof x.choosable === 'number' ? x.choosable : null);

  const bar = document.createElement('div');
  bar.className = 'pt-bar';
  bar.innerHTML = '<p class="pt-eyebrow">Partners</p>';
  const nav = document.createElement('nav');
  nav.className = 'p-tabs pt-switch';
  nav.setAttribute('aria-label', 'Partners');
  bar.append(nav);

  get('/api/partner-access').then((access) => {
    const open = TABS.filter((t) => access && access[t.id]);
    if (open.length < 2) return;
    for (const t of open) {
      const a = document.createElement('a');
      a.href = t.href;
      a.title = t.hint;
      if ((t.page || t.id) === here) a.setAttribute('aria-current', 'page');
      a.innerHTML = `<span>${t.label}</span><span class="pt-n" hidden></span>`;
      nav.append(a);
      get(t.api).then((d) => { const n = count(d); if (n === null) return; const b = a.querySelector('.pt-n'); b.textContent = n; b.hidden = false; });
    }
    main.prepend(bar);
  });
})();
