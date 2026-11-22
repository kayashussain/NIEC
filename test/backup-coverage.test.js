// The Mock interview guides and the Apply through list are edited by people, so a backup must hold them and a restore must bring them back.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createMockGuides } = require('../student-details/mock-guides');
const { createApplyThrough } = require('../student-details/apply-through');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niec-cover-'));

test('mock guides: what a backup holds can be put back, progress included', () => {
  const g = createMockGuides(tmp(), { universities: () => ["Test University"] });
  assert.strictEqual(g.all(), null, "a backup never creates the guides");
  g.list();
  const snap = JSON.parse(JSON.stringify(g.all()));
  assert.ok(snap.guides.core);
  snap.progress = { r1: { core: { welcome: '2026-11-01T00:00:00.000Z' } } };
  const other = createMockGuides(tmp());
  other.restoreAll(snap);
  assert.deepStrictEqual(Object.keys(other.all().guides).sort(), Object.keys(snap.guides).sort());
  assert.deepStrictEqual(other.all().progress, snap.progress);
  const before = JSON.stringify(other.all());
  other.restoreAll(null); other.restoreAll({ guides: [] }); // nonsense changes nothing
  assert.strictEqual(JSON.stringify(other.all()), before);
});

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
