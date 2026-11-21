// Apply through (the owner, 20 and 21 Nov 2026): every university and international college, and the partner each one is applied
// through. Admin moves any place to any B2B partner, and a place with a direct route (own agreement, OIEG, Navitas) can move to a
// partner and back; a university and its international college are two places. Also the one-time partner step of 20 Nov.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplyThrough } = require('../student-details/apply-through');
const { createB2b } = require('../student-details/b2b');
const { createPlanning } = require('../student-details/planning');
const { tidyNov20, tidyNames } = require('../student-details/partner-tidy');
const { createCards } = require('../student-details/cards');
const { partnerAccess } = require('../student-details/partner-access');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-apply-'));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'student-details', 'apply-through-seed.json'), 'utf8'));

test('the starting list keeps a university and its international college apart, and every place is listed (the owner, 21 Nov 2026)', () => {
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
  assert.strictEqual(choices.length, SEED.length, 'every place, also a direct route and a place one partner lists');
  assert.ok(choices.some((e) => e.direct && e.name === 'University of West London'), 'a direct university is listed');
  assert.strictEqual(ugic.directPartner, 'Oxford International Education Group', 'the direct route is remembered');
  const firstCollege = choices.findIndex((e) => e.type === 'college');
  assert.ok(choices.slice(0, firstCollege).every((e) => e.type === 'university') && choices.slice(firstCollege).every((e) => e.type === 'college'), 'universities first');
  assert.strictEqual(all.find((e) => e.name === 'University of Wolverhampton').partner, 'Nissus International Education Foundation');
  ['University of Gloucestershire', 'University of Derby', 'University of Plymouth'].forEach((n) => assert.strictEqual(all.find((e) => e.name === n).partner, 'Awarded Edu', n));
});

test('another consultancy starts with an empty list', () => {
  const store = createApplyThrough(tmp(), { wanted: () => false });
  assert.deepStrictEqual(store.all(), []);
});

test('any place moves to any B2B partner, and a direct route to a partner and back (the owner, 21 Nov 2026)', () => {
  const dir = tmp();
  const store = createApplyThrough(dir, { wanted: () => true });
  const partners = ['Adventus', 'Apply Board', 'Real Dreams Educational Consultancy'];
  const e = store.choices().find((x) => x.options.length > 1);
  const other = e.options.find((o) => o !== e.partner);
  const out = store.choose(e.id, other, 'Admin', partners);
  assert.strictEqual(out.from, e.partner);
  assert.strictEqual(out.entry.partner, other);
  assert.strictEqual(createApplyThrough(dir).all().find((x) => x.id === e.id).partner, other, 'kept in the data folder');
  assert.ok(store.choose(e.id, 'Someone else', 'Admin', partners).error, 'a name that is not a B2B partner is refused');
  // A place only one partner lists (the agreement may be lost): it moves to any other B2B partner.
  const single = store.all().find((x) => !x.direct && x.options.length === 1);
  const elsewhere = partners.find((p) => !single.options.includes(p));
  assert.strictEqual(store.choose(single.id, elsewhere, 'Admin', partners).entry.partner, elsewhere);
  assert.strictEqual(createApplyThrough(dir).all().find((x) => x.id === single.id).partner, elsewhere, 'kept, though the partner does not list it');
  // A direct route: to a partner (no longer direct) and back (direct again).
  const uwl = store.all().find((x) => x.name === 'University of West London');
  const moved = store.choose(uwl.id, 'Adventus', 'Admin', partners).entry;
  assert.strictEqual(moved.partner, 'Adventus');
  assert.ok(!moved.direct, 'through a partner now');
  const back = store.choose(uwl.id, uwl.directPartner, 'Admin', partners).entry;
  assert.ok(back.direct && back.partner === uwl.directPartner, 'back on its own route');
  assert.ok(store.choose('no-such-place', 'Adventus', 'Admin', partners).error);
});

