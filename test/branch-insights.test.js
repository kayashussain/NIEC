// A branch's figures (student-details/branch-insights.js): its Dashboard and its own students on the Universities pages.
const test = require('node:test');
const assert = require('node:assert');
const { branchInsights, journeyOf, universityStudents } = require('../student-details/branch-insights');

const student = (id, row, apps = [], card = {}) => ({ id, name: `Student ${id}`, row: { _id: id, ...row }, card, apps });
const app = (university, applied, offer = '', more = {}) => ({ id: '', university, course: 'MBA', applied, offer, refused: '', withdrawn: '', ...more });

const SEP = 'Sep Intake 2026';
const JAN = 'Jan Intake 2027';
const placed = (intake, s, moved = null) => ({ ...s, intake, moved });
// Counted by hand. Sep has a, b, c and x (who deferred on 12 Oct 2026); Jan has x again, and y.
const students = () => [
  // a: visa received. Two courses at Coventry are one application, so a has two applications (Coventry and Ulster).
  placed(SEP, student('a', { 'APPLICATION STATUS': 'Visa Issued', 'UNIVERSITY NAME': 'Coventry University', 'VISA RECEIVED DATE': '2026-11-20', 'VISA LODGE DATE': '2026-11-05', 'CAS RECEIVED DATE': '2026-11-01', 'PAYMENT DATE': '2026-10-20', 'PRE CAS INTERVIEW': 'Pass', 'MOCK SCHEDULE 1': '2026-10-10', 'FEEDBACK 1': 'Good' },
    [app('Coventry University', '2026-09-01', '2026-09-11'), app('Coventry University', '2026-09-03', '', { course: 'MSc' }), app('Ulster University', '2026-09-02')])),
  placed(SEP, student('b', { 'APPLICATION STATUS': 'Application Stage' }, [app('Coventry University', '2026-11-23')])),
  // c: visa refused. Only a payment day and the stage are typed, yet the steps before them were done (a later step proves every earlier one).
  placed(SEP, student('c', { 'APPLICATION STATUS': 'Visa Rejected', 'PAYMENT DATE': '2026-10-25' }, [app('Ulster University', '2026-09-05', '2026-09-20')])),
  // x: applied to Coventry before the move, to Ulster after it (an offer on 20 Nov). In January the whole record is there, back at Inquiry.
  placed(JAN, student('x', { 'APPLICATION STATUS': 'Application Stage' }, [app('Coventry University', '2026-09-20'), app('Ulster University', '2026-11-05', '2026-11-20')]), { from: SEP, day: '2026-10-12' }),
  placed(JAN, student('y', { 'APPLICATION STATUS': 'Inquiry' })),
];
const intake = (d, name) => d.intakes.find((i) => i.name === name);

test('an intake is worked out step by step, and no step is bigger than the step before it', () => {
  const d = branchInsights(students(), '2026-11-27', [SEP, JAN]);
  assert.deepStrictEqual(d.intakes.map((i) => [i.name, i.label, i.current]), [[JAN, 'Jan 2027', true], [SEP, 'Sep 2026', false]], 'newest first');
  const sep = intake(d, SEP).m;
  assert.deepStrictEqual([sep.students, sep.newStudents, sep.deferredOut, sep.deferredIn], [4, 4, 1, 0]);
  assert.deepStrictEqual([sep.applications, sep.applied, sep.offers, sep.offered], [5, 4, 2, 2], 'the two Coventry courses of a are one application, and x applied once before the move');
  assert.deepStrictEqual([sep.mocked, sep.fin, sep.passed, sep.paid, sep.cas, sep.lodged, sep.visas, sep.visaNo], [2, 2, 2, 2, 2, 2, 1, 1], 'c is carried back from the payment and the refused visa');
  assert.deepStrictEqual([sep.offerRate, sep.passRate, sep.visaRate, sep.conversion], [40, 100, 50, 25]);
  assert.deepStrictEqual([sep.offerDays.average, sep.offerDays.count], [13, 2], 'a waited 10 days (from its first Coventry application), c 15: 12.5 days');
  const steps = intake(d, SEP).funnel.map((f) => f.n);
  assert.deepStrictEqual(steps, [4, 4, 2, 2, 2, 2, 2, 2, 2, 1]);
  assert.ok(steps.every((n, i) => !i || n <= steps[i - 1]));
});

