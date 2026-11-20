// ISR motion kit (the owner, 20 Nov 2026: "interactive, engaging, fun to work in, like a game, a surprise every time").
// One small file every page loads (header.js adds it), so every page moves the same way. See DESIGN.md for the rules.
//
//   Motion.reveal(root)          the cards and rows of `root` rise in one after another (each element once)
//   Motion.countUp(el, to)       a number counts up to its value (the final text is always exactly the value)
//   Motion.celebrate(x, y, big)  a burst of confetti from a point (a task done, all caught up)
//   Motion.ring(value, total)    an SVG progress ring that fills with a spring, for "3 of 8 done"
//   Motion.reduced()             true when the person asked for less motion (or a test robot drives the page)
//
// Automatic on every page: the light that follows the mouse over cards, the soft press of buttons and pills (CSS), and the
// cross-fade between pages (CSS). Everything is skipped for a reader who asked for less motion, and for automated tests (they
// must read the final numbers at once).
(function () {
  if (window.Motion) return;
  const robot = Boolean(navigator.webdriver);
  const reduced = () => robot || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('mo-on', !reduced());

  // ---- rise in, one after another ----
  const seen = new WeakSet();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('mo-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -6% 0px' }) : null;
  function reveal(root, selector) {
    if (!root || reduced() || !io) return;
    const items = selector ? [...root.querySelectorAll(selector)] : [...root.children];
    let i = 0;
    items.forEach((x) => {
      if (seen.has(x)) return;
      seen.add(x);
      x.classList.add('mo-rise');
      x.style.setProperty('--mo-i', String(Math.min(i, 14)));
      i += 1;
      io.observe(x);
    });
  }

  // ---- numbers that count up ----
  function countUp(node, to, { duration = 900, format = (n) => String(n) } = {}) {
    if (!node) return;
    const end = Number(to);
    if (!Number.isFinite(end) || reduced() || end === 0) { node.textContent = format(end); return; }
    const t0 = performance.now();
    const ease = (k) => 1 - Math.pow(1 - k, 4);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      node.textContent = format(Math.round(end * ease(k)));
      if (k < 1) requestAnimationFrame(step); else node.textContent = format(end);
    };
    requestAnimationFrame(step);
  }

  // ---- confetti ----
  const COLORS = ['#0071e3', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'];
  function celebrate(x = innerWidth / 2, y = innerHeight / 3, big = false) {
    if (reduced()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'mo-confetti';
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    document.body.append(canvas);
    const c = canvas.getContext('2d');
    c.scale(devicePixelRatio, devicePixelRatio);
    const n = big ? 160 : 70;
    const parts = Array.from({ length: n }, () => {
      const a = (big ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 1.9);
      const v = (big ? 7 : 5.5) + Math.random() * (big ? 9 : 6);
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (big ? 2 : 1), w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35, color: COLORS[Math.floor(Math.random() * COLORS.length)], round: Math.random() < 0.3 };
    });
    const t0 = performance.now();
    const life = big ? 2600 : 1700;
    const frame = (t) => {
      const age = t - t0;
      c.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        c.save(); c.globalAlpha = Math.max(0, 1 - age / life); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.color;
        if (p.round) { c.beginPath(); c.arc(0, 0, p.w / 2, 0, Math.PI * 2); c.fill(); } else c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * 0.6);
        c.restore();
      });
      if (age < life) requestAnimationFrame(frame); else canvas.remove();
    };
    requestAnimationFrame(frame);
  }

  // ---- progress ring ----
  function ring(value, total, { size = 112, stroke = 11, label = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'mo-ring';
    wrap.style.setProperty('--mo-size', `${size}px`);
    const r = (size - stroke) / 2;
    const len = 2 * Math.PI * r;
    const share = total > 0 ? Math.min(1, value / total) : 1;
    wrap.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><linearGradient id="mo-ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34c759"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs>`
      + `<circle class="mo-ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>`
      + `<circle class="mo-ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
    const mid = document.createElement('div');
    mid.className = 'mo-ring-mid';
    const big = document.createElement('b');
    big.textContent = '0%';
    const small = document.createElement('span');
    small.textContent = label;
    mid.append(big, small);
    wrap.append(mid);
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', `${Math.round(share * 100)}% ${label}`.trim());
    const fill = wrap.querySelector('.mo-ring-fill');
    const go = () => { fill.style.strokeDashoffset = String(len * (1 - share)); countUp(big, Math.round(share * 100), { duration: 1100, format: (n) => `${n}%` }); };
    if (reduced()) { fill.style.transition = 'none'; fill.style.strokeDashoffset = String(len * (1 - share)); big.textContent = `${Math.round(share * 100)}%`; } else requestAnimationFrame(() => requestAnimationFrame(go));
    return wrap;
  }

  // ---- the light that follows the mouse over a card ----
  const GLOW = '.p-card, .td-tasks, .td-stat, .td-pulse, .uc-card, .up-course, .up-level, .up-fact, .fd-uni, .tb-tile, .td-row, .p-task, .sc-hero, .sc-fact, .sc-reach-btn, .sc-tl-body';
  document.addEventListener('pointermove', (e) => {
    if (reduced()) return;
    const card = e.target.closest && e.target.closest(GLOW);
    if (!card) return;
    // only on a card with a plain background (a card's own gradient or picture is never covered)
    if (!card.dataset.moGlow) card.dataset.moGlow = getComputedStyle(card).backgroundImage === 'none' ? 'y' : 'n';
    if (card.dataset.moGlow !== 'y') return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mo-x', `${e.clientX - r.left}px`);
    card.style.setProperty('--mo-y', `${e.clientY - r.top}px`);
    card.classList.add('mo-lit');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest && e.target.closest(GLOW);
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('mo-lit');
  }, { passive: true });

  window.Motion = { reveal, countUp, celebrate, ring, reduced };
})();
