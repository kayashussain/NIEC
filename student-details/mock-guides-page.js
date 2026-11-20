// Mock interviews (the owner, 20 Nov 2026; see mock-guides.js and mock-api.js on the server): the guides students read in their
// portal. The Mock Team, the Manager and Admin write a guide's draft; only Admin publishes it to students, and can take it back.
// "Preview as a student" shows the draft exactly as a student will read it. "To check" notes are the team's own, never shown to a
// student. Text: a line starting "## " is a heading, "- " a point, "1. " a numbered step, a blank line a new paragraph.
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, api, when, dialog } = window.Portal;
  const STATUS = { empty: ['Empty', 'is-empty'], draft: ['Draft, not published', 'is-draft'], published: ['Published to students', 'is-live'], changed: ['Published, with changes not published yet', 'is-changed'] };
  let data = { canPublish: false, phases: [], guides: [], universities: [] };
  let open = null; // the guide being edited

  function say(text, error) { const m = $('msg'); m.textContent = text || ''; m.className = 'p-msg' + (error ? ' error' : ''); }

  function drawList() {
    $('guideEditor').hidden = true;
    $('list').hidden = false;
    $('intro').hidden = false;
    // Start a guide for a Partner University that has none.
    const start = $('start');
    start.replaceChildren();
    if (data.universities.length) {
      const sel = el('select', 'p-input');
      sel.setAttribute('aria-label', 'University for a new guide');
      sel.append(el('option', '', 'Start a guide for…'));
      data.universities.forEach((n) => { const o = el('option', '', n); o.value = n; sel.append(o); });
      sel.addEventListener('change', async () => {
        if (!sel.value || sel.selectedIndex === 0) return;
        try { const g = await api('/api/mock-guides', { name: sel.value }); await load(); edit(g.key); } catch (e) { say(e.message, true); sel.selectedIndex = 0; }
      });
      start.append(sel);
    }
    if (!data.guides.length) { $('list').replaceChildren(el('p', 'p-muted', 'No guides yet.')); return; }
    $('list').replaceChildren(...data.guides.map((g, i) => {
      const card = el('button', 'mg-card');
      card.type = 'button';
      card.style.setProperty('--i', String(i));
      const [label, cls] = STATUS[g.status] || STATUS.draft;
      card.append(el('span', `mg-status ${cls}`, label), el('h2', 'mg-name', g.key === 'core' ? 'Every university' : g.name), el('p', 'mg-summary', g.key === 'core' ? 'What every student reads first: the UK, the interview, the questions every university asks, how answers are judged, the day itself.' : (g.summary || 'No summary yet.')));
      const meta = el('p', 'mg-meta');
      meta.textContent = [g.publishedAt ? `Published ${when(g.publishedAt)}` : '', g.updatedBy ? `Last saved by ${g.updatedBy}, ${when(g.updatedAt)}` : '', g.toCheck ? `${g.toCheck} to check` : ''].filter(Boolean).join(' · ');
      card.append(meta);
      card.addEventListener('click', () => edit(g.key));
      return card;
    }));
  }

  // A list of rows (videos, links, questions), each with its boxes and a Remove button, and an Add button.
  function rows(list, fields, addLabel) {
    const box = el('div', 'mg-rows');
    const items = el('div');
    const row = (v) => {
      const r = el('div', 'mg-row');
      fields.forEach(([k, ph, big]) => {
        const i = el(big ? 'textarea' : 'input', 'p-input');
        i.placeholder = ph;
        i.value = v[k] || '';
        i.dataset.k = k;
        if (big) i.rows = 3;
        r.append(i);
      });
      const x = el('button', 'btn btn-sm mg-remove', 'Remove');
      x.type = 'button';
      x.addEventListener('click', () => r.remove());
      r.append(x);
      items.append(r);
    };
    list.forEach(row);
    const add = el('button', 'btn btn-sm', addLabel);
    add.type = 'button';
    add.addEventListener('click', () => row({}));
    box.append(items, add);
    box.read = () => [...items.children].map((r) => Object.fromEntries([...r.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])));
    return box;
  }

  async function edit(key) {
    say('');
    let g;
    try { g = await api(`/api/mock-guides/${encodeURIComponent(key)}`); } catch (e) { say(e.message, true); return; }
    open = g;
    $('list').hidden = true;
    $('intro').hidden = true;
    $('start').replaceChildren();
    const ed = $('guideEditor');
    ed.hidden = false;
    const back = el('button', 'btn mg-back', '‹ All guides');
    back.type = 'button';
    back.addEventListener('click', () => load());
    const head = el('div', 'mg-ed-head');
    const [label, cls] = STATUS[g.status] || STATUS.draft;
    head.append(back, el('h2', '', g.key === 'core' ? 'Every university' : g.name), el('span', `mg-status ${cls}`, label));
    const form = el('div', 'mg-form');
    const core = g.key === 'core';
    const summary = el('input', 'p-input');
    summary.value = g.draft.summary || '';
    summary.placeholder = 'One line: how this university runs its interview';
    if (!core) form.append(field('Summary', summary));
    const phaseBoxes = {};
    data.phases.forEach((p, i) => {
      if (!core && p.key === 'welcome' && !g.draft.phases.welcome.body) return; // a university adds to the welcome only if it wants to
      const panel = el('section', 'mg-phase');
      panel.append(el('h3', '', `${i + 1}. ${p.title}`));
      const body = el('textarea', 'p-input mg-body');
      body.rows = p.key === 'university' || core ? 12 : 6;
      body.value = g.draft.phases[p.key].body || '';
      body.placeholder = core ? 'What every student reads in this phase' : `What is different at ${g.name} in this phase (added under the general text)`;
      const videos = rows(g.draft.phases[p.key].videos, [['title', 'Video title'], ['url', 'YouTube link']], 'Add a video');
      const links = rows(g.draft.phases[p.key].links, [['title', 'Title'], ['url', 'https://…']], 'Add a link');
      panel.append(body, el('h4', '', 'Videos'), videos, el('h4', '', 'Links'), links);
      phaseBoxes[p.key] = { body, videos, links };
      form.append(panel);
    });
    const qPanel = el('section', 'mg-phase');
    const questions = rows(g.draft.questions, [['group', 'Group, e.g. Money'], ['q', 'The question'], ['tip', 'What a strong answer covers', true]], 'Add a question');
    qPanel.append(el('h3', '', core ? 'Questions every university asks' : `Questions ${g.name} asks`), questions);
    form.append(qPanel);
    const check = el('textarea', 'p-input');
    check.rows = 3;
    check.value = (g.confirm || []).join('\n');
    check.placeholder = 'One per line. Never shown to a student.';
    form.append(field('To check (the team only)', check));

    const read = () => {
      const phases = {};
      data.phases.forEach((p) => {
        const b = phaseBoxes[p.key];
        phases[p.key] = b ? { body: b.body.value, videos: b.videos.read(), links: b.links.read() } : g.draft.phases[p.key];
      });
      return { draft: { summary: core ? '' : summary.value, phases, questions: questions.read() }, confirm: check.value };
    };
    const bar = el('div', 'mg-bar');
    const save = el('button', 'btn btn-primary', 'Save draft');
    save.type = 'button';
    const doSave = async () => {
      save.disabled = true;
      try { open = await api(`/api/mock-guides/${encodeURIComponent(key)}`, read()); say('Draft saved. Students still see the published copy until Admin publishes this one.'); return true; } catch (e) { say(e.message, true); return false; } finally { save.disabled = false; }
    };
    save.addEventListener('click', doSave);
    const preview = el('button', 'btn', 'Preview as a student');
    preview.type = 'button';
    preview.addEventListener('click', async () => {
      if (!(await doSave())) return;
      const view = await api(`/api/mock-guides/${encodeURIComponent(key)}/preview?which=draft`).catch((e) => { say(e.message, true); return null; });
      if (!view) return;
      dialog(core ? 'Preview: the guide every student reads' : `Preview: ${g.name}`, (body) => { const box = el('div', 'mp-guide'); body.append(box); window.GuideView.render(box, view, { preview: true }); }, { wide: true });
    });
    bar.append(save, preview);
    if (data.canPublish) {
      const pub = el('button', 'btn btn-primary mg-publish', g.status === 'published' ? 'Published' : 'Publish to students');
      pub.type = 'button';
      pub.disabled = g.status === 'published';
      pub.addEventListener('click', async () => {
        if (!(await window.NiecUI.confirm(`Publish the ${core ? 'general' : g.name} guide? Every student who applied${core ? '' : ` to ${g.name}`} will read it in their portal.`, { confirmText: 'Publish' }))) return;
        if (!(await doSave())) return;
        try { await api(`/api/mock-guides/${encodeURIComponent(key)}/publish`, {}); say('Published: students read it now.'); edit(key); } catch (e) { say(e.message, true); }
      });
      bar.append(pub);
      if (g.status !== 'draft' && g.status !== 'empty') {
        const back2 = el('button', 'btn', 'Take back from students');
        back2.type = 'button';
        back2.addEventListener('click', async () => {
          if (!(await window.NiecUI.confirm('Take this guide back? Students no longer see it until it is published again. The draft is kept.', { confirmText: 'Take back' }))) return;
          try { await api(`/api/mock-guides/${encodeURIComponent(key)}/unpublish`, {}); say('Taken back: students no longer see it.'); edit(key); } catch (e) { say(e.message, true); }
        });
        bar.append(back2);
      }
    } else {
      bar.append(el('span', 'p-muted mg-note', 'Admin publishes a guide to students.'));
    }
    ed.replaceChildren(head, form, bar);
    window.scrollTo({ top: 0 });
  }

  function field(label, input) {
    const w = el('label', 'mg-field');
    w.append(el('span', 'mg-label', label), input);
    return w;
  }

  async function load() {
    try { data = await api('/api/mock-guides'); } catch (e) { $('list').replaceChildren(el('p', 'p-muted', e.message)); return; }
    drawList();
  }
  load();
})();
