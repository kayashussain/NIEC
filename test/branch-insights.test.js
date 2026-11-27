// A branch's figures (student-details/branch-insights.js): its Dashboard and its own students on the Universities pages.
const test = require('node:test');
const assert = require('node:assert');
const { branchInsights, journeyOf, universityStudents } = require('../student-details/branch-insights');

const student = (id, row, apps = [], card = {}) => ({ id, name: `Student ${id}`, row: { _id: id, ...row }, card, apps });
const app = (university, applied, offer = '', more = {}) => ({ id: '', university, course: 'MBA', applied, offer, refused: '', withdrawn: '', ...more });

test('the totals, the weeks, the days to an offer and who is waiting', () => {
  const d = branchInsights([
    student('a', { 'APPLICATION STATUS': 'Visa Issued', 'VISA RECEIVED DATE': '2026-11-20', 'CAS RECEIVED DATE': '2026-11-01', 'PAYMENT DATE': '2026-10-20', 'PRE CAS INTERVIEW': 'Pass', 'MOCK SCHEDULE 1': '2026-10-10', 'FEEDBACK 1': 'Good' },
      [app('Coventry University', '2026-09-01', '2026-09-11'), app('Ulster University', '2026-09-02')]),
    student('b', { 'APPLICATION STATUS': 'Application Stage' }, [app('Coventry University', '2026-11-23')]),
    // A mock whose day has not come, and a refused application: neither is held nor waiting.
    student('c', { 'APPLICATION STATUS': 'Mock Stage', 'MOCK SCHEDULE 1': '2026-12-02' }, [app('Ulster University', '2026-11-10', '', { refused: '2026-11-15' })]),
    student('d', { 'APPLICATION STATUS': 'Inquiry' }),
  ], '2026-11-27');
  const total = Object.fromEntries(d.totals.map((t) => [t.key, t.value]));
  assert.deepStrictEqual(total, { students: 4, applications: 4, offers: 1, mocks: 1, passed: 1, payments: 1, cas: 1, visas: 1 });
  assert.strictEqual(d.weeks.length, 12);
  assert.strictEqual(d.weeks[11].applications, 1, 'this week');
  assert.strictEqual(d.months[11].applications, 2, 'November');
  assert.strictEqual(d.offerDays.average, 10);
  assert.deepStrictEqual(d.waiting.map((w) => [w.id, w.university, w.days]), [['b', 'Coventry University', 4]], 'a visa already issued and a refusal are not waiting');
  const coventry = d.universities.find((u) => u.name === 'Coventry University');
  assert.deepStrictEqual([coventry.applications, coventry.offers, coventry.rate, coventry.days], [2, 1, 50, 10]);
});

test('the students behind the figures, and one student progress', () => {
  const gita = student('a', { 'APPLICATION STATUS': 'Mock Stage', 'MOCK SCHEDULE 1': '2026-11-20', 'FEEDBACK 1': 'Good' }, [app('Coventry University', '2026-11-23', '2026-11-25')]);
  const d = branchInsights([gita], '2026-11-27');
  assert.deepStrictEqual([d.weeks[11].from, d.weeks[11].to], ['2026-11-23', '2026-11-29'], 'a week says its first and last day');
  assert.deepStrictEqual(d.journey.map((j) => j.key), ['students', 'applied', 'offered', 'mocked', 'passed', 'paid', 'cas', 'visa']);
  assert.deepStrictEqual([d.people[0].id, d.people[0].applied, d.people[0].offered, d.people[0].mocks, d.people[0].applications[0].university], ['a', '2026-11-23', '2026-11-25', ['2026-11-20'], 'Coventry University']);
  const j = journeyOf(gita, '2026-11-27');
  assert.deepStrictEqual([j.applications, j.hasOffer, j.mocks, j.lastMock, j.passed, j.paid, j.issued], [1, true, 1, '2026-11-20', false, '', false]);
});

test('no students: every figure is empty, none is a made-up one', () => {
  const d = branchInsights([], '2026-11-27');
  assert.ok(d.totals.every((t) => t.value === 0));
  assert.strictEqual(d.offerDays.average, null);
  assert.ok(d.rates.every((r) => r.value === null));
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
