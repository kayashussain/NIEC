// The size the whole page is drawn at (Text size in the account menu, the owner, 21 Nov 2026): the page may be drawn smaller than the
// browser's own 100% (CSS zoom on <html>). Positions measured on the screen (getBoundingClientRect, mouse positions, the window's size)
// then come in screen pixels, while a menu placed with style.left/top is placed in page pixels; `isrPos` turns the first into the second.
// With no zoom it changes nothing.
(function (root) {
  const zoom = () => { try { const z = parseFloat(getComputedStyle(document.documentElement).zoom); return z > 0 ? z : 1; } catch (e) { return 1; } };
  root.isrPos = {
    zoom,
    rect(el) { const z = zoom(); const r = el.getBoundingClientRect(); return { top: r.top / z, bottom: r.bottom / z, left: r.left / z, right: r.right / z, width: r.width / z, height: r.height / z }; },
    width() { return root.innerWidth / zoom(); },
    height() { return root.innerHeight / zoom(); },
    point(x) { return x / zoom(); },
  };
})(this);

// Notices and confirmation boxes for every page, in place of the browser's plain pop-ups: they match the
// site, can be used from the keyboard (Enter confirms, Escape cancels) and don't freeze the page.
// Served as /ui.js together with /ui.css; loaded as window.NiecUI.
//
//   NiecUI.toast('Saved', { type: 'success' })           a short notice that fades by itself (type: info, success, error)
//   await NiecUI.confirm('Delete this?', { danger: true })   true if they confirmed, false if they cancelled
//   await NiecUI.alert('This cannot be done yet.')       a message with one OK button
(function (root) {
  let toastBox = null;
  let openDialogs = 0;

  function toast(message, { type = 'info', duration } = {}) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'ui-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    const el = document.createElement('div');
    el.className = 'ui-toast ' + type;
    const text = document.createElement('div');
    text.className = 'ui-toast-text';
    text.textContent = String(message);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    el.append(text, close);
    toastBox.appendChild(el);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    let timer = null;
    const remove = () => {
      clearTimeout(timer);
      if (!el.isConnected || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    };
    close.addEventListener('click', remove);
    // Errors stay a little longer than good news.
    timer = setTimeout(remove, duration || (type === 'error' ? 7000 : 3500));
    return remove;
  }

  // One box: a title, a message and one or two buttons. Resolves true for the main button.
  function ask({ title, message, confirmText, cancelText, danger }) {
    if (!root.HTMLDialogElement) { // very old browser: the plain pop-up still works
      return Promise.resolve(cancelText === null ? (root.alert(message), true) : root.confirm(message));
    }
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ui-dialog';
      dialog.setAttribute('aria-labelledby', 'ui-dialog-title');
      dialog.setAttribute('aria-describedby', 'ui-dialog-text');
      const form = document.createElement('form');
      form.method = 'dialog';
      const h = document.createElement('h2');
      h.id = 'ui-dialog-title';
      h.textContent = title;
      const p = document.createElement('p');
      p.id = 'ui-dialog-text';
      p.textContent = message;
      const actions = document.createElement('div');
      actions.className = 'ui-actions';
      let cancel = null;
      if (cancelText !== null) {
        cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = cancelText;
        actions.appendChild(cancel);
      }
      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = 'ui-ok' + (danger ? ' danger' : '');
      ok.textContent = confirmText;
      actions.appendChild(ok);
      form.append(h, p, actions);
      dialog.appendChild(form);

      let answer = false;
      // Closes with a short fade and shrink, like the other pop-ups (at once for a person who prefers less motion).
      const shut = () => {
        if (dialog.classList.contains('is-closing')) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); return; }
        dialog.classList.add('is-closing');
        setTimeout(() => dialog.close(), 160);
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); answer = true; shut(); });
      if (cancel) cancel.addEventListener('click', shut);
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });
      // Clicking the dimmed area outside the box cancels it.
      dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) shut(); });
      dialog.addEventListener('close', () => {
        openDialogs -= 1;
        dialog.remove();
        resolve(answer);
      });
      document.body.appendChild(dialog);
      openDialogs += 1;
      dialog.showModal();
      // A dangerous question starts on Cancel, so a stray Enter doesn't delete anything.
      (danger && cancel ? cancel : ok).focus();
    });
  }

  const confirmBox = (message, o = {}) => ask({
    title: o.title || 'Are you sure?', message, confirmText: o.confirmText || 'OK', cancelText: o.cancelText || 'Cancel', danger: Boolean(o.danger),
  });
  const alertBox = (message, o = {}) => ask({
    title: o.title || 'Please note', message, confirmText: o.confirmText || 'OK', cancelText: null, danger: false,
  }).then(() => undefined);

  // Changes the page in one smooth step, as moving to another page does (see the page transitions in theme.css): the old picture
  // fades away and the new one glides in. `soft` is for a switch inside a page (a tab, a filter): a quick cross-fade only. Where the
  // browser cannot (or the person prefers less motion) the change is simply made at once.
  function swap(change, { soft = false } = {}) {
    const quick = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (quick || !document.startViewTransition || document.hidden) { change(); return Promise.resolve(); }
    const html = document.documentElement;
    html.classList.toggle('isr-swap-soft', soft);
    let t;
    try { t = document.startViewTransition(change); } catch (e) { change(); return Promise.resolve(); }
    t.ready.catch(() => {});
    return t.finished.catch(() => {}).then(() => { html.classList.remove('isr-swap-soft'); });
  }

  root.NiecUI = { toast, confirm: confirmBox, alert: alertBox, swap, isOpen: () => openDialogs > 0 };
})(this);

