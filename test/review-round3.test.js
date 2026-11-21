// Round 3 review fixes (18 Nov 2026): CSV files with quoted line breaks, the right name and date columns, Excel's short phone form,
// and message words that would go to a student unfilled.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function studentFile() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'student-details', 'student-file.js'), 'utf8');
  const root = {};
  new Function('root', src.replace('})(this);', '})(root);'))(root);
  return root.StudentFile;
}

test('a CSV cell with a line break stays one student, the name is the Name column and a date of birth is not the inquiry day', () => {
  const S = studentFile();
  const grid = S.csvRows('﻿Student ID,Student Name,Date of Birth,Email,Phone,Comment\r\n123,Sita Rai,2003-05-01,sita@example.com,9801234567,"wants UK\nand ""Australia"""\n');
  assert.strictEqual(grid.length, 2, 'one heading row and one student');
  assert.strictEqual(grid[1][5], 'wants UK\nand "Australia"');
  const [r] = S.fromGrid(grid);
  assert.deepStrictEqual([r.first, r.last], ['Sita', 'Rai']);
  assert.ok(!r.inquiryDate, 'a date of birth is never the first inquiry day');
});

test('a phone Excel turned into 9.8E+09, or a line with no way to reach the student, is skipped', () => {
  const S = studentFile();
  const checks = S.checkRows([{ first: 'A', last: 'B', phone: '9.8E+09', email: '' }, { first: 'C', last: 'D', phone: '', email: '' }, { first: 'E', last: 'F', phone: '9801234567', email: '' }]);
  assert.deepStrictEqual(checks.map((c) => c.skip), [true, true, false]);
});

test('message words: spaces inside braces and a list inside a sentence are refused, not sent as typed', () => {
  const { badPlaceholder } = require('../student-details/messages');
  assert.match(badPlaceholder('', 'Dear { first_name },', ''), /no spaces/);
  assert.match(badPlaceholder('', 'See {options_table} thanks', ''), /line of its own/);
  assert.strictEqual(badPlaceholder('', 'Dear {first_name},\n\n{options_table}\n\nThanks', ''), '');
});

test('a student moved to another intake while someone edited the old row is not kept on both sheets', () => {
  const { mergeWorkbooks } = require('../student-details/workbook');
  const row = (extra = {}) => ({ _id: 'r1', 'FIRST NAME': 'Sita', ...extra });
  const sheet = (id, rows) => ({ id, name: id, columns: ['FIRST NAME', 'REMARKS'], rows });
  const base = { sheets: [sheet('a', [row()]), sheet('b', [])], activeSheetId: 'a' };
  const theirs = { sheets: [sheet('a', []), sheet('b', [row()])], activeSheetId: 'a' }; // moved to b and saved
  const mine = { sheets: [sheet('a', [row({ REMARKS: 'edited' })]), sheet('b', [])], activeSheetId: 'a' }; // still editing on a
  const out = mergeWorkbooks(base, theirs, mine);
  assert.strictEqual(out.sheets.reduce((n, s) => n + s.rows.filter((r) => r._id === 'r1').length, 0), 1, 'one copy only');
});

test('a row can never be given the name of a built-in (toString, __proto__): it would break pages for everyone', () => {
  const { ROW_ID } = require('../student-details/cards');
  ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'].forEach((id) => assert.ok(!ROW_ID.test(id), id));
  assert.ok(ROW_ID.test('row-abc123'));
  assert.ok(ROW_ID.test('legacy_id-7'));
  const { migrateWorkbook } = require('../student-details/workbook');
  {
    const wb = migrateWorkbook({ sheets: [{ id: 's1', name: 'Jan Intake 2027', columns: [], rows: [{ _id: 'toString' }, { _id: 'row-ok' }] }] });
    const ids = wb.sheets[0].rows.map((r) => r._id);
    assert.ok(!ids.includes('toString'));
    assert.ok(ids.includes('row-ok'));
  }
});
