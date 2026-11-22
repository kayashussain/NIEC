// The write door for Claude (the owner, 22 Nov 2026): lets Claude change a few plain details of ONE student at a time, and nothing else.
//
//   * It is a second, separate door from the read-only one (advisor-mcp.js), with its own secret address:
//       https://<your-site>/advisor-write/<NIEC_ADVISOR_WRITE_TOKEN>
//     It is OFF unless NIEC_ADVISOR_WRITE_TOKEN (32 or more characters) is set AND NIEC_ADVISOR_WRITE_AS names the portal account it acts as.
//     The account decides what is allowed: it can never do more than that account can do on the student card (Admin: any student; a team:
//     only its own students and columns). Use a team account, not Admin, to keep it narrow. Remove either setting and restart to switch it off.
//   * Two steps, always: preview_student_change shows the exact before and after and gives a code; apply_student_change makes the change only
//     with that code, once, within 10 minutes, and only if the student has not changed since the preview.
//   * Only these details can change: FIRST NAME, LAST NAME, STUDENT ID, NOC NUMBER (portal-api.js advisorChange). Never a deletion, a user,
//     a password, a setting, the Incentive page, or more than one student at a time. At most 60 changes an hour.
//   * Every change is written on the student's card and in Activity under the account's name followed by "(Claude)", and the server keeps
//     its usual rolling backup and daily snapshot before each write (writeWorkbook in server.js).

const crypto = require('crypto');
const { createMcpEndpoint, textResult, errorResult } = require('../shared/mcp-core');

const PREFIX = '/advisor-write/';
const CODE_MINUTES = 10;
const MAX_PENDING = 100;
const MAX_APPLIES_PER_HOUR = 60;

const TOOLS = [
  {
    name: 'preview_student_change',
    description: 'Step 1 of 2. Shows exactly what would change on ONE student, and writes nothing. Give the student id (from get_students) and "changes": an object of detail name to new text. Only FIRST NAME, LAST NAME, STUDENT ID and NOC NUMBER can be changed. Returns the before and after and a code. Show the owner the before and after in plain words and wait for a clear yes before step 2.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The student id.' }, changes: { type: 'object', description: 'Detail name to new value, for example {"LAST NAME": "Shrestha"}.' } },
      required: ['id', 'changes'], additionalProperties: false,
    },
  },
  {
    name: 'apply_student_change',
    description: 'Step 2 of 2. Makes the change shown by preview_student_change, using its code. Only after the owner has said yes to that exact change. The code works once and for 10 minutes, and only if the student has not changed since the preview.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The code from preview_student_change.' } }, required: ['code'], additionalProperties: false },
  },
];

// `change(args)`: the server's function that does the work as the named account (portal.advisorChange); without it the door is off.
function createAdvisorWrite({ token, change, now = () => Date.now(), log = console.log }) {
  const pending = new Map(); // code -> { id, changes, expect, at }
  let applied = []; // times of the changes made in the last hour

  function callTool(name, args) {
    const a = args && typeof args === 'object' ? args : {};
    if (name === 'preview_student_change') {
      const out = change({ id: a.id, changes: a.changes, apply: false });
      if (out.error) return errorResult(out.error);
      for (const [code, p] of pending) if (now() - p.at > CODE_MINUTES * 60000) pending.delete(code);
      if (pending.size >= MAX_PENDING) return errorResult('Too many previews are waiting. Apply or let them expire first.');
      const code = crypto.randomBytes(4).toString('hex');
      pending.set(code, { id: out.id, changes: Object.fromEntries(out.changes.map((c) => [c.column, c.after])), expect: out.before, at: now() });
      return textResult({
        student: out.student, changes: out.changes, code, expiresInMinutes: CODE_MINUTES,
        next: 'Show the owner these changes in plain words. Call apply_student_change with the code only after the owner says yes.',
      });
    }
    if (name === 'apply_student_change') {
      const code = typeof a.code === 'string' ? a.code.trim() : '';
      const p = pending.get(code);
      if (!p) return errorResult('That code is not valid. Run preview_student_change again.');
      pending.delete(code); // one use only, whatever happens next
      if (now() - p.at > CODE_MINUTES * 60000) return errorResult('That code has expired. Run preview_student_change again.');
      applied = applied.filter((t) => now() - t < 3600000);
      if (applied.length >= MAX_APPLIES_PER_HOUR) return errorResult(`The limit of ${MAX_APPLIES_PER_HOUR} changes an hour is reached. Try again later.`);
      const out = change({ id: p.id, changes: p.changes, expect: p.expect, apply: true });
      if (out.error) return errorResult(out.error);
      applied.push(now());
      return textResult({ done: true, student: out.student, changed: out.changed, note: 'Written on the student card and in Activity.' });
    }
    return errorResult(`Unknown tool "${name}".`);
  }

  const endpoint = createMcpEndpoint({
    prefix: PREFIX, token: typeof change === 'function' ? token : '', tokenName: 'NIEC_ADVISOR_WRITE_TOKEN', tools: TOOLS, callTool, serverName: 'niec-advisor-write', log,
    instructions: 'Changes ONE student at a time, in two steps: preview_student_change, then apply_student_change only after the owner says yes. Only FIRST NAME, LAST NAME, STUDENT ID and NOC NUMBER. Never change anything the owner has not agreed to.',
  });
  return { ...endpoint, TOOLS };
}

module.exports = { createAdvisorWrite };
