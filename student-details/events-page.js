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
  const INTAKE_KEY = 'sr360EventsIntake';
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
  // Students of an event still waiting for a follow-up: never contacted, or the next follow-up date has come.
  const waitOf = (a) => ((a.follow && a.follow.new) || 0) + ((a.follow && a.follow.due) || 0);
  const per = (cost, n) => (cost > 0 && n > 0 ? rupees(Math.round(cost / n)) : 'None yet');
  // The grey line under a name: where it ran and when.
  const where = (a, more) => [a.channel || 'Other', ...more].filter(Boolean).join(' \u00b7 ');
  function band(items) {
    const b = el('div', 'ev-band');
    b.style.setProperty('--n', String(items.length));
    items.forEach(([label, value, sub]) => { const d = el('div'); d.append(el('span', '', label), el('b', '', value)); if (sub) d.append(el('small', '', sub)); b.append(d); });
    return b;
  }
  // The day it began, as a small calendar leaf.
  function leaf(a) {
    const [y, m, d] = String(a.date || '').split('-').map(Number);
    const box = el('div', 'ev-leaf');
    box.setAttribute('aria-hidden', 'true');
    if (!y || !m || !d) { box.append(el('b', '', '?'), el('span', '', 'No date')); return box; }
    box.append(el('b', '', String(d)), el('span', '', `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`));
    return box;
  }
  // One event or campaign in the list (the owner, 26 Nov 2026): when and where, how far its students got, what it cost, and who still
  // waits for a follow-up. The whole card opens it.
  function eventCard(a) {
    const r = el('article', 'ev-card');
    r.tabIndex = 0; r.setAttribute('role', 'button'); // its name is the words on the card, so what is seen is what is read out
    const top = el('div', 'ev-card-top');
    const words = el('div', 'ev-card-words');
    words.append(el('div', 'ev-lname', a.name), el('div', 'ev-lmeta', where(a, [ran(a), intake === 'all' ? (a.intakeName || 'No intake yet') : ''])));
    top.append(leaf(a), words, el('span', `ev-kind${a.kind === 'Marketing' ? ' is-campaign' : ''}`, a.kind === 'Marketing' ? 'Campaign' : 'Event'));
    const flow = el('div', 'ev-flow');
    [['Inquiries', a.leads], ['Applied', a.applied], ['Visas', a.visas]].forEach(([label, n], i) => {
      const line = el('div', `ev-flow-line is-${i}`);
      const bar = el('i');
      bar.style.setProperty('--w', n && a.leads ? `${Math.max(4, Math.min(100, Math.round((n / a.leads) * 100)))}%` : '0%');
      line.append(el('span', '', label), bar, el('b', '', number(n || 0)));
      flow.append(line);
    });
    const money = el('dl', 'ev-sums');
    [['Cost', a.cost ? rupees(a.cost) : 'Not entered'], ['Per inquiry', a.cost > 0 && a.leads > 0 ? per(a.cost, a.leads) : 'None yet'], ['Per visa', per(a.cost, a.visas)]].forEach(([label, v]) => {
      const d = el('div', v === 'None yet' || v === 'Not entered' ? 'is-none' : '');
      d.append(el('dt', '', label), el('dd', '', v));
      money.append(d);
    });
    const wait = waitOf(a);
    const foot = el('div', 'ev-card-foot');
    foot.append(el('span', `ev-wait${wait ? ' is-waiting' : a.leads ? ' is-done' : ''}`, wait ? `${number(wait)} to follow up` : a.leads ? 'All followed up' : 'No students yet'), el('span', 'ev-open', 'Open \u203a'));
    r.append(top, flow, money, foot);
    const go = () => window.NiecUI.swap(() => { openEvent(a.id); window.scrollTo({ top: 0 }); });
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return r;
  }

  // ---- the list ----
  function draw() {
    const every = data.activities;
    const acts = intake === 'all' ? every : every.filter((a) => a.intake === intake);
    const scopeName = intake === 'all' ? 'all intakes' : intakeName(intake);
    const t = acts.reduce((s, a) => ({ cost: s.cost + (a.cost || 0), leads: s.leads + a.leads, applied: s.applied + (a.applied || 0), visas: s.visas + a.visas }), { cost: 0, leads: 0, applied: 0, visas: 0 });
    const share = (n) => (t.leads ? `${Math.round((n / t.leads) * 100)}% of inquiries` : '');
    const waitingAll = acts.reduce((n, a) => n + waitOf(a), 0);
    $('band').replaceWith(Object.assign(band([
      ['Total cost', rupees(t.cost) || 'Rs 0', `${acts.length === 1 ? '1 event or campaign' : `${acts.length} events and campaigns`}, ${scopeName}`],
      ['Inquiries', number(t.leads), waitingAll ? `${number(waitingAll)} to follow up` : (t.leads ? 'All followed up' : '')],
      ['Applied', number(t.applied), share(t.applied)],
      ['Visas', number(t.visas), share(t.visas)],
      ['Cost per visa', per(t.cost, t.visas), t.leads ? `${per(t.cost, t.leads)} per inquiry` : ''],
    ]), { id: 'band' }));
    $('note').replaceChildren();
    const unlinked = intake === 'all' ? data.unlinkedSocial : ((data.unlinkedByIntake || {})[intake] || 0);
    if (unlinked > 0) $('note').append(el('p', 'ev-note', `${number(unlinked)} social media ${unlinked === 1 ? 'inquiry' : 'inquiries'}${intake === 'all' ? '' : ` in ${scopeName}`} ${unlinked === 1 ? 'is' : 'are'} not linked to a campaign (and not marked Organic), so ${unlinked === 1 ? 'it is' : 'they are'} in no campaign's cost per inquiry.`));
    // An event with no intake chosen and no students yet belongs to no intake: it is only under All intakes, so say so.
    const loose = intake === 'all' ? 0 : every.filter((a) => !a.intake).length;
    if (loose > 0) $('note').append(el('p', 'ev-note', `${number(loose)} ${loose === 1 ? 'event or campaign has' : 'events and campaigns have'} no intake yet (none chosen and no students yet), so ${loose === 1 ? 'it is' : 'they are'} only under All intakes. Choose the intake with Edit.`));
    $('add').hidden = !data.canEdit;
    const q = find.trim().toLowerCase();
    const shown = (show === 'all' ? acts : acts.filter((a) => (show === 'Marketing' ? a.kind === 'Marketing' : a.kind !== 'Marketing')))
      .filter((a) => !q || `${a.name} ${a.channel || ''} ${a.place || ''}`.toLowerCase().includes(q));
    $('count').textContent = shown.length !== acts.length ? `${shown.length} of ${acts.length}` : ''; // only while a search or a kind narrows the list
    $('find').hidden = !every.length;
    const list = $('list');
    const empty = (title, line, withAdd) => {
      const e = el('div', 'ev-empty');
      e.append(el('b', '', title), el('p', '', line));
      if (withAdd && data.canEdit) e.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => form(null) }, '+ New event or campaign'));
      return e;
    };
    if (!every.length) { list.replaceChildren(empty('No events or campaigns yet', 'Add the first one to see its cost, inquiries and visas here.', true)); return; }
    if (!acts.length) { list.replaceChildren(empty(`No events or campaigns for ${scopeName} yet`, 'Choose another intake at the top, or All intakes.', true)); return; }
    if (!shown.length) { list.replaceChildren(empty(q ? `Nothing matches \u201c${find.trim()}\u201d` : 'Nothing here yet', q ? 'Try another word, or clear the search.' : 'Choose All to see every event and campaign.')); return; }
    list.replaceChildren(...shown.map(eventCard));
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
    left.append(el('h2', '', a.name), el('div', 'ev-lmeta', where(a, [ran(a), a.place, a.intakeName ? `${a.intakeName}${a.intakeHow === 'students' ? ' (from its students)' : ''}` : 'No intake yet'])));
    if (a.note) left.append(el('p', 'ev-about', a.note));
    // Its students in more than one intake: where they are, so the figures below (every intake) are read right.
    if ((a.perIntake || []).length > 1) left.append(el('p', 'ev-about', `Its students: ${a.perIntake.map((x) => `${number(x.students)} in ${x.name}`).join(', ')}. The figures below count all of them.`));
    head.append(leaf(a), left);
    if (data.canEdit) head.append(h('button', { class: 'btn', type: 'button', onclick: () => form(a) }, 'Edit'));
    const pc = (n) => (a.leads ? `${Math.round((n / a.leads) * 100)}% of inquiries` : '');
    const figs = band([
      ['Cost', a.cost ? rupees(a.cost) : 'Not entered', paidIn(a) || (data.canEdit && !a.cost ? 'Add it with Edit' : '')],
      ['Inquiries', number(a.leads), a.cost > 0 && a.leads > 0 ? `${per(a.cost, a.leads)} each` : ''],
      ['Applied', number(a.applied), pc(a.applied)],
      ['Visas', number(a.visas), pc(a.visas)],
      ['Cost per visa', per(a.cost, a.visas)],
    ]);
    figs.style.marginTop = '22px';
    const upload = data.canEdit ? uploadPanel(a) : null;
    const people = el('section', 'ev-section');
    const ph = el('div', 'ev-section-head'); const pw = el('div');
    pw.append(el('h3', '', 'Students'), el('p', '', 'Everyone from this event, in every intake. Click a name to open the card.'));
    ph.append(pw); people.append(ph);
    const listBox = el('div'); listBox.innerHTML = '<div class="sr360-skel" role="status" aria-label="Loading"><i></i><i></i><i></i></div>';
    people.append(listBox);
    v.replaceChildren(back, head, figs, people, ...(upload ? [upload] : []));
    loadPeople(a, listBox);
  }
  function closeEvent() { open = null; $('eventView').hidden = true; $('eventView').replaceChildren(); $('listView').hidden = false; window.scrollTo({ top: 0 }); }

  // Where each student of the event stands in the follow-up (worked out on the server from the stage, the notes and the messages).
  // The switch above the table: those still waiting (never contacted, or the next follow-up date has come) come first.
  const VIEWS = [
    ['', 'All', () => true],
    ['wait', 'To follow up', (s) => s.follow === 'new' || s.follow === 'due'],
    ['ok', 'Followed up', (s) => s.follow === 'ok'],
    ['applied', 'Applying', (s) => s.follow === 'applied'],
    ['visa', 'Visa', (s) => s.follow === 'visa'],
    ['inactive', 'Inactive', (s) => s.follow === 'inactive'],
  ];
  const FOLLOW_ORDER = ['new', 'due', 'ok', 'applied', 'visa', 'inactive'];
  const ago = (d) => (d === null || d === undefined ? '' : d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`);

  async function loadPeople(a, box) {
    let got;
    try { got = await api(`/api/activities/${a.id}/students`); } catch (e) { box.replaceChildren(el('div', 'p-notice bad', e.message)); return; }
    const list = got.students || [];
    if (!list.length) { const e = el('div', 'ev-people'); e.append(el('div', 'ev-empty small', 'No students yet. Upload the inquiry list below to start the follow-up.')); box.replaceChildren(e); return; }
    let state = list.some(VIEWS[1][2]) ? 'wait' : '';
    const seg = el('div', 'ev-pills');
    seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show');
    const segs = VIEWS.filter(([k, , ok]) => !k || list.some(ok)).map(([k, label, ok]) => {
      const b = h('button', { type: 'button', class: k === state ? 'on' : '' });
      b.append(label, el('i', '', String(list.filter(ok).length)));
      b.setAttribute('aria-pressed', String(k === state));
      b.addEventListener('click', () => { state = k; segs.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); drawPeople(); });
      return b;
    });
    seg.append(...segs);
    const search = h('input', { class: 'ev-search', type: 'search', placeholder: 'Search a name or phone', 'aria-label': 'Search the students' });
    const rows = el('div', 'ev-people');
    const drawPeople = () => {
      const q = search.value.trim().toLowerCase();
      const pick = VIEWS.find((x) => x[0] === state)[2];
      const shown = list.filter((s) => pick(s) && (!q || `${s.name} ${s.phone} ${s.email}`.toLowerCase().includes(q)))
        .sort((x, y) => FOLLOW_ORDER.indexOf(x.follow) - FOLLOW_ORDER.indexOf(y.follow) || (y.days ?? 999) - (x.days ?? 999) || x.name.localeCompare(y.name));
      if (!shown.length) { rows.replaceChildren(el('div', 'ev-empty small', q ? 'No student matches.' : 'Nobody here right now.')); return; }
      const hd = el('div', 'ev-person head'); ['Student', 'Stage', 'Last contact', 'Remarks', ''].forEach((x) => hd.append(el('div', '', x)));
      rows.replaceChildren(hd, ...shown.map((s) => {
        const r = el('div', 'ev-person');
        const name = el('div');
        name.append(h('button', { class: 'who', type: 'button', onclick: () => window.CardDrawer.open(s.id, { onClose: () => refresh() }) }, s.name));
        if (s.phone) { const sub = el('div', 'ev-psub'); sub.append(h('a', { href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, title: `Call ${s.name}` }, s.phone)); name.append(sub); }
        const stageCell = el('div'); stageCell.append(window.Portal.stagePill(s.stage));
        // The last contact: when and by whom, then its words; an inquiry still waiting says so in orange.
        const last = el('div');
        const lc = s.lastContact;
        if (s.follow === 'new') last.append(el('div', 'ev-when wait', 'Never contacted'));
        else if (lc) last.append(el('div', 'ev-when' + (s.follow === 'due' ? ' wait' : ''), `${ago(s.days) || localDay(lc.at)}${lc.by ? ' \u00b7 ' + lc.by : ''}${s.follow === 'due' ? ' \u00b7 follow-up due' : ''}`));
        else last.append(el('div', 'ev-when ev-none', 'No contact recorded'));
        if (lc && (lc.text || lc.what !== 'note')) { const w = el('div', 'ev-words', `${lc.what !== 'note' ? `${lc.what}: ` : ''}${lc.text || 'sent'}`); w.title = lc.text || ''; last.append(w); }
        if (s.follow === 'due') last.title = 'At Inquiry, and the next follow-up date has come (or none was set)';
        const remark = el('div', 'ev-remark');
        const said = [s.remarks && (!lc || s.remarks !== lc.text) ? s.remarks : '', s.follow === 'inactive' && s.lostReason ? `Why: ${s.lostReason}` : ''].filter(Boolean);
        if (said.length) remark.textContent = said.join(' \u00b7 '); else remark.append(el('span', 'ev-none', '-'));
        const act = el('div', 'ev-pact');
        if (s.canNote) {
          const add = h('button', { class: 'btn btn-sm', type: 'button', title: `Write a note on ${s.name}'s card` }, 'Note');
          add.addEventListener('click', () => quickNote(r, s, add));
          act.append(add);
        }
        r.append(name, stageCell, last, remark, act);
        return r;
      }));
    };
    // A note written here goes on the student's card, as if written there, and the list is refreshed.
    function quickNote(row, s, btn) {
      if (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('ev-qnote')) { row.nextSibling.querySelector('textarea').focus(); return; }
      const box = el('div', 'ev-qnote');
      const area = h('textarea', { rows: '2', maxlength: '2000', placeholder: `What happened with ${s.name}? (a call, a message, their answer)`, 'aria-label': `Note on ${s.name}` });
      // The next follow-up date is always chosen (the owner, 21 Nov 2026: no automatic days), as on the follow-up list.
      const min = new Date(Date.now() + 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const nextIn = h('input', { type: 'date', min, 'aria-label': `Next follow-up for ${s.name}`, 'aria-required': 'true' });
      const nextWrap = el('label', 'ev-qnote-next'); nextWrap.append('Next follow-up', nextIn);
      const save = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Save note');
      const cancel = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => box.remove() }, 'Cancel');
      const go = async () => {
        const t = area.value.trim();
        if (!t) { area.focus(); return; }
        if (!nextIn.value) { say('Choose the next follow-up date.', true); nextIn.focus(); return; }
        save.disabled = true;
        try { await api(`/api/cards/${s.id}/notes`, { text: t, next: nextIn.value }); say(`Note saved on ${s.name}'s card`); await refresh(); } catch (e) { say(e.message, true); save.disabled = false; }
      };
      save.addEventListener('click', go);
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } if (e.key === 'Escape') box.remove(); });
      const foot = el('div', 'ev-qnote-foot'); foot.append(nextWrap, save, cancel, el('span', 'p-muted', 'Saved on the student’s card. Ctrl+Enter to save.'));
      box.append(area, foot);
      row.after(box);
      area.focus();
      btn.blur();
    }
    search.addEventListener('input', drawPeople);
    drawPeople();
    const tools = el('div', 'ev-tools'); tools.append(seg, search);
    box.replaceChildren(tools, rows);
  }

  function uploadPanel(a) {
    const p = el('section', 'ev-panel');
    const intro = el('div'); intro.append(el('h3', '', 'Upload the inquiry list'), el('p', '', 'Excel or CSV, one student per row. Every line is checked before anything is saved.'));
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
    const takeBack = h('button', { class: 'btn btn-sm', type: 'button' }, 'Remove the inquiries this list added');
    takeBack.addEventListener('click', async () => {
      takeBack.disabled = true;
      try { out.replaceChildren(removal(a, await api(`/api/activities/${a.id}/students/remove`, { preview: true }), () => out.replaceChildren())); } catch (e) { say(e.message, true); }
      takeBack.disabled = false;
    });
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
    [['new', `${c.new} new, added at Inquiry`], ['link', `${c.link} matched on the sheet, will be linked`], ...(c.update ? [['update', `${c.update} already in Student Recruit 360, new details will be added`]] : []), ['already', `${c.already} already linked, nothing new`], ['other', `${c.other} in another event, left as is`], ...(c.check ? [['check', `${c.check} to check (fits another person or two students)`]] : []), ...(c.removed ? [['removed', `${c.removed} removed from the sheet before, not added back`]] : []), ...(c.joined ? [['joined', `${c.joined} repeated in the file, joined to their first line`]] : []), ['problem', `${c.problem} skipped`]]
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
    [['other', `${pre.remove.length} will be removed`], ['already', `${pre.worked.length} worked on, stay`], ['already', `${pre.before.length} in Student Recruit 360 before the list, stay`]]
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
