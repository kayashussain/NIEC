// The Apply through list is edited by people, so a backup must hold it and a restore must bring it back.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApplyThrough } = require('../student-details/apply-through');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niec-cover-'));

test('apply through: restoring a list brings back Admin\'s choices and ignores nonsense', () => {
  const a = createApplyThrough(tmp(), { wanted: () => true });
  assert.strictEqual(a.stored(), null, 'a backup never creates the list');
  const list = a.all();
  assert.ok(list.length > 0);
  const other = createApplyThrough(tmp());
  assert.strictEqual(other.all().length, 0);
  other.restoreAll(list);
  assert.deepStrictEqual(other.all(), list);
  other.restoreAll('x'); other.restoreAll(null);
  assert.deepStrictEqual(other.all(), list);
});
