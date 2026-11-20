// Opens a student's card over the page the person is on (the sheet, Universities ...), so they can look
// at the student and carry on where they were. window.CardDrawer.open(rowId, { onClose }). Escape or the Close button shuts it;
// onClose (optional) runs then, so a page can show what was changed on the card (a new note, a new stage).
// `list` (optional): the ids of the students in the order shown on the page (the sheet with its search and filters). The card then
// has Previous and Next (and the ← → keys) to go through them one by one without closing it (the owner, 17 Nov 2026: less work).
// `names` (optional, { id: name }): the bar then says who comes next ("Next: Sita KC") and, while the mouse is on ‹, who came before.
// A press on "4 of 345" lets the person type a number and go straight there (the owner, 17 Nov 2026: the arrows taken a level up).
(function (root) {
  let current = null;
  function close() {
    if (!current) return;
    current.back.remove();
    current.drawer.remove();
    if (current.before && document.contains(current.before)) { try { current.before.focus({ preventScroll: true }); } catch (e) { /* the cell is gone: nothing to go back to */ } }
    document.removeEventListener('keydown', current.onKey);
    window.removeEventListener('message', current.onMessage);
    const after = current.onClose;
    current = null;
    if (typeof after === 'function') after();
  }
  function open(id, { onClose, list, names } = {}) {
    close();
    const back = document.createElement('div');
    back.className = 'p-drawer-back';
    const drawer = document.createElement('aside');
    drawer.className = 'p-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Student card');
    const frame = document.createElement('iframe');
    frame.title = 'Student card';
    drawer.append(frame);
    const ids = Array.isArray(list) ? list.filter(Boolean) : [];
    let at = ids.indexOf(id);
    const nav = document.createElement('div');
    nav.className = 'p-drawer-nav';
    const mk = (label, aria) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria); return b; };
    const prev = mk('‹', 'Previous student');
    const next = mk('›', 'Next student');
    const nameOf = (i) => (names && ids[i] && names[ids[i]]) || '';
    // The middle: "4 of 345" and, under it, who is next; a press turns it into a box to type the number to go to.
    const where = document.createElement('button');
    where.type = 'button';
    where.className = 'p-drawer-where';
    where.title = 'Go to a number';
    const count = document.createElement('b');
    const who = document.createElement('small');
    where.append(count, who);
    const jump = document.createElement('input');
    jump.type = 'number'; jump.min = '1'; jump.className = 'p-drawer-jump'; jump.hidden = true;
    jump.setAttribute('aria-label', 'Go to student number');
    nav.append(prev, where, jump, next);
    const say = (text) => { who.textContent = text; who.hidden = !text; };
    const nextWords = () => (at < ids.length - 1 && nameOf(at + 1) ? `Next: ${nameOf(at + 1)}` : at >= ids.length - 1 ? 'The last one' : '');
    prev.addEventListener('mouseenter', () => { if (at > 0 && nameOf(at - 1)) say(`Before: ${nameOf(at - 1)}`); });
    prev.addEventListener('mouseleave', () => say(nextWords()));
    where.addEventListener('click', () => { where.hidden = true; jump.hidden = false; jump.max = String(ids.length); jump.value = String(at + 1); jump.focus(); jump.select(); });
    const endJump = (go) => {
      if (jump.hidden) return;
      const n = Number.parseInt(jump.value, 10);
      jump.hidden = true; where.hidden = false;
      if (go && n >= 1 && n <= ids.length && n - 1 !== at) show(n - 1); else frame.focus({ preventScroll: true });
    };
    jump.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); endJump(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endJump(false); } });
    jump.addEventListener('blur', () => endJump(true));
    const show = (i) => {
      if (ids.length && (i < 0 || i >= ids.length)) return;
      if (ids.length) at = i;
      frame.src = '/student?embed=1&id=' + encodeURIComponent(ids.length ? ids[at] : id);
      count.textContent = `${at + 1} of ${ids.length}`;
      say(nextWords());
      prev.disabled = at <= 0;
      next.disabled = at >= ids.length - 1;
      prev.title = at > 0 && nameOf(at - 1) ? `Previous: ${nameOf(at - 1)} (←)` : 'Previous student (←)';
      next.title = at < ids.length - 1 && nameOf(at + 1) ? `Next: ${nameOf(at + 1)} (→)` : 'Next student (→)';
      frame.focus({ preventScroll: true });
    };
    prev.addEventListener('click', () => show(at - 1));
    next.addEventListener('click', () => show(at + 1));
    if (at !== -1 && ids.length > 1) drawer.append(nav); else ids.length = 0;
    show(at);
    const onKey = (e) => { if (e.key === 'Escape' && jump.hidden && !(root.NiecUI && root.NiecUI.isOpen())) close(); };
    const onMessage = (e) => {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.niecCard === 'close') close();
      else if (e.data.niecCard === 'next' && ids.length) show(at + 1);
      else if (e.data.niecCard === 'prev' && ids.length) show(at - 1);
    };
    back.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    // The keyboard goes with the card: whatever was being typed in on the page underneath (a cell of the sheet, after a
    // double-click on the name) lets go, so nothing typed now lands in a cell hidden behind the card. Closing gives it back.
    const before = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.append(back, drawer);
    if (before && before.blur) before.blur();
    frame.tabIndex = -1;
    frame.focus({ preventScroll: true });
    current = { back, drawer, onKey, onMessage, before, onClose };
  }
  // Loaded in its own stylesheet-less pages too (Universities): make sure the drawer's look is there.
  if (!document.querySelector('link[href^="portal.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'portal.css';
    document.head.append(link);
  }
  root.CardDrawer = { open, close };
})(this);
