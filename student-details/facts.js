// Universities: one page of facts per university (entry requirements, language test, courses, location,
// intakes and the application process) that every team can read and Admin edits. Kept in fact-file.json
// in the data folder, written whole and atomically (it is small), with a one-time starting list.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('../shared/server-utils');
const { UWL_DETAILS } = require('./fact-seed-uwl');
const { YSJU_DETAILS } = require('./fact-seed-ysju');
const { BANGOR_DETAILS } = require('./fact-seed-bangor');
// The January 2027 intake sheet: each university's criteria, fees, courses and key dates (see fact-seed-sheet.json).
const SHEET = require('./fact-seed-sheet.json');
// The November 2026 and January 2027 requirement sheets of the Oxford International Education Group (Oxford Direct and
// Pathways), read by seed-tools/build_oieg_seed.py. Added to the pages without overwriting anything (see fact-merge.js).
const OIEG = require('./fact-seed-oieg.json');
const { mergeEntry, newReport, unifyCourses, dedupeCourses } = require('./fact-merge');
// Each university's page as its partner gives it for the January 2027 intake (the owner, 20 Nov 2026): logo, pictures and video, the
// requirements per level, the January 2027 courses only, the deadlines and the documents. Read from the partner the university is
// applied through (Real Dreams through Route2Uni, Adventus or Apply Board; the pictures and video from Apply Board's school page) by
// seed-tools on 20 Nov 2026. Put on the matching page once per version, or a page of its own when Universities has none.
const PARTNERS = require('./fact-seed-partners.json');

// The hand-written pages (from each university's own fact file or flyer). The January 2027 sheet adds an intake to them.
const HAND_DETAILS = { 'university of west london': UWL_DETAILS, 'york st john university': YSJU_DETAILS, 'bangor university': BANGOR_DETAILS };

// Universities that start with their details filled in (matched by name, ignoring case). Where there is a hand-written
// page the sheet only adds its January 2027 intake; every other university takes the whole page from the sheet.
const STARTER_DETAILS = {};
Object.keys(SHEET).forEach((key) => {
  const entry = SHEET[key];
  const hand = HAND_DETAILS[key];
  STARTER_DETAILS[key] = hand ? { ...hand, intakes: [...hand.intakes, ...entry.intakes] } : entry;
});
Object.keys(HAND_DETAILS).forEach((key) => { if (!STARTER_DETAILS[key]) STARTER_DETAILS[key] = HAND_DETAILS[key]; });

// The pages that were written from the university's own fact file already hold the requirements of the January sheet in
// their fees table, so the sheet's repeated requirement blocks are not shown a second time under the intakes.
const REQUIREMENTS_IN_TABLE = new Set(['university of west london', 'york st john university']);
REQUIREMENTS_IN_TABLE.forEach((key) => {
  if (STARTER_DETAILS[key]) STARTER_DETAILS[key] = { ...STARTER_DETAILS[key], intakes: STARTER_DETAILS[key].intakes.map((i) => ({ ...i, requirements: '' })) };
});

// A course listed twice on a page is kept once.
Object.keys(STARTER_DETAILS).forEach((key) => { STARTER_DETAILS[key] = dedupeCourses(JSON.parse(JSON.stringify(STARTER_DETAILS[key]))); });
// A page that kept a course list for each intake shows its courses once, under the levels (see unifyCourses).
['university of west london'].forEach((key) => { if (STARTER_DETAILS[key]) STARTER_DETAILS[key] = unifyCourses(JSON.parse(JSON.stringify(STARTER_DETAILS[key]))); });

// What the OIEG sheets add to each page. A university that is not in Universities yet gets a page of its own.
const OIEG_REPORT = newReport();
// Differences between a page and a sheet that the owner has decided (5 November 2026). The two Excel sheets he gave are the
// updated ones, so a sheet figure wins unless he chose the page figure.
const DECIDED = [
  ['University of Roehampton / Postgraduate', 'deposit', 'Kept the CAS deposit of £8,500.'],
  ['University of Ravensbourne / Postgraduate', 'english', 'Kept IELTS 6.5 overall for postgraduate.'],
  ['University of Ravensbourne / Postgraduate', 'tuition', 'Kept the MBA fee of £19,500.'],
  ['Winchester University / Undergraduate', 'gap', 'Kept the gap of 9 years.'],
];
OIEG_REPORT.decided = [];
Object.keys(OIEG).forEach((key) => {
  const entry = OIEG[key];
  const base = STARTER_DETAILS[key] ? JSON.parse(JSON.stringify(STARTER_DETAILS[key])) : { name: entry.name, city: entry.city || '', programs: [], intakes: [] };
  if (!base.name) base.name = entry.name;
  mergeEntry(base, entry, OIEG_REPORT);
  STARTER_DETAILS[key] = base;
});
OIEG_REPORT.conflicts = OIEG_REPORT.conflicts.filter((c) => {
  const hit = DECIDED.find(([where, field]) => where === c.where && field === c.field);
  if (hit) OIEG_REPORT.decided.push({ ...c, decision: hit[2] });
  return !hit;
});

