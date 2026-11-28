// The Mock Team's own side (the owner, 22 Nov 2026): its menu rule, Bookings (slots, the student's booking page, the window after a
// mock that writes MOCK SCHEDULE n and FEEDBACK n), the sheet only to look at, Missing details on Today and Interview guidelines.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Teams = require('../shared/teams');
const { createMockBookings, cleanTeamsLink, cleanWindows, calendarInvite } = require('../student-details/mock-bookings');
const { createMockGuidelines } = require('../student-details/mock-guidelines');
const { docxPreview } = require('../student-details/docx-preview');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test('the Mock Team rule: their own team is Mock, never Admin or the Manager', () => {
  assert.strictEqual(Teams.ownTeamMock({ role: 'staff', departments: ['mock'] }), true);
  assert.strictEqual(Teams.ownTeamMock({ role: 'staff', departments: ['mock', 'application'] }), false);
  assert.strictEqual(Teams.ownTeamMock({ role: 'staff', departments: ['mock', 'application'], taskTeam: 'mock' }), true);
  assert.strictEqual(Teams.ownTeamMock({ role: 'staff', departments: ['application'] }), false);
  assert.strictEqual(Teams.ownTeamMock({ role: 'manager', departments: ['mock'] }), false);
  assert.strictEqual(Teams.ownTeamMock({ role: 'admin', departments: [] }), false);
  // The Application Team's own rule is unchanged.
  assert.strictEqual(Teams.ownTeamApplication({ role: 'staff', departments: ['application'] }), true);
  assert.strictEqual(Teams.ownTeamApplication({ role: 'staff', departments: ['mock'] }), false);
});

test('a Teams link must be a real Microsoft Teams address; slots must make sense', () => {
  assert.ok(cleanTeamsLink('https://teams.live.com/meet/9300000000000?p=abc'));
  assert.ok(cleanTeamsLink('https://teams.microsoft.com/l/meetup-join/abc'));
  assert.strictEqual(cleanTeamsLink('https://evil.example.com/meet'), null);
  assert.strictEqual(cleanTeamsLink('http://teams.live.com/meet/1'), null, 'never plain http');
  assert.strictEqual(cleanTeamsLink('javascript:alert(1)'), null);
  assert.strictEqual(cleanTeamsLink(''), '');
  assert.deepStrictEqual(cleanWindows([['11:30', '12:30'], ['10:00', '10:30']]), [['10:00', '10:30'], ['11:30', '12:30']]);
  assert.strictEqual(cleanWindows([['10:00', '09:00']]), null, 'an end before its start');
  assert.strictEqual(cleanWindows([['10:00', '11:00'], ['10:30', '11:30']]), 'overlap');
  assert.strictEqual(cleanWindows([['25:00', '26:00']]), null);
});

