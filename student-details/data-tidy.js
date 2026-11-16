// Keeps the stored student data in one tidy form, so every page reads it the same way (the owner asked, 16 Nov 2026, that the
// live data be arranged better). It runs when the server starts, changes only what is clearly the same thing written another
// way, never changes what a value means, and writes every change in Activity.
//
//   Dates. An intake imported from a spreadsheet holds dates like 7/15/2026, the rest of the system YYYY-MM-DD. Most pages read
//   7/15/2026 month first, but some read a date such as 7/9/2026 day first (9 July or 7 September?). Each such date is rewritten
//   as YYYY-MM-DD, only in the date columns, and only when the intake's own dates prove the order: some have a number over 12
//   in second place (7/15/2026: month first) and none in first place, or the other way round. An intake whose dates do not
//   prove it (all could be read either way, or they disagree) is left exactly as it is.
//   Receiving Partner. "Chitwan" where the same column says "Chitwan Branch" elsewhere is the same office: it becomes "Chitwan
//   Branch", so the office is counted once on the Dashboard and in the filters.

const DATE_COLS = [
  'APPLICATION SUBMISSION DATE', 'OFFER RECEIVED DATE', 'LANGUAGE TEST DATE', 'PAYMENT DATE', 'CAS REQUESTED DATE', 'CAS RECEIVED DATE',
  'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE', 'MOCK SCHEDULE 1', 'MOCK SCHEDULE 2', 'MOCK SCHEDULE 3', 'MOCK SCHEDULE 4',
];
const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const OFFICE_COLS = ['RECEIVING PARTNER'];

function realDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

// 'month' or 'day' when the sheet's slash dates prove which comes first, else ''.
function slashOrder(sheet) {
  let monthFirst = false;
  let dayFirst = false;
  for (const row of sheet.rows || []) {
    for (const col of DATE_COLS) {
      const m = SLASH.exec(String((row && row[col]) || '').trim());
      if (!m) continue;
      if (Number(m[1]) > 12) dayFirst = true;
      if (Number(m[2]) > 12) monthFirst = true;
    }
  }
  if (monthFirst && !dayFirst) return 'month';
  if (dayFirst && !monthFirst) return 'day';
  return '';
}

// The tidy workbook and the lines for Activity; the workbook is the same object when nothing changed.
function tidyWorkbook(wb) {
  if (!wb || !Array.isArray(wb.sheets)) return { workbook: wb, changes: [] };
  const changes = [];
  let changed = false;
  // The offices named in the Receiving Partner column of any intake, by their name without " Branch".
  const offices = new Map();
  for (const sheet of wb.sheets) {
    for (const col of OFFICE_COLS) {
      for (const row of sheet.rows || []) {
        const v = String((row && row[col]) || '').trim();
        const m = /^(.+?)\s+branch$/i.exec(v);
        if (m) offices.set(`${col}\u0001${m[1].toLowerCase()}`, v);
      }
    }
  }
  const sheets = wb.sheets.map((sheet) => {
    const order = slashOrder(sheet);
    let dates = 0;
    const renamed = {};
    const rows = (sheet.rows || []).map((row) => {
      if (!row || typeof row !== 'object') return row;
      let next = row;
      if (order) {
        for (const col of DATE_COLS) {
          const m = SLASH.exec(String(row[col] || '').trim());
          if (!m) continue;
          const iso = order === 'month' ? realDate(Number(m[3]), Number(m[1]), Number(m[2])) : realDate(Number(m[3]), Number(m[2]), Number(m[1]));
          if (!iso) continue;
          if (next === row) next = { ...row };
          next[col] = iso;
          dates += 1;
        }
      }
      for (const col of OFFICE_COLS) {
        const v = String(row[col] || '').trim();
        const to = v && offices.get(`${col}\u0001${v.toLowerCase()}`);
        if (!to || to === v) continue;
        if (next === row) next = { ...row };
        next[col] = to;
        renamed[`${v} → ${to}`] = (renamed[`${v} → ${to}`] || 0) + 1;
      }
      return next;
    });
    if (dates) changes.push(`${sheet.name}: ${dates} date${dates === 1 ? '' : 's'} written as YYYY-MM-DD (they were ${order === 'month' ? 'month' : 'day'} first, like 7/15/2026)`);
    Object.entries(renamed).forEach(([k, n]) => changes.push(`${sheet.name}: Receiving Partner ${k}: ${n} student${n === 1 ? '' : 's'}`));
    if (!dates && !Object.keys(renamed).length) return sheet;
    changed = true;
    return { ...sheet, rows };
  });
  if (!changed) return { workbook: wb, changes };
  return { workbook: { ...wb, sheets, revision: (Number(wb.revision) || 0) + 1 }, changes };
}

function tidyData({ getWorkbook, writeWorkbook, record = () => {} }) {
  const { workbook, changes } = tidyWorkbook(getWorkbook());
  if (!changes.length) return { changes };
  writeWorkbook(workbook);
  record(changes);
  return { changes };
}

module.exports = { tidyData, tidyWorkbook, slashOrder };
