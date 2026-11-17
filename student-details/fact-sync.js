// One Fact File, kept up to date by itself (the owner, 17 Nov 2026: "not a Route2Uni fact file and a deadlines file beside it").
// After every reading of the Route2Uni partner portal (route2uni.js, twice a week), each university the portal has is written into
// its own Fact File page:
//
//   Entry requirements, fees and scholarships   the table, one row per course level: academic entry, English, tuition fee,
//                                                scholarship and deposit, exactly as the portal gives them
//   Entry requirements, Language test            per level, the study gap allowed and the English waiver rules
//   Courses available                            every course, grouped by level, with its campus
//   Intakes                                      each open intake with its deadline and every date the portal gives (application,
//                                                deposit, CAS, visa), and its courses; an intake the portal does not have is kept
//   City and website                             filled in when empty
//
// Overview, Location, Interview, Notes and the Application process stay the team's own and are never changed. A university the
// portal has and the Fact File does not is added. The rules in numbers (eligibility.js) are kept on the page for the finder.

const { rulesFrom, ourLevel } = require('./eligibility');
const { keyOf } = require('./route2uni');
const { clean } = require('./facts');

const money = (n) => (n ? `£${Number(n).toLocaleString('en-GB')}` : '');
const bullets = (list) => list.map((x) => `- ${x}`).join('\n');

// The page's fields from one portal reading of a university (route2uni.js shape()).
function pageFrom(r) {
  const levels = [];
  const add = (name) => { if (name && !levels.includes(name)) levels.push(name); };
  [r.fees, r.requirements, r.english, r.tests, r.scholarships].forEach((list) => (list || []).forEach((x) => add(x.level)));
  const programs = levels.map((level) => {
    const fee = (r.fees.find((f) => f.level === level) || { items: [] }).items;
    const isDeposit = (x) => /deposit/i.test(x.text);
    const req = r.requirements.find((q) => q.level === level);
    const eng = r.english.find((e) => e.level === level);
    const tests = r.tests.filter((t) => t.level === level).map((t) => `${t.test}: ${t.score}`);
    return {
      name: level,
      duration: '',
      academic: req ? [...req.criteria, req.gap ? `Study gap: ${req.gap}` : ''].filter(Boolean).join('\n') : '',
      english: [...tests, ...(eng && eng.waiver ? ['English waiver possible:', ...eng.criteria.map((c) => `- ${c}`)] : [])].join('\n'),
      tuition: fee.filter((x) => !isDeposit(x)).map((x) => [x.text.replace(/[\s:]+$/, ''), money(x.amount)].filter(Boolean).join(': ')).join('\n'),
      scholarship: ((r.scholarships.find((x) => x.level === level) || {}).amounts || []).join('\n'),
      deposit: fee.filter(isDeposit).map((x) => [x.text.replace(/[\s:]+$/, ''), money(x.amount)].filter(Boolean).join(': ')).join('\n'),
    };
  });
  const byLevel = (courses) => {
    const groups = new Map();
    courses.forEach((c) => { const g = ourLevel(c.level) || c.level || 'Other courses'; if (!groups.has(g)) groups.set(g, new Set()); groups.get(g).add(c.campus ? `${c.name} (${c.campus})` : c.name); });
    return [...groups].map(([g, set]) => `## ${g}\n${bullets([...set])}`).join('\n');
  };
  const unique = (list) => { const seen = new Set(); return list.filter((c) => { const k = `${c.name}|${c.campus}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const open = r.intakes.filter((i) => i.open);
  return {
    programs,
    entryRequirements: r.requirements.length ? 'The academic entry and the study gap allowed for each course level are in the table above.' : '',
    languageTests: r.english.length || r.tests.length ? `The English tests and scores for each course level are in the table above.${r.english.some((e) => e.waiver) ? `\n## English waiver\n${bullets(r.english.filter((e) => e.waiver).map((e) => `${e.level}: possible`))}` : ''}` : '',
    courses: byLevel(unique(r.courses)),
    intakes: open.map((i) => ({
      name: i.name,
      deadline: firstDate(i.deadline),
      deadlines: i.deadline,
      courses: byLevel(unique(r.courses.filter((c) => c.intake === i.name))),
    })),
    city: r.cities.join(', '),
    website: r.website,
    rules: rulesFrom(r),
  };
}
// The first deadline of an intake in a few words ("Friday 27 November 2026"), for the short line beside its name.
function firstDate(t) {
  const line = String(t || '').split('\n').map((x) => x.replace(/^[•\-\s]+/, '').trim()).find((x) => /\d/.test(x)) || '';
  const m = /((?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/i.exec(line);
  return (m ? m[0] : line).slice(0, 120);
}

// Writes a reading into the Fact File. Returns { updated, added, unchanged }.
function syncFacts(facts, reading, by = 'Route2Uni (automatic)') {
  const out = { updated: 0, added: 0, unchanged: 0 };
  if (!reading || !Array.isArray(reading.universities)) return out;
  const at = reading.fetchedAt || new Date().toISOString();
  reading.universities.forEach((r) => {
    let page = facts.all().find((u) => keyOf(u.name) === keyOf(r.name));
    if (!page) {
      const made = facts.create(r.name, by);
      if (made.error) return;
      page = made.university;
      out.added += 1;
    }
    const fresh = pageFrom(r);
    // Intakes: the portal's open ones (their dates and courses, the team's requirements and notes kept), then the page's others.
    const mine = page.intakes || [];
    const intakes = [
      ...fresh.intakes.map((i) => { const was = mine.find((x) => x.name.toLowerCase() === i.name.toLowerCase()) || {}; return { ...was, ...i, requirements: was.requirements || '', notes: was.notes || '' }; }),
      ...mine.filter((x) => !fresh.intakes.some((i) => i.name.toLowerCase() === x.name.toLowerCase())),
    ];
    const next = {
      ...page,
      programs: fresh.programs.length ? fresh.programs : page.programs,
      entryRequirements: fresh.entryRequirements || page.entryRequirements,
      languageTests: fresh.languageTests || page.languageTests,
      courses: fresh.courses || page.courses,
      intakes,
      city: page.city || fresh.city,
      website: page.website || fresh.website,
      rules: fresh.rules,
      source: { route2uni: { id: r.id, at } },
    };
    // Saved only when something the portal gives is different (the page's date then says when it last changed).
    const FIELDS = ['programs', 'entryRequirements', 'languageTests', 'courses', 'intakes', 'city', 'website', 'rules'];
    const pick = (u) => JSON.stringify(FIELDS.map((k) => u[k] ?? null));
    if (page.source && page.source.route2uni && pick(clean(next, page)) === pick(page)) { out.unchanged += 1; return; }
    const saved = facts.update(page.id, next, by);
    if (!saved.error) out.updated += 1;
  });
  return out;
}

module.exports = { syncFacts, pageFrom, firstDate };
