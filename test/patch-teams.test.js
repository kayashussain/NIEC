const test = require('node:test');
const assert = require('node:assert');
const { snapshot, diff, makePatch, applyPatch, isEmpty, advance } = require('../shared/patch');
const { viewFor, teamChanges, checkMove, statusChoices, canEdit, seesRow } = require('../shared/teams');

const clone = (x) => JSON.parse(JSON.stringify(x));
const S = 'APPLICATION STATUS';
const book = () => ({
  revision: 4,
  activeSheetId: 'a',
  sheets: [
    { id: 'a', name: 'Jan', columns: ['FIRST NAME', S], rows: [
      { _id: 'r1', 'FIRST NAME': 'Ram', [S]: 'Application Stage' },
      { _id: 'r2', 'FIRST NAME': 'Sita', [S]: 'Mock Stage' },
      { _id: 'r3', 'FIRST NAME': 'Hari', [S]: 'Inquiry' },
    ] },
    { id: 'b', name: 'Sep', hidden: true, columns: ['FIRST NAME', S], rows: [{ _id: 'r4', 'FIRST NAME': 'Gita', [S]: 'Application Stage' }] },
  ],
});

test('a one-cell edit becomes a patch with just that row, and applying it rebuilds the workbook', () => {
  const base = book();
  const next = clone(base);
  next.sheets[0].rows[1].REMARKS = 'called';
  const patch = makePatch(base, next);
  assert.deepStrictEqual(patch.sheets, [{ id: 'a', rows: [next.sheets[0].rows[1]] }]);
  assert.ok(JSON.stringify(patch).length < 200);
  assert.deepStrictEqual(applyPatch(base, patch), next);
});

test('patches carry added, removed and reordered rows, new sheets and sheet settings', () => {
  const base = book();
  const next = clone(base);
  next.sheets[0].rows.reverse();
  next.sheets[0].rows.splice(1, 1);
  next.sheets[0].rows.push({ _id: 'r9', 'FIRST NAME': 'New' });
  next.sheets[1].name = 'Sep 2026';
  next.sheets.push({ id: 'c', name: 'Jan 2027', columns: [], rows: [{ _id: 'x', 'FIRST NAME': 'Z' }] });
  assert.deepStrictEqual(applyPatch(base, makePatch(base, next)), next);
  const removed = clone(base);
  removed.sheets.pop();
  assert.deepStrictEqual(applyPatch(base, makePatch(base, removed)), removed);
});

test('no change makes an empty patch; duplicate or missing row ids make no patch at all', () => {
  const base = book();
  assert.ok(isEmpty(makePatch(base, clone(base)), base));
  const dup = clone(base);
  dup.sheets[0].rows[1]._id = 'r1';
  assert.strictEqual(makePatch(base, dup), null);
  assert.strictEqual(diff(snapshot(base), dup).patch, null);
});

test('a patch that does not fit the base is refused', () => {
  const base = book();
  assert.throws(() => applyPatch(base, { sheetOrder: ['a', 'zzz'], sheets: [] }));
  assert.throws(() => applyPatch(base, { sheetOrder: ['a', 'b'], sheets: [{ id: 'a', rowOrder: ['r1', 'nope'] }] }));
});

test('advance tracks what the server has after a patch', () => {
  const base = book();
  const next = clone(base);
  next.sheets[0].rows[0]['FIRST NAME'] = 'Ramesh';
  const patch = makePatch(base, next);
  const snap = advance(snapshot(base), patch);
  assert.deepStrictEqual(snap, snapshot(next));
});

test('each team sees only its students and no hidden sheets; Admin sees everything', () => {
  const base = book();
  assert.strictEqual(viewFor('admin', base), base);
  const app = viewFor('application', base);
  assert.deepStrictEqual(app.sheets.map((s) => s.id), ['a']);
  assert.deepStrictEqual(app.sheets[0].rows.map((r) => r._id), ['r1']);
  // The Mock and Follow-up Teams were removed (the owner, 22 Nov 2026): such a name is no team and sees no student.
  assert.deepStrictEqual(viewFor('mock', base).sheets[0].rows.map((r) => r._id), []);
  assert.ok(!seesRow('followup', { [S]: 'Inquiry' }) && !seesRow('application', { [S]: 'Withdrawn' }));
});

