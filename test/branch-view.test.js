// A branch's own screens in a real browser: Today in the Application Team's look, switching between the tasks assigned to the branch
// and the tasks it assigned, with Assign a task from start to end (the owner, 28 Nov 2026); All Students as Admin's, with its own
// students only (the owner, 28 Nov 2026); and the Dashboard (about one screen; a figure opens the students behind it). Admin's Today
// keeps its two lists, and the student card keeps its task window.
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
const trimmed = async (locator) => (await locator.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());

test('a branch: Today, All Students and the Dashboard', { timeout: 180000, skip: !playwright && 'Playwright is not installed' }, async (t) => {
  let browser;
  try { browser = await playwright.chromium.launch(); } catch (e) { t.skip('no Chromium browser available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr360-branch-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), STUDENT_DETAILS_DATA_DIR: dir, COUNSELOR_DATA_DIR: path.join(dir, 'incentive') };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'student-details'), env, stdio: 'ignore' });
  t.after(async () => { server.kill(); await browser.close(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(base + '/login')).ok) break; } catch (e) { /* not up yet */ } await wait(250); }

  const admin = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  const code = fs.readFileSync(path.join(dir, 'first-admin-code.txt'), 'utf8').trim();
  assert.ok((await admin.request.post('/api/login/first-admin', { data: { setupCode: code, username: 'owner', name: 'Owner Test' } })).ok());
  assert.ok((await admin.request.post('/api/login/new-password', { data: { password: 'Strong-Pass-2026' } })).ok());
  const person = async (username, departments) => {
    const made = await admin.request.post('/api/users', { data: { username, name: username + ' Test', email: '', departments } });
    const temp = (await made.json()).temporaryPassword;
    const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
    assert.ok((await ctx.request.post('/api/login', { data: { username, password: temp } })).ok());
    assert.ok((await ctx.request.post('/api/login/new-password', { data: { password: 'Team-Strong-2026' } })).ok());
    return ctx;
  };
  const branch = await person('chit', ['chitwan']);
  const asha = await person('asha', ['application']);

  const add = async (first, source) => (await (await admin.request.post('/api/students/new', { data: { stage: 'Application Stage', fields: { 'FIRST NAME': first, 'LAST NAME': 'Demo', 'CONTACT NUMBER': first === 'Gita' ? '9800000555' : '9800000666', EMAIL: `${first.toLowerCase()}.demo@example.com`, 'STUDENT SOURCE': source } } })).json()).id;
  const own = await add('Gita', 'Chitwan Branch');
  const other = await add('Hari', 'Social Media');
  assert.ok((await admin.request.post(`/api/cards/${own}/sheet`, { data: { fields: { 'UNIVERSITY NAME': 'Coventry University', 'COURSE NAME': 'MBA', 'APPLICATION SUBMISSION DATE': new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) } } })).ok());
  // One task to the branch, one the branch assigns and keeps open, one it assigns that the team finishes.
  assert.ok((await admin.request.post(`/api/cards/${own}/tasks`, { data: { team: 'chitwan', text: 'Confirm the interview time', tag: 'other' } })).ok());
  assert.ok((await branch.request.post(`/api/cards/${own}/tasks`, { data: { team: 'application', text: 'Check which courses fit', tag: 'other' } })).ok());
  assert.ok((await branch.request.post(`/api/cards/${own}/tasks`, { data: { team: 'application', text: 'Send the offer letter', tag: 'other' } })).ok());
  const finishing = (await (await asha.request.get('/api/tasks')).json()).tasks.find((x) => x.text === 'Send the offer letter');
  assert.ok((await asha.request.post(`/api/cards/${own}/tasks/${finishing.id}`, { data: { done: true, finish: { note: 'Sent to the student', confirmed: true } } })).ok(), 'the team finishes it');

  // The student's University and course go with a task to the branch only, and only for its own students.
  const tasksOf = async (ctx) => (await (await ctx.request.get('/api/tasks')).json()).tasks;
  const branchTasks = await tasksOf(branch);
  assert.ok(branchTasks.length === 3 && branchTasks.every((x) => x.studies && x.studies.university === 'Coventry University' && x.studies.course === 'MBA'), 'a branch gets each student\'s University and course');
  assert.ok((await tasksOf(admin)).every((x) => !x.studies) && (await tasksOf(asha)).every((x) => !x.studies), 'nobody else does');

  const errors = [];
  const open = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${url}: ${e.message}`)); await p.goto(url); return p; };
  const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // Today: the teams' screen, switching between the two directions.
  const today = await open(branch, '/today');
  await today.waitForSelector('.tda-tile');
  assert.deepStrictEqual(await trimmed(today.locator('.tda-tile .tda-tile-k')), ['Late', 'Assigned to you', 'Assigned by you', 'Later']);
  assert.deepStrictEqual(await trimmed(today.locator('.tda-view')), ['Assigned to you 1', 'Assigned by you 1', 'Later 0']);
  await today.locator('.tdx-head', { hasText: 'Confirm the interview time' }).click();
  const detail = today.locator('.tdx.is-open');
  await detail.locator('.tdy-body').waitFor();
  assert.match(await detail.innerText(), /University[\s\S]*Coventry University[\s\S]*MBA[\s\S]*gita\.demo@/i);
  assert.doesNotMatch(await detail.innerText(), /Source/i, 'no Student Source: the branch is the source');
  await today.locator('.tda-view', { hasText: 'Assigned by you' }).click();
  await today.locator('.tdx-head', { hasText: 'Check which courses fit' }).click();
  assert.match(await today.locator('.tdx.is-open').innerText(), /Given by you to the Application Team/);
  assert.doesNotMatch(await today.locator('.tda-tasks').innerText(), /Send the offer letter/, 'a finished task leaves the list');
  // Assign a task: only the branch's own students are found; the task window opens here and the new task shows under Assigned by you.
  await today.locator('.bt-assign').click();
  await today.locator('dialog[open] input[type="search"]').fill('Hari');
  await today.getByText('No student of yours matches.').waitFor();
  await today.locator('dialog[open] input[type="search"]').fill('Gita');
  await today.locator('.bt-find-row', { hasText: 'Gita Demo' }).click();
  const window1 = today.locator('dialog[open]', { has: today.locator('.p-assign') });
  await window1.waitFor();
  await window1.locator('select').first().selectOption({ label: 'Application Team' }).catch(async () => { await window1.locator('select').first().selectOption('application'); });
  await window1.locator('.td-tag-pick button', { hasText: 'Documents' }).click();
  await window1.locator('textarea:visible').first().fill('Please ask for the bank statement');
  await window1.getByRole('button', { name: 'Assign', exact: true }).click();
  await today.locator('.tdx.is-open', { hasText: 'bank statement' }).waitFor({ timeout: 10000 });
  assert.match(await today.locator('.tda-view[aria-selected="true"]').innerText(), /Assigned by you/);
  assert.ok((await tasksOf(branch)).some((x) => /bank statement/.test(x.text) && x.team === 'application'), 'the task is saved');
  assert.ok(today.url().endsWith('/today'), 'the whole of it happens on Today');
  assert.ok(!(await today.content()).includes(other), 'the other source\'s student is nowhere');
  await today.close();
  // On a phone a task opens under its own line and nothing runs off the side.
  const phone = await branch.newPage();
  phone.on('pageerror', (e) => errors.push(`phone /today: ${e.message}`));
  await phone.setViewportSize({ width: 375, height: 780 });
  await phone.goto('/today');
  await phone.waitForSelector('.tdx-head');
  await phone.locator('.tdx-head').first().click();
  await phone.locator('.tdx.is-open .tdy-body').waitFor();
  assert.ok(await noSideScroll(phone), 'no sideways scroll');
  await phone.close();

  // All Students: Admin's sheet and number boxes, with the branch's own students only.
  const look = async (ctx) => {
    const p = await open(ctx, '/students');
    await p.waitForSelector('#body td[data-col="FIRST NAME"]');
    await p.locator('#toggleStats').click();
    await p.waitForSelector('#statusSummary .stat-total');
    return p;
  };
  const numbers = (p) => trimmed(p.locator('#statusSummary .stat-label'));
  const blue = (p) => p.locator('#statusSummary .stat-total').evaluate((e) => getComputedStyle(e).backgroundColor);
  const officeSheet = await look(admin);
  const sheet = await look(branch);
  assert.strictEqual(await sheet.locator('#studentList, .brn').count(), 0, 'no list or number cards of its own');
  assert.deepStrictEqual(await numbers(sheet), await numbers(officeSheet), 'the same number boxes as Admin');
  assert.strictEqual(await blue(sheet), await blue(officeSheet), 'Total Students in the same look');
  const heads = (p) => p.locator('#sheet thead th[data-col]').evaluateAll((list) => list.map((th) => th.dataset.col));
  assert.strictEqual((await heads(sheet))[0], 'APPLICATION STATUS', 'Application Status first, as on Admin\'s sheet');
  assert.deepStrictEqual((await trimmed(sheet.locator('#body td[data-col="FIRST NAME"]'))).filter(Boolean), ['Gita'], 'its own student only');
  assert.ok(await sheet.locator('#cameFrom').isHidden(), 'no Source choice');
  assert.ok(await sheet.locator('#bulkSend').isHidden().catch(() => true), 'no Follow-up button');
  const status = sheet.locator('#body td[data-col="APPLICATION STATUS"] select').first();
  await status.focus(); // the choices are put in when the menu is opened
  await status.selectOption('Hold');
  const yes = sheet.getByRole('button', { name: 'Yes, move on' });
  if (await yes.isVisible().catch(() => false)) await yes.click();
  const stageNow = async () => (await (await admin.request.get(`/api/cards/${own}`)).json());
  let saved = false;
  for (let i = 0; i < 40 && !saved; i += 1) { await wait(250); saved = /"Hold"/.test(JSON.stringify(await stageNow())); }
  assert.ok(saved, 'the new status is saved');
  await sheet.setViewportSize({ width: 375, height: 780 });
  await wait(600);
  assert.ok(await noSideScroll(sheet), 'no sideways scroll');
  await sheet.close();
  await officeSheet.close();

  // Dashboard (28 Nov 2026): eight figures, conversion, intake by intake, universities, growth and the two student lists, in the look of
  // Today; a figure opens the students behind it.
  const dash = await open(branch, '/my-dashboard');
  await dash.waitForSelector('.bd-strip');
  assert.strictEqual(await dash.locator('.bd-fig').count(), 8);
  assert.strictEqual(await dash.locator('.tda-top h1').innerText(), 'Dashboard');
  for (const card of ['Conversion', 'Ratios', 'Intake by intake', 'Universities', 'Intake performance and growth', 'Students by application', 'Every student, step by step']) {
    assert.ok(await dash.locator('.bd-card', { hasText: card }).count() >= 1, card + ' is on the page');
  }
  assert.strictEqual(await dash.locator('.bd-step').count(), 10, 'ten steps from all students to visa received');
  await dash.locator('.bd-fig', { hasText: 'Applications submitted' }).click();
  assert.match(await dash.locator('dialog.bd-dialog').innerText(), /Gita Demo[\s\S]*Coventry University/);
  await dash.keyboard.press('Escape');
  await dash.locator('dialog.bd-dialog').waitFor({ state: 'detached' });
  assert.match(await dash.locator('.bd-card', { hasText: 'Every student, step by step' }).innerText(), /Gita Demo/);
  assert.doesNotMatch(await dash.locator('#view').innerText(), /Hari Demo/, 'a student of another source is not listed');
  const pageText = await dash.locator('#view').innerText();
  assert.ok(![8211, 8212].some((code) => pageText.includes(String.fromCharCode(code))), 'no long dash on the page');
  await dash.setViewportSize({ width: 375, height: 780 });
  await wait(400);
  assert.ok(await noSideScroll(dash), 'no sideways scroll');
  await dash.close();

  // Admin's Today keeps its two lists only.
  const office = await open(admin, '/today');
  await office.waitForSelector('.dt-col');
  assert.strictEqual(await office.locator('.tda-tile, .bt-assign').count(), 0);
  await office.close();
  // The student card keeps its "Assign a task" window, for the office as for the branch.
  for (const ctx of [admin, asha, branch]) {
    const card = await open(ctx, `/student?id=${own}`);
    await card.getByRole('button', { name: 'Assign a task' }).first().click();
    await card.locator('dialog[open] .p-assign').waitFor({ timeout: 8000 });
    assert.strictEqual(await card.locator('dialog[open] .bt-about').count(), 0, 'the card knows its student');
    await card.close();
  }
  assert.deepStrictEqual(errors, []);
});
