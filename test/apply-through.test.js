// Apply through (the owner, 20 Nov 2026): the places two or more B2B partners offer, and the partner each one is applied through.
// A direct route (own agreement, OIEG, Navitas) or one partner only is never a choice; a university and its international college
// are two places; only Admin changes a partner and the Application Team looks. Also the one-time partner step of the same day.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplyThrough, choosable } = require('../student-details/apply-through');
const { createB2b } = require('../student-details/b2b');
const { createPlanning } = require('../student-details/planning');
const { tidyNov20 } = require('../student-details/partner-tidy');
const { partnerAccess } = require('../student-details/partner-access');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-apply-'));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'student-details', 'apply-through-seed.json'), 'utf8'));

test('the starting list keeps a university and its international college apart, and never offers a direct route as a choice', () => {
  const store = createApplyThrough(tmp(), { wanted: () => true });
  const all = store.all();
  assert.strictEqual(all.length, SEED.length);
  const uni = all.find((e) => e.name === 'University of Greenwich');
  const ugic = all.find((e) => e.name === 'University of Greenwich International College (UGIC)');
  assert.ok(uni && ugic && uni.id !== ugic.id, 'two entries');
  assert.strictEqual(uni.type, 'university');
  assert.strictEqual(ugic.type, 'college');
  assert.ok(ugic.direct && ugic.partner === 'Oxford International Education Group', 'UGIC goes through OIEG, no choice');
  assert.ok(!uni.options.includes('Oxford International Education Group'), 'OIEG does not offer the university itself');
  const choices = store.choices();
  assert.ok(choices.length > 0);
  assert.ok(choices.every((e) => !e.direct && e.options.length > 1), 'only places with two or more partners and no direct route');
  assert.ok(!choices.some((e) => /Navitas|Oxford International/.test(e.partner)), 'Navitas and OIEG places are not listed');
  assert.ok(!choices.some((e) => e.name === 'University of West London'), 'a direct university is not listed');
  assert.strictEqual(all.find((e) => e.name === 'University of Wolverhampton').partner, 'Nisus Educational Consultancy');
  ['University of Gloucestershire', 'University of Derby', 'University of Plymouth'].forEach((n) => assert.strictEqual(all.find((e) => e.name === n).partner, 'Awarded Edu', n));
});

test('another consultancy starts with an empty list', () => {
  const store = createApplyThrough(tmp(), { wanted: () => false });
  assert.deepStrictEqual(store.all(), []);
});

test('a partner is changed only to one that offers the place, and never for a place without a choice', () => {
  const dir = tmp();
  const store = createApplyThrough(dir, { wanted: () => true });
  const e = store.choices().find((x) => x.options.length > 1);
  const other = e.options.find((o) => o !== e.partner);
  const out = store.choose(e.id, other, 'Admin');
  assert.strictEqual(out.from, e.partner);
  assert.strictEqual(out.entry.partner, other);
  assert.strictEqual(createApplyThrough(dir).all().find((x) => x.id === e.id).partner, other, 'kept in the data folder');
  assert.ok(store.choose(e.id, 'Someone else', 'Admin').error, 'a partner that does not offer it is refused');
  const fixed = store.all().find((x) => !choosable(x));
  assert.ok(store.choose(fixed.id, fixed.options[0], 'Admin').error, 'no choice for a direct or one-partner place');
  assert.ok(store.choose('no-such-place', 'Adventus', 'Admin').error);
});

test('the Fact File finds a university by its name, the university before its college', () => {
  const store = createApplyThrough(tmp(), { wanted: () => true });
  assert.strictEqual(store.find('University of Greenwich').type, 'university');
  assert.strictEqual(store.find('UWE Bristol').name, 'University of the West of England');
  assert.strictEqual(store.find('Nowhere University'), null);
});

test('only Admin changes Apply through; the Application Team looks; nobody else sees it', () => {
  assert.strictEqual(partnerAccess({ role: 'admin' }).applyThrough, 'full');
  assert.strictEqual(partnerAccess({ role: 'staff', departments: ['application'] }).applyThrough, 'view');
  assert.strictEqual(partnerAccess({ role: 'staff', departments: ['mock'] }).applyThrough, null);
  assert.strictEqual(partnerAccess({ role: 'manager' }).applyThrough, null);
});

test('the partner step of 20 Nov 2026: Leeds Beckett removed from B2B, OIEG no longer hidden, Nisus added, once', () => {
  const dir = tmp();
  const b2b = createB2b(dir);
  const planning = createPlanning(dir);
  ['Real Dreams', 'Adventus', 'leeds Beckett university'].forEach((n) => b2b.create(n, 'Test'));
  planning.saveSettings({ notPartners: ['OIG', 'Some other'] });
  const log = [];
  tidyNov20({ b2b, planning, record: (c) => log.push(...c) });
  assert.deepStrictEqual(b2b.all().map((p) => p.name).sort(), ['Adventus', 'Nisus Educational Consultancy', 'Real Dreams']);
  assert.deepStrictEqual(planning.all().settings.notPartners, ['Some other']);
  assert.ok(log.length >= 3, 'written in Activity');
  b2b.create('Leeds Beckett University', 'Admin');
  assert.ok(tidyNov20({ b2b, planning }).skipped, 'it runs once');
  assert.ok(b2b.all().some((p) => p.name === 'Leeds Beckett University'), 'what Admin does later is left alone');
});

test('the partner step adds nothing for another consultancy', () => {
  const dir = tmp();
  const b2b = createB2b(dir);
  const planning = createPlanning(dir);
  b2b.create('Global Study Partners', 'Test');
  tidyNov20({ b2b, planning });
  assert.deepStrictEqual(b2b.all().map((p) => p.name), ['Global Study Partners']);
});
