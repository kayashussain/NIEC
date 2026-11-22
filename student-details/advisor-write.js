// The admin door for Claude (the owner, 22 Nov 2026, widened 23 Nov 2026: "build a door of all access").
//
//   * It is a second, separate door from the read-only one (advisor-mcp.js), with its own secret address:
//       https://<your-site>/advisor-write/<NIEC_ADVISOR_WRITE_TOKEN>
//     It is OFF unless NIEC_ADVISOR_WRITE_TOKEN (32 or more characters) is set AND NIEC_ADVISOR_WRITE_AS names the portal account it acts as.
//     The account decides what is allowed: it can never do more than that account can do in the portal (an Admin account: every student).
//     Remove either setting and restart to switch it off.
//   * Two steps, always: a preview shows the exact before and after and gives a code; apply_student_change makes the change only
//     with that code, once, within 10 minutes (a change of details also only if the student has not changed since the preview).
//   * Three things only (portal-api.js): change any detail of ONE student (card or sheet columns, Student Source), remove ONE task of one
//     card, delete ONE student's row from the sheet (the card stays; the backups hold the row). Never a user, a password, a setting, a token,
//     the Incentive page (it has its own password), or more than one thing at a time. At most 60 changes an hour.
//   * Every change is written on the card and in Activity under the account's name followed by "(Claude)", and the server keeps
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
    description: 'Step 1 of 2. Shows exactly what would change on ONE student, and writes nothing. Give the student id (from get_students) and "changes": an object of detail name to new text. Any detail of the student card or the sheet can be changed (names, email, contact number, university, course, dates, partner, NOC, medical, mock details, Student Source). Returns the before and after and a code. Show the owner the before and after in plain words and wait for a clear yes before step 2.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The student id.' }, changes: { type: 'object', description: 'Detail name to new value, for example {"STUDENT SOURCE": "Visitor"}.' } },
      required: ['id', 'changes'], additionalProperties: false,
    },
  },
  {
    name: 'preview_remove_task',
    description: 'Step 1 of 2. Shows ONE task that would be removed from a student card (also a card whose student is no longer on the sheet), and writes nothing. Give the card id (the rowId from get_tasks) and the task id. Returns the task and a code. Show the owner and wait for a clear yes before step 2.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The card id (the rowId).' }, taskId: { type: 'string', description: 'The task id.' } }, required: ['id', 'taskId'], additionalProperties: false },
  },
  {
    name: 'preview_delete_student',
    description: 'Step 1 of 2. Shows ONE student that would be taken off the sheet (the card with its notes stays, and the server keeps its backups), and writes nothing. Returns the student and a code. Show the owner plainly what would be deleted and wait for a clear yes before step 2.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The student id.' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'apply_student_change',
    description: 'Step 2 of 2 for any of the three previews. Makes the change shown, using its code. Only after the owner has said yes to that exact change. The code works once and for 10 minutes; a change of details is made only if the student has not changed since the preview.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The code from the preview.' } }, required: ['code'], additionalProperties: false },
  },
];

// `change(kind, args)`: the server's function that does the work as the named account (portal.advisorChange, advisorRemoveTask,
// advisorDeleteStudent); without it the door is off. kind is 'change', 'removeTask' or 'deleteStudent'.
function createAdvisorWrite({ token, change, now = () => Date.now(), log = console.log }) {
  const pending = new Map(); // code -> { kind, args, expect, at }
  let applied = []; // times of the changes made in the last hour

  const PREVIEWS = {
    preview_student_change: { kind: 'change', args: (a) => ({ id: a.id, changes: a.changes }) },
    preview_remove_task: { kind: 'removeTask', args: (a) => ({ id: a.id, taskId: a.taskId }) },
    preview_delete_student: { kind: 'deleteStudent', args: (a) => ({ id: a.id }) },
  };

  function callTool(name, args) {
    const a = args && typeof args === 'object' ? args : {};
    const pv = PREVIEWS[name];
    if (pv) {
      const out = change(pv.kind, { ...pv.args(a), apply: false });
      if (out.error) return errorResult(out.error);
      for (const [code, p] of pending) if (now() - p.at > CODE_MINUTES * 60000) pending.delete(code);
      if (pending.size >= MAX_PENDING) return errorResult('Too many previews are waiting. Apply or let them expire first.');
      const code = crypto.randomBytes(4).toString('hex');
      const saved = pv.kind === 'change'
        ? { kind: pv.kind, args: { id: out.id, changes: Object.fromEntries(out.changes.map((c) => [c.column, c.after])) }, expect: out.before }
        : { kind: pv.kind, args: pv.args(a), expect: null };
      pending.set(code, { ...saved, at: now() });
      return textResult({
        ...out, code, expiresInMinutes: CODE_MINUTES,
        next: 'Show the owner this in plain words. Call apply_student_change with the code only after the owner says yes.',
      });
    }
    if (name === 'apply_student_change') {
      const code = typeof a.code === 'string' ? a.code.trim() : '';
      const p = pending.get(code);
      if (!p) return errorResult('That code is not valid. Run the preview again.');
      pending.delete(code); // one use only, whatever happens next
      if (now() - p.at > CODE_MINUTES * 60000) return errorResult('That code has expired. Run the preview again.');
      applied = applied.filter((t) => now() - t < 3600000);
      if (applied.length >= MAX_APPLIES_PER_HOUR) return errorResult(`The limit of ${MAX_APPLIES_PER_HOUR} changes an hour is reached. Try again later.`);
      const out = change(p.kind, { ...p.args, expect: p.expect, apply: true });
      if (out.error) return errorResult(out.error);
      applied.push(now());
      return textResult({ done: true, ...out, note: "Written on the student card and in Activity, after the server's usual backup." });
    }
    return errorResult(`Unknown tool "${name}".`);
  }

  const endpoint = createMcpEndpoint({
    prefix: PREFIX, token: typeof change === 'function' ? token : '', tokenName: 'NIEC_ADVISOR_WRITE_TOKEN', tools: TOOLS, callTool, serverName: 'niec-advisor-write', log,
    instructions: 'Changes ONE thing at a time, in two steps: a preview (a student details change, one task to remove, one student to delete), then apply_student_change with its code only after the owner says yes to that exact change. Never change anything the owner has not agreed to.',
  });
  return { ...endpoint, TOOLS };
}

module.exports = { createAdvisorWrite };
