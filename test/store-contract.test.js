// Every storage backend must behave the same: this is the contract the rest of the code relies on (student-details/store.js).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createFileStore, createSqliteStore } = require('../student-details/store');

let hasSqlite = true;
try { require('node:sqlite'); } catch (e) { hasSqlite = false; }

const backends = [
  ['files', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-store-')); return { make: (o) => createFileStore(dir, o), damage: (name) => fs.writeFileSync(path.join(dir, `${name}.json`), '{"cards": {"a":'), done() {} }; }],
  ['sqlite', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-store-')); const file = path.join(dir, 'isr.sqlite'); let s = null; return { make: (o) => { s = createSqliteStore(file, o); return s; }, damage: (name) => { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(file); d.prepare('UPDATE docs SET json = ? WHERE name = ?').run('{"cards": {"a":', name); d.close(); }, done() { if (s) s.close(); } }; }],
];

for (const [kind, setup] of backends) {
  const opts = kind === 'sqlite' && !hasSqlite ? { skip: 'node:sqlite is not in this Node' } : {};

  test(`${kind}: nothing saved reads as null; a save reads back, and the version moves with every change`, opts, () => {
    const t = setup(); const s = t.make();
    assert.strictEqual(s.read('cards'), null);
    assert.strictEqual(s.version('cards'), '');
    const v1 = s.write('cards', { cards: { a: { n: 1 } } });
    assert.deepStrictEqual(s.read('cards').data, { cards: { a: { n: 1 } } });
    assert.strictEqual(s.read('cards').version, v1);
    assert.strictEqual(s.version('cards'), v1);
    const v2 = s.write('cards', { cards: { a: { n: 2 } } });
    assert.notStrictEqual(v2, v1);
    assert.strictEqual(s.read('cards').data.cards.a.n, 2);
    t.done();
  });

  test(`${kind}: documents are separate, and a bad name is refused`, opts, () => {
    const t = setup(); const s = t.make();
    s.write('cards', { x: 1 }); s.write('planning', { y: 2 });
    assert.deepStrictEqual(s.read('planning').data, { y: 2 });
    assert.throws(() => s.write('../evil', {}), /Not a document name/);
    assert.throws(() => s.read('A B'), /Not a document name/);
    assert.throws(() => s.write('cards', undefined), /Nothing to save/);
    t.done();
  });

  test(`${kind}: the day's first copy is kept once, newest first, and holds the data as it was before that save`, opts, () => {
    let clock = new Date('2026-11-20T10:00:00Z');
    const t = setup(); const s = t.make({ now: () => clock });
    s.write('cards', { n: 1 });                       // nothing before it: no copy yet
    assert.deepStrictEqual(s.snapshots('cards'), []);
    s.write('cards', { n: 2 });                       // first save with something before it: copies {n:1}
    s.write('cards', { n: 3 });                       // same day: no second copy
    clock = new Date('2026-11-21T10:00:00Z');
    s.write('cards', { n: 4 });                       // next day: copies {n:3}
    const snaps = s.snapshots('cards');
    assert.strictEqual(snaps.length, 2);
    assert.deepStrictEqual(snaps.map((x) => x.read().n), [3, 1], 'newest first');
    assert.strictEqual(s.read('cards').data.n, 4);
    t.done();
  });

  test(`${kind}: a damaged document is reported, set aside and kept, and a fresh one can be written`, opts, () => {
    const t = setup(); const s = t.make();
    s.write('cards', { cards: { a: 1 } }); s.write('cards', { cards: { a: 2 } });
    t.damage('cards');
    assert.throws(() => s.read('cards'), (e) => e.damaged === true);
    const kept = s.quarantine('cards');
    assert.ok(kept && /damaged/.test(kept), 'it says what it was kept as');
    assert.strictEqual(s.read('cards'), null);
    assert.deepStrictEqual(s.snapshots('cards')[0].read(), { cards: { a: 1 } }, 'the recovery copy is still there');
    s.write('cards', { cards: { a: 3 } });
    assert.strictEqual(s.read('cards').data.cards.a, 3);
    t.done();
  });
}

test('both backends hold a large document and unicode without change', { skip: hasSqlite ? false : 'node:sqlite is not in this Node' }, () => {
  const big = { cards: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`r${i}`, { name: `Student ${i} नेपाल éü`, notes: ['x'.repeat(200)] }])) };
  for (const [, setup] of backends) { const t = setup(); const s = t.make(); s.write('cards', big); assert.deepStrictEqual(s.read('cards').data, big); t.done(); }
});

test('the real student cards run on either backend, with the same answers, and carry on after damage', { skip: hasSqlite ? false : 'node:sqlite is not in this Node' }, () => {
  const { createCards } = require('../student-details/cards');
  const answers = [];
  for (const [kind, setup] of backends) {
    const t = setup(); const store = t.make();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-cards-'));
    const cards = createCards(dir, { store });
    assert.strictEqual(cards.has('r1'), false);
    const n1 = cards.addNote('r1', { kind: 'note', text: 'First call' }, 'asha');
    cards.addNote('r2', { kind: 'note', text: 'Other student' }, 'asha');
    const t1 = cards.addTask('r1', { team: 'application', text: 'Make the NOC account', tag: 'noc' }, 'owner');
    assert.ok(!n1.error && !t1.error);
    assert.strictEqual(cards.setTask('r1', t1.task.id, true, 'asha').task.done, true);
    answers.push([kind, cards.get('r1').notes.map((x) => x.text), cards.get('r1').tasks.map((x) => [x.text, x.done]), Object.keys(cards.all()).sort()]);
    // a second server reading the same store sees the same cards
    assert.strictEqual(createCards(dir, { store }).get('r1').notes[0].text, 'First call');
    // damage: it is set aside and the cards carry on from the day's copy
    t.damage('cards');
    const again = createCards(dir, { store });
    assert.doesNotThrow(() => again.get('r1'));
    t.done();
  }
  assert.deepStrictEqual(answers[0].slice(1), answers[1].slice(1), 'files and SQLite give the same answers');
});