test('a student who deferred is two halves: nothing is counted twice, and a deferred-in student is not a new recruit', () => {
  const d = branchInsights(students(), '2026-11-27', [SEP, JAN]);
  const jan = intake(d, JAN).m;
  assert.deepStrictEqual([jan.students, jan.newStudents, jan.deferredIn, jan.applications, jan.offers, jan.offered, jan.applied], [2, 1, 1, 1, 1, 1, 1], 'only the Ulster application after the move is in January');
  const all = d.intakes.reduce((n, i) => n + i.m.applications, 0);
  assert.strictEqual(all, 6, 'a 2 + b 1 + c 1 + x 2, each application once across the two intakes');
  assert.strictEqual(intake(d, JAN).people.find((p) => p.id === 'x').from, 'Sep 2026');
  assert.strictEqual(intake(d, JAN).people.length, 2);
  // The Pre-CAS result has no day: with nothing done since the move it stays with the intake the student left.
  const withResult = students();
  withResult[3].row['PRE CAS INTERVIEW'] = 'Pass';
  const e = branchInsights(withResult, '2026-11-27', [SEP, JAN]);
  assert.strictEqual(intake(e, SEP).m.passed, 3);
  assert.strictEqual(intake(e, JAN).m.passed, 0);
  // Where the intake it came from is not one the branch has, there is nothing to split by: one student, all in the new intake.
  const lone = branchInsights(students().slice(3), '2026-11-27', [JAN]);
  assert.deepStrictEqual([intake(lone, JAN).m.students, intake(lone, JAN).m.applications], [2, 2]);
});

test('each University adds up to the intake: applications, offers and where its students got to', () => {
  const d = branchInsights(students(), '2026-11-27', [SEP, JAN]);
  const sep = intake(d, SEP);
  const by = Object.fromEntries(sep.universities.map((u) => [u.name, u]));
  assert.deepStrictEqual([by['Coventry University'].applications, by['Coventry University'].offers, by['Coventry University'].fin, by['Coventry University'].visas, by['Coventry University'].visaRate], [3, 1, 1, 1, 100], 'a chose Coventry, the University it named');
  assert.deepStrictEqual([by['Ulster University'].applications, by['Ulster University'].offers, by['Ulster University'].fin, by['Ulster University'].visas, by['Ulster University'].visaNo, by['Ulster University'].visaRate], [2, 1, 1, 0, 1, 0], 'c went forward with the University that gave its offer');
  ['applications', 'offers', 'fin', 'passed', 'lodged', 'visas', 'visaNo'].forEach((k) => {
    const key = { applications: 'applications', offers: 'offers', fin: 'fin', passed: 'passed', lodged: 'lodged', visas: 'visas', visaNo: 'visaNo' }[k];
    assert.strictEqual(sep.universities.reduce((n, u) => n + u[key], 0), sep.m[k], k + ' of the universities is the intake');
  });
});

