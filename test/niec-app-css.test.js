// The Application Team's NIEC look (shared/niec-app.css, the owner, 22 Nov 2026) must stay in step with the stylesheets it
// follows, and must never reach any other team.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { render } = require('../scripts/build-niec-app-css');

const file = path.join(__dirname, '..', 'shared', 'niec-app.css');

test('shared/niec-app.css is up to date with the stylesheets it follows (run node scripts/build-niec-app-css.js)', () => {
  assert.strictEqual(fs.readFileSync(file, 'utf8'), render());
});

test('every rule in shared/niec-app.css applies only to the Application Team', () => {
  const raw = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Animations are named nx-... so they cannot replace one of the other teams'; their from/to steps are not page rules.
  const keyframes = raw.match(/@keyframes\s+([\w-]+)/g) || [];
  assert.deepStrictEqual(keyframes.filter((k) => !/@keyframes\s+nx-/.test(k)), []);
  const css = raw.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const selectors = [];
  // the selector in front of every "{" that opens a rule (not an @media or @supports block)
  const re = /([^{};]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    selectors.push(...sel.split(',').map((s) => s.trim()).filter(Boolean));
  }
  assert.ok(selectors.length > 100);
  const loose = selectors.filter((s) => !s.startsWith('html[data-team="application"]'));
  assert.deepStrictEqual(loose, []);
});

test('the menu marks only an Application Team page and shows the NIEC logo only there', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'shared', 'header.js'), 'utf8');
  assert.match(js, /if \(appOwn\) document\.documentElement\.setAttribute\('data-team', 'application'\); else document\.documentElement\.removeAttribute\('data-team'\);/);
  assert.match(js, /appOwn \? \['\/niec-logo\.png'/);
});
