// Events and marketing: what was run to find students, where it ran, when, at what cost, and the students and visas it brought.
// Admin adds and changes them; the Manager reads. The list Admin uploads for an event (Excel or CSV) is the truth of who came from
// it: new students go into All Students at Inquiry tagged with it, students already on the sheet are found (phone or email) and
// tagged, and every line is shown for review before anything is saved. An event opens as its own view with its students, so the
// team can work through them (open the card, call, write the note).
(function () {
  const { el, h, api, field, number, dialog, day } = window.Portal;
  const $ = (id) => document.getElementById(id);
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  const rupees = (n) => (n || n === 0 ? 'Rs ' + Number(n).toLocaleString('en-IN') : '');
  let data = null;
  let show = 'all';
  let open = null; // the event open in its own view
  let find = ''; // the words typed in the search box of the list
  // The intake shown (the owner, 17 Nov 2026: Events and marketing intake by intake, All as a choice): the id of an intake tab, or
  // 'all'. It opens on the intake chosen last on this computer, else the current intake.
  const INTAKE_KEY = 'isrEventsIntake';
  let intake = '';
  try { intake = localStorage.getItem(INTAKE_KEY) || ''; } catch (e) { /* the current intake, as usual */ }
  const intakeName = (id) => ((data && data.intakes) || []).find((x) => x.id === id)?.name || '';
  // The intake picker, filled from the server's list: each intake (the current one first) and All intakes last.
  function picker() {
    const sel = $('intake');
    const ids = (data.intakes || []).map((x) => x.id);
    if (intake !== 'all' && !ids.includes(intake)) intake = data.currentIntake && ids.includes(data.currentIntake) ? data.currentIntake : (ids[0] || 'all');
    sel.replaceChildren(...(data.intakes || []).map((x) => h('option', { value: x.id }, x.name)), h('option', { value: 'all' }, 'All intakes'));
    sel.value = intake;
  }

  // "5 Nov to 20 Nov 2026" when both days are in the same year, so the dates stay short.
  const ran = (a) => {
    if (!a.endDate || a.endDate === a.date) return day(a.date);
    const from = day(a.date);
    return a.date.slice(0, 4) === a.endDate.slice(0, 4) ? `${from.replace(/\s\d{4}$/, '')} to ${day(a.endDate)}` : `${from} to ${day(a.endDate)}`;
  };
  // A moment as its day here, written like every other date ("13 Sep 2026").
  const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : day(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); };
  // A cost paid in dollars or pounds, as typed and at what rate it was turned into rupees: "$500 at Rs 135.20 a dollar".
  const SIGN = { USD: '$', GBP: '\u00a3' };
  const UNIT = { USD: 'dollar', GBP: 'pound' };
  const paidIn = (a) => (a.costCurrency && a.costCurrency !== 'NPR' && a.costAmount ? `${SIGN[a.costCurrency]}${Number(a.costAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })} at Rs ${Number(a.costRate).toFixed(2)} a ${UNIT[a.costCurrency]}` : '');
  const per = (cost, n) => (cost > 0 && n > 0 ? rupees(Math.round(cost / n)) : 'None yet');
  const tag = (a) => el('span', 'ev-tag' + (a.kind === 'Marketing' ? ' mk' : ''), a.channel || 'Other');
  // A small calendar leaf with the month and the day it started, so the list reads like a calendar at a glance.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function leaf(a, big) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(a.date || '');
    const d = el('div', 'ev-leaf' + (big ? ' big' : '') + (a.kind === 'Marketing' ? ' mk' : ''));
    d.setAttribute('aria-hidden', 'true');
    d.append(el('span', '', m ? MONTHS[Number(m[2]) - 1] : '-'), el('b', '', m ? String(Number(m[3])) : '?'));
    return d;
  }
  function band(items) {
    const b = el('div', 'ev-band');
    items.forEach(([label, value, sub, gold]) => { const d = el('div', gold ? 'gold' : ''); d.append(el('span', '', label), el('b', '', value), el('small', '', sub || '')); b.append(d); });
    return b;
  }

  // ---- the list ----
  function draw() {
    const every = data.activities;
    const acts = intake === 'all' ? every : every.filter((a) => a.intake === intake);
    const scopeName = intake === 'all' ? 'all intakes' : intakeName(intake);
    const t = acts.reduce((s, a) => ({ cost: s.cost + (a.cost || 0), leads: s.leads + a.leads, visas: s.visas + a.visas }), { cost: 0, leads: 0, visas: 0 });
    $('band').replaceWith(Object.assign(band([
      ['Total cost', rupees(t.cost) || 'Rs 0', `${acts.length === 1 ? '1 event or campaign' : `${acts.length} events and campaigns`}, ${scopeName}`],
      ['Inquiries', number(t.leads)],
      ['Visas', number(t.visas)],
      ['Cost per inquiry', per(t.cost, t.leads), '', true],
      ['Cost per visa', per(t.cost, t.visas), '', true],
    ]), { id: 'band' }));
    $('note').replaceChildren();
    const waitingAll = acts.reduce((n, a) => n + ((a.follow && a.follow.new) || 0) + ((a.follow && a.follow.due) || 0), 0);
    if (waitingAll > 0) $('note').append(el('div', 'ev-note due', `${number(waitingAll)} ${waitingAll === 1 ? 'inquiry from an event waits' : 'inquiries from events wait'} for a follow-up. Open an event to see who.`));
    const unlinked = intake === 'all' ? data.unlinkedSocial : ((data.unlinkedByIntake || {})[intake] || 0);
    if (unlinked > 0) $('note').append(el('div', 'ev-note', `${number(unlinked)} social media ${unlinked === 1 ? 'inquiry' : 'inquiries'}${intake === 'all' ? '' : ` in ${scopeName}`} ${unlinked === 1 ? 'is' : 'are'} not linked to a campaign (and not marked Organic), so ${unlinked === 1 ? 'it is' : 'they are'} in no campaign's cost per inquiry.`));
    // An event with no intake chosen and no students yet belongs to no intake: it is only under All intakes, so say so.
    const loose = intake === 'all' ? 0 : every.filter((a) => !a.intake).length;
    if (loose > 0) $('note').append(el('div', 'ev-note', `${number(loose)} ${loose === 1 ? 'event or campaign has' : 'events and campaigns have'} no intake yet (none chosen and no students yet), so ${loose === 1 ? 'it is' : 'they are'} only under All intakes. Choose the intake with Edit.`));
    $('add').hidden = !data.canEdit;
    const q = find.trim().toLowerCase();
    const shown = (show === 'all' ? acts : acts.filter((a) => (show === 'Marketing' ? a.kind === 'Marketing' : a.kind !== 'Marketing')))
      .filter((a) => !q || `${a.name} ${a.channel || ''} ${a.place || ''}`.toLowerCase().includes(q));
    $('count').textContent = acts.length ? `${shown.length} of ${acts.length}` : '';
    $('find').hidden = !every.length;
    const list = $('list');
    const empty = (title, line, withAdd) => {
      const e = el('div', 'ev-empty');
      e.append(el('div', 'ev-empty-icon', '\u2726'), el('b', '', title), el('p', '', line));
      if (withAdd && data.canEdit) e.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => form(null) }, '+ New event or campaign'));
      return e;
    };
    if (!every.length) { list.replaceChildren(empty('No events or campaigns yet', 'Add the first one to see its cost, inquiries and visas here.', true)); return; }
    if (!acts.length) { list.replaceChildren(empty(`No events or campaigns for ${scopeName} yet`, 'Choose another intake at the top, or All intakes.', true)); return; }
    if (!shown.length) { list.replaceChildren(empty(q ? `Nothing matches \u201c${find.trim()}\u201d` : 'Nothing here yet', q ? 'Try another word, or clear the search.' : 'Choose All to see every event and campaign.')); return; }
    const head = el('div', 'ev-lrow head');
    ['Event or campaign', 'Cost', 'Inquiries', 'Visas', 'Per inquiry', 'Per visa', ''].forEach((x, i) => head.append(el('div', i && i < 6 ? 'num' : '', x)));
    list.replaceChildren(head, ...shown.map((a) => {
      const r = el('div', 'ev-lrow item');
      r.style.setProperty('--i', String(Math.min(shown.indexOf(a), 12)));
      r.tabIndex = 0; r.setAttribute('role', 'button'); r.setAttribute('aria-label', `Open ${a.name}`);
      const who = el('div');
      const meta = el('div', 'ev-lmeta'); meta.append(tag(a), el('span', '', [`${ran(a)} · ${a.days} day${a.days === 1 ? '' : 's'}`, intake === 'all' ? (a.intakeName || 'No intake yet') : ''].filter(Boolean).join(' · ')));
      const words = el('div', 'ev-lwords'); words.append(el('div', 'ev-lname', a.name), meta);
      // The follow-up of the event at a glance: who still waits for a call, and how many have applied.
      const fo = a.follow || {};
      const waiting = (fo.new || 0) + (fo.due || 0);
      if (a.leads) {
        const line = el('div', 'ev-lfollow');
        if (fo.new) line.append(el('span', 'ev-fpill new', `${fo.new} not contacted`));
        if (fo.due) line.append(el('span', 'ev-fpill due', `${fo.due} follow-up due`));
        if (!waiting) line.append(el('span', 'ev-fpill ok', '\u2713 All followed up'));
        // The same figure as Applied in the event's "From inquiry to visa" (ever applied), so the list and the event agree.
        line.append(el('span', 'ev-lconv', `${Math.round((a.applied / a.leads) * 100)}% applied`));
        words.append(line);
      }
      who.className = 'ev-lwho'; who.append(leaf(a), words);
      const num = (label, v, gold) => { const d = el('div', 'num' + (gold ? ' gold' : '') + (v === 'None yet' || v === '-' ? ' none' : ''), v); d.dataset.label = label; return d; };
      r.append(who, num('Cost', a.cost ? rupees(a.cost) : '-'), num('Inquiries', number(a.leads)), num('Visas', number(a.visas)), num('Per inquiry', per(a.cost, a.leads), a.cost > 0 && a.leads > 0), num('Per visa', per(a.cost, a.visas), a.cost > 0 && a.visas > 0), el('div', 'ev-go', '→'));
      const go = () => window.NiecUI.swap(() => { openEvent(a.id); window.scrollTo({ top: 0 }); });
      r.addEventListener('click', go);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return r;
    }));
  }

  // ---- one event: its figures, the upload of its students, and its students ----
  function openEvent(id) {
    const a = data.activities.find((x) => x.id === id);
    if (!a) return;
    open = a;
    $('listView').hidden = true;
    const v = $('eventView'); v.hidden = false;
    const back = h('button', { class: 'ev-back', type: 'button', onclick: () => window.NiecUI.swap(closeEvent) }, '← Events and campaigns');
    const head = el('div', 'ev-head');
    const left = el('div');
    const meta = el('div', 'ev-lmeta'); meta.append(tag(a), el('span', '', [ran(a), `${a.days} day${a.days === 1 ? '' : 's'}`, a.place, a.intakeName ? `${a.intakeName}${a.intakeHow === 'students' ? ' (from its students)' : ''}` : 'No intake yet'].filter(Boolean).join(' \u00b7 ')));
    const title = el('div', 'ev-title'); const words = el('div'); words.append(el('h2', '', a.name), meta);
    title.append(leaf(a, true), words);
    left.append(title);
    if (a.note) left.append(el('p', 'ev-about', a.note));
    // Its students in more than one intake: where they are, so the figures below (every intake) are read right.
    if ((a.perIntake || []).length > 1) left.append(el('p', 'ev-about', `Its students: ${a.perIntake.map((x) => `${number(x.students)} in ${x.name}`).join(', ')}. The figures below count all of them.`));
    head.append(left);
    if (data.canEdit) head.append(h('button', { class: 'btn', type: 'button', onclick: () => form(a) }, 'Edit'));
    const figs = band([
      ['Cost', a.cost ? rupees(a.cost) : 'Not entered', paidIn(a) || (data.canEdit && !a.cost ? 'Add it with Edit' : '')],
      ['Inquiries', number(a.leads), `${number(a.applied)} applied`],
      ['Visas', number(a.visas)],
      ['Cost per inquiry', per(a.cost, a.leads), '', true],
      ['Cost per visa', per(a.cost, a.visas), '', true],
    ]);
    figs.style.marginTop = '20px';
    const flow = funnel(a);
    const upload = data.canEdit ? uploadPanel(a) : null;
    const people = el('section', 'ev-panel');
    people.classList.add('ev-follow');
    people.append(el('h3', '', 'Follow-up'), el('p', '', 'Everyone from this event, in every intake: where they stand, the last contact and the remark. Click a name to open the card, or write a note here.'));
    const listBox = el('div'); listBox.innerHTML = '<div class="isr-skel" role="status" aria-label="Loading"><i></i><i></i><i></i></div>';
    people.append(listBox);
    v.replaceChildren(back, head, figs, flow, people, ...(upload ? [upload] : []));
    loadPeople(a, listBox);
  }
  // From inquiry to visa: how many of the inquiries went on to apply and to a visa, as bars against the inquiries.
  function funnel(a) {
    const p = el('section', 'ev-panel ev-flow');
    p.append(el('h3', '', 'From inquiry to visa'));
    const top = Math.max(a.leads || 0, 1);
    [['Inquiries', a.leads || 0, 'one'], ['Applied', a.applied || 0, 'two'], ['Visas', a.visas || 0, 'three']].forEach(([label, n, k], i) => {
      const r = el('div', 'ev-flow-row');
      const bar = el('div', 'ev-flow-bar'); const fill = el('i', k); fill.style.setProperty('--w', `${Math.max(n ? 2 : 0, Math.round((n / top) * 100))}%`); fill.style.setProperty('--i', String(i)); bar.append(fill);
      const pc = i && a.leads ? `${Math.round((n / a.leads) * 100)}%` : '';
      r.append(el('span', 'ev-flow-label', label), bar, el('b', '', number(n)), el('span', 'ev-flow-pc', pc));
      p.append(r);
    });
    if (!a.leads) p.append(el('p', 'ev-flow-none', 'The bars fill once the inquiry list is uploaded.'));
    return p;
  }
  function closeEvent() { open = null; $('eventView').hidden = true; $('eventView').replaceChildren(); $('listView').hidden = false; window.scrollTo({ top: 0 }); }

  // Where each student of the event stands in the follow-up (worked out on the server from the stage, the notes and the messages).
  const FOLLOW = {
    new: { label: 'Not contacted', hint: 'No note or message yet' },
    due: { label: 'Follow-up due', hint: 'No contact for a few days' },
    ok: { label: 'Followed up', hint: 'Contacted recently' },
    applied: { label: 'Applying', hint: 'Converted: past Inquiry and applying' },
    visa: { label: 'Visa', hint: 'Visa received' },
    inactive: { label: 'Inactive', hint: 'Withdrawn, on hold, deferred or refused' },
  };
  const FOLLOW_ORDER = ['new', 'due', 'ok', 'applied', 'visa', 'inactive'];
  const ago = (d) => (d === null || d === undefined ? '' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);

  async function loadPeople(a, box) {
    let got;
    try { got = await api(`/api/activities/${a.id}/students`); } catch (e) { box.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
    const list = got.students || [];
    const team = got.team || [];
    const rule = got.followDays || 3;
    if (!list.length) { box.replaceChildren(el('div', 'ev-empty small', 'No inquiries yet. Upload the inquiry list to start the follow-up.')); return; }
    const count = (k) => list.filter((s) => s.follow === k).length;
    const contacted = list.filter((s) => s.contacts > 0 || ['applied', 'visa'].includes(s.follow)).length;
    const converted = count('applied') + count('visa');
    const pc = (n) => `${Math.round((n / list.length) * 100)}%`;

    // The summary: how much of the event has been followed up and converted, at a glance.
    const sum = el('div', 'ev-fsum');
    const meter = (label, n, k) => { const d = el('div', 'ev-fmeter ' + k); const bar = el('div', 'ev-fmeter-bar'); const i = el('i'); i.style.setProperty('--w', pc(n)); bar.append(i); d.append(el('span', '', label), el('b', '', `${pc(n)}`), el('small', '', `${n} of ${list.length}`), bar); return d; };
    sum.append(meter('Contacted at least once', contacted, 'reach'), meter('Converted (applying or visa)', converted, 'conv'), meter('Still waiting for a follow-up', count('new') + count('due'), 'wait'));

    // The status tiles double as the filter.
    let state = '';
    const tiles = el('div', 'ev-ftiles');
    tiles.setAttribute('role', 'group'); tiles.setAttribute('aria-label', 'Show');
    const tile = (k, label, n, hint) => {
      const b = h('button', { type: 'button', class: `ev-ftile ${k || 'all'}${k === state ? ' on' : ''}` });
      b.append(el('b', '', String(n)), el('span', '', label));
      if (hint) b.title = hint;
      b.setAttribute('aria-pressed', String(k === state));
      b.addEventListener('click', () => { state = state === k ? '' : k; tiles.querySelectorAll('button').forEach((x) => { const on = x === b && state === k; x.classList.toggle('on', on || (!state && x.classList.contains('all'))); x.setAttribute('aria-pressed', String(on)); }); drawPeople(); });
      return b;
    };
    tiles.append(tile('', 'Everyone', list.length), ...FOLLOW_ORDER.map((k) => tile(k, FOLLOW[k].label, count(k), k === 'due' ? `At Inquiry, no note or message for ${rule} days or more` : FOLLOW[k].hint)));
    tiles.querySelector('.all').classList.add('on');

    // Who in the team has followed these students up.
    let who = null;
    if (team.length) {
      who = el('div', 'ev-team');
      who.append(el('span', 'ev-team-title', 'Followed up by'));
      team.slice(0, 12).forEach((t) => {
        const c = el('div', 'ev-team-person');
        c.append(el('span', 'ev-team-av', window.Portal.initials ? window.Portal.initials(t.name) : t.name.slice(0, 2)));
        const w = el('div'); w.append(el('b', '', t.name), el('small', '', `${t.students} student${t.students === 1 ? '' : 's'} · ${t.notes} contact${t.notes === 1 ? '' : 's'} · last ${localDay(t.last)}`));
        c.append(w);
        who.append(c);
      });
    }

    const search = h('input', { class: 'ev-search', type: 'search', placeholder: 'Search a name or phone', 'aria-label': 'Search the inquiries' });
    const shownCount = el('span', 'p-muted');
    const rows = el('div', 'ev-people');
    const drawPeople = () => {
      const q = search.value.trim().toLowerCase();
      const shown = list.filter((s) => (!state || s.follow === state) && (!q || `${s.name} ${s.phone} ${s.email}`.toLowerCase().includes(q)))
        .sort((x, y) => FOLLOW_ORDER.indexOf(x.follow) - FOLLOW_ORDER.indexOf(y.follow) || (y.days ?? 999) - (x.days ?? 999) || x.name.localeCompare(y.name));
      shownCount.textContent = `${shown.length} of ${list.length}`;
      if (!shown.length) { rows.replaceChildren(el('div', 'ev-empty small', state ? `Nobody is ${FOLLOW[state].label.toLowerCase()} right now.` : 'No inquiry matches.')); return; }
      const hd = el('div', 'ev-person head'); ['Student', 'Follow-up', 'Stage', 'Last contact and remark', ''].forEach((x) => hd.append(el('div', '', x)));
      rows.replaceChildren(hd, ...shown.map((s) => {
        const r = el('div', 'ev-person');
        const name = el('div', 'ev-pname');
        name.append(h('button', { class: 'who', type: 'button', onclick: () => window.CardDrawer.open(s.id, { onClose: () => refresh() }) }, s.name));
        const sub = el('div', 'ev-psub');
        if (s.phone) sub.append(h('a', { href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, title: `Call ${s.name}` }, s.phone));
        sub.append(el('span', '', s.intake));
        name.append(sub);
        const fol = el('div', 'ev-fcell');
        fol.append(el('span', `ev-fpill ${s.follow}`, FOLLOW[s.follow] ? FOLLOW[s.follow].label : s.follow));
        if (s.lastContact) fol.append(el('small', '', `${s.contacts} contact${s.contacts === 1 ? '' : 's'}, last ${ago(s.days)}`));
        else fol.append(el('small', '', ['new', 'due', 'ok'].includes(s.follow) ? 'Never contacted' : 'No contact recorded'));
        const stageCell = el('div'); stageCell.append(window.Portal.stagePill(s.stage));
        const last = el('div', 'last');
        if (s.lastContact) {
          const lc = s.lastContact;
          last.append(el('b', '', `${localDay(lc.at)}${lc.by ? ', ' + lc.by : ''}${lc.what !== 'note' ? ` (${lc.what})` : ''}: `), lc.text || (lc.what === 'note' ? '' : 'sent'));
        } else last.append(el('span', 'ev-none', 'No note yet'));
        if (s.remarks && (!s.lastContact || s.remarks !== s.lastContact.text)) last.append(el('div', 'ev-remark', `Remark: ${s.remarks}`));
        if (s.follow === 'inactive' && s.lostReason) last.append(el('div', 'ev-remark', `Why: ${s.lostReason}`));
        const act = el('div', 'ev-pact');
        if (s.canNote) {
          const add = h('button', { class: 'btn btn-sm', type: 'button', title: `Write a note on ${s.name}'s card` }, '+ Note');
          add.addEventListener('click', () => quickNote(r, s, add));
          act.append(add);
        }
        r.append(name, fol, stageCell, last, act);
        return r;
      }));
    };
    // A note written here goes on the student's card, as if written there, and the list is refreshed.
    function quickNote(row, s, btn) {
      if (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('ev-qnote')) { row.nextSibling.querySelector('textarea').focus(); return; }
      const box = el('div', 'ev-qnote');
      const area = h('textarea', { rows: '2', maxlength: '2000', placeholder: `What happened with ${s.name}? (a call, a message, their answer)`, 'aria-label': `Note on ${s.name}` });
      const save = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Save note');
      const cancel = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => box.remove() }, 'Cancel');
      const go = async () => {
        const t = area.value.trim();
        if (!t) { area.focus(); return; }
        save.disabled = true;
        try { await api(`/api/cards/${s.id}/notes`, { text: t }); say(`Note saved on ${s.name}'s card`); await refresh(); } catch (e) { say(e.message, true); save.disabled = false; }
      };
      save.addEventListener('click', go);
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } if (e.key === 'Escape') box.remove(); });
      const foot = el('div', 'ev-qnote-foot'); foot.append(save, cancel, el('span', 'p-muted', 'Saved on the student’s card. Ctrl+Enter to save.'));
      box.append(area, foot);
      row.after(box);
      area.focus();
      btn.blur();
    }
    search.addEventListener('input', drawPeople);
    drawPeople();
    const top = el('div', 'ev-actions ev-find-row'); top.append(search, shownCount);
    box.replaceChildren(sum, tiles, ...(who ? [who] : []), top, rows);
  }

  function uploadPanel(a) {
    const p = el('section', 'ev-panel');
    const intro = el('div'); intro.append(el('h3', '', 'Upload the inquiry list'), el('p', '', 'Excel or CSV, one student per row. Checked before saving.'));
    const ph = el('div', 'ev-panel-head'); ph.append(intro);
    p.append(ph);
    const intake = h('select', {});
    (data.intakes || []).forEach((s) => intake.append(h('option', { value: s.id }, s.name)));
    // New inquiries go into the event's own intake unless another is chosen.
    if (a.intake && (data.intakes || []).some((s) => s.id === a.intake)) intake.value = a.intake;
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' });
    const row = el('div', 'ev-upload');
    const l1 = el('label'); l1.append('Intake for new inquiries', intake);
    // The file is dropped on a soft area or chosen with a click on it, instead of the browser's plain "Choose File" button.
    const drop = el('label', 'ev-drop');
    const dropText = el('span', 'ev-drop-words');
    const sayFile = (name) => { dropText.replaceChildren(el('b', '', name || 'Drop the Excel or CSV file here'), el('span', '', name ? 'Choose another file' : 'or click to choose one')); };
    sayFile('');
    drop.append(el('span', 'ev-drop-icon', '\u2191'), dropText, file);
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.(xlsx|csv)$/i.test(f.name)) { say('Choose an Excel (.xlsx) or CSV file.', true); return; }
      try { const dt = new DataTransfer(); dt.items.add(f); file.files = dt.files; } catch { /* an older browser: the click still works */ }
      useFile(f);
    });
    row.append(l1, drop);
    const out = el('div');
    // Take the list back (the owner, 14 Nov 2026): remove the enquiries this list added, to upload a better one, without deleting
    // the event. Only those nobody has worked on go; the review says who stays and why, and a copy of everything is saved first.
    const takeBack = h('button', { class: 'btn', type: 'button' }, 'Remove the inquiries this list added');
    takeBack.addEventListener('click', async () => {
      takeBack.disabled = true;
      try { out.replaceChildren(removal(a, await api(`/api/activities/${a.id}/students/remove`, { preview: true }), () => out.replaceChildren())); } catch (e) { say(e.message, true); }
      takeBack.disabled = false;
    });
    takeBack.classList.add('btn-sm');
    ph.append(takeBack);
    p.append(row, out);
    file.addEventListener('change', () => { const f = file.files && file.files[0]; if (f) useFile(f); });
    async function useFile(f) {
      sayFile(f.name);
      out.replaceChildren(el('p', 'p-muted', 'Reading the file…'));
      let lines;
      try { lines = await window.StudentFile.readFile(f, 1000); } catch (e) { out.replaceChildren(el('div', 'p-notice bad', 'Could not read the file: ' + e.message)); return; }
      if (!lines.length) { out.replaceChildren(el('div', 'p-notice bad', 'No names were found in that file.')); return; }
      const rows = lines.map((r) => ({ first: r.first, last: r.last, email: r.email, phone: r.phone, level: r.level || '', intake: r.intake || '', inquiryDate: r.inquiryDate || '', inquiryTime: r.inquiryTime || '', place: r.place || '', extra: r.extra || '' }));
      let pre;
      try { pre = await api(`/api/activities/${a.id}/students`, { rows, sheetId: intake.value, preview: true }); } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
      out.replaceChildren(review(pre, async () => {
        const done = await api(`/api/activities/${a.id}/students`, { rows, sheetId: intake.value });
        say(`${done.added} added, ${done.linked} linked${done.updated ? `, ${done.updated} given the new details` : ''}`);
        file.value = ''; sayFile('');
        await refresh();
        if (done.failed.length) window.NiecUI.toast('Not done: ' + done.failed.join(' | '), { type: 'error' });
      }, () => { out.replaceChildren(); file.value = ''; sayFile(''); }));
    }
    return p;
  }

  const WHAT = { new: 'New', link: 'Match', update: 'Update', already: 'Linked', other: 'Other event', check: 'Check', removed: 'Removed before', joined: 'Joined', problem: 'Skipped' };
  // The look of each kind of line: the new kinds borrow the colours of the old ones.
  const LOOK = { check: 'other', removed: 'other', update: 'link', joined: 'already' };
  function review(pre, onOk, onCancel) {
    const box = el('div');
    const c = pre.counts;
    const counts = el('div', 'ev-counts');
    [['new', `${c.new} new, added at Inquiry`], ['link', `${c.link} matched on the sheet, will be linked`], ...(c.update ? [['update', `${c.update} already in ISR, new details will be added`]] : []), ['already', `${c.already} already linked, nothing new`], ['other', `${c.other} in another event, left as is`], ...(c.check ? [['check', `${c.check} to check (fits another person or two students)`]] : []), ...(c.removed ? [['removed', `${c.removed} removed from the sheet before, not added back`]] : []), ...(c.joined ? [['joined', `${c.joined} repeated in the file, joined to their first line`]] : []), ['problem', `${c.problem} skipped`]]
      .forEach(([k, t]) => counts.append(el('span', `ev-count ${LOOK[k] || k}`, t)));
    // Students tagged with this event earlier who are not on this list: they stay as they are, and are named here to be checked.
    let gone = null;
    if (pre.missing && pre.missing.length) {
      gone = el('div', 'p-notice warn ev-missing');
      const words = el('div');
      words.append(el('b', '', `${pre.missing.length} ${pre.missing.length === 1 ? 'student was' : 'students were'} on an earlier list but ${pre.missing.length === 1 ? 'is' : 'are'} not in this one.`), el('div', '', 'They stay tagged with this event.'));
      const names = el('div', 'ev-missing-names');
      pre.missing.slice(0, 60).forEach((m) => { const b = h('button', { type: 'button', class: 'ev-missing-name', onclick: () => window.CardDrawer.open(m.id) }, m.name); b.title = `${m.intake} \u00b7 ${m.stage || 'no stage'}`; names.append(b); });
      if (pre.missing.length > 60) names.append(el('span', 'p-muted', `and ${pre.missing.length - 60} more`));
      words.append(names);
      gone.append(words);
    }
    const list = el('div', 'ev-review');
    const order = ['problem', 'check', 'removed', 'other', 'link', 'update', 'new', 'joined', 'already'];
    [...pre.rows].sort((x, y) => order.indexOf(x.action) - order.indexOf(y.action)).forEach((r) => {
      const line = el('div', 'ev-rline');
      line.append(el('span', `what ${LOOK[r.action] || r.action}`, WHAT[r.action]), el('b', '', r.name || '(no name)'), el('span', '', r.phone || r.email || '-'), el('span', 'why', r.note));
      list.append(line);
    });
    const doing = c.new + c.link + (c.update || 0);
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, doing ? `Confirm: add ${c.new}, link ${c.link}${c.update ? `, update ${c.update}` : ''}` : 'Nothing new to add');
    ok.disabled = !doing;
    ok.addEventListener('click', async () => { ok.disabled = true; try { await onOk(); } catch (e) { say(e.message, true); ok.disabled = false; } });
    const actions = el('div', 'ev-actions'); actions.append(ok, h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel'), el('span', 'p-muted', 'Nothing is saved until you confirm.'));
    box.append(counts, ...(gone ? [gone] : []), list, actions);
    return box;
  }

  // The review before a list's enquiries are removed: who goes, who stays and why.
  function removal(a, pre, onCancel) {
    const box = el('div');
    const counts = el('div', 'ev-counts');
    [['other', `${pre.remove.length} will be removed`], ['already', `${pre.worked.length} worked on, stay`], ['already', `${pre.before.length} in ISR before the list, stay`]]
      .forEach(([k, t]) => counts.append(el('span', `ev-count ${k}`, t)));
    const list = el('div', 'ev-review');
    const line = (x, what, look, why) => { const r = el('div', 'ev-rline'); r.append(el('span', `what ${look}`, what), el('b', '', x.name), el('span', '', `${x.intake}, ${x.stage || 'no stage'}`), el('span', 'why', why)); list.append(r); };
    pre.remove.forEach((x) => line(x, 'Remove', 'other', 'Added by this list'));
    pre.worked.forEach((x) => line(x, 'Stays', 'already', x.why));
    pre.before.forEach((x) => line(x, 'Stays', 'already', x.why));
    const ok = h('button', { class: 'btn btn-danger', type: 'button', disabled: !pre.remove.length }, pre.remove.length ? `Remove ${pre.remove.length} inquir${pre.remove.length === 1 ? 'y' : 'ies'}` : 'Nothing to remove');
    ok.addEventListener('click', async () => {
      if (!(await window.NiecUI.confirm(`Remove the ${pre.remove.length} inquir${pre.remove.length === 1 ? 'y' : 'ies'} this list added? A copy is saved first.`, { danger: true, confirmText: 'Remove' }))) return;
      ok.disabled = true;
      try {
        const done = await api(`/api/activities/${a.id}/students/remove`, {});
        say(`${done.removed} removed. Upload the corrected list now.`);
        onCancel();
        await refresh();
      } catch (e) { say(e.message, true); ok.disabled = false; }
    });
    const actions = el('div', 'ev-actions'); actions.append(ok, h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel'), el('span', 'p-muted', 'Nothing is removed until you confirm.'));
    box.append(counts, list, actions);
    return box;
  }

  // ---- add or change one ----
  function form(a) {
    dialog(a ? 'Edit event or campaign' : 'New event or campaign', (body, close) => {
      const f = {
        name: field('Name', { value: a && a.name, max: 120, wide: true, placeholder: 'e.g. UK Education Fair, Kathmandu' }),
        place: field('Venue or page (optional)', { value: a && a.place, max: 120, placeholder: 'e.g. Hotel Annapurna' }),
        cost: field('Cost', { value: a && (a.costAmount || a.cost) ? String(a.costAmount || a.cost) : '', max: 14, placeholder: 'e.g. 25000' }),
        date: field('Starts', { kind: 'date', value: a && a.date }),
        endDate: field('Ends (optional)', { kind: 'date', value: a && a.endDate }),
        note: field('Note (optional)', { kind: 'area', value: a && a.note, max: 600, wide: true }),
        // The intake it was run for; a new one starts on the intake being looked at.
        intake: field('Intake', { kind: 'select', value: a ? a.chosenIntake : (intake !== 'all' ? intake : ''), choices: [['', 'Not chosen (from its students)'], ...(data.intakes || []).map((x) => [x.id, x.name])], hint: 'Which intake it was run for. Not chosen: the intake most of its students are in.' }),
      };
      let channel = (a && a.channel) || '';
      const choices = el('div', 'ev-choices');
      const pills = data.channels.map((c) => {
        const b = h('button', { type: 'button', class: c === channel ? 'on' : '' }, c);
        b.setAttribute('aria-pressed', String(c === channel));
        b.addEventListener('click', () => { channel = c; pills.forEach((p) => { p.classList.toggle('on', p === b); p.setAttribute('aria-pressed', String(p === b)); }); });
        return b;
      });
      choices.append(...pills);
      const where = el('div', 'p-field ev-where'); where.append(el('span', 'ev-choice-label', 'Where it ran'), choices);
      // The investment in rupees, US dollars or pounds: dollars and pounds are turned into rupees at today's rate when saved.
      let currency = (a && a.costCurrency) || 'NPR';
      const money = el('div', 'ev-money');
      const cur = el('div', 'ev-cur');
      cur.setAttribute('role', 'group'); cur.setAttribute('aria-label', 'Currency');
      const curs = [['NPR', 'Rs'], ['USD', '$'], ['GBP', '\u00a3']].map(([k, t]) => {
        const b = h('button', { type: 'button', class: k === currency ? 'on' : '', title: { NPR: 'Nepalese rupees', USD: 'US dollars', GBP: 'Pounds' }[k] }, t);
        b.setAttribute('aria-pressed', String(k === currency));
        b.addEventListener('click', () => { currency = k; curs.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); hint(); });
        return b;
      });
      cur.append(...curs);
      const conv = el('small', 'ev-conv');
      const hint = () => { conv.textContent = currency === 'NPR' ? 'In rupees.' : `Turned into rupees at today\u2019s rate.`; };
      hint();
      f.cost.input.inputMode = 'decimal';
      const line = el('div', 'ev-money-row');
      f.cost.input.replaceWith(line);
      line.append(f.cost.input, cur);
      f.cost.wrap.append(conv);
      money.append(f.cost.wrap);
      const grid = el('div', 'p-form p-form-2');
      grid.append(f.name.wrap, where, f.place.wrap, money, f.date.wrap, f.endDate.wrap, f.intake.wrap, f.note.wrap);
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'));
      if (a) foot.append(h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (await window.NiecUI.confirm('Remove this event? Its students stay.', { danger: true, confirmText: 'Remove' })) { await api(`/api/planning/events/${a.id}/delete`, {}); close('removed'); } } }, 'Remove'));
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      ok.addEventListener('click', async () => {
        if (ok.disabled) return;
        if (!channel) { msg.textContent = 'Choose where it ran.'; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        try {
          // The older "type" of an entry is sent back as it was, so nothing stored is lost.
          const typed = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.input.value]));
          await api('/api/planning/events', { ...(a ? { id: a.id, type: a.type } : {}), channel, ...typed, costAmount: typed.cost, costCurrency: currency });
          close(true);
        } catch (e) { ok.disabled = false; msg.textContent = e.message; msg.className = 'p-msg error'; }
      });
      foot.append(ok);
      body.append(grid, msg, foot);
    }).then(async (changed) => {
      if (!changed) return;
      say(changed === 'removed' ? 'Removed' : 'Saved');
      if (changed === 'removed') closeEvent();
      await refresh();
    });
  }

  async function refresh() {
    data = await api('/api/activities');
    picker();
    draw();
    if (open) { const still = data.activities.find((x) => x.id === open.id); if (still) openEvent(still.id); else closeEvent(); }
  }
  $('add').addEventListener('click', () => form(null));
  $('intake').addEventListener('change', () => {
    intake = $('intake').value;
    try { localStorage.setItem(INTAKE_KEY, intake); } catch (e) { /* remembered for this visit only */ }
    if (data) window.NiecUI.swap(draw, { soft: true });
  });
  $('find').addEventListener('input', () => { find = $('find').value; if (data) draw(); });
  // "/" jumps to the search box and Esc clears it, as on the Partners page.
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !typing && !$('listView').hidden && !$('find').hidden) { e.preventDefault(); $('find').focus(); }
    else if (e.key === 'Escape' && e.target === $('find') && $('find').value) { $('find').value = ''; find = ''; draw(); }
  });
  document.querySelectorAll('#filter button').forEach((b) => b.addEventListener('click', () => {
    show = b.dataset.f;
    document.querySelectorAll('#filter button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    if (data) window.NiecUI.swap(draw, { soft: true });
  }));
  refresh().catch((e) => { $('list').replaceChildren(h('div', { class: 'p-notice bad' }, e.message)); });
})();