test('bookings: free slots, booking, the mock number, cancelling, reminders and the answer', () => {
  const dir = tmp('sr360-bookings-');
  let now = new Date('2026-11-22T04:15:00Z'); // Sunday 22 Nov 2026, 10:00 in Nepal
  const B = createMockBookings(dir, { now: () => now, timeZone: 'Asia/Kathmandu' });
  assert.strictEqual(B.momentOf('2026-11-22', '10:00').toISOString(), '2026-11-22T04:15:00.000Z', 'Nepal is 5 hours 45 minutes ahead');
  assert.match(B.saveSetup('u1', { teams: 'https://example.com/x', slug: 'bikram' }).error, /Teams/);
  assert.match(B.saveSetup('u1', { teams: 'https://teams.live.com/meet/1', slug: 'A b' }).error, /link name/);
  assert.ok(B.saveSetup('u1', { teams: 'https://teams.live.com/meet/1', slug: 'bikram', shown: 'Bikram, Mock Team', email: 'bikram@gmail.com' }).person);
  assert.match(B.saveSetup('u2', { teams: 'https://teams.live.com/meet/2', slug: 'bikram' }).error, /taken/);
  assert.strictEqual(B.ownerBySlug('bikram'), 'u1');
  assert.match(B.saveSlots('u1', { minutes: 30, ahead: 7, notice: 60, weekly: { 0: [['10:00', '09:00']] } }).error, /Sunday/);
  assert.ok(B.saveSlots('u1', { minutes: 30, ahead: 7, notice: 60, weekly: { 0: [['10:00', '10:30'], ['11:30', '12:30']], 1: [['10:00', '11:00']] }, dates: { '2026-11-23': [] } }).person);
  const free = B.freeSlots('u1');
  // Today: 10:00 is too soon (less than an hour), 11:30 and 12:00 are free; Monday 23 is a day off; Sunday 29 is open again.
  assert.deepStrictEqual(free.days[0].times.map((t) => t.time), ['11:30', '12:00']);
  assert.ok(!free.days.some((d) => d.day === '2026-11-23'), 'the day off has no slots');
  assert.ok(free.days.some((d) => d.day === '2026-11-29'));
  assert.ok(!free.days.some((d) => d.day === '2026-11-30'), 'Monday 30 is past the 7 days');
  const student = { rowId: 'r1', mock: 2, university: 'Test University', course: 'MSc Test' };
  const match = (email) => (email === 'sita@example.com' ? student : null);
  assert.match(B.book('u1', { day: '2026-11-22', time: '10:00', name: 'Sita', email: 'sita@example.com' }, match).error, /no longer free/);
  assert.match(B.book('u1', { day: '2026-11-22', time: '11:30', name: '', email: 'sita@example.com' }, match).error, /name/);
  const one = B.book('u1', { day: '2026-11-22', time: '11:30', name: 'Sita Example', email: 'Sita@Example.com', phone: '9800000000' }, match, 'https://sr360.example');
  assert.ok(one.booking, JSON.stringify(one));
  assert.strictEqual(one.booking.mock, 2, 'the next mock not held yet');
  assert.strictEqual(one.booking.university, 'Test University');
  assert.match(B.book('u1', { day: '2026-11-22', time: '11:30', name: 'Ram', email: 'ram@example.com' }, match).error, /no longer free/, 'a booked slot is taken');
  const two = B.book('u1', { day: '2026-11-22', time: '12:00', name: 'Sita Example', email: 'sita@example.com' }, match);
  assert.strictEqual(two.booking.mock, 3, 'a second booking of the same student waiting takes the next number');
  assert.strictEqual(B.byToken(one.booking.token).id, one.booking.id);
  assert.strictEqual(B.byToken('nonsense'), null);
  assert.ok(B.cancel(two.booking.id, 'Sita').booking);
  assert.ok(B.freeSlots('u1').days[0].times.some((t) => t.time === '12:00'), 'a cancelled slot is free again');
  const full = B.book('u1', { day: '2026-11-22', time: '12:00', name: 'X Y', email: 'x@example.com' }, () => ({ rowId: 'r9', mock: 0 }));
  assert.strictEqual(full.booking.rowId, '', 'all four held: booked as not matched, the page never says why');
  B.cancel(full.booking.id, 'test');
  const odd = B.book('u1', { day: '2026-11-22', time: '12:00', name: 'Win http://evil.example', email: 'y@example.com' }, () => null);
  assert.ok(!/[:/]/.test(odd.booking.name), 'no link or address in a name');
  B.cancel(odd.booking.id, 'test');
  // Reminders: the booking 1.5 hours away gets the day-before one marked already, then the hour-before one when the time comes.
  assert.deepStrictEqual(B.dueReminders(), []);
  now = new Date('2026-11-22T04:50:00Z'); // 10:35, 55 minutes before
  assert.deepStrictEqual(B.dueReminders().map((x) => x.kind), ['hourBefore']);
  B.markSent(one.booking.id, 'hourBefore');
  assert.deepStrictEqual(B.dueReminders(), []);
  assert.strictEqual(B.changeable(B.get(one.booking.id)), false, 'less than an hour before: no change');
  now = new Date('2026-11-22T06:30:00Z');
  const done = B.answer(one.booking.id, { joined: true, feedback: 'Good', result: 'ready', by: 'Bikram', mock: 2 });
  assert.strictEqual(done.booking.answer.result, 'ready');
  const ics = calendarInvite({ booking: one.booking, start: B.momentOf('2026-11-22', '11:30'), end: B.momentOf('2026-11-22', '12:00'), title: 'Mock 2: Sita', description: 'x', location: 'https://teams.live.com/meet/1', organizer: 'bikram@gmail.com' });
  assert.match(ics, /DTSTART:20261122T054500Z/);
  // A damaged file is set aside, never written over.
  fs.writeFileSync(path.join(dir, 'mock-bookings.json'), '{ broken');
  assert.deepStrictEqual(createMockBookings(dir).all().bookings, []);
  assert.ok(fs.readdirSync(dir).some((f) => /^mock-bookings\.damaged-/.test(f)));
});

