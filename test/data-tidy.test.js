const test = require('node:test');
const assert = require('node:assert');
const { tidyWorkbook, tidyData } = require('../student-details/data-tidy');

// Made-up rows only (no real student).
const sheet = (name, rows) => ({ id: 'sheet-' + name, name, rows });

test('an imported intake whose dates are month first is written as YYYY-MM-DD, nothing else changes', () => {
  const wb = { revision: 7, sheets: [sheet('Sep', [
    { 'FIRST NAME': 'Demo', 'PAYMENT DATE': '7/15/2026', 'VISA LODGE DATE': '7/9/2026', 'LANGUAGE TEST DATE': '11/6/2025', REMARKS: '1/2/2026' },
    { 'LANGUAGE TEST DATE': 'Waiver', 'CAS RECEIVED DATE': '2026-08-01' },
  ])] };
  const out = tidyWorkbook(wb);
  const [a, b] = out.workbook.sheets[0].rows;
  assert.strictEqual(a['PAYMENT DATE'], '2026-07-15');
  assert.strictEqual(a['VISA LODGE DATE'], '2026-07-09', '7/9 is read the same way as the rest of its intake: 9 July');
  assert.strictEqual(a['LANGUAGE TEST DATE'], '2025-11-06');
  assert.strictEqual(a.REMARKS, '1/2/2026', 'a note column is never touched');
  assert.strictEqual(b['LANGUAGE TEST DATE'], 'Waiver');
  assert.strictEqual(b['CAS RECEIVED DATE'], '2026-08-01');
  assert.strictEqual(out.workbook.revision, 8);
  assert.match(out.changes[0], /Sep: 3 dates/);
  assert.strictEqual(wb.sheets[0].rows[0]['PAYMENT DATE'], '7/15/2026', 'the workbook passed in is not changed');
});

test('an intake whose dates could be read either way, or disagree, is left alone', () => {
  const unsure = { sheets: [sheet('A', [{ 'PAYMENT DATE': '7/9/2026' }]), sheet('B', [{ 'PAYMENT DATE': '7/15/2026' }, { 'VISA LODGE DATE': '15/7/2026' }])] };
  const out = tidyWorkbook(unsure);
  assert.strictEqual(out.workbook, unsure);
  assert.deepStrictEqual(out.changes, []);
});

test('a day-first intake is read day first', () => {
  const out = tidyWorkbook({ sheets: [sheet('D', [{ 'PAYMENT DATE': '25/12/2026' }, { 'PAYMENT DATE': '3/4/2026' }])] });
  assert.deepStrictEqual(out.workbook.sheets[0].rows.map((r) => r['PAYMENT DATE']), ['2026-12-25', '2026-04-03']);
});

test('"Chitwan" as Receiving Partner becomes "Chitwan Branch" when the column already uses that name; a tidy workbook is not written', () => {
  const wb = { sheets: [sheet('Jan', [{ 'RECEIVING PARTNER': 'Chitwan Branch' }, { 'RECEIVING PARTNER': 'Chitwan' }, { 'RECEIVING PARTNER': 'Head Office' }, { 'RECEIVING PARTNER': 'Pokhara' }])] };
  let written = null;
  let recorded = null;
  const out = tidyData({ getWorkbook: () => wb, writeWorkbook: (w) => { written = w; }, record: (c) => { recorded = c; } });
  assert.deepStrictEqual(written.sheets[0].rows.map((r) => r['RECEIVING PARTNER']), ['Chitwan Branch', 'Chitwan Branch', 'Head Office', 'Pokhara']);
  assert.deepStrictEqual(recorded, out.changes);
  assert.match(out.changes[0], /Chitwan → Chitwan Branch: 1 student/);
  let again = false;
  tidyData({ getWorkbook: () => written, writeWorkbook: () => { again = true; } });
  assert.strictEqual(again, false, 'running it again changes nothing');
});
