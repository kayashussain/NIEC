// The sheet's University, Course, partner and offer day as they follow a student's applications. All names and days are made up.
const test = require('node:test');
const assert = require('node:assert');
const { syncChanges } = require('../student-details/sheet-sync');

const row = (extra = {}) => ({ 'UNIVERSITY NAME': 'North University', 'COURSE NAME': 'MBA', 'APPLICATION SUBMISSION DATE': '2026-11-01', 'OFFER RECEIVED DATE': '', 'UNIVERSITY PARTNER': 'Partner A', ...extra });
const north = (extra = {}) => ({ university: 'North University', course: 'MBA', applied: '2026-11-01', ...extra });
const south = (extra = {}) => ({ university: 'South University', course: 'MSc Data', applied: '2026-11-03', ...extra });

test('a refused university leaves the sheet, with its course, partner and offer day, when another application is live', () => {
  const out = syncChanges(row({ 'OFFER RECEIVED DATE': '2026-11-05' }), [north({ refused: '2026-11-10', offer: '2026-11-05' }), south({ partner: 'Partner B' })]);
  assert.strictEqual(out['UNIVERSITY NAME'], 'South University');
  assert.strictEqual(out['COURSE NAME'], 'MSc Data');
  assert.strictEqual(out['UNIVERSITY PARTNER'], 'Partner B');
  assert.strictEqual(out['OFFER RECEIVED DATE'], '');
});

test('the old course and partner never stay with the new university, and a direct application is named for it', () => {
  const bare = syncChanges(row(), [north({ refused: '2026-11-10' }), south({ course: '' })]);
  assert.strictEqual(bare['COURSE NAME'], '');
  assert.strictEqual(bare['UNIVERSITY PARTNER'], '');
  const direct = syncChanges(row(), [north({ refused: '2026-11-10' }), south({ partner: 'Direct' })]);
  assert.strictEqual(direct['UNIVERSITY PARTNER'], 'Direct (South University)');
});

test('a course not submitted does not hold a refused university, and nothing is erased with no live application', () => {
  const out = syncChanges(row(), [north({ refused: '2026-11-10' }), { university: 'North University', course: 'MSc', skipped: '2026-11-02' }, south()]);
  assert.strictEqual(out['UNIVERSITY NAME'], 'South University');
  assert.deepStrictEqual(syncChanges(row(), [north({ refused: '2026-11-10' })]), {});
});

test('another live course at the same university keeps the university', () => {
  const out = syncChanges(row(), [north({ refused: '2026-11-10' }), { university: 'North University', course: 'MSc', applied: '2026-11-02' }, south()]);
  assert.strictEqual(out['UNIVERSITY NAME'], undefined);
});

test('when another course of the same university holds the offer, the course follows it', () => {
  const out = syncChanges(row(), [north({ refused: '2026-11-10' }), { university: 'North University', course: 'MSc', applied: '2026-11-02', offer: '2026-11-12' }]);
  assert.strictEqual(out['COURSE NAME'], 'MSc');
  assert.strictEqual(out['OFFER RECEIVED DATE'], '2026-11-12');
});
