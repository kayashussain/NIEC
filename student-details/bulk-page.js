// Follow-up (the /bulk page): your setup for sending first (your email, signature and WhatsApp number, sender-setup.js), then choose
// the intake and the stage, tick the students, choose email or WhatsApp, write the message (the {words} are filled in for each
// student), then send the emails in one go or open each student's WhatsApp chat one after the other.
(function () {
  const { el, h, api, field } = window.Portal;
  const view = document.getElementById('view');
  const say = (t, e) => window.NiecUI.toast(t, { type: e ? 'error' : 'success' });
  let students = [];
  let lists = { intakes: [], stages: [] };
  let fields = [];
  let mail = { ready: false };
  const setupBox = el('div');
  const chosen = new Set();
  let items = []; // previews of the chosen students

  async function start() {
    try {
      const l = await api('/api/bulk/students');
      students = l.students; lists = l; mail = l.mail;
      render();
      // Your setup: open when the page was reached to set it up (#setup), or when email is not ready yet.
      const info = await window.SenderSetup.mount(setupBox, { open: location.hash === '#setup' || !mail.ready, onChange: (i) => { mail = i.mail; if (window.bulkSetChannel) window.bulkSetChannel(); } });
      mail = info.mail; fields = info.fields;
      if (window.bulkSetChannel) window.bulkSetChannel();
      if (window.bulkChips) window.bulkChips();
      if (location.hash === '#setup') setupBox.scrollIntoView({ block: 'start' });
    } catch (e) { view.replaceChildren(el('div', 'p-card', e.message)); }
  }

  function render() {
    const wrap = el('div');
    const head = el('div', 'p-head');
    const title = el('div');
    title.append(el('h1', '', 'Follow-up'), el('p', '', 'One personal message to many students.'));
    head.append(title, h('a', { class: 'btn', href: '/students' }, 'Back to All Students'));
    wrap.append(head, setupBox);

    // 1. who
    const who = el('section', 'p-card');
    who.append(el('h2', '', '1. Choose the students'));
    const bar = el('div', 'p-form');
    const intake = field('Intake', { kind: 'select', choices: [['', 'All intakes you can see'], ...lists.intakes.map((i) => [i.id, i.name])] });
    const stage = field('Stage (application status)', { kind: 'select', choices: [['', 'Every stage'], ...lists.stages.map((s) => [s, s])] });
    const search = field('Name', { placeholder: 'Type to narrow the list' });
    // Source: only the students of one source (Visitor, Social Media, a branch ...) or exactly which (a platform, a campaign).
    const NAMES = { Events: 'Events and marketing', Agent: 'Agents', Branch: 'Branches' };
    const groups = new Map();
    students.forEach((s) => { const g = groups.get(s.source) || { n: 0, details: new Map() }; g.n += 1; if (s.sourceDetail) g.details.set(s.sourceDetail, (g.details.get(s.sourceDetail) || 0) + 1); groups.set(s.source, g); });
    const source = field('Source', { kind: 'select', choices: [['', 'Every source']] });
    [...groups].sort((a, b) => b[1].n - a[1].n).forEach(([g, info]) => {
      const og = document.createElement('optgroup'); og.label = NAMES[g] || g;
      og.append(new Option(`All ${NAMES[g] || g} (${info.n})`, 'g:' + g));
      [...info.details].sort((a, b) => b[1] - a[1]).forEach(([d, n]) => og.append(new Option(`${d} (${n})`, `d:${g}\u0001${d}`)));
      source.input.append(og);
    });
    const fromSource = (s) => { const v = source.input.value; if (!v) return true; if (v.startsWith('g:')) return s.source === v.slice(2); const [g, d] = v.slice(2).split('\u0001'); return s.source === g && s.sourceDetail === d; };
    bar.append(intake.wrap, stage.wrap, source.wrap, search.wrap);
    who.append(bar);
    const info = el('div', 'p-muted p-small');
    const listBox = el('div', 'p-pick-list');
    listBox.style.maxHeight = '340px';
    listBox.style.overflow = 'auto';
    const tools = el('div', 'p-bar');
    const visible = () => students.filter((s) => fromSource(s) && (!intake.input.value || s.sheetId === intake.input.value) && (!stage.input.value || s.stage === stage.input.value) && (!search.input.value || s.name.toLowerCase().includes(search.input.value.toLowerCase())));
    const draw = () => {
      const v = visible();
      info.textContent = `${v.length} students match. ${chosen.size} chosen.`;
      listBox.replaceChildren(...(v.length ? v.slice(0, 400).map((s) => {
        const row = el('label', 'p-check');
        const c = el('input'); c.type = 'checkbox'; c.checked = chosen.has(s.id);
        c.addEventListener('change', () => { if (c.checked) chosen.add(s.id); else chosen.delete(s.id); info.textContent = `${v.length} students match. ${chosen.size} chosen.`; });
        const t = el('span'); t.append(el('b', '', s.name), el('div', 'p-muted p-small', [s.stage, s.intake, s.email || 'no email', s.whatsapp ? '' : 'no WhatsApp number'].filter(Boolean).join(' · ')));
        row.append(c, t);
        return row;
      }) : [el('div', 'p-empty', 'No student matches.')]));
    };
    tools.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { visible().slice(0, 150).forEach((s) => chosen.add(s.id)); draw(); } }, 'Tick all shown (up to 150)'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { chosen.clear(); draw(); } }, 'Clear'));
    const q = new URLSearchParams(location.search);
    if (q.get('stage') && lists.stages.includes(q.get('stage'))) stage.input.value = q.get('stage');
    if (q.get('sheet')) intake.input.value = q.get('sheet');
    [intake, stage, source, search].forEach((x) => { x.input.addEventListener('input', draw); x.input.addEventListener('change', draw); });
    who.append(info, tools, listBox);
    wrap.append(who);
    draw();

    // 2. how
    const how = el('section', 'p-card');
    how.append(el('h2', '', '2. How to send it'));
    let channel = 'email';
    const choice = el('div', 'p-tabs');
    const eBtn = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'By email');
    const wBtn = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, 'By WhatsApp');
    choice.append(eBtn, wBtn);
    how.append(choice);
    const subject = field('Subject', { wide: true, max: 200 });
    const body = field('Email text', { kind: 'area', max: 8000, wide: true, value: 'Dear {first_name},\n\n' });
    body.input.style.minHeight = '200px';
    const wa = field('WhatsApp text', { kind: 'area', max: 2000, wide: true, value: 'Hello {first_name}, ' });
    const form = el('div', 'p-form');
    // The words filled in for each student: a click puts one where the cursor is, in the box last typed in.
    let lastBox = body.input;
    [subject.input, body.input, wa.input].forEach((x) => x.addEventListener('focus', () => { lastBox = x; }));
    const chips = el('div', 'tp-chips');
    const chipsWrap = el('div', 'bk-words');
    chipsWrap.append(el('span', 'tp-label', 'Filled in for each student (click to add)'), chips);
    const SHOWN = ['first_name', 'full_name', 'university', 'course', 'intake', 'stage', 'offer_date', 'sender_name', 'company_name', 'options_table', 'documents_list'];
    window.bulkChips = () => {
      chips.replaceChildren(...fields.filter(([k]) => SHOWN.includes(k)).map(([k, d]) => {
        const c = h('button', { class: 'tp-chip', type: 'button', title: d }, `{${k}}`);
        c.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor where it is
        c.addEventListener('click', () => {
          const box = lastBox.closest('[hidden]') ? (channel === 'email' ? body.input : wa.input) : lastBox;
          const at = box.selectionStart ?? box.value.length; const end = box.selectionEnd ?? at;
          box.value = box.value.slice(0, at) + `{${k}}` + box.value.slice(end);
          box.focus(); box.selectionStart = box.selectionEnd = at + k.length + 2;
        });
        return c;
      }));
    };
    window.bulkChips();
    form.append(subject.wrap, body.wrap, wa.wrap, chipsWrap);
    how.append(form);
    wrap.append(how);

    // 3. send
    const send = el('section', 'p-card');
    send.append(el('h2', '', '3. Check and send'));
    const note = el('div');
    const out = el('div');
    const actions = el('div', 'p-bar');
    const check = h('button', { class: 'btn', type: 'button' }, 'Check the message for each student');
    const sendAll = h('button', { class: 'btn btn-primary', type: 'button' }, 'Send emails now');
    sendAll.disabled = true;
    actions.append(check, sendAll);
    send.append(note, actions, out);
    wrap.append(send);

    const setChannel = (c) => {
      channel = c;
      eBtn.setAttribute('aria-selected', String(c === 'email'));
      wBtn.setAttribute('aria-selected', String(c === 'whatsapp'));
      subject.wrap.hidden = body.wrap.hidden = c !== 'email';
      wa.wrap.hidden = c !== 'whatsapp';
      sendAll.hidden = c !== 'email';
      out.replaceChildren();
      note.replaceChildren(c === 'email'
        ? (mail.ready ? el('p', 'p-muted p-small', `Each student gets their own email from ${mail.from || 'your mailbox'}. Press Check first.`)
          : (() => { const n = el('div', 'p-notice warn', 'To send emails, set up your email first in '); const a = h('a', { href: '#setup', onclick: (e) => { e.preventDefault(); setupBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Your setup for sending'); n.append(a, ' above. Nothing is sent until then.'); return n; })())
        : el('p', 'p-muted p-small', 'Press Check, then WhatsApp beside each student.'));
      check.textContent = c === 'email' ? 'Check the emails' : 'Prepare the WhatsApp chats';
    };
    eBtn.addEventListener('click', () => setChannel('email'));
    wBtn.addEventListener('click', () => setChannel('whatsapp'));
    setChannel('email');
    window.bulkSetChannel = () => { setChannel(channel); sendAll.disabled = true; };

    const payload = () => ({ ids: [...chosen], subject: subject.input.value, body: body.input.value, whatsapp: wa.input.value });
    check.addEventListener('click', async () => {
      if (!chosen.size) { say('Tick at least one student first.', true); return; }
      check.disabled = true;
      try {
        const r = await api('/api/bulk/preview', payload());
        items = r.items;
        const ready = items.filter((i) => !i.error && (channel === 'email' ? !i.problem : i.whatsapp && i.whatsapp.number)).length;
        out.replaceChildren(el('p', '', `${ready} of ${items.length} students are ready for ${channel === 'email' ? 'email' : 'WhatsApp'}.`));
        items.forEach((i) => {
          const row = el('div', 'p-sent');
          if (i.error) { row.append(el('b', '', i.id), el('span', 'p-muted', i.error)); out.append(row); return; }
          row.append(el('b', '', i.name));
          if (channel === 'email') {
            row.append(el('span', 'p-muted p-small', i.problem || i.to));
            if (i.missing && i.missing.length) row.append(el('span', 'p-chip', 'Missing: ' + i.missing.join(', ')));
            row.append(h('button', { class: 'p-link', type: 'button', onclick: () => window.NiecUI.alert(i.text, { title: i.subject }) }, 'Read'));
          } else if (i.whatsapp && i.whatsapp.number) {
            row.append(el('span', 'p-muted p-small', '+' + i.whatsapp.number));
            row.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => {
              window.Portal.whatsapp(i.whatsapp.number, i.name, i.whatsapp.text); // on a computer: open here, or scan to open on the phone
              api(`/api/cards/${i.id}/messages/send`, { channel: 'whatsapp', whatsapp: wa.input.value }).catch(() => {});
              e.target.textContent = 'WhatsApp opened'; e.target.disabled = true;
            } }, 'WhatsApp'));
          } else row.append(el('span', 'p-muted p-small', 'No WhatsApp number.'));
          out.append(row);
        });
        sendAll.disabled = !(mail.ready && channel === 'email' && ready);
      } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); }
      check.disabled = false;
    });
    sendAll.addEventListener('click', async () => {
      if (!subject.input.value.trim()) { say('Write the subject first.', true); return; }
      if (!(await window.NiecUI.confirm(`Send this email to ${chosen.size} students?`, { confirmText: 'Send emails' }))) return;
      sendAll.disabled = true;
      try {
        const r = await api('/api/bulk/send-email', payload());
        const sent = r.results.filter((x) => x.status === 'sent').length;
        out.replaceChildren(el('div', `p-notice ${sent === r.results.length ? 'ok' : 'warn'}`, `${sent} of ${r.results.length} emails sent.`), ...r.results.filter((x) => x.status !== 'sent').map((x) => el('div', 'p-sent', `${x.name}: ${x.error || x.status}`)));
        say(`${sent} emails sent`);
      } catch (e) { out.replaceChildren(el('div', 'p-notice bad', e.message)); sendAll.disabled = false; }
    });
    view.replaceChildren(wrap);
  }
  start();
})();
