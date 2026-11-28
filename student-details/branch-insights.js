// A branch's Dashboard in figures (the owner, 27 Nov 2026): how many students, applications, offers, mock interviews, passed Pre-CAS
// interviews, payments, CAS and visas; applications and offers week by week and month by month; the days from an application to its
// offer; each University's offer rate; how long each step takes and who is still waiting for an offer. It only reads: the students
// given to it are the branch's own, and nothing is changed.
const { isoDate } = require('./dashboard-stats');
const { squash } = require('./sheet-sync');

const STATUS = 'APPLICATION STATUS';
const text = (v) => String(v == null ? '' : v).trim();
const dayNo = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWord = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
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
  const list = apps.filter((a) => a.applied || a.offer).map((a) => ({ university: text(a.university), applied: a.applied || '', offer: a.offer || '', refused: a.refused || '', withdrawn: a.withdrawn || '' }));
  // A day typed on All Students with no University named still counts once.
  const sheetApplied = date('APPLICATION SUBMISSION DATE');
  const sheetOffer = date('OFFER RECEIVED DATE');
  if ((sheetApplied && !list.some((a) => a.applied)) || (sheetOffer && !list.some((a) => a.offer))) {
    list.push({ university: text(row['UNIVERSITY NAME']), applied: list.some((a) => a.applied) ? '' : sheetApplied, offer: list.some((a) => a.offer) ? '' : sheetOffer, refused: '', withdrawn: '' });
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
    stage, list, mocks: [...mocks.values()],
    passed: /^pass/i.test(preCas), failed: /^fail/i.test(preCas),
    inquiry: isoDate(card.profile && card.profile.inquiryDate) || '',
    applied: earliest(list.map((a) => a.applied)), offered: earliest(list.map((a) => a.offer)),
    hasApplied: list.some((a) => a.applied), hasOffer: list.some((a) => a.offer),
    paid: date('PAYMENT DATE'), cas, hasCas: Boolean(cas) || ['CAS Issued', 'Visa Lodge'].includes(stage) || issued,
    lodged: date('VISA LODGE DATE'), visa, issued, refusedVisa: stage === 'Visa Rejected',
  };
}