test('growth: each tab compares the intakes up to its own, student growth leaves out those who deferred in', () => {
  const d = branchInsights(students(), '2026-11-27', [SEP, JAN]);
  const jan = intake(d, JAN).growth;
  assert.deepStrictEqual(jan.map((r) => r.label), ['Sep 2026', 'Jan 2027']);
  const cell = (row, key) => row.cells.find((c) => c.key === key);
  assert.strictEqual(cell(jan[0], 'students').change, null, 'the first intake has nothing before it');
  assert.deepStrictEqual([cell(jan[1], 'students').value, cell(jan[1], 'students').change], [2, -75], '1 new student against 4');
  assert.strictEqual(cell(jan[1], 'applications').change, -80);
  assert.deepStrictEqual([jan[1].tag, jan[1].conversion.value, jan[1].conversion.points], ['Still running', 0, -25]);
  assert.deepStrictEqual(intake(d, SEP).growth.map((r) => r.label), ['Sep 2026'], 'the older tab compares itself only');
  assert.deepStrictEqual([d.expected.growth, d.expected.basis, d.expected.next.map((n) => n.label)], [-75, ['Sep 2026'], ['Sep 2027', 'Jan 2028']]);
});

test('names and lists only for the current intake', () => {
  const d = branchInsights(students(), '2026-11-27', [SEP, JAN]);
  assert.ok(intake(d, JAN).people && intake(d, JAN).applications);
  assert.strictEqual(intake(d, SEP).people, undefined);
  assert.deepStrictEqual(intake(d, JAN).applications.map((a) => [a.id, a.university, a.waiting, a.days]), [['x', 'Ulster University', false, 15]]);
});

test('no students: every figure is empty, none is a made-up one', () => {
  const d = branchInsights([], '2026-11-27', [JAN]);
  const m = d.intakes[0].m;
  assert.deepStrictEqual([m.students, m.applications, m.offerRate, m.passRate, m.visaRate, m.conversion, m.offerDays.average], [0, 0, null, null, null, null, null]);
  assert.strictEqual(d.expected, null);
  assert.deepStrictEqual(d.intakes[0].universities, []);
});

test('one student progress, for a task opened on Today', () => {
  const gita = student('a', { 'APPLICATION STATUS': 'Mock Stage', 'MOCK SCHEDULE 1': '2026-11-20', 'FEEDBACK 1': 'Good' }, [app('Coventry University', '2026-11-23', '2026-11-25')]);
  const j = journeyOf(gita, '2026-11-27');
  assert.deepStrictEqual([j.applications, j.hasOffer, j.mocks, j.lastMock, j.passed, j.paid, j.issued], [1, true, 1, '2026-11-20', false, '', false]);
});

test('each University lists the branch students once, found by number or by the whole name', () => {
  const universities = [{ id: 'u1', name: 'Anglia Ruskin University' }, { id: 'u2', name: 'Anglia Ruskin University College (ARU College)' }, { id: 'u3', name: 'Coventry University' }];
  const out = universityStudents([
    student('a', { 'APPLICATION STATUS': 'Mock Stage', 'UNIVERSITY NAME': 'Coventry University' }, [app('Coventry University', '2026-11-01', '2026-11-05')]),
    // The choice carries the University's number, whatever name was typed.
    student('b', { 'APPLICATION STATUS': 'Application Stage' }, [{ ...app('ARU', '2026-11-20'), id: 'o1' }], { options: [{ id: 'o1', universityId: 'u1', university: 'ARU', applied: '2026-11-20' }] }),
    student('c', { 'APPLICATION STATUS': 'Inquiry', 'UNIVERSITY NAME': 'Anglia Ruskin University College', 'COURSE NAME': 'Foundation' }),
    student('d', { 'APPLICATION STATUS': 'Inquiry', 'UNIVERSITY NAME': 'A University nobody lists' }),
  ], universities);
  assert.deepStrictEqual(Object.keys(out).sort(), ['u1', 'u2', 'u3']);
  assert.deepStrictEqual([out.u3.applications, out.u3.offers, out.u3.days, out.u3.students.map((s) => s.state)], [1, 1, 4, ['offer']], 'the name on All Students does not list the student twice');
  assert.deepStrictEqual(out.u1.students.map((s) => [s.id, s.state]), [['b', 'waiting']]);
  assert.deepStrictEqual(out.u2.students.map((s) => [s.id, s.state, s.course]), [['c', 'chosen', 'Foundation']], 'a college is never taken for its University');
});