// Names the list starts with: the first six were there before the sheet, the rest are added once to an existing list.
const ORIGINAL_STARTERS = ['University of West London', 'Bangor University', 'University of Roehampton', 'University of East London', 'University of York'];
const FIRST_ADDITION = 'York St John University';
const STARTER_UNIVERSITIES = [...ORIGINAL_STARTERS, FIRST_ADDITION];
Object.keys(SHEET).forEach((key) => { const n = SHEET[key].name; if (!STARTER_UNIVERSITIES.some((x) => x.toLowerCase() === key)) STARTER_UNIVERSITIES.push(n); });
Object.keys(OIEG).forEach((key) => { if (OIEG[key].isNew && !STARTER_UNIVERSITIES.some((x) => x.toLowerCase() === key)) STARTER_UNIVERSITIES.push(OIEG[key].name); });

// The usual steps for a student, as a starting point for each new university to adjust.
const STARTER_STEPS = [
  'Application submitted', 'Offer letter received', 'Pre-CAS interview', 'Tuition deposit paid', 'CAS issued', 'Visa application',
];

const LIMITS = { name: 120, short: 300, text: 12000, items: 300, intakes: 12, steps: 30, programs: 12 };

const str = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '');
const newId = () => crypto.randomBytes(6).toString('hex');

