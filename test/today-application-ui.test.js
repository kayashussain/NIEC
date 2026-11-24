// The Application Team's opened task on Today (the owner, 23 Nov 2026, approved design F5), in a real browser: what is missing first, the
// details with a copy button each, the updates folded, no student source or partner; the Mock Team's Today in the same look (the owner,
// 23 Nov 2026, approved design: the mocks first, a one-step window with Save); and Admin's Today unchanged.
// Skips itself where Playwright or its browser is not installed (as on a production server).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

let playwright = null;
try { playwright = require('playwright'); } catch (e) { /* skipped below */ }
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Today: the Application Team\'s opened task, and nobody else\'s', { timeout: 180000, skip: !playwright && 'Playwright is not installed' }, async (t) => {
  let browser;
  try { browser = await playwright.chromium.launch(); } catch (e) { t.skip('no Chromium browser available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-today-app-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, COUNSELOR_DATA_DIR: path.join(dir, 'incentive') };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(async () => { server.kill(); await browser.close(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }

  const admin = await browser.newContext({ baseURL: base });
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  assert.ok((await admin.request.post('/api/login/first-admin', { data: { setupCode: code, username: 'owner', name: 'Owner Test' } })).ok());
  assert.ok((await admin.request.post('/api/login/new-password', { data: { password: 'Strong-Pass-2026' } })).ok());
  const person = async (username, departments) => {
    const made = await admin.request.post('/api/users', { data: { username, name: username + ' Test', email: '', departments } });
    const temp = (await made.json()).temporaryPassword;
    const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    assert.ok((await ctx.request.post('/api/login', { data: { username, password: temp } })).ok());
    assert.ok((await ctx.request.post('/api/login/new-password', { data: { password: 'Team-Strong-2026' } })).ok());
    return ctx;
  };
  const asha = await person('asha', ['application']);
  const mina = await person('mina', ['mock']);

  // A student with a university to apply to, some details in and some missing (no passport number, no address), and an update.
  const made = await (await admin.request.post('/api/students/new', { data: { stage: 'Application Stage', fields: { 'FIRST NAME': 'Gita', 'LAST NAME': 'Demo', 'CONTACT NUMBER': '9800000555', EMAIL: 'gita.demo@example.com', 'STUDENT SOURCE': 'Social Media' } } })).json();
  const id = made.id;
  assert.ok((await admin.request.post(`/api/cards/${id}/profile`, { data: { dob: '2003-03-12' } })).ok());
  assert.ok((await admin.request.post(`/api/cards/${id}/sheet`, { data: { fields: { 'LANGUAGE TEST DATE': 'Waiver' } } })).ok());
  const opt = await (await admin.request.post(`/api/cards/${id}/options`, { data: { university: 'Test University', course: 'BSc Test', level: 'Undergraduate', intake: 'Sep 2027' } })).json();
  const oid = opt.option ? opt.option.id : opt.card.options.slice(-1)[0].id;
  assert.ok((await admin.request.post(`/api/cards/${id}/options/send`, { data: { ids: [oid], partners: { [oid]: 'Real Dreams' } } })).ok());
  const task = (await (await admin.request.get(`/api/cards/${id}`)).json()).card.tasks.find((x) => /Apply to/.test(x.text));
  assert.ok((await admin.request.post(`/api/cards/${id}/tasks/${task.id}`, { data: { comment: 'Asked the student to resend the passport.' } })).ok());
  assert.ok((await admin.request.post(`/api/cards/${id}/tasks`, { data: { team: 'mock', text: 'Set the first mock', tag: 'mock' } })).ok());

  // The server sends the details to the Application Team's own Today only.
  const tasksOf = async (ctx) => (await (await ctx.request.get('/api/tasks')).json()).tasks;
  assert.ok((await tasksOf(asha)).every((x) => x.details && x.details.dob === '2003-03-12'), 'the Application Team gets the details');
  assert.ok((await tasksOf(admin)).every((x) => !x.details), 'Admin does not');
  assert.ok((await tasksOf(mina)).length > 0 && (await tasksOf(mina)).every((x) => !x.details), 'the Mock Team does not');
  // The Mock Team gets each task's mocks instead (the approved design, 23 Nov 2026); nobody else does.
  assert.ok((await tasksOf(mina)).every((x) => x.mock && x.mock.mocks.length === 4), 'the Mock Team gets the mocks');
  assert.ok((await tasksOf(asha)).every((x) => !x.mock) && (await tasksOf(admin)).every((x) => !x.mock), 'the Application Team and Admin do not');

  // The Application Team's Today.
  const page = await asha.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/today');
  await page.waitForSelector('.tdx');
  // The screen is the approved F5 layout: the day and "Today", three tabs, a search box with the kinds (All first), headings over panels;
  // none of the old greeting or the progress card.
  assert.strictEqual(await page.locator('.tda-top h1').innerText(), 'Today');
  // The Apple look (the owner, 24 Nov 2026): only the Application Team loads apple.css, and Today shows four numbers at the top.
  assert.strictEqual(await page.locator('link[data-apple]').count(), 1, 'the Application Team loads the Apple stylesheet');
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 247)', 'the Apple canvas');
  assert.deepStrictEqual((await page.locator('.tda-tile .tda-tile-k').allInnerTexts()).map((x) => x.trim()), ['Late', 'Today', 'Later', 'Missing details'], 'four numbers at the top');
  assert.ok(await page.locator('.tda-date').innerText(), 'the day is shown');
  assert.deepStrictEqual((await page.locator('.tda-view').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').replace(/\s+/g, ' ').trim()), ['Today', 'Later', 'Missing details'], 'the three tabs');
  assert.strictEqual(await page.locator('.tda-view[aria-selected="true"]').count(), 1);
  assert.match(await page.locator('.tda-bar .tda-pill[aria-selected="true"]').innerText(), /^All\s*\d+$/, 'All is first and chosen');
  assert.ok(await page.locator('.tda-top .tda-search input').count(), 'the search box is up by the bell (design F6)');
  assert.ok(await page.locator('.tda-bar .tda-seg').count(), 'the tabs are in the filter row (design F6)');
  assert.match(await page.locator('.tda-gh').first().innerText(), /^(Late, do these first|Today) \u00b7 \d+$/, 'a heading over its panel');
  assert.strictEqual(await page.locator('.td-hello, .td-pulse, .td-tasks').count(), 0, 'no greeting, no progress card, no Tasks box');
  const closed = page.locator('.tdx', { hasText: 'Apply to Test University' });
  assert.match(await closed.locator('.tdy-hint').innerText(), /3 details missing/, 'the closed task says what is missing');
  await closed.locator('.tdx-head').click();
  const body = closed.locator('.tdy-body');
  await body.waitFor();
  const text = await body.locator('.tdy-details').innerText(); // the details; the updates are the conversation (the system's own assignment line may name the partner)
  // Missing details sit inside their own list as Missing rows, not in a banner on top (the owner, 24 Nov 2026).
  assert.doesNotMatch(text, /before you submit/i, 'no banner on top');
  assert.strictEqual(await body.locator('.tdy-details .tdy-first').count(), 0);
  assert.strictEqual(await body.locator('.tdy-dl.is-missing-row').count(), 3, 'three Missing rows');
  assert.match(await body.locator('.tdy-sec', { hasText: 'Student' }).innerText(), /Passport number[\s\S]*Missing/);
  assert.match(await body.locator('.tdy-sec', { hasText: 'Student' }).innerText(), /Address[\s\S]*Missing/);
  assert.match(await body.locator('.tdy-sec', { hasText: 'Student' }).innerText(), /Nationality[\s\S]*Missing/, 'a student with no nationality saved has it listed as missing');
  assert.ok(await body.locator('.tdy-dl.is-missing-row .tdy-add', { hasText: 'Add' }).count(), 'each has an Add link');
  for (const l of ['University', 'Course', 'Level', 'Intake', 'Language test', 'Email', 'WhatsApp', 'Date of birth', 'Nationality']) assert.match(text, new RegExp(l), l + ' is shown');
  assert.match(text, /Test University/); assert.match(text, /Waiver/); assert.match(text, /12 Mar 2003/);
  assert.doesNotMatch(text, /Student source|Social Media|Real Dreams|Partner/i, 'no source and no partner');
  assert.doesNotMatch(text, /Highest qualification|English test|Passport expiry/i, 'nothing the system does not show');
  // Missing items are never also listed in the sections: Passport number appears once.
  assert.strictEqual((text.match(/Passport number/g) || []).length, 1);
  // Copy: the value is copied and the button says so.
  const email = body.locator('.tdy-dl', { hasText: 'Email' }).locator('.tdy-cp');
  await email.click();
  await wait(150);
  assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), 'gita.demo@example.com');
  assert.match(await email.innerText(), /Copied/);
  // The updates: open at once while something is new on them (they were just given), folded with the latest as a preview once read.
  const fold = body.locator('.tdy-upd');
  assert.strictEqual(await fold.getAttribute('aria-expanded'), 'true', 'new updates are open');
  await page.reload();
  await page.waitForSelector('.tdx');
  const again = page.locator('.tdx', { hasText: 'Apply to Test University' });
  await again.locator('.tdx-head').click();
  const fold2 = again.locator('.tdy-upd');
  await fold2.waitFor();
  assert.strictEqual(await fold2.getAttribute('aria-expanded'), 'false', 'read updates are folded');
  assert.match(await fold2.innerText(), /Asked the student to resend the passport/);
  await fold2.click();
  assert.strictEqual(await fold2.getAttribute('aria-expanded'), 'true');
  assert.ok(await again.locator('.tdy-upd-body').isVisible());
  // Mark as done, Reschedule, Reassign and View student profile are still there.
  for (const b of ['Mark as done', 'Reschedule', 'Reassign', 'View student profile']) assert.ok(await again.locator('.tdx-actions', { hasText: b }).count(), b);
  // ... and no "..." on the Application Team's tasks (the owner, 24 Nov 2026: removed).
  assert.strictEqual(await again.locator('.tdx-actions .td-more-btn').count(), 0, 'no ... pill');
  // The "Mark as done?" window, as in the approved design F5 (the owner, 23-24 Nov 2026): a grey header with MARK AS DONE? and the
  // student's name; What happened (Applied or Not submitted), Why only when not submitted, the day it happened and optional notes, no
  // asterisks, no close cross; then Save (no Check before saving step: the owner, 24 Nov 2026). A problem shows in the window.
  await again.locator('.tdx-done').click();
  const win = page.locator('dialog.p-dialog[open]');
  await win.locator('.td-done-form').waitFor();
  assert.ok(await win.evaluate((d) => d.classList.contains('td-done-app')), 'the Application Team\'s window');
  assert.strictEqual((await win.locator('.p-dialog-head .td-done-task').textContent()).trim(), 'Gita Demo', 'only the name, in the header');
  assert.ok(Math.abs(parseFloat(await win.evaluate((d) => getComputedStyle(d).width)) - 640) < 1, 'a 640px window (to the rounding of the text size)');
  assert.match(await win.innerText(), /Test University/);
  assert.strictEqual(await win.locator('.td-done-stepno').count(), 0, 'one step: no step number');
  assert.strictEqual(await win.locator('.p-x').isVisible(), false, 'no close cross');
  for (const r of [/^What happened/, /^Day it happened/, /^Notes \(optional\)$/]) assert.ok(await win.locator('.p-label', { hasText: r }).count(), String(r));
  assert.strictEqual(await win.locator('.p-req:visible').count(), 0, 'no asterisks');
  assert.strictEqual(await win.getByText('Nothing is saved until you check it on the next step.').count(), 0);
  for (const r of ['Applied', 'Not submitted']) assert.ok(await win.getByRole('radio', { name: r, exact: true }).count(), r);
  assert.strictEqual(await win.getByRole('radio', { name: 'Applied', exact: true }).getAttribute('aria-checked'), 'true', 'Applied is chosen first');
  const whyBox = win.locator('.p-label', { hasText: /^Why/ });
  assert.ok(!(await whyBox.isVisible()), 'Why is hidden while Applied is chosen');
  await win.getByRole('radio', { name: 'Not submitted', exact: true }).click();
  await whyBox.waitFor({ state: 'visible' }); // Why shows for Not submitted
  // Every common reason has its own answer (the owner, 24 Nov 2026: "not submitted is not always not eligible").
  for (const r of ['Not eligible', 'The course is not available', 'Applications are closed', 'Already applied through another agent', 'The student chose another university', 'The student is not going ahead', 'The student is not responding', 'Other']) assert.ok(await win.getByRole('radio', { name: r, exact: true }).isVisible(), r);
  await win.getByRole('radio', { name: 'Applied', exact: true }).click();
  await whyBox.waitFor({ state: 'hidden' }); // and hides again for Applied
  await win.getByRole('radio', { name: 'Not submitted', exact: true }).click();
  await whyBox.waitFor({ state: 'visible' });
  // Not submitted with no Why: told in the window, which stays open; nothing is saved.
  const save = win.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await win.locator('.p-msg.error', { hasText: 'Choose why it was not submitted.' }).waitFor();
  assert.ok(await win.isVisible(), 'still open');
  // Other needs the reason written in Notes.
  await win.getByRole('radio', { name: 'Other', exact: true }).click();
  await win.locator('.p-label', { hasText: 'Notes (say why)' }).waitFor();
  await save.click();
  await win.locator('.p-msg.error', { hasText: 'Write the reason in Notes' }).waitFor();
  // Not eligible and a short note: saved (the Why is the reason, no 8-letter note needed), and the window closes.
  await win.getByRole('radio', { name: 'Not eligible', exact: true }).click();
  await win.locator('textarea').fill('IELTS');
  await save.click();
  await win.waitFor({ state: 'detached' });
  let card = null;
  for (let i = 0; i < 20; i += 1) { card = (await (await asha.request.get(`/api/cards/${id}`)).json()).card; if ((card.tasks.find((x) => x.id === task.id) || {}).done) break; await wait(150); }
  assert.ok(card.tasks.find((x) => x.id === task.id).done, 'the task is done');
  const answered = card.options.find((x) => x.id === oid);
  assert.ok(answered.skipped, 'the course is kept as not submitted, with its day');
  assert.match(answered.reason, /^Not eligible\. IELTS/, 'the reason chosen and the words typed');
  assert.strictEqual(answered.whyCode, 'noteligible', 'the reason kept as a code, so reasons can be counted');
  assert.ok(!card.tasks.some((x) => x.tag === 'offer' && !x.done), 'no Offer request for a course not submitted');
  assert.ok(card.notes.some((n) => /^Not submitted to Test University \(BSc Test\): Not eligible\. IELTS\./.test(n.text)), 'the note on the student');
  // The task has left Today's list.
  await page.waitForFunction(() => ![...document.querySelectorAll('.tdx')].some((e) => /Apply to Test University/.test(e.textContent)));
  // Nothing sideways, no script error.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scroll');
  assert.deepStrictEqual(errors, []);

  // All Students for the Application Team is the sheet only (the owner, 24 Nov 2026: the student list was removed); the Mock Team has the same sheet.
  const listPage = await asha.newPage();
  const listErrors = []; listPage.on('pageerror', (e) => listErrors.push(e.message));
  await listPage.goto('/students');
  await listPage.locator('#sheet').waitFor({ state: 'visible' });
  assert.strictEqual(await listPage.locator('#appleStudents, .as-sw').count(), 0, 'no student list and no switch');
  assert.deepStrictEqual(listErrors, []);
  const mockSheet = await mina.newPage();
  await mockSheet.goto('/students');
  await mockSheet.waitForSelector('#sheet');
  await mockSheet.close();
  await listPage.close();

  // The Missing details tab: one student per row with an arrow, "Needs attention" when closed, the problems with their buttons when open.
  await page.getByText('Missing details').first().click();
  const miss = page.locator('.tdy-missrow').filter({ hasText: 'Gita Demo' });
  await miss.waitFor();
  assert.match(await miss.locator('.tdy-misscount').innerText(), /^\d+ things? missing$/);
  assert.match(await page.locator('.tda-gh').first().innerText(), /^\d+ students? (has|have) something missing$/);
  const missHead = miss.locator('.tdx-head');
  if ((await missHead.getAttribute('aria-expanded')) !== 'true') await missHead.click();
  assert.strictEqual(await missHead.getAttribute('aria-expanded'), 'true');
  const lines = await miss.locator('.tdy-pr-text').allInnerTexts();
  assert.ok(lines.includes('No passport number') && lines.includes('No address'), 'one line for each thing missing: ' + lines.join(' | '));
  assert.ok(await miss.locator('.tdy-pr .tdx-fix', { hasText: 'Fix it' }).count(), 'a Fix it button on the line');
  // From the keyboard: Enter closes it and the focus stays on the same row.
  await missHead.focus();
  await page.keyboard.press('Enter');
  await wait(200);
  assert.strictEqual(await miss.locator('.tdx-head').getAttribute('aria-expanded'), 'false');
  assert.ok(await miss.locator('.tdx-head').evaluate((e) => e === document.activeElement), 'the keyboard stays on the row after it is drawn again');
  assert.strictEqual(await missHead.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(await miss.locator('.tdy-pr').count(), 0, 'closed again');

  // The Mock Team's Today, in the same look (the owner, 23 Nov 2026, approved design).
  const mockPage = await mina.newPage();
  const mockErrors = []; mockPage.on('pageerror', (e) => mockErrors.push(e.message));
  await mockPage.goto('/today');
  await mockPage.waitForSelector('.tdx');
  assert.ok(await mockPage.locator('.tda-top').count(), 'the day and "Today" at the top, as the Application Team');
  // ... and the Apple look is the Application Team's alone: no stylesheet and no four numbers for the Mock Team.
  assert.strictEqual(await mockPage.locator('link[data-apple]').count(), 0, 'the Mock Team does not load the Apple stylesheet');
  assert.strictEqual(await mockPage.locator('.tda-tile').count(), 0, 'no four numbers for the Mock Team');
  assert.strictEqual(await mockPage.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(230, 230, 230)', 'the Mock Team keeps its canvas');
  assert.strictEqual(await mockPage.locator('.td-hello').count(), 0, 'no greeting card');
  assert.ok(await mockPage.locator('.tda-row').count(), 'the rows in the same look');
  assert.match(await mockPage.locator('.tdy-hint').first().innerText(), /^No mock booked yet$/, 'what holds the student up, under the waiting time');
  await mockPage.locator('.tdx-head').first().click();
  await mockPage.waitForSelector('.tdx-body');
  const mockOpen = mockPage.locator('.tdx.is-open');
  assert.match(await mockOpen.locator('.tdy-sech').first().innerText(), /^Mocks \u00b7 0 of 4 done$/i, 'the mocks first');
  assert.deepStrictEqual(await mockOpen.locator('.tdy-first .tdy-l').allInnerTexts(), ['Mock 1', 'Mock 2', 'Mock 3', 'Mock 4', 'Pre-CAS interview']);
  assert.strictEqual(await mockOpen.locator('.tdy-first .tdy-miss').innerText(), 'Not booked', 'the next mock to book in orange');
  assert.ok(await mockOpen.locator('.tdy-cp').count(), 'copy buttons on the Student details');
  assert.strictEqual(await mockOpen.locator('.tdx-facts').count(), 0, 'no old facts tile');
  assert.strictEqual(await mockOpen.locator('.p-taskmenu, .td-more').count(), 0, 'no "..." menu');
  // ... and its "Mark as done?" window: the same look, one step, Save.
  await mockPage.locator('.tdx-done').first().click();
  const mw = mockPage.locator('dialog.p-dialog[open]');
  await mw.waitFor();
  await wait(400);
  assert.ok(await mw.evaluate((d) => d.classList.contains('td-done-app') && d.classList.contains('td-done-mock')), 'the Mock Team\'s window in the same look');
  assert.strictEqual(await mw.locator('.td-done-stepno').count(), 0, 'one step, no step number');
  await mw.getByRole('radio', { name: 'Feedback of a mock' }).click();
  await wait(200);
  assert.ok(await mw.getByRole('radio', { name: 'Mock 2' }).isVisible(), 'Which mock as round choices');
  assert.ok(await mw.getByRole('button', { name: 'Save' }).count(), 'Save, with no Check before saving');
  await mw.getByRole('button', { name: 'Not yet' }).click();
  await mw.waitFor({ state: 'detached' });
  // ... and its Missing details tab in the same look.
  await mockPage.locator('.tda-view', { hasText: 'Missing details' }).click();
  await wait(500);
  assert.ok(await mockPage.locator('.tdy-missrow, .tda-clear').count(), 'Missing details in the same look');
  assert.deepStrictEqual(mockErrors, []);

  // Admin's Today is as it was.
  const adminPage = await admin.newPage();
  await adminPage.goto('/today');
  await adminPage.waitForSelector('.td-page');
  await wait(500);
  assert.strictEqual(await adminPage.locator('.tda-top, .tda-row, .tdy-body').count(), 0, 'Admin keeps its own Today');
});
