// Builds shared/dark.css: the dark mode of Student Recruit 360 (the owner, 25 Nov 2026).
//
//   node scripts/build-dark.js
//
// The light look is written in the style files of shared/ and student-details/. This script reads them and writes, for every rule that
// has a colour in it, the same rule for html[data-theme="dark"] with the colour moved into a calm dark palette (a very dark page, raised
// dark cards, soft hairlines, light text, the same blue and orange a little lighter). Nothing is invented by hand: change the light
// look, run this again, and the dark look follows. It needs nothing installed.
//
// The palette is Google's dark theme (Material Design, the one Chrome and Google's own apps use), so it reads as the dark mode people already know:
//   page #202124   card #292a2d   raised #303134   control #3c4043   divider #3c4043   text #e8eaed   second text #9aa0a6
//   blue #8ab4f8 (links, #669df6 in buttons)   red #f28b82   green #81c995   yellow #fdd663   orange #fcad70
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = [
  'shared/theme.css', 'shared/header.css', 'shared/ui.css', 'shared/apple.css',
  'student-details/style.css', 'student-details/portal.css', 'student-details/student-card.css', 'student-details/student-look.css',
  'student-details/admin.css', 'student-details/book.css', 'student-details/dashboard.css', 'student-details/fact-file.css',
  'student-details/mock-team.css', 'student-details/phone.css', 'student-details/universities.css',
];
const HTML_WITH_STYLE = ['student-details/direct.html', 'student-details/events.html', 'student-details/followup.html'];

