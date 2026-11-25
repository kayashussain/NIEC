// A door for the Claude "Strategy Advisor" project (an MCP connector).
//
// It lets Claude READ the live Student Recruit 360 sheet (every tab, row and column), the Dashboard numbers,
// Universities, the Incentive page (commissions, incentives, company earnings; see
// counselor-incentive/advisor-tools.js) and the rest of the portal (student cards with tasks, notes and messages, partners,
// agents, planning, users, settings, the activity record; see advisor-data.js, never passwords, tokens or keys).
// It can NOT change any student, task, Universities or any incentive.
//
// One thing more, only when NIEC_ADVISOR_SEND_AS is set (the username of a portal account): send_followup_email sends one email to
// chosen students exactly as the Follow-up page does, from that person's own mailbox with their signature, each email logged on the
// student's card and in Activity. At most 150 students a call; without confirm: true it only shows how the emails will look.
//
// The one thing it can write is the Advisor's own notebook ("memory"): short notes about the owner's
// preferences, how NIEC works, decisions and lessons, kept in advisor-memory/ next to the data. Notes that
// look like personal data (emails, phone numbers) are refused, every save keeps a backup, and the notebook
// has size limits. It never touches the student data.
//
// It is OFF unless NIEC_ADVISOR_TOKEN is set (a long random secret, at least 32 characters). The secret is
// part of the address: https://<your-site>/advisor-mcp/<NIEC_ADVISOR_TOKEN>. Anyone with that address can
// read all students, so keep it private; to cut access off, change or remove the variable and restart.

const { createMcpEndpoint, textResult, errorResult } = require('../shared/mcp-core');
const { createIncentiveTools } = require('../counselor-incentive/advisor-tools');
const { syncFromWorkbook } = require('../counselor-incentive/incentive-data');
const { createPortalData } = require('./advisor-data');