// The last `count` weeks (Monday first) or months, each with what happened in it.
function periods(today, records, kind, count) {
  const now = dayNo(today);
  const buckets = [];
  if (kind === 'week') {
    const monday = now - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7);
    for (let i = count - 1; i >= 0; i -= 1) { const from = monday - i * 7; buckets.push({ from: isoOf(from), to: isoOf(from + 6), label: dayWord(isoOf(from)), title: `Week of ${dayWord(isoOf(from))}` }); }
  } else {
    const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7)) - 1;
    for (let i = count - 1; i >= 0; i -= 1) {
      const first = new Date(Date.UTC(y, m - i, 1)); const last = new Date(Date.UTC(y, m - i + 1, 0));
      const from = first.toISOString().slice(0, 10);
      buckets.push({ from, to: last.toISOString().slice(0, 10), label: MONTHS[first.getUTCMonth()], title: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}` });
    }
  }
  const inside = (b, d) => Boolean(d) && d >= b.from && d <= b.to;
  const apps = records.flatMap((r) => r.list);
  return buckets.map((b) => ({
    label: b.label, title: b.title,
    applications: apps.filter((a) => inside(b, a.applied)).length,
    offers: apps.filter((a) => inside(b, a.offer)).length,
  }));
}

function branchInsights(students, today) {
  const records = students.map((s) => ({ ...recordOf(s, today), id: s.id, name: s.name }));
  const total = records.length;
  const count = (test) => records.filter(test).length;
  const apps = records.flatMap((r) => r.list.map((a) => ({ ...a, id: r.id, name: r.name, stage: r.stage })));
  const submitted = apps.filter((a) => a.applied);
  const offers = apps.filter((a) => a.offer);
  const mockCount = records.reduce((n, r) => n + r.mocks.length, 0);
  const n = (v, one, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
  const applied = count((r) => r.hasApplied);
  const offered = count((r) => r.hasOffer);
  const mocked = count((r) => r.mocks.length);
  const passed = count((r) => r.passed);
  const failed = count((r) => r.failed);
  const paid = count((r) => r.paid);
  const withCas = count((r) => r.hasCas);
  const visas = count((r) => r.issued);
  const refusedVisa = count((r) => r.refusedVisa);

  // From an application to its offer: only where both days are recorded and the offer is not before the application.
  const span = (a, b) => (a && b && b >= a ? dayNo(b) - dayNo(a) : null);
  const waits = submitted.map((a) => span(a.applied, a.offer)).filter((d) => d !== null);
  const bands = [['Within 7 days', 0, 7], ['8 to 14 days', 8, 14], ['15 to 30 days', 15, 30], ['Over 30 days', 31, Infinity]];

  const unis = new Map();
  apps.forEach((a) => {
    const name = a.university || 'No University recorded';
    const key = name.toLowerCase();
    const u = unis.get(key) || { name, applications: 0, offers: 0, answered: 0, waits: [] };
    if (a.applied) { u.applications += 1; if (a.offer) u.answered += 1; }
    if (a.offer) u.offers += 1;
    const d = span(a.applied, a.offer);
    if (d !== null) u.waits.push(d);
    unis.set(key, u);
  });

  const step = (label, pairs) => { const list = pairs.map(([a, b]) => span(a, b)).filter((d) => d !== null); return { label, average: average(list), count: list.length }; };
  const now = dayNo(today);

  return {
    totals: [
      { key: 'students', label: 'Total students', value: total, note: 'In this intake' },
      { key: 'applications', label: 'Applications submitted', value: submitted.length, note: `For ${n(applied, 'student')}` },
      { key: 'offers', label: 'Offers received', value: offers.length, note: `For ${n(offered, 'student')}` },
      { key: 'mocks', label: 'Mock interviews held', value: mockCount, note: `With ${n(mocked, 'student')}` },
      { key: 'passed', label: 'Passed Pre-CAS interview', value: passed, note: failed ? `${failed} did not pass` : 'None has failed' },
      { key: 'payments', label: 'Payments made', value: paid, note: 'Students who paid their deposit' },
      { key: 'cas', label: 'CAS issued', value: withCas, note: `${pct(withCas, total) || 0}% of your students` },
      { key: 'visas', label: 'Visas received', value: visas, note: `${pct(visas, total) || 0}% of your students` },
    ],
    weeks: periods(today, records, 'week', 12),
    months: periods(today, records, 'month', 12),
    // Students (not applications) who have reached each step, so every bar is a share of the same total.
    journey: [
      ['All students', total], ['Applied', applied], ['Offer received', offered], ['Mock interview held', mocked],
      ['Passed Pre-CAS', passed], ['Paid deposit', paid], ['CAS issued', withCas], ['Visa received', visas],
    ].map(([label, students2]) => ({ label, students: students2, share: pct(students2, total) })),
    offerDays: {
      count: waits.length, average: average(waits), median: median(waits),
      fastest: waits.length ? Math.min(...waits) : null, slowest: waits.length ? Math.max(...waits) : null,
      bands: bands.map(([label, from, to]) => ({ label, count: waits.filter((d) => d >= from && d <= to).length })),
    },
    // Submitted, no offer, and the University has not said no (nor was the application taken back).
    waiting: submitted.filter((a) => !a.offer && !a.refused && !a.withdrawn && !['Withdrawn', 'Visa Issued', 'Visa Rejected'].includes(a.stage))
      .map((a) => ({ id: a.id, name: a.name, university: a.university || 'No University recorded', applied: a.applied, days: Math.max(0, now - dayNo(a.applied)) }))
      .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
    universities: [...unis.values()]
      .map((u) => ({ name: u.name, applications: u.applications, offers: u.offers, rate: pct(u.answered, u.applications), days: average(u.waits) }))
      .sort((a, b) => b.applications - a.applications || b.offers - a.offers || a.name.localeCompare(b.name)),
    steps: [
      step('Inquiry to first application', records.map((r) => [r.inquiry, r.applied])),
      step('Application to offer', submitted.map((a) => [a.applied, a.offer])),
      step('First offer to payment', records.map((r) => [r.offered, r.paid])),
      step('Payment to CAS', records.map((r) => [r.paid, r.cas])),
      step('CAS to visa lodged', records.map((r) => [r.cas, r.lodged])),
      step('Visa lodged to visa received', records.map((r) => [r.lodged, r.visa])),
    ],
    rates: [
      { label: 'Students who applied', value: pct(applied, total), note: `${applied} of ${total}` },
      { label: 'Applicants with an offer', value: pct(count((r) => r.hasOffer && r.hasApplied), applied), note: `${count((r) => r.hasOffer && r.hasApplied)} of ${applied}` },
      { label: 'Pre-CAS pass rate', value: pct(passed, passed + failed), note: `${passed} of ${passed + failed} with a result` },
      { label: 'Visa success rate', value: pct(visas, visas + refusedVisa), note: `${visas} of ${visas + refusedVisa} decided` },
    ],
  };
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

module.exports = { branchInsights, universityStudents };
