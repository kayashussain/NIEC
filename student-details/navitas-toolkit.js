// The Navitas product toolkit in Universities (the owner, 17 Nov 2026): Navitas keeps a public Google Sheet for Nepal ("Nepal
// UK/Europe Navitas product toolkit") with, for each of its pathway colleges, the entry requirements, the course list, fees,
// scholarships and deadlines, sample interview questions, the Flywire payment and refund links, the application process,
// accommodation links, tips and key selling points. Twice a week (Monday and Thursday from 2 a.m. office time)
// Vishnu reads that sheet and writes each UK college into its own university page. Only UK colleges: the German and Dutch ones
// are left out, and so is a college the sheet puts on hold or the owner has closed (Manchester Metropolitan University
// International College).
//
// The sheet is public ("anyone with the link can view"), so no login is needed: only docs.google.com is called, and only to read.
// Its address is the setting NAVITAS_SHEET_ID (the id in the sheet's link), else the toolkit the owner gave. NAVITAS_TOOLKIT=off
// switches the reading off. The latest reading is kept in navitas-toolkit.json in the data folder (never in git).
//
// Each college's page is the sheet's, every field: the table per level (entry, study gap, English, fees, scholarship), the courses,
// the January intake with its dates and courses, why students choose it, how to apply, the interview questions (the team only), the
// payment, refund and accommodation links. The sheet's tips for agents and its general notes are not put on the page. Nobody edits
// a page; the team may only correct an intake's dates (kept until the sheet changes them).

const fs = require('fs');
const path = require('path');
const { writeFileAtomic, twiceAWeekDue } = require('../shared/server-utils');
const { rulesFrom } = require('./eligibility');
const { mergeIntakeDates } = require('./facts');

const DEFAULT_SHEET_ID = '1P6XGHSG5svD-WG0CowbwoXlcF_-PrxFw';
const BY = 'Navitas toolkit (automatic)';
// Colleges never added, whatever the sheet says (the owner, 17 Nov 2026: "it's closed").
const CLOSED = [/manchester\s+metropolitan/i, /\bmmuic\b/i];
const NOT_UK = /germany|netherland|holland|\[netherland\]/i;

// ---- reading the sheet ----

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const cellText = (inner) => decode(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/\r/g, '').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// One tab of the sheet ("htmlview/sheet" page) as a grid. A merged cell is copied into every place it covers, with `top` false on
// the copies, so a value written once for several rows (a college's name, its IELTS score for every level) is read on each.
function gridFromHtml(html) {
  // A long tab comes as several tables one after the other: their rows are read as one grid.
  const tables = [...String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]).join('');
  if (!tables) return [];
  const out = [];
  let r = 0;
  for (const tr of tables.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let c = 0;
    for (const td of tr[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)) {
      if (/freezebar/.test(td[1])) continue;
      while (out[r] && out[r][c]) c += 1;
      const rs = Number((/rowspan="(\d+)"/.exec(td[1]) || [])[1]) || 1;
      const cs = Number((/colspan="(\d+)"/.exec(td[1]) || [])[1]) || 1;
      const t = cellText(td[2]);
      for (let i = 0; i < rs; i += 1) for (let j = 0; j < cs; j += 1) {
        out[r + i] = out[r + i] || [];
        out[r + i][c + j] = { t, top: i === 0 && j === 0, row: r };
      }
      c += cs;
    }
    out[r] = out[r] || [];
    r += 1;
  }
  return out.map((row) => Array.from(row, (x) => x || { t: '', top: true, row: -1 }));
}

