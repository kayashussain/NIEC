// Start fresh deletes student data, so it is held to two rules (25 Nov 2026): nothing runs it by itself when the server starts, and it
// saves a backup before it deletes anything.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'student-details', 'server.js'), 'utf8').replace(/\r\n/g, '\n');

test('Start fresh is called only by the Admin button, never at start-up', () => {
  const calls = server.split('\n').filter((l) => /\bstartFresh\(/.test(l) && !/^\s*function startFresh\(/.test(l) && !/^\s*\/\//.test(l));
  assert.strictEqual(calls.length, 1, calls.join('\n'));
  const at = server.indexOf(calls[0]);
  assert.ok(server.lastIndexOf("if (urlPath === '/api/restore/fresh-start') {", at) > server.indexOf('async function handleRestore'), 'inside the Admin route');
});

test('a backup is saved before anything is deleted', () => {
  const body = server.slice(server.indexOf('function startFresh('), server.indexOf('async function handleRestore'));
  const backup = body.indexOf("backups.create('before-restore')");
  assert.ok(backup > 0, 'a backup is made');
  ['writeWorkbook(', 'cards.restoreAll(', 'mockBookings.restoreAll(', 'message-log.jsonl'].forEach((step) => assert.ok(body.indexOf(step) > backup, `${step} comes after the backup`));
});
