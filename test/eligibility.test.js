// Who can go where (student-details/eligibility.js) and one Fact File kept up to date from the partner portal
// (student-details/fact-sync.js). The universities and figures here are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../student-details/eligibility');
const { syncFacts, firstDate } = require('../student-details/fact-sync');
const { createFacts } = require('../student-details/facts');

const reading = (fee = 12000) => ({
  id: 7, name: 'University of Testtown', cities: ['Testtown'], website: 'https://example.org/',
  intakes: [{ name: 'January 2027', open: true, deadline: '• Application deadline - Friday 27 November 2026\n• Deposit - 9 December 2026' }, { name: 'May 2026', open: false, deadline: '' }],
  requirements: [
    { level: 'Undergraduate', gap: 'Not accepted', criteria: ['12th : GPA 2.8 or 60% or Above AND, 12th Math: 50% (2.4 GPA)', 'Foundation: 2.5 or 65%'] },
    { level: 'Postgraduate', gap: 'Up to 10 years', criteria: ['4 years Bachelor 55% or above', 'Three-year degree: Second Division'] },
  ],
  english: [{ level: 'Postgraduate', waiver: true, criteria: ['MOI accepted from TU and KU'] }],
  tests: [{ test: 'IELTS', level: 'Postgraduate', score: '6.0 overall (5.5 each)' }, { test: 'PTE', level: 'Postgraduate', score: '59 overall' }, { test: 'SELT', level: 'Postgraduate', score: 'B2' }, { test: 'IELTS', level: 'Undergraduate', score: '6.0 overall' }],
  fees: [{ level: 'Postgraduate', items: [{ amount: fee, text: '1 Year Fee:' }, { amount: 5000, text: 'CAS Deposit' }] }],
  scholarships: [{ level: 'Postgraduate', amounts: ['£2,000'] }],
  documents: { required: ['Passport'], optional: [] },
  courses: [{ name: 'MSc Data Science', level: 'Postgraduate', campus: 'London', intake: 'January 2027' }, { name: 'BSc Nursing', level: 'Undergraduate', campus: '', intake: 'January 2027' }],
});

test('the rules are read into numbers, generously and without a subject line taken as the grade', () => {
  const rules = E.rulesFrom(reading());
  const ug = rules.find((r) => r.level === 'Undergraduate');
  const pg = rules.find((r) => r.level === 'Postgraduate');
  assert.deepStrictEqual([ug.minGpa, ug.minPercent, ug.gap], [2.5, 60, 0], 'the lowest route counts, the 12th Math line does not');
  assert.deepStrictEqual([pg.minPercent, pg.gap, pg.tests.IELTS, pg.tests.PTE, pg.waiver], [45, 10, 6, 59, true], 'Second Division is 45%');
  assert.strictEqual(pg.tests.SELT, undefined, 'a CEFR level (B2) is not a score');
  assert.strictEqual(E.ourLevel('International Year One'), 'International Year 1');
  assert.strictEqual(E.ourLevel('Upper Tier UG Course (YORK Campus)'), 'Undergraduate');
});

test('a student is checked with reasons: eligible, to check, or not eligible with what is needed', () => {
  const rules = E.rulesFrom(reading());
  const check = (input) => E.checkLevel(rules, E.studentFrom(input));
  const ok = check({ level: 'Postgraduate', grade: '62%', gap: '4', test: 'IELTS Academic', score: '6.5', band: '6.0' });
  assert.strictEqual(ok.status, 'yes');
  assert.deepStrictEqual(ok.reasons.map((r) => r.text), ['62% meets 45%', 'Gap of 4 years is within 10', 'IELTS Academic 6.5 overall meets 6.0', 'Lowest band 6.0 meets 5.5 in each part']);
  const low = check({ level: 'Postgraduate', grade: '62%', gap: '12', test: 'IELTS Academic', score: '5.5' });
  assert.strictEqual(low.status, 'no');
  assert.ok(low.reasons.some((r) => r.text === 'Needs IELTS Academic 6.0 overall (has 5.5)'));
  assert.ok(low.reasons.some((r) => r.text === 'Gap of 12 years is over the 10 allowed'));
  assert.strictEqual(check({ level: 'Postgraduate', grade: '3.0', gap: '1', test: 'MOI or Waiver' }).status, 'check', 'a waiver is for a person to decide');
  assert.strictEqual(check({ level: 'Postgraduate', grade: '2.6', gap: '0', test: 'PTE Academic', score: '60' }).reasons[0].text, 'GPA 2.6 (about 55%) meets 45%', 'a GPA against a percentage, by the NEB scale');
  assert.strictEqual(check({ level: 'Undergraduate', grade: '3.0', gap: '2', test: 'IELTS UKVI', score: '6' }).status, 'check', 'a gap where none is accepted is for a person to check');
  assert.strictEqual(check({ level: 'Pre-Masters', grade: '3.0' }), null, 'no rules for that level');
});

