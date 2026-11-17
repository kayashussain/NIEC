// The rest of the portal for the Claude connector (advisor-mcp.js): everything the portal stores besides the sheet, the Fact
// File and the Incentive page. The owner asked (17 Nov 2026) for the connector to see every piece of data in the portal.
//
// READ ONLY. It reads the stored files in the data folder as they are now (live) and never writes to any of them.
// Secrets are never shown: passwords, password hashes, keys, tokens, login sessions, phone push keys and setup codes are
// left out (the files that hold only secrets are not offered at all, and any field whose name looks secret is hidden).

const fs = require('fs');
const path = require('path');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// Each area: the file in the data folder, what it holds, and how to turn it into a list of records.
const AREAS = {
  'student-cards': { file: 'cards.json', about: 'Each student\'s card: profile, notes, course options, messages, tasks (with comments and history), checks. Keyed by the student\'s row id (_id in get_students).', list: (d) => Object.entries((d && d.cards) || {}).map(([rowId, card]) => ({ rowId, ...card })) },
  'task-seen': { file: 'task-seen.json', about: 'When each person last read each task: { username: { taskId: time } }.', list: (d) => Object.entries(d || {}).map(([user, seen]) => ({ user, seen })) },
  'partner-universities': { file: 'direct-universities.json', about: 'Partner Universities page: each university partnership (direct or through a B2B partner), its agreement, contacts and commission terms.' },
  'b2b-partners': { file: 'b2b-partners.json', about: 'B2B Partners page: each partner, its status, agreement and contacts.' },
  agents: { file: 'agents.json', about: 'Agents page: each sub-agent, its status, agreement and contacts.' },
  planning: { file: 'planning.json', about: 'Planning: targets, channels, costs and settings.' },
  users: { file: 'users.json', about: 'The portal\'s people: name, username, role, teams and whether disabled (never passwords).' },
  'user-mail': { file: 'user-mail.json', about: 'Each person\'s own mailbox settings for emailing students (never the password).' },
  'office-mail': { file: 'mail.json', about: 'The office mailbox settings (never the password).' },
  'message-templates': { file: 'message-templates.json', about: 'Email and WhatsApp templates, and the consultancy name and signature settings.' },
  'source-options': { file: 'source-options.json', about: 'The choices offered for Student Source and similar lists.' },
  'course-links': { file: 'course-links.json', about: 'Links typed for single courses.' },
  'course-watch': { file: 'course-watch.json', about: 'Courses being watched for changes, and what was found.' },
  'course-sitemaps': { file: 'course-sitemaps.json', about: 'The universities\' course lists read from their websites.' },
  'navitas-toolkit': { file: 'navitas-toolkit.json', about: 'The last reading of the Navitas toolkit sheet.' },
  'exchange-rates': { file: 'exchange-rates.json', about: 'Saved exchange rates.' },
  activity: { file: 'activity.jsonl', lines: true, about: 'The activity record: who did what, when, from which device (newest first).' },
  'message-log': { file: 'message-log.jsonl', lines: true, about: 'Every email and WhatsApp message sent to students (newest first).' },
};

// A field whose name says it is a secret is hidden wherever it appears.
const SECRET_KEY = /^pass$|password|passwd|secret|token|hash|salt|api_?key|private_?key|^keys?$|session|cookie|setup_?code|reset_?code|^otp|totp|^pin$|^auth|^iv$|cipher|encrypted|sealed|applyPassword/i;
const HIDDEN = '[hidden]';

function redact(value, depth = 0) {
  if (depth > 40) return HIDDEN;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => { out[k] = SECRET_KEY.test(k) ? (v === '' || v === null || v === undefined ? v : HIDDEN) : redact(v, depth + 1); });
    return out;
  }
  if (typeof value === 'string' && /^scrypt\$/.test(value)) return HIDDEN;
  return value;
}

// The stored list inside a file: an array as it is, or the first array found in the object (partners, agents and so on), or
// the object itself as a single record.
function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const arr = Object.values(data).find((v) => Array.isArray(v));
    if (arr) return arr;
    return [data];
  }
  return [];
}

