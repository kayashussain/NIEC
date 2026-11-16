const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Site-wide looks must hang on their own class names, never on a plain everyday word. On 13 and again on 16 Nov 2026 the
// "nothing here yet" look (a big round badge with a dot) was written for the plain class "empty", and every small thing
// that was also called "empty" (an empty date box, the "Choose the date" words in the Language Test column) drew that
// badge inside a table row. The owner saw it as a crash. This test fails if a stylesheet styles a bare word class again.
const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.claude', 'demo-data', 'live-data']);
const BARE = ['empty', 'is-empty'];

function* styleSources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* styleSources(full);
    else if (entry.name.endsWith('.css')) yield [full, fs.readFileSync(full, 'utf8')];
    else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(full, 'utf8');
      const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
      if (blocks.length) yield [full, blocks.join('\n')];
    }
  }
}

// The selectors of a stylesheet, comments removed, @media and the like unwrapped.
function selectors(css) {
  const out = [];
  css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{/g, (m, sel) => {
    sel.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s)).forEach((s) => out.push(s));
    return m;
  });
  return out;
}

test('no stylesheet gives a look to a bare everyday class name on its own (such as .empty)', () => {
  const found = [];
  for (const [file, css] of styleSources(ROOT)) {
    for (const sel of selectors(css)) {
      // A compound such as ".date-input.empty" or "td.empty" is fine: it is tied to one thing. A selector part that is only
      // the bare word (optionally with :not(...) or a pseudo element) applies to anything on any page.
      for (const part of sel.split(/[\s>+~]+/)) {
        const m = part.match(/^\.([a-z-]+)((?::[a-z-]+(?:\([^)]*\))?|::[a-z-]+)*)$/);
        if (m && BARE.includes(m[1])) found.push(`${path.relative(ROOT, file)}: ${sel}`);
      }
    }
  }
  assert.deepStrictEqual(found, []);
});
