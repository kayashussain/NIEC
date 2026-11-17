// The Claude connector's one email tool (send_followup_email): only there when the server names a sender (NIEC_ADVISOR_SEND_AS),
// shows a sample and sends nothing without confirm: true, and never more than 150 students a call.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createAdvisorMcp } = require('../student-details/advisor-mcp');
const { createFacts } = require('../student-details/facts');

const calls = [];
const fakeSend = async (args) => {
  calls.push(args);
  const items = args.ids.map((id) => ({ id, name: `Student ${id}`, to: `${id}@example.com`, subject: args.subject, text: `Dear ${id},\n\n${args.emailBody}`, problem: id === 'x' ? 'No email address.' : '' }));
  if (args.preview) return { items, sendOut: [], mail: { ready: true, from: 'sender@example.com' }, sender: 'Made-up Sender' };
  return { items: [], sendOut: args.ids.map((id) => ({ id, name: `Student ${id}`, status: id === 'x' ? 'skipped' : 'sent' })), sender: 'Made-up Sender' };
};
const make = (sendFollowUp) => createAdvisorMcp({
  token: 's'.repeat(40), memoryDir: fs.mkdtempSync(path.join(os.tmpdir(), 'niec-smem-')), log: () => {},
  getWorkbook: () => ({ revision: 1, sheets: [] }), getDashboard: () => ({}), facts: createFacts(fs.mkdtempSync(path.join(os.tmpdir(), 'niec-sfacts-'))),
  sendFollowUp,
});
const call = async (m, args) => (await m.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_followup_email', arguments: args } })).result;
const names = (m) => m.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map((t) => t.name);

test('the email tool is only there when a sender is set', () => {
  assert.ok(!names(make(null)).includes('send_followup_email'));
  assert.ok(names(make(fakeSend)).includes('send_followup_email'));
});

test('without confirm nothing is sent: a sample and the skipped students come back', async () => {
  calls.length = 0;
  const out = JSON.parse((await call(make(fakeSend), { ids: ['a', 'x'], subject: 'Hi', body: 'Hello' })).content[0].text);
  assert.strictEqual(calls[0].preview, true);
  assert.strictEqual(out.sent, 0);
  assert.strictEqual(out.ready, 1);
  assert.deepStrictEqual(out.skipped.map((s) => s.id), ['x']);
  assert.match(out.sample.text, /Hello/);
});

test('confirm: true sends, and more than 150 students is refused', async () => {
  calls.length = 0;
  const out = JSON.parse((await call(make(fakeSend), { ids: ['a', 'b', 'x'], subject: 'Hi', body: 'Hello', confirm: true })).content[0].text);
  assert.strictEqual(calls[0].preview, false);
  assert.strictEqual(out.sent, 2);
  assert.strictEqual(out.skipped, 1);
  const many = await call(make(fakeSend), { ids: Array.from({ length: 151 }, (_, i) => `s${i}`), subject: 'Hi', body: 'Hello', confirm: true });
  assert.strictEqual(many.isError, true);
});
