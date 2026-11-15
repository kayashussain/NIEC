// What a task is about (the owner, 15 Nov 2026): a tag kept on the task, guessed by the system when none was chosen, and changed later;
// and a name typed in capitals reads normally in a message.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const Fields = require('../student-details/card-fields');
const { createCards } = require('../student-details/cards');
const { valuesFor } = require('../student-details/messages');

test('the system guesses what a task is about from its words, the team and the stage', () => {
  assert.strictEqual(Fields.guessTaskTag('Collect the tuition fee deposit receipt', 'application', 'Application Stage'), 'payment');
  assert.strictEqual(Fields.guessTaskTag('Book the VFS appointment', 'application', ''), 'visa');
  assert.strictEqual(Fields.guessTaskTag('Prepare the student for the interview', 'application', ''), 'mock');
  assert.strictEqual(Fields.guessTaskTag('Ask for the missing transcript', 'mock', ''), 'documents');
  assert.strictEqual(Fields.guessTaskTag('Call the student', 'mock', ''), 'mock');
  assert.strictEqual(Fields.guessTaskTag('Call the student', 'head', 'Payment Stage'), 'payment');
  assert.strictEqual(Fields.guessTaskTag('Call the student', 'head', 'Inquiry'), 'other');
  assert.strictEqual(Fields.taskTag({ tag: 'visa', text: 'Pay the fee' }), 'visa', 'a chosen tag wins over the guess');
  assert.strictEqual(Fields.taskTag({ tag: 'nonsense', text: 'Pay the fee' }), 'payment', 'an unknown tag is guessed again');
});

test('a task keeps the tag it was given, and the tag can be changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-tags-'));
  const cards = createCards(dir);
  const row = 'row-tagtest01';
  const made = cards.addTask(row, { team: 'application', text: 'Submit to Coventry', tag: 'application' }, 'Admin');
  assert.ok(!made.error, made.error);
  assert.strictEqual(made.task.tag, 'application');
  const plain = cards.addTask(row, { team: 'application', text: 'Something', tag: 'not-a-tag' }, 'Admin');
  assert.strictEqual(plain.task.tag, undefined, 'an unknown tag is not kept');
  const changed = cards.tagTask(row, made.task.id, 'payment', 'Admin');
  assert.strictEqual(changed.task.tag, 'payment');
  assert.ok(cards.tagTask(row, made.task.id, 'nonsense', 'Admin').error);
  assert.ok(cards.tagTask(row, 'aaaaaaaaaaaa', 'payment', 'Admin').error);
});

test('a name typed in capitals reads normally in a message; the sheet keeps it as typed', () => {
  const v = valuesFor({ row: { 'FIRST NAME': 'SANJIP KUMAR', 'LAST NAME': 'MAHATO' } });
  assert.strictEqual(v.first_name, 'Sanjip Kumar');
  assert.strictEqual(v.full_name, 'Sanjip Kumar Mahato');
  assert.strictEqual(valuesFor({ row: { 'FIRST NAME': 'McKenzie' } }).first_name, 'McKenzie', 'a name in mixed case is left alone');
});