test('teams edit only their own columns and make only their own moves', () => {
  assert.ok(canEdit('application', 'NOC NUMBER') && !canEdit('application', 'MOCK SCHEDULE 1'));
  assert.ok(!canEdit('mock', 'PRE CAS INTERVIEW') && !canEdit('followup', 'REMARKS'), 'removed teams change nothing');
  assert.ok(canEdit('admin', 'ANYTHING'));
  // A team can also stop, wait or hold a student it has (the owner, 18 Nov 2026), so nobody is stuck at a stage.
  assert.deepStrictEqual(statusChoices('application', 'Application Stage', []), ['Application Stage', 'Mock Stage', 'Defer', 'Withdrawn', 'Hold']);
  assert.deepStrictEqual(statusChoices('application', 'Mock Stage', []), ['Mock Stage', 'Application Stage', 'Defer', 'Withdrawn', 'Hold']);
});

test('Application → Mock warns about blank details; nobody but Admin moves a student on from Mock Stage', () => {
  // The university, course, application day and offer are needed to leave Application (the owner, 18 Nov 2026); the rest only asks.
  const need = { 'UNIVERSITY NAME': 'Test University', 'COURSE NAME': 'BSc Test', 'APPLICATION SUBMISSION DATE': '2026-09-01', 'OFFER RECEIVED DATE': '2026-10-01' };
  const refused = checkMove('application', { [S]: 'Application Stage' }, 'Mock Stage');
  assert.ok(!refused.ok && /University Name/.test(refused.message) && /Course Name/.test(refused.message) && /Application Submitted/.test(refused.message) && /Offer Received/.test(refused.message));
  assert.ok(!checkMove('application', { [S]: 'Application Stage', ...need, 'OFFER RECEIVED DATE': '' }, 'Mock Stage').ok, 'no offer yet: it cannot leave Application');
  const warn = checkMove('application', { [S]: 'Application Stage', ...need, 'STUDENT ID': '' }, 'Mock Stage');
  assert.ok(warn.ok && /Student ID/.test(warn.confirm));
  // Moving on from Mock Stage is Admin's now (the Mock Team was removed, the owner, 22 Nov 2026).
  assert.ok(!checkMove('application', { [S]: 'Mock Stage', 'PRE CAS INTERVIEW': 'Passed' }, 'Payment Stage').ok);
  assert.ok(!checkMove('followup', { [S]: 'Inquiry' }, 'Application Stage').ok);
});

test('a team save is checked cell by cell', () => {
  const base = viewFor('application', book());
  const mine = clone(base);
  mine.sheets[0].rows[0]['NOC NUMBER'] = 'N-1';
  mine.sheets[0].rows[0]['FEE AFTER SCHOLARSHIP'] = '1.00'; // recalculated by the page: ignored
  let out = teamChanges('application', base, mine, ['FEE AFTER SCHOLARSHIP']);
  assert.deepStrictEqual(out, { changes: [{ sheetId: 'a', rowId: 'r1', col: 'NOC NUMBER', value: 'N-1' }], adds: [], deletes: [], errors: [] });

  const sneaky = clone(base);
  sneaky.sheets[0].rows[0]['GROSS FEE'] = '1';
  sneaky.sheets[0].rows[0][S] = 'Visa Issued';
  out = teamChanges('application', base, sneaky);
  assert.strictEqual(out.errors.length, 2);

  const deleted = clone(base);
  deleted.sheets[0].rows = [];
  const del = teamChanges('application', base, deleted);
  assert.ok(del.errors.some((e) => /one student at a time/.test(e)) || base.sheets[0].rows.length === 1, 'several at once is refused');
  assert.ok(teamChanges('chitwan', base, deleted).errors.some((e) => /Only Admin can delete/.test(e)), 'a branch cannot delete');
  const added = clone(base);
  added.sheets[0].rows.push({ _id: 'n', 'FIRST NAME': 'x' }); // a new student: allowed (see below)
  assert.deepStrictEqual(teamChanges('application', base, added).adds.map((a) => a.row[S]), ['Application Stage']);
});