// Segmented controls (the card's tabs, the intake tabs under All Students, the Dashboard's switches): a light pill slides to the
// chosen segment, as on a Mac. It only adds a decorative <span class="seg-thumb"> inside the control; nothing else changes.
(function () {
  if (typeof document === 'undefined' || !window.MutationObserver) return;
  const BOXES = '.p-tabs, .sheet-tabs-list, .dd-switch, .tabs, .ev-pills, .p-seg';
  const isOn = (c) => c.getAttribute('aria-selected') === 'true' || c.getAttribute('aria-current') === 'page' || c.classList.contains('active') || c.classList.contains('on');
  function sync(box, animate) {
    let thumb = box.querySelector(':scope > .seg-thumb');
    const on = [...box.children].find((c) => c !== thumb && isOn(c));
    if (!on || !on.offsetWidth) { if (thumb) thumb.style.opacity = '0'; return; }
    if (!thumb) {
      thumb = document.createElement('span');
      thumb.className = 'seg-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      box.prepend(thumb);
      box.classList.add('has-thumb');
      animate = false;
    }
    thumb.style.transition = animate ? '' : 'none';
    thumb.style.opacity = '1';
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.height = on.offsetHeight + 'px';
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    if (!animate) requestAnimationFrame(() => { thumb.style.transition = ''; });
  }
  const all = (animate) => document.querySelectorAll(BOXES).forEach((b) => sync(b, animate));
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; all(true); }); };
  new MutationObserver((list) => { if (list.some((m) => !(m.target.classList && m.target.classList.contains('seg-thumb')))) later(); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current'] });
  window.addEventListener('resize', () => all(false));
  document.addEventListener('DOMContentLoaded', () => all(false));
})();

// Cards lower down a page rise softly into place as they are scrolled to, as on Apple's website. Only cards that start below the
// visible part of the window are held back, so nothing on the first screen ever waits; nothing moves for people who ask for less.
(function () {
  if (typeof document === 'undefined' || !window.IntersectionObserver || !window.MutationObserver) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const CARDS = '.p-card, .md-card, .td-attn, .ov-card, .ev-panel, .dd-card, .ff-card, .tp-panel';
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    io.unobserve(e.target);
    setTimeout(() => e.target.classList.remove('isr-reveal', 'is-in'), 900);
  }), { rootMargin: '0px 0px -8% 0px' });
  const take = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (el.closest('dialog, .card-drawer')) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight || r.height === 0) return; // on the first screen: shown at once
    el.classList.add('isr-reveal');
    io.observe(el);
  };
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches(CARDS)) take(node);
    node.querySelectorAll(CARDS).forEach(take);
  };
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
})();

