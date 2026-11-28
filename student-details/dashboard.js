// The Dashboard's Overview (dashboard.html), written from zero: the numbers a head of recruitment looks at first, as cards that say
// what the number is and how it compares with the earlier intake at the same point. Everything is worked out on the server
// (/api/dashboard and /api/insights, from the sheet, the student cards and the records): this page only draws it.
// Names and labels come from student records, so they are only ever put in with textContent.
(function () {
  const { el, api, number } = window.Portal;
  const SVG = 'http://www.w3.org/2000/svg';
  const root = document.getElementById('panel-overview');
  const picker = document.getElementById('intake');
  const updated = document.getElementById('updated');
  const REFRESH_MS = 45000;
  const COLORS = { inquiry: 'var(--s5)', applied: 'var(--s1)', offer: 'var(--s4)', paid: 'var(--s2)', visa: 'var(--s3)' };
  let selected = (() => { try { return decodeURIComponent(location.hash.slice(1)).replace(/^tab=.*/, ''); } catch (e) { return ''; } })();
  let dash = null;
  let ins = null;
  let apps = null; // where the applicants came from (/api/applicants)
  let trends = null; // inquiries and applications over time, and where the students live (/api/trends)
  let isAdmin = false; // only Admin sets the visa target
  let seq = 0;
  let timer = null;
  let allUnis = false; // "Show all" under Universities stays pressed when the figures are fetched again
  let mapOpen = false; // the map stays open or folded as it was left

  // ---- small helpers ----
  const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const num = (v) => (v === null || v === undefined ? 'n/a' : number(v));
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);

  // The hover readout.
  const tip = document.getElementById('tip');
  function showTip(x, y, title, rows) {
    tip.replaceChildren();
    if (title) tip.append(el('div', 'tip-title', title));
    rows.forEach((r) => {
      const row = el('div', 'tip-row');
      if (r.color) { const key = el('span', 'tip-key'); key.style.setProperty('--c', r.color); row.append(key); }
      row.append(el('span', 'tip-name', r.name), el('span', 'tip-val', r.value));
      tip.append(row);
    });
    tip.hidden = false;
    const P = window.sr360Pos; // page pixels, whatever the Text size
    tip.style.left = Math.max(8, Math.min(P.point(x), P.width() - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(P.point(y), P.height() - tip.offsetHeight - 8)) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  function hover(node, content) {
    node.addEventListener('pointermove', (e) => { const c = content(); showTip(e.clientX + 14, e.clientY + 14, c.title, c.rows); });
    node.addEventListener('pointerleave', hideTip);
  }

  const card = (cls, title, sub) => {
    const c = el('section', `ov-card ${cls || ''}`);
    if (title) { const head = el('header', 'ov-card-head'); const t = el('div'); t.append(el('h2', '', title)); if (sub) t.append(el('p', '', sub)); head.append(t); c.append(head); c.head = head; }
    return c;
  };

  // ---- the five figures, each against the compared intake as it stood at the same point ----
  function versus(now, key) {
    const p = ins.samePoint;
    if (!p) return null;
    const was = p.values[key];
    const line = el('span', 'ov-vs');
    if (was === null || was === undefined) { line.append(el('span', 'ov-vs-text', `No fair comparison: dates are missing in ${p.label}`)); return line; }
    const by = now - was;
    line.append(el('span', `ov-vs-chip${by > 0 ? ' up' : by < 0 ? ' down' : ''}`, by ? `${by > 0 ? '▲' : '▼'} ${num(Math.abs(by))}` : 'Same'),
      el('span', 'ov-vs-text', `${p.label}: ${num(was)}${p.running ? ' by then' : ''}`));
    return line;
  }
  // The day the earlier intake is read on, in plain words under the figures.
  function versusNote() {
    const p = ins.samePoint;
    if (!p) return el('p', 'ov-vs-note', ins.comparable ? 'No comparison: this intake has no teaching start to count back from.' : 'No earlier intake to compare with.');
    if (!p.running) return el('p', 'ov-vs-note', `Compared with the final figures of ${p.label}.`);
    return el('p', 'ov-vs-note', `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} before teaching starts. ${p.label} is shown as it stood the same number of days before its own start, on ${window.Portal.day(p.day)}.`);
  }

  function kpis() {
    const s = ins.summary;
    const cards = [
      { label: 'Students', key: 'students', value: s.students, color: 'var(--s1)', hint: `${num(s.active)} still active` },
      // Applied is counted one way only, as the funnel and the % below it count it (a submission day, or Mock Stage or later), so the
      // figure, its share and the list behind it always agree.
      { label: 'Applied', key: 'applied', value: s.applied, color: COLORS.applied, hint: `${pct(s.toApplication)} of students` },
      { label: 'Offers', key: 'offers', value: s.offers, color: COLORS.offer, hint: `${pct(s.toOffer)} of applicants` },
      { label: 'Paid', key: 'paid', value: s.paid, color: COLORS.paid, hint: `${pct(s.toPayment)} of offers` },
      { label: 'Visas', key: 'visas', value: s.visas, color: COLORS.visa, hint: ins.target && ins.target.visas ? `target ${ins.target.visas}` : `${pct(s.visaSuccess)} of decisions` },
    ];
    // Who is behind each figure, by the same rules as the figure.
    const who = {
      Students: () => true, Applied: (x) => x.ap, Offers: (x) => x.o, Paid: (x) => x.p, Visas: (x) => x.v,
    };
    const row = el('div', 'ov-kpis');
    cards.forEach((c) => {
      const list = (ins.people || []).filter(who[c.label]);
      const clickable = ins.people && list.length > 0;
      const k = el(clickable ? 'button' : 'article', 'ov-kpi' + (clickable ? ' is-click' : ''));
      if (clickable) {
        k.type = 'button';
        k.title = `See the ${list.length} student${list.length === 1 ? '' : 's'}`;
        k.addEventListener('click', () => peopleDialog(`${c.label}: ${list.length} student${list.length === 1 ? '' : 's'}`, list));
      }
      k.style.setProperty('--accent', c.color);
      k.append(el('span', 'ov-kpi-label', c.label), el('b', 'ov-kpi-value', num(c.value)), el('span', 'ov-kpi-hint', c.hint));
      const v = versus(c.value, c.key);
      if (v) k.append(v);
      row.append(k);
    });
    const box = el('div', 'ov-figures');
    box.append(row, versusNote());
    if (s.low) box.append(el('p', 'ov-vs-note', 'Fewer than 10 students: rates are only a hint.'));
    return box;
  }

  // The students behind a figure, in a window: a search box, then each student (name, stage, university); a press opens the card
  // over the Dashboard with ‹ › through the list (card-drawer.js).
  function peopleDialog(title, list) {
    window.Portal.dialog(title, (body, close) => {
      const q = el('input', 'ov-people-search');
      q.type = 'search';
      q.placeholder = 'Search by name, stage or university';
      q.setAttribute('aria-label', 'Search the students');
      const box = el('div', 'ov-people');
      const sorted = list.slice().sort((x, y) => x.n.localeCompare(y.n));
      const draw = () => {
        const w = q.value.trim().toLowerCase();
        const shown = w ? sorted.filter((x) => `${x.n} ${x.s} ${x.u}`.toLowerCase().includes(w)) : sorted;
        box.replaceChildren(...(shown.length ? shown.map((x) => {
          const a = el('a', 'ov-person');
          a.href = '/student?id=' + encodeURIComponent(x.id);
          const t = el('span', 'ov-person-text');
          t.append(el('b', '', x.n || 'No name'), el('small', '', x.u || 'University not recorded'));
          a.append(el('span', 'p-avatar sm', window.Portal.initials(x.n || '?')), t, el('span', 'ov-person-stage', x.s || 'No stage'));
          a.addEventListener('click', (e) => {
            if (!window.CardDrawer || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            // The list makes way for the card, and comes back when the card is closed.
            close();
            window.CardDrawer.open(x.id, { list: shown.map((y) => y.id), onClose: () => setTimeout(() => peopleDialog(title, list), 60) }); // after the Escape that closed the card has finished
          });
          return a;
        }) : [el('div', 'p-empty', 'No student matches.')]));
      };
      q.addEventListener('input', draw);
      body.append(q, box);
      draw();
      setTimeout(() => q.focus(), 30);
    }, { wide: true });
  }

  // ---- the visa target as a ring ----
  function targetCard() {
    const t = ins.target;
    const c = card('ov-target', 'Visa target', ins.scope);
    // The target is set here (the Intake plan page is gone): Admin types the number of visas aimed for and saves.
    const setter = () => {
      const row = el('div', 'ov-target-set');
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '9999'; input.placeholder = 'Visas aimed for'; input.value = t && t.visas ? t.visas : '';
      const save = el('button', 'btn btn-sm', t && t.visas ? 'Change' : 'Set the target'); save.type = 'button';
      save.addEventListener('click', async () => { try { await api('/api/planning/targets/' + ins.selected, { visas: input.value, byDate: (t && t.byDate) || '', startDate: (t && !t.startGuessed && t.startDate) || '', note: (t && t.note) || '' }); window.NiecUI.toast('Target saved', { type: 'success' }); load(); } catch (e) { window.NiecUI.toast(e.message, { type: 'error' }); } });
      row.append(input, save);
      return row;
    };
    if (!t || !t.visas) {
      c.append(el('p', 'ov-empty', 'No visa target is set for this intake yet.'));
      if (isAdmin) c.append(setter());
      return c;
    }
    c.setter = setter;
    const share = Math.min(1, t.visasNow / t.visas);
    const forecast = Math.min(1, (t.expectedTotal || t.visasNow) / t.visas);
    const R = 62; const C = 2 * Math.PI * R;
    const ring = svg('svg', { viewBox: '0 0 160 160', class: 'ov-ring', role: 'img', 'aria-label': `${t.visasNow} of ${t.visas} visas` });
    ring.append(svg('circle', { cx: 80, cy: 80, r: R, fill: 'none', stroke: 'var(--ov-track)', 'stroke-width': 14 }),
      svg('circle', { cx: 80, cy: 80, r: R, fill: 'none', stroke: 'var(--s3)', 'stroke-opacity': '.28', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-dasharray': `${C * forecast} ${C}`, transform: 'rotate(-90 80 80)' }),
      svg('circle', { cx: 80, cy: 80, r: R, fill: 'none', stroke: 'var(--s3)', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-dasharray': `${Math.max(0.5, C * share)} ${C}`, transform: 'rotate(-90 80 80)' }));
    const mid = svg('text', { x: 80, y: 82, 'text-anchor': 'middle', class: 'ov-ring-num' }); mid.textContent = String(t.visasNow);
    const sub = svg('text', { x: 80, y: 104, 'text-anchor': 'middle', class: 'ov-ring-sub' }); sub.textContent = `of ${t.visas} visas`;
    ring.append(mid, sub);
    const T = window.DashText;
    const stat = T.sayStatus(t);
    const side = el('div', 'ov-target-side');
    side.append(el('span', `p-pill p-pill-${stat[1]}`, stat[0]), el('p', 'ov-target-text', T.targetSentence(t)));
    if (isAdmin) side.append(setter());
    const wrap = el('div', 'ov-target-body'); wrap.append(ring, side);
    c.append(wrap);
    return c;
  }


  // ---- the funnel ----
  function funnelCard() {
    const c = card('ov-funnel', 'The student journey', 'How many reached each step');
    const max = Math.max(1, ...ins.funnel.map((f) => f.count));
    const list = el('div', 'ov-funnel-list');
    ins.funnel.forEach((f, i) => {
      const row = el('div', 'ov-funnel-row');
      const bar = el('span', 'ov-funnel-track'); const fill = el('i', 'ov-funnel-fill');
      fill.style.width = Math.max(2, (f.count / max) * 100) + '%';
      fill.style.setProperty('--shade', String(0.95 - i * 0.09));
      bar.append(fill);
      row.append(el('span', 'ov-funnel-label', f.label), bar, el('b', 'ov-funnel-count', num(f.count)), el('span', `ov-funnel-conv${f.fromPrevious === null ? ' none' : ''}`, f.fromPrevious === null ? '' : `${f.fromPrevious}%`));
      hover(row, () => ({ title: f.label, rows: [{ name: 'Students', value: num(f.count) }, { name: 'Of all students', value: pct(f.ofAll) }, ...(f.fromPrevious === null ? [] : [{ name: 'Of the step before', value: pct(f.fromPrevious) }])] }));
      list.append(row);
    });
    c.append(list);
    return c;
  }



  // ---- universities: each with its logo (from its page in Universities), the first five, then all ----
  const UNIS_FIRST = 5;
  const media = (u) => (/^https:\/\//.test(u) ? `/api/media?u=${encodeURIComponent(u)}` : u);
  function uniLogo(g) {
    const m = el('span', 'ov-uni-logo');
    const letters = () => { m.classList.remove('has-logo'); m.replaceChildren(); m.textContent = window.Portal.initials(g.label); };
    if (!g.logo) { letters(); return m; }
    m.classList.add('has-logo');
    const i = el('img'); i.src = media(g.logo); i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer';
    i.addEventListener('error', letters);
    m.append(i);
    return m;
  }
  function universitiesCard(list) {
    const c = card('ov-board ov-unis', 'Universities', list.length ? `Where the students are placed: ${list.length} ${list.length === 1 ? 'university' : 'universities'}` : 'Where the students are placed');
    if (!list.length) { c.append(el('p', 'ov-empty', 'No university recorded yet.')); return c; }
    const max = Math.max(1, ...list.map((g) => g.students));
    const t = el('div', 'ov-board-list');
    const render = () => {
      const head = el('div', 'ov-board-row head');
      ['University', 'Students', 'Offers', 'Paid', 'Visas'].forEach((h, i) => head.append(el('span', i ? 'num' : '', h)));
      t.replaceChildren(head, ...(allUnis ? list : list.slice(0, UNIS_FIRST)).map((g) => {
        const row = el('div', 'ov-board-row');
        const words = el('span', 'ov-board-name'); words.append(el('b', '', g.label));
        const track = el('i', 'ov-board-bar'); track.style.width = Math.max(3, (g.students / max) * 100) + '%'; words.append(track);
        const who = el('span', 'ov-uni'); who.append(uniLogo(g), words);
        row.append(who, el('span', 'num', num(g.students)), el('span', 'num', num(g.offers)), el('span', 'num', num(g.paid)), el('span', 'num strong', num(g.visas)));
        hover(row, () => ({ title: g.label, rows: [{ name: 'Applied', value: num(g.applied) }, { name: 'Offer rate', value: pct(g.toOffer) }, { name: 'Payment rate', value: pct(g.toPayment) }, { name: 'Visa success', value: pct(g.visaSuccess) }] }));
        return row;
      }));
    };
    render();
    c.append(t);
    if (list.length > UNIS_FIRST) {
      const label = () => (allUnis ? 'Show fewer' : `Show all ${list.length}`);
      const more = el('button', 'btn btn-sm ov-more', label()); more.type = 'button';
      more.setAttribute('aria-expanded', String(allUnis));
      more.addEventListener('click', () => { allUnis = !allUnis; hideTip(); render(); more.textContent = label(); more.setAttribute('aria-expanded', String(allUnis)); });
      c.append(more);
    }
    return c;
  }




  // ---- drill-down charts (like a BI report): a donut of the groups; a click on a slice shows its parts as bars; a click on a bar
  // shows the students behind it (a click on a name opens the card). A path at the top goes back up. ----
  // 🔴 CSS CHANGED (2026-11-14): the colours of the source donut | from: navy, bronze and muted blues | to: Apple's system colours (blue, orange, green, indigo, teal, pink, purple, yellow, grey, mint)
  /* 🔴 CSS CHANGED (2026-11-21): the colours of the source donut | from: ten bright system colours | to: calm, as Apple: blue, near-black and greys, with two lighter blues so neighbouring slices still part */
  /* 🔴 CSS CHANGED (2026-11-21): the colours of the source donut | from: blue, black and greys (slices hard to tell apart) | to: the ten Student Recruit 360 chart colours (CLAUDE.md), each slice its own colour */
  const PALETTE = ['#0071e3', '#d9650b', '#1e8e4a', '#6e47d1', '#0b8a95', '#c2255c', '#b7791f', '#52606d', '#4aa3f0', '#6b8e23'];
  const share = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  function donut(groups, onPick) {
    const total = groups.reduce((n, g) => n + g.students, 0) || 1;
    const R = 70; const C = 2 * Math.PI * R; let at = 0;
    const s = svg('svg', { viewBox: '0 0 180 180', class: 'dd-donut', role: 'img', 'aria-label': 'Share of students by group' });
    groups.forEach((g, k) => {
      const len = (g.students / total) * C;
      const arc = svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: PALETTE[k % PALETTE.length], 'stroke-width': 26, 'stroke-dasharray': `${Math.max(0, len - 1.5)} ${C}`, 'stroke-dashoffset': String(-at), transform: 'rotate(-90 90 90)', class: 'dd-slice', tabindex: '0' });
      arc.addEventListener('click', () => onPick(g));
      arc.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(g); });
      hover(arc, () => ({ title: g.label, rows: [{ name: 'Students', value: num(g.students) }, { name: 'Applied', value: num(g.applicants) }, { name: 'Visas', value: num(g.visas) }, { name: 'Share', value: share(g.students, total) + '%' }] }));
      s.append(arc); at += len;
    });
    const mid = svg('text', { x: 90, y: 90, 'text-anchor': 'middle', class: 'dd-donut-num' }); mid.textContent = num(total);
    const sub = svg('text', { x: 90, y: 110, 'text-anchor': 'middle', class: 'dd-donut-sub' }); sub.textContent = 'students';
    s.append(mid, sub);
    const legend = el('div', 'dd-legend');
    groups.forEach((g, k) => {
      const b = el('button', 'dd-legend-row'); b.type = 'button';
      const dot = el('i', 'dd-dot'); dot.style.background = PALETTE[k % PALETTE.length];
      b.append(dot, el('span', 'dd-legend-name', g.label), el('b', '', num(g.students)), el('small', '', `${share(g.students, total)}%`), el('span', 'dd-go', '›'));
      b.addEventListener('click', () => onPick(g));
      legend.append(b);
    });
    const wrap = el('div', 'dd-donut-wrap'); wrap.append(s, legend);
    return wrap;
  }
  function bars(rows, onPick) {
    const max = Math.max(1, ...rows.map((g) => g.students));
    const box = el('div', 'dd-bars');
    const head = el('div', 'dd-bar-row head'); head.append(el('span', '', ''), el('span', 'num', 'Students'), el('span', 'num', 'Applied'), el('span', 'num', 'Visas'));
    box.append(head);
    rows.forEach((g) => {
      const b = el('button', 'dd-bar-row'); b.type = 'button';
      const name = el('span', 'dd-bar-name'); name.append(el('b', '', g.label));
      if (g.tag) name.append(el('small', '', g.tag));
      const track = el('span', 'dd-track'); const fill = el('i'); fill.style.width = Math.max(2, (g.students / max) * 100) + '%';
      const vis = el('i', 'visa'); vis.style.width = Math.max(0, (g.visas / max) * 100) + '%'; track.append(fill, vis); name.append(track);
      b.append(name, el('span', 'num', num(g.students)), el('span', 'num', num(g.applicants)), el('span', 'num strong', num(g.visas)));
      b.addEventListener('click', () => onPick(g));
      box.append(b);
    });
    box.append(el('p', 'dd-key', 'Light: students. Dark: visas.'));
    return box;
  }
  function people(list) {
    if (!list.length) return el('p', 'ov-empty', 'No students here.');
    const box = el('div', 'dd-people');
    list.forEach((p) => {
      const a = el('a', 'dd-person'); a.href = '/student?id=' + encodeURIComponent(p.id);
      a.addEventListener('click', (e) => { if (window.CardDrawer) { e.preventDefault(); window.CardDrawer.open(p.id); } });
      a.append(el('b', '', p.name), el('span', '', p.university || ''), window.Portal.stagePill(p.stage));
      box.append(a);
    });
    return box;
  }
  // A card with a path (All › Social Media › TikTok) and the level shown under it.
  function drillCard(cls, title, sub, levels) {
    const c = card(cls, title, sub);
    const path = el('nav', 'dd-path'); path.setAttribute('aria-label', `Where you are in ${title}`); // each card's own name: two cards never share one label (accessibility)
    const body = el('div', 'dd-body');
    c.append(path, body);
    const show = (stack) => {
      path.replaceChildren(...stack.flatMap((st, k) => {
        const crumb = k === stack.length - 1 ? el('b', '', st.label) : (() => { const b = el('button', 'dd-crumb', st.label); b.type = 'button'; b.addEventListener('click', () => show(stack.slice(0, k + 1))); return b; })();
        return k ? [el('span', 'dd-sep', '›'), crumb] : [crumb];
      }));
      body.replaceChildren(stack[stack.length - 1].draw((next) => show([...stack, next])));
    };
    show([levels]);
    return c;
  }

  // How students found us: by Student Source (the way in: social media, a visit, an event ...), or by who received the application.
  // Not a place: where they live is the map's.
  function originCard() {
    const a = apps || { sources: [], list: [] };
    const tabs = el('div', 'dd-switch');
    let mode = 'source';
    const holder = el('div');
    const render = () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      if (mode === 'source') {
        holder.replaceChildren(drillCard('dd-card', '', '', { label: 'All sources', draw: (go) => (a.sources.length ? donut(a.sources, (g) => go({ label: g.label, draw: (go2) => (g.details.length ? bars(g.details, (d) => go2({ label: d.label, draw: () => people(d.people) })) : people(g.people)) })) : el('p', 'ov-empty', 'No student has a source yet.')) }));
      } else {
        const list = a.list.map((g) => ({ ...g, students: g.applicants, tag: g.kind === 'office' ? '' : g.kind === 'branch' ? 'Branch' : 'Agent' }));
        holder.replaceChildren(drillCard('dd-card', '', '', { label: 'Every applicant', draw: (go) => (list.length ? bars(list, (g) => go({ label: g.label, draw: () => people(g.people) })) : el('p', 'ov-empty', 'No applicant has a Receiving Partner yet.')) }));
      }
    };
    [['source', 'By source'], ['received', 'By who received']].forEach(([m, t]) => { const b = el('button', '', t); b.type = 'button'; b.dataset.m = m; b.addEventListener('click', () => { mode = m; render(); }); tabs.append(b); });
    const c = card('ov-origin', 'How students found us', 'By student source. Click a slice for the detail.');
    c.head.append(tabs);
    render();
    c.append(holder);
    return c;
  }
  // Partners: each partner university and B2B partner; a click shows its universities, then the students.
  function partnersCard() {
    const list = ((apps && apps.partners) || []).map((g) => ({ ...g, tag: g.kind === 'university' ? 'Partner university' : 'B2B partner' }));
    return drillCard('ov-partners', 'Partners', 'Where applications went. Click to see more', { label: 'All partners', draw: (go) => (list.length ? bars(list, (g) => go({ label: g.label, draw: (go2) => (g.unis.length ? bars(g.unis, (u) => go2({ label: u.label, draw: () => people(u.people) })) : people(g.people)) })) : el('p', 'ov-empty', 'No student has a University Partner yet.')) });
  }

  // ---- the page: only what the head of the consultancy needs ----
  function draw() {
    if (!ins || !dash || !window.DashText) return;
    const page = el('div', 'ov');
    page.append(kpis());
    // The order the owner agreed (27 Nov 2026), what is acted on first: the five figures; the student journey and the visa
    // target; ups and downs over time; how students found us and the partners; universities; growth by intake; the map, folded.
    const T = trends && window.DashboardTrends;
    const row = (cls, ...cards) => { const r = el('div', cls); r.append(...cards); page.append(r); };
    row('ov-row ov-row-2', funnelCard(), targetCard());
    if (T) row('ov-row', T.overTime(trends));
    row('ov-row ov-row-2', originCard(), partnersCard());
    // Universities: only those recorded on the students (a blank University Name is not a row).
    row('ov-row', universitiesCard((ins.universities.list || []).filter((g) => g.label && !/not recorded/i.test(g.label))));
    if (T) row('ov-row', T.growth(trends, new Set((ins.compare || []).filter((x) => !x.over).map((x) => x.id))));
    if (T) row('ov-row', T.map(trends, mapOpen, (open) => { mapOpen = open; }));
    root.replaceChildren(page);
  }

  async function load() {
    const my = ++seq;
    clearTimeout(timer);
    try {
      const [d, i] = await Promise.all([api('/api/dashboard?intake=' + encodeURIComponent(selected)), api('/api/insights?intake=' + encodeURIComponent(selected))]);
      if (my !== seq) return;
      dash = d; ins = i; selected = i.selected || d.selected;
      // A newer load (another intake chosen meanwhile) wins: an older one stops after each answer.
      let a = null; try { a = await api('/api/applicants?intake=' + encodeURIComponent(selected)); } catch (e) { /* none */ }
      if (my !== seq) return;
      let tr = null; try { tr = await api('/api/trends?intake=' + encodeURIComponent(selected)); } catch (e) { /* none */ }
      if (my !== seq) return;
      let adm = false; try { adm = (await api('/api/me')).role === 'admin'; } catch (e) { /* not Admin */ }
      if (my !== seq) return;
      apps = a; trends = tr; isAdmin = adm;
      picker.replaceChildren(...i.intakes.map((x) => { const o = el('option', '', x.name); o.value = x.id; return o; }));
      picker.value = selected;
      updated.textContent = `As of ${window.Portal.day(ins.today)}.`;
      document.getElementById('page').classList.remove('first-load');
      draw();
    } catch (e) {
      if (my === seq) root.replaceChildren(el('div', 'p-notice bad', e.message));
    }
    if (my !== seq) return;
    timer = setTimeout(refresh, REFRESH_MS);
  }
  // Every 45 seconds the figures are fetched again, but never while someone is typing in the panel (the visa target), and a
  // hidden tab waits for the next turn instead of stopping for good.
  function refresh() {
    if (document.hidden || root.hidden || (document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'))) { timer = setTimeout(refresh, REFRESH_MS); return; }
    load();
  }
  picker.addEventListener('change', () => { selected = picker.value; history.replaceState(null, '', location.pathname); load(); });
  window.DashboardOverview = { load };
  load(); // an old link to another tab opens the overview too
})();
