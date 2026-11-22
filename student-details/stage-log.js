// The lines a stage change writes on the student's timeline (the owner, 21 Nov 2026): every move forward along the line of stages
// ("Moved to Mock Stage"), and every move into or out of Defer, Hold, Withdrawn and Visa Rejected, which can happen from any step
// ("Moved to Withdrawn · Why: Chose another consultancy", "Back from Hold to Application Stage"). A move back along the line (Mock
// Stage to Application Stage, after a university refused) is not written. A deferred student moved into the next intake comes back
// at Inquiry, and that is written too.
//
// changes(before, after) compares two workbooks and returns, for each student whose stage changed:
//   { rowId, from, to, fromIntake, toIntake, text, back }  back: a deferred student returned in a new intake
// Pure (no files): server.js writes each line on the card with the person who saved.

const STATUS = 'APPLICATION STATUS';
const LINE = ['Inquiry', 'Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'];
const SIDE = ['Defer', 'Hold', 'Withdrawn', 'Visa Rejected'];

const text = (v) => String(v == null ? '' : v).trim();
// "Jan 2027" becomes "Jan 2027 intake"; a sheet already called "... intake" keeps its name.
const intakeWords = (name) => (/intake/i.test(name) ? name : `${name} intake`);

function index(wb) {
  const map = new Map();
  ((wb && wb.sheets) || []).forEach((sheet) => (sheet.rows || []).forEach((row) => {
    if (row && row._id && !map.has(row._id)) map.set(row._id, { stage: text(row[STATUS]), intake: text(sheet.name) });
  }));
  return map;
}

// What one change says, or '' when nothing is written. `why`: the reason a student was withdrawn, when known.
function lineFor(from, to, fromIntake, toIntake, why = '') {
  if (!from || !to || from === to) return '';
  if (from === 'Defer' && to === 'Inquiry' && fromIntake && toIntake && fromIntake !== toIntake) {
    return `Moved to ${intakeWords(toIntake)}, back at Inquiry (deferred from ${intakeWords(fromIntake)})`;
  }
  if (SIDE.includes(to)) {
    if (to === 'Defer') return `Moved to Defer · Deferred from ${intakeWords(fromIntake || toIntake)}`;
    if (to === 'Withdrawn' && why) return `Moved to Withdrawn · Why: ${why}`;
    return `Moved to ${to}`;
  }
  if (SIDE.includes(from)) return `Back from ${from} to ${to}`;
  const a = LINE.indexOf(from); const b = LINE.indexOf(to);
  if (a !== -1 && b !== -1 && b > a) return `Moved to ${to}`;
  if (a === -1 && b !== -1) return `Moved to ${to}`; // an unknown old value: the new stage is still worth writing
  return '';
}

function changes(before, after, whyOf = () => '') {
  const old = index(before);
  const out = [];
  index(after).forEach((now, rowId) => {
    const was = old.get(rowId);
    if (!was || was.stage === now.stage) return;
    const words = lineFor(was.stage, now.stage, was.intake, now.intake, now.stage === 'Withdrawn' ? whyOf(rowId) : '');
    if (!words) return;
    out.push({ rowId, from: was.stage, to: now.stage, fromIntake: was.intake, toIntake: now.intake, text: words, back: was.stage === 'Defer' && now.stage === 'Inquiry' && was.intake !== now.intake });
  });
  return out;
}

module.exports = { changes, lineFor, LINE, SIDE, intakeWords };