test('one Fact File: the portal is written into the university\'s own page, the team\'s own words are kept', () => {
  const facts = createFacts(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')));
  const made = facts.create('University of Testtown', 'Owner').university;
  facts.update(made.id, { ...made, overview: 'Our own overview.', notes: 'Ask Ram about this one.', intakes: [{ name: 'September 2027', notes: 'Our own intake' }] }, 'Owner');
  assert.deepStrictEqual(syncFacts(facts, { fetchedAt: '2026-11-17T10:00:00.000Z', universities: [reading()] }), { updated: 1, added: 0, unchanged: 0 });
  let u = facts.get(made.id);
  assert.strictEqual(u.overview, 'Our own overview.');
  assert.strictEqual(u.notes, 'Ask Ram about this one.');
  assert.deepStrictEqual(u.intakes.map((i) => [i.name, i.deadline]), [['January 2027', 'Friday 27 November 2026'], ['September 2027', '']], 'the open intake with its deadline; a closed one is not added; the team\'s own intake stays');
  assert.match(u.intakes[0].deadlines, /Deposit - 9 December 2026/);
  const pg = u.programs.find((p) => p.name === 'Postgraduate');
  assert.deepStrictEqual([pg.tuition, pg.deposit, pg.scholarship], ['1 Year Fee: £12,000', 'CAS Deposit: £5,000', '£2,000']);
  assert.match(pg.english, /IELTS: 6.0 overall/);
  assert.match(u.courses, /## Postgraduate\n- MSc Data Science \(London\)/);
  assert.strictEqual(u.city, 'Testtown');
  assert.strictEqual(u.rules.find((r) => r.level === 'Postgraduate').minPercent, 45);
  // The same reading again changes nothing; a new fee is written; a university the Fact File lacks is added.
  assert.strictEqual(syncFacts(facts, { fetchedAt: '2026-11-20T10:00:00.000Z', universities: [reading()] }).unchanged, 1);
  const second = syncFacts(facts, { fetchedAt: '2026-11-24T10:00:00.000Z', universities: [reading(12500), { ...reading(), id: 8, name: 'University of Elsewhere' }] });
  assert.deepStrictEqual(second, { updated: 2, added: 1, unchanged: 0 });
  u = facts.get(made.id);
  assert.strictEqual(u.programs.find((p) => p.name === 'Postgraduate').tuition, '1 Year Fee: £12,500');
  // A save from the page keeps the portal's dates and rules.
  facts.update(made.id, { ...u, rules: undefined, source: undefined, intakes: u.intakes.map((i) => ({ ...i })) }, 'Owner');
  assert.ok(facts.get(made.id).rules.length && facts.get(made.id).source.route2uni.id === 7);
  assert.strictEqual(firstDate('Application Deadline: 6 NOVEMBER 2026'), '6 NOVEMBER 2026');
});

test('on the server: a reading is written into the Fact File at the start, and the finder answers the team and a student', { timeout: 120000 }, async (t) => {
  const net = require('node:net');
  const { spawn } = require('node:child_process');
  const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-elig-'));
  fs.writeFileSync(path.join(dir, 'route2uni.json'), JSON.stringify({ fetchedAt: '2026-11-17T10:00:00.000Z', universities: [reading()], hub: { deadlines: [], notices: [], webinars: [] }, changes: [], runs: [{ at: '2026-11-17T10:00:00.000Z', ok: true }] }));
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir }, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const page = (await admin('GET', '/api/facts')).json.find((u) => u.name === 'University of Testtown');
  assert.ok(page, 'the portal\'s university is in the Fact File');
  assert.match((await admin('GET', `/api/facts/${page.id}`)).json.intakes[0].deadlines, /27 November 2026/);
  const find = await admin('POST', '/api/eligibility', { level: 'Postgraduate', grade: '62%', gap: '3', test: 'IELTS Academic', score: '6.5', band: '6', subject: 'data' });
  assert.strictEqual(find.status, 200);
  const r = find.json.results.find((x) => x.name === 'University of Testtown');
  assert.deepStrictEqual([r.status, r.courses.map((c) => c.name), r.fee, r.intake.deadline], ['yes', ['MSc Data Science'], '1 Year Fee: £12,000', 'Friday 27 November 2026']);
  const all = await admin('POST', '/api/eligibility', { level: 'Postgraduate', grade: '62%', gap: '3', test: 'IELTS Academic', score: '6.5', band: '6' });
  assert.ok(all.json.results.length > 10, 'the pages typed by hand are checked too, not only the portal\'s');
  assert.strictEqual((await admin('POST', '/api/eligibility', { grade: '3' })).status, 400, 'the level is needed');
  // A student's own login uses the finder too.
  const sid = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Mina', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000131' } })).json.id;
  const made = (await admin('POST', '/api/users', { username: 'mina', name: 'Mina Demo', email: '', role: 'student', studentRow: sid })).json;
  const stu = person();
  await stu('POST', '/api/login', { username: 'mina', password: made.temporaryPassword }); await stu('POST', '/api/login/new-password', { password: 'Student-Strong-2026' });
  assert.strictEqual((await stu('POST', '/api/eligibility', { level: 'Postgraduate', grade: '40%' })).json.results.find((x) => x.name === 'University of Testtown').status, 'no');
  // No "Submit application" any more (the owner, 17 Nov 2026): the team shortlists courses on the card and sends them, numbered, to
  // the Application Team in one go.
  assert.notStrictEqual((await admin('POST', '/api/apply', { universityId: page.id, course: 'MSc Data Science', studentId: sid })).status, 200);
  const o1 = (await admin('POST', `/api/cards/${sid}/options`, { universityId: page.id, university: page.name, course: 'MSc Data Science', intake: 'January 2027' })).json.option;
  const o2 = (await admin('POST', `/api/cards/${sid}/options`, { universityId: page.id, university: page.name, course: 'MSc Testing', intake: 'January 2027' })).json.option;
  assert.strictEqual((await admin('POST', `/api/cards/${sid}/options/send`, { ids: [] })).status, 400, 'something to send');
  const sent = await admin('POST', `/api/cards/${sid}/options/send`, { ids: [o2.id, o1.id], note: 'Documents complete.' });
  assert.strictEqual(sent.status, 200);
  const card = (await admin('GET', `/api/cards/${sid}`)).json.card;
  const task = card.tasks.find((x) => /^Apply for Mina Demo: 2 courses in this order/.test(x.text));
  assert.ok(task && task.team === 'application' && !task.done);
  assert.strictEqual(task.comments[0].text, `1. MSc Testing at ${page.name} (January 2027)\n2. MSc Data Science at ${page.name} (January 2027)\n\nDocuments complete.`);
  assert.deepStrictEqual(['MSc Testing', 'MSc Data Science'].map((c) => card.options.find((o) => o.course === c).rank), ['1', '2']);
  assert.ok(card.options.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.sent)));
});

