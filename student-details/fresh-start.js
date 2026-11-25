// "Start fresh" (the owner, 25 Nov 2026): the students are cut down to the six details that stay, every other detail is deleted,
// and so are the student cards (notes, tasks, options, messages) and the Mock Team's bookings. A student with no contact number,
// and a student built only for testing, are deleted. Universities, Partner Universities, B2B partners, agents, accounts and
// Incentive figures are not touched. The pure part lives here so it can be tested; server.js applies it (Admin only, two steps).

const KEEP = ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER', 'NOC NUMBER', 'APPLICATION STATUS'];
const TEST_NAME = /^(test|testing|tester|demo|dummy|sample|asdf)$/i;
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Why a student is deleted, or '' when the student stays.
function whyDelete(row) {
  if (!text(row['CONTACT NUMBER'])) return 'no contact number';
  if (TEST_NAME.test(text(row['FIRST NAME'])) || TEST_NAME.test(text(row['LAST NAME']))) return 'a test student';
  return '';
}

// The workbook as it would be: kept rows reduced to KEEP (and their _id, so Incentive links hold), plus what goes.
function plan(workbook) {
  const removed = [];
  let kept = 0;
  const sheets = (workbook.sheets || []).map((sheet) => {
    const rows = [];
    (sheet.rows || []).forEach((row) => {
      const why = whyDelete(row);
      if (why) { removed.push({ sheet: sheet.name, name: `${text(row['FIRST NAME'])} ${text(row['LAST NAME'])}`.trim() || '(no name)', why }); return; }
      const out = { _id: row._id };
      KEEP.forEach((k) => { if (text(row[k])) out[k] = row[k]; });
      rows.push(out); kept += 1;
    });
    return { ...sheet, rows };
  });
  return { sheets, kept, removed };
}

module.exports = { plan, whyDelete, KEEP };
