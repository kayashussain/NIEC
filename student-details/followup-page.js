// All Students for the Follow-up Team (the owner, 21 Nov 2026, design A2): one list of the current intake's inquiries and deferred
// students, and the students the team sent on or withdrew (view only). Each row says where the student stands (Never contacted,
// Follow-up due, Followed up ...), what was said last, the next follow-up date and the tag (INT, DM, COLD), with Note and No answer.
// Note opens one line under the row: what the student said and the next follow-up date (both needed), then Save note, Defer,
// Withdrawn (which asks why) or Cancel. The rules are the server's (portal-api.js, followList and followAction).
(function () {
  const { el, h, api } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  let data = null;
  let view = 'wait';
  let tag = '';
  let open = ''; // the student whose Note line is open
  let withdrawing = false;
  let draft = { text: '', next: '', reason: '' };

  const VIEWS = [
    ['wait', 'To follow up', (s) => ['new', 'due', 'tried'].includes(s.state)],
    ['ok', 'Followed up', (s) => s.state === 'ok'],
    ['defer', 'Deferred', (s) => s.state === 'defer'],
    ['sent', 'With Application Team', (s) => s.state === 'sent'],
    ['applying', 'Applying', (s) => s.state === 'applying'],
    ['out', 'Withdrawn', (s) => s.state === 'out'],
    ['all', 'All', () => true],
  ];
  // Never contacted first, then the longest waiting, and a student tried today at the bottom until tomorrow.
  const ORDER = { new: 0, due: 1, tried: 2, ok: 3, defer: 4, sent: 5, applying: 6, out: 7 };
  const dayMs = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const short = (iso) => new Date(dayMs(iso)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ago = (at) => {
    const d = new Date(at);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = Math.round((dayMs(data.today) - dayMs(local)) / 86400000);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
  };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const tagShort = (k) => ((data.tags || []).find((t) => t.key === k) || {}).short || '';

  async function load() {
    try { data = await api('/api/followup'); } catch (e) { $('list').replaceChildren(el('div', 'fu-empty', e.message)); return; }
    $('lead').textContent = `${data.intake ? `${/intake/i.test(data.intake) ? data.intake : `${data.intake} intake`} · ` : ''}click a name to open the student card with every note.`;
    draw();
  }

  function draw() {
    const list = data.students;
    $('views').replaceChildren(...VIEWS.map(([k, label, ok]) => {
      const b = h('button', { type: 'button', class: k === view ? 'on' : '', 'aria-pressed': String(k === view) });
      b.append(label, el('i', '', String(list.filter(ok).length)));
      b.addEventListener('click', () => { view = k; close(); draw(); });
      return b;
    }));
    const tagsBox = $('tags');
    tagsBox.replaceChildren(el('span', '', 'Show only'), ...(data.tags || []).map((t) => {
      const b = h('button', { type: 'button', class: 'fu-chip' + (tag === t.key ? ' on' : ''), 'aria-pressed': String(tag === t.key) });
      b.append(`${t.key} (${t.short})`, el('i', '', String(list.filter((s) => s.tag === t.key).length)));
      b.addEventListener('click', () => { tag = tag === t.key ? '' : t.key; close(); draw(); });
      return b;
    }));
    const q = $('find').value.trim().toLowerCase();
    const pick = VIEWS.find((v) => v[0] === view)[2];
    const shown = list.filter((s) => pick(s) && (!tag || s.tag === tag) && (!q || `${s.name} ${s.phone} ${s.words} ${s.remarks}`.toLowerCase().includes(q)))
      .sort((a, b) => ORDER[a.state] - ORDER[b.state] || String((a.next && a.next.date) || (a.last && a.last.at) || '').localeCompare(String((b.next && b.next.date) || (b.last && b.last.at) || '')) || a.no - b.no);
    const box = $('list');
    const head = el('div', 'fu-row head');
    ['No.', 'Student', 'Stage', 'Last contacted and what was said', 'Next follow-up', 'Tag', ''].forEach((t) => head.append(el('div', '', t)));
    if (!shown.length) {
      box.replaceChildren(head, el('div', 'fu-empty', q || tag ? 'No student matches.' : view === 'wait' ? 'Nobody to follow up right now.' : 'Nobody here right now.'));
      return;
    }
    box.replaceChildren(head, ...shown.map(rowOf));
  }

  function rowOf(s) {
    const item = el('div', 'fu-item');
    const r = el('div', 'fu-row');
    const who = el('div', 'fu-who');
    const name = h('button', { class: 'fu-name', type: 'button', title: 'Open the student card' }, s.name || 'Student with no name');
    name.addEventListener('click', () => window.CardDrawer.open(s.id, { onClose: () => load() }));
    who.append(name);
    if (s.phone) who.append(h('a', { class: 'fu-phone', href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, title: `Call ${s.name}` }, s.phone));
    if (s.remarks) { const sub = el('span', 'fu-sub', s.remarks); sub.title = s.remarks; who.append(sub); }
    if (s.from) who.append(el('span', 'fu-from', `Deferred from ${s.from}`));
    const stage = el('div'); stage.append(el('span', 'fu-stage' + (['sent', 'applying'].includes(s.state) ? ' app' : ''), s.stage || 'No stage'));
    const last = el('div', 'fu-last');
    const tries = s.tries ? `${s.tries} ${s.tries === 1 ? 'try' : 'tries'}` : '';
    let pill;
    if (s.state === 'ok') pill = ['ok', `Followed up · ${cap(ago(s.last.at))} · ${s.last.by}`];
    else if (s.state === 'new') pill = ['wait', s.from ? 'Back from last intake, not called yet' : tries ? `Never reached · ${tries}` : 'Never contacted'];
    else if (s.state === 'tried') pill = ['wait', `No answer today · ${tries}`];
    else if (s.state === 'due') pill = ['wait', tries ? `No answer · ${tries}` : s.next ? `Due ${s.next.date >= data.today ? 'today' : `since ${short(s.next.date)}`}` : 'No date set'];
    else pill = ['view', { defer: 'Deferred, waits for the next intake', sent: 'With Application Team', applying: 'Applying', out: 'Withdrawn' }[s.state]];
    const p = el('span', `fu-pill ${pill[0]}`, pill[1]); p.title = pill[1];
    last.append(p);
    if (s.words) { const w = el('div', 'fu-words', s.words); w.title = s.words; last.append(w); }
    const next = el('div', 'fu-next');
    if (s.state === 'defer') next.append(el('span', '', 'Next intake'));
    else if (['sent', 'applying', 'out'].includes(s.state)) next.append(el('span', '', 'None'));
    else if (s.next) next.append(el('b', s.next.date <= data.today || s.state === 'due' ? 'due' : '', short(s.next.date)));
    else next.append(el('span', '', 'Not set'));
    const tg = el('div');
    if (s.canTag) {
      const g = el('div', 'fu-tg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', `Tag of ${s.name}`);
      (data.tags || []).forEach((t) => {
        const b = h('button', { type: 'button', class: s.tag === t.key ? 'on' : '', 'aria-pressed': String(s.tag === t.key), title: t.key, 'aria-label': t.key }, t.short);
        b.addEventListener('click', async () => {
          const to = s.tag === t.key ? '' : t.key;
          g.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          try { await api(`/api/followup/${encodeURIComponent(s.id)}`, { action: 'tag', tag: to }); s.tag = to; } catch (e) { say(e.message, true); }
          draw();
        });
        g.append(b);
      });
      tg.append(g);
    } else if (s.tag) { const c = el('span', 'fu-code', tagShort(s.tag)); c.title = s.tag; tg.append(c); }
    const act = el('div', 'fu-act');
    if (s.canNote) {
      const nb = h('button', { class: 'btn' + (open === s.id ? ' on' : ''), type: 'button', 'aria-expanded': String(open === s.id) }, 'Note');
      nb.addEventListener('click', () => { if (open === s.id) close(); else { open = s.id; withdrawing = false; draft = { text: '', next: '', reason: '' }; } draw(); if (open) setTimeout(() => { const t = document.querySelector('.fu-strip textarea'); if (t) t.focus(); }, 0); });
      act.append(nb);
      if (['new', 'due', 'ok'].includes(s.state)) {
        const na = h('button', { class: 'btn', type: 'button', title: 'Writes "Called, no answer" on the card. The student stays orange and comes back tomorrow.' }, 'No answer');
        na.addEventListener('click', async () => {
          na.disabled = true; na.textContent = 'Saving...';
          try { await api(`/api/followup/${encodeURIComponent(s.id)}`, { action: 'try' }); say(`${s.name}: no answer written on the card`); close(); await load(); } catch (e) { say(e.message, true); na.disabled = false; na.textContent = 'No answer'; }
        });
        act.append(na);
      }
    } else act.append(el('span', 'fu-view', 'View only'));
    r.append(el('div', 'fu-num', String(s.no)), who, stage, last, next, tg, act);
    item.append(r);
    if (open === s.id && s.canNote) item.append(strip(s));
    return item;
  }

  function close() { open = ''; withdrawing = false; draft = { text: '', next: '', reason: '' }; }

  // The Note line under a row.
  function strip(s) {
    const box = el('div', 'fu-strip');
    const grid = el('div', 'fu-strip-grid');
    const reqMark = () => { const m = el('b', 'fu-req', ' *'); m.setAttribute('aria-hidden', 'true'); return m; };
    const l1 = el('label'); const t1 = el('span', '', `What did ${s.name} say?`); t1.append(reqMark());
    const area = h('textarea', { rows: '1', maxlength: '2000', placeholder: 'Their answer, what was agreed', 'aria-required': 'true' });
    area.value = draft.text;
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(area.scrollHeight + 2, 220)}px`; };
    area.addEventListener('input', () => { draft.text = area.value; area.classList.remove('bad'); grow(); });
    l1.append(t1, area);
    const only = s.state === 'out'; // a withdrawn student: a note only
    const err = el('div', 'fu-err'); err.hidden = true;
    const fail = (msg, ...fields) => { err.textContent = msg; err.hidden = false; const hint = box.querySelector('.fu-hint'); if (hint) hint.hidden = true; fields.forEach((f) => { f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad'); }); };
    const btns = el('div', 'fu-btns');
    const send = async (btn, body, done) => {
      const was = btn.textContent;
      btns.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.textContent = 'Saving...';
      try { await api(`/api/followup/${encodeURIComponent(s.id)}`, body); say(done); close(); await load(); } catch (e) {
        btns.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        btn.textContent = was;
        fail(e.message, ...(e.body && e.body.field === 'text' ? [area] : e.body && e.body.field === 'next' ? [dateIn] : e.body && e.body.field === 'reason' ? [reason] : []));
      }
    };
    let dateIn = null; let reason = null;
    if (withdrawing) {
      const l2 = el('label'); const t2 = el('span', '', 'Why is the student not going on?'); t2.append(reqMark());
      reason = h('select', { 'aria-required': 'true' });
      reason.append(h('option', { value: '' }, 'Choose a reason'), ...(data.reasons || []).map((x) => h('option', { value: x }, x)));
      reason.value = draft.reason;
      reason.addEventListener('change', () => { draft.reason = reason.value; reason.classList.remove('bad'); });
      l2.append(t2, reason);
      const ok = h('button', { class: 'btn red', type: 'button' }, 'Confirm Withdrawn');
      ok.addEventListener('click', () => {
        const miss = [!area.value.trim() && area, !reason.value && reason].filter(Boolean);
        if (miss.length) return fail(miss.length === 2 ? 'Write what the student said and choose a reason.' : miss[0] === area ? 'Write what the student said.' : 'Choose a reason.', ...miss);
        send(ok, { action: 'withdraw', text: area.value, reason: reason.value }, `${s.name} moved to Withdrawn`);
      });
      const back = h('button', { class: 'btn', type: 'button' }, 'Back');
      back.addEventListener('click', () => { withdrawing = false; draw(); });
      btns.append(ok, back);
      grid.append(l1, l2, btns);
    } else {
      const l2 = el('label');
      if (!only) {
        const t2 = el('span', '', 'Next follow-up'); t2.append(reqMark());
        const min = new Date(dayMs(data.today) + 86400000).toISOString().slice(0, 10);
        dateIn = h('input', { type: 'date', min, 'aria-required': 'true' });
        dateIn.value = draft.next;
        dateIn.addEventListener('input', () => { draft.next = dateIn.value; dateIn.classList.remove('bad'); });
        l2.append(t2, dateIn);
      }
      const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save note');
      save.addEventListener('click', () => {
        const miss = [!area.value.trim() && area, !only && !dateIn.value && dateIn].filter(Boolean);
        if (miss.length) return fail(miss.length === 2 ? 'Write what the student said and choose the next follow-up date.' : miss[0] === area ? 'Write what the student said.' : 'Choose the next follow-up date.', ...miss);
        send(save, only ? { action: 'note-only', text: area.value } : { action: 'note', text: area.value, next: dateIn.value }, `Note saved on ${s.name}'s card`);
      });
      btns.append(save);
      if (!only && s.state !== 'defer') {
        const def = h('button', { class: 'btn', type: 'button', title: 'Saves the note and moves the student to Defer' }, 'Defer');
        def.addEventListener('click', () => {
          if (!area.value.trim()) return fail('Write what the student said.', area);
          send(def, { action: 'defer', text: area.value }, `${s.name} moved to Defer`);
        });
        btns.append(def);
      }
      if (!only) {
        const wd = h('button', { class: 'btn', type: 'button' }, 'Withdrawn');
        wd.addEventListener('click', () => { draft.text = area.value; withdrawing = true; draw(); setTimeout(() => { const sel = document.querySelector('.fu-strip select'); if (sel) sel.focus(); }, 0); });
        btns.append(wd);
      }
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => { close(); draw(); });
      btns.append(cancel);
      grid.append(l1, l2, btns);
    }
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); draw(); } });
    box.append(grid, err, el('span', 'fu-hint', withdrawing ? 'The stage moves to Withdrawn and the card says why.' : only ? 'A note on the card.' : 'Must be filled: what the student said and the next follow-up date. Defer and Withdrawn change the stage by themselves.'));
    setTimeout(grow, 0);
    return box;
  }

  $('find').addEventListener('input', () => { close(); draw(); });
  $('add').addEventListener('click', async () => {
    const me = await fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const made = await window.NewStudent.open({ me, defaultStage: 'Inquiry' });
    if (made) await load();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) { close(); draw(); } });
  // Your email and signature (the student card's Email button sends from them): reached from the card's "set up your email" link.
  function setup() {
    if (location.hash !== '#setup' || !window.SenderSetup) return;
    window.Portal.dialog('Your email and signature', (body, done) => {
      const box = el('div'); body.append(box);
      window.SenderSetup.mount(box, { open: true, only: ['email', 'signature'] }).catch((e) => box.replaceChildren(el('div', 'p-notice bad', e.message)));
      const foot = el('div', 'p-form-actions'); foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done() }, 'Done'));
      body.append(foot);
    }).then(() => { history.replaceState(null, '', '/students'); });
  }
  load();
  setup();
})();
