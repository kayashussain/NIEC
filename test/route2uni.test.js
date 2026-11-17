// The Route2Uni partner portal read into the Fact File (student-details/route2uni.js). The portal is never called here: a made-up
// portal answers (made-up universities and figures), so the test checks the reading, what changed between two readings, the names
// matched to the Fact File, and the twice-a-week schedule.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createRoute2Uni, keyOf, niceName } = require('../student-details/route2uni');

const uni = (id, name, fee, extra = {}) => ({
  universityId: id, universityName: name,
  basicInfo: { name, cities: [{ name: 'Testtown' }], websiteUrl: 'https://example.org/' },
  requiredDocuments: [{ name: 'Passport' }], optionalDocuments: [{ name: 'CV' }],
  entryRequirements: [{ courseLevelName: 'Postgraduate', gapAccepted: true, gapYearsAllowed: '5 years', criteria: ['Bachelor 55%'] }],
  englishProficiency: [{ courseLevelName: 'Postgraduate', hasWaiver: true, criteria: ['MOI accepted'] }],
  languageTests: [{ languageTestName: 'IELTS', courseLevelName: 'Postgraduate', requiredScore: '6.0 overall' }],
  feeStructures: [{ courseLevelName: 'Postgraduate', tuitionRange: [{ amount: fee, description: '1 year' }] }],
  scholarships: [{ courseLevelName: 'Postgraduate', amounts: ['£2,000'] }],
  intakePeriods: [{ intakeName: 'January 2027', active: true, deadlineInfo: 'Application deadline: 1 December 2026' }],
  courses: [{ name: 'MSc Testing', courseLevelName: 'Postgraduate', cityName: 'Testtown', intakeName: 'January 2027' }],
  ...extra,
});

function portal(state) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
    const p = url.replace('https://portal.route2unigroup.com/api', '');
    if (p === '/auth/login') { const b = JSON.parse(init.body); return b.password === 'right' ? json(200, { token: 'T1' }) : json(401, { message: 'Bad login' }); }
    if ((init.headers || {}).Authorization !== 'Bearer T1') return json(401, {});
    if (p.startsWith('/universities/pageable')) return json(200, { data: { content: state.unis.map((u) => ({ id: u.universityId })) } });
    const m = /^\/universities\/(\d+)$/.exec(p);
    if (m) return json(200, { data: state.unis.find((u) => String(u.universityId) === m[1]) });
    if (p.startsWith('/webinars')) return json(200, { data: { content: state.webinars || [] } });
    return json(200, { data: { content: [] } });
  };
  return { calls, fetchImpl };
}

test('reads the portal, says what changed, matches the Fact File names, and runs twice a week', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2u-'));
  const state = { unis: [uni(1, 'UNIVERSITY OF TESTTOWN', 12000), uni(2, 'ROEHAMPTON UNIVERSITY', 15000)] };
  const p = portal(state);
  let clock = new Date('2026-11-16T21:00:00Z'); // Tuesday 2:45 a.m. in Kathmandu
  const r2u = createRoute2Uni({ dir, email: 'office@example.org', password: 'right', fetchImpl: p.fetchImpl, now: () => clock, pause: 0 });
  assert.strictEqual(createRoute2Uni({ dir }).configured(), false, 'off without a login');
  assert.match((await createRoute2Uni({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'r2u-')), email: 'a@b.c', password: 'wrong', fetchImpl: p.fetchImpl, pause: 0 }).run()).error, /refused the login/);

  const first = await r2u.run('test');
  assert.deepStrictEqual(first, { ok: true, universities: 2, changed: 0 });
  assert.ok(p.calls.every((u) => u.startsWith('https://portal.route2unigroup.com/api/')), 'only the portal is called');
  const t = r2u.forName('University of Testtown');
  assert.strictEqual(t.name, 'University of Testtown');
  assert.deepStrictEqual(t.intakes, [{ name: 'January 2027', open: true, deadline: 'Application deadline: 1 December 2026' }]);
  assert.strictEqual(t.fees[0].items[0].amount, 12000);
  assert.ok(r2u.forName('University of Roehampton'), 'the same university under another name is matched');
  const sum = r2u.summary(['University of Testtown']);
  assert.deepStrictEqual(sum.missing.map((u) => u.name), ['Roehampton University'], 'what has no Fact File page yet');
  assert.strictEqual(sum.deadlines[0].deadline, 'Application deadline: 1 December 2026');
  assert.ok(!JSON.stringify(sum).includes('right'), 'the password is never kept or shown');
  assert.ok(!fs.readFileSync(path.join(dir, 'route2uni.json'), 'utf8').includes('right'));

  // A second reading: a fee went up, a course was added, a webinar was posted.
  state.unis[0] = uni(1, 'UNIVERSITY OF TESTTOWN', 12500, { courses: [{ name: 'MSc Testing', courseLevelName: 'Postgraduate', intakeName: 'January 2027' }, { name: 'MBA', courseLevelName: 'Postgraduate', intakeName: 'January 2027' }] });
  state.webinars = [{ id: 9, title: 'January intake briefing', startTime: '2026-11-20T09:00:00Z', description: 'For partners' }];
  const second = await r2u.run('test');
  assert.strictEqual(second.ok, true);
  const lines = r2u.summary([]).changes.flatMap((c) => c.lines);
  assert.ok(lines.includes('Fee changed, Postgraduate (1 year): £12,000 → £12,500'), lines.join(' | '));
  assert.ok(lines.some((l) => /^1 new course: MBA/.test(l)));
  assert.ok(lines.some((l) => /^Webinar: January intake briefing/.test(l)));
  assert.strictEqual(r2u.summary([]).hub.webinars[0].title, 'January intake briefing');

  // Twice a week: Monday and Thursday from 2 a.m. office time, once that day; never more than 4 days without a reading.
  assert.strictEqual(r2u.due(new Date('2026-11-17T12:00:00Z')), false, 'Tuesday: just read');
  assert.strictEqual(r2u.due(new Date('2026-11-18T23:00:00Z')), true, 'Thursday 4:45 a.m. office time');
  assert.strictEqual(r2u.due(new Date('2026-11-18T19:00:00Z')), false, 'Thursday 0:45 a.m.: not before 2 a.m.');
  clock = new Date('2026-11-19T00:00:00Z');
  await r2u.run('test');
  assert.strictEqual(r2u.due(new Date('2026-11-19T06:00:00Z')), false, 'once that day');
  assert.strictEqual(r2u.due(new Date('2026-11-23T21:00:00Z')), true, 'Monday from 2 a.m.');
});

test('names: the portal\'s capitals read as names, and its other spellings match the Fact File', () => {
  assert.strictEqual(niceName('UNIVERSITY OF WALES TRINITY SAINT DAVID'), 'University of Wales Trinity Saint David');
  assert.strictEqual(niceName('BATHSPA UNIVERSITY'), 'Bath Spa University');
  assert.strictEqual(keyOf('HARPER ADAMS UNIVERSITY\t\t'), keyOf('Harper Adams University'));
  assert.strictEqual(keyOf('UNIVERSITY OF WINCHESTER'), keyOf('Winchester University'));
  assert.strictEqual(keyOf('REGENT COLLEGE'), keyOf('Regent College London'));
});
