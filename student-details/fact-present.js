// How a university's Fact File page is shown (the owner, 17 Nov 2026: "put the correct information in the correct section, nothing
// twice, not an extra word"). The page is kept as it was read (Route2Uni, the Navitas toolkit, the starting sheets); this file turns
// any stored page into one clean view, whatever its source:
//
//   deadlines     every intake's dates, first on the page: "Apply by" and each key date with how many days are left. Dates written in
//                 an intake's notes or the page's notes ("## Key Dates ...") are moved here, never shown twice.
//   table         one row per course level: entry (with the study gap), English, fees, scholarship, deposit. A column empty for every
//                 level is left out.
//   more          what the table does not already say: a sentence pointing at "the table above" is dropped.
//   courses       one list, grouped by level, each course with the intakes it runs in (only when the intakes differ).
//   overview      without lines that only repeat the intakes, levels or city.
//   process       only when it says more than the empty starting steps.
//
// The words are tidied the same way everywhere: "University Internal Test", "MOI", "Waiver", and a line written in capitals only is
// written in normal case (abbreviations such as IELTS or CAS stay).
//
// Used by the page (fact-university.js, in the browser) and by the tests (in Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FactPresent = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const has = (s) => String(s || '').trim() !== '';
  const lines = (t) => String(t || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthOf = (w) => MONTHS.findIndex((m) => m.startsWith(String(w).toLowerCase().slice(0, 3)));

  // ---- words ----
  const KEEP_CAPS = new Set(['IELTS', 'UKVI', 'PTE', 'TOEFL', 'OET', 'CAS', 'MOI', 'GPA', 'UK', 'EU', 'USA', 'UG', 'PG', 'IY1', 'IYO', 'PMP', 'FDN', 'BSC', 'MSC', 'MBA', 'BA', 'MA', 'LLM',
    'ELPT', 'KUDA', 'SWELT', 'PVT', 'ELLT', 'BCU', 'ARU', 'ARUC', 'BCUIC', 'KUIC', 'HIC', 'BPC', 'UPIC', 'ICRGU', 'ICP', 'TCSU', 'NEB', 'CV', 'SOP', 'TB', 'UOL', 'GBP', 'NPR', 'STEAM', 'TEF',
    'II', 'III', 'L', 'S', 'R', 'W', 'BTEC', 'CTEVT', 'GCSE', 'SELT', 'ATAS', 'NHS', 'STEM', 'IELTS', 'LLB', 'BENG', 'MENG', 'MRES', 'PHD', 'HND', 'HNC', 'IB']);
  // A line in capitals only ("FREE INTERNAL ENGLISH TEST (ELPT)") in normal case ("Free internal English test (ELPT)").
  function calmCaps(line) {
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 12 || letters !== letters.toUpperCase()) return line;
    let first = true;
    return line.replace(/[A-Za-z][A-Za-z']*/g, (w) => {
      const keepIt = KEEP_CAPS.has(w.toUpperCase()) && w.length <= 5 && !(first && w.length > 3);
      let out = keepIt ? w.toUpperCase() : w.toLowerCase();
      if (/^(english|nepal|nepalese|london|uk|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(w)) out = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      if (first) { out = out.charAt(0).toUpperCase() + out.slice(1); first = false; }
      return out;
    });
  }
  // The owner's spelling of the English terms (17 Nov 2026).
  function tidyTerms(text) {
    return lines(text).map((l) => calmCaps(l)
      .replace(/\buniversity\s+(?:internal\s+)?(?:english\s+)?test\b/gi, 'University Internal Test')
      .replace(/\binternal\s+english\s+test\b/gi, 'University Internal Test')
      .replace(/\bm\.?o\.?i\b\.?/gi, 'MOI')
      .replace(/\bwaivers?\b/gi, (w) => (w.toLowerCase() === 'waivers' ? 'Waivers' : 'Waiver'))
      .replace(/\bduolingo\b/gi, 'Duolingo')
      // Shouting inside a normal line ("FREE", "NOT ACCEPTED FOR HEALTH") in normal case; abbreviations ("IFP", "UKVI") stay.
      .replace(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b|\b(?:FREE|NOT|ONLY|BUT|ALL|NEW|OPEN|HOLD|ALSO|MUST|NOTE|PLEASE)\b/g, (run, at) => {
        const out = run.split(/(\s+)/).map((w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase())).join('');
        return at === 0 ? out.charAt(0).toUpperCase() + out.slice(1) : out;
      })
      // "English Waiver: English Waiver if ..." says its label once; "Duolingo:100/100" gets its space.
      .replace(/^((?:[-*•]\s+)?)([A-Za-z][A-Za-z ]{2,30}):\s*\2\b\s*/i, '$1$2 ')
      .replace(/([A-Za-z]):(?=\d)/g, '$1: ')
      .replace(/\bfree\b(?=\s+(university|english|duolingo|pvt|test|one))/gi, 'Free')
      // Months and days always start with a capital ("jan 2027" becomes "Jan 2027").
      .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|english|nepal)\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
      .replace(/\s{2,}/g, ' ')).join('\n');
  }
  // Blank lines and repeated lines out; bullets kept as "- ".
  function compact(text) {
    const seen = new Set();
    return lines(tidyTerms(text)).filter((l) => {
      if (!l) return false;
      const k = l.replace(/^[-*•]\s+/, '').toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join('\n');
  }
  // A sentence that only points at the table ("... are in the fees table above.") says nothing on its own.
  const POINTER = /\b(in|see)\s+the\s+(fees\s+)?table\s+above\b|\bare\s+in\s+the\s+table\b|course list is under\b/i;
  const dropPointers = (text) => lines(text).filter((l) => !POINTER.test(l)).join('\n').trim();

  // ---- dates ----
  // A date in a line: "30 October 2026", "27th Nov 2026", "Friday 27 November 2026", "Nov 27, 2026", "2026-11-27", "1st Dec" (the
  // year then comes from the intake: a December date before a January intake is the year before).
  function parseDate(text, intakeName = '') {
    const t = String(text || '');
    let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
    if (m) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), text: m[0] };
    // "12/18/2026" (month first, as some sheets write it) or "18/12/2026" (day first): whichever is a real date, day first if both.
    m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t);
    if (m) {
      const [a, b] = [+m[1], +m[2]];
      const [dd, mm] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) { const date = new Date(Date.UTC(+m[3], mm - 1, dd)); return { date, text: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), raw: m[0] }; }
    }
    let day; let month; let year; let found;
    m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?\b/.exec(t);
    if (m && monthOf(m[2]) >= 0) { day = +m[1]; month = monthOf(m[2]); year = m[3] ? +m[3] : null; found = m[0]; }
    if (found === undefined) {
      m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?\b/.exec(t);
      if (m && monthOf(m[1]) >= 0) { day = +m[2]; month = monthOf(m[1]); year = m[3] ? +m[3] : null; found = m[0]; }
    }
    if (found === undefined || day < 1 || day > 31) return null;
    if (year === null) {
      const im = /([A-Za-z]{3,9})\s+(\d{4})/.exec(intakeName);
      if (!im || monthOf(im[1]) < 0) return null;
      const iMonth = monthOf(im[1]);
      year = +im[2] - (month > iMonth + 2 ? 1 : 0);
    }
    return { date: new Date(Date.UTC(year, month, day)), text: found };
  }
  const DATE_WORDS = /deadline|apply by|application|deposit|cas\b|visa|interview|arrival|arrive|start|enrol|booking|payment|offer|close|open/i;
  // "CAS submission deadline: 27 November 2026" as { label: 'CAS submission deadline', when: '27 November 2026', date }.
  function dateLine(line, intakeName) {
    const l = String(line || '').replace(/^[\s•*-]+/, '').trim();
    const d = parseDate(l, intakeName);
    if (!d) return null;
    let label = l.replace(d.raw || d.text, '').replace(/[\s:,(\u2013-]+$/, '').replace(/^[\s:,\u2013-]+/, '').replace(/\s*[-:]\s*$/, '').trim();
    label = label.replace(/^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s*)$/i, '').replace(/[\s.:;,(]+$/, '').replace(/\s+(?:on|by)$/i, '').trim();
    // A long sentence that holds a date ("£500 off if the fee is paid by ...") is a note, not a date; nor is the day a page was checked.
    if (label.length > 70 || /\bchecked\b/i.test(label)) return null;
    return { label: tidyTerms(label) || 'Date', when: d.text.replace(/,$/, ''), date: d.date };
  }
  // A line with several dates ("IY1: starts 11 Jan 2027, ends 24 Aug 2029, standard CAS request by 17 Dec 2026") as one date each,
  // named after what comes before the colon ("IY1, standard CAS request"); when a course ends is not a deadline and is left out.
  function datesOf(line, intakeName) {
    const l = String(line || '').replace(/^[\s•*-]+/, '').trim();
    const colon = l.indexOf(':');
    const who = colon > 0 && colon < 70 && !parseDate(l.slice(0, colon), intakeName) ? l.slice(0, colon).trim() : '';
    const parts = (who ? l.slice(colon + 1) : l).split(/,\s+(?=[a-z])|;\s*/i).map((x) => x.trim()).filter((x) => parseDate(x, intakeName));
    if (parts.length < 2) { const d = dateLine(l, intakeName); return d ? [d] : []; }
    return parts.filter((x) => !/\bends?\b|university starts/i.test(x)).map((x) => { const d = dateLine(x, intakeName); return d && { ...d, label: who ? `${tidyTerms(who)}, ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}` : d.label }; }).filter(Boolean);
  }
  const isDateNote = (line, intakeName) => DATE_WORDS.test(line) && datesOf(line, intakeName).length > 0;
  // Lines of a note that are dates go to the deadlines; the rest stays (a "## Key dates" heading left with nothing under it goes).
  function splitDates(text, intakeName) {
    const dates = []; const rest = [];
    lines(text).forEach((l) => { if (isDateNote(l, intakeName)) dates.push(...datesOf(l, intakeName)); else rest.push(l); });
    // A heading with nothing under it before the next heading (its dates have moved) goes too.
    const kept = rest.filter((l, i) => {
      if (!/^##\s+/.test(l)) return true;
      const next = rest.slice(i + 1).find((x) => x);
      return next !== undefined && !/^##\s+/.test(next);
    });
    return { dates, rest: kept.join('\n').trim() };
  }
  // Days from today to a date (negative once past), by the calendar day.
  function daysLeft(date, now = new Date()) {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((date.getTime() - today) / 86400000);
  }

  // ---- courses ----
  // A course list as it is typed: "## Group" headings and one course per line (bullets or not).
  function parseCourseText(text) {
    const out = []; let group = '';
    lines(text).forEach((l) => {
      if (!l || POINTER.test(l)) return;
      const h = /^##\s+(.*)$/.exec(l);
      if (h) { group = h[1].trim(); return; }
      const name = l.replace(/^[-*•]\s+/, '').trim();
      if (name && !/:$/.test(name)) out.push({ course: name, group });
    });
    return out;
  }
  // A heading such as "Undergraduate - London" or "IY1/3 years courses" as its level, for grouping.
  function levelGroup(group) {
    const g = String(group || '');
    if (/pre[- ]?master/i.test(g)) return 'Pre-Masters';
    if (/foundation/i.test(g)) return 'Foundation';
    if (/year one|iy1|iyo|integrated year/i.test(g)) return 'International Year One';
    if (/top[- ]?up/i.test(g)) return 'Top-up';
    if (/postgrad|master|\bpg\b|mba|msc/i.test(g)) return 'Postgraduate';
    if (/undergrad|bachelor|\bug\b/i.test(g)) return 'Undergraduate';
    return g.replace(/\s*[-\u2013]\s*(london|[A-Z][a-z]+)$/, '').trim() || 'Courses';
  }

  // ---- the page ----
  const STARTER_STEPS = ['Application submitted', 'Offer letter received', 'Pre-CAS interview', 'Tuition deposit paid', 'CAS issued', 'Visa application'];
  const COLUMNS = [['academic', 'Entry requirements'], ['english', 'English'], ['tuition', 'Tuition fee'], ['scholarship', 'Scholarship'], ['deposit', 'Deposit']];

  // Lines about where a figure came from or that it was checked ("Checked on the official website on ...", "Source: ...", "(here
  // 2.5+)") are for whoever typed the page, not for the team reading it.
  const SOURCE_NOTE = /^(?:[-*•]\s+)?(?:checked on\b|sources?\s*:|taken from\b|to confirm with\b|this page keeps\b|added on\b)|\(here\b|not checked against/i;
  const noSources = (text) => lines(text).filter((l) => !SOURCE_NOTE.test(l)).join('\n');
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // An intake's "apply by" as it is written: a date ("4 December 2026"), "Application deadline: 4 December 2026", "Closed", or a date
  // of something else ("Standard CAS request by 17 Dec 2026", then listed with the other dates, not as "Apply by").
  function applyByOf(text, intakeName) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (/^closed\b/i.test(t)) return { closed: true, when: 'Closed', note: tidyTerms(t.replace(/^closed[\s:.,-]*/i, '')) };
    const d = parseDate(t, intakeName);
    if (!d) return { when: tidyTerms(t), date: null };
    const before = t.slice(0, t.indexOf(d.raw || d.text)).replace(/[\s:,-]+$/, '').trim();
    const after = t.slice(t.indexOf(d.raw || d.text) + (d.raw || d.text).length).replace(/^[\s:,.-]+/, '').replace(/^\((.*)\)\.?$/, '$1').trim();
    if (before && !/apply|application|deadline/i.test(before)) return { other: { label: tidyTerms(before.replace(/\s+(?:by|on)$/i, '')), when: d.text, date: d.date } };
    return { when: d.text, date: d.date, note: tidyTerms(after) };
  }

  function present(u, { now = new Date() } = {}) {
    const intakes = u.intakes || [];
    // Deadlines: each intake's "apply by", its key dates, and the dates found in its notes and requirements (and, with one intake, the
    // page's notes), each date once, soonest first.
    let pageNotes = noSources(u.notes);
    const deadlines = intakes.map((i) => {
      const fromNotes = splitDates(noSources(i.notes), i.name);
      const fromReq = splitDates(noSources(i.requirements), i.name);
      const listed = lines(i.deadlines).filter(Boolean).flatMap((l) => { const ds = datesOf(l, i.name); return ds.length ? ds : [{ label: tidyTerms(l.replace(/^[\s•*-]+/, '')), when: '', date: null }]; });
      let all = [...listed, ...fromNotes.dates, ...fromReq.dates];
      if (intakes.length === 1) { const p = splitDates(pageNotes, i.name); all = [...all, ...p.dates]; pageNotes = p.rest; }
      let main = applyByOf(i.deadline, i.name);
      if (main && main.other) { all.push(main.other); main = null; }
      // The same thing on the same day for several levels ("IY1, standard CAS request" and "Postgraduate, standard CAS request" on
      // 17 Dec) is one line ("Standard CAS request"); the same date said twice is shown once.
      const what = (d) => norm(d.label.includes(', ') ? d.label.slice(d.label.lastIndexOf(', ') + 2) : d.label).replace(/\b(deadline|date|course|the|for|intake|by)\b|\s/g, '');
      const groups = new Map();
      all.filter((d) => d && (d.label || d.when) && !(/^(open|opens|applications? open|open for)/i.test(d.label) && !d.date)).forEach((d) => {
        const k = d.date ? `${d.date.toISOString().slice(0, 10)}|${what(d)}` : norm(d.label);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(d);
      });
      const dates = [...groups.values()].map((g) => {
        if (g.length === 1) return g[0];
        const plain = g[0].label.includes(', ') ? g[0].label.slice(g[0].label.lastIndexOf(', ') + 2) : g[0].label;
        return { ...g[0], label: plain.charAt(0).toUpperCase() + plain.slice(1) };
      }).sort((a, b) => (a.date && b.date ? a.date - b.date : a.date ? -1 : b.date ? 1 : 0));
      // With no "apply by" written, the first application deadline among the dates is the one.
      if (!main) { const first = dates.find((d) => /application|apply/i.test(d.label) && d.date); if (first) main = { when: first.when, date: first.date }; }
      const rest = dates.filter((d) => !(main && main.date && d.date && d.date.getTime() === main.date.getTime() && /application|apply|deadline/i.test(d.label)));
      return {
        id: i.id, name: i.name,
        applyBy: main ? { when: main.when, days: main.date ? daysLeft(main.date, now) : null, closed: Boolean(main.closed), note: main.note || '' } : null,
        dates: rest.map((d) => ({ label: d.label, when: d.when, days: d.date ? daysLeft(d.date, now) : null })),
        notes: compact(fromNotes.rest.split('\n').filter((l) => !/^(?:[-*•]\s+)?closed\b/i.test(l)).join('\n')),
        requirements: compact(dropPointers(fromReq.rest)),
        edited: i.editedAt ? { by: i.editedBy || '', at: i.editedAt } : null,
      };
    });

    // The table: one row per level, a column only when some level has it.
    const programs = (u.programs || []).map((p) => {
      const row = { name: tidyTerms(p.name).replace(/\s*\(pathway\)\s*$/i, ''), duration: p.duration || '' };
      COLUMNS.forEach(([k]) => { row[k] = compact(p[k]); });
      return row;
    });
    const columns = COLUMNS.filter(([k]) => programs.some((p) => has(p[k])));
    const inTable = norm(programs.map((p) => COLUMNS.map(([k]) => p[k]).join(' ')).join(' '));

    // English lines written in the notes ("English Waiver: ...") belong with the English, not the notes.
    const englishNotes = []; const otherNotes = [];
    lines(pageNotes).forEach((l) => { if (/^(?:[-*•]\s+)?english\b/i.test(l)) englishNotes.push(l); else otherNotes.push(l); });
    pageNotes = otherNotes.join('\n');

    // What the table does not already say: a line the table holds word for word is not said again.
    // "Undergraduate: possible" under "English Waiver" says less than the table's English column, which gives the Waiver rules.
    const waiverInTable = /waiver/.test(inTable);
    const notInTable = (t) => lines(t).filter((l) => !(programs.length && l && !/^##\s/.test(l) && (inTable.includes(norm(l.replace(/^[-*•]\s+/, ''))) || (waiverInTable && /^(?:[-*•]\s+)?[\w\s'-]{2,40}:\s*(possible|accepted|available|yes)\.?$/i.test(l))))).join('\n');
    const more = [
      ['Entry requirements', compact(notInTable(dropPointers(noSources(u.entryRequirements))))],
      ['English', compact(notInTable([dropPointers(noSources(u.languageTests)), ...englishNotes].join('\n')))],
    ].map(([k, t]) => [k, lines(t).filter((l, i, arr) => !(/^##\s/.test(l) && (!arr[i + 1] || /^##\s/.test(arr[i + 1])))).join('\n')]).filter(([, t]) => has(t));

    // Courses: the page's list and every intake's, once each, with the intakes it runs in when they differ.
    const byKey = new Map();
    const addCourses = (text, intake) => parseCourseText(text).forEach((c) => {
      const k = c.course.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, { course: c.course, group: levelGroup(c.group), intakes: new Set() });
      if (intake) byKey.get(k).intakes.add(intake);
    });
    addCourses(u.courses, '');
    const listed = intakes.filter((i) => parseCourseText(i.courses).length);
    listed.forEach((i) => addCourses(i.courses, i.name));
    const general = parseCourseText(u.courses).length > 0;
    const showIntakes = listed.length > 1 || (general && listed.length === 1);
    let courses = [...byKey.values()].map((c) => ({ course: c.course, group: c.group, intakes: showIntakes ? [...c.intakes] : [] }));
    // The campus written after every course ("MBA (London)") when it is the same for all of them is said once, by the city.
    const campusOf = (c) => (/\(([^()]+)\)\s*$/.exec(c.course) || [])[1] || '';
    const campus = courses.length > 1 ? campusOf(courses[0]) : '';
    if (campus && !/\d|ielts|level|top|hons|mba|msc|ma\b/i.test(campus) && courses.every((c) => campusOf(c) === campus)) {
      courses = courses.map((c) => ({ ...c, course: c.course.replace(/\s*\([^()]+\)\s*$/, ''), full: c.course }));
    }
    const order = ['Foundation', 'International Year One', 'Undergraduate', 'Top-up', 'Pre-Masters', 'Postgraduate'];
    const groups = [...new Set(courses.map((c) => c.group))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

    // The overview and location without lines that repeat another section: "Intake: January 2027" (the deadlines), "Levels: ..."
    // and "Tuition: ..." (the table), "Campuses: London." (the city or the location).
    const location = compact(noSources(lines(u.location).filter((l) => norm(l) !== norm(u.city)).join('\n'))
      .split('\n').filter((l) => !/^(?:[-*•]\s+)?campus(?:es)?\s*:\s*/i.test(l) || norm(l.replace(/^.*?:/, '')) !== norm(u.city)).join('\n'));
    const said = norm([u.city, location, ...intakes.map((i) => i.name), ...programs.map((p) => p.name)].join(' '));
    const tableSays = programs.length > 0 || more.length > 0;
    const repeats = (l) => {
      const m = /^(intakes?|levels?|campus(?:es)?|locations?(?: and campuses)?|city|entry|english|gap|study gap|tuition|fees?|scholarships?|deposit)\s*:\s*(.*)$/i.exec(l.replace(/^[-*•]\s+/, ''));
      if (!m) return false;
      if (/^(intakes?)$/i.test(m[1])) return /closed/i.test(m[2]) || norm(m[2]).split(' ').filter((w) => w && !/^(and|entry|undergraduate|postgraduate)$/.test(w)).every((w) => said.includes(w));
      if (/^(entry|english|gap|study gap|tuition|fees?|scholarships?|deposit|levels?)$/i.test(m[1])) return tableSays;
      return norm(m[2]).split(' ').filter((w) => w && w !== 'and').every((w) => said.includes(w));
    };
    const overview = compact(noSources(lines(u.overview).filter((l) => !repeats(l)).join('\n')));
    // The steps without the dates (they are at the top); the empty starting steps are not shown.
    const process = (u.process || []).filter((st) => has(st.title)).map((st) => ({ title: tidyTerms(st.title), detail: compact(splitDates(noSources(st.detail), intakes[0] ? intakes[0].name : '').rest) }));
    const starterOnly = process.every((st, i) => !has(st.detail) && st.title === STARTER_STEPS[i]) || process.every((st) => !has(st.detail) && STARTER_STEPS.includes(st.title));

    // Nothing said twice across sections (the owner, 17 Nov 2026): in the order the page shows them, a line that says what an earlier
    // one already said (the same figures about the same thing: "Early bird discount: £500" and "£500 early bird discount") is left out,
    // and a heading left with nothing under it goes too.
    const seen = [];
    const fingerprint = (line, heading) => {
      const t = `${heading} ${line}`.toLowerCase();
      return { line: norm(line), nums: (t.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).sort().join(' '), words: new Set((t.match(/[a-z]{5,}/g) || []).filter((w) => !/^(about|after|their|there|which|would|these|those|every|other|where|while)$/.test(w))) };
    };
    // The same line, or the same figures about the same thing, or figures already all said in one line with two of its words
    // ("IELTS Waiver: B or 75% in Grade 12" inside the table's "IELTS 6.0/5.5 or PTE 56/51. IELTS Waiver: B or 75% in Grade 12.").
    const within = (f, x) => { if (!f.nums) return false; const xs = x.nums.split(' '); return f.nums.split(' ').every((n) => xs.includes(n)) && [...f.words].filter((w) => x.words.has(w)).length >= Math.min(2, f.words.size); };
    const said2 = (f) => seen.some((x) => (f.line && x.line === f.line) || (f.nums && x.nums === f.nums && [...f.words].some((w) => x.words.has(w))) || within(f, x));
    const once = (text) => {
      let heading = '';
      const out = lines(text).filter((l) => {
        const h = /^##\s+(.*)$/.exec(l);
        if (h) { heading = h[1]; return true; }
        if (!l) return false;
        const f = fingerprint(l.replace(/^[-*•]\s+/, ''), heading);
        if (said2(f)) return false;
        seen.push(f);
        return true;
      });
      return out.filter((l, i) => !(/^##\s/.test(l) && (!out[i + 1] || /^##\s/.test(out[i + 1])))).join('\n');
    };
    programs.forEach((p) => COLUMNS.forEach(([k]) => lines(p[k]).forEach((l) => l && seen.push(fingerprint(l.replace(/^[-*•]\s+/, ''), p.name)))));
    const moreOnce = more.map(([k, t]) => [k, once(t)]).filter(([, t]) => has(t));
    deadlines.forEach((d) => { d.requirements = once(d.requirements); d.notes = once(d.notes); });
    const overviewOnce = once(overview);
    const processOnce = (starterOnly ? [] : process).map((st) => ({ ...st, detail: once(st.detail) }));
    const interviewOnce = once(compact(noSources(u.interview)));
    const locationOnce = once(location);
    const notesOnce = once(compact(pageNotes));

    return {
      name: u.name, city: u.city || '', website: u.website || '',
      deadlines: deadlines.filter((d) => d.applyBy || d.dates.length || d.requirements || d.notes),
      intakeNames: intakes.map((i) => i.name),
      programs, columns, more: moreOnce, courses, groups, overview: overviewOnce, location: locationOnce,
      process: processOnce, interview: interviewOnce, notes: notesOnce,
      updatedAt: u.updatedAt || '',
    };
  }

  return { present, tidyTerms, calmCaps, parseDate, dateLine, splitDates, daysLeft, parseCourseText, levelGroup, compact };
}));
