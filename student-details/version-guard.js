// Protects the live data when new code goes live (the owner, 27 Nov 2026: no data may be lost on an upload).
//
//   1. Before a new version changes anything, every data file is copied to version-backups/ in the data folder. If the copy
//      cannot be made, the server does not start, so nothing is changed without a copy to go back to.
//   2. After the start, the data is compared with that copy and anything that disappeared or was emptied is listed by name
//      (never the values themselves).
//   3. A server that was serving one data folder refuses to start on another, empty one (a lost or mistyped data folder
//      setting would otherwise show an empty portal that people then type into).
//
// It only ever reads the data and writes its own files; it never restores or removes any data.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');

const FOLDER = 'version-backups';
const STAMP = 'version-stamp.json';
const KEEP = 10;
const COPY_ID = /^\d{4}-\d{2}-\d{2}T\d{6}-\d{3}Z-[0-9a-f]{8}$/;
// Besides every .json and .jsonl file: the keys without which logins and saved mail passwords stop working.
const EXTRA_FILES = ['session-secret', 'mail-key', 'first-admin-code.txt'];
const INCENTIVE_FILES = ['commissions.json', 'advances.json', 'exchange-rate-cache.json'];

// The files holding people's own work, compared after a new version starts.
const WATCHED = [
  ['data.json', 'Students'], ['cards.json', 'Student cards and tasks'], ['users.json', 'Accounts'],
  ['fact-file.json', 'Universities'], ['direct-universities.json', 'Partner Universities'], ['b2b-partners.json', 'B2B partners'],
  ['agents.json', 'Agents'], ['planning.json', 'Dashboard records and events'], ['mock-bookings.json', 'Mock bookings'],
  ['mock-guidelines.json', 'Interview guidelines'], ['apply-through.json', 'Apply through'],
  ['message-templates.json', 'Message templates'], ['source-options.json', 'Source choices'], ['course-links.json', 'Course links'],
  ['counselor-incentive/commissions.json', 'Incentive commissions'], ['counselor-incentive/advances.json', 'Incentive advances'],
];
// Bookkeeping that changes by itself: not a person's work.
const SKIP_KEYS = new Set(['revision', 'updatedAt', 'updatedBy', 'activeSheetId']);

// One short text for "which code is this": every code file the upload carries (never the data, which may sit beside the code).
function codeFingerprint(appRoot) {
  const hash = crypto.createHash('sha256');
  for (const folder of ['student-details', 'shared', 'counselor-incentive']) {
    let names = [];
    try { names = fs.readdirSync(path.join(appRoot, folder)).sort(); } catch (e) { continue; }
    for (const name of names) {
      if (!/\.(js|html|css)$|^(fact-seed-[\w-]+|apply-through-seed|package)\.json$/.test(name)) continue;
      hash.update(`${folder}/${name}\0`).update(fs.readFileSync(path.join(appRoot, folder, name))).update('\0');
    }
  }
  return hash.digest('hex');
}

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

function filesToCopy(dataDir, incentiveDir) {
  let names = [];
  try { names = fs.readdirSync(dataDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const out = names.filter((n) => (/\.jsonl?$/.test(n) || EXTRA_FILES.includes(n)) && n !== STAMP && n !== 'package.json' && !/^fact-seed-|^apply-through-seed/.test(n))
    .map((n) => ({ from: path.join(dataDir, n), to: n }));
  if (incentiveDir) INCENTIVE_FILES.forEach((n) => out.push({ from: path.join(incentiveDir, n), to: `counselor-incentive/${n}` }));
  return out.filter((f) => isFile(f.from));
}

const readStamp = (dataDir) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, STAMP), 'utf8')); } catch (e) { return null; } };

// Copies the data when the code differs from the code that last started on this data. Returns null when it is the same
// code, else { folder } (null folder: there was no data yet). Throws when a copy could not be made.
function copyBeforeNewVersion({ dataDir, incentiveDir, fingerprint, now = () => new Date() }) {
  const stamp = readStamp(dataDir);
  if (stamp && stamp.fingerprint === fingerprint) return null;
  const files = filesToCopy(dataDir, incentiveDir);
  const at = now().toISOString();
  let folder = null;
  if (files.length) {
    const root = path.join(dataDir, FOLDER);
    const id = `${at.replace(/:/g, '').replace('.', '-')}-${fingerprint.slice(0, 8)}`;
    const partial = path.join(root, `.partial-${id}`);
    fs.mkdirSync(path.join(partial, 'counselor-incentive'), { recursive: true, mode: 0o700 });
    for (const f of files) writeFileAtomic(path.join(partial, f.to), fs.readFileSync(f.from));
    folder = path.join(root, id);
    fs.renameSync(partial, folder); // a copy is either whole or not there
    prune(root, id);
  }
  writeFileAtomic(path.join(dataDir, STAMP), JSON.stringify({ fingerprint, at, copy: folder ? path.basename(folder) : '' }));
  return { folder };
}

function prune(root, justMade) {
  try {
    fs.readdirSync(root).filter((n) => COPY_ID.test(n) && n !== justMade).sort().reverse().slice(KEEP - 1)
      .forEach((n) => fs.rmSync(path.join(root, n), { recursive: true, force: true }));
  } catch (e) { console.error('[version copy] old copies not tidied:', e.message); }
}

// ---- what disappeared ----

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Object.keys(v).length);
const idOf = (v) => (v && typeof v === 'object' ? String(v._id || v.id || '') : '');
const nameOf = (v, names) => {
  const full = [v['FIRST NAME'], v['LAST NAME']].filter(Boolean).join(' ').trim();
  return full || String(v.name || v.title || v.username || names.get(idOf(v)) || idOf(v) || 'an entry').slice(0, 80);
};