// What is kept for a university, whatever was sent: only the known fields, as text, within limits.
function clean(input, old = {}) {
  const intakes = (Array.isArray(input.intakes) ? input.intakes : []).slice(0, LIMITS.intakes).map((i) => ({
    id: /^[a-f0-9]{12}$/.test(i && i.id) ? i.id : newId(),
    name: str(i && i.name, LIMITS.short).trim(),
    deadline: str(i && i.deadline, LIMITS.short).trim(),
    requirements: str(i && i.requirements, LIMITS.text),
    courses: str(i && i.courses, LIMITS.text),
    notes: str(i && i.notes, LIMITS.text),
    // Every date of the intake as the partner portal writes them (application, deposit, CAS, visa), shown on the page.
    deadlines: str(i && i.deadlines, LIMITS.text),
    // The team may correct the dates (the owner, 17 Nov 2026: the only thing the team edits). Who did and when, and the dates the
    // automatic reading last gave, so a reading keeps the team's dates until the source itself changes them (mergeIntakeDates).
    editedBy: str(i && i.editedBy, 80), editedAt: str(i && i.editedAt, 40),
    ...(i && typeof i.autoDeadline === 'string' ? { autoDeadline: str(i.autoDeadline, LIMITS.short), autoDeadlines: str(i.autoDeadlines, LIMITS.text) } : {}),
  })).filter((i) => i.name);
  const process = (Array.isArray(input.process) ? input.process : []).slice(0, LIMITS.steps).map((s) => ({
    title: str(s && s.title, LIMITS.short).trim(),
    detail: str(s && s.detail, LIMITS.text),
  })).filter((s) => s.title);
  // The fees table: one row per course level (UG, PG, ...), each cell plain text.
  const programs = (Array.isArray(input.programs) ? input.programs : []).slice(0, LIMITS.programs).map((p) => ({
    name: str(p && p.name, LIMITS.short).trim(),
    duration: str(p && p.duration, LIMITS.short).trim(),
    academic: str(p && p.academic, LIMITS.text),
    english: str(p && p.english, LIMITS.text),
    tuition: str(p && p.tuition, LIMITS.text),
    scholarship: str(p && p.scholarship, LIMITS.text),
    deposit: str(p && p.deposit, LIMITS.text),
  })).filter((p) => p.name);
  return {
    id: old.id,
    name: str(input.name, LIMITS.name).trim() || old.name || '',
    city: str(input.city, LIMITS.short).trim(),
    location: str(input.location, LIMITS.text),
    overview: str(input.overview, LIMITS.text),
    website: str(input.website, LIMITS.short).trim(),
    entryRequirements: str(input.entryRequirements, LIMITS.text),
    languageTests: str(input.languageTests, LIMITS.text),
    courses: str(input.courses, LIMITS.text),
    interview: str(input.interview, LIMITS.text),
    notes: str(input.notes, LIMITS.text),
    programs,
    intakes,
    process,
    // Kept automatically (the Navitas toolkit; pages read from the Route2Uni portal before it was removed on 17 Nov 2026 keep theirs): where the page's figures came from and when, and the
    // rules in numbers for the eligibility finder (eligibility.js). A save from the page keeps them as they are.
    source: input.source !== undefined ? cleanSource(input.source) : (old.source || null),
    rules: input.rules !== undefined ? cleanRules(input.rules) : (old.rules || []),
    // The partner's page for January 2027 (fact-seed-partners.json); a save from the page keeps it as it is.
    profile: input.profile !== undefined ? cleanProfile(input.profile) : (old.profile || null),
  };
}
const LEVEL_ORDER = require('./fact-present').LEVEL_ORDER;
const url = (v) => (/^https:\/\/[^\s"'<>]+$/.test(String(v || '')) ? String(v).slice(0, 600) : '');
// A logo can also be a small picture kept in the page itself (data:image/..., at most about 200 KB).
const logoUrl = (v) => (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(v || '')) && String(v).length < 280000 ? String(v) : url(v));
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const t = (v, max = LIMITS.short) => str(v == null ? '' : String(v), max).trim();
  const lines = (a, n, max) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => t(x, max)).filter(Boolean);
  return {
    type: p.type === 'college' ? 'college' : 'university',
    // own: the courses, requirements and dates are the page's own (a direct route, or nothing for January 2027 at the partner); the
    // profile then gives only the pictures, the video, the logo and the short about.
    own: Boolean(p.own), intake: t(p.intake, 60) || 'January 2027',
    // Which partner record the courses come from, read again every Thursday (partner-refresh.js), and when they were last read.
    key: t(p.key, 160), source: cleanSource2(p.source), readAt: t(p.readAt, 40),
    logo: logoUrl(p.logo), banner: url(p.banner), photos: (Array.isArray(p.photos) ? p.photos : []).map(url).filter(Boolean).slice(0, 8),
    video: /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{6,20}/.test(String(p.video || '')) ? url(p.video) : '',
    about: t(p.about, 2000), keyPoints: lines(p.keyPoints, 8, 160), website: url(p.website) || t(p.website, 300), city: t(p.city),
    deadlines: lines(p.deadlines, 14, 400),
    levels: (Array.isArray(p.levels) ? p.levels : []).slice(0, 8).map((L) => ({
      level: LEVEL_ORDER.includes(L && L.level) ? L.level : 'Other courses',
      academic: t(L && L.academic, 2000), english: t(L && L.english, 2000), tuition: t(L && L.tuition, 1000), scholarship: t(L && L.scholarship, 1000), extra: t(L && L.extra, 1000),
    })),
    courses: (Array.isArray(p.courses) ? p.courses : []).slice(0, 1200).map((c) => ({
      name: t(c && c.name, 300), level: LEVEL_ORDER.includes(c && c.level) ? c.level : 'Other courses', start: t(c && c.start, 40), deadline: t(c && c.deadline, 40),
      fee: t(c && c.fee, 80), duration: t(c && c.duration, 60), campus: t(c && c.campus, 200),
    })).filter((c) => c.name),
  };
}
function cleanSource2(v) {
  if (!v || typeof v !== 'object' || !['Real Dreams', 'Adventus', 'Apply Board'].includes(v.partner)) return null;
  const out = { partner: v.partner };
  if (Number.isInteger(v.r2u)) out.r2u = v.r2u;
  if (Array.isArray(v.adv)) out.adv = v.adv.slice(0, 10).filter((a) => a && Number.isInteger(a.id)).map((a) => ({ id: a.id, name: str(a.name, 200), institution_address: a.institution_address && typeof a.institution_address === 'object' ? { city: str(a.institution_address.city, 80), country_name: str(a.institution_address.country_name, 120), country_id: Number(a.institution_address.country_id) || 247 } : { country_id: 247 }, is_drive_member: Boolean(a.is_drive_member) }));
  return out;
}
// The page a partner profile belongs to: the same name (ignoring "the", "of", "university", brackets and punctuation), or a name the
// Universities writes differently (a university is never matched to its international college: "college" and "international" count).
const PROFILE_ALIASES = {
  'health sciences university': 'Health Science University', 'regent college': 'Regent College London', 'roehampton university': 'University of Roehampton',
  'ravensbourne university': 'University of Ravensbourne', 'university of winchester': 'Winchester University', 'university of the west of scotland': 'University of West of Scotland',
  'ulster university london, birmingham and manchester (qa)': 'Ulster University', 'northumbria university (newcastle)': 'Northumbria University',
  'anglia ruskin university college (aruc)': 'Anglia Ruskin University College (ARU College)', 'aston university oncampus centre': 'Aston University - OnCampus (UG ICAS)',
  'brunel university london pathway college': 'Brunel University London Pathway College (BPC)', 'international college dundee (icd), university of dundee': 'International College of Dundee (ICD)-Scotland',
  'international college at robert gordon university (icrgu)': 'International College Robert Gordon University (ICRGU)', 'keele university international college': 'Keele University International College (KUIC)',
  'london south bank university oncampus centre': 'London South Bank University - OnCampus (UG ICAS)', 'university of hull oncampus centre': 'University of Hull - OnCampus (UG ICAS)',
};
const coreName = (n) => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !['the', 'of', 'university', 'at'].includes(w)).join('');
function pageFor(universities, name) {
  const alias = PROFILE_ALIASES[String(name).toLowerCase()];
  if (alias) { const hit = universities.find((u) => u.name.toLowerCase() === alias.toLowerCase()); if (hit) return hit; }
  const exact = universities.find((u) => u.name.toLowerCase() === String(name).toLowerCase());
  if (exact) return exact;
  const key = coreName(name);
  return key ? universities.find((u) => coreName(u.name) === key) || null : null;
}
// Where the page's figures come from: the Navitas product toolkit (navitas-toolkit.js), or the Route2Uni portal for a page read before it was removed (17 Nov 2026).
function cleanSource(v) {
  if (!v || typeof v !== 'object' || !(v.route2uni || v.navitas)) return null;
  const at = (x) => (/^\d{4}-\d{2}-\d{2}T/.test(String(x)) ? String(x) : '');
  const out = {};
  if (v.route2uni) out.route2uni = { id: Number(v.route2uni.id) || 0, at: at(v.route2uni.at) };
  if (v.navitas) out.navitas = { at: at(v.navitas.at) };
  return out;
}
function cleanRules(list) {
  const n = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
  return (Array.isArray(list) ? list : []).slice(0, 12).map((L) => ({
    level: str(L && L.level, LIMITS.short).trim(),
    minGpa: n(L && L.minGpa), minPercent: n(L && L.minPercent), gap: n(L && L.gap), gapText: str(L && L.gapText, LIMITS.short),
    tests: Object.fromEntries(Object.entries((L && L.tests) || {}).filter(([k, v]) => /^[A-Z]{2,15}$/.test(k) && n(v) !== null).slice(0, 12).map(([k, v]) => [k, n(v)])),
    bands: Object.fromEntries(Object.entries((L && L.bands) || {}).filter(([k, v]) => /^[A-Z]{2,15}$/.test(k) && n(v) !== null).slice(0, 12).map(([k, v]) => [k, n(v)])),
    waiver: Boolean(L && L.waiver), waiverRules: (Array.isArray(L && L.waiverRules) ? L.waiverRules : []).slice(0, 20).map((x) => str(x, 400)).filter(Boolean),
  })).filter((L) => L.level);
}

