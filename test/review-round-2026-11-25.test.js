// The checks of the review round of 25 Nov 2026. All names are made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMockBookings } = require('../student-details/mock-bookings');
const { SECURITY_HEADERS } = require('../shared/server-utils');

const root = path.join(__dirname, '..');

test('scripts run only from this site, the spreadsheet library and our own inline scripts, by hash', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  const src = csp.split('script-src ')[1];
  assert.ok(src, csp);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(src), src);
  // Every inline script in every page of the site has its hash in the policy, so no page is broken by it.
  const crypto = require('node:crypto');
  const pages = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push(p);
  });
  ['shared', 'student-details', 'counselor-incentive'].forEach((d) => walk(path.join(root, d)));
  let seen = 0;
  pages.forEach((p) => {
    const html = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      seen += 1;
      const hash = `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`;
      assert.ok(src.includes(hash), `the inline script in ${path.relative(root, p)} is not allowed by the policy`);
    }
  });
  assert.ok(seen > 0);
});

test('a booking that matched nobody can be tied to a student once, never moved to another', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-link-'));
  fs.writeFileSync(path.join(dir, 'mock-bookings.json'), JSON.stringify({ people: {}, bookings: [{ id: 'b1', owner: 'u', day: '2026-12-01', time: '10:00', status: 'booked', name: 'Asha Demo', email: 'asha@x.test' }] }));
  const bookings = createMockBookings(dir);
  assert.strictEqual(bookings.link('b1', null), false);
  assert.strictEqual(bookings.link('b1', { rowId: 'row-1', mock: 2, university: 'Made-up University', course: 'MSc' }), true);
  const kept = bookings.all().bookings[0];
  assert.deepStrictEqual([kept.rowId, kept.mock, kept.university], ['row-1', 2, 'Made-up University']);
  assert.strictEqual(bookings.link('b1', { rowId: 'row-2', mock: 1 }), false, 'a linked booking is never moved');
});
