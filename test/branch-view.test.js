// A branch's own screens in a real browser (the owner, 27 Nov 2026): Today (the summary, a task with the student's progress and no
// Student Source, what was finished, Assign a task), All Students (no Application Status, the three views, the number cards) and the
// Dashboard (a figure opens the students behind it). Admin's Today keeps its two lists.
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

  // The progress goes to the branch only, and only for its own students.
  const tasksOf = async (ctx) => (await (await ctx.request.get('/api/tasks')).json()).tasks;
  assert.ok((await tasksOf(branch)).length === 3 && (await tasksOf(branch)).every((x) => x.journey && x.journey.hasApplied), 'a branch gets each student\'s progress');
  assert.ok((await tasksOf(admin)).every((x) => !x.journey) && (await tasksOf(asha)).every((x) => !x.journey), 'nobody else does');

  const errors = [];
  const open = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${url}: ${e.message}`)); await p.goto(url); return p; };

  // Today.
  const today = await open(branch, '/today');
  await today.waitForSelector('.bt-sum');
  assert.deepStrictEqual((await today.locator('.bt-tile-k').allInnerTexts()).map((x) => x.trim()), ['For you to do', 'Late', 'With our teams', 'Finished']);
  assert.deepStrictEqual(await today.locator('.bt-tile-n').allInnerTexts(), ['1', '0', '1', '1']);
  assert.deepStrictEqual((await today.locator('.dt-head h2').allInnerTexts()).map((x) => x.trim()), ['Assigned to you', 'Assigned by you']);
  await today.locator('.dt-to .tdx-task').click();
  const opened = today.locator('.dt-to .tdx.is-open');
  await opened.locator('.bt-steps').waitFor();
  assert.strictEqual(await opened.locator('.bt-steps li').count(), 8, 'eight steps');
  assert.match(await opened.locator('.bt-steps li.is-done').first().innerText(), /Applied/);
  assert.match(await opened.locator('.bt-steps li.is-next').innerText(), /Offer[\s\S]*Next/);
  assert.match(await opened.locator('.bt-reach').innerText(), /9800000555[\s\S]*gita\.demo@/);
  assert.doesNotMatch(await opened.innerText(), /Source/i, 'no Student Source: the branch is the source');
  assert.strictEqual(await opened.locator('.bt-way a.bt-act').count(), 3, 'Chat, Write and Call');
  await today.locator('.bt-done-head').click();
  assert.match(await today.locator('.bt-done-row').innerText(), /Gita Demo[\s\S]*Send the offer letter[\s\S]*asha Test/);
  // Assign a task: only the branch's own students are found, and the card opens with the task window.
  await today.locator('.bt-assign').click();
  await today.locator('dialog[open] input[type="search"]').fill('Hari');
  await today.getByText('No student of yours matches.').waitFor();
  await today.locator('dialog[open] input[type="search"]').fill('Gita');
  await today.locator('.bt-find-row', { hasText: 'Gita Demo' }).click();
  await today.waitForURL((u) => u.pathname === '/student');
  await today.locator('dialog[open] h2', { hasText: 'Assign a task' }).waitFor();
  assert.ok(!today.url().includes('assign='), 'a reload does not open the window again');
  assert.ok(today.url().includes(own) && !today.url().includes(other));
  await today.close();
  // On a phone nothing runs off the side.
  const phone = await open(branch, '/today');
  await phone.setViewportSize({ width: 375, height: 780 });
  await phone.waitForSelector('.bt-sum');
  await phone.locator('.dt-to .tdx-task').click();
  await phone.locator('.bt-steps').waitFor();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
  await phone.close();

  // All Students.
  const sheet = await open(branch, '/students');
  await sheet.waitForSelector('#body tr:not(.pad-row)');
  const heads = () => sheet.locator('#sheet thead th[data-col]').evaluateAll((list) => list.map((th) => th.dataset.col));
  assert.ok(!(await heads()).includes('APPLICATION STATUS'), 'Application Status is not a column for a branch');
  assert.deepStrictEqual((await heads()).slice(0, 2), ['FIRST NAME', 'LAST NAME']);
  await sheet.locator('.brv-view', { hasText: 'Payment, CAS and visa' }).click();
  assert.deepStrictEqual((await heads()).slice(-7), ['PAYMENT DATE', 'CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE', 'E-VISA']);
  await sheet.locator('.brv-view', { hasText: 'Every column' }).click();
  await sheet.locator('#toggleStats').click();
  const cards = await sheet.locator('#statusSummary').innerText();
  for (const label of ['Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued', 'Defer', 'Hold', 'Withdrawn', 'Conversion rate']) assert.ok(cards.includes(label), `${label} is a number`);
  assert.doesNotMatch(cards, /Total students|Inquiry|Visa Rejected/);
  await sheet.close();

  // Dashboard: a figure opens the students behind it.
  const dash = await open(branch, '/my-dashboard');
  await dash.locator('button.bd-total', { hasText: 'Applications submitted' }).click();
  assert.match(await dash.locator('.bd-open').innerText(), /Gita Demo[\s\S]*Coventry University/);
  assert.doesNotMatch(await dash.locator('#view, main').first().innerText(), /Hari Demo/, 'another source\'s student is not listed');
  await dash.close();

  // Admin's Today keeps its two lists only.
  const office = await open(admin, '/today');
  await office.waitForSelector('.dt-col');
  assert.strictEqual(await office.locator('.bt-sum, .bt-done, .bt-assign').count(), 0);
  await office.close();
  assert.deepStrictEqual(errors, []);
});