// The tabs of the sheet, from its "htmlview" page: [{ name, gid }].
function tabsFromHtml(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"(?:[^"\\]|\\.)*",\s*gid:\s*"(\d+)"/g)) {
    const name = m[1].replace(/\\x([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1').trim();
    if (!out.some((t) => t.gid === m[2])) out.push({ name, gid: m[2] });
  }
  return out;
}

// ---- the colleges ----

// A college's name in a few words to match it across tabs: "Anglia Ruskin University College (ARU College) - UK" -> "anglia ruskin".
const GENERIC = new Set(['university', 'univeristy', 'universities', 'international', 'college', 'colllege', 'the', 'of', 'and', 'london', 'pathway', 'uk',
  'courses', 'course', 'cousres', 'bachelor', 'bachelors', 'master', 'masters', 'netherland', 'scotland', 'wales']);
const words = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\[.*?\]/g, ' ').split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
const keyWords = (name) => words(String(name).split('\n')[0]);
const sameCollege = (name, other) => { const k = keyWords(name); const o = new Set(words(other)); return k.length > 0 && k.every((w) => o.has(w)); };
const isClosed = (name) => CLOSED.some((re) => re.test(name)) || /\bhold\b/i.test(name);

// Never copied onto a page (the owner: incentives are Admin's only, behind their own password).
const PRIVATE = /incentive|commission/i;
// Notes meant for the agents only ("(Please confirm with <name> for this)") are taken out of a line too.
const keep = (text) => String(text || '').split('\n').filter((l) => !PRIVATE.test(l)).map((l) => l.replace(/\s*\((?:please\s+)?(?:confirm|check)\s+with\b[^)]*\)/gi, '')).join('\n').trim();
const tidyLines = (text) => keep(text).split('\n').map((l) => l.replace(/^[\s•●▪\-*]+/, '').replace(/\s+/g, ' ').trim());
const bullets = (text) => tidyLines(text).filter(Boolean).map((l) => `- ${l}`).join('\n');
const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const findCol = (row, re) => row.findIndex((c) => re.test(oneLine(c.t)));
const findRow = (grid, re) => grid.findIndex((row) => row.some((c) => re.test(oneLine(c.t))));

// "Overall Requirements": one block of rows per college, one row per level.
function readRequirements(grid) {
  const h = findRow(grid, /^university name$/i);
  if (h < 0) return [];
  const head = grid[h];
  const col = {
    name: findCol(head, /^university name$/i), location: findCol(head, /^location$/i), level: findCol(head, /^level$/i),
    academic: findCol(head, /^academic/i), ielts: findCol(head, /^ielts/i), pte: findCol(head, /^pte/i), test: findCol(head, /duolingo|university test/i),
    waiver: findCol(head, /waiver/i), gap: findCol(head, /^gap/i), intake: findCol(head, /^intake/i),
  };
  const travel = col.location >= 0 && head[col.location + 1] && head[col.location + 1].row === head[col.location].row && oneLine(head[col.location + 1].t) === oneLine(head[col.location].t) ? col.location + 1 : -1;
  const get = (row, k) => (col[k] >= 0 && row[col[k]] ? row[col[k]].t : '');
  const out = [];
  for (let r = h + 1; r < grid.length; r += 1) {
    const row = grid[r];
    const nameCell = row[col.name];
    const level = oneLine(get(row, 'level'));
    if (!nameCell || !nameCell.t || !level) continue;
    let college = out[out.length - 1];
    if (nameCell.top || !college || college.rowName !== nameCell.row) {
      college = { rowName: nameCell.row, sheetName: nameCell.t, city: oneLine(get(row, 'location')), travel: travel >= 0 ? row[travel].t : '', intake: oneLine(get(row, 'intake')), levels: [] };
      out.push(college);
    }
    college.levels.push({ level, academic: get(row, 'academic'), ielts: oneLine(get(row, 'ielts')), pte: get(row, 'pte'), test: get(row, 'test'), waiver: get(row, 'waiver'), gap: get(row, 'gap') });
  }
  return out.map(({ rowName, ...c }) => c);
}

