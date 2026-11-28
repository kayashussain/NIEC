const test = require('node:test');
const assert = require('node:assert');
const W = require('../student-details/intake-window');
const { adventusIntakes } = require('../student-details/partner-refresh');

test('the intake worked on is the next season: January, May or September (office time)', () => {
  const at = (iso) => W.of(new Date(iso));
  assert.strictEqual(at('2026-11-28T06:00:00Z').label, 'January 2027', 'today: the same as the pages showed before');
  assert.deepStrictEqual(at('2026-11-28T06:00:00Z').names, ['January', 'February', 'March']);
  assert.strictEqual(at('2026-12-31T17:00:00Z').label, 'January 2027', '31 Dec in Nepal');
  assert.strictEqual(at('2026-12-31T18:30:00Z').label, 'May 2027', 'already 1 Jan in Nepal');
  assert.deepStrictEqual(at('2027-02-10T06:00:00Z').names, ['April', 'May', 'June']);
  assert.strictEqual(at('2027-04-30T06:00:00Z').label, 'May 2027');
  assert.strictEqual(at('2027-05-01T06:00:00Z').label, 'September 2027');
  assert.deepStrictEqual(at('2027-08-31T06:00:00Z').names, ['July', 'August', 'September', 'October', 'November', 'December']);
  assert.strictEqual(at('2027-09-01T06:00:00Z').label, 'January 2028');
});

test('an intake knows its months in words and in dates, and nothing of another year or season', () => {
  const w = W.of(new Date('2026-11-28T06:00:00Z'));
  assert.ok(w.test('Apply by 4 Dec 2026 for the January 2027 intake'));
  assert.ok(w.test('Feb 2027') && w.test('mar. 2027') && w.test('2027-03-01'));
  assert.ok(!w.test('April 2027') && !w.test('January 2028') && !w.test('Jan 2026'));
  assert.ok(w.startsWith('February 2027 - Semester 2') && !w.startsWith('Starts February 2027'));
  assert.strictEqual(w.indexOf('March 2027'), 2);
  assert.strictEqual(w.indexOf('September 2027'), -1);
  const sep = W.of(new Date('2027-06-15T06:00:00Z'));
  assert.ok(sep.test('Sept 2027') && sep.test('October 2027') && !sep.test('June 2027'));
});

test('intake labels are read from the months given, any season and year', () => {
  assert.strictEqual(W.label(['January 2027', 'February 2027']), 'January and February 2027');
  assert.strictEqual(W.label(['Jun 2027', '2027-05-01', 'May 2027']), 'May and June 2027');
  assert.strictEqual(W.label([]), '');
  assert.strictEqual(W.short('January 2027, February 2027'), 'Jan, Feb 2027');
});

test('the Thursday refresh asks Adventus for the quarters of the intake worked on', () => {
  assert.deepStrictEqual(adventusIntakes(W.of(new Date('2026-11-28T06:00:00Z'))), [{ name: '2027 Q1: Jan, Feb, Mar', id: 'intakes-2027-Q1' }]);
  assert.deepStrictEqual(adventusIntakes(W.of(new Date('2027-06-01T06:00:00Z'))).map((x) => x.id), ['intakes-2027-Q3', 'intakes-2027-Q4']);
});
