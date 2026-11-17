// The student card's Timeline (the owner, 17 Nov 2026): a note can be changed by the person who wrote it (or Admin), and pinned to the top.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createCards } = require('../student-details/cards');

test('timeline notes: change by the writer or Admin, pin up to 5', () => {
  const cards = createCards(fs.mkdtempSync(path.join(os.tmpdir(), 'niec-tl-')));
  const row = 'r1';
  const a = cards.addNote(row, { text: 'IELTS booked' }, 'Sita');
  assert.ok(!a.error);
  const nid = a.note.id;
  assert.match(cards.editNote(row, nid, { text: 'IELTS booked for 6 Dec' }, 'Ram').error, /Only the person/);
  const ok = cards.editNote(row, nid, { text: 'IELTS booked for 6 Dec' }, 'Sita');
  assert.strictEqual(ok.note.text, 'IELTS booked for 6 Dec');
  assert.ok(ok.note.editedAt);
  assert.strictEqual(cards.editNote(row, nid, { text: 'by admin' }, 'Admin', true).note.text, 'by admin');
  assert.match(cards.editNote(row, nid, { text: '   ' }, 'Sita').error, /cannot be empty/);
  // Anyone who may change the card pins a note; the words stay as they were.
  const pin = cards.editNote(row, nid, { pinned: true }, 'Ram');
  assert.strictEqual(pin.note.pinned, true);
  assert.strictEqual(pin.note.text, 'by admin');
  assert.strictEqual(cards.get(row).notes[0].pinned, true);
  for (let i = 0; i < 4; i += 1) { const n = cards.addNote(row, { text: 'n' + i }, 'Sita'); cards.editNote(row, n.note.id, { pinned: true }, 'Sita'); }
  const extra = cards.addNote(row, { text: 'sixth' }, 'Sita');
  assert.match(cards.editNote(row, extra.note.id, { pinned: true }, 'Sita').error, /Up to 5/);
  const off = cards.editNote(row, nid, { pinned: false }, 'Sita');
  assert.strictEqual(off.note.pinned, undefined);
  assert.match(cards.editNote(row, 'nope00', { pinned: true }, 'Sita').error, /No such note/);
});