// An intake as an automatic reading gives it (`fresh`), over what the page has (`was`): the reading's dates, unless the team changed
// the dates since and the reading still gives what it gave then (its source has not changed them).
function mergeIntakeDates(was = {}, fresh = {}) {
  const auto = { autoDeadline: fresh.deadline || '', autoDeadlines: fresh.deadlines || '' };
  const teamKept = was.editedAt && (was.autoDeadline === undefined || (was.autoDeadline === auto.autoDeadline && was.autoDeadlines === auto.autoDeadlines));
  if (teamKept) return { ...was, ...fresh, deadline: was.deadline || '', deadlines: was.deadlines || '', editedBy: was.editedBy, editedAt: was.editedAt, ...auto };
  return { ...was, ...fresh, editedBy: '', editedAt: '', ...auto };
}

const startKey = (name) => String(name || '').trim().toLowerCase();
const hasStarter = (name) => Object.prototype.hasOwnProperty.call(STARTER_DETAILS, startKey(name));
// A page nobody has filled in yet (only its name and the starter steps).
const isBlank = (u) => !(u.city || u.website || u.overview || u.entryRequirements || u.languageTests || u.courses || u.interview || u.notes || u.location
  || (u.programs && u.programs.length) || (u.intakes && u.intakes.length)
  || (u.process || []).some((s, i) => s.detail || s.title !== STARTER_STEPS[i]) || (u.process || []).length > STARTER_STEPS.length);