// The calendar of every date box, in the look of Apple's own (the owner, 14 Nov 2026: the browser's calendar looked old): a light
// rounded panel with the month and year, arrows, the days in round cells, today in blue, the chosen day filled blue, and Today and
// Clear underneath. It opens when a date box is clicked (or a page asks for it with showPicker) and puts the date in the box as if it
// had been picked from the browser's own calendar ("input" and "change" are sent, so every page keeps working as before). Typing a
// date still works. On a phone or a tablet the phone's own date wheel is used (that already is the Apple one on an iPhone).
(function () {
  if (typeof document === 'undefined' || !window.HTMLInputElement) return;
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (!fine) return;
  document.documentElement.classList.add('isr-cal-on');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
  let open = null; // { input, panel, y, m, focus }

  function close(refocus) {
    if (!open) return;
    const { panel, input } = open;
    open = null;
    panel.classList.add('is-closing');
    setTimeout(() => panel.remove(), 140);
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', keys, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (refocus) input.focus();
  }
  function outside(e) { if (open && !open.panel.contains(e.target) && e.target !== open.input) close(false); }
  function choose(value) {
    const { input } = open;
    // The earliest and latest day the box allows (a date of birth is never in the future): the keyboard obeys them as the mouse does.
    if (value && ((input.min && value < input.min) || (input.max && value > input.max))) return; // Clear ('') is always allowed
    close(true);
    if (input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function place() {
    if (!open) return;
    const r = window.isrPos.rect(open.input); // in page pixels, whatever the Text size
    const p = open.panel;
    const h = p.offsetHeight; const w = p.offsetWidth;
    const below = r.bottom + 8 + h <= window.isrPos.height() || r.top - 8 - h < 0;
    p.style.top = `${Math.max(8, below ? r.bottom + 8 : r.top - 8 - h)}px`;
    p.style.left = `${Math.max(8, Math.min(r.left, window.isrPos.width() - w - 8))}px`;
    p.classList.toggle('above', !below);
  }
  // The month and the year can be picked at once (the owner, 16 Nov 2026: a date of birth in 1999 took a click for every month): a
  // click on "November 2026" shows the years, a year shows the twelve months, and a month goes back to its days.
  function yearRange() {
    const { input } = open;
    const now = new Date().getFullYear();
    const lo = /^\d{4}/.test(input.min || '') ? Number(input.min.slice(0, 4)) : 1940;
    const hi = /^\d{4}/.test(input.max || '') ? Number(input.max.slice(0, 4)) : now + 15;
    return [Math.min(lo, open.y), Math.max(hi, open.y)];
  }
  function drawPick() {
    const { panel, y, m, input, view } = open;
    const chosen = /^\d{4}-\d{2}/.test(input.value) ? input.value.slice(0, 7) : '';
    const thisYear = new Date().getFullYear(); const thisMonth = new Date().getMonth();
    let cells = '';
    if (view === 'years') {
      const [lo, hi] = yearRange();
      for (let v = hi; v >= lo; v -= 1) cells += `<button type="button" class="isr-cal-cell${v === thisYear ? ' is-today' : ''}${v === y ? ' is-on' : ''}" data-y="${v}"${v === y ? ' aria-pressed="true"' : ''}>${v}</button>`;
    } else {
      MONTHS.forEach((name, i) => {
        const v = `${y}-${pad(i + 1)}`;
        const off = (input.min && v < input.min.slice(0, 7)) || (input.max && v > input.max.slice(0, 7));
        cells += `<button type="button" class="isr-cal-cell${y === thisYear && i === thisMonth ? ' is-today' : ''}${v === chosen || (!chosen && i === m) ? ' is-on' : ''}" data-m="${i}"${off ? ' disabled' : ''} aria-label="${name} ${y}">${name.slice(0, 3)}</button>`;
      });
    }
    panel.innerHTML = `
      <div class="isr-cal-head">
        <button type="button" class="isr-cal-title is-open" aria-label="Back to the days">${view === 'years' ? 'Choose a year' : `${MONTHS[m]} <span>${y}</span>`}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
        ${view === 'months' ? `<button type="button" class="isr-cal-years-link">${y}</button>` : ''}
      </div>
      <div class="isr-cal-pick ${view === 'years' ? 'is-years' : 'is-months'}">${cells}</div>`;
    if (view === 'years') {
      const on = panel.querySelector('.isr-cal-cell.is-on');
      const box = panel.querySelector('.isr-cal-pick');
      if (on && box) box.scrollTop = on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2;
    }
  }
  function draw() {
    if (open.view && open.view !== 'days') { drawPick(); return; }
    const { panel, y, m, input } = open;
    const chosen = input.value;
    const min = input.min || ''; const max = input.max || '';
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    const today = todayIso();
    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push('<span class="isr-cal-gap"></span>');
    for (let d = 1; d <= days; d += 1) {
      const v = iso(y, m, d);
      const off = (min && v < min) || (max && v > max);
      cells.push(`<button type="button" class="isr-cal-day${v === today ? ' is-today' : ''}${v === chosen ? ' is-on' : ''}${v === open.focus ? ' is-focus' : ''}" data-v="${v}"${off ? ' disabled' : ''} aria-label="${d} ${MONTHS[m]} ${y}"${v === chosen ? ' aria-pressed="true"' : ''}>${d}</button>`);
    }
    panel.innerHTML = `
      <div class="isr-cal-head">
        <button type="button" class="isr-cal-title" aria-label="Choose the month and year">${MONTHS[m]} <span>${y}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="isr-cal-nav">
          <button type="button" class="isr-cal-prev" aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
          <button type="button" class="isr-cal-next" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
        </div>
      </div>
      <div class="isr-cal-week">${DAYS.map((d) => `<span>${d.slice(0, 1)}</span>`).join('')}</div>
      <div class="isr-cal-grid" role="grid">${cells.join('')}</div>
      <div class="isr-cal-foot">
        <button type="button" class="isr-cal-clear"${input.required ? ' hidden' : ''}>Clear</button>
        <button type="button" class="isr-cal-today">Today</button>
      </div>`;
  }
  function move(months) {
    const d = new Date(open.y, open.m + months, 1);
    open.y = d.getFullYear(); open.m = d.getMonth();
    open.panel.classList.remove('slide-left', 'slide-right');
    void open.panel.offsetWidth;
    open.panel.classList.add(months > 0 ? 'slide-left' : 'slide-right');
    draw();
  }
  function keys(e) {
    if (!open) return;
    if (e.key === 'Escape' && open.view !== 'days') { e.preventDefault(); e.stopPropagation(); open.view = 'days'; draw(); place(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step && open.view === 'days' && (document.activeElement === open.input || open.panel.contains(document.activeElement))) {
      e.preventDefault();
      const base = open.focus || open.input.value || todayIso();
      const [y, m, d] = base.split('-').map(Number);
      const t = new Date(y, m - 1, d + step);
      const next = iso(t.getFullYear(), t.getMonth(), t.getDate());
      if ((open.input.min && next < open.input.min) || (open.input.max && next > open.input.max)) return; // not outside the allowed days
      open.focus = next;
      if (t.getFullYear() !== open.y || t.getMonth() !== open.m) { open.y = t.getFullYear(); open.m = t.getMonth(); }
      draw();
      return;
    }
    if (e.key === 'Enter' && open.focus && document.activeElement === open.input) { e.preventDefault(); choose(open.focus); }
    if (e.key === 'PageUp') { e.preventDefault(); move(-1); }
    if (e.key === 'PageDown') { e.preventDefault(); move(1); }
  }
  function show(input) {
    if (open && open.input === input) return;
    close(false);
    if (input.disabled || input.readOnly) return;
    const base = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : todayIso();
    const [y, m] = base.split('-').map(Number);
    const panel = document.createElement('div');
    panel.className = 'isr-cal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose a date');
    // Clicks inside keep the date box focused, so a page that waits for the box to lose focus is not disturbed.
    panel.addEventListener('mousedown', (e) => { e.preventDefault(); });
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('isr-cal-title')) { open.view = open.view && open.view !== 'days' ? 'days' : 'years'; draw(); place(); }
      else if (b.classList.contains('isr-cal-years-link')) { open.view = 'years'; draw(); place(); }
      else if (b.dataset.y) { open.y = Number(b.dataset.y); open.view = 'months'; draw(); place(); }
      else if (b.dataset.m) { open.m = Number(b.dataset.m); open.view = 'days'; draw(); place(); }
      else if (b.classList.contains('isr-cal-prev')) move(-1);
      else if (b.classList.contains('isr-cal-next')) move(1);
      else if (b.classList.contains('isr-cal-today')) choose(todayIso());
      else if (b.classList.contains('isr-cal-clear')) choose('');
      else if (b.dataset.v) choose(b.dataset.v);
    });
    // Shown in the top layer (above any pop-up such as Add student), where the browser can; else inside the open pop-up.
    // It is placed inside the open pop-up when there is one (the rest of the page cannot be clicked then).
    (input.closest('dialog[open]') || document.body).append(panel);
    if (typeof panel.showPopover === 'function') { panel.popover = 'manual'; panel.showPopover(); }
    open = { input, panel, y, m: m - 1, focus: '', view: 'days' };
    draw();
    place();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', keys, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  }
  // A page that opens the calendar itself (the date cells of All Students) gets this one too.
  const native = HTMLInputElement.prototype.showPicker;
  HTMLInputElement.prototype.showPicker = function showPicker() {
    if (this.type === 'date') { show(this); return undefined; }
    return native ? native.call(this) : undefined;
  };
  document.addEventListener('click', (e) => {
    const input = e.target && e.target.closest && e.target.closest('input[type="date"]');
    if (!input) return;
    e.preventDefault(); // not the browser's own calendar
    show(input);
  }, true);
  // Typing in the box moves the calendar to the typed month.
  document.addEventListener('input', (e) => {
    if (!open || e.target !== open.input || !/^\d{4}-\d{2}-\d{2}$/.test(open.input.value)) return;
    const [y, m] = open.input.value.split('-').map(Number);
    open.y = y; open.m = m - 1; open.view = 'days'; draw();
  }, true);
})();

