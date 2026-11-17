// The connector reads the rest of the portal (advisor-data.js), and never shows a password, token or key. All data here is made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createAdvisorMcp } = require('../student-details/advisor-mcp');
const { createFacts } = require('../student-details/facts');

const TOKEN = 'y'.repeat(40);
const workbook = { revision: 1, sheets: [{ id: 's1', name: 'Jan 2027', columns: ['FIRST NAME', 'LAST NAME', 'APPLICATION STATUS'], rows: [
  { _id: 'r1', 'FIRST NAME': 'Asha', 'LAST NAME': 'Demo', 'APPLICATION STATUS': 'Offer' },
  { _id: 'r2', 'FIRST NAME': 'Binod', 'LAST NAME': 'Demo', 'APPLICATION STATUS': 'Inquiry' },
] }] };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-data-'));
  fs.writeFileSync(path.join(dir, 'cards.json'), JSON.stringify({ cards: {
    r1: { profile: { passport: 'made-up' }, notes: [{ id: 'n1', text: 'Called' }], tasks: [
      { id: 't1', team: 'application', text: 'Apply to UWL', tag: 'apply', by: 'admin', at: '2026-11-01T10:00:00Z', done: false, comments: [{ id: 'c1', by: 'x', at: '2026-11-02T10:00:00Z', text: 'ok' }] },
      { id: 't2', team: 'visa', text: 'Book CAS', by: 'admin', at: '2026-11-05T10:00:00Z', done: true },
    ] },
    r2: { tasks: [{ id: 't3', team: 'application', text: 'Ask for documents', by: 'admin', at: '2026-11-03T10:00:00Z', done: false }] },
  } }));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: [{ id: 'u1', username: 'demo', name: 'Demo Person', role: 'admin', hash: 'scrypt$aa$bb', passwordHash: 'scrypt$cc$dd' }] }));
  fs.writeFileSync(path.join(dir, 'user-mail.json'), JSON.stringify({ boxes: { u1: { from: 'demo@example.com', pass: { iv: 'a', data: 'b' }, host: 'mail.example.com' } } }));
  fs.writeFileSync(path.join(dir, 'direct-universities.json'), JSON.stringify({ universities: [{ id: 'd1', name: 'Example University', applyUser: 'me', applyPassword: 'secret-pw' }] }));
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify({ sessions: { abc: { user: 'u1' } } }));
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), '{"time":"2026-11-01","action":"first"}\n{"time":"2026-11-02","action":"second"}\n');
  return createAdvisorMcp({ token: TOKEN, memoryDir: path.join(dir, 'mem'), dataDir: dir, getWorkbook: () => workbook, getDashboard: () => ({}),
    facts: createFacts(fs.mkdtempSync(path.join(os.tmpdir(), 'niec-f-'))), log: () => {} });
}
const call = (m, name, args = {}) => {
  const r = m.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  return r.isError ? { isError: true, text: r.content[0].text } : JSON.parse(r.content[0].text);
};

test('the portal tools are offered', () => {
  const tools = setup().rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map((t) => t.name);
  ['get_portal_areas', 'get_portal_data', 'get_tasks', 'get_student_file'].forEach((n) => assert.ok(tools.includes(n), n));
});

test('tasks come with the student, newest first, and filter by team and done', () => {
  const m = setup();
  const all = call(m, 'get_tasks');
  assert.deepStrictEqual(all.records.map((t) => t.id), ['t2', 't3', 't1']);
  assert.strictEqual(all.records[2].student, 'Asha Demo');
  assert.strictEqual(all.records[2].comments.length, 1);
  assert.strictEqual(all.records[2].tag, 'apply');
  const open = call(m, 'get_tasks', { team: 'application', done: false, order: 'oldest' });
  assert.deepStrictEqual(open.records.map((t) => t.id), ['t1', 't3']);
  assert.deepStrictEqual(call(m, 'get_tasks', { student: 'binod' }).records.map((t) => t.id), ['t3']);
});

test('one student file has the row and the whole card', () => {
  const f = call(setup(), 'get_student_file', { id: 'r1' });
  assert.strictEqual(f.row['FIRST NAME'], 'Asha');
  assert.strictEqual(f.card.notes[0].text, 'Called');
  assert.strictEqual(f.card.profile.passport, 'made-up');
  assert.ok(call(setup(), 'get_student_file', { id: 'nope' }).isError);
});

test('passwords, hashes, mailbox passwords and sessions are never shown', () => {
  const m = setup();
  const text = JSON.stringify([call(m, 'get_portal_data', { area: 'users' }), call(m, 'get_portal_data', { area: 'user-mail' }), call(m, 'get_portal_data', { area: 'partner-universities' }), call(m, 'get_portal_areas')]);
  assert.ok(!/scrypt|secret-pw|"iv"|abc/.test(text), text);
  assert.ok(text.includes('Demo Person') && text.includes('Example University') && text.includes('mail.example.com'));
  assert.ok(call(m, 'get_portal_data', { area: 'sessions' }).isError);
});

test('the activity record comes newest first, and areas count their records', () => {
  const m = setup();
  assert.deepStrictEqual(call(m, 'get_portal_data', { area: 'activity' }).records.map((x) => x.action), ['second', 'first']);
  const areas = call(m, 'get_portal_areas').areas;
  assert.strictEqual(areas.find((a) => a.area === 'student-cards').records, 2);
  assert.strictEqual(areas.find((a) => a.area === 'planning').note, 'nothing saved yet');
});