// "Fees/Scholarship/Deadlines": the college's name is sometimes on the row under its figures (a merged cell), so a name is matched
// to the figures of the row its cells started on.
function readFees(grid) {
  const h = findRow(grid, /^college name/i);
  if (h < 0) return [];
  const head = grid[h];
  const col = { name: findCol(head, /^college name/i), scholarship: findCol(head, /scholarship/i), range: findCol(head, /fees range/i), link: findCol(head, /fees link/i) };
  const out = [];
  for (let r = h + 1; r < grid.length; r += 1) {
    const row = grid[r];
    const name = row[col.name];
    if (!name || !name.top || !oneLine(name.t)) continue;
    const at = (k) => (col[k] >= 0 && row[col[k]] ? row[col[k]] : { t: '', row: r });
    const src = at('scholarship').t || at('range').t ? at('scholarship').row : r;
    const from = grid[src] || row;
    const cell = (k) => (col[k] >= 0 && from[col[k]] ? from[col[k]].t : '');
    out.push({ sheetName: name.t, scholarship: cell('scholarship'), range: cell('range'), link: oneLine(cell('link')) });
  }
  return out;
}

// "Available Course List": sections of rows per college and level ("(Bachelor Courses)", "(Masters Courses)"), the September
// courses one per row and the January courses in one cell.
function readCourses(grid) {
  const h = findRow(grid, /^colleges/i);
  if (h < 0) return { sections: [], janName: '' };
  const head = grid[h];
  const col = { name: findCol(head, /^colleges/i), sept: findCol(head, /available for september/i), jan: findCol(head, /courses for jan/i) };
  const year = (/jan\w*\s+(\d{4})/i.exec(col.jan >= 0 ? head[col.jan].t : '') || [])[1];
  const sections = [];
  for (let r = h + 1; r < grid.length; r += 1) {
    const row = grid[r];
    const name = row[col.name];
    if (!name || !oneLine(name.t)) continue;
    let s = sections[sections.length - 1];
    if (!s || s.row !== name.row) { s = { row: name.row, sheetName: name.t, level: /master/i.test(name.t) ? 'Postgraduate' : /bachelor/i.test(name.t) ? 'Undergraduate' : 'Other courses', sept: [], jan: '' }; sections.push(s); }
    const sept = col.sept >= 0 && row[col.sept];
    if (sept && sept.top && oneLine(sept.t) && !PRIVATE.test(sept.t)) s.sept.push(oneLine(sept.t));
    const jan = col.jan >= 0 && row[col.jan];
    if (jan && jan.top && oneLine(jan.t)) s.jan = [s.jan, jan.t].filter(Boolean).join('\n');
  }
  return { sections: sections.map(({ row, ...s }) => s), janName: year ? `January ${year}` : '' };
}