test('English: the overall score and the lowest band; a hand-written page is read too', () => {
  assert.deepStrictEqual([E.overallOf('6.0 overall (5.5 in each component)'), E.bandOf('6.0 overall (5.5 in each component)')], [6, 5.5]);
  assert.strictEqual(E.bandOf('6.5 overall with no band less than 6.0'), 6);
  assert.strictEqual(E.bandOf('105 overall (Reading: 100, Speaking, Writing, Listening: 95)'), 95);
  assert.strictEqual(E.bandOf('79 overall'), null);
  const rules = E.rulesFrom({ requirements: [{ level: 'Postgraduate', gap: '10', criteria: ['Bachelor 55%'] }], tests: [{ test: 'PTE', level: 'Postgraduate', score: '59 overall (59 in each component)' }], english: [] });
  const s = (score, band) => E.checkLevel(rules, E.studentFrom({ level: 'Postgraduate', grade: '60%', gap: '1', test: 'PTE Academic', score, band }));
  assert.strictEqual(s('60', '57').status, 'no', '60 overall with a 57 where 59 in each part is asked');
  assert.ok(s('60', '57').reasons.some((r) => r.text === 'Needs 59 in each part (lowest band is 57)'));
  assert.strictEqual(s('60', '59').status, 'yes');
  assert.strictEqual(s('60', '').status, 'check', 'without the lowest band, a person checks');
  // A page typed by hand: its table of requirements is read the same way.
  const page = E.rulesFromPage({ programs: [{ name: 'Postgraduate (MBA, MSc)', academic: 'Bachelor degree with 50% or above\nStudy gap: up to 5 years', english: 'IELTS 6.0 (5.5 in each band)\nMOI accepted from TU' }] });
  assert.deepStrictEqual([page[0].level, page[0].minPercent, page[0].gap, page[0].tests.IELTS, page[0].bands.IELTS, page[0].waiver], ['Postgraduate', 50, 5, 6, 5.5, true]);
});

test('a course page is matched on the university\'s own website by its words and its degree', () => {
  const { matchCourse, urlKey } = require('../student-details/course-sitemap');
  const pages = ['https://www.example.ac.uk/courses/postgraduate/msc-data-science', 'https://www.example.ac.uk/courses/postgraduate/msc-data-science-with-artificial-intelligence-and-robotics',
    'https://www.example.ac.uk/courses/undergraduate/bsc-hons-computer-science', 'https://www.example.ac.uk/courses/postgraduate/ma-marketing'].map((url) => ({ url, key: urlKey(url) }));
  assert.strictEqual(matchCourse('MSc Data Science (London)', pages), 'https://www.example.ac.uk/courses/postgraduate/msc-data-science');
  assert.strictEqual(matchCourse('BSc (Hons) Computer Science', pages), 'https://www.example.ac.uk/courses/undergraduate/bsc-hons-computer-science');
  assert.strictEqual(matchCourse('MSc Marketing', pages), '', 'an MA page is not an MSc course');
  assert.strictEqual(matchCourse('MSc Cyber Security', pages), '', 'no page: left for a person');
});
