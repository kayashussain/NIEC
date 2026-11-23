// The Application Team's opened task on Today (the owner, 23 Nov 2026, approved design F5), in a real browser: what is missing first, the
// details with a copy button each, the updates folded, no student source or partner; and the other teams' Today unchanged.
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

  // The Application Team's Today.
  const page = await asha.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/today');
  await page.waitForSelector('.tdx');
  // The screen is the approved F5 layout: the day and "Today", three tabs, a search box with the kinds (All first), headings over panels;
  // none of the old greeting or the progress card.
  assert.strictEqual(await page.locator('.tda-top h1').innerText(), 'Today');
  assert.ok(await page.locator('.tda-date').innerText(), 'the day is shown');
  assert.deepStrictEqual((await page.locator('.tda-view').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').replace(/\s+/g, ' ').trim()), ['Today', 'Later', 'Missing details'], 'the three tabs');
  assert.strictEqual(await page.locator('.tda-view[aria-selected="true"]').count(), 1);
  assert.match(await page.locator('.tda-bar .tda-pill[aria-selected="true"]').innerText(), /^All\s*\d+$/, 'All is first and chosen');
  assert.ok(await page.locator('.tda-bar .tda-search input').count(), 'the search box is in the same row');
  assert.match(await page.locator('.tda-gh').first().innerText(), /^(Late, do these first|Today) \u00b7 \d+$/, 'a heading over its panel');
  assert.strictEqual(await page.locator('.td-hello, .td-pulse, .td-tasks').count(), 0, 'no greeting, no progress card, no Tasks box');
  const closed = page.locator('.tdx', { hasText: 'Apply to Test University' });
  assert.match(await closed.locator('.tdy-hint').innerText(), /3 details missing/, 'the closed task says what is missing');
  await closed.locator('.tdx-head').click();
  const body = closed.locator('.tdy-body');
  await body.waitFor();
  const text = await body.locator('.tdy-details').innerText(); // the details; the updates are the conversation (the system's own assignment line may name the partner)
  assert.match(text, /Add these 3 before you submit/i);
  assert.match(text, /Passport number[\s\S]*Missing/);
  assert.match(text, /Address[\s\S]*Missing/);
  assert.match(text, /Nationality[\s\S]*Missing/, 'a student with no nationality saved has it listed as missing');
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
  // ... and the "..." pill at the right end, as in F5, which opens a menu with the student card in a new tab.
  const more = again.locator('.tdx-actions .td-more-btn');
  assert.strictEqual(await more.count(), 1, 'the ... pill');
  const mb = await more.boundingBox();
  const pb = await again.locator('.tdx-actions .tdx-profile').boundingBox();
  // Its own size is 44px (the page is drawn at the text size the person chose, so the box on screen can be smaller).
  assert.strictEqual(await more.evaluate((e) => getComputedStyle(e).minHeight), '44px', 'a 44px pill');
  assert.ok(mb.x > pb.x + pb.width, 'after View student profile, at the right');
  await more.click();
  await again.getByRole('menuitem', { name: 'Open the student card in a new tab' }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await again.locator('.td-menu').waitFor({ state: 'hidden' });
  // The "Mark as done?" window, as in the approved design F5 (the owner, 23 Nov 2026): Step 1 of 2 asks What happened (Applied or
  // Not submitted), Why only when not submitted, the day it happened and optional notes; Next: check shows Step 2 of 2, Check before
  // saving, with Back and Yes, this is correct. Nothing is saved here (Back, then Not yet).
  await again.locator('.tdx-done').click();
  const win = page.locator('dialog.p-dialog[open]');
  await win.locator('.td-done-form').waitFor();
  assert.ok(await win.evaluate((d) => d.classList.contains('td-done-app')), 'the Application Team\'s window');
  assert.match(await win.innerText(), /Gita Demo/);
  assert.match(await win.innerText(), /Test University/);
  const stepText = () => win.locator('.td-done-stepno').textContent(); // drawn in capitals by the CSS, so its text, not innerText
  assert.strictEqual(await stepText(), 'Step 1 of 2');
  for (const r of [/^What happened/, /^Day it happened/, /^Notes \(optional\)$/]) assert.ok(await win.locator('.p-label', { hasText: r }).count(), String(r));
  for (const r of ['Applied', 'Not submitted']) assert.ok(await win.getByRole('radio', { name: r, exact: true }).count(), r);
  assert.strictEqual(await win.getByRole('radio', { name: 'Applied', exact: true }).getAttribute('aria-checked'), 'true', 'Applied is chosen first');
  const whyBox = win.locator('.p-label', { hasText: /^Why/ });
  assert.ok(!(await whyBox.isVisible()), 'Why is hidden while Applied is chosen');
  await win.getByRole('radio', { name: 'Not submitted', exact: true }).click();
  await whyBox.waitFor({ state: 'visible' }); // Why shows for Not submitted
  for (const r of ['Not eligible', 'Already applied through another agent', 'The course is not available', 'Applications are closed']) assert.ok(await win.getByRole('radio', { name: r, exact: true }).isVisible(), r);
  await win.getByRole('radio', { name: 'Applied', exact: true }).click();
  await whyBox.waitFor({ state: 'hidden' }); // and hides again for Applied
  assert.ok(await win.getByText('Nothing is saved until you check it on the next step.').count());
  await win.getByRole('button', { name: 'Next: check' }).click();
  await win.locator('.td-check-title').waitFor();
  assert.strictEqual((await win.locator('.td-check-title').textContent()).trim(), 'Check before saving');
  assert.strictEqual(await stepText(), 'Step 2 of 2');
  assert.ok(await win.getByRole('button', { name: 'Yes, this is correct' }).count());
  await win.getByRole('button', { name: 'Back' }).click();
  assert.strictEqual(await stepText(), 'Step 1 of 2');
  await win.getByRole('button', { name: 'Not yet' }).click();
  await win.waitFor({ state: 'detached' });
  // Nothing sideways, no script error.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scroll');
  assert.deepStrictEqual(errors, []);

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

  // The Mock Team's Today is as it was.
  const mockPage = await mina.newPage();
  await mockPage.goto('/today');
  await mockPage.waitForSelector('.tdx');
  await mockPage.locator('.tdx-head').first().click();
  await mockPage.waitForSelector('.tdx-body');
  assert.strictEqual(await mockPage.locator('.tdy-body, .tdy-hint, .tda-top, .tda-row').count(), 0, 'the Mock Team sees the opened task as before');
  assert.ok(await mockPage.locator('.td-hello').count(), 'and keeps its own greeting and layout');
  assert.ok(await mockPage.locator('.tdx-facts').count(), 'with its facts tile');
  // ... and its "Mark as done?" window is as before (no Application Team class, no step number).
  await mockPage.locator('.tdx-done').first().click();
  const mw = mockPage.locator('dialog.p-dialog[open]');
  await mw.waitFor();
  await wait(400);
  assert.ok(await mw.evaluate((d) => !d.classList.contains('td-done-app')), 'the Mock Team\'s window keeps its look');
  assert.strictEqual(await mw.locator('.td-done-stepno').count(), 0);
  await mw.getByRole('button', { name: 'Not yet' }).click();
  await mw.waitFor({ state: 'detached' });
  // ... and its Missing details tab keeps its own rows.
  await mockPage.getByText('Missing details').first().click().catch(() => {});
  await wait(500);
  assert.strictEqual(await mockPage.locator('.tdy-missrow').count(), 0, 'the Mock Team keeps its Missing details as before');
});