// Two-column tabs (college, link): payment and refund links, accommodation links.
function readLinks(grid, cols) {
  const h = findRow(grid, /^college name$/i);
  if (h < 0) return [];
  const head = grid[h];
  const at = cols.map((re) => findCol(head, re));
  return grid.slice(h + 1).filter((row) => row[0] && row[0].top && oneLine(row[0].t) && at.some((c) => c >= 0 && /^https?:\/\//.test(oneLine((row[c] || {}).t))))
    .map((row) => ({ sheetName: row[0].t, links: at.map((c) => (c >= 0 && row[c] && /^https?:\/\//.test(oneLine(row[c].t)) ? oneLine(row[c].t) : '')) }));
}
// The text of a tab that is not about one college (a note at the end, the tips), line by line, without the links already shown.
const looseText = (grid, { skip = () => false } = {}) => grid.flatMap((row) => row.filter((c) => c.top && oneLine(c.t) && !skip(c.t)).map((c) => c.t));

// "Interview Questions Sample": the UK sections (a title cell, then its questions), and a note "ONLY for <college> ..." for one college.
function readInterview(grid) {
  const all = looseText(grid);
  const only = all.filter((t) => /^only for\b/i.test(oneLine(t)));
  const general = all.filter((t) => !/^only for\b/i.test(oneLine(t)));
  const out = [];
  general.forEach((t) => {
    const line = oneLine(t);
    if (/^uk\/?netherland/i.test(line) || /^study destination/i.test(line)) return;
    if (/^interviews are mandatory/i.test(line)) { out.push(...tidyLines(t).filter((l) => l && !/netherland/i.test(l))); return; }
    if (/^final advice/i.test(line)) { out.push('## Final advice', ...tidyLines(t.replace(/^final advice\s*/i, '')).filter(Boolean)); return; }
    if (!/\n/.test(t) && t === t.toUpperCase() && line.length < 80) { out.push(`## ${line.charAt(0) + line.slice(1).toLowerCase()}`); return; }
    if (/•/.test(t)) { out.push(bullets(t)); return; }
    out.push(...tidyLines(t).filter(Boolean));
  });
  return { text: keep(out.join('\n')), only };
}

// "Application Process UK/Netherland": the UK steps only (STEP 1, its title, then its details), up to the Netherlands part.
function readProcess(grid) {
  const all = looseText(grid, { skip: (t) => /^\*?please note that scholarships/i.test(oneLine(t)) });
  const start = all.findIndex((t) => /^for uk process/i.test(oneLine(t)));
  const out = [];
  for (let i = start + 1; start >= 0 && i < all.length; i += 1) {
    const t = oneLine(all[i]);
    if (/^for netherland/i.test(t)) break;
    if (/^step\s*\d+/i.test(t)) { out.push({ title: '', detail: [] }); continue; }
    const step = out[out.length - 1];
    if (!step) continue;
    if (!step.title) step.title = t.length > 200 ? t.slice(0, 197).replace(/\s+\S*$/, '...') : t; else step.detail.push(all[i]);
    if (t.length > 200 && step.detail.length === 0) step.detail.push(all[i]);
  }
  return out.filter((s) => s.title).map((s) => ({ title: s.title, detail: keep(s.detail.join('\n\n')) }));
}

// "Key Selling Points": ranking, famous subjects, what the city is known for, the selling points.
function readSelling(grid) {
  const h = findRow(grid, /^college name$/i);
  if (h < 0) return [];
  const head = grid[h];
  const col = { location: findCol(head, /^location$/i), ranking: findCol(head, /ranking/i), subjects: findCol(head, /famous subjects/i), known: findCol(head, /known for/i), usp: findCol(head, /usp/i) };
  const get = (row, k) => (col[k] >= 0 && row[col[k]] ? row[col[k]].t : '');
  return grid.slice(h + 1).filter((row) => row[0] && row[0].top && oneLine(row[0].t))
    .map((row) => ({ sheetName: row[0].t, location: oneLine(get(row, 'location')), ranking: oneLine(get(row, 'ranking')), subjects: oneLine(get(row, 'subjects')), known: oneLine(get(row, 'known')), usp: get(row, 'usp') }));
}

// The whole toolkit, from the tabs' grids (by the tab's name), as one reading: the UK colleges with everything the sheet says of each.
function readToolkit(tabs) {
  const tab = (re) => { const k = Object.keys(tabs).find((n) => re.test(n)); return k ? tabs[k] : []; };
  const reqs = readRequirements(tab(/overall requirement/i));
  const fees = readFees(tab(/fees|scholarship|deadline/i));
  const courses = readCourses(tab(/course list/i));
  const pay = readLinks(tab(/flywire|payment|refund/i), [/flywire/i, /refund/i]);
  const payGrid = tab(/flywire|payment|refund/i);
  const payNotes = looseText(payGrid, { skip: (t) => /^https?:\/\//.test(oneLine(t)) || /^(payment links|refund links|college name|college flywire link|college refund links)$/i.test(oneLine(t)) || pay.some((p) => p.sheetName === t) });
  const accGrid = tab(/accom/i);
  const acc = readLinks(accGrid, [/accom/i]);
  const accNotes = looseText(accGrid, { skip: (t) => /^https?:\/\//.test(oneLine(t)) || /^(college name|accomm?odation links)$/i.test(oneLine(t)) || acc.some((p) => p.sheetName === t) });
  const interview = readInterview(tab(/interview/i));
  const processSteps = readProcess(tab(/application process/i));
  const selling = readSelling(tab(/selling/i));

  const colleges = reqs.filter((c) => !isClosed(c.sheetName) && !NOT_UK.test(c.city) && (/-\s*uk\b/i.test(c.sheetName.split('\n')[0]) || !NOT_UK.test(c.sheetName)))
    .map((c) => {
      const name = oneLine(c.sheetName.split('\n')[0]).replace(/\s*-\s*UK\s*$/i, '').trim();
      const match = (list) => list.find((x) => sameCollege(name, x.sheetName));
      const f = match(fees) || {};
      const s = match(selling) || {};
      const p = match(pay) || { links: [] };
      const a = match(acc) || { links: [] };
      const sections = courses.sections.filter((x) => sameCollege(name, x.sheetName));
      return {
        name, city: c.city, travel: c.travel, intake: c.intake, levels: c.levels,
        scholarship: f.scholarship || '', feeRange: f.range || '', feeLink: f.link || '',
        courses: sections.map((x) => ({ level: x.level, sept: x.sept, jan: x.jan })), janName: courses.janName,
        flywire: p.links[0] || '', refund: p.links[1] || '', accommodation: a.links[0] || '',
        selling: s.sheetName ? { location: s.location, ranking: s.ranking, subjects: s.subjects, known: s.known, usp: s.usp } : null,
        interviewNote: interview.only.filter((t) => sameCollege(name, t)).join('\n'),
      };
    });
  return { colleges, interview: interview.text, process: processSteps, payNotes, accNotes };
}

// ---- one college as a university page ----

// The levels a line names (Foundation, International Year One, Pre-Masters).
const LEVEL_RES = { fdn: /foundation|fdn/i, iy1: /year one|iy1|iyo|\bug\b|undergrad|integrated|first year/i, pg: /pre[- ]?master|pmp|\bpg\b|postgrad|masters/i };
const levelsIn = (line) => Object.keys(LEVEL_RES).filter((k) => LEVEL_RES[k].test(line));
const levelKey = (level) => levelsIn(level)[0] || '';
// A line about the intake's dates: "Application Deadline: 27th Nov 2026", "OPEN FOR JAN 2027", or "IY1: 31st January" under one.
const isDateLine = (l) => /deadline|enrol|open for|application open|applications? (for|are)|^cas\b/i.test(l)
  || /^[\w/ ]{1,20}:\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\b/.test(l);
// The scholarship text in paragraphs (split at blank lines).
const paragraphs = (text) => keep(text).split(/\n\s*\n/).map((p) => tidyLines(p).filter(Boolean)).filter((p) => p.length);
// The scholarship lines for one level: a line naming levels goes to those; a line naming none goes where its paragraph's first line
// points when that line is a heading ("Progression Scholarship for Pre Masters:"), else to every level. Date lines are left out.
function scholarshipFor(text, level) {
  const mine = levelKey(level);
  return paragraphs(text).flatMap((p) => {
    const head = /:$/.test(p[0]) ? levelsIn(p[0]) : [];
    const rest = p.slice(1).some((l) => levelsIn(l).length);
    return p.filter((l) => !isDateLine(l)).filter((l, i) => {
      const named = levelsIn(l);
      if (named.length) return !mine || named.includes(mine);
      if (i > 0 && head.length && !rest) return !mine || head.includes(mine);
      return true;
    });
  }).join('\n');
}
// The January intake's dates: a date in March to October belongs to another intake (a September enrolment date), and a heading
// left with no date under it goes too.
const OTHER_MONTH = /\b(mar|apr|may|jun|jul|aug|sep|oct)[a-z]*\b/i;
const deadlinesOf = (text) => paragraphs(text).flatMap((p) => {
  const lines = p.filter(isDateLine).filter((l) => !(/\d/.test(l) && OTHER_MONTH.test(l)));
  return lines.filter((l, i) => /\d/.test(l) || /open for/i.test(l) || lines.slice(i + 1).some((x) => /\d/.test(x)));
});
const firstDate = (lines) => {
  for (const l of lines) {
    const m = /\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:,?\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/.exec(l);
    if (m && /deadline|enrol/i.test(l)) return m[0];
  }
  return '';
};
const levelName = (level) => { const t = oneLine(level); const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t); return m && /\d/.test(m[2]) ? { name: m[1].trim(), duration: m[2].replace(/\byrs?\b/i, 'years').trim() } : { name: t, duration: '' }; };
const origin = (url) => { try { return new URL(url).origin; } catch (e) { return ''; } };
const scoreLine = (label, v) => (oneLine(v) && !/^n\/?a$/i.test(oneLine(v)) ? `${label}: ${tidyLines(v).filter(Boolean).join('; ')}` : '');

function pageFrom(c, kit) {
  const programs = c.levels.map((L) => {
    const { name, duration } = levelName(L.level);
    return {
      name, duration,
      academic: [tidyLines(L.academic).filter(Boolean).join('\n'), oneLine(L.gap) ? `Study gap: ${oneLine(L.gap)}` : ''].filter(Boolean).join('\n'),
      english: [scoreLine('IELTS', L.ielts), scoreLine('PTE', L.pte), scoreLine('Other tests', L.test), /^(no waiver|n\/?a)$/i.test(oneLine(L.waiver)) ? 'English Waiver: none' : scoreLine('English Waiver', L.waiver)].filter(Boolean).join('\n'),
      tuition: [tidyLines(c.feeRange).filter((l) => l && !/refer to|link here/i.test(l)).join('\n'), c.feeLink ? `Fees page: ${c.feeLink}` : ''].filter(Boolean).join('\n'),
      scholarship: scholarshipFor(c.scholarship, L.level),
      deposit: '', // not given per college: the deposit is a step of How to apply
    };
  });
  const byLevel = new Map();
  c.courses.forEach((s) => { if (!byLevel.has(s.level)) byLevel.set(s.level, new Set()); s.sept.forEach((x) => byLevel.get(s.level).add(x)); });
  const coursesText = [...byLevel].filter(([, set]) => set.size).map(([lvl, set]) => `## ${lvl}\n${[...set].map((x) => `- ${x}`).join('\n')}`).join('\n');
  const jan = c.courses.map((s) => s.jan).filter(Boolean).join('\n');
  const deadlines = deadlinesOf(c.scholarship);
  const janOpen = jan || /open for jan/i.test(c.scholarship);
  // "IY1/3 years courses:" and "PRE-MASTERS Courses" are headings over the courses under them.
  const janCourses = tidyLines(jan).filter(Boolean).map((l) => (/:$/.test(l) || /\bcourses\b/i.test(l) ? `## ${l.replace(/:$/, '')}` : `- ${l}`)).join('\n');
  const intakes = c.janName && janOpen ? [{ name: c.janName, deadline: firstDate(deadlines), deadlines: deadlines.join('\n'), courses: janCourses }] : [];
  const s = c.selling || {};
  const overview = [
    s.usp ? bullets(s.usp) : '',
    s.ranking ? `Ranking: ${s.ranking}` : '',
    s.subjects ? `Popular subjects with Nepalese students: ${s.subjects}` : '',
    c.intake ? `Intakes: ${c.intake}` : '',
  ].filter(Boolean).join('\n');
  const location = [c.city, ...tidyLines(c.travel).filter(Boolean), s.known ? `Known for: ${s.known}` : ''].filter(Boolean).join('\n');
  const interview = [c.interviewNote ? `## For this college\n${bullets(c.interviewNote)}` : '', kit.interview].filter(Boolean).join('\n');
  // Only what is not elsewhere on the page (the owner, 17 Nov 2026): the scholarships are in the table, the dates at the top; the team's
  // tips, the sheet's general notes and where it comes from are not for the page.
  const notes = [
    c.flywire || c.refund ? `## Paying the fees\n${[c.flywire ? `- Flywire payment: ${c.flywire}` : '', c.refund ? `- Refund request: ${c.refund}` : '', ...kit.payNotes.map((t) => bullets(t))].filter(Boolean).join('\n')}` : '',
    c.accommodation ? `## Accommodation\n- ${c.accommodation}\n${kit.accNotes.map((t) => bullets(t)).join('\n')}`.trim() : '',
  ].filter(Boolean).join('\n');
  const rules = rulesFrom({
    requirements: c.levels.map((L) => ({ level: L.level, criteria: tidyLines(L.academic).filter(Boolean), gap: oneLine(L.gap) })),
    tests: c.levels.flatMap((L) => [
      { test: 'IELTS', level: L.level, score: L.ielts },
      { test: 'PTE', level: L.level, score: tidyLines(L.pte)[0] || '' },
      ...(/(not|don.?t)\s+accept\w*\s+duolingo|duolingo\s+(is\s+)?not\s+accepted/i.test(oneLine(L.test)) ? [] : [{ test: 'Duolingo', level: L.level, score: (/duolingo\s*:?\s*(\d{2,3}\s*\/\s*\d{2,3})/i.exec(L.test) || /^\s*(\d{2,3}\s*\/\s*\d{2,3})/.exec(L.test) || [])[1] || '' }]),
    ].filter((t) => /\d/.test(t.score || ''))),
    english: c.levels.map((L) => ({ level: L.level, waiver: Boolean(oneLine(L.waiver)) && !/^(no waiver|n\/?a)$/i.test(oneLine(L.waiver)), criteria: tidyLines(L.waiver).filter(Boolean) })),
  });
  return {
    name: c.name, city: c.city, website: origin(c.feeLink || c.accommodation),
    programs,
    entryRequirements: '', // all in the table
    languageTests: '',
    courses: coursesText,
    intakes,
    overview, location, interview, notes,
    process: kit.process.map((p) => ({ title: p.title, detail: p.detail })),
    rules,
  };
}

// ---- into Universities ----

// Every field of a college's page comes from the sheet (nobody edits a page by hand, the owner, 17 Nov 2026), except the dates of the
// intakes, which the team may correct (mergeIntakeDates in facts.js).
const FIELDS = ['city', 'website', 'overview', 'location', 'programs', 'entryRequirements', 'languageTests', 'courses', 'interview', 'notes', 'process', 'rules'];
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Writes a reading into Universities. Returns { updated, added, unchanged }.
function syncToolkit(facts, reading, { clean = (x) => x } = {}) {
  const out = { updated: 0, added: 0, unchanged: 0 };
  if (!reading || !Array.isArray(reading.pages)) return out;
  reading.pages.forEach((fresh) => {
    const key = squash(fresh.name);
    // The college's page by its name, else the toolkit's page of the same college under its old name (the sheet renamed it).
    let page = facts.all().find((u) => squash(u.name) === key)
      || facts.all().find((u) => u.source && u.source.navitas && sameCollege(fresh.name, u.name) && sameCollege(u.name, fresh.name));
    if (!page) {
      const made = facts.create(fresh.name, BY);
      if (made.error) return;
      page = made.university;
      out.added += 1;
    }
    const next = { ...page, name: fresh.name };
    FIELDS.forEach((k) => { if (!((k === 'website' || k === 'city') && !fresh[k])) next[k] = fresh[k]; });
    // The sheet's intake (its dates and courses), then the page's other intakes.
    const mine = page.intakes || [];
    next.intakes = [
      ...fresh.intakes.map((i) => mergeIntakeDates(mine.find((x) => x.name.toLowerCase() === i.name.toLowerCase()) || {}, i)),
      ...mine.filter((x) => !fresh.intakes.some((i) => i.name.toLowerCase() === x.name.toLowerCase())),
    ];
    const cleaned = clean(next, page);
    // The date of the reading is kept on the page only when something changed (the page's date then says when it last changed).
    next.source = { ...(page.source || {}), navitas: { at: reading.fetchedAt || new Date().toISOString() } };
    const pick = (u) => JSON.stringify(['name', 'intakes', ...FIELDS].map((k) => (k === 'intakes' ? (u.intakes || []).map(({ id, ...i }) => i) : u[k] ?? null)));
    if (page.source && page.source.navitas && pick(cleaned) === pick(page)) { out.unchanged += 1; return; }
    const saved = facts.update(page.id, next, BY);
    if (!saved.error) out.updated += 1;
  });
  return out;
}

// ---- the twice-a-week reading ----

function createNavitasToolkit({ dir, facts, sheetId = DEFAULT_SHEET_ID, fetchImpl = (...a) => fetch(...a), now = () => new Date(), enabled = true, clean } = {}) {
  const file = path.join(dir, 'navitas-toolkit.json');
  let cache = null; // the file, read once (only this server writes it)
  const read = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cache = {}; } } return cache; };
  const write = (d) => { cache = d; fs.mkdirSync(dir, { recursive: true }); writeFileAtomic(file, JSON.stringify(d, null, 2)); };
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}`;
  async function get(url) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Vishnu Universities' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`The toolkit sheet answered ${res.status}${res.status === 401 || res.status === 403 ? ': it must be shared as "Anyone with the link can view".' : '.'}`);
    return res.text();
  }
  let running = null;
  function run(by = 'schedule') {
    if (running) return running;
    running = (async () => {
      const started = now().toISOString();
      const d = read();
      try {
        const tabs = tabsFromHtml(await get(`${base}/htmlview`));
        if (!tabs.length) throw new Error('No tabs found in the toolkit sheet.');
        const grids = {};
        for (const t of tabs) grids[t.name] = gridFromHtml(await get(`${base}/htmlview/sheet?headers=false&gid=${t.gid}`));
        const kit = readToolkit(grids);
        if (!kit.colleges.length) throw new Error('No UK college found in the toolkit sheet (has its layout changed?).');
        const pages = kit.colleges.map((c) => pageFrom(c, kit));
        const fetchedAt = now().toISOString();
        if (!facts) throw new Error('No Universities to write into.');
        const synced = syncToolkit(facts, { pages, fetchedAt }, { clean });
        write({ fetchedAt, colleges: pages.map((p) => p.name), runs: [{ at: fetchedAt, started, by, ok: true, colleges: pages.length, updated: synced.updated, added: synced.added }, ...(d.runs || [])].slice(0, 20) });
        console.log(`[navitas toolkit] ${pages.length} UK colleges read; Universities: ${synced.updated} updated, ${synced.added} added, ${synced.unchanged} unchanged`);
        return { colleges: pages.length, updated: synced.updated, added: synced.added, unchanged: synced.unchanged };
      } catch (e) {
        write({ ...d, runs: [{ at: now().toISOString(), started, by, ok: false, error: e.message }, ...(d.runs || [])].slice(0, 20) });
        console.log(`[navitas toolkit] reading failed: ${e.message}`);
        return { error: e.message };
      } finally { running = null; }
    })();
    return running;
  }

  // Twice a week: Monday and Thursday from 2 a.m. office time (see twiceAWeekDue in shared/server-utils.js).
  const due = (date = now()) => enabled && !running && twiceAWeekDue(read().runs, date);
  const tick = () => { if (due()) run('schedule').catch(() => {}); };
  return {
    enabled: () => enabled, run, due, tick, isRunning: () => Boolean(running),
    summary() { const d = read(); return { enabled, running: Boolean(running), fetchedAt: d.fetchedAt || '', colleges: (d.colleges || []).length, lastRun: (d.runs || [])[0] || null }; },
  };
}

module.exports = { createNavitasToolkit, gridFromHtml, tabsFromHtml, readToolkit, pageFrom, syncToolkit, sameCollege, DEFAULT_SHEET_ID };
