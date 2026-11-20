// Mock interview guides and a student's own portal (the owner, 20 Nov 2026): drafts are never shown to a student, only Admin
// publishes, a student reads only the guides of the universities they applied to, and a student's login opens nothing else.
// All names and details here are made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createMockGuides, youtubeId } = require('../student-details/mock-guides');
const { createMockApi, guideAccess } = require('../student-details/mock-api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isr-mock-'));

test('the first drafts: the core guide and the Partner Universities only, none published', () => {
  const guides = createMockGuides(tmp(), { universities: () => ['University of West London', 'Bangor University', 'Made Up University'] });
  const list = guides.list();
  assert.deepStrictEqual(list.map((g) => g.key), ['core', 'bangoruniversity', 'universityofwestlondon']);
  assert.ok(list.every((g) => g.status === 'draft'), 'nothing is published by itself');
  assert.strictEqual(guides.view(null, 'published'), null, 'a student sees nothing before Admin publishes');
  assert.ok(guides.view(null, 'draft').phases.length === 5);
});

test('a published guide is the core text with the university\'s own text and questions; a later draft stays unseen until published', () => {
  const guides = createMockGuides(tmp(), { universities: () => ['University of West London'] });
  guides.publish('core', 'Owner');
  guides.publish('universityofwestlondon', 'Owner');
  const v = guides.view('universityofwestlondon');
  assert.strictEqual(v.name, 'University of West London');
  assert.ok(v.ownGuide);
  assert.match(v.phases.find((p) => p.key === 'university').own, /£250 deposit/);
  assert.ok(v.questions[0].own && v.questions.some((q) => !q.own), 'the university\'s questions first, then everyone\'s');
  const g = guides.get('universityofwestlondon');
  guides.saveDraft('universityofwestlondon', { draft: { ...g.draft, summary: 'Changed \u2014 with a long dash' }, confirm: 'Check this' }, 'Bikram');
  assert.strictEqual(guides.get('universityofwestlondon').status, 'changed');
  assert.notStrictEqual(guides.view('universityofwestlondon').summary, 'Changed - with a long dash', 'students still read the published copy');
  assert.strictEqual(guides.get('universityofwestlondon').draft.summary, 'Changed - with a long dash', 'no em dash is kept');
  guides.unpublish('universityofwestlondon', 'Owner');
  assert.ok(!guides.view('universityofwestlondon').ownGuide, 'taken back: only the core guide is left');
});

test('a guide is found by the university\'s name as the sheet writes it; videos keep only real YouTube links', () => {
  const guides = createMockGuides(tmp(), { universities: () => ['Northumbria University London (QA)', 'Ulster University (QA)'] });
  assert.strictEqual(guides.forName('Northumbria University London').key, 'northumbriauniversitylondon');
  assert.strictEqual(guides.forName('Ulster University').key, 'ulsteruniversity');
  assert.strictEqual(guides.forName('Bangor University'), null);
  assert.ok(guides.create('Ulster University', 'Owner').error, 'one guide per university');
  assert.strictEqual(youtubeId('https://youtu.be/6V1_L5Wp9Tw'), '6V1_L5Wp9Tw');
  assert.strictEqual(youtubeId('https://example.org/video'), '');
  const g = guides.get('ulsteruniversity');
  const phases = { ...g.draft.phases, university: { body: 'x', videos: [{ title: 'A', url: 'https://www.youtube.com/watch?v=6V1_L5Wp9Tw' }, { title: 'B', url: 'javascript:alert(1)' }], links: [{ title: 'L', url: 'http://not-secure.example.org' }] } };
  const saved = guides.saveDraft('ulsteruniversity', { draft: { ...g.draft, phases } }, 'Owner').guide;
  assert.strictEqual(saved.draft.phases.university.videos.length, 1);
  assert.strictEqual(saved.draft.phases.university.links.length, 0, 'only https links');
});

test('who works on the guides: Admin publishes; the Manager and the Mock Team edit; nobody else, never a student', () => {
  assert.strictEqual(guideAccess({ role: 'admin' }), 'publish');
  assert.strictEqual(guideAccess({ role: 'manager', departments: [] }), 'edit');
  assert.strictEqual(guideAccess({ role: 'staff', departments: ['mock'] }), 'edit');
  assert.strictEqual(guideAccess({ role: 'staff', departments: ['application'] }), null);
  assert.strictEqual(guideAccess({ role: 'student', departments: [] }), null);
});