// ---------- colours ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function parseColor(t) {
  t = t.trim().toLowerCase();
  let m;
  if (t === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (t === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (t === 'transparent') return null;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(t))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  if ((m = /^rgba?\(([^)]*)\)$/.exec(t))) {
    const p = m[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (p.length < 3) return null;
    const n = (s) => (s.endsWith('%') ? parseFloat(s) * 2.55 : parseFloat(s));
    if ([p[0], p[1], p[2]].some((x) => /var|calc/.test(x))) return null;
    const a = p[3] === undefined ? 1 : (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]));
    return { r: n(p[0]), g: n(p[1]), b: n(p[2]), a };
  }
  return null;
}
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function fromHsl({ h, s, l }) {
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
function out({ r, g, b }, a) {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a !== undefined && a < 0.995 ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})` : base;
}
const grey = (l) => { const v = clamp(l) * 255; return { r: v, g: v, b: v }; };

// Exact light neutrals of the app, moved by hand to the right dark step (so the depth reads the same: page, card, raised, control).
const BG_STEPS = new Map([
  ['#ffffff', '#292a2d'], ['#fefefe', '#292a2d'], ['#fdfdfd', '#292a2d'], ['#fbfbfd', '#2c2d30'], ['#fafafc', '#2c2d30'], ['#fafafa', '#2c2d30'], ['#f9f9fb', '#2c2d30'],
  ['#f7f7f7', '#2f3033'], ['#f5f5f7', '#202124'], ['#f5f5f5', '#202124'], ['#f4f4f6', '#26272a'], ['#f3f3f3', '#292a2d'], ['#f2f2f5', '#26272a'], ['#f2f2f2', '#2f3033'],
  ['#f0f0f3', '#303134'], ['#f0f0f2', '#303134'], ['#efeff4', '#303134'], ['#f0f1f5', '#303134'], ['#eeeef0', '#303134'], ['#ececec', '#26272a'], ['#ebebf0', '#35363a'],
  ['#e8e8ed', '#3c4043'], ['#e6e6e6', '#202124'], ['#e5e5ea', '#3c4043'], ['#e3e3e8', '#3c4043'], ['#e2e2e2', '#3c4043'], ['#dcdce1', '#4a4c50'], ['#dcdcdc', '#4a4c50'], ['#d2d2d7', '#505256'],
]);
const BORDER_STEPS = new Map([
  ['#ffffff', '#4a4c50'], ['#f5f5f7', '#35363a'], ['#f0f0f3', '#35363a'], ['#e5e5ea', '#3c4043'], ['#e8e8ed', '#3c4043'], ['#e3e3e8', '#3c4043'], ['#d2d2d7', '#505256'], ['#c7c7cc', '#5f6368'],
  ['#b8b8b8', '#5f6368'], ['#9a9a9a', '#6b6e72'], ['#6f6f6f', '#80868b'],
]);

// Google's dark colours for words and accents, by the hue of the light colour
const FAMILY = (h, s) => {
  if (h < 0.035 || h >= 0.94) return { text: '#f28b82', mid: '#ee675c' };      // red
  if (h < 0.095) return { text: '#fcad70', mid: '#ee8a3a' };                    // orange
  if (h < 0.19) return { text: '#fdd663', mid: '#f9ab00' };                     // amber and yellow
  if (h < 0.46) return { text: '#81c995', mid: '#5bb974' };                     // green
  if (h < 0.53) return { text: '#78d9ec', mid: '#24c1e0' };                     // teal
  if (h < 0.72) return { text: '#8ab4f8', mid: '#669df6' };                     // blue
  if (h < 0.84) return { text: '#c58af9', mid: '#a56eff' };                     // purple
  return { text: '#ff8bcb', mid: '#ff63b8' };                                   // pink
};

// kind: 'bg' | 'text' | 'border'; ctx.keepText: the same rule puts the text on a coloured fill that stays coloured
function mapColor(c, kind, ctx = {}) {
  const hsl = toHsl(c);
  const neutral = hsl.s < 0.14;
  const hexKey = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  if (neutral) {
    if (kind === 'bg') {
      if (c.a >= 0.995 && BG_STEPS.has(hexKey)) { const t = parseColor(BG_STEPS.get(hexKey)); return out(t, c.a); }
      // a black wash (hover, overlay) becomes a white wash
      if (c.r === 0 && c.g === 0 && c.b === 0 && c.a < 0.995) return c.a <= 0.3 ? `rgba(255, 255, 255, ${+(c.a * 1.5).toFixed(3)})` : out(c, c.a);
      let l;
      if (hsl.l >= 0.30) l = 0.14 + 0.45 * (1 - hsl.l); // other light neutrals: deep steps
      else l = 0.30 + hsl.l * 0.3; // dark neutrals (a black pill): a raised grey, so white words stay readable
      return out(grey(l), c.a);
    }
    if (kind === 'border') {
      if (c.a >= 0.995 && BORDER_STEPS.has(hexKey)) return out(parseColor(BORDER_STEPS.get(hexKey)), c.a);
      if (c.r === 0 && c.g === 0 && c.b === 0 && c.a < 0.995) return `rgba(255, 255, 255, ${+Math.min(0.25, c.a * 1.6).toFixed(3)})`;
      return out(grey(clamp(0.12 + 0.62 * (1 - hsl.l), 0.14, 0.62)), c.a);
    }
    // text
    if (hsl.l >= 0.97) return out(c, c.a); // white words stay white (on a blue, orange or raised fill)
    if (ctx.keepText) return out(c, c.a);
    if (c.r === 0 && c.g === 0 && c.b === 0 && c.a < 0.995) return `rgba(255, 255, 255, ${+Math.min(0.95, c.a + 0.05).toFixed(3)})`;
    if (hsl.l <= 0.22) return out(parseColor('#e8eaed'), c.a);
    if (hsl.l <= 0.5) return out(parseColor('#9aa0a6'), c.a);
    return out(parseColor('#80868b'), c.a);
  }
  // a colour with a hue (blue, orange, green, red, amber, purple ...)
  if (kind === 'text') {
    if (ctx.keepText) return out(c, c.a);
    const fam = FAMILY(hsl.h, hsl.s);
    return out(parseColor(ctx.isVar ? fam.mid : fam.text), c.a);
  }
  if (kind === 'bg') {
    if (hsl.l >= 0.78) return out(fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.45), l: 0.17 + (1 - hsl.l) * 0.25 }), c.a); // a pale tint becomes a deep tint
    return out(fromHsl({ h: hsl.h, s: hsl.s, l: clamp(hsl.l + 0.04, 0, 0.9) }), c.a);
  }
  // border with a hue
  if (hsl.l >= 0.7) return out(fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.5), l: 0.30 }), c.a);
  return out(fromHsl({ h: hsl.h, s: hsl.s, l: clamp(hsl.l + 0.08, 0, 0.8) }), c.a);
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\b(?:white|black)\b/gi;
function mapValue(value, kind, ctx) {
  // never touch what is inside url(...) or a quoted string
  const keep = [];
  const masked = value.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)|"[^"]*"|'[^']*'/g, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0001`; });
  const changed = masked.replace(COLOR_RE, (tok) => {
    const c = parseColor(tok);
    return c ? mapColor(c, kind, ctx) : tok;
  });
  return changed.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]);
}

// ---------- reading CSS ----------
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }
function splitTop(s, sep) {
  const parts = []; let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
function parseBlock(css) {
  const nodes = []; let i = 0; const n = css.length;
  while (i < n) {
    // prelude up to { or ;
    let depth = 0, q = '', j = i;
    for (; j < n; j += 1) {
      const ch = css[j];
      if (q) { if (ch === q && css[j - 1] !== '\\') q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '(' || ch === '[') depth += 1;
      if (ch === ')' || ch === ']') depth -= 1;
      if ((ch === '{' || ch === ';') && depth === 0) break;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= n) break;
    if (css[j] === ';') { i = j + 1; continue; }
    // matching }
    let d = 1, k = j + 1; q = '';
    for (; k < n && d > 0; k += 1) {
      const ch = css[k];
      if (q) { if (ch === q && css[k - 1] !== '\\') q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '(') { // skip url( ... ) with data uris
        let pd = 1; k += 1;
        while (k < n && pd > 0) { if (css[k] === '(') pd += 1; else if (css[k] === ')') pd -= 1; k += 1; }
        k -= 1; continue;
      }
      if (ch === '{') d += 1; else if (ch === '}') d -= 1;
    }
    const body = css.slice(j + 1, k - 1);
    i = k;
    if (!prelude) continue;
    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)[1].toLowerCase();
      if (['media', 'supports', 'container', 'layer'].includes(name)) nodes.push({ type: 'at', prelude, nodes: parseBlock(body) });
      continue; // font-face, keyframes, page: no colours to move
    }
    nodes.push({ type: 'rule', selector: prelude, decls: splitTop(body, ';').map((d2) => {
      const idx = d2.indexOf(':'); if (idx < 0) return null;
      let value = d2.slice(idx + 1).trim(); let important = false;
      if (/!\s*important\s*$/i.test(value)) { important = true; value = value.replace(/!\s*important\s*$/i, '').trim(); }
      return { prop: d2.slice(0, idx).trim().toLowerCase(), value, important };
    }).filter(Boolean) });
  }
  return nodes;
}

