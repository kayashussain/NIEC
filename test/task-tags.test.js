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
  assert.strictEqual(Fields.guessTaskTag('Get the NOC from the ministry', 'application', ''), 'noc', 'NOC is a tag of its own');
  assert.strictEqual(Fields.guessTaskTag('Book the medical check at IOM', 'application', ''), 'medical', 'Medical is a tag of its own');
  // The owner, 15 Nov 2026: medical tasks came out as Other or Payment.
  assert.strictEqual(Fields.guessTaskTag('Medicals booking for the student', 'application', 'Payment Stage'), 'medical', 'medicals, plural');
  assert.strictEqual(Fields.guessTaskTag('Send for the TB test', 'application', 'Inquiry'), 'medical');
  assert.strictEqual(Fields.guessTaskTag('Chest x-ray report pending', 'head', ''), 'medical');
  assert.strictEqual(Fields.guessTaskTag('Pay the health surcharge', 'application', ''), 'payment', 'the IHS is a payment');
  assert.strictEqual(Fields.taskTag({ tag: 'visa', text: 'Pay the fee' }), 'visa', 'a chosen tag wins over the guess');
  assert.strictEqual(Fields.taskTag({ tag: 'nonsense', text: 'Pay the fee' }), 'payment', 'an unknown tag is guessed again');
});

test('a task keeps the tag and the priority it was given, and both can be changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-tags-'));
  const cards = createCards(dir);
  const row = 'row-tagtest01';
  const made = cards.addTask(row, { team: 'application', text: 'Submit to Coventry', tag: 'application' }, 'Admin');
  assert.ok(!made.error, made.error);
  assert.strictEqual(made.task.tag, 'application');
  assert.strictEqual(made.task.priority, 'high', 'every task is Priority unless something else is chosen');
  assert.strictEqual(cards.addTask(row, { team: 'mock', text: 'x', priority: 'super' }, 'Admin').task.priority, 'super');
  assert.strictEqual(cards.addTask(row, { team: 'mock', text: 'x', priority: 'urgent!!' }, 'Admin').task.priority, 'high');
  assert.strictEqual(Fields.taskPriorityOf({}), 'high', 'an older task with no priority counts as Priority');
  assert.strictEqual(cards.tagTask(row, made.task.id, { priority: 'medium' }, 'Admin').task.priority, 'medium');
  assert.ok(cards.tagTask(row, made.task.id, { priority: 'nonsense' }, 'Admin').error);
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

test('a task is given with Application, Mock interview, Documents, NOC, Medical or Other; older tags still read (the owner, 20 Nov 2026)', () => {
  const F = require('../student-details/card-fields');
  assert.deepStrictEqual(F.TASK_TAGS_CHOOSABLE.map(([k]) => k), ['application', 'mock', 'documents', 'noc', 'medical', 'other']);
  ['offer', 'payment', 'visa'].forEach((k) => assert.ok(F.TASK_TAG_IDS.includes(k), `${k} is still a known tag, so stored tasks keep it`));
});

test('the card keeps a passport expiry (a future day) and a gender from its list; the studies and English stay as before (the owner, 21 Nov 2026)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-profile-'));
  const cards = createCards(dir);
  const row = 'row-proftest01';
  cards.setProfile(row, { passportExpiry: '2031-05-04', gender: 'female', qualification: '+2 or Grade 12', grade: '3.1', englishTest: 'IELTS UKVI', englishScore: '6.5' }, 'Admin');
  const p = cards.get(row).profile;
  assert.strictEqual(p.passportExpiry, '2031-05-04', 'a passport expiry in the future is kept');
  assert.strictEqual(p.gender, 'Female', 'the gender is one of its choices, whatever the letter case');
  assert.strictEqual(p.grade, '3.1');
  cards.setProfile(row, { gender: 'Robot' }, 'Admin');
  assert.strictEqual(cards.get(row).profile.gender, undefined, 'a gender outside the list is not kept');
  assert.strictEqual(cards.get(row).profile.passportExpiry, '2031-05-04', 'other details are kept when one changes');
});