test('a student\'s portal: their applications with the decision, the progress line, the mocks with feedback, and only their own guides', () => {
  const guides = createMockGuides(tmp(), { universities: () => ['University of West London', 'Bangor University'] });
  guides.publish('core', 'Owner');
  guides.publish('universityofwestlondon', 'Owner');
  const row = { _id: 'row-1', 'FIRST NAME': 'Sita', 'UNIVERSITY NAME': 'University of West London', 'MOCK SCHEDULE 1': '2026-11-10', 'FEEDBACK 1': 'Good, work on money answers.' };
  const apps = [
    { university: 'University of West London', course: 'MSc Cyber Security', applied: '2026-11-01', offer: '2026-11-05', offerType: 'Conditional' },
    { university: 'Bangor University', course: 'MSc Business', applied: '2026-11-02', refused: '2026-11-08', reason: 'Gap not explained' },
  ];
  const portal = { rowIndex: () => new Map([['row-1', { row, sheet: { name: 'Jan Intake 2027' } }]]), applicationsOf: () => apps };
  const api = createMockApi({ guides, portal, cards: { get: () => ({ options: [] }) }, facts: { list: () => [] }, activity: { record() {} }, isoDate: (v) => v });
  const me = api.studentView({ role: 'student', studentRow: 'row-1', name: 'Sita Example' });
  assert.strictEqual(me.firstName, 'Sita');
  assert.deepStrictEqual(me.applications.map((a) => [a.university, a.decision, a.main, a.guide]), [
    ['University of West London', 'Conditional offer', true, 'universityofwestlondon'],
    ['Bangor University', 'Refused', false, ''],
  ], 'Bangor\'s guide is a draft: not offered');
  assert.deepStrictEqual(me.progress.map((s) => s.state), ['done', 'done', 'now', 'next', 'next', 'next']);
  assert.deepStrictEqual(me.mocks, [{ n: 1, date: '2026-11-10', feedback: 'Good, work on money answers.' }]);
  const none = api.studentView({ role: 'student', studentRow: 'row-x', name: 'Nobody' });
  assert.strictEqual(none.linked, false);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a student\'s login opens their portal and nothing else; the team\'s guides refuse a student and the Application Team', { timeout: 120000 }, async (t) => {
  const dir = tmp();
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const person = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const tx = await res.text(); let json = null; try { json = JSON.parse(tx); } catch (e) { /* not JSON */ }
    return { status: res.status, json, location: res.headers.get('location') };
  }; };
  const admin = person();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' });
  await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' });
  const made = async (body) => { const m = (await admin('POST', '/api/users', body)).json; const p = person(); await p('POST', '/api/login', { username: body.username, password: m.temporaryPassword }); await p('POST', '/api/login/new-password', { password: 'Other-Strong-2026' }); return p; };
  const student = await made({ username: 'sita', name: 'Sita Example', email: '', role: 'student', studentRow: 'row-made-up' });
  const asha = await made({ username: 'asha', name: 'Asha', email: '', departments: ['application'] });
  const bikram = await made({ username: 'bikram', name: 'Bikram', email: '', departments: ['mock'] });

  for (const page of ['/today', '/students', '/fact-file', '/users']) assert.strictEqual((await student('GET', page)).location, '/my-portal', `${page} goes to the portal`);
  assert.strictEqual((await student('GET', '/my-portal')).status, 200);
  for (const url of ['/api/facts', '/api/mock-guides', '/api/workbook', '/api/shortlist']) assert.strictEqual((await student('GET', url)).status, 403, `${url} is refused`);
  assert.strictEqual((await student('GET', '/api/my-portal')).json.linked, false, 'a login not linked to a student on the sheet says so');

  assert.strictEqual((await asha('GET', '/api/mock-guides')).status, 403, 'the Application Team does not edit guides');
  const list = (await bikram('GET', '/api/mock-guides')).json;
  assert.strictEqual(list.canPublish, false);
  assert.strictEqual((await bikram('POST', '/api/mock-guides/core/publish', {})).status, 403, 'only Admin publishes');
  assert.strictEqual((await bikram('POST', '/api/mock-guides/core', { draft: { summary: '' }, confirm: '' })).status, 200, 'the Mock Team saves a draft');
  assert.strictEqual((await admin('POST', '/api/mock-guides/core', { draft: (await admin('GET', '/api/mock-guides/core')).json.draft })).status, 200);
});
