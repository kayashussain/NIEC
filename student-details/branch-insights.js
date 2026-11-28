// A branch's Dashboard in figures, and what each student has reached (the owner, 27 and 28 Nov 2026). It only reads: the students given to
// it are the branch's own, and nothing is changed. recordOf reads one student; journeyOf serves the branch Today; branchInsights (below)
// works out the Dashboard intake by intake; universityStudents serves the Universities pages.
const { isoDate } = require('./dashboard-stats');
const { squash } = require('./sheet-sync');

const STATUS = 'APPLICATION STATUS';
const text = (v) => String(v == null ? '' : v).trim();
const dayNo = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const earliest = (list) => list.filter(Boolean).sort()[0] || '';

// One student's own record of each step. `apps`: the applications of the student, one per University (portal-api.js applicationsOf).
function recordOf({ row, card = {}, apps = [] }, today) {
  const date = (column) => isoDate(row[column]) || '';
  const stage = text(row[STATUS]);
  const list = apps.filter((a) => a.applied || a.offer).map((a) => ({ university: text(a.university), course: text(a.course), applied: a.applied || '', offer: a.offer || '', refused: a.refused || '', withdrawn: a.withdrawn || '' }));
  // A day typed on All Students with no University named still counts once.
  const sheetApplied = date('APPLICATION SUBMISSION DATE');
  const sheetOffer = date('OFFER RECEIVED DATE');
  if ((sheetApplied && !list.some((a) => a.applied)) || (sheetOffer && !list.some((a) => a.offer))) {
    list.push({ university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']), applied: list.some((a) => a.applied) ? '' : sheetApplied, offer: list.some((a) => a.offer) ? '' : sheetOffer, refused: '', withdrawn: '' });
  }
  // A mock interview is held when its feedback is written and its day has come; each mock number counts once.
  const mocks = new Map();
  [1, 2, 3, 4].forEach((n) => { const d = date(`MOCK SCHEDULE ${n}`); if (d && d <= today && text(row[`FEEDBACK ${n}`])) mocks.set(n, d); });
  (card.extraMocks || []).forEach((m) => { if (m && m.day && m.day <= today) mocks.set(m.n, m.day); });
  const preCas = text(row['PRE CAS INTERVIEW']);
  const visa = date('VISA RECEIVED DATE');
  const cas = date('CAS RECEIVED DATE');
  const issued = stage === 'Visa Issued' || Boolean(visa);
  return {
    stage, list, mocks: [...mocks.values()].sort(),
    university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']),
    passed: /^pass/i.test(preCas), failed: /^fail/i.test(preCas),
    inquiry: isoDate(card.profile && card.profile.inquiryDate) || '',
    applied: earliest(list.map((a) => a.applied)), offered: earliest(list.map((a) => a.offer)),
    hasApplied: list.some((a) => a.applied), hasOffer: list.some((a) => a.offer),
    paid: date('PAYMENT DATE'), cas, hasCas: Boolean(cas) || ['CAS Issued', 'Visa Lodge'].includes(stage) || issued,
    lodged: date('VISA LODGE DATE'), visa, issued, refusedVisa: stage === 'Visa Rejected',
  };
}

// How far one student has come, for a task opened on a branch's Today: the day of each step and no more.
function journeyOf(student, today) {
  const r = recordOf(student, today);
  return {
    applications: r.list.filter((a) => a.applied).length, applied: r.applied, offered: r.offered, hasApplied: r.hasApplied, hasOffer: r.hasOffer,
    mocks: r.mocks.length, lastMock: r.mocks[r.mocks.length - 1] || '', passed: r.passed, failed: r.failed,
    paid: r.paid, cas: r.cas, hasCas: r.hasCas, lodged: r.lodged, visa: r.visa, issued: r.issued, refusedVisa: r.refusedVisa,
  };
}

// ---- The Dashboard of a branch, intake by intake (the owner, 28 Nov 2026) ----
// Every figure is worked out here and nowhere else, so the page only shows what it is given. The rules, each one checked by a test:
//  * An application is one student at one University: courses at the same University are one application (squash(name)), and a
//    student who applies to three Universities is three applications.
//  * A later step proves every earlier one (the rule of dashboard-stats.js): a student with a visa has also lodged, had a CAS, paid,
//    passed the final interview, held a mock, had an offer and applied. So each step is never bigger than the step before it.
//  * A student who defers is moved to the next intake with the same id, back at Inquiry, and every date comes along. The student
//    card says from where and on which day (card.follow.from, the stage note), so the two halves are told apart by that day: what
//    was done up to it belongs to the old intake (the student stays there as "deferred out"), what is done after it belongs to the
//    new one ("deferred in"). Nothing is counted twice, and deferred-in students are not new recruits when growth is worked out.
//  * Each ratio has one definition: offer rate = offers / applications, pass rate = passed / final interviews, visa rate = visas /
//    (visas + refused), conversion = visas / students. No ratio is shown when its bottom is nothing.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Jan Intake 2027" and "Jan 2027" are both "Jan 2027"; a sheet named in some other way keeps its name.
const intakeLabel = (name) => {
  const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\W*(?:intake\W*)?(\d{4})/i.exec(String(name || ''));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : text(name);
};
// The two intakes after this one, in the way the consultancy runs them: January, then September, then January again.
const nextLabels = (label) => {
  const m = /^(Jan|Sep) (\d{4})$/.exec(label);
  if (!m) return ['The next intake', 'The intake after'];
  const out = [];
  let [month, year] = [m[1], Number(m[2])];
  for (let i = 0; i < 2; i += 1) {
    if (month === 'Jan') month = 'Sep'; else { month = 'Jan'; year += 1; }
    out.push(`${month} ${year}`);
  }
  return out;
};

// One student's applications, one for each University (courses at the same University are one).
function mergeApplications(list) {
  const by = new Map();
  list.forEach((a) => {
    const key = squash(a.university);
    const was = by.get(key);
    if (!was) { by.set(key, { key, university: text(a.university), applied: a.applied || '', offer: a.offer || '', refused: a.refused || '', withdrawn: a.withdrawn || '' }); return; }
    if (!was.university && a.university) was.university = text(a.university);
    was.applied = earliest([was.applied, a.applied]);
    was.offer = earliest([was.offer, a.offer]);
    was.refused = was.refused || a.refused || '';
    was.withdrawn = was.withdrawn || a.withdrawn || '';
  });
  // An application is counted when it was submitted or already has an offer (an offer proves it was submitted).
  return [...by.values()].filter((a) => a.applied || a.offer);
}

// The steps one student has reached, each carried back from the later ones.
function reachedOf(e) {
  const r = {};
  r.visa = Boolean(e.visa) || e.issuedStage;
  r.lodged = Boolean(e.lodged) || e.stageLodged || r.visa || e.rejected;
  r.cas = Boolean(e.cas) || e.casStage || r.lodged;
  r.paid = Boolean(e.paid) || r.cas;
  r.passed = e.passed || r.paid;
  r.fin = e.passed || e.failed || r.passed;
  r.mocked = e.mocks.length > 0 || r.fin;
  r.offered = e.apps.some((a) => a.offer) || r.mocked;
  r.applied = e.apps.length > 0 || r.offered;
  r.visaNo = e.rejected && !r.visa;
  return r;
}

// The one or two parts of a student's story: just one, or, for a student who deferred, what was done in the old intake and what is
// done in the new one. `known`: the names of the intakes this branch has (the old one must be one of them to be told apart).
function episodesOf(s, today, known) {
  const rec = recordOf(s, today);
  const row = s.row;
  const apps = mergeApplications(rec.list);
  const whole = {
    apps, mocks: rec.mocks, passed: rec.passed, failed: rec.failed, paid: rec.paid, cas: rec.cas, lodged: rec.lodged || isoDate(row['VFS ATTENDED DATE']) || '', visa: rec.visa,
    casStage: rec.hasCas && !rec.cas, issuedStage: rec.issued && !rec.visa, stageLodged: ['Visa Lodge', 'Visa Issued', 'Visa Rejected'].includes(rec.stage), rejected: rec.refusedVisa,
    stage: rec.stage, chosen: text(row['UNIVERSITY NAME']),
  };
  const move = s.moved && s.moved.day && known.has(s.moved.from) ? s.moved : null;
  if (!move) return [{ ...whole, intake: s.intake, deferredIn: false, deferredOut: false, from: '' }];
  const old = (d) => Boolean(d) && d <= move.day;
  const early = {
    apps: apps.filter((a) => old(a.applied || a.offer)), mocks: rec.mocks.filter(old),
    paid: old(rec.paid) ? rec.paid : '', cas: old(rec.cas) ? rec.cas : '', lodged: old(whole.lodged) ? whole.lodged : '', visa: old(rec.visa) ? rec.visa : '',
    casStage: false, issuedStage: false, stageLodged: false, rejected: false, passed: false, failed: false, stage: 'Defer', chosen: whole.chosen,
  };
  const late = {
    apps: apps.filter((a) => !old(a.applied || a.offer)), mocks: rec.mocks.filter((d) => !old(d)),
    paid: old(rec.paid) ? '' : rec.paid, cas: old(rec.cas) ? '' : rec.cas, lodged: old(whole.lodged) ? '' : whole.lodged, visa: old(rec.visa) ? '' : rec.visa,
    casStage: whole.casStage, issuedStage: whole.issuedStage, stageLodged: whole.stageLodged, rejected: whole.rejected, passed: false, failed: false, stage: rec.stage, chosen: whole.chosen,
  };
  // The Pre-CAS result has no day: it goes with the new intake only if the student has done anything in it since.
  const later = late.mocks.length || late.paid || late.cas || late.lodged || late.visa || late.casStage || late.issuedStage || late.rejected;
  if (later) { late.passed = rec.passed; late.failed = rec.failed; } else { early.passed = rec.passed; early.failed = rec.failed; }
  return [
    { ...early, intake: move.from, deferredIn: false, deferredOut: true, from: '' },
    { ...late, intake: s.intake, deferredIn: true, deferredOut: false, from: move.from },
  ];
}

// The University a student goes forward with: the one named on the sheet if it is one they applied to, else the first to give an
// offer, else the first they applied to. There is no field for the final choice, so this is the one rule used everywhere.
function chosenOf(e) {
  const byKey = new Map(e.apps.map((a) => [a.key, a]));
  const named = byKey.get(squash(e.chosen));
  if (named) return named;
  const offers = e.apps.filter((a) => a.offer).sort((a, b) => a.offer.localeCompare(b.offer));
  if (offers[0]) return offers[0];
  return [...e.apps].sort((a, b) => (a.applied || a.offer).localeCompare(b.applied || b.offer))[0] || null;
}

const NO_UNIVERSITY = 'No university recorded';
const span = (a, b) => (a && b && b >= a ? dayNo(b) - dayNo(a) : null);
const growthOf = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

// The numbers of one intake, from the parts of the students that belong to it.
function figuresOf(parts) {
  const reach = parts.map((e) => ({ e, r: reachedOf(e) }));
  const count = (key) => reach.filter((x) => x.r[key]).length;
  const apps = reach.flatMap(({ e }) => e.apps);
  const offers = apps.filter((a) => a.offer);
  const students = parts.length;
  const deferredIn = parts.filter((e) => e.deferredIn).length;
  const m = {
    students, deferredIn, deferredOut: parts.filter((e) => e.deferredOut).length, newStudents: students - deferredIn,
    applications: apps.length, applied: count('applied'), offers: offers.length, offered: count('offered'), mocked: count('mocked'),
    fin: count('fin'), passed: count('passed'), paid: count('paid'), cas: count('cas'), lodged: count('lodged'), visas: count('visa'), visaNo: count('visaNo'),
  };
  m.offerRate = pct(m.offers, m.applications);
  m.passRate = pct(m.passed, m.fin);
  m.visaRate = pct(m.visas, m.visas + m.visaNo);
  m.conversion = pct(m.visas, m.students);
  const days = apps.map((a) => span(a.applied, a.offer)).filter((d) => d !== null);
  m.offerDays = { count: days.length, average: average(days), median: median(days) };
  const steps = [['All students', m.students], ['Applied', m.applied], ['Offer received', m.offered], ['Mock interview held', m.mocked], ['Final interview sat', m.fin], ['Final interview passed', m.passed],
    ['Deposit paid', m.paid], ['CAS received', m.cas], ['Visa applied', m.lodged], ['Visa received', m.visas]];
  const funnel = steps.map(([label, n], i) => {
    const before = i ? steps[i - 1][1] : null;
    return { label, n, share: i ? pct(n, before) : 100, low: Boolean(i && before && pct(n, before) < 60) };
  });
  // One line for each University: its applications and offers, and where the students who chose it have got to.
  const rows = new Map();
  const row = (key, name) => { if (!rows.has(key)) rows.set(key, { name: name || NO_UNIVERSITY, applications: 0, offers: 0, fin: 0, passed: 0, lodged: 0, visas: 0, visaNo: 0 }); const x = rows.get(key); if (!x.name || x.name === NO_UNIVERSITY) x.name = name || x.name; return x; };
  reach.forEach(({ e, r }) => {
    e.apps.forEach((a) => { const x = row(a.key, a.university); x.applications += 1; if (a.offer) x.offers += 1; });
    const c = chosenOf(e);
    const x = row(c ? c.key : '', c ? c.university : '');
    if (r.fin) x.fin += 1;
    if (r.passed) x.passed += 1;
    if (r.lodged) x.lodged += 1;
    if (r.visa) x.visas += 1;
    if (r.visaNo) x.visaNo += 1;
  });
  const list = [...rows.values()].filter((x) => x.applications || x.fin || x.lodged || x.visas || x.visaNo);
  const universities = list.map((x) => ({ ...x, offerRate: pct(x.offers, x.applications), passRate: pct(x.passed, x.fin), visaRate: pct(x.visas, x.visas + x.visaNo) }))
    .sort((a, b) => b.applications - a.applications || b.offers - a.offers || a.name.localeCompare(b.name));
  return { m, funnel, universities, reach };
}

// What the page lists for the current intake: who each figure is made of, every application, and every student step by step.
function listsOf(reach, today) {
  const now = dayNo(today);
  const people = reach.map(({ e, r }) => {
    const c = chosenOf(e);
    return {
      id: e.id, name: e.name, stage: e.stage, from: e.from ? intakeLabel(e.from) : '', university: c ? c.university : '', more: Math.max(0, e.apps.length - 1),
      applications: e.apps.map((a) => ({ university: a.university, applied: a.applied, offer: a.offer, refused: a.refused })),
      applied: earliest(e.apps.map((a) => a.applied)), offered: earliest(e.apps.map((a) => a.offer)), mocks: e.mocks.length, lastMock: e.mocks[e.mocks.length - 1] || '',
      result: e.passed ? 'Passed' : e.failed ? 'Not passed' : '', paid: e.paid, cas: e.cas, lodged: e.lodged, visa: e.visa, r,
    };
  });
  const applications = reach.flatMap(({ e }) => e.apps.map((a) => {
    const answered = a.offer || a.refused || '';
    return {
      id: e.id, name: e.name, from: e.from ? intakeLabel(e.from) : '', university: a.university || NO_UNIVERSITY, applied: a.applied, offer: a.offer, refused: a.refused,
      waiting: !answered && !a.withdrawn, days: answered && a.applied ? Math.max(0, dayNo(answered) - dayNo(a.applied)) : a.applied ? Math.max(0, now - dayNo(a.applied)) : null,
    };
  })).sort((a, b) => (b.applied || b.offer).localeCompare(a.applied || a.offer) || a.name.localeCompare(b.name));
  return { people, applications };
}

// A branch's Dashboard. `students`: the branch's own students in every intake it can see, each { id, name, row, card, apps, intake,
// moved }, `moved` being { from, day } for a student who was deferred into `intake` (see portal-api.js). `intakes`: the intake names,
// oldest first; the last is the current one. Only the current intake gets names and lists, the earlier ones are numbers.
function branchInsights(students, today, intakes) {
  const names = intakes && intakes.length ? intakes : [...new Set(students.map((s) => s.intake))];
  const known = new Set(names);
  const parts = students.flatMap((s) => episodesOf(s, today, known).map((e) => ({ ...e, id: s.id, name: s.name })));
  const current = names[names.length - 1];
  const made = names.map((name) => ({ name, label: intakeLabel(name), ...figuresOf(parts.filter((e) => e.intake === name)) }));
  const best = (list) => list.reduce((a, b) => ((b.m.conversion == null ? -1 : b.m.conversion) > (a.m.conversion == null ? -1 : a.m.conversion) ? b : a), list[0]);
  const worst = (list) => list.reduce((a, b) => ((b.m.conversion == null ? 101 : b.m.conversion) < (a.m.conversion == null ? 101 : a.m.conversion) ? b : a), list[0]);
  const COLUMNS = [['students', 'Students'], ['applications', 'Applications submitted'], ['offers', 'Offers received'], ['fin', 'Final interviews'], ['passed', 'Interviews passed'], ['lodged', 'Applied for visa'], ['visas', 'Visas received']];
  // The growth table of a tab: the intakes up to its own, each number with its change since the intake before.
  const growthTo = (upto) => {
    const span2 = made.slice(0, upto + 1);
    const done = span2.filter((x) => x.name !== current);
    const strong = done.length > 1 ? best(done) : null;
    const weak = done.length > 1 ? worst(done) : null;
    return span2.map((x, i) => {
      const before = i ? span2[i - 1].m : null;
      const running = x.name === current;
      const tag = running ? 'Still running' : strong && strong !== weak && x === strong ? 'Strongest' : strong && strong !== weak && x === weak ? 'Weakest' : '';
      return {
        name: x.name, label: x.label, tag, deferredIn: x.m.deferredIn, deferredOut: x.m.deferredOut,
        cells: COLUMNS.map(([key]) => ({ key, value: x.m[key], change: before ? growthOf(key === 'students' ? x.m.newStudents : x.m[key], key === 'students' ? before.newStudents : before[key]) : null })),
        conversion: { value: x.m.conversion, points: before && before.conversion != null && x.m.conversion != null ? x.m.conversion - before.conversion : null },
      };
    });
  };
  // The next two intakes, from how many new students each intake brought and what each student of the finished intakes went on to
  // do. Needs two intakes and the first and the last with new students; otherwise there is nothing honest to say yet.
  let expected = null;
  const first = made[0];
  const last = made[made.length - 1];
  const finished = made.slice(0, -1);
  const finishedStudents = finished.reduce((n, x) => n + x.m.students, 0);
  if (made.length > 1 && first.m.newStudents > 0 && last.m.newStudents > 0 && finishedStudents > 0) {
    const g = (last.m.newStudents / first.m.newStudents) ** (1 / (made.length - 1)) - 1;
    const per = (key) => finished.reduce((n, x) => n + x.m[key], 0) / finishedStudents;
    const rates = { offers: per('offers'), passed: per('passed'), visas: per('visas') };
    const [one, two] = nextLabels(last.label);
    const at = (k) => { const s = Math.round(last.m.newStudents * (1 + g) ** k); return { students: s, offers: Math.round(s * rates.offers), passed: Math.round(s * rates.passed), visas: Math.round(s * rates.visas) }; };
    expected = { growth: Math.round(g * 100), rates, basis: finished.map((x) => x.label), next: [{ label: one, ...at(1) }, { label: two, ...at(2) }] };
  }
  const out = made.map((x, i) => ({
    name: x.name, label: x.label, current: x.name === current, m: x.m, funnel: x.funnel, universities: x.universities, growth: growthTo(i),
    ...(x.name === current ? listsOf(x.reach, today) : {}),
  }));
  return { today, current, intakes: out.reverse(), expected };
}

// The branch's own students at each University of the Universities pages: who has an offer, who waits for one, whom it refused, who
// withdrew and who has only chosen it. A University is found by its number on the student's choice, else by its name (never by a part
// of a name, so a college is never taken for the University it belongs to). One line for each student at each University.
const RANK = ['offer', 'waiting', 'chosen', 'refused', 'withdrawn'];
function universityStudents(students, universities) {
  const ids = new Set(universities.map((u) => u.id));
  const byName = new Map();
  universities.forEach((u) => { const k = squash(u.name); if (k && !byName.has(k)) byName.set(k, u.id); });
  const out = new Map(); // University -> { people: student -> line, applications, offers, waits }
  const at = (id) => { if (!out.has(id)) out.set(id, { people: new Map(), applications: 0, offers: 0, waits: [] }); return out.get(id); };
  students.forEach((s) => {
    const options = (s.card && s.card.options) || [];
    const find = (university, option) => (option && ids.has(option.universityId) ? option.universityId : byName.get(squash(university)) || '');
    const put = (id, state, a) => {
      if (!id) return;
      const people = at(id).people;
      const was = people.get(s.id);
      const line = { id: s.id, name: s.name, course: text(a.course), stage: text(s.row[STATUS]), state, applied: a.applied || '', offer: a.offer || '' };
      if (!was || RANK.indexOf(state) < RANK.indexOf(was.state)) people.set(s.id, line);
    };
    (s.apps || []).forEach((a) => {
      if (!a.applied && !a.offer && !a.refused && !a.withdrawn) return; // not submitted: counted as chosen below, if still chosen
      const id = find(a.university, options.find((o) => a.id && o.id === a.id));
      if (!id) return;
      const u = at(id);
      if (a.applied) u.applications += 1;
      if (a.offer) u.offers += 1;
      if (a.applied && a.offer && a.offer >= a.applied) u.waits.push(dayNo(a.offer) - dayNo(a.applied));
      put(id, a.withdrawn ? 'withdrawn' : a.refused ? 'refused' : a.offer ? 'offer' : 'waiting', a);
    });
    options.filter((o) => !o.applied && !o.offer && !o.refused && !o.withdrawn && !o.skipped).forEach((o) => put(find(o.university, o), 'chosen', o));
    const named = text(s.row['UNIVERSITY NAME']);
    if (named) put(find(named), 'chosen', { course: s.row['COURSE NAME'] });
  });
  return Object.fromEntries([...out].map(([id, u]) => [id, {
    applications: u.applications, offers: u.offers, days: average(u.waits),
    students: [...u.people.values()].sort((a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state) || a.name.localeCompare(b.name)),
  }]));
}

module.exports = { branchInsights, journeyOf, universityStudents };
