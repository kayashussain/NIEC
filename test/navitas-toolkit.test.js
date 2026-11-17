// The Navitas product toolkit read into the Fact File (student-details/navitas-toolkit.js). Google is never called here: a made-up
// sheet answers (made-up colleges, figures, links and questions, written by Claude for this test), so the test checks the reading
// of merged cells, the UK colleges only (no German college, no closed college), each college's page, that a text the team changed
// is kept, and the twice-a-week schedule.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createNavitasToolkit, gridFromHtml, tabsFromHtml, sameCollege } = require('../student-details/navitas-toolkit');
const { createFacts, clean, STARTER_STEPS } = require('../student-details/facts');

const td = (t, a = '') => `<td class="s1"${a}>${t}</td>`;
const tr = (...cells) => `<tr><th class="row-headers-background">1</th>${cells.join('')}</tr>`;
const page = (...rows) => `<html><body><table class="waffle">${rows.join('')}</table></body></html>`;

const TABS = [['Overall Requirements', '11'], ['Available Course List ', '22'], ['Fees/Scholarship/Deadlines', '33'], ['Interview Questions Sample', '44'],
  ['Payment Flywire link and Refund', '55'], ['Application Process UK/Netherland', '66'], ['Accomodations', '77'], ['TIPS for you', '88'], ['Key Selling Points', '99']];
const HTMLVIEW = `<script>var items = [${TABS.map(([n, g]) => `{name: "${n.replace('/', '\\/')}", pageUrl: "https:\\/\\/docs.google.com\\/x?gid\\x3d${g}", gid: "${g}",initialSheet: ("${g}" == gid)}`).join(',')}];</script>`;