const starterFields = (u) => JSON.stringify([u.city, u.location, u.overview, u.website, u.entryRequirements, u.languageTests, u.courses, u.interview, u.notes, u.programs || [], u.intakes || [], u.process || []]);
const withStarterDetails = (u) => (hasStarter(u.name) ? { ...u, ...clean({ ...STARTER_DETAILS[startKey(u.name)], name: u.name, website: u.website || STARTER_DETAILS[startKey(u.name)].website || '' }, u) } : u);

// What each card of the list shows at a glance (the owner, 17 Nov 2026: less opening of pages): the next "Apply by" still open, how many
// courses, and whether it is a pathway college. Worked out once per page and day (the stored page object is kept while the file is unchanged).
const FactPresent = require('./fact-present');
const glanceMemo = new WeakMap();
// ARU College (Anglia Ruskin) and The College, Swansea University are pathway colleges too (the owner, 17 Nov 2026).
const PATHWAY = /international college|\bISC\b|oncampus|pathway|\bARU College\b|\bThe College\b|\b(ICD|UKIC|UBIC|UGIC|ENUIC|BUIC|ICAS)\b/i;
function glance(u) {
  const day = new Date().toDateString();
  const hit = glanceMemo.get(u);
  if (hit && hit.day === day) return hit.value;
  let value = { next: null, courseCount: 0 };
  try {
    const view = FactPresent.present(u);
    // Only the January, February and March 2027 intakes count (the owner, 20 Nov 2026).
    const open = view.deadlines.filter((d) => Q1_2027.test(d.name) && d.applyBy && !d.applyBy.closed && typeof d.applyBy.days === 'number' && d.applyBy.days >= 0)
      .sort((a, b) => a.applyBy.days - b.applyBy.days)[0];
    let next = open ? { intake: open.name, when: open.applyBy.when, days: open.applyBy.days } : null;
    // A partner's page: its first "Apply by" date.
    if (u.profile && !u.profile.own) {
      next = null;
      for (const line of u.profile.deadlines || []) {
        const d = FactPresent.parseDate(line);
        if (!d) continue;
        const days = FactPresent.daysLeft(d.date);
        if (days >= 0) { next = { intake: u.profile.intake || 'January 2027', when: d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), days }; break; }
      }
    }
    value = { next, courseCount: view.courses.length };
  } catch (e) { /* the card shows without it */ }
  glanceMemo.set(u, { day, value });
  return value;
}
const Q1_2027 = /\b(jan(uary)?|feb(ruary)?|mar(ch)?)\s*2027\b/i;
// The intakes a card offers: January, February and March 2027 only (the owner, 20 Nov 2026), from a partner's courses or the page's own.
const q1Intakes = (u) => {
  const names = u.profile && !u.profile.own ? u.profile.courses.flatMap((c) => String(c.start || '').split(/,\s*/)) : u.intakes.map((i) => i.name);
  const month = (n) => ['jan', 'feb', 'mar'].indexOf(String(n).trim().slice(0, 3).toLowerCase());
  return [...new Set(names.map((n) => String(n).trim()).filter((n) => Q1_2027.test(n)).map((n) => `${['January', 'February', 'March'][month(n)]} 2027`))].sort((a, b) => month(a) - month(b));
};
const summary = (u) => ({ id: u.id, name: u.name, city: u.city, intakes: q1Intakes(u), updatedAt: u.updatedAt, kind: (u.profile && u.profile.type === 'college') || PATHWAY.test(u.name) ? 'pathway' : 'university', ...glance(u),
  // A page with the partner's January 2027 details counts only those courses, and shows the university's logo on its card.
  ...(u.profile ? { ...(u.profile.own ? {} : { courseCount: u.profile.courses.length, deadline: u.profile.deadlines[0] || '' }), logo: u.profile.logo || '', cover: u.profile.banner || u.profile.photos[0] || '', profileCity: u.profile.city || '' } : {}) });