// Every date box reads "14 Nov 2026" (or "Choose a date"), not the browser's "mm/dd/yyyy" (month first, which reads wrongly in Nepal
// and the UK). The box keeps working as before: a click opens the calendar above, and typing shows the browser's own day, month and
// year boxes while a date is typed. The date cells of All Students draw their own text and are left alone.
(function () {
  if (typeof document === 'undefined' || !window.MutationObserver) return;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const words = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : ''; };
  function dress(input) {
    if (input.dataset.dressed || input.classList.contains('date-input') || input.closest('#body, .p-date')) return;
    input.dataset.dressed = '1';
    const box = document.createElement('span');
    box.className = 'p-date';
    const shown = document.createElement('span');
    shown.className = 'p-date-text';
    shown.setAttribute('aria-hidden', 'true');
    input.replaceWith(box);
    box.append(input, shown);
    const show = () => { shown.textContent = words(input.value) || input.placeholder || 'Choose a date'; box.classList.toggle('is-empty', !input.value); };
    input.addEventListener('input', show);
    input.addEventListener('change', show);
    input.addEventListener('keydown', (e) => { if (/^\d$/.test(e.key) || e.key === 'Backspace') box.classList.add('typing'); });
    input.addEventListener('blur', () => { box.classList.remove('typing'); show(); });
    // A page that sets the value itself (a filter reset, a form filled in) is followed too.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); show(); } });
    show();
  }
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches('input[type="date"]')) dress(node);
    node.querySelectorAll('input[type="date"]').forEach(dress);
  };
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document.body));
  if (document.body) scan(document.body);
})();

