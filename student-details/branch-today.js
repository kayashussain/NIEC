// "Assign a task" on a branch's Today (the owner, 27 Nov 2026): it starts and ends there. Choose the student, then the same window as
// on the student's card (assign-task.js). The rest of that Today is today-page.js, in the Application Team's look. window.BranchToday.
(function (root) {
  'use strict';

  const P = () => root.Portal;
  const el = (...a) => P().el(...a);
  const h = (...a) => P().h(...a);
  const nice = (v) => P().niceName(v);

  // "Assign a task": the student first, then the same window as on the student's card. Answers the student's number once given.
  async function assign() {
    const { api, dialog, initials } = P();
    for (;;) {
      const student = await dialog('Assign a task', (body, close) => {
        const input = h('input', { type: 'search', class: 'bt-find-box', placeholder: 'Name, phone, email or university', autocomplete: 'off', 'aria-label': 'Which student is it about?' });
        const out = el('div', 'bt-find');
        out.setAttribute('aria-live', 'polite');
        body.append(el('p', 'bt-find-ask', 'Which student is it about?'), input, out);
        let timer = null; let asked = 0;
        const find = async () => {
          const turn = ++asked;
          let found = [];
          try { found = (await api(`/api/students/search?q=${encodeURIComponent(input.value.trim())}`)).students || []; } catch (e) { out.replaceChildren(el('p', 'bt-find-none', e.message)); return; }
          if (turn !== asked) return; // an older answer arriving late is dropped
          if (!found.length) { out.replaceChildren(el('p', 'bt-find-none', 'No student of yours matches.')); return; }
          out.replaceChildren(...found.map((s) => {
            const b = h('button', { type: 'button', class: 'bt-find-row', onclick: () => close(s) });
            const av = el('span', 'bt-av', initials(s.name));
            av.setAttribute('aria-hidden', 'true');
            const words = el('span', 'bt-row-words');
            words.append(el('span', 'bt-row-name', nice(s.name)), el('span', 'bt-row-meta', [s.stage, s.university, s.intake].filter(Boolean).join(' · ')));
            b.append(av, words);
            return b;
          }));
        };
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, 180); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = out.querySelector('button'); if (first) first.click(); } });
        find();
      });
      if (!student) return '';
      let data;
      try { data = await api(`/api/cards/${encodeURIComponent(student.id)}`); } catch (e) { root.NiecUI.toast(e.message, { type: 'error' }); return ''; }
      if (!data.can || !data.can.assign) { root.NiecUI.toast('A task cannot be given about this student at the moment.', { type: 'error' }); continue; }
      let again = false;
      const given = await root.AssignTask.open({
        data,
        save: async (payload) => {
          try { return await api(`/api/cards/${encodeURIComponent(student.id)}/tasks`, payload); } catch (e) { root.NiecUI.toast(e.message, { type: 'error' }); throw e; }
        },
        head: (close) => {
          const line = el('div', 'bt-about');
          const av = el('span', 'bt-av', initials(student.name));
          av.setAttribute('aria-hidden', 'true');
          const words = el('span', 'bt-row-words');
          words.append(el('span', 'bt-row-name', nice(student.name)), el('span', 'bt-row-meta', [student.stage, student.intake].filter(Boolean).join(' · ')));
          line.append(av, words, h('button', { type: 'button', class: 'bt-change', onclick: () => { again = true; close(); } }, 'Change'));
          return line;
        },
      });
      if (!again) return given ? student.id : '';
    }
  }

  root.BranchToday = { assign };
}(this));