function createPortalData({ dir, getWorkbook = () => null }) {
  function read(area) {
    const a = AREAS[area];
    if (!a || !dir) return { exists: false, records: [] };
    const file = path.join(dir, a.file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { exists: false, records: [] }; }
    if (a.lines) {
      const records = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
      return { exists: true, records };
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { return { exists: true, error: 'The file could not be read (it may be damaged).', records: [] }; }
    return { exists: true, records: a.list ? a.list(data) : asList(data) };
  }

  // Each student's name and tab, from the sheet, so tasks and cards say who they are about.
  function studentIndex() {
    const out = new Map();
    const w = getWorkbook();
    ((w && w.sheets) || []).forEach((s) => (s.rows || []).forEach((r) => {
      const name = ['FIRST NAME', 'MIDDLE NAME', 'LAST NAME', 'SURNAME'].map((c) => String(r[c] || '').trim()).filter(Boolean).join(' ')
        || String(r['STUDENT NAME'] || r.NAME || '').trim();
      out.set(r._id, { student: name, sheet: s.id, sheetName: s.name, status: r['APPLICATION STATUS'] || '' });
    }));
    return out;
  }

  const textMatch = (q) => { const want = String(q || '').trim().toLowerCase(); return (x) => !want || JSON.stringify(x).toLowerCase().includes(want); };
  const page = (rows, a) => {
    const limit = Math.min(Math.max(Number.isInteger(a.limit) ? a.limit : DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number.isInteger(a.offset) ? a.offset : 0, 0);
    return { matched: rows.length, offset, returned: Math.min(limit, Math.max(rows.length - offset, 0)), records: rows.slice(offset, offset + limit) };
  };

  const TOOLS = [
    {
      name: 'get_portal_areas',
      description: 'Lists every other area of the portal the connector can read (student cards with tasks, notes and messages; partner universities; B2B partners; agents; planning; users; mail settings; templates; course links and watch; Route2Uni and Navitas readings; exchange rates; the activity record; the message log), with how many records each holds. Read them with get_portal_data. Passwords and keys are never shown.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'get_portal_data',
      description: 'Reads one area from get_portal_areas, live. "q" keeps only records containing that text anywhere (case-insensitive). Returns at most "limit" records (default 100, max 1000); use "offset" to page. Activity and the message log come newest first.',
      inputSchema: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: Object.keys(AREAS) },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['area'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_tasks',
      description: 'Every task given to a team about a student, with the student\'s name, tab and status, who gave it, when, its tag, whether it is done (and by whom), when it is due (doOn) and all its comments and history. Filter with "team" (team id), "done" (true or false), "student" (row id or part of the name), "q" (any text). Newest first unless "order" is "oldest". Paged like get_portal_data.',
      inputSchema: {
        type: 'object',
        properties: {
          team: { type: 'string' }, done: { type: 'boolean' }, student: { type: 'string' }, q: { type: 'string', maxLength: 200 },
          order: { type: 'string', enum: ['newest', 'oldest'] },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, offset: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'get_student_file',
      description: 'Everything about one student in one go: their row on the sheet (every column) and their whole card (profile, notes, course options, messages, tasks with comments). Pass the row id ("_id" from get_students).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    },
  ];
  const NAMES = new Set(TOOLS.map((t) => t.name));

  function callTool(name, a) {
    const pulledAt = new Date().toISOString();
    if (name === 'get_portal_areas') {
      return { pulledAt, areas: Object.entries(AREAS).map(([id, x]) => { const r = read(id); return { area: id, about: x.about, records: r.records.length, ...(r.exists ? {} : { note: 'nothing saved yet' }), ...(r.error ? { error: r.error } : {}) }; }) };
    }
    if (name === 'get_portal_data') {
      if (!AREAS[a.area]) return { error: `No area "${a.area}". Areas: ${Object.keys(AREAS).join(', ')}.` };
      const r = read(a.area);
      if (r.error) return { error: r.error };
      return { pulledAt, area: a.area, ...page(redact(r.records).filter(textMatch(a.q)), a) };
    }
    if (name === 'get_tasks') {
      const who = studentIndex();
      const wantStudent = String(a.student || '').trim().toLowerCase();
      let rows = [];
      read('student-cards').records.forEach((card) => (card.tasks || []).forEach((t) => {
        const s = who.get(card.rowId) || { student: '', sheet: '', sheetName: '', status: '' };
        rows.push({ rowId: card.rowId, ...s, ...t });
      }));
      rows = redact(rows).filter((t) => (a.team === undefined || t.team === a.team)
        && (a.done === undefined || Boolean(t.done) === a.done)
        && (!wantStudent || t.rowId === a.student || String(t.student).toLowerCase().includes(wantStudent)))
        .filter(textMatch(a.q));
      rows.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')) * (a.order === 'oldest' ? 1 : -1));
      return { pulledAt, ...page(rows, a) };
    }
    if (name === 'get_student_file') {
      const id = String(a.id || '');
      const w = getWorkbook();
      let row = null;
      let sheet = null;
      ((w && w.sheets) || []).forEach((s) => (s.rows || []).forEach((r) => { if (r._id === id) { row = r; sheet = s; } }));
      const card = read('student-cards').records.find((c) => c.rowId === id) || null;
      if (!row && !card) return { error: 'No student with that row id. Use get_students to find the "_id".' };
      return { pulledAt, rowId: id, sheet: sheet ? { id: sheet.id, name: sheet.name } : null, row: row ? Object.fromEntries(Object.entries(row).filter(([k]) => k === '_id' || !k.startsWith('_'))) : null, card: card ? redact(card) : null };
    }
    return { error: `Unknown tool "${name}".` };
  }

  return { TOOLS, isPortalTool: (n) => NAMES.has(n), callTool };
}

module.exports = { createPortalData, redact, AREAS };