const PREFIX = '/advisor-mcp/';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const TOOLS = [
  {
    name: 'get_overview',
    description: 'Start here. Lists every tab (intake) of the Student Recruit 360 sheet with its id, name, whether it is hidden (an earlier intake), the number of students and the exact column names, plus the sheet revision and the time of this read. Use the tab ids and column names in the other tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_students',
    description: 'Reads student rows live from the sheet. Filter with "where": an object of column name to text; a row matches when every given column contains that text (case-insensitive). Use "columns" to return only some columns (the row id is always included). Returns at most "limit" rows (default 200, max 1000); use "offset" to page. Say which tab with "sheet" (an id or name from get_overview); leave it out to read every tab.',
    inputSchema: {
      type: 'object',
      properties: {
        sheet: { type: 'string', description: 'Tab id or name. Omit for all tabs.' },
        where: { type: 'object', additionalProperties: { type: 'string' }, description: 'Column name -> text the cell must contain. Use "=" prefix for an exact match (e.g. "=Inquiry"), and "=" alone to find empty cells.' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Only return these columns.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'count_by',
    description: 'Counts students grouped by one or more columns (for example APPLICATION STATUS, UNIVERSITY NAME, STUDENT SOURCE), optionally filtered with "where" as in get_students. Empty cells are counted as "(empty)". Best for funnels and comparisons; far cheaper than reading rows.',
    inputSchema: {
      type: 'object',
      properties: {
        group_by: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
        sheet: { type: 'string' },
        where: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['group_by'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_dashboard',
    description: 'The same numbers the Dashboard page shows (pipeline, visas, fees and so on) for one intake. Pass the tab id from get_overview; omit it for the Dashboard\'s default view.',
    inputSchema: { type: 'object', properties: { intake: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'get_fact_file',
    description: 'Universities: one page per university (fees, entry requirements, English tests, courses, intakes, application process). Without arguments, lists the universities. With "id" returns one full page. With "q" searches by course or text.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, q: { type: 'string' } }, additionalProperties: false },
  }
];

function pickSheets(workbook, ref) {
  const sheets = workbook.sheets || [];
  if (ref === undefined || ref === null || ref === '') return { sheets };
  const want = String(ref).trim().toLowerCase();
  const hit = sheets.filter((s) => String(s.id).toLowerCase() === want || String(s.name).toLowerCase() === want);
  if (!hit.length) return { error: `No tab "${ref}". Tabs: ${sheets.map((s) => `${s.id} (${s.name})`).join(', ')}.` };
  return { sheets: hit };
}

function matcher(where) {
  const entries = Object.entries(where && typeof where === 'object' ? where : {});
  return (row) => entries.every(([col, needle]) => {
    const cell = String(row[col] === undefined || row[col] === null ? '' : row[col]).trim().toLowerCase();
    const want = String(needle).trim().toLowerCase();
    if (want === '=') return cell === '';
    if (want.startsWith('=')) return cell === want.slice(1).trim();
    return cell.includes(want);
  });
}

function unknownColumns(sheets, cols) {
  const known = new Set();
  sheets.forEach((s) => (s.columns || []).forEach((c) => known.add(c)));
  return [...new Set(cols)].filter((c) => !known.has(c));
}

// `incentive` (optional) adds the Incentive tools to this same connector: { getCommissions, getAdvances, getRate }, which read the
// Incentive page's saved figures; the students come from the same workbook as the rest.
// `dataDir` (optional) adds the rest of the portal (advisor-data.js), read from the stored files in that folder.
const SEND_TOOL = {
  name: 'send_followup_email',
  description: 'Emails students, exactly as the Follow-up page does: from the sender\'s own mailbox, ending with their signature picture, each email logged on the student\'s card. Give the students by their row ids ("_id" from get_students), at most 150 a call. The body is plain text: a line starting with "## " is a heading, "- " a bullet, a web address becomes a link; for a marketing email, a first line "# Title | small line" is a coloured banner across the top, "!! words" a highlighted box, and "[[Label | https://wa.me/977...]]" a big button (green for WhatsApp, blue otherwise; tel: for a call button; several on one line sit side by side); {first_name} and the other Follow-up words are filled in. Without confirm: true nothing is sent: you get how many are ready, who would be skipped and why, and one sample email. Always show the person the sample first and send (confirm: true) only after they say yes.',
  inputSchema: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, maxItems: 150, description: 'Student row ids (_id), at most 150.' },
      subject: { type: 'string' },
      body: { type: 'string' },
      confirm: { type: 'boolean', description: 'true sends the emails. Leave out to see the sample only.' },
    },
    required: ['ids', 'subject', 'body'],
    additionalProperties: false,
  },
};

function createAdvisorMcp({ getWorkbook, getDashboard, facts, incentive, dataDir, token, memoryDir, sendFollowUp = null, log = console.log }) {
  const portalData = dataDir ? createPortalData({ dir: dataDir, getWorkbook }) : null;
  const incentiveTools = incentive ? createIncentiveTools({
    getSync: () => { const w = getWorkbook(); return w ? syncFromWorkbook(w) : { ok: false, error: 'The sheet data could not be read right now.' }; },
    getCommissions: incentive.getCommissions,
    getAdvances: () => { const w = getWorkbook(); return incentive.getAdvances((w && w.sheets) || []); },
    getRate: incentive.getRate,
  }) : null;

  async function sendEmails(a) {
    const ids = Array.isArray(a.ids) ? [...new Set(a.ids.map(String))] : [];
    if (!ids.length) return errorResult('Give at least one student row id (_id from get_students).');
    if (ids.length > 150) return errorResult('At most 150 students a call: send the rest in a second call.');
    const subject = typeof a.subject === 'string' ? a.subject : '';
    const body = typeof a.body === 'string' ? a.body : '';
    if (!subject.trim() || !body.trim()) return errorResult('Write a subject and a message.');
    const preview = a.confirm !== true;
    // At most 300 students emailed through this door in a day, however many calls it takes.
    const dayAgo = Date.now() - 86400000;
    while (sentLog.length && sentLog[0].at < dayAgo) sentLog.shift();
    if (!preview && sentLog.reduce((n, x) => n + x.n, 0) + ids.length > 300) return errorResult('The limit of 300 students a day through this connector is reached. Nothing was sent.');
    const entry = { at: Date.now(), n: preview ? 0 : ids.length }; // reserved before the send, so two calls at once cannot both pass
    if (!preview) sentLog.push(entry);
    let out;
    try { out = await sendFollowUp({ ids, subject, emailBody: body, preview }); } catch (e) { entry.n = 0; throw e; }
    if (out.error) { entry.n = 0; return errorResult(out.error); }
    if (!preview) entry.n = (out.sendOut || []).filter((r) => r.status === 'sent' || r.status === 'failed').length; // only emails really attempted count
    if (preview) {
      const ready = out.items.filter((i) => !i.error && !i.problem);
      const sample = ready[0];
      return textResult({
        sent: 0, note: 'Nothing was sent. Show the sample to the person; send with confirm: true only after they say yes.',
        sender: out.sender, mailboxReady: Boolean(out.mail && out.mail.ready), from: out.mail ? out.mail.from : '',
        ready: ready.length, skipped: out.items.filter((i) => i.error || i.problem).map((i) => ({ id: i.id, name: i.name || '', reason: i.error || i.problem })),
        sample: sample ? { to: sample.to, subject: sample.subject, text: sample.text, endsWith: 'the sender\'s signature picture' } : null,
      });
    }
    const count = (st) => out.sendOut.filter((r) => r.status === st).length;
    return textResult({ sentAt: new Date().toISOString(), sender: out.sender, sent: count('sent'), failed: count('failed'), notConfigured: count('not-configured'), skipped: count('skipped'), problems: out.sendOut.filter((r) => r.status !== 'sent') });
  }

  const sentLog = []; // how many emails each real send attempted, and when (the daily limit)
  function callTool(name, a) {
    if (name === SEND_TOOL.name && sendFollowUp) return sendEmails(a || {});
    if (incentiveTools && incentiveTools.isIncentiveTool(name)) return incentiveTools.callTool(name, a);
    if (portalData && portalData.isPortalTool(name)) {
      const out = portalData.callTool(name, a || {});
      return out.error ? errorResult(out.error) : textResult(out);
    }
    const workbook = getWorkbook();
    if (!workbook) return errorResult('The sheet data could not be read right now.');

    if (name === 'get_overview') {
      return textResult({
        pulledAt: new Date().toISOString(),
        revision: workbook.revision,
        sheets: (workbook.sheets || []).map((s) => ({ id: s.id, name: s.name, hidden: Boolean(s.hidden), students: (s.rows || []).length, columns: s.columns || [] })),
      });
    }

    if (name === 'get_students' || name === 'count_by') {
      const picked = pickSheets(workbook, a.sheet);
      if (picked.error) return errorResult(picked.error);
      const filterCols = Object.keys(a.where && typeof a.where === 'object' ? a.where : {});
      const wanted = name === 'count_by' ? (Array.isArray(a.group_by) ? a.group_by : []) : (Array.isArray(a.columns) ? a.columns : []);
      const bad = unknownColumns(picked.sheets, [...filterCols, ...wanted]);
      if (bad.length) return errorResult(`Unknown column(s): ${bad.join(', ')}. Call get_overview for the exact names.`);
      const test = matcher(a.where);
      const rows = [];
      picked.sheets.forEach((s) => (s.rows || []).forEach((r) => { if (test(r)) rows.push({ sheet: s.id, row: r }); }));

      if (name === 'count_by') {
        if (!wanted.length) return errorResult('group_by needs at least one column.');
        const counts = new Map();
        rows.forEach(({ row }) => {
          const key = wanted.map((c) => String(row[c] === undefined || row[c] === null || String(row[c]).trim() === '' ? '(empty)' : row[c]).trim());
          const k = JSON.stringify(key);
          counts.set(k, (counts.get(k) || 0) + 1);
        });
        const table = [...counts.entries()].map(([k, n]) => ({ ...Object.fromEntries(wanted.map((c, i) => [c, JSON.parse(k)[i]])), students: n })).sort((x, y) => y.students - x.students);
        return textResult({ pulledAt: new Date().toISOString(), total: rows.length, groups: table });
      }

      const limit = Math.min(Math.max(Number.isInteger(a.limit) ? a.limit : DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(Number.isInteger(a.offset) ? a.offset : 0, 0);
      const page = rows.slice(offset, offset + limit).map(({ sheet, row }) => {
        if (!wanted.length) return { sheet, ...Object.fromEntries(Object.entries(row).filter(([k]) => k === '_id' || !k.startsWith('_'))) }; // the page's own markers stay out
        const out = { sheet, _id: row._id };
        wanted.forEach((c) => { out[c] = row[c] === undefined ? '' : row[c]; });
        return out;
      });
      return textResult({ pulledAt: new Date().toISOString(), matched: rows.length, returned: page.length, offset, students: page });
    }

    if (name === 'get_dashboard') {
      try {
        return textResult(getDashboard(typeof a.intake === 'string' ? a.intake : ''));
      } catch (e) {
        return errorResult('The Dashboard numbers could not be made right now.');
      }
    }

    if (name === 'get_fact_file') {
      if (typeof a.id === 'string' && a.id) {
        const uni = facts.get(a.id);
        return uni ? textResult(uni) : errorResult('No university with that id. Call get_fact_file without arguments for the list.');
      }
      return textResult(facts.list(typeof a.q === 'string' ? a.q.slice(0, 100) : ''));
    }

    return errorResult(`Unknown tool "${name}".`);
  }

  return createMcpEndpoint({
    prefix: PREFIX, token, tokenName: 'NIEC_ADVISOR_TOKEN', tools: [...TOOLS, ...(incentiveTools ? incentiveTools.TOOLS : []), ...(portalData ? portalData.TOOLS : []), ...(sendFollowUp ? [SEND_TOOL] : [])], callTool, serverName: 'niec-advisor', memoryDir, log,
    instructions: (sendFollowUp ? 'Can email students with send_followup_email (show the sample and get a yes before confirm: true). Otherwise read-only: ' : '') + 'Read-only, live access to the Student Recruit 360 sheet and Universities' + (incentiveTools ? ', and to the Incentive page (commissions, incentives and company earnings)' : '') + (portalData ? ', and to the rest of the portal (tasks, student cards, partners, agents, planning, users, settings, activity; get_portal_areas lists them, get_tasks and get_student_file are the quick ways in; passwords, tokens and keys are never shown)' : '') + ', plus a notebook you may write to. Call read_memory first in every conversation, then get_overview' + (incentiveTools ? ' (and get_incentive_overview for anything about incentives, commissions or earnings; University Partner is the agent; tuition and university commission are in GBP, incentives, TDS, advances and salary in NPR)' : '') + '. Save durable preferences and lessons with save_memory (never personal data). Prefer count_by for numbers and get_students with "columns" and "where" for rows' + (incentiveTools ? ', and summarize_incentives_by to compare agents and universities' : '') + '. Always say when the data was pulled (pulledAt).',
  });
}

module.exports = { createAdvisorMcp };