test('a team save moving a student on is checked from the status it had before', () => {
  const base = viewFor('application', book());
  const mine = clone(base);
  mine.sheets[0].rows[0][S] = 'Mock Stage';
  assert.ok(teamChanges('application', base, mine).errors.some((e) => /can't go to Mock Stage/.test(e)), 'refused without the university, course, application day and offer');
  Object.assign(mine.sheets[0].rows[0], { 'UNIVERSITY NAME': 'Test University', 'COURSE NAME': 'BSc Test', 'APPLICATION SUBMISSION DATE': '2026-09-01', 'OFFER RECEIVED DATE': '2026-10-01' });
  assert.deepStrictEqual(teamChanges('application', base, mine).errors, []);
  const early = clone(base);
  early.sheets[0].rows[0][S] = 'Payment Stage'; // not one of the team's moves: refused even if the page is bypassed
  assert.ok(teamChanges('application', base, early).errors.some((e) => /can't move a student from Application Stage to Payment Stage/.test(e)));
});

test('a team can add a student at its own stage, and fill in the basics of students it added', () => {
  const base = viewFor('application', book());
  const mine = clone(base);
  mine.sheets[0].rows.push({ _id: 'n1', [S]: '', 'FIRST NAME': 'Nabin', 'CONTACT NUMBER': '98000', REMARKS: 'walk-in', 'FEE AFTER SCHOLARSHIP': '' });
  const out = teamChanges('application', base, mine, ['FEE AFTER SCHOLARSHIP']);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.adds, [{ sheetId: 'a', row: {
    _id: 'n1', [S]: 'Application Stage', _addedByTeam: 'application', 'FIRST NAME': 'Nabin', 'CONTACT NUMBER': '98000', REMARKS: 'walk-in',
  } }]);
  // Later: the team may fix the email of a student it added, but not of one it didn't.
  const own = { _id: 'n1', [S]: 'Application Stage', _addedByTeam: 'application', 'FIRST NAME': 'Nabin' };
  assert.ok(canEdit('application', 'FIRST NAME', own));
  assert.ok(!canEdit('application', 'GROSS FEE', own));
});

test('a team cannot add a student at another stage, with other columns, or claim another\'s student', () => {
  const base = viewFor('application', book());
  const wrongStage = clone(base);
  wrongStage.sheets[0].rows.push({ _id: 'n2', [S]: 'Visa Issued' });
  assert.ok(teamChanges('application', base, wrongStage).errors.some((e) => /starts at Application Stage/.test(e)));
  const extra = clone(base);
  extra.sheets[0].rows.push({ _id: 'n3', [S]: 'Application Stage', 'GROSS FEE': '9' });
  assert.ok(teamChanges('application', base, extra).errors.some((e) => /Gross Fee/.test(e)));
  // Sending `_addedByTeam` on an existing student doesn't unlock it: the server's copy decides.
  const claim = clone(base);
  Object.assign(claim.sheets[0].rows[0], { _addedByTeam: 'application', 'GROSS FEE': '5' });
  assert.ok(teamChanges('application', base, claim).errors.some((e) => /Gross Fee/.test(e)));
});

test('a team can colour the students it sees, with the listed colours only', () => {
  const base = viewFor('application', book());
  const mine = clone(base);
  mine.sheets[0].rows[0]._color = 'green';
  assert.deepStrictEqual(teamChanges('application', base, mine),
    { changes: [{ sheetId: 'a', rowId: mine.sheets[0].rows[0]._id, col: '_color', value: 'green' }], adds: [], deletes: [], errors: [] });

  const odd = clone(base);
  odd.sheets[0].rows[0]._color = 'url(x)';
  assert.strictEqual(teamChanges('application', base, odd).errors.length, 1, 'a colour outside the list is refused');

  const other = clone(base);
  other.sheets[0].rows[0]._addedByTeam = 'chitwan'; // other hidden fields still can't be changed
  assert.deepStrictEqual(teamChanges('application', base, other).changes, []);

  const { canColor } = require('../shared/teams');
  assert.ok(canColor('chitwan', {}) && canColor('application', {}));
  assert.ok(!canColor({ role: 'manager', departments: [] }, {}), 'a view-only Manager cannot');
});
