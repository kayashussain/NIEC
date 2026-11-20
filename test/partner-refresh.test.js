// The Thursday refresh (the owner, 20 Nov 2026): the universities' January 2027 courses are read again from Real Dreams (Route2Uni)
// and Adventus with the logins on their B2B cards. No real portal is reached here: the answers are made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFacts } = require('../student-details/facts');
const { createPartnerRefresh, fromRoute2Uni, thursdayDue } = require('../student-details/partner-refresh');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-refresh-'));
const UNI = {
  entryRequirements: [{ courseLevelName: 'Postgraduate', criteria: ['Bachelor 55%'], gapAccepted: true, gapYearsAllowed: 'Up to 5 years' }],
  languageTests: [{ courseLevelName: 'Postgraduate', languageTestName: 'IELTS', requiredScore: '6.0 overall' }],
  feeStructures: [{ courseLevelName: 'Postgraduate', tuitionRange: [{ description: 'Gross fee', amount: 16000 }] }],
  scholarships: [], englishProficiency: [],
  intakePeriods: [{ intakeName: 'January 2027', deadlineInfo: 'Application deadline - 27 November 2026', active: true }],
  courses: [{ name: 'MSc Made Up Studies', courseLevelName: 'Postgraduate', intakeName: 'January 2027', cityName: 'London' }, { name: 'MSc Old Course', courseLevelName: 'Postgraduate', intakeName: 'September 2026' }],
};

test('a Route2Uni page becomes January 2027 courses, a requirement card per level and the dates', () => {
  const d = fromRoute2Uni(UNI);
  assert.deepStrictEqual(d.courses.map((c) => c.name), ['MSc Made Up Studies'], 'only January 2027');
  assert.strictEqual(d.levels[0].level, 'Postgraduate');
  assert.match(d.levels[0].english, /IELTS: 6.0/);
  assert.match(d.levels[0].tuition, /£16,000/);
  assert.deepStrictEqual(d.deadlines, ['Application deadline - 27 November 2026']);
});

test('it runs on Thursday from 2 a.m. office time, once that day', () => {
  const thu = new Date('2026-11-26T00:00:00Z'); // 5:45 a.m. in Kathmandu, a Thursday
  const wed = new Date('2026-11-25T06:00:00Z');
  assert.strictEqual(thursdayDue([{ at: '2026-11-19T01:00:00Z', ok: true }], thu), true);
  assert.strictEqual(thursdayDue([{ at: '2026-11-19T01:00:00Z', ok: true }], wed), false);
  assert.strictEqual(thursdayDue([{ at: '2026-11-25T23:30:00Z', ok: true }], thu), false, 'not twice the same day');
});

test('a refresh puts the fresh courses on the page, and an empty answer keeps the last ones', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  const pages = facts.refreshable().filter((p) => p.source.partner === 'Real Dreams').slice(0, 2);
  facts.refreshable = () => pages;
  const b2b = { all: () => [{ name: 'Real Dreams', applyUser: 'made-up@example.org', applyPassword: 'made-up' }] };
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url);
    if (/auth\/login/.test(url)) return new Response(JSON.stringify({ token: 't', type: 'Bearer' }), { status: 200 });
    const id = Number(/universities\/(\d+)/.exec(url)[1]);
    const empty = id === pages[1].source.r2u;
    return new Response(JSON.stringify({ data: empty ? { ...UNI, courses: [] } : UNI }), { status: 200 });
  };
  const before = facts.get(pages[1].id).profile.courses.length;
  const lines = [];
  const pr = createPartnerRefresh({ dir, facts, b2b, fetchImpl, record: (l) => lines.push(...l) });
  const out = await pr.run('test');
  assert.deepStrictEqual([out.read, out.kept, out.failed.length], [1, 1, 0]);
  assert.deepStrictEqual(facts.get(pages[0].id).profile.courses.map((c) => c.name), ['MSc Made Up Studies']);
  assert.strictEqual(facts.get(pages[1].id).profile.courses.length, before, 'an empty answer never empties a page');
  assert.ok(facts.get(pages[0].id).profile.logo, 'the pictures and logo stay');
  assert.ok(lines.some((l) => /1 universities updated/.test(l)), 'written in Activity');
  assert.ok(calls.every((u) => u.startsWith('https://portal.route2unigroup.com/')));
  assert.ok(pr.lastRun().ok);
});

test('without a login on the B2B card nothing is read and Activity says why', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  const lines = [];
  const pr = createPartnerRefresh({ dir, facts, b2b: { all: () => [] }, fetchImpl: async () => { throw new Error('no call expected'); }, record: (l) => lines.push(...l) });
  const out = await pr.run('test');
  assert.strictEqual(out.read, 0);
  assert.ok(lines.some((l) => /Real Dreams: no login/.test(l)) && lines.some((l) => /Adventus: no login/.test(l)) && lines.some((l) => /Apply Board/.test(l)));
});