// A small real .docx: a zip (stored, without packing) of the three parts the reader opens.
function zipOf(files) {
  const parts = []; const central = []; let at = 0;
  Object.entries(files).forEach(([name, text]) => {
    const n = Buffer.from(name); const data = Buffer.from(text);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(n.length, 28); head.writeUInt32LE(at, 42);
    parts.push(local, n, data); central.push(head, n); at += 30 + n.length + data.length;
  });
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dirBytes, end]);
}
const para = (text, pPr = '', rPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const numbered = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const wordFile = () => zipOf({
  'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${para('Credibility interview', '<w:pStyle w:val="Heading1"/>')}${para('Be honest &amp; &lt;clear&gt;.', '', '<w:b/>')}${para('Why this course?', numbered)}${para('Why the UK?', numbered)}<w:tbl><w:tr><w:tc>${para('Fee')}</w:tc><w:tc>${para('GBP 14,000')}</w:tc></w:tr></w:tbl></w:body></w:document>`,
  'word/styles.xml': '<w:styles><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
  'word/numbering.xml': '<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
});

test('a Word guideline is read as headings, words, numbered lists and tables; markup in it stays plain words', () => {
  const doc = docxPreview(wordFile());
  assert.strictEqual(doc.truncated, false);
  assert.deepStrictEqual(doc.blocks[0], { t: 'h', runs: [{ s: 'Credibility interview' }], level: 2 });
  assert.deepStrictEqual(doc.blocks[1].runs, [{ s: 'Be honest & <clear>.', b: true }]);
  assert.deepStrictEqual(doc.blocks.slice(2, 4).map((b) => [b.label, b.runs[0].s]), [['1.', 'Why this course?'], ['2.', 'Why the UK?']]);
  assert.deepStrictEqual(doc.blocks[4].rows[0].map((c) => c.blocks[0].runs[0].s), ['Fee', 'GBP 14,000']);
  assert.throws(() => docxPreview(Buffer.from('PK not a zip at all, only the first two letters')));
});

test('interview guidelines: only real files of the right kinds, kept under their own id', () => {
  const dir = tmp('sr360-guides-');
  const G = createMockGuidelines(dir);
  const pdfBytes = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 32)]);
  const pdf = pdfBytes();
  assert.match(G.add({ university: 'Test University', kind: 'Credibility interview guidelines', source: 'From the University', name: 'a.pdf', bytes: Buffer.from('not a pdf') }).error, /not really/);
  assert.match(G.add({ university: 'Test University', kind: 'Anything', source: 'From the University', name: 'a.pdf', bytes: pdf }).error, /kind/);
  assert.match(G.add({ university: 'Test University', kind: 'Other', source: 'From the University', name: 'a.exe', bytes: pdf }).error, /PDF/);
  const made = G.add({ university: 'Test University', kind: 'UKVI interview guidelines', source: 'From a student', title: '', name: '../../guide.pdf', bytes: pdf, by: 'Bikram' });
  assert.ok(made.file, JSON.stringify(made));
  assert.strictEqual(made.file.title, 'guide', 'the title from the file name');
  assert.ok(!made.file.name.includes('/'), 'no folder in the name');
  assert.ok(fs.existsSync(path.join(dir, 'guideline-files', made.file.id + '.pdf')));
  assert.strictEqual(G.list().length, 1);
  assert.ok(G.file(made.file.id).path.endsWith(made.file.id + '.pdf'));
  assert.ok(G.remove(made.file.id).removed);
  assert.strictEqual(G.list().length, 0);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const S = 'APPLICATION STATUS';

