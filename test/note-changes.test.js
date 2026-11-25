// A note that records changes to details keeps them as data (label, before, after), so a page never has to read them back out of the
// sentence. All names and values are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createCards } = require('../student-details/cards');

test('a change note keeps its changes as data, whatever characters the values hold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-notechanges-'));
  const cards = createCards(dir, { now: () => new Date('2026-11-25T05:00:00Z') });
  const hostile = [
    { label: 'Course', from: 'a" → "b', to: 'c' },
    { label: 'Address', from: 'x; Phone: "y', to: '' },
    { label: 'Mock 1: day', from: '', to: '2026-12-02' },
  ];
  const out = cards.addNote('row-1', { kind: 'note', text: 'Changed on the student card: shortened sentence.', changes: hostile }, 'Asha');
  assert.ok(!out.error);
  const kept = cards.get('row-1').notes.find((n) => n.id === out.note.id);
  assert.deepStrictEqual(kept.changes, hostile, 'every label and value comes back exactly as saved');
  assert.strictEqual(kept.undo, undefined);
  const undone = cards.addNote('row-1', { kind: 'note', text: 'Undone on the student card: x.', changes: [{ label: 'A', from: '1', to: '2' }], undo: true }, 'Asha');
  assert.strictEqual(cards.get('row-1').notes.find((n) => n.id === undone.note.id).undo, true);
});

test('a plain note has no changes, and a huge list is cut to a safe size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-notechanges-'));
  const cards = createCards(dir, { now: () => new Date('2026-11-25T05:00:00Z') });
  const plain = cards.addNote('row-1', { text: 'Called, will visit on Sunday.' }, 'Asha');
  assert.strictEqual(cards.get('row-1').notes.find((n) => n.id === plain.note.id).changes, undefined);
  const many = Array.from({ length: 200 }, (_, i) => ({ label: `L${i}`, from: 'v'.repeat(900), to: 'w' }));
  const big = cards.addNote('row-1', { text: 'Changed on the student card: many.', changes: many }, 'Asha');
  const kept = cards.get('row-1').notes.find((n) => n.id === big.note.id).changes;
  assert.strictEqual(kept.length, 80);
  assert.ok(kept.every((c) => c.from.length <= 2000));
});