function sheet(feeTestford = 'Starts from 15000* GBP<br><br>PLEASE REFER TO <br>THE LINK HERE ---->>>') {
  return {
    11: page(
      tr(td('Made-up toolkit. No LIMITATIONS on entry point', ' colspan="10"')),
      tr(td('University Name'), td('Location', ' colspan="2"'), td('Level'), td('Academic Requirements'), td('IELTS Requirements'), td('PTE Requirements'), td('University Test / Duolingo'), td('Waiver Options'), td('GAP accepted'), td('Intake')),
      tr(td('Testford University International College (TUIC) - UK', ' rowspan="2"'), td('Testford', ' rowspan="2"'), td('1 hour by train to London', ' rowspan="2"'), td('Foundation (4 years)'), td('GPA 2.0'), td('5.5 / 5.5', ' rowspan="2"'), td('59 / 59'), td('Duolingo: 100/95', ' rowspan="2"'), td('English Waiver with B in Y12 English', ' rowspan="2"'), td('Up to 4 years', ' rowspan="2"'), td('Jan/May/Sept', ' rowspan="2"')),
      tr(td('Pre-Master (Pathway)'), td('Bachelor Pass'), td('62 / 59')),
      tr(td('Manchester Metropolitan University College (MMUIC) <br>HOLD FOR SEPTEMBER 2026 INTAKE'), td('Manchester'), td('2 hours by train to London'), td('Foundation'), td('45%'), td('5.5/5.5'), td('59/59'), td('100/95'), td('No Waiver'), td('3 years'), td('Jan/Sept')),
      tr(td('Example International College'), td('Germany'), td('1 hour to Berlin'), td('Foundation'), td('GPA 2.0'), td('5/4.5'), td('40/36'), td('85/80'), td('No Waiver'), td('TBD'), td('Jan/Oct')),
      tr(td('Sampleton University Pathway College (SPC) - UK'), td('Sampleton'), td('Inside London'), td("Int'l Year One (IYO)<br>(3 years)"), td('2.4 / 60%'), td('6.0 / 5.5'), td('59 / 59'), td("Don't accept Duolingo"), td('No Waiver'), td('5 years'), td('Jan/May/Sept')),
      tr(td('*Entry requirements are subject to review and may change.')),
    ),
    22: page(
      tr(td('Colleges (SCROLL DOWN)'), td('Courses available for September | JAN COURSES'), td('Courses for JAN 2027 (SCROLL DOWN for all colleges)')),
      tr(td('TESTFORD UNIVERISTY INTERNATIONAL COLLEGE<br>(Bachelor Cousres)', ' rowspan="2"'), td('BSc (Hons) Made-up Studies'), td('IY1/3 years courses:<br>BSc (Hons) Made-up Studies', ' rowspan="2"')),
      tr(td('BA (Hons) Pretend Business')),
      tr(td('Testford University International College<br>(Masters Courses)<br>500 pounds incentives for 3 students*'), td('MSc Sample Science'), td('')),
    ),
    33: page(
      tr(td('College Name (SCROLL)'), td('Scholarship Details'), td('Fees Range'), td('Fees Link')),
      tr(td(''), td('All Foundation courses: 2,000 discount<br><br>Progression Scholarship for Pre Masters:<br>70% and above - 3,000 GBP<br><br>OPEN FOR JAN 2027 INTAKE<br>Application Deadline: 20th Nov 2026<br>CAS deadline: 1st Dec<br>Agent incentive 300 GBP', ' rowspan="2"'), td(feeTestford, ' rowspan="2"'), td('https://tuic.example.org/admission/fees/', ' rowspan="2"')),
      tr(td('TESTFORD UNIVERSITY INTERNATIONAL COLLEGE (TUIC)')),
      tr(td('SAMPLETON UNIVERSITY PATHWAY COLLEGE (SPC)'), td('1000 GBP for UG (Please confirm with Someone for this)<br><br>OPEN FOR JAN 2027<br>Latest Enrolment Dates<br>Undergraduate: 12 October 2026'), td('Starts from 17000* GBP'), td('https://spc.example.org/fees/')),
    ),
    44: page(
      tr(td(''), td('UK/NETHERLAND')),
      tr(td(''), td('STUDY DESTINATION (UK)'), td('Interviews are mandatory for all UK colleges.')),
      tr(td(''), td('•        Why the UK?<br>•        Why not Nepal?'), td(''), td('ONLY for Testford University International College, a support call replaces the interview.')),
      tr(td(''), td('COURSE KNOWLEDGE')),
      tr(td(''), td('•        Why this course?')),
    ),
    55: page(
      tr(td('College Name'), td('College Flywire Link'), td('College Refund Links')),
      tr(td('Testford University International College (TUIC)'), td('https://pay.example.org/tuic'), td('https://tuic.example.org/refund/')),
      tr(td(''), td('Choose Option 2 from the above link.')),
    ),
    66: page(
      tr(td(''), td('FOR UK PROCESS')), tr(td(''), td('STEP 1')), tr(td(''), td('Apply online and upload documents')), tr(td(''), td('Documents Required:<br>1. Passport')),
      tr(td(''), td('STEP 2')), tr(td(''), td('Pay the deposit after the Unconditional Offer Letter.')),
      tr(td(''), td('FOR NETHERLAND PROCESS')), tr(td(''), td('STEP 1')), tr(td(''), td('Not for the UK')),
    ),
    77: page(tr(td('College Name'), td('Accomodation Links')), tr(td('Testford University International College (TUIC)'), td('https://tuic.example.org/accommodation/'))),
    88: page(tr(td(''), td('TIPS 1:')), tr(td(''), td('Use the portal for every message.'))),
    99: page(
      tr(td('College Name'), td(''), td('Location'), td('University Ranking (UK / World)'), td('Famous Subjects for Nepalese Students'), td('City/Area Known For'), td('USPs')),
      tr(td('Testford University International College (TUIC)'), td(''), td('Testford'), td('Made-up rank 1'), td('Business, Nursing'), td('A made-up river'), td('Free internal English test')),
    ),
  };
}

function fakeGoogle(tabs) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, text: async () => body });
    if (/\/htmlview$/.test(url)) return ok(HTMLVIEW);
    const gid = (/gid=(\d+)/.exec(url) || [])[1];
    return tabs[gid] ? ok(tabs[gid]) : { ok: false, status: 404, text: async () => '' };
  };
  return { calls, fetchImpl };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'navitas-'));

