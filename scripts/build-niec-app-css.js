// Builds the colour part of shared/niec-app.css: the NIEC look for the Application Team (the owner, 22 Nov 2026).
//
//   node scripts/build-niec-app-css.js          writes the generated part of shared/niec-app.css
//   node scripts/build-niec-app-css.js --check  exits with 1 if shared/niec-app.css is out of date (used by the tests)
//
// Why it exists: the dark Peacock Ocean look writes its colours straight into the stylesheets (about 1,500 places).
// The Application Team sees the light NIEC look instead, so every rule that sets one of those colours gets a copy here,
// limited to html[data-team="application"] (header.js sets it for a person whose own team is the Application Team) and
// with the colour turned into its NIEC counterpart. Nothing changes for any other team. When a stylesheet below changes,
// run this again, so the Application Team keeps up with it.
//
// Only the part between the two GENERATED markers is rewritten; the hand-made NIEC layer after it is kept as it is.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'shared', 'niec-app.css');
const SCOPE = 'html[data-team="application"]';
// In the order the Application Team's pages load them.
const SOURCES = ['shared/header.css', 'shared/ui.css', 'student-details/style.css', 'student-details/portal.css', 'shared/theme.css',
  'student-details/fact-file.css', 'student-details/universities.css', 'student-details/student-card.css'];

// A colour used as text (color, fill of text) and the same colour used as a background or border mean different things
// in a dark look and a light one, so each has its own NIEC counterpart.
const AS_TEXT = {
  '#dde9ef': '#1f2d3d', '#e3eef2': '#0e2236', '#a9c3cf': '#536477', '#7fd3ee': '#0a6fb5', '#6fd8e0': '#0a6fb5', '#8ff5ec': '#0a5a94',
  '#0f7fb3': '#085c97', '#f0a463': '#b4500c', '#d9712a': '#b4500c', '#6fd69a': '#1e7f4a', '#ff8a7e': '#b3261e', '#f2c94c': '#8a6100',
  '#c9a227': '#9a6b00', '#0f2a38': '#ffffff', '#0b2230': '#ffffff', '#13303f': '#ffffff', '#4f7f95': '#536477', '#3d6a80': '#536477',
  '#1f4256': '#536477', '#19384a': '#ffffff', '#06141c': '#ffffff',
};
const AS_SURFACE = {
  '#0b2230': '#eef3f8', '#13303f': '#fbfcfd', '#19384a': '#f2f5f9', '#0f2a38': '#fbfcfd', '#1f4256': '#e4ebf3', '#0d2736': '#f6f8fa',
  '#06141c': '#e9eef4', '#1a3a4b': '#eef2f6', '#224658': '#e4ebf3', '#dde9ef': '#1f2d3d', '#e3eef2': '#0e2236', '#7fd3ee': '#0a6fb5',
  '#0f7fb3': '#085c97', '#3d6a80': '#d6dee7', '#4f7f95': '#c3cfdb', '#284f66': '#dce5ee', '#1f4658': '#dce5ee', '#a9c3cf': '#8b9aab',
  '#f0a463': '#f77e21', '#d9712a': '#f77e21', '#6fd69a': '#1e7f4a', '#ff8a7e': '#d93025', '#f2c94c': '#e0a800', '#c9a227': '#f77e21',
  '#6fd8e0': '#0a6fb5', '#8ff5ec': '#0a6fb5', '#0a5ca8': '#0a6fb5', '#12a1a6': '#0a6fb5', '#0b1d3a': '#fbfcfd', '#0a3050': '#fbfcfd',
  '#0b4a4f': '#fbfcfd', '#173d22': '#fbfcfd', '#1b1f5e': '#0a6fb5', '#3c7a2a': '#f77e21',
};
const RGBA = [ // [r, g, b] in the dark look -> [r, g, b, alpha factor] in the NIEC look
  [[0, 0, 0], [11, 46, 89, 0.3]],
  [[255, 255, 255], [11, 46, 89, 0.6]],
  [[79, 127, 149], [10, 111, 181, 1]],
  [[18, 161, 166], [10, 111, 181, 0.5]],
  [[127, 233, 236], [10, 111, 181, 1]],
  [[242, 201, 76], [224, 168, 0, 4]],
  [[221, 233, 239], [11, 46, 89, 1]],
];
const TEXT_PROPS = /^(color|caret-color|-webkit-text-fill-color|-webkit-text-stroke-color|text-decoration-color|accent-color)$/;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const RGBA_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g;
const long = (h) => (h.length === 4 ? '#' + h.slice(1).split('').map((c) => c + c).join('') : h).toLowerCase();

// Turns one declaration value into its NIEC counterpart; null when it holds none of the dark look's colours.
function mapValue(prop, value) {
  const table = TEXT_PROPS.test(prop) || (/^--/.test(prop) && /ink|text|fg|link|head|navy|on-|blue-text|brand-text/.test(prop)) ? AS_TEXT : AS_SURFACE;
  let changed = false;
  let v = value.replace(HEX, (h) => { const to = table[long(h)] || AS_SURFACE[long(h)]; if (!to) return h; changed = true; return to; });
  v = v.replace(RGBA_RE, (whole, r, g, b, a) => {
    const hit = RGBA.find(([[R, G, B]]) => +r === R && +g === G && +b === B);
    if (!hit) return whole;
    const [nr, ng, nb, f] = hit[1];
    const alpha = a === undefined ? 1 : Math.min(1, +a * f);
    changed = true;
    return `rgba(${nr}, ${ng}, ${nb}, ${+alpha.toFixed(3)})`;
  });
  if (/^color-scheme$/.test(prop) && /dark/.test(v)) { v = 'light'; changed = true; }
  return changed ? v : null;
}