function walk(before, after, at, out, names) {
  if (empty(before)) return;
  if (empty(after) || typeof before !== typeof after || Array.isArray(before) !== Array.isArray(after)) {
    // false and 0 are answers, not blanks; only something now blank, gone or of another shape counts.
    out.emptied.push(at.join(' › ') || 'everything');
    return;
  }
  if (typeof before !== 'object') return; // changed to another value: ordinary work
  if (Array.isArray(before)) {
    if (before.every(idOf)) {
      const have = new Map(after.map((v) => [idOf(v), v]));
      before.forEach((v) => {
        const now = have.get(idOf(v));
        if (!now) out.removed.push([...at, nameOf(v, names)].join(' › '));
        else walk(v, now, [...at, nameOf(v, names)], out, names);
      });
    } else if (after.length < before.length) {
      out.emptied.push(`${at.join(' › ')} (${before.length - after.length} fewer)`);
    } else {
      before.forEach((v, i) => walk(v, after[i], at, out, names));
    }
    return;
  }
  Object.keys(before).forEach((k) => {
    if (SKIP_KEYS.has(k)) return;
    walk(before[k], Object.prototype.hasOwnProperty.call(after, k) ? after[k] : undefined, [...at, names.get(k) || k], out, names);
  });
}

// The students as one list, so a student moved to another intake is not reported as gone.
const shaped = (name, data) => (name === 'data.json' && data && Array.isArray(data.sheets)
  ? { intakes: data.sheets.map((s) => ({ id: s.id, name: s.name })), students: data.sheets.flatMap((s) => s.rows || []) } : data);

const readJson = (file) => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { missing: e.code === 'ENOENT', bad: e.code !== 'ENOENT' }; }
  try { return { value: JSON.parse(text) }; } catch (e) { return { bad: true }; }
};

const list = (items) => `${items.slice(0, 10).join('; ')}${items.length > 10 ? `; and ${items.length - 10} more` : ''}`;

// One line for each file where something that was in the copy is gone or blank now.
function compareWithCopy(folder, dataDir, incentiveDir) {
  const nowFile = (n) => (n.startsWith('counselor-incentive/') ? (incentiveDir ? path.join(incentiveDir, path.basename(n)) : null) : path.join(dataDir, n));
  // Student cards are filed under the student's row id: show the student's name instead.
  const names = new Map();
  const students = readJson(path.join(folder, 'data.json')).value;
  ((students && students.sheets) || []).forEach((s) => (s.rows || []).forEach((r) => { if (r && r._id) names.set(r._id, nameOf(r, new Map())); }));
  const lines = [];
  for (const [file, label] of WATCHED) {
    const before = readJson(path.join(folder, file));
    if (before.missing) continue;
    if (before.bad) { lines.push(`${label}: the file could not be read before this version started`); continue; }
    const live = nowFile(file);
    if (!live) continue;
    const after = readJson(live);
    if (after.missing) { lines.push(`${label}: the file is gone`); continue; }
    if (after.bad) { lines.push(`${label}: the file cannot be read now`); continue; }
    const out = { removed: [], emptied: [] };
    walk(shaped(file, before.value), shaped(file, after.value), [], out, names);
    if (out.removed.length) lines.push(`${label}: ${out.removed.length} removed (${list(out.removed)})`);
    if (out.emptied.length) lines.push(`${label}: ${out.emptied.length} emptied or missing (${list(out.emptied)})`);
  }
  return lines;
}

// ---- the right data folder ----

const hasStudentsFile = (dir) => isFile(path.join(dir, 'data.json')) || isFile(path.join(dir, 'data.backup.json'));

// The full real name of a folder, also of one not made yet. One folder can go by several names (Windows gives the
// temporary folder in a short form, KAYAS_~1), so folders are compared by their real names only.
function realName(folder) {
  const full = path.resolve(folder);
  try { return fs.realpathSync.native(full); } catch (e) {
    const parent = path.dirname(full);
    return parent === full ? full : path.join(realName(parent), path.basename(full));
  }
}

const inside = (dir, folder) => realName(dir) === realName(folder) || realName(dir).startsWith(realName(folder) + path.sep);

// An error text when this start is on an empty data folder while the folder used before still holds the students.
function wrongDataFolder({ dataDir, markerFile, tmp = os.tmpdir() }) {
  if (inside(dataDir, tmp)) return ''; // a throwaway folder (a test) is never the live setting gone wrong
  let before = '';
  try { before = fs.readFileSync(markerFile, 'utf8').trim(); } catch (e) { return ''; }
  if (!before || realName(before) === realName(dataDir) || hasStudentsFile(dataDir) || !hasStudentsFile(before)) return '';
  return `The data folder in use before (${before}) holds the students, but this start points to ${path.resolve(dataDir)}, which has none. `
    + `Set STUDENT_DETAILS_DATA_DIR back to the folder in use before. Only if the data was moved on purpose, delete ${markerFile} and start again.`;
}

// Remembers, beside the code, the data folder that holds this installation's students. Only a folder outside the app's own
// folder (as on the live server): not local demo data kept inside it, nor a throwaway one in the system's temporary folder.
function rememberDataFolder({ dataDir, markerFile, tmp = os.tmpdir() }) {
  const dir = path.resolve(dataDir);
  if (inside(dir, path.dirname(path.dirname(markerFile))) || inside(dir, tmp) || !hasStudentsFile(dir)) return false;
  try { writeFileAtomic(markerFile, dir); return true; } catch (e) { console.error('[data folder] not remembered:', e.message); return false; }
}

module.exports = { codeFingerprint, copyBeforeNewVersion, compareWithCopy, wrongDataFolder, rememberDataFolder, FOLDER, KEEP };