test('merged cells are read on every row they cover, across several tables', () => {
  const g = gridFromHtml(`<table>${tr(td('A', ' rowspan="2"'), td('B'))}</table><table>${tr(td('C'))}</table>`);
  assert.deepStrictEqual(g.map((r) => r.map((c) => c.t)), [['A', 'B'], ['A', 'C']]);
  assert.strictEqual(g[1][0].top, false);
  assert.deepStrictEqual(tabsFromHtml(HTMLVIEW).map((t) => t.gid), TABS.map((t) => t[1]));
  assert.ok(sameCollege('Anglia Ruskin University College (ARU College)', 'ANGLIA RUSKIN UNIVERISTY COLLEGE\n(Bachelor Cousres)'));
  assert.ok(!sameCollege('Keele University International College (KUIC)', 'Brunel University London Pathway College'));
});

test('each UK college gets its own Fact File page, the closed and non-UK ones none', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  const google = fakeGoogle(sheet());
  const kit = createNavitasToolkit({ dir, facts, fetchImpl: google.fetchImpl, starterSteps: STARTER_STEPS, clean, now: () => new Date('2026-11-19T00:00:00Z') });
  const r = await kit.run('test');
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.colleges, 2);
  assert.ok(google.calls.every((u) => u.startsWith('https://docs.google.com/spreadsheets/d/')));
  const names = facts.all().map((u) => u.name);
  assert.ok(names.includes('Testford University International College (TUIC)'));
  assert.ok(names.includes('Sampleton University Pathway College (SPC)'));
  assert.ok(!names.some((n) => /manchester metropolitan|example international/i.test(n)));

  const t = facts.all().find((u) => u.name.startsWith('Testford'));
  assert.strictEqual(t.city, 'Testford');
  assert.strictEqual(t.website, 'https://tuic.example.org');
  assert.deepStrictEqual(t.programs.map((p) => [p.name, p.duration]), [['Foundation', '4 years'], ['Pre-Master (Pathway)', '']]);
  assert.match(t.programs[1].english, /IELTS: 5\.5 \/ 5\.5/); // the merged IELTS cell, read on the Pre-Master row too
  assert.match(t.programs[0].academic, /Study gap: Up to 4 years/);
  assert.match(t.programs[0].tuition, /Starts from 15000\* GBP\nFees page: https:\/\/tuic\.example\.org\/admission\/fees\//);
  assert.doesNotMatch(t.programs[0].tuition, /LINK HERE/);
  assert.strictEqual(t.programs[0].scholarship, 'All Foundation courses: 2,000 discount');
  assert.match(t.programs[1].scholarship, /Progression Scholarship for Pre Masters:\n70% and above - 3,000 GBP/);
  assert.match(t.courses, /## Undergraduate\n- BSc \(Hons\) Made-up Studies\n- BA \(Hons\) Pretend Business\n## Postgraduate\n- MSc Sample Science/);
  assert.strictEqual(t.intakes.length, 1);
  assert.strictEqual(t.intakes[0].name, 'January 2027');
  assert.strictEqual(t.intakes[0].deadline, '20th Nov 2026');
  assert.match(t.intakes[0].deadlines, /CAS deadline: 1st Dec/);
  assert.match(t.intakes[0].courses, /## IY1\/3 years courses\n- BSc \(Hons\) Made-up Studies/);
  assert.match(t.interview, /## For this college\n- ONLY for Testford/);
  assert.match(t.interview, /- Why the UK\?\n- Why not Nepal\?\n## Course knowledge\n- Why this course\?/);
  assert.match(t.notes, /Flywire payment: https:\/\/pay\.example\.org\/tuic/);
  assert.match(t.notes, /Refund request: https:\/\/tuic\.example\.org\/refund\//);
  assert.match(t.notes, /## Accommodation\n- https:\/\/tuic\.example\.org\/accommodation\//);
  assert.match(t.notes, /Use the portal for every message\./);
  assert.match(t.overview, /Free internal English test/);
  assert.match(t.location, /1 hour by train to London\nKnown for: A made-up river/);
  assert.deepStrictEqual(t.process.map((s) => s.title), ['Apply online and upload documents', 'Pay the deposit after the Unconditional Offer Letter.']);
  assert.ok(t.source && t.source.navitas && t.source.navitas.at);
  const fdn = t.rules.find((L) => L.level === 'Foundation');
  assert.strictEqual(fdn.minGpa, 2);
  assert.strictEqual(fdn.gap, 4);
  assert.strictEqual(fdn.tests.IELTS, 5.5);
  assert.ok(fdn.waiver);
  // Nothing about incentives on a page that every team reads.
  facts.all().forEach((u) => assert.doesNotMatch(JSON.stringify(u), /incentive/i));
  const s = facts.all().find((u) => u.name.startsWith('Sampleton'));
  assert.ok(!Object.keys(s.rules.find((L) => L.level === 'International Year 1').tests).includes('DUOLINGO'));
  // An agents' note is taken out, and a September enrolment date is not shown as a January date.
  assert.strictEqual(s.programs[0].scholarship, '1000 GBP for UG');
  assert.strictEqual(s.intakes[0].deadlines, 'OPEN FOR JAN 2027');
});

test('a college the sheet renames keeps its one page', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  let tabs = sheet();
  const kit = createNavitasToolkit({ dir, facts, fetchImpl: (...a) => fakeGoogle(tabs).fetchImpl(...a), starterSteps: STARTER_STEPS, clean });
  await kit.run('test');
  const before = facts.all().find((u) => u.name.startsWith('Testford'));
  tabs = { ...sheet(), 11: sheet()[11].replace('Testford University International College (TUIC) - UK', 'Testford University International College of London (TUIC) - UK') };
  await kit.run('test');
  const pages = facts.all().filter((u) => /testford/i.test(u.name));
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].id, before.id);
  assert.strictEqual(pages[0].name, 'Testford University International College of London (TUIC)');
});

test('the figures follow the sheet, and a text the team changed is kept', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  let tabs = sheet();
  const google = { fetchImpl: (...a) => fakeGoogle(tabs).fetchImpl(...a) };
  const kit = createNavitasToolkit({ dir, facts, fetchImpl: google.fetchImpl, starterSteps: STARTER_STEPS, clean });
  await kit.run('test');
  const t = facts.all().find((u) => u.name.startsWith('Testford'));
  facts.update(t.id, { ...t, interview: 'Our own interview notes.' }, 'Admin');
  const again = await kit.run('test');
  assert.strictEqual(again.updated, 0);
  assert.strictEqual(again.unchanged, 2);
  tabs = sheet('Starts from 16500* GBP');
  const third = await kit.run('test');
  assert.strictEqual(third.updated, 1);
  const after = facts.all().find((u) => u.name.startsWith('Testford'));
  assert.match(after.programs[0].tuition, /16500/);
  assert.strictEqual(after.interview, 'Our own interview notes.');
  assert.match(after.notes, /Flywire payment/); // not changed by the team: still the toolkit's
});

test('a sheet that cannot be read is reported, and the schedule is twice a week', async () => {
  const dir = tmp();
  const facts = createFacts(dir);
  let clock = new Date('2026-11-16T00:00:00Z'); // Monday 5.45 a.m. in Kathmandu
  const kit = createNavitasToolkit({ dir, facts, fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }), now: () => clock });
  assert.strictEqual(kit.due(), true);
  const r = await kit.run('test');
  assert.match(r.error, /Anyone with the link can view/);
  assert.strictEqual(kit.due(), false); // a failed try waits 3 hours
  const ok = createNavitasToolkit({ dir: tmp(), facts, fetchImpl: fakeGoogle(sheet()).fetchImpl, now: () => clock, starterSteps: STARTER_STEPS, clean });
  await ok.run('test');
  clock = new Date('2026-11-17T00:00:00Z'); // Tuesday
  assert.strictEqual(ok.due(), false);
  clock = new Date('2026-11-19T00:00:00Z'); // Thursday
  assert.strictEqual(ok.due(), true);
  assert.strictEqual(createNavitasToolkit({ dir: tmp(), facts, enabled: false }).due(), false);
});
