// The Add student window on the sheet: the student's name and contact, and where the student came from (always tagged with the same
// words, a missing platform or event can be added on the spot). The student is added to the sheet the person is
// on, and the rest of what is known stays on the student card.
// window.NewStudent.open({ me, activeSheetId, defaultStage }) resolves with { id } once the student is added, or undefined.
(function (root) {
  const { el, h, api, field, dialog } = root.Portal;
  const F = root.CardFields;

  async function open({ me, activeSheetId = '', sheetName = '', defaultStage = 'Inquiry' } = {}) {
    let lists = { sourceOptions: {}, sourceLabels: F.SOURCE_DETAIL_LABEL, sourceCanAdd: F.SOURCE_CAN_ADD, partners: [], stages: [], departments: [] };
    try { lists = { ...lists, ...(await api('/api/card-lists')) }; } catch (e) { /* the form still works with the starting choices */ }
    const admin = me && me.role === 'admin';
    // An Admin adds to the sheet on screen; any other account's students always go into the current intake.
    const where = admin ? sheetName : (lists.currentIntakeName || '');
    return dialog(where ? `New student for ${where}` : 'New student', (body, close) => {
      const inputs = {};
      const form = el('div');
      const group = (title, ...fields) => { form.append(el('h3', '', title)); const g = el('div', 'p-form p-form-2'); fields.forEach((x) => g.append(x.wrap)); form.append(g); };
      const make = (key, label, opts) => { const x = field(label, opts); inputs[key] = x.input; return x; };

      // Short and to the point (the owner, 20 Nov 2026): the student, then the source. Required, with a red *: first and last name, email,
      // WhatsApp number and the source. No nationality, no note, no explanations; a new student starts at the Application stage.
      const stage = admin ? [make('stage', 'Stage', { kind: 'select', choices: lists.stages.length ? lists.stages : [defaultStage], value: lists.stages.includes(defaultStage) || !lists.stages.length ? defaultStage : lists.stages[0] })]
        : lists.departments.length > 1 ? [make('dept', 'Team', { kind: 'select', choices: lists.departments.map((d) => [d.id, d.label]), value: lists.departments[0].id })] : [];
      group('Student', make('FIRST NAME', 'First name', { max: 80, required: true }), make('LAST NAME', 'Last name', { max: 80, required: true }),
        make('EMAIL', 'Email', { max: 254, required: true, placeholder: 'student@example.com' }), make('CONTACT NUMBER', 'WhatsApp number', { required: true, max: 40, placeholder: '98XXXXXXXX' }),
        make('dob', 'Date of birth', { kind: 'date' }), make('passportNo', 'Passport number', { max: 20, placeholder: 'PA1234567' }),
        make('address', 'Address', { max: 200, placeholder: 'Butwal-11, Rupandehi' }), ...stage);
      inputs.dob.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); // a date of birth is never in the future; the calendar's years end this year

      // Where the student came from: the source, then exactly which (the branch, the agent, the event ...). The choices are shared: a missing one is added once.
      // A branch account adds its own students, so the source is not asked: the server tags them with the branch.
      const branchOnly = !admin && lists.departments.length > 0 && lists.departments.every((d) => d.source);
      const picker = branchOnly ? null : root.SourcePicker.create({ lists, hideBranch: !admin, required: true });
      if (picker) { form.append(el('h3', '', 'Source')); const g = el('div', 'p-form p-form-2'); picker.nodes.forEach((n) => g.append(n)); form.append(g); }
      body.append(form);

      const msg = el('div', 'p-msg'); msg.setAttribute('role', 'alert'); // read out by a screen reader
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save student');
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      body.append(msg, foot);
      let allowDuplicate = false; // set by "Add anyway (a different person)"
      form.addEventListener('input', () => { allowDuplicate = false; });
      ok.addEventListener('click', async () => {
        const v = (k) => (inputs[k] ? inputs[k].value : '');
        const need = [['FIRST NAME', 'First name'], ['LAST NAME', 'Last name'], ['EMAIL', 'Email']].find(([k]) => !v(k).trim());
        if (need) { msg.textContent = `${need[1]} is needed.`; msg.className = 'p-msg error'; inputs[need[0]].focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('EMAIL').trim())) { msg.textContent = 'That email does not look right.'; msg.className = 'p-msg error'; inputs.EMAIL.focus(); return; }
        // Where the student came from must be complete (the event, or the campaign answer), so the student counts in its cost.
        // Needed so every student can be reached and counted (the owner, 18 Nov 2026): a WhatsApp number and where the student came from.
        if (!v('CONTACT NUMBER').trim()) { msg.textContent = 'WhatsApp number is needed.'; msg.className = 'p-msg error'; inputs['CONTACT NUMBER'].focus(); return; }
        if (picker && !picker.value().source) { msg.textContent = 'Source is needed.'; msg.className = 'p-msg error'; return; }
        const missing = picker ? picker.check() : '';
        if (missing) { msg.textContent = missing; msg.className = 'p-msg error'; return; }
        ok.disabled = true;
        const dlg = ok.closest('dialog'); if (dlg) dlg.dataset.busy = '1'; // Escape, the X and a click outside wait until the save is answered
        msg.textContent = 'Saving…';
        msg.className = 'p-msg';
        const fields = {};
        ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER'].forEach((k) => { fields[k] = v(k); });
        const pick = picker ? picker.value() : { source: '', detail: '', remarks: '' };
        fields['STUDENT SOURCE'] = pick.source;
        try {
          const r = await api('/api/students/new', { fields, profile: { sourceDetail: pick.detail, sourceRemarks: pick.remarks, sourcePlatform: pick.platform || '', sourceWay: pick.way || '', dob: v('dob'), passportNo: v('passportNo').trim().toUpperCase(), address: v('address').trim() }, stage: v('stage'), sheetId: activeSheetId, dept: v('dept'), allowDuplicate, strict: true });
          close(r);
        } catch (e) {
          const dup = e.body && e.body.duplicate;
          ok.disabled = false;
          if (dlg) delete dlg.dataset.busy;
          if (!dup) { msg.textContent = e.message; msg.className = 'p-msg error'; ok.focus(); return; }
          // Already in Vishnu: never a second copy. Open them, or fill in only what is blank on them (nothing already there is replaced).
          msg.className = 'p-msg ns-dup';
          if (dup.name) msg.replaceChildren(el('b', '', `${dup.name} is already in Vishnu`), el('span', '', ` (${dup.intake}, ${dup.stage || 'no stage'}${dup.source ? ', ' + dup.source : ''}), ${dup.sameName ? 'with exactly the same name.' : `with this ${dup.maybeOther ? 'phone number, under another name' : 'email or phone number'}.`}`));
          else msg.replaceChildren(el('b', '', 'A student is already in Vishnu with this phone number, under another name.'));
          const row = el('div', 'p-bar');
          if (dup.id) row.append(h('button', { class: 'btn', type: 'button', onclick: () => { close(); location.href = '/student?id=' + encodeURIComponent(dup.id); } }, 'Open their card'));
          // The same phone and another first name: maybe a brother or sister on the family phone. The person decides.
          if (dup.maybeOther) row.append(h('button', { class: 'btn', type: 'button', onclick: () => { allowDuplicate = true; ok.click(); } }, 'Add anyway (a different person)'));
          if (dup.canFill) {
            row.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              try {
                // What is in the form now (it may have been edited since the warning).
                const now = {}; ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER'].forEach((k) => { now[k] = v(k); });
                const p2 = picker ? picker.value() : { source: '', detail: '', remarks: '' };
                now['STUDENT SOURCE'] = p2.source;
                const r = await api('/api/students/merge', { id: dup.id, fields: now, profile: { sourceDetail: p2.detail, sourceRemarks: p2.remarks, sourcePlatform: p2.platform || '', sourceWay: p2.way || '', dob: v('dob'), passportNo: v('passportNo').trim().toUpperCase(), address: v('address').trim() } });
                window.NiecUI.toast(r.filled.length ? `Filled in ${r.filled.length} missing detail${r.filled.length === 1 ? '' : 's'} on ${dup.name}${r.differs.length ? '; the different ones are in a note on the card' : ''}.` : `Nothing was missing on ${dup.name}${r.differs.length ? '; the different details are in a note on the card' : ''}.`, { type: 'success' });
                close({ id: dup.id, merged: true });
              } catch (err) { msg.textContent = err.message; msg.className = 'p-msg error'; }
            } }, 'Fill in what is missing'));
          }
          msg.append(row);
        }
      });
      form.addEventListener('input', () => { if (msg.classList.contains('error')) { msg.textContent = ''; msg.className = 'p-msg'; } });
      setTimeout(() => inputs['FIRST NAME'].focus(), 30);
    });
  }
  root.NewStudent = { open };
})(this);