// One type scale for the whole Application Team look (the global rule: a short scale, not 24 sizes): every pixel size is moved to the
// nearest step. Sizes in em, rem or % are left as they are.
const TYPE_SCALE = [12, 14, 16, 18, 22, 26, 32, 40];
function snapSize(value) {
  const m = /^(\d+(?:\.\d+)?)px(\s*!important)?$/.exec(value.trim());
  if (!m) return null;
  const px = parseFloat(m[1]);
  if (px < 11) return null; // icon and badge micro sizes stay as designed
  let best = TYPE_SCALE[0];
  for (const step of TYPE_SCALE) if (Math.abs(step - px) < Math.abs(best - px) || (Math.abs(step - px) === Math.abs(best - px) && step > best)) best = step;
  return best === px ? null : `${best}px${m[2] || ''}`;
}

function scopeSelector(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    if (/^:root\b/.test(s)) return SCOPE + s.slice(5);
    if (/^html\b/.test(s)) return SCOPE + s.slice(4);
    return SCOPE + ' ' + s;
  }).join(',\n');
}

// A small CSS reader: comments and strings are respected, @media and @supports are walked into, @keyframes and
// @font-face are left out (their colours, if any, play no part in the Application Team's screens).
function walk(css, emit, wrappers = []) {
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (i >= n) break;
    let j = i; let depth = 0; let q = null;
    // the prelude, up to "{" or ";"
    while (j < n) { const c = css[j]; if (q) { if (c === q && css[j - 1] !== '\\') q = null; } else if (c === '"' || c === "'") q = c; else if (css.startsWith('/*', j)) { j = css.indexOf('*/', j + 2) + 1; } else if (c === '{' || c === ';') break; j++; }
    const prelude = css.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (css[j] === ';') { i = j + 1; continue; }
    // the block, up to its matching "}"
    let k = j + 1; depth = 1; q = null;
    while (k < n && depth) { const c = css[k]; if (q) { if (c === q && css[k - 1] !== '\\') q = null; } else if (c === '"' || c === "'") q = c; else if (css.startsWith('/*', k)) { k = css.indexOf('*/', k + 2) + 1; } else if (c === '{') depth++; else if (c === '}') depth--; k++; }
    const body = css.slice(j + 1, k - 1);
    if (/^@(media|supports)/.test(prelude)) walk(body, emit, [...wrappers, prelude]);
    else if (!prelude.startsWith('@')) emit(prelude, body, wrappers);
    i = k;
  }
}

function declarations(body) {
  const out = []; let cur = ''; let depth = 0; let q = null;
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const c of clean) { if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(') depth++; else if (c === ')') depth--; else if (c === ';' && !depth) { out.push(cur); cur = ''; continue; } cur += c; }
  if (cur.trim()) out.push(cur);
  return out.map((d) => { const at = d.indexOf(':'); return at === -1 ? null : [d.slice(0, at).trim(), d.slice(at + 1).trim()]; }).filter(Boolean);
}

function build() {
  const chunks = [];
  for (const file of SOURCES) {
    const css = fs.readFileSync(path.join(root, file), 'utf8');
    const lines = [];
    walk(css, (sel, body, wrappers) => {
      const decls = [];
      for (const [prop, value] of declarations(body)) {
        const v = mapValue(prop.toLowerCase(), value); if (v !== null) decls.push(`  ${prop}: ${v};`);
        if (prop.toLowerCase() === 'font-size') { const z = snapSize(value); if (z !== null) decls.push(`  font-size: ${z};`); }
      }
      if (!decls.length) return;
      let rule = `${scopeSelector(sel)} {\n${decls.join('\n')}\n}`;
      for (const w of [...wrappers].reverse()) rule = `${w} {\n${rule}\n}`;
      lines.push(rule);
    });
    if (lines.length) chunks.push(`/* from ${file} */\n` + lines.join('\n'));
  }
  return chunks.join('\n\n');
}

const BEGIN = '/* ===== BEGIN GENERATED by scripts/build-niec-app-css.js: do not edit by hand ===== */';
const END = '/* ===== END GENERATED ===== */';

function render() {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const a = existing.indexOf(BEGIN); const b = existing.indexOf(END);
  const before = a === -1 ? '' : existing.slice(0, a);
  const after = b === -1 ? '\n' : existing.slice(b + END.length);
  return `${before}${BEGIN}\n${build()}\n${END}${after}`;
}

if (require.main === module) {
  const next = render();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== next) { console.error('shared/niec-app.css is out of date: run node scripts/build-niec-app-css.js'); process.exit(1); }
    console.log('shared/niec-app.css is up to date');
  } else {
    fs.writeFileSync(OUT, next);
    console.log('wrote shared/niec-app.css');
  }
}

module.exports = { render, mapValue };
