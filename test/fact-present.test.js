// How a university's page is shown (student-details/fact-present.js): every fact in its one section, nothing twice, the owner's words
// for the English terms. The pages here are made up by Claude for this test (no real university's figures).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../student-details/fact-present');

const NOW = new Date('2026-11-17T09:00:00Z');
const page = (extra = {}) => ({
  name: 'Testtown College', city: 'London',
  overview: '- Intake: January 2027.\n- Levels: Undergraduate, Postgraduate.\n- Campuses: London.\n- No pre-CAS interview.',
  location: 'Campuses: London.',
  entryRequirements: 'The academic entry and the study gap allowed for each course level are in the table above.',
  languageTests: 'The English tests and scores for each course level are in the table above.\n## English waiver\n- Undergraduate: possible',
  programs: [
    { name: 'Undergraduate', academic: '12th Grade 55%\nStudy gap: 2 years', english: 'IELTS: 6.0\nEnglish waiver possible:\n- 12th Grade English 60%', tuition: '£15,000', scholarship: 'Up to £3,000', deposit: '' },
    { name: 'Postgraduate', academic: 'Bachelor 60%', english: 'IELTS: 6.5\nEnglish waiver possible:\n- 12th Grade English 60%', tuition: '£16,000', scholarship: '', deposit: '' },
  ],
  courses: '## Undergraduate\n- BSc Made-up Studies (London)\n## Postgraduate\n- MSc Pretend Science (London)',
  intakes: [{
    id: 'aaaaaaaaaaaa', name: 'January 2027', deadline: '', deadlines: '', requirements: '', courses: '',
    notes: '## Key Dates for January 2027 Intake\n- Course application deadline: 30 November 2026\n- CAS submission deadline: 11 December 2026\n- Latest arrival date: 25 January 2027',
  }],
  process: ['Application submitted', 'Offer letter received', 'Pre-CAS interview', 'Tuition deposit paid', 'CAS issued', 'Visa application'].map((title) => ({ title, detail: '' })),
  notes: '- Checked on the official website on 6 November 2026 (this page keeps the figures above until a person decides):\n- Source: made-up sheet.',
  interview: '', website: '', updatedAt: '2026-11-17T08:00:00Z',
  ...extra,
});

test('the dates of an intake are at the top, once, with the days left; never in the notes', () => {
  const v = P.present(page(), { now: NOW });
  assert.strictEqual(v.deadlines.length, 1);
  const d = v.deadlines[0];
  assert.deepStrictEqual(d.applyBy, { when: '30 November 2026', days: 13, closed: false, note: '' });
  assert.deepStrictEqual(d.dates.map((x) => [x.label, x.when, x.days]), [['CAS submission deadline', '11 December 2026', 24], ['Latest arrival date', '25 January 2027', 69]]);
  assert.strictEqual(d.notes, '', 'the "Key Dates" heading went with its dates');
  assert.strictEqual(v.notes, '', 'where a figure was checked is not for the team');
});

test('nothing is said twice: no pointer to the table, no repeated intake, level or campus, no starting steps', () => {
  const v = P.present(page(), { now: NOW });
  assert.deepStrictEqual(v.more, [], '"in the table above" and "Undergraduate: possible" say nothing the table does not');
  assert.strictEqual(v.overview, '- No pre-CAS interview.');
  assert.strictEqual(v.location, '');
  assert.deepStrictEqual(v.process, [], 'the empty starting steps are not shown');
  assert.deepStrictEqual(v.columns.map((c) => c[0]), ['academic', 'english', 'tuition', 'scholarship'], 'an empty column is left out');
  assert.deepStrictEqual(v.courses.map((c) => [c.course, c.group]), [['BSc Made-up Studies', 'Undergraduate'], ['MSc Pretend Science', 'Postgraduate']], 'the campus said once, by the city');
  assert.strictEqual(v.programs[0].english, 'IELTS: 6.0\nEnglish Waiver possible:\n- 12th Grade English 60%');
});

test('several dates on one line become one each, the same date for every level is one line, and "Closed" is shown as closed', () => {
  const v = P.present(page({ intakes: [
    { id: 'bbbbbbbbbbbb', name: 'January 2027', deadline: 'Standard CAS request by 12/18/2026', deadlines: '', requirements: '', courses: '',
      notes: '- IY1: starts 11 Jan 2027, ends 24 Aug 2029, standard CAS request by 17 Dec 2026\n- Postgraduate: starts 11 Jan 2027, ends 14 Jan 2028, standard CAS request by 17 Dec 2026' },
    { id: 'cccccccccccc', name: 'May 2027', deadline: 'Closed', deadlines: '', requirements: '', courses: '', notes: '' },
  ], notes: '' }), { now: NOW });
  const [jan, may] = v.deadlines;
  assert.strictEqual(jan.applyBy, null, 'a CAS date is not "Apply by"');
  assert.deepStrictEqual(jan.dates.map((x) => `${x.label}: ${x.when}`), ['Standard CAS request: 17 Dec 2026', 'Standard CAS request: 18 Dec 2026', 'Starts: 11 Jan 2027']);
  assert.deepStrictEqual([may.applyBy.closed, may.applyBy.when], [true, 'Closed']);
});

test('the owner\'s words: University Internal Test, MOI, Waiver, no shouting', () => {
  assert.strictEqual(P.tidyTerms('FREE University Test is available'), 'Free University Internal Test is available');
  assert.strictEqual(P.tidyTerms('moi accepted; english waiver possible'), 'MOI accepted; English Waiver possible');
  assert.strictEqual(P.tidyTerms('FREE INTERNAL ENGLISH TEST (ELPT)'), 'Free University Internal Test (ELPT)');
  assert.strictEqual(P.tidyTerms('English waiver: English Waiver if B in Grade 12'), 'English Waiver if B in Grade 12');
  assert.strictEqual(P.tidyTerms('Duolingo:100/95 BUT NOT ACCEPTED FOR NURSING'), 'Duolingo: 100/95 but not accepted for nursing');
  assert.strictEqual(P.tidyTerms('OPEN FOR JAN 2027'), 'Open for Jan 2027');
});
