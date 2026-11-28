// "Assign a task": one window, the same on a student's card and on a branch's Today (the owner, 27 Nov 2026).
// window.AssignTask.open({ data, save, head }) shows it and answers true once the task is given.
//   data: what the student's card answers (assignTeams, taskTeams, card.options)
//   save(payload): gives the task; head(close), optional: something to show above the form (whose task it is)
(function (root) {
  'use strict';
  const calm = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function open({ data, save, head }) {
    const { el, h, api, field, dialog } = root.Portal;
    const say = (text, error) => root.NiecUI.toast(text, { type: error ? 'error' : 'success' });
    // A gentle shake for a mistake, so the eye finds the message.
    const shake = (node) => { if (!node || calm() || !node.animate) return; node.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'ease-out' }); };
    // A button that says what it is doing: "Assigning…" while it works, then a tick and "Assigned" for a moment.
    const morph = async (btn, work, { busy, done }) => {
      const was = [...btn.childNodes];
      btn.disabled = true; btn.classList.add('is-busy');
      btn.replaceChildren(el('span', 'sc-spin'), busy);
      try {
        const [out] = await Promise.all([work(), new Promise((r) => setTimeout(r, calm() ? 0 : 320))]);
        btn.classList.remove('is-busy'); btn.classList.add('is-done');
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        tick.setAttribute('viewBox', '0 0 24 24'); tick.setAttribute('aria-hidden', 'true'); tick.setAttribute('class', 'sc-btn-ico sc-tick');
        tick.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
        btn.replaceChildren(tick, done);
        await new Promise((r) => setTimeout(r, calm() ? 0 : 1000));
        return out;
      } catch (e) {
        btn.classList.remove('is-busy'); btn.disabled = false; btn.replaceChildren(...was); shake(btn);
        throw e;
      }
    };
    return dialog('Assign a task', (body, close) => {
      // Which team and what to do: no date to do it by (the owner, 14 Nov 2026). The team asks for anything it needs in the
      // task's comments, and ticks it when it is done.
      // A team, or Admin (named with their title): the teams and branches can give Admin a task too.
      // The owner is not offered (the owner, 25 Nov 2026: a task cannot be given to the owner from here).
      const targets = (data.assignTeams || data.taskTeams || []).filter((t) => t.id !== 'head').map((t) => [t.id, t.label]);
      const team = field('Who should do it?', { kind: 'select', choices: targets, value: targets.length === 1 ? targets[0][0] : '', required: true });
      // Exactly who gets it (the owner, 15 Nov 2026): the people whose own team it is.
      const goes = el('div', 'p-goes');
      const showGoes = () => {
        const t = (data.assignTeams || data.taskTeams || []).find((x) => x.id === team.input.value);
        goes.replaceChildren();
        if (!t) return;
        const names = t.members || [];
        goes.append(names.length ? `Goes to ${names.join(', ')}` : 'Nobody has this team yet: set it in Users.');
        goes.classList.toggle('is-warn', !names.length);
      };
      team.wrap.append(goes);
      team.input.addEventListener('change', showGoes);
      showGoes();
      // What it is about first, required (the owner, 20 Nov 2026). An Application task then asks, each required with a red *: the
      // university (every university in Universities), the intake, the course level, the location (when it teaches in more than one
      // place) and the course, from the university's own list; then optional comments. Mock interview, Documents, NOC and Medical ask
      // for comments only (the owner, 20 Nov 2026); Other asks for them too, and needs them, since it says nothing by itself.
      // The kinds follow the team the task goes to: the Application Team gets Application, Documents, NOC, Medical and Other; the Mock Team Mock interview, Feedback, Final interview booking and Pre-CAS interview result; a branch Documents, Student update and Payment update.
      const KIND_LABEL = { application: 'Application', documents: 'Documents', noc: 'NOC', medical: 'Medical', other: 'Other', mock: 'Mock interview', 'mock-feedback': 'Feedback', 'mock-booking': 'Date booking', 'mock-precas': 'Pre-CAS result', 'branch-update': 'Student update', 'branch-payment': 'Payment update' };
      const KIND_SAVES = { 'branch-update': ['other', 'Student update'], 'branch-payment': ['payment', 'Payment update'] };
      const kindsFor = (teamId) => {
        const t = (data.assignTeams || data.taskTeams || []).find((x) => x.id === teamId) || {};
        const ids = teamId === 'application' ? ['application', 'documents', 'noc', 'medical', 'other']
          : teamId === 'mock' ? ['mock', 'mock-feedback', 'mock-booking', 'mock-precas']
          : /branch$/i.test(String(t.label || '')) ? ['documents', 'branch-update', 'branch-payment']
          : ['application', 'documents', 'mock', 'noc', 'medical', 'other'];
        return ids.map((k) => [k, KIND_LABEL[k]]);
      };
      let tag = window.Portal.tagPicker('', kindsFor(team.input.value));
      const tagWrap = el('div', 'p-field p-wide');
      const tagLabel = el('span', 'p-label', 'What is it about?');
      tagLabel.append(window.Portal.requiredMark());
      tagWrap.append(tagLabel, tag.node);
      const text = field('Comments', { kind: 'area', max: 2000, wide: true, placeholder: 'e.g. Ask for the bank statement.' });
      const textLabel = text.wrap.querySelector('.p-label');
      const otherMark = window.Portal.requiredMark();
      // The application fields.
      const appBox = el('div', 'p-form p-assign-app p-wide');
      const uni = field('University', { kind: 'select', choices: [], required: true });
      const intake = field('Intake', { kind: 'select', choices: [], required: true });
      const level = field('Course level', { kind: 'select', choices: [], required: true });
      const place = field('Location', { kind: 'select', choices: [], required: true });
      const course = field('Course', { kind: 'select', choices: [], required: true });
      const comments = field('Comments', { kind: 'area', max: 1500, wide: true, placeholder: 'e.g. Please submit the application to this university.' });
      comments.input.rows = 2;
      appBox.append(uni.wrap, intake.wrap, level.wrap, place.wrap, course.wrap, comments.wrap);
      const fill = (f, list, keep) => { const was = keep ? f.input.value : ''; f.input.replaceChildren(h('option', { value: '' }, 'Choose\u2026'), ...list.map((x) => h('option', { value: x }, x))); f.input.value = list.includes(was) ? was : list.length === 1 ? list[0] : ''; };
      let choices = null;
      let unis = [];
      const coursesNow = () => (choices ? choices.courses.filter((c) => (!intake.input.value || !c.start || c.start.includes(intake.input.value)) && (!level.input.value || c.level === level.input.value) && (!place.input.value || !c.campus || c.campus === place.input.value)) : []);
      const refreshCourses = () => { fill(course, [...new Set(coursesNow().map((c) => c.name))].sort((a, b) => a.localeCompare(b)), true); };
      uni.input.addEventListener('change', async () => {
        choices = null; [intake, level, place, course].forEach((f) => fill(f, []));
        if (!uni.input.value) return;
        try { choices = await api(`/api/facts/${encodeURIComponent(uni.input.value)}/choices`); } catch (e) { choices = { intakes: window.IntakeWindow ? [window.IntakeWindow.of().label] : [], levels: [], campuses: [], courses: [] }; }
        fill(intake, choices.intakes); fill(level, choices.levels); fill(place, choices.campuses);
        place.wrap.hidden = choices.campuses.length < 2; // one place: nothing to choose
        refreshCourses();
      });
      intake.input.addEventListener('change', refreshCourses);
      level.input.addEventListener('change', refreshCourses);
      place.input.addEventListener('change', refreshCourses);
      api('/api/facts').then((list) => { unis = list.sort((a, b) => a.name.localeCompare(b.name)); uni.input.replaceChildren(h('option', { value: '' }, 'Choose\u2026'), ...unis.map((u) => h('option', { value: u.id }, u.name))); }).catch(() => {});
      const isApp = () => tag.value() === 'application';
      // NOC and Medical are always for one university (the owner, 25 Nov 2026): the student may hold offers from several, so the university the task is for is chosen here (the ones with an offer first).
      const forUni = field('Which university is it for?', { kind: 'select', choices: [], required: true, wide: true });
      const uniChoices = (() => { const all = (data.card.options || []).filter((o) => o.university && o.course); const withOffer = all.filter((o) => o.offer && !o.refused && !o.withdrawn); return withOffer.length ? withOffer : all.filter((o) => o.applied || o.sent); })();
      forUni.input.replaceChildren(h('option', { value: '' }, 'Choose\u2026'), ...uniChoices.map((o, i) => h('option', { value: String(i) }, o.university + (o.course ? ' (' + o.course + ')' : '') + (o.offer ? ' - offer received' : ''))));
      if (uniChoices.length === 1) forUni.input.value = '0';
      forUni.wrap.hidden = true;
      const needsUni = () => ['noc', 'medical'].includes(tag.value()) && uniChoices.length > 0;
      const showKind = () => {
        const a = isApp(); const k = tag.value();
        appBox.hidden = !a; text.wrap.hidden = a || !k; forUni.wrap.hidden = !needsUni();
        if (k === 'other') { if (textLabel && !otherMark.isConnected) textLabel.append(otherMark); } else otherMark.remove();
        const hints = { mock: 'e.g. Book the mock interview for Tuesday.', documents: 'e.g. Ask for the bank statement.', noc: 'e.g. Apply for the NOC this week.', medical: 'e.g. Book the TB test at the clinic.', other: 'What should they do?' };
        text.input.placeholder = hints[k] || '';
      };
      const bindTag = () => tag.node.addEventListener('click', () => setTimeout(showKind, 0));
      bindTag();
      team.input.addEventListener('change', () => { const was = tag.node; tag = window.Portal.tagPicker('', kindsFor(team.input.value)); was.replaceWith(tag.node); bindTag(); showKind(); });
      const msg = el('div', 'p-msg');
      const foot = el('div', 'p-dialog-foot');
      const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Assign');
      ok.addEventListener('click', async () => {
        const stop = (t, f) => { msg.textContent = t; msg.className = 'p-msg error'; shake(msg); if (f) { f.classList.add('sc-bad'); shake(f); const off = () => f.classList.remove('sc-bad'); f.addEventListener('change', off, { once: true }); f.addEventListener('click', off, { once: true }); } };
        if (!team.input.value) return stop('Choose who should do it.', team.wrap);
        if (!tag.value()) return stop('Choose what it is about.', tagWrap);
        let payload;
        if (isApp()) {
          const need = [[uni, 'the university'], [intake, 'the intake'], [level, 'the course level'], ...(place.wrap.hidden ? [] : [[place, 'the location']]), [course, 'the course']].find(([f]) => !f.input.value);
          if (need) return stop(`Choose ${need[1]}.`, need[0].wrap);
          const uName = (unis.find((u) => u.id === uni.input.value) || {}).name || '';
          const loc = place.input.value || (choices && choices.campuses.length === 1 ? choices.campuses[0] : '');
          const app = { university: uName, universityId: uni.input.value, intake: intake.input.value, level: level.input.value, location: loc, course: course.input.value };
          const line = [uName, app.intake, app.level, loc, app.course].filter(Boolean).join(' · ');
          payload = { team: team.input.value, tag: 'application', app, text: `Submit the application: ${line}${comments.input.value.trim() ? `\n${comments.input.value.trim()}` : ''}` };
        } else {
          const words = text.input.value.trim();
          if (!words && tag.value() === 'other') return stop('Write what should be done.', text.wrap);
          const saves = KIND_SAVES[tag.value()];
          // No comments: the task is named by what it is about ("Mock interview"), so the team still sees what to do.
          let forApp = null;
          if (needsUni()) {
            const o = uniChoices[Number(forUni.input.value)];
            if (!o || forUni.input.value === '') return stop('Choose which university it is for.', forUni.wrap);
            forApp = { university: o.university, course: o.course, intake: o.intake || '', level: o.level || '' };
          }
          const base = words || (forApp ? (tag.value() === 'noc' ? 'Submit the NOC application' : 'Book the medical report') + ': ' + forApp.university : saves ? saves[1] : window.Portal.tagLabel(tag.value()));
          payload = { team: team.input.value, text: base, tag: saves ? saves[0] : tag.value(), ...(forApp ? { app: forApp } : {}) };
        }
        try { await morph(ok, () => save(payload), { busy: 'Assigning…', done: 'Assigned' }); window.Portal.celebrate(ok); say('Task assigned. The team is told.'); close(true); } catch (e) { /* shown */ }
      });
      foot.append(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), ok);
      const g = el('div', 'p-form p-assign'); g.append(team.wrap, tagWrap, appBox, forUni.wrap, text.wrap);
      if (head) body.append(head(close));
      body.append(g, msg, foot);
      showKind();
    });
  }

  root.AssignTask = { open };
}(this));