test('Universities finds a university by its name, the university before its college', () => {
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
  assert.deepStrictEqual(b2b.all().map((p) => p.name).sort(), ['Adventus', 'Nissus International Education Foundation', 'Real Dreams']);
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

test('every university page shows its partner, and the three ISC pathways go through the partners the owner chose', () => {
  const store = createApplyThrough(tmp(), { wanted: () => true });
  [
    ['University of West of Scotland', 'University of the West of Scotland'], ['University of Ravensbourne', 'Ravensbourne University'],
    ['Winchester University', 'University of Winchester'], ['International College of Dundee (ICD)-Scotland', 'International College Dundee (ICD), University of Dundee'],
    ['International College Robert Gordon University (ICRGU)', 'International College at Robert Gordon University (ICRGU)'], ['Regent College London', 'Regent College'],
    ['Aston University - OnCampus (UG ICAS)', 'Aston University ONCAMPUS Centre'], ['London South Bank University - OnCampus (UG ICAS)', 'London South Bank University ONCAMPUS Centre'],
    ['University of Hull - OnCampus (UG ICAS)', 'University of Hull ONCAMPUS Centre'],
  ].forEach(([page, entry]) => assert.strictEqual((store.find(page) || {}).name, entry, page));
  assert.strictEqual(store.find('London Metropolitan University ISC (Progression Degree for Pathway)').partner, 'Real Dreams Educational Consultancy');
  assert.strictEqual(store.find('University of Cumbria ISC (Progression Degree for Pathway)').partner, 'Real Dreams Educational Consultancy');
  assert.strictEqual(store.find('University of Wolverhampton ISC (Progression Degree for Pathway)').partner, 'Nissus International Education Foundation');
});

test('a list saved before reads the old partner spellings as the full names and gets the three ISC pathways once', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'apply-through.json'), JSON.stringify({ entries: [
    { id: 'university-of-cumbria', name: 'University of Cumbria', type: 'university', options: ['Real Dreams', 'Adventus'], partner: 'Real Dreams' },
    { id: 'university-of-wolverhampton', name: 'University of Wolverhampton', type: 'university', options: ['Nisus Educational Consultancy', 'Adventus'], partner: 'Nisus Educational Consultancy' },
  ] }));
  const store = createApplyThrough(dir);
  const all = store.all();
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all[0].partner, 'Real Dreams Educational Consultancy');
  assert.deepStrictEqual(all[1].options, ['Nissus International Education Foundation', 'Adventus']);
  assert.strictEqual(createApplyThrough(dir).all().length, 5, 'added once');
});

test('the partner names step: full names on the card, the sheet and the shortlists; old spellings stay known; once', () => {
  const dir = tmp();
  const b2b = createB2b(dir);
  const planning = createPlanning(dir);
  const cards = createCards(dir);
  ['Real Dreams', 'Nisus Educational Consultancy', 'Adventus'].forEach((n) => b2b.create(n, 'Test'));
  planning.saveSettings({ notPartners: ['Nisus', 'Someone'] });
  let wb = { revision: 1, sheets: [{ name: 'Jan Intake 2027', rows: [{ 'UNIVERSITY PARTNER': 'Real Dreams' }, { 'UNIVERSITY PARTNER': 'nisus educational consultancy' }, { 'UNIVERSITY PARTNER': 'Adventus' }] }] };
  const opt = cards.addOption('row-1', { university: 'University of Cumbria', course: 'BA Business', partner: 'Real Dreams' }, 'Test').option;
  const log = [];
  tidyNames({ getWorkbook: () => wb, writeWorkbook: (w) => { wb = w; }, b2b, cards, planning, record: (c) => log.push(...c) });
  assert.deepStrictEqual(b2b.all().map((p) => p.name).sort(), ['Adventus', 'Nissus International Education Foundation', 'Real Dreams Educational Consultancy']);
  assert.deepStrictEqual(wb.sheets[0].rows.map((r) => r['UNIVERSITY PARTNER']), ['Real Dreams Educational Consultancy', 'Nissus International Education Foundation', 'Adventus']);
  assert.strictEqual(cards.get('row-1').options.find((o) => o.id === opt.id).partner, 'Real Dreams Educational Consultancy');
  assert.strictEqual(planning.all().settings.partnerAliases['Real Dreams'], 'Real Dreams Educational Consultancy');
  assert.deepStrictEqual(planning.all().settings.notPartners, ['Someone']);
  assert.ok(log.length >= 4, 'written in Activity');
  assert.ok(tidyNames({ getWorkbook: () => wb, writeWorkbook: () => {}, b2b, cards, planning }).skipped, 'it runs once');
});