test('the Mock Team on the server: its pages, the booking page, the answer, the sheet to look at, Missing details, guidelines', { timeout: 120000 }, async (t) => {
  const dir = tmp('sr360-mockteam-');
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'student-details'), env: { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, COURSE_WATCH: 'off', PARTNER_REFRESH: 'off' }, stdio: 'ignore',
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }
  const client = () => {
    let cookie = '';
    return async (method, url, body, raw = false) => {
      const res = await fetch(base + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      return { status: res.status, json, location: res.headers.get('location') };
    };
  };
  const admin = client();
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  assert.strictEqual((await admin('POST', '/api/login/first-admin', { setupCode: code, username: 'owner', name: 'Owner' })).status, 200);
  assert.strictEqual((await admin('POST', '/api/login/new-password', { password: 'Strong-Pass-2026' })).status, 200);
  const person = async (username, role, departments) => {
    const made = await admin('POST', '/api/users', { username, name: username + ' Test', role, departments });
    assert.strictEqual(made.status, 200, JSON.stringify(made.json));
    const c = client();
    assert.strictEqual((await c('POST', '/api/login', { username, password: made.json.temporaryPassword })).status, 200);
    assert.strictEqual((await c('POST', '/api/login/new-password', { password: 'Team-Strong-2026!' })).status, 200);
    return c;
  };
  let wb = (await admin('GET', '/api/data')).json;
  const blank = Object.fromEntries(wb.sheets[0].columns.map((c) => [c, '']));
  wb.sheets[0].rows = [
    { ...blank, _id: 'r1', 'FIRST NAME': 'Sita', 'LAST NAME': 'Example', EMAIL: 'sita@example.com', 'CONTACT NUMBER': '9800000001', [S]: 'Mock Stage', 'UNIVERSITY NAME': 'Test University', 'COURSE NAME': 'MSc Test' },
    { ...blank, _id: 'r2', 'FIRST NAME': 'Ram', 'LAST NAME': 'Example', EMAIL: 'ram@example.com', [S]: 'Mock Stage' },
  ];
  assert.strictEqual((await admin('POST', '/api/data', { sheets: wb.sheets, activeSheetId: wb.activeSheetId, baseRevision: wb.revision })).status, 200);
  const mock = await person('bikram', 'staff', ['mock']);
  const app = await person('asha', 'staff', ['application']);

  // Pages: the Mock Team has Bookings and Interview guidelines, and no Dashboard or Partners. Mock interview guides were taken out (28 Nov 2026).
  for (const p of ['/dashboard', '/my-dashboard', '/partners', '/bulk']) assert.strictEqual((await mock('GET', p)).location, '/today', p);
  assert.notStrictEqual((await mock('GET', '/mock-guides')).status, 200, 'no Mock interview guides page any more');
  assert.strictEqual((await mock('GET', '/bookings')).status, 200);
  assert.strictEqual((await mock('GET', '/interview-guidelines')).status, 200);
  assert.strictEqual((await app('GET', '/api/bookings')).status, 403, 'the Application Team has no Bookings');
  assert.strictEqual((await app('GET', '/interview-guidelines')).status, 200, 'every team reads the guidelines');
  assert.strictEqual((await app('GET', '/api/guidelines')).json.canUpload, false);

  // Setup and slots, every day from 08:00 to 20:00, so there is always a free slot in the coming days.
  assert.strictEqual((await mock('POST', '/api/bookings/setup', { teams: 'https://evil.example.com', slug: 'bikram' })).status, 400);
  assert.strictEqual((await mock('POST', '/api/bookings/setup', { teams: 'https://teams.live.com/meet/9300000000000', slug: 'bikram', shown: 'Bikram, Mock Team', email: '' })).status, 200);
  const all = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [['08:00', '20:00']]]));
  assert.strictEqual((await mock('POST', '/api/bookings/slots', { minutes: 30, ahead: 7, notice: 60, weekly: all, dates: {} })).status, 200);

  // The student's page needs no login and shows only free times.
  const student = client();
  assert.strictEqual((await student('GET', '/book/bikram')).status, 200);
  assert.strictEqual((await student('GET', '/api/book/nobody')).status, 404);
  const open = await student('GET', '/api/book/bikram');
  assert.strictEqual(open.status, 200);
  assert.ok(open.json.days.length >= 6, 'about a week of days');
  assert.ok(!JSON.stringify(open.json).includes('sita'), 'no student details on the open page');
  const d = open.json.days[1];
  const booked = await student('POST', '/api/book/bikram', { day: d.day, time: d.times[0].time, name: 'Sita Example', email: 'SITA@example.com', phone: '' });
  assert.strictEqual(booked.status, 200, JSON.stringify(booked.json));
  assert.strictEqual(booked.json.booking.university, undefined, 'the open page never shows the student\'s record');
  assert.ok(!JSON.stringify(booked.json).includes('Test University'));
  assert.strictEqual(booked.json.booking.teams, 'https://teams.live.com/meet/9300000000000');
  assert.strictEqual((await student('POST', '/api/book/bikram', { day: d.day, time: d.times[0].time, name: 'Ram', email: 'ram@example.com' })).status, 400, 'the slot is taken');
  const view = await student('GET', `/api/booking/${booked.json.token}`);
  assert.strictEqual(view.json.booking.canChange, true);
  assert.strictEqual((await student('GET', '/api/booking/AAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);

  // Bookings shows it to come; the answer before the mock is refused.
  let page = (await mock('GET', '/api/bookings')).json;
  assert.strictEqual(page.upcoming.length, 1);
  assert.strictEqual(page.upcoming[0].mock, 1);
  assert.strictEqual(page.upcoming[0].university, 'Test University', 'matched by email, shown to the Mock Team only');
  const byPhone = await student('POST', '/api/book/bikram', { day: d.day, time: d.times[1].time, name: 'Someone', email: 'someone@example.com', phone: '9800000001' });
  assert.strictEqual(byPhone.status, 200);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'mock-bookings.json'), 'utf8')).bookings.find((b) => b.email === 'someone@example.com').rowId, '', 'a phone alone matches nobody');
  await student('POST', `/api/booking/${byPhone.json.token}/cancel`, {});
  const id = page.upcoming[0].id;
  assert.strictEqual((await mock('POST', `/api/bookings/${id}/answer`, { joined: true, feedback: 'x', result: 'ready' })).status, 400);

  // The mock's time passes (the booking moved to yesterday in the file): the window asks, and the answer is written to the card.
  const file = path.join(dir, 'mock-bookings.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.bookings[0].day = '2026-01-05';
  fs.writeFileSync(file, JSON.stringify(data));
  page = (await mock('GET', '/api/bookings')).json;
  assert.strictEqual(page.waiting.length, 0, 'the mock of a matched student is answered in its Feedback task, so Bookings does not ask (the owner, 26 Nov 2026)');
  const today = (await mock('GET', '/api/today')).json;
  assert.ok(today.missing.some((m) => m.lines.some((l) => /Did the student join/.test(l.text))), 'and Missing details says so');
  assert.ok(!today.missing.some((m) => m.lines.some((l) => /Mock Schedule 1 is missing/.test(l.text))), 'a student with no mock booked is not listed as missing (the owner, 26 Nov 2026)');
  assert.strictEqual((await mock('POST', `/api/bookings/${id}/answer`, { joined: true, feedback: '', result: 'ready' })).status, 400, 'the feedback is required');
  assert.strictEqual((await mock('POST', `/api/bookings/${id}/answer`, { joined: true, feedback: 'Good answers', result: 'maybe' })).status, 400, 'the result is required');
  const answered = await mock('POST', `/api/bookings/${id}/answer`, { joined: true, feedback: 'Good answers. Practise finance.', result: 'again' });
  assert.strictEqual(answered.status, 200, JSON.stringify(answered.json));
  const row = (await admin('GET', '/api/data')).json.sheets[0].rows.find((r) => r._id === 'r1');
  assert.strictEqual(row['MOCK SCHEDULE 1'], '2026-01-05');
  assert.strictEqual(row['FEEDBACK 1'], 'Good answers. Practise finance.');
  assert.strictEqual(answered.json.next.length, 1, 'Needs another mock: under Next mock to book');
  assert.strictEqual(answered.json.waiting.length, 0);
  const card = (await admin('GET', '/api/cards/r1')).json;
  assert.ok(JSON.stringify(card).includes('Mock 2 is next'), 'a task for the next mock');
  assert.strictEqual((await mock('POST', `/api/bookings/${id}/answer`, { joined: false })).status, 400, 'answered once only');

  // A mock already planned on the card from a task (a day, no feedback) gets its feedback in that slot, never the next one.
  wb = (await admin('GET', '/api/data')).json;
  wb.sheets[0].rows.find((r) => r._id === 'r2')['MOCK SCHEDULE 1'] = '2026-01-06';
  assert.strictEqual((await admin('POST', '/api/data', { sheets: wb.sheets, activeSheetId: wb.activeSheetId, baseRevision: wb.revision })).status, 200);
  const free2 = (await student('GET', '/api/book/bikram')).json.days[2];
  const ram = await student('POST', '/api/book/bikram', { day: free2.day, time: free2.times[0].time, name: 'Ram Example', email: 'ram@example.com' });
  assert.strictEqual(ram.status, 200, JSON.stringify(ram.json));
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rb = stored.bookings.find((b) => b.email === 'ram@example.com');
  assert.strictEqual(rb.mock, 1, 'the planned Mock 1');
  assert.strictEqual(rb.siteUrl, base, 'the email link is the site the person set up from, never a visitor\'s Host');
  rb.day = '2026-01-06';
  fs.writeFileSync(file, JSON.stringify(stored));
  assert.strictEqual((await mock('POST', `/api/bookings/${rb.id}/answer`, { joined: true, feedback: 'Fine', result: 'ready' })).status, 200);
  const r2 = (await admin('GET', '/api/data')).json.sheets[0].rows.find((r) => r._id === 'r2');
  assert.deepStrictEqual([r2['MOCK SCHEDULE 1'], r2['FEEDBACK 1'], r2['MOCK SCHEDULE 2']], ['2026-01-06', 'Fine', '']);

  // The sheet is only to look at: a cell typed there is not kept (Status still moves a student on).
  const mine = (await mock('GET', '/api/data')).json;
  const edited = JSON.parse(JSON.stringify(mine));
  edited.sheets[0].rows.find((r) => r._id === 'r1')['FEEDBACK 1'] = 'Typed on the sheet';
  edited.sheets[0].rows = edited.sheets[0].rows.filter((r) => r._id !== 'r2'); // and a deleted row
  const saved = await mock('POST', '/api/data', { sheets: edited.sheets, activeSheetId: edited.activeSheetId, baseRevision: mine.revision });
  assert.strictEqual(saved.status, 200);
  const after = (await admin('GET', '/api/data')).json.sheets[0].rows;
  assert.strictEqual(after.find((r) => r._id === 'r1')['FEEDBACK 1'], 'Good answers. Practise finance.');
  assert.ok(after.some((r) => r._id === 'r2'), 'no row deleted from the sheet');

  // Interview guidelines: the Mock Team uploads, anyone with access downloads; a renamed file is refused.
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 32)]);
  const uniName = (await mock('GET', '/api/guidelines')).json.universities[0].name; // a University that is in the list
  const phantom = new URLSearchParams({ university: 'A University that does not exist anywhere', kind: 'Interview questions', source: 'From a student', title: 'Questions', name: 'q.pdf' });
  assert.strictEqual((await mock('POST', `/api/guidelines?${phantom}`, pdf)).status, 400, 'only a University from the list');
  const q = new URLSearchParams({ university: uniName, kind: 'Interview questions', title: 'Questions', name: 'q.pdf' });
  assert.strictEqual((await mock('POST', `/api/guidelines?${q}`, Buffer.from('MZ fake'))).status, 400);
  const up = await mock('POST', `/api/guidelines?${q}`, pdf);
  assert.strictEqual(up.status, 200, JSON.stringify(up.json));
  const list = (await mock('GET', '/api/guidelines')).json;
  assert.strictEqual(list.files.length, 1);
  assert.ok(list.universities.some((u) => u.name === uniName && u.count === 1));
  const got = await mock('GET', `/api/guidelines/${up.json.file.id}`, undefined, true);
  assert.strictEqual(got.status, 200);
  assert.ok(got.body.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.match(got.headers.get('content-disposition'), /attachment/);
  // Every team downloads, and reads on screen: a PDF is shown by the browser (framed by this site only), a Word document as its words.
  assert.strictEqual((await app('GET', `/api/guidelines/${up.json.file.id}`, undefined, true)).status, 200);
  const seen = await app('GET', `/api/guidelines/${up.json.file.id}?view=1`, undefined, true);
  assert.strictEqual(seen.status, 200);
  assert.match(seen.headers.get('content-disposition'), /^inline/);
  assert.match(seen.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const wq = new URLSearchParams({ university: uniName, kind: 'Interview questions', title: 'Word questions', name: 'q.docx' });
  assert.strictEqual((await app('POST', `/api/guidelines?${wq}`, wordFile())).status, 403, 'the Application Team uploads nothing');
  const word = await mock('POST', `/api/guidelines?${wq}`, wordFile());
  assert.strictEqual(word.status, 200, JSON.stringify(word.json));
  const readWord = await app('GET', `/api/guidelines/${word.json.file.id}?view=1`);
  assert.deepStrictEqual([readWord.json.kind, readWord.json.blocks.map((b) => b.t)], ['word', ['h', 'p', 'li', 'li', 'table']]);
  assert.strictEqual((await mock('POST', `/api/guidelines/${word.json.file.id}/delete`, {})).status, 200);

  // Backups carry the bookings and the guidelines list.
  assert.strictEqual((await admin('POST', '/api/restore/backup-now', {})).status, 200);
  const backups = (await admin('GET', '/api/restore/backups')).json.backups;
  assert.ok(backups.length >= 1);
  const gz = fs.readdirSync(path.join(dir, 'daily-backups')).find((f) => /^niec-manual-.*\.json\.gz$/.test(f)); // the copy made just now
  const snap = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(dir, 'daily-backups', gz))).toString('utf8'));
  assert.strictEqual(snap.mockBookings.bookings.filter((b) => b.status === 'booked').length, 2);
  assert.strictEqual(snap.mockGuidelines.files.length, 1);
  // ... and no Mock interview guides (taken out, 28 Nov 2026).
  assert.ok(!('mockGuides' in snap), 'the backup holds no guides');

  // A burst of parallel bookings from one address cannot get past the hourly limit (the place is held before the body is read, so
  // sending them all at once does not help), and the ones that were turned away are told so.
  const openSlots = (await (await fetch(base + '/api/book/bikram')).json()).days.flatMap((d) => d.times.map((x) => [d.day, x.time]));
  assert.ok(openSlots.length >= 42, 'enough free slots for the test');
  // Anyone can type any email: a name that does not fit the card does not tie the booking to that student; the right name does.
  const ramBook = (name, [day, time]) => fetch(base + '/api/book/bikram', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day, time, name, email: 'ram@example.com', phone: '' }),
  }).then((r) => r.status);
  assert.strictEqual(await ramBook('Totally Different', openSlots[40]), 200);
  let upcoming = (await mock('GET', '/api/bookings')).json.upcoming;
  assert.ok(!upcoming.find((b) => b.name === 'Totally Different').rowId, 'a name that does not fit the card is not matched');
  assert.strictEqual(await ramBook('Ram Example', openSlots[41]), 200);
  upcoming = (await mock('GET', '/api/bookings')).json.upcoming;
  assert.strictEqual(upcoming.find((b) => b.name === 'Ram Example').rowId, 'r2', 'the right name is matched');
  const burst = await Promise.all(openSlots.slice(0, 40).map(([day, time], i) => fetch(base + '/api/book/bikram', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day, time, name: 'Burst Tester', email: `burst${i}@example.com`, phone: '' }),
  }).then((r) => r.status)));
  assert.ok(burst.filter((x) => x === 200).length <= 20, 'no more than 20 bookings from one address in an hour');
  assert.ok(burst.filter((x) => x === 429).length >= 20, 'the rest are turned away');
});

