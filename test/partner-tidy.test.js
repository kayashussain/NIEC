// The owner's partner tidy-up (15 Nov 2026): Navitas and OIEG become Partner Universities, ARUC students become Navitas, the
// spellings of Awarded and of The Official Rep (TOR) are put together, it runs once, and a fresh installation is left alone.
// Every student here is made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDirect } = require('../student-details/direct');
const { createB2b } = require('../student-details/b2b');
const { createPlanning } = require('../student-details/planning');
const { tidyPartners } = require('../student-details/partner-tidy');

const setup = (partners, b2bCards = [], notPartners = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-tidy-'));
  const direct = createDirect(dir);
  const b2b = createB2b(dir);
  const planning = createPlanning(dir);
  b2bCards.forEach((c) => { const m = b2b.create(c.name, 'Test'); if (c.apply) b2b.update(m.university.id, { ...m.university, apply: c.apply }, 'Test'); });
  if (notPartners.length) planning.saveSettings({ notPartners });
  let wb = { revision: 3, sheets: [{ id: 's1', name: 'Jan Intake 2027', columns: ['FIRST NAME', 'UNIVERSITY PARTNER'], rows: partners.map((p, i) => ({ _id: 'r' + i, 'FIRST NAME': 'Student ' + i, 'UNIVERSITY PARTNER': p })) }] };
  const log = [];
  const run = () => tidyPartners({ getWorkbook: () => wb, writeWorkbook: (next) => { wb = next; }, direct, b2b, planning, record: (c) => log.push(...c) });
  return { direct, b2b, planning, run, log, wb: () => wb };
};

test('the partners are tidied as the owner asked, once', () => {
  const t = setup(['ARUC', 'Navitas', 'OIEG', 'Awarded Edu', 'Awarded', 'TOR', 'TOR', 'The Official Rep', 'Real Dreams', ''],
    [{ name: 'Awarded Edu' }, { name: 'The Official Rep' }, { name: 'OIEG', apply: 'https://portal.oieg.example' }], ['Navitas', 'ARUC', 'Awarded', 'TOR', 'Some other']);
  t.run();
  const col = t.wb().sheets[0].rows.map((r) => r['UNIVERSITY PARTNER']);
  assert.deepStrictEqual(col, ['Navitas', 'Navitas', 'OIEG', 'Awarded Edu', 'Awarded Edu', 'The Official Rep', 'The Official Rep', 'The Official Rep', 'Real Dreams', '']);
  assert.strictEqual(t.wb().revision, 4);
  const unis = t.direct.all().map((u) => u.name);
  assert.ok(unis.includes('Navitas') && unis.includes('OIEG'), 'Navitas and OIEG are Partner Universities');
  assert.strictEqual(t.direct.all().find((u) => u.name === 'OIEG').applyPortal.replace(/\/$/, ''), 'https://portal.oieg.example', 'the B2B card\'s portal moves with it');
  assert.deepStrictEqual(t.b2b.all().map((p) => p.name).sort(), ['Awarded Edu', 'The Official Rep'], 'OIEG is no longer a B2B partner');
  const s = t.planning.all().settings;
  assert.deepStrictEqual(s.notPartners, ['Some other'], 'only the names the owner did not mention stay hidden');
  assert.strictEqual(s.partnerAliases.TOR, 'The Official Rep');
  assert.strictEqual(s.partnerAliases.ARUC, 'Navitas');
  assert.strictEqual(s.partnerAliases.Awarded, 'Awarded Edu');
  assert.ok(t.log.length > 0, 'written in Activity');
  // Once only: a name typed again later is left as it is.
  t.wb().sheets[0].rows[0]['UNIVERSITY PARTNER'] = 'ARUC';
  assert.deepStrictEqual(t.run(), { skipped: true });
  assert.strictEqual(t.wb().sheets[0].rows[0]['UNIVERSITY PARTNER'], 'ARUC');
});

test('a fresh installation (another consultancy) gets nothing added', () => {
  const t = setup(['Some Partner', '']);
  const before = t.direct.all().length;
  t.run();
  assert.strictEqual(t.direct.all().length, before);
  assert.deepStrictEqual(t.planning.all().settings.partnerAliases, {});
  assert.strictEqual(t.wb().revision, 3, 'the sheet is not touched');
});

test('The Official Rep and TOR go under the B2B card "The Official Representative", once (the second step)', () => {
  const { tidyOfficialRep } = require('../student-details/partner-tidy');
  // As on the live server after the first step: the students under "The Official Rep", TOR a known other name of it, the card under
  // the long name, and the short name hidden.
  const t = setup(['The Official Rep', 'The Official Rep', 'TOR', 'Real Dreams'], [{ name: 'The Official Representative' }], ['The Official Rep', 'Some other']);
  t.planning.saveSettings({ partnerAliases: { TOR: 'The Official Rep' }, tidied: ['partners-2026-11-15'] });
  let wb = t.wb();
  const log = [];
  const run = () => tidyOfficialRep({ getWorkbook: () => wb, writeWorkbook: (next) => { wb = next; }, b2b: t.b2b, planning: t.planning, record: (c) => log.push(...c) });
  run();
  assert.deepStrictEqual(wb.sheets[0].rows.map((r) => r['UNIVERSITY PARTNER']), ['The Official Representative', 'The Official Representative', 'The Official Representative', 'Real Dreams']);
  const s = t.planning.all().settings;
  assert.strictEqual(s.partnerAliases.TOR, 'The Official Representative');
  assert.strictEqual(s.partnerAliases['The Official Rep'], 'The Official Representative');
  assert.deepStrictEqual(s.notPartners, ['Some other'], 'no longer hidden');
  assert.deepStrictEqual(t.b2b.all().map((p) => p.name), ['The Official Representative']);
  assert.ok(log.length);
  wb.sheets[0].rows[0]['UNIVERSITY PARTNER'] = 'TOR';
  assert.deepStrictEqual(run(), { skipped: true }, 'once only');
});

test('the second step leaves an installation without these names alone', () => {
  const { tidyOfficialRep } = require('../student-details/partner-tidy');
  const t = setup(['Some Partner']);
  let wb = t.wb();
  tidyOfficialRep({ getWorkbook: () => wb, writeWorkbook: (next) => { wb = next; }, b2b: t.b2b, planning: t.planning });
  assert.deepStrictEqual(t.planning.all().settings.partnerAliases, {});
  assert.strictEqual(wb.revision, 3);
});
