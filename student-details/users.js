// The Users page (users.html, Admin only): people and their access, and logged-in devices. Everything it changes is checked again by the server
// (shared/accounts.js) and recorded in the activity.
(function () {
  const $ = (id) => document.getElementById(id);
  const DEPARTMENTS = {
    application: { label: 'Application Team', help: 'Application Stage students, up to NOC Number and the Medical Report.' },
    mock: { label: 'Mock Team', help: 'Mock Stage students: mock interviews and Pre-CAS.' },
    followup: { label: 'Follow-up Team', help: 'Inquiry and Defer students: remarks and moving them on.' },
  };
  // A branch team for each branch in the one list (card-fields.js).
  window.CardFields.BRANCHES.forEach((name) => {
    DEPARTMENTS[name.toLowerCase().replace(/[^a-z0-9]+/g, '')] = { label: `${name} Branch`, help: `Its own students, every column. Adds students.` };
  });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  // "14 Nov 2026, 2:19 pm", as every date in Vishnu.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (iso) => { if (!iso) return 'Never'; const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}`; };
  const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  let me = null;
  let people = {}; // user id -> person, for the questions and the edit box

  async function api(url, body) {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
    return json;
  }

  function message(id, text, isError) {
    const el = $(id);
    el.textContent = text || '';
    el.className = 'msg' + (isError ? ' error' : '');
  }

  // ---- Access chooser (used when adding and when editing) ----
  // Tick any mix of the three teams and Manager. Admin is never offered.
  function accessFields(name) {
    const boxes = Object.entries(DEPARTMENTS).map(([id, d]) => `
      <label class="check"><input type="checkbox" name="${name}-dept" value="${id}"><span><b>${d.label}</b><small>${d.help}</small></span></label>`).join('');
    return `
      <fieldset class="access">
        <legend>Access (tick all that apply)</legend>
        <div class="check-group">
          ${boxes}
          <label class="check"><input type="checkbox" name="${name}-manager"><span><b>Manager</b><small>Sees every student and the Dashboard, exports to Excel. View only unless a team is ticked.</small></span></label>
          <label class="check check-student"><input type="checkbox" name="${name}-student"><span><b>Student (own portal)</b><small>For a student: their own portal only (their applications, where they are, mock interviews and the interview guides). Sees nothing else, no other student.</small></span></label>
        </div>
        <div class="student-pick" hidden>
          <span><b>Which student is this login for?</b><small>Their choices go to this student's University options, and the Application Team gets a task.</small></span>
          <input type="search" name="${name}-student-q" placeholder="Type the student's name, email or phone" autocomplete="off" aria-label="Find the student" />
          <div class="student-results" role="listbox"></div>
          <input type="hidden" name="${name}-student-row" />
          <div class="student-chosen"></div>
        </div>
        <label class="task-team" hidden>
          <span><b>Their own team</b><small>Their tasks, Today and Dashboard come from this team. Other ticked teams are extra access.</small></span>
          <select name="${name}-task-team"></select>
        </label>
      </fieldset>`;
  }

  // "Their own team" (the owner, 15 Nov 2026): asked once two or more teams are ticked. A person ticked in the Application and the Mock
  // Team who belongs to the Application Team gets only the Application Team's tasks, Today and dashboard; the Mock Team is extra
  // access. It must be chosen before saving (an older person without one gets every team's tasks until it is chosen).
  function drawTaskTeam(container, name, keep) {
    const ticked = [...container.querySelectorAll(`input[name="${name}-dept"]:checked`)].map((c) => c.value);
    const wrap = container.querySelector('.task-team');
    const select = container.querySelector(`select[name="${name}-task-team"]`);
    let was = keep !== undefined ? keep : select.value;
    // Ticking a second team keeps the first one as their own team, ready to change.
    if (!ticked.includes(was) && container.dataset.single && ticked.includes(container.dataset.single)) was = container.dataset.single;
    select.innerHTML = [['', 'Choose their team...'], ...ticked.map((d) => [d, (DEPARTMENTS[d] || { label: d }).label])]
      .map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    select.value = ticked.includes(was) ? was : '';
    wrap.hidden = ticked.length < 2;
    container.dataset.single = ticked.length === 1 ? ticked[0] : (select.value || '');
    wrap.classList.toggle('is-missing', ticked.length >= 2 && !select.value);
    select.onchange = () => wrap.classList.toggle('is-missing', !select.value);
  }
  // Refused before saving: a person in two or more teams with no team of their own.
  const missingOwnTeam = (container, name) => {
    const ticked = container.querySelectorAll(`input[name="${name}-dept"]:checked`).length;
    const select = container.querySelector(`select[name="${name}-task-team"]`);
    if (ticked < 2 || select.value) return false;
    container.querySelector('.task-team').classList.add('is-missing');
    select.focus();
    return true;
  };

  // A student's own login (the owner, 17 Nov 2026): ticking Student clears the teams and Manager, and asks which student it is for.
  function drawStudent(container, name) {
    const on = container.querySelector(`input[name="${name}-student"]`).checked;
    container.querySelectorAll(`input[name="${name}-dept"], input[name="${name}-manager"]`).forEach((c) => { if (on) c.checked = false; c.disabled = on; });
    container.querySelector('.student-pick').hidden = !on;
    if (on) drawTaskTeam(container, name, '');
  }
  function chooseStudent(container, name, s) {
    container.querySelector(`input[name="${name}-student-row"]`).value = s ? s.id : '';
    container.querySelector('.student-chosen').innerHTML = s ? `For: <b>${esc(s.name)}</b>${s.sub ? ` <span class="muted">${esc(s.sub)}</span>` : ''}` : '';
    container.querySelector('.student-results').innerHTML = '';
  }
  function wireAccess(container, name) {
    container.innerHTML = accessFields(name);
    container.querySelectorAll(`input[name="${name}-dept"]`).forEach((c) => c.addEventListener('change', () => drawTaskTeam(container, name)));
    container.querySelector(`input[name="${name}-student"]`).addEventListener('change', () => drawStudent(container, name));
    const q = container.querySelector(`input[name="${name}-student-q"]`);
    const results = container.querySelector('.student-results');
    let timer;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (q.value.trim().length < 2) { results.innerHTML = ''; return; }
        try {
          const r = await api('/api/students/search?q=' + encodeURIComponent(q.value.trim()));
          const list = (r.students || []).slice(0, 8).map((x) => ({ id: x.id, name: x.name, sub: [x.stage, x.intake, x.email].filter(Boolean).join(' · ') }));
          results.innerHTML = list.length ? list.map((x, i) => `<button type="button" class="student-result" data-i="${i}"><b>${esc(x.name)}</b><small>${esc(x.sub)}</small></button>`).join('') : '<div class="muted">No student found.</div>';
          results.querySelectorAll('.student-result').forEach((b) => b.addEventListener('click', () => { chooseStudent(container, name, list[Number(b.dataset.i)]); q.value = ''; }));
        } catch (e) { results.innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
      }, 200);
    });
    drawTaskTeam(container, name, '');
  }

  const readAccess = (container, name) => (container.querySelector(`input[name="${name}-student"]`).checked
    ? { role: 'student', studentRow: container.querySelector(`input[name="${name}-student-row"]`).value, departments: [] }
    : {
      role: '',
      manager: container.querySelector(`input[name="${name}-manager"]`).checked,
      departments: [...container.querySelectorAll(`input[name="${name}-dept"]:checked`)].map((c) => c.value),
      taskTeam: container.querySelector(`select[name="${name}-task-team"]`).value,
    });

  function setAccess(container, name, person) {
    container.querySelector(`input[name="${name}-student"]`).checked = person.role === 'student';
    drawStudent(container, name);
    chooseStudent(container, name, person.role === 'student' && person.studentRow ? { id: person.studentRow, name: person.studentName || 'the linked student', sub: '' } : null);
    container.querySelector(`input[name="${name}-manager"]`).checked = person.role === 'manager';
    container.querySelectorAll(`input[name="${name}-dept"]`).forEach((c) => { c.checked = (person.departments || []).includes(c.value); });
    drawTaskTeam(container, name, person.taskTeam || '');
  }

  wireAccess($('addAccess'), 'add');
  wireAccess($('editAccess'), 'edit');

  // ---- Tabs ----
  const tabs = ['people', 'devices'];
  function showTab(name) {
    tabs.forEach((t) => {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    });
    if (name === 'devices') loadSessions();
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* not important */ }
  }
  tabs.forEach((t) => $('tab-' + t).addEventListener('click', () => showTab(t)));

  // ---- Setup email results ----
  // What happened to the setup email, in a sentence, and whether the temporary password has to be shown.
  function showSetupResult(person, result) {
    const box = $('tempBox');
    const mail = result.email || {};
    let html;
    if (mail.status === 'sent') {
      html = `Login details sent to <b>${esc(mail.to)}</b>.`;
    } else {
      const why = {
        'no-address': 'No email address was entered for this person.',
        'not-configured': 'Email is not set up on the server yet.',
        failed: `The email could not be sent: ${esc(mail.error)}`,
      }[mail.status] || 'The email was not sent.';
      html = `${why}<br>Temporary password for <b>${esc(person)}</b>: <code>${esc(result.temporaryPassword)}</code><br>`
        + 'Give it in person. It works once and is not shown again.';
    }
    box.innerHTML = html;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  // ---- People ----
  function status(u) {
    if (u.disabled) return '<span class="pill pill-off">Disabled</span>';
    if (u.mustChangePassword) return '<span class="pill pill-wait">Not set up yet</span>';
    return '<span class="pill pill-ok">Active</span>';
  }

  // Their own team first (a solid chip), then the other teams as extra access ("+ Mock Team"); a person in two or more teams with no
  // own team chosen yet shows an orange "Own team not chosen", so it is noticed and set.
  function accessChips(u) {
    if (u.role === 'admin') return '<span class="chip chip-admin">Admin</span>';
    if (u.role === 'student') return `<span class="chip chip-student">Student, own portal</span>${u.studentName ? ` <span class="muted">${esc(u.studentName)}</span>` : ''}`;
    const depts = u.departments || [];
    const label = (d) => esc((DEPARTMENTS[d] || { label: d }).label);
    const own = u.taskTeam && depts.includes(u.taskTeam) ? u.taskTeam : (depts.length === 1 ? depts[0] : '');
    const teams = own
      ? `<span class="chip chip-${own}">${label(own)}</span>` + depts.filter((d) => d !== own).map((d) => `<span class="chip chip-extra" title="Extra access: sees and works on these students, gets no tasks">+ ${label(d)}</span>`).join('')
      : depts.map((d) => `<span class="chip chip-${d}">${label(d)}</span>`).join('');
    const warn = depts.length > 1 && !own ? ' <span class="chip chip-warn" title="Edit them and choose their own team, so they get only that team\'s tasks">Own team not chosen</span>' : '';
    return ((u.role === 'manager' ? '<span class="chip chip-manager">Manager</span>' : '') + teams || '<span class="muted">No team</span>') + warn;
  }

  async function loadUsers() {
    let users;
    try {
      users = await api('/api/users');
    } catch (e) {
      $('users').innerHTML = `<tr><td class="muted" colspan="6">${esc(e.message)}</td></tr>`;
      return;
    }
    people = Object.fromEntries(users.map((u) => [u.id, u]));
    $('peopleCount').textContent = users.filter((u) => !u.disabled).length;
    const row = (u) => {
      const self = me && u.id === me.id;
      const notSetUp = !u.disabled && u.mustChangePassword;
      const actions = self ? `<div class="actions"><button class="btn btn-sm" data-act="edit" data-id="${u.id}">Edit name or email</button><span class="muted">This is you</span></div>` : `
        <div class="actions">
          <button class="btn btn-sm" data-act="edit" data-id="${u.id}">Edit</button>
          <details class="row-more">
            <summary class="btn btn-sm" aria-label="More for ${esc(u.name)}" title="More">\u2026</summary>
            <div class="row-menu" role="menu">
              <button type="button" role="menuitem" data-act="reset-password" data-id="${u.id}">${notSetUp ? 'Resend setup email' : 'Reset password'}</button>
              <button type="button" role="menuitem" data-act="logout-everywhere" data-id="${u.id}">Log out everywhere</button>
              ${u.disabled
    ? `<button type="button" role="menuitem" data-act="enable" data-id="${u.id}">Enable</button>`
    : `<button type="button" role="menuitem" data-act="disable" data-id="${u.id}">Disable</button>`}
              <button type="button" role="menuitem" class="danger" data-act="remove" data-id="${u.id}">Remove</button>
            </div>
          </details>
        </div>`;
      return `<tr class="${u.disabled ? 'is-disabled' : ''}">
        <td><div class="who"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><span>${esc(u.username)}${u.email ? ' &middot; ' + esc(u.email) : ''}</span></div></div></td>
        <td data-label="Access"><div class="chips">${accessChips(u)}</div></td>
        <td data-label="Status">${status(u)}</td>
        <td data-label="Last login">${when(u.lastLoginAt)}</td>
        <td data-label="Devices">${u.loggedInDevices}</td>
        <td>${actions}</td>
      </tr>`;
    };
    // The team first; the students' own logins in a list of their own (the owner, 20 Nov 2026).
    const students = users.filter((u) => u.role === 'student');
    $('users').innerHTML = users.filter((u) => u.role !== 'student').map(row).join('') || '<tr><td class="muted" colspan="6">No one yet.</td></tr>';
    $('studentsCard').hidden = !students.length;
    $('studentUsers').innerHTML = students.map(row).join('');
  }

  const CONFIRM = {
    remove: (n) => `Remove ${n}? Their login is deleted and they are logged out everywhere. This cannot be undone.`,
    disable: (n) => `Disable ${n}? They are logged out until enabled again.`,
    'reset-password': (n, p) => (p.email
      ? `Email ${n} a new temporary password? Their current one stops working.`
      : `${n} has no email: the new temporary password is shown here for you to give them. Continue?`),
    'logout-everywhere': (n) => `Log ${n} out of every device?`,
  };

  const CONFIRM_TITLE = {
    remove: 'Remove this person?', disable: 'Disable this login?', 'reset-password': 'Give a new temporary password?',
    'logout-everywhere': 'Log out of every device?',
  };
  const CONFIRM_BUTTON = {
    remove: 'Remove', disable: 'Disable', 'reset-password': 'Reset password', 'logout-everywhere': 'Log out',
  };

  // One "…" menu open at a time; it closes when something outside it is clicked, or once a choice is made.
  const closeMenus = (except) => document.querySelectorAll('.row-more[open]').forEach((d) => { if (d !== except) d.open = false; });
  document.addEventListener('click', (e) => { closeMenus(e.target.closest('.row-more')); });
  // Both lists (the team and the students) answer the same buttons.
  $('panel-people').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    closeMenus(null);
    const person = people[btn.dataset.id];
    if (!person) return;
    if (btn.dataset.act === 'edit') { openEdit(person); return; }
    const ask = CONFIRM[btn.dataset.act];
    if (ask) {
      const danger = btn.dataset.act === 'remove' || btn.dataset.act === 'disable';
      const yes = await NiecUI.confirm(ask(person.name, person), { title: CONFIRM_TITLE[btn.dataset.act], confirmText: CONFIRM_BUTTON[btn.dataset.act], danger });
      if (!yes) return;
    }
    message('usersMsg', '');
    $('tempBox').hidden = true;
    try {
      const result = await api(`/api/users/${person.id}`, { action: btn.dataset.act });
      if (btn.dataset.act === 'reset-password') showSetupResult(person.name, result);
      else message('usersMsg', btn.dataset.act === 'remove' ? `${person.name} was removed.` : 'Done.');
    } catch (err) {
      message('usersMsg', err.message, true);
    }
    refresh();
  });

  // ---- Add ----
  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    message('addMsg', '');
    $('tempBox').hidden = true;
    if (missingOwnTeam($('addAccess'), 'add')) { message('addMsg', 'Choose their own team: the team whose tasks they get.', true); return; }
    const access = readAccess($('addAccess'), 'add');
    try {
      const result = await api('/api/users', {
        name: $('addName').value, username: $('addUsername').value, email: $('addEmail').value, ...access,
      });
      message('addMsg', `${result.user.name} was added: ${result.user.accessLabel}${result.user.taskTeam ? `, their own team is the ${result.user.roleLabel}` : ''}.`);
      showSetupResult(result.user.name, result);
      $('addForm').reset();
      wireAccess($('addAccess'), 'add');
    } catch (err) {
      message('addMsg', err.message, true);
    }
    refresh();
  });

  // ---- Edit ----
  let editing = null;
  function openEdit(person) {
    editing = person;
    $('editName').value = person.name;
    $('editEmail').value = person.email || '';
    setAccess($('editAccess'), 'edit', person);
    $('editAccess').hidden = person.role === 'admin'; // the Admin's access never changes
    $('editNote').textContent = 'Changing access logs the person out.';
    $('editDialog').showModal();
  }
  $('editCancel').addEventListener('click', () => $('editDialog').close());
  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editing) return;
    if (editing.role !== 'admin' && missingOwnTeam($('editAccess'), 'edit')) { $('editNote').textContent = 'Choose their own team: the team whose tasks they get.'; return; }
    try {
      await api(`/api/users/${editing.id}`, {
        // The Admin's access never changes, so only their name and email are sent (the server refuses any access change).
        action: 'update-person', name: $('editName').value, email: $('editEmail').value, ...(editing.role === 'admin' ? {} : readAccess($('editAccess'), 'edit')),
      });
      $('editDialog').close();
      message('usersMsg', `${editing.name} was updated.`);
    } catch (err) {
      $('editNote').textContent = err.message;
      return;
    }
    refresh();
  });

  // ---- Devices ----
  async function loadSessions() {
    let list;
    try {
      list = await api('/api/sessions');
    } catch (e) {
      $('sessions').innerHTML = `<tr><td class="muted" colspan="6">${esc(e.message)}</td></tr>`;
      return;
    }
    $('devicesCount').textContent = list.length;
    $('sessions').innerHTML = list.map((s) => `<tr>
      <td><b>${esc(s.user)}</b>${s.current ? ' <span class="muted">(this device)</span>' : ''}</td>
      <td data-label="Device">${esc(s.device)}</td>
      <td data-label="IP address">${esc(s.ip)}</td>
      <td data-label="Logged in">${when(s.created)}</td>
      <td data-label="Last active">${when(s.lastSeen)}</td>
      <td>${s.current ? '' : `<div class="actions"><button class="btn btn-sm" data-end="${s.id}">Log out</button></div>`}</td>
    </tr>`).join('') || '<tr><td class="muted" colspan="6">No one is logged in.</td></tr>';
  }

  $('sessions').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-end]');
    if (!btn) return;
    try {
      await api(`/api/sessions/${btn.dataset.end}/end`, {});
    } catch (err) {
      message('sessionsMsg', err.message, true);
    }
    refresh();
  });

  $('endOthers').addEventListener('click', async () => {
    const yes = await NiecUI.confirm('They will need to log in again.', { title: 'Log out everyone except you?', confirmText: 'Log them out', danger: true });
    if (!yes) return;
    try {
      await api('/api/sessions/end-others', {});
      message('sessionsMsg', 'Everyone else has been logged out.');
    } catch (err) {
      message('sessionsMsg', err.message, true);
    }
    refresh();
  });

  const refresh = () => Promise.all([loadUsers(), loadSessions()]);
  api('/api/me').then((user) => { me = user; }).catch(() => {}).finally(() => {
    refresh();
    const start = location.hash.slice(1);
    if (tabs.includes(start)) showTab(start);
  });
})();