// Course lines of a page: the course list and each intake's, without the "## " sub-headings.
const courseLines = (u) => (u.profile && !u.profile.own ? u.profile.courses.map((c) => c.name) : [u.courses, ...u.intakes.map((i) => i.courses)])
  .join('\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('##') && !/^The course list is under/.test(l));

// The matching courses of a page, each with its level (the "## " heading above it) and the intake it is listed under, so a course
// can be shortlisted straight from the search (the owner, 17 Nov 2026).
function matchingCourses(u, words) {
  const out = [];
  const seen = new Set();
  const read = (text, intake) => {
    let level = '';
    String(text || '').split('\n').forEach((raw) => {
      const l = raw.trim().replace(/^[-*\u2022]\s+/, '');
      if (!l) return;
      const head = /^##\s+(.*)$/.exec(l);
      if (head) { level = head[1].trim(); return; }
      if (/^The course list is under/.test(l) || /:$/.test(l)) return;
      const t = l.toLowerCase();
      if (!words.every((w) => t.includes(w))) return;
      const key = t;
      if (seen.has(key)) { if (intake) { const was = out.find((c) => c.course.toLowerCase() === key); if (was && !was.intakes.includes(intake)) was.intakes.push(intake); } return; }
      seen.add(key);
      out.push({ course: l, level, intakes: intake ? [intake] : [] });
    });
  };
  // A page with the partner's January 2027 details lists only those courses (the owner, 20 Nov 2026).
  if (u.profile && !u.profile.own) {
    u.profile.courses.forEach((c) => { const t = c.name.toLowerCase(); if (words.every((w) => t.includes(w)) && !seen.has(t)) { seen.add(t); out.push({ course: c.name, level: c.level, intakes: [u.profile.intake] }); } });
    return out;
  }
  read(u.courses, '');
  (u.intakes || []).forEach((i) => read(i.courses, i.name));
  return out;
}

// Universities matching every word typed, by name, city or any course, so "cyber security" finds who
// teaches it. `matches` holds up to four of the courses that matched; `matchCount` is how many.
function searchIn(universities, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return universities.map(summary);
  const hits = [];
  universities.forEach((u) => {
    const head = `${u.name} ${u.city}`.toLowerCase();
    const nameHit = words.every((w) => head.includes(w));
    const lines = courseLines(u).filter((l) => { const t = l.toLowerCase(); return words.every((w) => t.includes(w)); });
    if (nameHit || lines.length) hits.push({ ...summary(u), matches: [...new Set(lines)].slice(0, 4), matchCount: new Set(lines).size, nameHit, courses: matchingCourses(u, words).slice(0, 80) });
  });
  return hits.sort((a, b) => (b.nameHit - a.nameHit) || (b.matchCount - a.matchCount) || a.name.localeCompare(b.name));
}


// The list is ordered by the nearest open deadline, then A to Z (the owner, 20 Nov 2026: no Sort menu).
const byDeadline = (a, b) => (a.next ? a.next.days : 1e6) - (b.next ? b.next.days : 1e6) || a.name.localeCompare(b.name);
const listIn = (universities, q = '') => (String(q).trim() ? searchIn(universities, q) : universities.map(summary).sort(byDeadline));
// Pages saved before the overview and fees table existed come back with those empty.
const getIn = (universities, id) => { const u = universities.find((x) => x.id === id); return u ? { overview: '', programs: [], ...u } : null; };
// Read only list and pages of a given set of universities (a backup), with the same shape and search as the live Universities.
const viewFacts = (universities) => ({ list: (q) => listIn(universities, q), get: (id) => getIn(universities, id) });

function createFacts(dir, { now = () => new Date() } = {}) {
  const file = path.join(dir, 'fact-file.json');

  // The list is kept in memory and only re-read if the file changed on disk, so opening a page doesn't
  // parse (and check) the whole Universities every time.
  let cache = null; // { mtimeMs, size, data }
  function read() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return null; } // first time: start the list
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data.universities)) {
        cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
        return data;
      }
    } catch (e) { /* unreadable: set aside below */ }
    // A damaged file is kept next to the data (not overwritten), then the list starts again.
    try { fs.renameSync(file, path.join(dir, `fact-file.damaged-${now().toISOString().replace(/[:.]/g, '-')}.json`)); } catch (e) { /* ignore */ }
    return null;
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(file, JSON.stringify(data, null, 2));
    const stat = fs.statSync(file);
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
  }
  function load() {
    let data = read();
    if (!data) {
      data = {
        universities: STARTER_UNIVERSITIES.map((name) => ({
          ...withStarterDetails(clean({ name, process: STARTER_STEPS.map((title) => ({ title })) })), id: newId(), updatedAt: now().toISOString(), updatedBy: '',
        })),
        starterAdded: [...STARTER_UNIVERSITIES],
        oiegApplied: true, // a new list is built from the starter details, which already hold the OIEG facts
      };
      // Only an installation that works with these partners (it holds their universities) gets their pages (see applyProfiles).
      applyProfiles(data);
      removeNotPromoted(data);
      write(data);
    } else {
      // A university with starter details is refreshed from them only while nobody has edited its page (still
      // empty, or still exactly as it was seeded). Once Admin saves it, their version is kept.
      let changed = false;
      // Universities added to the starter list after this file was created are added once (not again if Admin deletes them).
      const seen = new Set(data.starterAdded || ORIGINAL_STARTERS);
      STARTER_UNIVERSITIES.filter((n) => !seen.has(n)).forEach((name) => {
        if (!data.universities.some((u) => startKey(u.name) === startKey(name))) {
          data.universities.push({ ...withStarterDetails(clean({ name, process: STARTER_STEPS.map((title) => ({ title })) })), id: newId(), updatedAt: now().toISOString(), updatedBy: '' });
        }
        seen.add(name);
        changed = true;
      });
      data.starterAdded = [...seen];
      // A page an Admin has already saved keeps its text; what the OIEG sheets add is put into it once, and nothing is
      // overwritten (a page nobody has edited is rebuilt from the starter details below, which include the same facts).
      if (!data.oiegApplied) {
        data.universities = data.universities.map((u) => {
          const entry = OIEG[startKey(u.name)];
          if (!u.updatedBy || !entry) return u;
          const copy = JSON.parse(JSON.stringify(u));
          const report = newReport();
          mergeEntry(copy, entry, report);
          if (!report.added.length && !report.addedPrograms.length) return u;
          return { ...copy, updatedAt: now().toISOString() };
        });
        data.oiegApplied = true;
        changed = true;
      }
      if (data.partnersApplied !== PARTNERS.version) { applyProfiles(data); changed = true; }
      if (removeNotPromoted(data)) changed = true;
      data.universities = data.universities.map((u) => {
        if (!hasStarter(u.name) || !(isBlank(u) || !u.updatedBy)) return u;
        const fresh = { ...withStarterDetails(u), id: u.id, updatedAt: u.updatedAt, updatedBy: u.updatedBy || '' };
        if (starterFields(fresh) === starterFields(u)) return u;
        changed = true;
        return { ...fresh, updatedAt: now().toISOString() };
      });
      if (changed) write(data);
    }
    return data;
  }

  // Universities the consultancy does not promote are taken off once (the owner, 20 Nov 2026: Buckinghamshire New University, BNU).
  // Removed once: if Admin adds one back later, it stays.
  function removeNotPromoted(data) {
    const done = data.removedOnce || [];
    if (done.includes('bnu-2026-11-20')) return false;
    data.universities = data.universities.filter((u) => !/^(buckinghamshire new university|bnu)\b/i.test(String(u.name).trim()));
    data.removedOnce = [...done, 'bnu-2026-11-20'];
    return true;
  }
  // The partners' January 2027 pages, once per version: each on its own page (matched by name), or a new page when there is none.
  // Only on an installation whose Universities already holds several of these universities, so another consultancy gets nothing added.
  function applyProfiles(data) {
    const entries = Object.values(PARTNERS.profiles || {});
    const known = entries.filter((p) => pageFor(data.universities, p.name)).length;
    if (known >= 5) {
      entries.forEach((p) => {
        const profile = cleanProfile(p);
        const hit = pageFor(data.universities, p.name);
        if (hit) { hit.profile = profile; return; }
        if (profile.own || (!profile.courses.length && !profile.levels.length)) return; // only pictures: no page of its own
        data.universities.push({ ...clean({ name: p.name, city: profile.city, website: profile.website, intakes: [{ name: 'January 2027' }], process: STARTER_STEPS.map((title) => ({ title })), profile }), id: newId(), updatedAt: now().toISOString(), updatedBy: '' });
      });
    }
    data.partnersApplied = PARTNERS.version;
  }

  return {
    list: (q = '') => listIn(load().universities, q),
    // Pages saved before the overview and fees table existed come back with those empty.
    // Every university with all its details (for Admin's backup copy).
    all: () => load().universities,
    get: (id) => getIn(load().universities, id),
    // Adds a university (just its name; the rest is filled in on its page).
    create(name, by) {
      const data = load();
      const cleaned = clean({ name, process: STARTER_STEPS.map((title) => ({ title })) });
      if (!cleaned.name) return { error: 'Please enter the university name.' };
      if (data.universities.some((u) => u.name.toLowerCase() === cleaned.name.toLowerCase())) return { error: 'That university is already in the list.' };
      const uni = { ...cleaned, id: newId(), updatedAt: now().toISOString(), updatedBy: by };
      write({ ...data, universities: [...data.universities, uni] }); // write a copy: a failed write must not leave the change in memory
      return { university: uni };
    },
    update(id, input, by) {
      const data = load();
      const i = data.universities.findIndex((u) => u.id === id);
      if (i === -1) return { error: 'No such university.' };
      const cleaned = clean(input, data.universities[i]);
      if (data.universities.some((u, k) => k !== i && u.name.toLowerCase() === cleaned.name.toLowerCase())) return { error: 'Another university already has that name.' };
      const universities = [...data.universities];
      universities[i] = { ...cleaned, id, updatedAt: now().toISOString(), updatedBy: by };
      write({ ...data, universities });
      return { university: universities[i] };
    },
    // The team's change to the dates of the intakes (the only change to a page anyone makes by hand): [{ id or name, deadline,
    // deadlines }]. An intake not on the page is added with its name.
    setDeadlines(id, list, by) {
      const data = load();
      const i = data.universities.findIndex((u) => u.id === id);
      if (i === -1) return { error: 'No such university.' };
      const uni = data.universities[i];
      const intakes = uni.intakes.map((x) => ({ ...x }));
      const at = now().toISOString();
      for (const given of (Array.isArray(list) ? list : []).slice(0, LIMITS.intakes)) {
        const name = str(given && given.name, LIMITS.short).trim();
        let target = intakes.find((x) => (given && given.id && x.id === given.id) || (name && x.name.toLowerCase() === name.toLowerCase()));
        if (!target) {
          if (!name) continue;
          if (intakes.length >= LIMITS.intakes) return { error: 'This university already has the most intakes a page can hold.' };
          target = { name, deadline: '', deadlines: '', requirements: '', courses: '', notes: '' };
          intakes.push(target);
        }
        const deadline = str(given.deadline, LIMITS.short).trim();
        const deadlines = str(given.deadlines, LIMITS.text).trim();
        if (deadline === (target.deadline || '') && deadlines === (target.deadlines || '')) continue;
        Object.assign(target, { deadline, deadlines, editedBy: str(by, 80), editedAt: at });
      }
      const cleaned = clean({ ...uni, intakes }, uni);
      const universities = [...data.universities];
      // Marked as changed by the person, so the page is no longer rebuilt from the starting sheets over the team's dates.
      universities[i] = { ...cleaned, id, updatedAt: at, updatedBy: str(by, 80) };
      write({ ...data, universities });
      return { university: universities[i] };
    },
    remove(id) {
      const data = load();
      const uni = data.universities.find((u) => u.id === id);
      if (!uni) return { error: 'No such university.' };
      write({ ...data, universities: data.universities.filter((u) => u.id !== id) });
      return { removed: uni };
    },
    // The pages read from partners, for the Thursday refresh: [{ id, key, source }].
    refreshable: () => load().universities.filter((u) => u.profile && !u.profile.own && u.profile.source).map((u) => ({ id: u.id, name: u.name, key: u.profile.key, source: u.profile.source, courses: u.profile.courses.length })),
    // The partner's fresh January 2027 courses, requirements and dates for one page (partner-refresh.js). The pictures, the about and
    // everything the team wrote stay as they are.
    refreshProfile(id, fresh) {
      const data = load();
      const i = data.universities.findIndex((u) => u.id === id);
      if (i === -1 || !data.universities[i].profile) return { error: 'No such page.' };
      const u = data.universities[i];
      const profile = cleanProfile({ ...u.profile, levels: fresh.levels, courses: fresh.courses, deadlines: fresh.deadlines, readAt: now().toISOString() });
      const universities = [...data.universities];
      universities[i] = { ...u, profile, updatedAt: now().toISOString() };
      write({ ...data, universities });
      return { university: universities[i] };
    },
    // Puts back a whole list from a backup (each page checked and cleaned like any save).
    restoreAll(universities) {
      if (!Array.isArray(universities)) return { error: 'The backup has no Universities in it.' };
      const data = load();
      const restored = universities.filter((u) => u && /^[a-f0-9]{12}$/.test(u.id) && u.name).map((u) => ({
        ...clean(u, { id: u.id, name: u.name }), id: u.id, updatedAt: u.updatedAt || now().toISOString(), updatedBy: typeof u.updatedBy === 'string' ? u.updatedBy : '',
      }));
      write({ ...data, universities: restored });
      return { count: restored.length };
    },
  };
}

module.exports = { createFacts, viewFacts, clean, PATHWAY, mergeIntakeDates, STARTER_UNIVERSITIES, STARTER_STEPS, OIEG_REPORT };