test('bookings: the file limit never drops a booking that is still waiting for its answer', () => {
  const dir = tmp('sr360-bookings-cap-');
  const now = new Date('2026-11-22T04:15:00Z');
  const B = createMockBookings(dir, { now: () => now, timeZone: 'Asia/Kathmandu' });
  assert.ok(B.saveSetup('u1', { teams: 'https://teams.live.com/meet/1', slug: 'bikram', shown: 'Bikram', email: 'b@example.com' }).person);
  assert.ok(B.saveSlots('u1', { minutes: 30, ahead: 7, notice: 60, weekly: { 0: [['11:30', '13:00']] }, dates: {} }).person);
  const file = path.join(dir, 'mock-bookings.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const at = '2026-11-20T00:00:00.000Z';
  const row = (i, o) => ({ id: String(i).padStart(12, '0'), token: 'T'.repeat(24) + i, owner: 'u1', day: '2026-11-10', time: '10:00', minutes: 30, name: 'N', email: `x${i}@example.com`, phone: '', rowId: '', mock: 0, university: '', course: '', at, siteUrl: '', answer: null, sent: {}, ...o });
  const rows = [];
  for (let i = 0; i < 3000; i += 1) rows.push(row(i, { status: 'cancelled' }));
  for (let i = 3000; i < 4995; i += 1) rows.push(row(i, { status: 'booked', answer: { joined: true } }));
  for (let i = 4995; i < 5000; i += 1) rows.push(row(i, { status: 'booked', answer: null }));
  fs.writeFileSync(file, JSON.stringify({ ...data, bookings: rows }));
  const made = B.book('u1', { day: '2026-11-22', time: '11:30', name: 'New Student', email: 'new@example.com', phone: '' }, () => null, '');
  assert.ok(made.booking, JSON.stringify(made));
  const after = JSON.parse(fs.readFileSync(file, 'utf8')).bookings;
  assert.strictEqual(after.length, 5000, 'the file stays at its limit');
  assert.strictEqual(after.filter((b) => b.status === 'booked' && !b.answer).length, 6, 'the five waiting ones and the new one are all kept');
  assert.strictEqual(after.filter((b) => b.status === 'booked' && b.answer).length, 1995, 'answered ones are not touched while cancelled ones can go');
});

test('bookings: a wrong "did not join" can be taken back, a joined answer cannot', () => {
  const dir = tmp('sr360-bookings-undo-');
  let now = new Date('2026-11-22T04:15:00Z');
  const B = createMockBookings(dir, { now: () => now, timeZone: 'Asia/Kathmandu' });
  assert.ok(B.saveSetup('u1', { teams: 'https://teams.live.com/meet/1', slug: 'bikram', shown: 'Bikram', email: 'b@example.com' }).person);
  assert.ok(B.saveSlots('u1', { minutes: 30, ahead: 7, notice: 60, weekly: { 0: [['11:30', '15:00']] }, dates: {} }).person);
  const one = B.book('u1', { day: '2026-11-22', time: '11:30', name: 'First Student', email: 'a@example.com', phone: '' }, () => null, '').booking;
  const two = B.book('u1', { day: '2026-11-22', time: '12:00', name: 'Second Student', email: 'c@example.com', phone: '' }, () => null, '').booking;
  assert.ok(one && two);
  now = new Date('2026-11-22T08:00:00Z'); // both mocks are over
  assert.ok(B.answer(one.id, { joined: false, by: 'u1' }).booking.answer, 'answered: did not join');
  assert.ok(B.answer(two.id, { joined: true, feedback: 'Good', result: 'ready', by: 'u1' }).booking.answer, 'answered: joined');
  const back = B.reopen(one.id);
  assert.strictEqual(back.booking.answer, null, 'the wrong No is taken back');
  assert.match(B.reopen(one.id).error, /no answer/, 'nothing left to take back');
  assert.match(B.reopen(two.id).error, /student card/, 'a joined answer is corrected on the student card, not here');
  assert.match(B.reopen('000000000000').error, /No such/);
});

test('bookings: a failed reminder is counted so it can stop after three tries', () => {
  const dir = tmp('sr360-bookings-tries-');
  const now = new Date('2026-11-22T04:15:00Z');
  const B = createMockBookings(dir, { now: () => now, timeZone: 'Asia/Kathmandu' });
  assert.ok(B.saveSetup('u1', { teams: 'https://teams.live.com/meet/1', slug: 'bikram', shown: 'Bikram', email: 'b@example.com' }).person);
  assert.ok(B.saveSlots('u1', { minutes: 30, ahead: 7, notice: 60, weekly: { 0: [['11:30', '13:00']] }, dates: {} }).person);
  const b = B.book('u1', { day: '2026-11-22', time: '11:30', name: 'Tries Student', email: 't@example.com', phone: '' }, () => null, '').booking;
  assert.ok(b);
  B.markSent(b.id, 'hourBefore'); // marked before sending
  assert.strictEqual(B.get(b.id).sent.hourBefore, true);
  B.markSent(b.id, 'hourBefore', false, 1); // the send failed once: tried again, counted
  assert.strictEqual(B.get(b.id).sent.hourBefore, false);
  assert.strictEqual(B.get(b.id).sent.hourBeforeTries, 1);
  B.markSent(b.id, 'hourBefore', true, 3); // third failure: given up
  assert.strictEqual(B.get(b.id).sent.hourBefore, true);
  assert.strictEqual(B.get(b.id).sent.hourBeforeTries, 3);
});
