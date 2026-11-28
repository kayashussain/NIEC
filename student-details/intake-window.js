// The intake Universities works on (the owner, 28 Nov 2026: no intake written into the code). UK courses start in three seasons:
//
//   January    courses starting in January, February or March
//   May        courses starting in April, May or June
//   September  courses starting from July to December
//
// The intake shown is the next season whose main month (January, May, September) has not come yet in office time: from September
// to December it is January of the next year, from January to April it is May, from May to August it is September. On 28 Nov 2026
// that is January 2027, exactly what the pages showed before. Every page, the Assign task window, the finder, the eligibility check
// and the Thursday refresh read it from here, so it moves on by itself.
//
// Used by the server (require) and by the pages (window.IntakeWindow).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IntakeWindow = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const TIME_ZONE = 'Asia/Kathmandu';
  const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SEASONS = [
    { season: 'January', main: 0, months: [0, 1, 2] },
    { season: 'May', main: 4, months: [3, 4, 5] },
    { season: 'September', main: 8, months: [6, 7, 8, 9, 10, 11] },
  ];
  // A month written as a word ("jan", "January", "Sept") or as a number in an ISO date ("2027-01").
  const WORDS = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];

  // The year and month (0 to 11) of a moment in office time.
  function officeMonth(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric' }).formatToParts(d);
      const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
      if (get('year') && get('month')) return { year: get('year'), month: get('month') - 1 };
    } catch (e) { /* no time zones here: Nepal is 5 h 45 min ahead of UTC */ }
    const n = new Date(d.getTime() + 345 * 60000);
    return { year: n.getUTCFullYear(), month: n.getUTCMonth() };
  }

  // The intake Universities works on at `date` (now when left out).
  function of(date) {
    const { year, month } = officeMonth(date);
    const next = SEASONS.find((s) => s.main > month);
    const s = next || SEASONS[0];
    const y = next ? year : year + 1;
    return make(s, y);
  }

  function make(s, year) {
    const months = s.months.slice();
    const alt = `(?:${months.map((m) => WORDS[m]).join('|')})`;
    const iso = `${year}-(?:${months.map((m) => String(m + 1).padStart(2, '0')).join('|')})`;
    const anywhere = new RegExp(`\\b${alt}\\.?\\s*${year}\\b|\\b${iso}\\b`, 'i');
    const atStart = new RegExp(`^(?:${alt}\\.?\\s*${year}\\b|${iso}\\b)`, 'i');
    const quarters = [...new Set(months.map((m) => Math.floor(m / 3) + 1))];
    return {
      season: s.season, year, months, names: months.map((m) => NAMES[m]),
      label: `${s.season} ${year}`, // "January 2027"
      quarters, // the calendar quarters the season covers (Adventus filters its intakes by quarter)
      // A text that names a month of this intake, anywhere in it ("Apply by ... for the January 2027 intake").
      test: (text) => anywhere.test(String(text == null ? '' : text)),
      // A text that starts with a month of this intake ("Jan 2027", "February 2027 - Semester 2", "2027-03-01").
      startsWith: (text) => atStart.test(String(text == null ? '' : text).trim()),
      // Where a month of this intake comes in the season (0 for its first month), or -1.
      indexOf(text) {
        const t = String(text == null ? '' : text).trim();
        const m = new RegExp(`^(${WORDS.join('|')})\\b`, 'i').exec(t);
        const i = m ? WORDS.findIndex((w) => new RegExp(`^${w}$`, 'i').test(m[1])) : -1;
        return months.indexOf(i);
      },
    };
  }

  // "January and February 2027" from start months such as "January 2027, February 2027" (any months and years; each year once).
  function label(starts) {
    const byYear = new Map();
    (Array.isArray(starts) ? starts : [starts]).forEach((s) => {
      const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/.exec(String(s || '').trim()) || /^(\d{4})-(\d{2})\b/.exec(String(s || '').trim());
      if (!m) return;
      let month; let year;
      if (/^\d{4}$/.test(m[1])) { year = Number(m[1]); month = Number(m[2]) - 1; } else { year = Number(m[2]); month = NAMES.findIndex((n) => n.slice(0, 3).toLowerCase() === m[1].toLowerCase()); }
      if (month < 0 || month > 11) return;
      if (!byYear.has(year)) byYear.set(year, new Set());
      byYear.get(year).add(month);
    });
    return [...byYear.keys()].sort((a, b) => a - b).map((y) => {
      const ms = [...byYear.get(y)].sort((a, b) => a - b).map((m) => NAMES[m]);
      return `${ms.length > 1 ? `${ms.slice(0, -1).join(', ')} and ${ms[ms.length - 1]}` : ms[0]} ${y}`;
    }).join(', ');
  }

  // "Jan, Feb 2027" from "January 2027, February 2027" (a short line for a course's card).
  function short(starts) {
    const list = String(starts || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    const years = [...new Set(list.map((x) => (/\b(\d{4})\b/.exec(x) || [])[1]).filter(Boolean))];
    const ms = [...new Set(list.map((x) => x.slice(0, 3)))];
    if (!ms.length) return '';
    return years.length === 1 ? `${ms.join(', ')} ${years[0]}` : list.join(', ');
  }

  return { of, label, short, NAMES, SEASONS, TIME_ZONE };
}));
