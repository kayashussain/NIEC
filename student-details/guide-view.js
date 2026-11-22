// A mock interview guide as a student reads it (the owner, 20 Nov 2026): five phases as a journey, one open at a time, each opened
// once the one before is finished. Used by the student's own portal (my-portal-page.js) and by the team's "Preview as a student"
// (mock-guides-page.js), so the team sees exactly what a student will see.
//
// GuideView.render(container, view, { read, onRead, preview }):
//   view     the guide (mock-api.js): phases [{ key, title, body, own, videos, links }], questions [{ group, q, tip, own }], name
//   read     the phases already finished: { phaseKey: date }
//   onRead   called with a phase key when the student finishes it; returns a promise of the new `read`
//   preview  the team's preview: every phase open, nothing is saved
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Text of a guide: "## " a heading, "- " a point, "1. " a numbered step, a blank line a new paragraph.
  function prose(text) {
    const box = el('div', 'gv-prose');
    let list = null;
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) { list = null; return; }
      if (line.startsWith('## ')) { list = null; box.append(el('h3', '', line.slice(3))); return; }
      if (line.startsWith('- ')) { if (!list || list.tagName !== 'UL') { list = el('ul'); box.append(list); } list.append(el('li', '', line.slice(2))); return; }
      // "1. " a numbered step.
      const step = line.match(/^\d{1,2}\.\s+(.*)$/);
      if (step) { if (!list || list.tagName !== 'OL') { list = el('ol'); box.append(list); } list.append(el('li', '', step[1])); return; }
      list = null;
      box.append(el('p', '', line));
    });
    return box;
  }

  const youtubeId = (url) => { const m = String(url || '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; };
  // A video plays only when asked: its picture first, the player (YouTube's privacy-enhanced one) after a tap.
  function video(v) {
    const id = youtubeId(v.url);
    const box = el('figure', 'gv-video');
    const btn = el('button', 'gv-video-poster');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Play the video: ${v.title || 'video'}`);
    btn.style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")`;
    btn.append(el('span', 'gv-play', ''));
    btn.addEventListener('click', () => {
      const f = el('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = v.title || 'Video';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      btn.replaceWith(f);
    });
    box.append(btn);
    if (v.title) box.append(el('figcaption', '', v.title));
    return box;
  }

  function questions(list) {
    const wrap = el('div', 'gv-questions');
    const groups = [...new Set(list.map((q) => q.group))];
    let shown = 'All';
    const chips = el('div', 'gv-chips');
    chips.setAttribute('role', 'tablist');
    const cards = el('div', 'gv-qcards');
    const draw = () => {
      chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.g === shown)));
      cards.replaceChildren(...list.filter((q) => shown === 'All' || q.group === shown).map((q, i) => {
        const d = el('details', 'gv-q' + (q.own ? ' is-own' : ''));
        d.style.setProperty('--i', String(i));
        const s = el('summary');
        s.append(el('span', 'gv-q-group', q.own ? `${q.group} · this university` : q.group), el('span', 'gv-q-text', q.q), el('span', 'gv-q-hint', 'Answer it out loud, then tap for the tip'));
        d.append(s, el('div', 'gv-q-tip', q.tip));
        return d;
      }));
    };
    ['All', ...groups].forEach((g) => {
      const b = el('button', 'gv-chip', g === 'All' ? `All (${list.length})` : g);
      b.type = 'button';
      b.dataset.g = g;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { shown = g; draw(); });
      chips.append(b);
    });
    draw();
    wrap.append(chips, cards);
    return wrap;
  }

  function render(container, view, { read = {}, onRead = null, preview = false } = {}) {
    let done = { ...read };
    const phases = view.phases || [];
    const firstOpen = () => { const i = phases.findIndex((p) => !done[p.key]); return i === -1 ? phases.length - 1 : i; };
    let at = firstOpen();
    const root = el('div', 'gv');
    const rail = el('ol', 'gv-rail');
    const bar = el('div', 'gv-bar');
    const fill = el('span', 'gv-bar-fill');
    bar.append(fill);
    const stage = el('section', 'gv-stage');
    stage.setAttribute('aria-live', 'polite');
    root.append(bar, rail, stage);

    const unlocked = (i) => preview || i === 0 || Boolean(done[phases[i - 1].key]);
    function drawRail() {
      const n = phases.filter((p) => done[p.key]).length;
      fill.style.width = `${phases.length ? Math.round((n / phases.length) * 100) : 0}%`;
      bar.setAttribute('aria-label', `${n} of ${phases.length} phases finished`);
      rail.replaceChildren(...phases.map((p, i) => {
        const li = el('li');
        const b = el('button', 'gv-step' + (i === at ? ' is-current' : '') + (done[p.key] ? ' is-done' : '') + (!unlocked(i) ? ' is-locked' : ''));
        b.type = 'button';
        b.disabled = !unlocked(i);
        b.append(el('span', 'gv-step-n', done[p.key] ? '✓' : String(i + 1)), el('span', 'gv-step-t', p.title));
        if (!unlocked(i)) b.title = 'Finish the phase before to open this one';
        b.addEventListener('click', () => { at = i; drawRail(); drawStage(); });
        li.append(b);
        return li;
      }));
    }
    function drawStage() {
      const p = phases[at];
      if (!p) { stage.replaceChildren(el('p', 'gv-empty', 'This guide is empty.')); return; }
      const card = el('article', 'gv-phase');
      card.append(el('p', 'gv-kicker', `Phase ${at + 1} of ${phases.length}`), el('h2', 'gv-title', p.title));
      if (p.body) card.append(prose(p.body));
      if (p.own) {
        const own = el('div', 'gv-own');
        own.append(el('p', 'gv-own-label', view.name ? `At ${view.name}` : 'At your university'), prose(p.own));
        card.append(own);
      } else if (p.key === 'university') {
        card.append(el('p', 'gv-note', view.name ? `The ${view.name} guide is being prepared. Our team will add it here.` : 'Choose a university above to read how it runs its interview.'));
      }
      if ((p.videos || []).length) { const v = el('div', 'gv-videos'); p.videos.forEach((x) => v.append(video(x))); card.append(v); }
      if (p.key === 'questions' && (view.questions || []).length) card.append(questions(view.questions));
      if ((p.links || []).length) {
        const l = el('div', 'gv-links');
        l.append(el('h3', '', 'Read more'));
        p.links.forEach((x) => { const a = el('a', 'gv-link', x.title || x.url); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; l.append(a); });
        card.append(l);
      }
      const foot = el('div', 'gv-foot');
      if (at > 0) { const back = el('button', 'btn gv-back', 'Back'); back.type = 'button'; back.addEventListener('click', () => { at -= 1; drawRail(); drawStage(); top(); }); foot.append(back); }
      if (!preview && onRead) {
        const last = at === phases.length - 1;
        const next = el('button', 'btn btn-primary gv-next', done[p.key] ? (last ? 'Finished' : 'Next phase') : (last ? 'I have finished the guide' : 'I have finished this phase'));
        next.type = 'button';
        next.disabled = done[p.key] && last;
        next.addEventListener('click', async () => {
          next.disabled = true;
          try {
            if (!done[p.key]) done = { ...done, ...(await onRead(p.key)) };
            if (!last) at += 1;
            drawRail(); drawStage(); top();
            if (last && window.Portal && window.Portal.celebrate) window.Portal.celebrate();
          } catch (e) { next.disabled = false; }
        });
        foot.append(next);
      } else if (at < phases.length - 1) {
        const next = el('button', 'btn btn-primary gv-next', 'Next phase');
        next.type = 'button';
        next.addEventListener('click', () => { at += 1; drawRail(); drawStage(); top(); });
        foot.append(next);
      }
      card.append(foot);
      stage.replaceChildren(card);
    }
    const top = () => { const r = root.getBoundingClientRect(); if (r.top < 0) window.scrollBy({ top: r.top - 90, behavior: 'smooth' }); };
    drawRail();
    drawStage();
    container.replaceChildren(root);
  }

  window.GuideView = { render, prose };
})();
