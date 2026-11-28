// The partner portals' passwords are sealed in the data files and in the daily backups (the owner, 28 Nov 2026), and read as before
// by the pages and the Thursday refresh. A password that cannot be opened is kept, never emptied.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createB2b } = require('../student-details/b2b');
const { createDirect } = require('../student-details/direct');
const { createSecretBox, isSealed } = require('../student-details/secret-box');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niec-partnerpw-'));
const raw = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('a sealed text opens with the same key only', () => {
  const dir = tmp();
  const box = createSecretBox(dir);
  const s = box.seal('Portal-Pass-1');
  assert.ok(isSealed(s) && !s.includes('Portal-Pass-1'));
  assert.strictEqual(box.open(s), 'Portal-Pass-1');
  assert.strictEqual(box.seal(s), s, 'never sealed twice');
  assert.strictEqual(box.seal(''), '');
  assert.strictEqual(box.open('plain'), 'plain', 'a text never sealed reads as it is');
  assert.strictEqual(createSecretBox(tmp()).open(s), null, 'another folder, no key: it does not open');
  const damaged = s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  assert.strictEqual(box.open(damaged), null);
});

test('a B2B partner\'s portal password is sealed in its file and open on the page', () => {
  const dir = tmp();
  const b2b = createB2b(dir);
  const made = b2b.create('Made-up Partner', 'Admin');
  assert.ok(!made.error, made.error);
  const id = made.university.id;
  const saved = b2b.update(id, { apply: 'https://portal.example.com', applyUser: 'office@example.com', applyPassword: 'Very-Secret-Portal-1' }, 'Admin');
  assert.ok(!saved.error, saved.error);
  assert.ok(!raw(dir, 'b2b-partners.json').includes('Very-Secret-Portal-1'), 'not in the file as typed');
  assert.match(raw(dir, 'b2b-partners.json'), /sealed:v1:/);
  assert.strictEqual(b2b.get(id).applyPassword, 'Very-Secret-Portal-1', 'the page reads it as before');
  assert.strictEqual(createB2b(dir).all().find((p) => p.id === id).applyPassword, 'Very-Secret-Portal-1', 'and after a restart');
  // The daily backup holds it sealed, and a restore from it opens it again.
  const copy = b2b.sealedAll();
  assert.ok(!JSON.stringify(copy).includes('Very-Secret-Portal-1') && isSealed(copy[0].applyPassword));
  b2b.update(id, { apply: 'https://portal.example.com', applyUser: 'office@example.com', applyPassword: 'Changed-Later-2' }, 'Admin');
  b2b.restoreAll(copy);
  assert.strictEqual(b2b.get(id).applyPassword, 'Very-Secret-Portal-1');
  assert.strictEqual(b2b.openAll(copy)[0].applyPassword, 'Very-Secret-Portal-1', 'a backup\'s page shows it opened');
});

test('a file from before is sealed at its first reading, and a password that cannot be opened is kept as it is', () => {
  const dir = tmp();
  const record = { id: 'abcdef012345', name: 'Older Partner', status: 'Active', applyPortal: 'https://portal.example.com', applyUser: 'me@example.com', applyPassword: 'Plain-From-Before', contacts: [], agreements: [], updatedAt: '2026-11-01T00:00:00Z', updatedBy: 'Admin' };
  fs.writeFileSync(path.join(dir, 'b2b-partners.json'), JSON.stringify({ universities: [record] }));
  const b2b = createB2b(dir);
  assert.strictEqual(b2b.get('abcdef012345').applyPassword, 'Plain-From-Before');
  assert.ok(!raw(dir, 'b2b-partners.json').includes('Plain-From-Before'), 'sealed in the file at the first reading');
  assert.strictEqual(JSON.parse(raw(dir, 'b2b-partners.json')).universities[0].name, 'Older Partner', 'nothing else changes');

  // The key file is gone (a data folder copied without it): the sealed password stays sealed, and a save keeps it as it was.
  const sealedText = JSON.parse(raw(dir, 'b2b-partners.json')).universities[0].applyPassword;
  fs.renameSync(path.join(dir, 'mail-key'), path.join(dir, 'mail-key.aside'));
  const lost = createB2b(dir);
  assert.strictEqual(lost.get('abcdef012345').applyPassword, sealedText, 'not emptied');
  lost.update('abcdef012345', { name: 'Older Partner', apply: 'https://portal.example.com', applyUser: 'me@example.com', applyPassword: sealedText }, 'Admin');
  assert.strictEqual(JSON.parse(raw(dir, 'b2b-partners.json')).universities[0].applyPassword, sealedText, 'kept exactly');
  fs.renameSync(path.join(dir, 'mail-key.aside'), path.join(dir, 'mail-key'));
  assert.strictEqual(createB2b(dir).get('abcdef012345').applyPassword, 'Plain-From-Before', 'the key back: it opens again');
});

test('Partner Universities and Agents are sealed the same way', () => {
  const dir = tmp();
  const direct = createDirect(dir, { starters: [] });
  const u = direct.create('Made-up University', 'Admin').university;
  direct.update(u.id, { name: 'Made-up University', apply: 'https://apply.example.ac.uk', applyUser: 'agent', applyPassword: 'Uni-Portal-Pass' }, 'Admin');
  assert.ok(!raw(dir, 'direct-universities.json').includes('Uni-Portal-Pass'));
  assert.strictEqual(direct.get(u.id).applyPassword, 'Uni-Portal-Pass');
  const agents = createB2b(dir, { file: 'agents.json', filesFolder: 'agent-files', what: 'agent' });
  const a = agents.create('Made-up Agent', 'Admin').university;
  agents.update(a.id, { apply: 'https://agent.example.com', applyUser: 'x', applyPassword: 'Agent-Pass-9' }, 'Admin');
  assert.ok(!raw(dir, 'agents.json').includes('Agent-Pass-9'));
  assert.strictEqual(agents.get(a.id).applyPassword, 'Agent-Pass-9');
});