// ---------- writing the dark rules ----------
const BG_PROPS = /^(background|background-color|background-image)$/;
const BORDER_PROPS = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|column-rule(-color)?)$/;
const TEXT_PROPS = /^(color|caret-color|accent-color|fill|stroke|text-decoration-color|-webkit-text-fill-color|scrollbar-color)$/;
function kindOfProp(prop) {
  if (BG_PROPS.test(prop)) return 'bg';
  if (BORDER_PROPS.test(prop)) return 'border';
  if (TEXT_PROPS.test(prop)) return 'text';
  if (prop.startsWith('--')) {
    if (/(border|line|hair|rule|divider|sep|stroke)/.test(prop)) return 'border';
    if (/(bg|back|panel|surface|soft|fill|chip|btn|tile|row|header|card|wash|tint|canvas|page|side|field|hover)/.test(prop)) return 'bg';
    return 'text';
  }
  return null;
}
function darkSelector(sel) {
  return splitTop(sel, ',').map((p) => {
    p = p.trim();
    if (/^html\b/.test(p)) return p.replace(/^html/, 'html[data-theme="dark"]');
    if (/^:root\b/.test(p)) return p.replace(/^:root/, ':root[data-theme="dark"]');
    return `html[data-theme="dark"] ${p}`;
  }).join(', ');
}
function firstColor(value) { const m = value.replace(/url\([^)]*\)/g, '').match(COLOR_RE); return m ? parseColor(m[0]) : null; }
function darkRule(rule) {
  // the fill this rule puts under its words decides whether its words keep their colour
  const bgDecl = rule.decls.find((d) => /^(background|background-color)$/.test(d.prop));
  const bgColor = bgDecl ? firstColor(bgDecl.value) : null;
  const bgHsl = bgColor ? toHsl(bgColor) : null;
  const keepText = Boolean(bgColor && bgColor.a > 0.5 && bgHsl.s >= 0.25 && bgHsl.l < 0.78);
  const lines = [];
  rule.decls.forEach((d) => {
    const kind = kindOfProp(d.prop);
    if (!kind) return;
    COLOR_RE.lastIndex = 0;
    const has = COLOR_RE.test(d.value); COLOR_RE.lastIndex = 0;
    if (!has) return;
    const v = mapValue(d.value, kind, { keepText, isVar: d.prop.startsWith('--') });
    if (v !== d.value) lines.push(`  ${d.prop}: ${v}${d.important ? ' !important' : ''};`);
  });
  return lines.length ? `${darkSelector(rule.selector)} {\n${lines.join('\n')}\n}\n` : '';
}
function darkNodes(nodes) {
  let outCss = '';
  nodes.forEach((nd) => {
    if (nd.type === 'rule') outCss += darkRule(nd);
    else { const inner = darkNodes(nd.nodes); if (inner) outCss += `${nd.prelude} {\n${inner}}\n`; }
  });
  return outCss;
}

let body = '';
FILES.forEach((f) => {
  const css = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
  const part = darkNodes(parseBlock(css));
  body += `/* ---- ${f} ---- */\n${part}`;
});
HTML_WITH_STYLE.forEach((f) => {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const part = darkNodes(parseBlock(stripComments(blocks)));
  if (part) body += `/* ---- ${f} (its own style block) ---- */\n${part}`;
});

const head = `/* Dark mode of Student Recruit 360: written by scripts/build-dark.js from the light style files. Do not edit by hand: change the light look and run
   "node scripts/build-dark.js" again. Loaded by shared/header.js only while a person has chosen Dark mode. */
html[data-theme="dark"] { color-scheme: dark; }
html[data-theme="dark"], html[data-theme="dark"] body { background-color: #202124; color: #e8eaed; }
html[data-theme="dark"] ::selection { background: rgba(59, 155, 255, .35); }
html[data-theme="dark"] input, html[data-theme="dark"] textarea, html[data-theme="dark"] select { color-scheme: dark; }
html[data-theme="dark"] input::placeholder, html[data-theme="dark"] textarea::placeholder { color: #9aa0a6; }
html[data-theme="dark"] .niec-logo { filter: invert(1) hue-rotate(180deg); }
html[data-theme="dark"] img.slide, html[data-theme="dark"] .uc-cover img, html[data-theme="dark"] video { filter: none; }
`;
fs.writeFileSync(path.join(root, 'shared', 'dark.css'), head + body);
console.log('shared/dark.css written,', Math.round((head.length + body.length) / 1024), 'KB');