// Back to the top (the owner, 14 Nov 2026, in place of a title bar across the top): a small round button with an up arrow at the
// bottom right, shown only once the page has been scrolled down a screen; a click glides back to the top. Nothing else changes.
(function () {
  if (typeof document === 'undefined') return;
  let btn = null; let queued = false;
  function ensure() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'isr-top';
    btn.title = 'Back to the top';
    btn.setAttribute('aria-label', 'Back to the top');
    btn.textContent = '\u2191';
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    document.body.append(btn);
    return btn;
  }
  function check() {
    queued = false;
    const down = window.scrollY > window.innerHeight * 0.9;
    if (down) ensure();
    if (btn) btn.classList.toggle('is-on', down);
  }
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(check); } }, { passive: true });
})();

// The big figures count up from nought when a page first opens (the owner, 15 Nov 2026: a portal that feels alive), in under a
// second, once per page load: a figure drawn again later (after a save) just shows its value. Only plain numbers count ("349",
// "1,250"); anything else ("0 of 6", "Rs 3,85,000") is left as it is. Never for people who ask their device for less motion.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // One count-up only (the owner, 17 Nov 2026): a second one ran on the same figures, each stopped when it saw the other write, and
  // a figure could stay half way (Events and marketing showed 4 inquiries for 106). Never add another.
  const SEL = '.ov-kpi-value, .md-kpi b, .bp-band b, .td-stat b, .td-team-num b, .bp-funnel-step b, .ev-band b, .tile-value, .pu-num, .bp-num, .sc-num';
  const started = Date.now();
  const WINDOW_MS = 6000; // only while the page is first coming in
  const seen = new WeakSet();
  const plain = /^\d{1,3}(,\d{3})+$|^\d+$/;
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  function run(node) {
    if (seen.has(node)) return;
    seen.add(node);
    const text = node.textContent.trim();
    if (node.children.length || !plain.test(text)) return;
    const target = Number(text.replace(/,/g, ''));
    if (!(target > 1)) return;
    const dur = Math.min(900, 380 + target * 6);
    const t0 = performance.now();
    let last = '0';
    // If the page writes a new value into the figure meanwhile, the count stops and the new value stays.
    const step = (now) => {
      if (node.textContent !== last) return;
      const k = Math.min(1, (now - t0) / dur);
      last = k < 1 ? Math.round(target * ease(k)).toLocaleString('en-GB') : text;
      node.textContent = last;
      if (k < 1) requestAnimationFrame(step);
    };
    node.textContent = '0';
    requestAnimationFrame(step);
  }
  const scan = () => { if (Date.now() - started <= WINDOW_MS) document.querySelectorAll(SEL).forEach(run); };
  let queued = false;
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; scan(); }); } });
  const go = () => { scan(); obs.observe(document.body, { childList: true, subtree: true }); setTimeout(() => obs.disconnect(), WINDOW_MS); };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();
