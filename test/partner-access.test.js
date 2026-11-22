// Who sees what of Partner Universities, B2B Partners, Agents and Message templates (student-details/partner-access.js), and a
// branch giving the Application Team tasks about its own students. All names and details here are made up.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('partners: the Manager sees the commission, the teams and branches do not; branches give tasks', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-access-'));
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
  const login = async (username, departments, manager = false) => {
    const made = (await admin('POST', '/api/users', { username, name: username, email: '', departments, ...(manager ? { manager: true } : {}) })).json;
    const p = person(); await p('POST', '/api/login', { username, password: made.temporaryPassword }); await p('POST', '/api/login/new-password', { password: 'Team-Strong-2026' }); return p;
  };
  const asha = await login('asha', ['application']);
  const chitwan = await login('chitwan', ['chitwan']);
  const chief = await login('chief', [], true);

  // A partner university and a B2B partner with a commission, a login and notes (made up).
  const uni = (await admin('POST', '/api/direct', { name: 'Example University' })).json;
  assert.strictEqual((await admin('POST', `/api/direct/${uni.id}`, { name: 'Example University', apply: 'https://apply.example.org', applyUser: 'nieclogin', applyPassword: 'secret-pass', slabs: [{ level: 'PG', students: '1 to 5', commission: '15%' }], paymentTerms: 'Paid in March', notes: 'Bonus 2%', contacts: [{ name: 'Ann Example', email: 'ann@example.org' }] })).status, 200);
  const partner = (await admin('POST', '/api/b2b', { name: 'Example Partner' })).json;
  assert.strictEqual((await admin('POST', `/api/b2b/${partner.id}`, { name: 'Example Partner', apply: 'https://portal.example.org', applyUser: 'u1', applyPassword: 'p1', commissions: [{ intake: 'Jan Intake 2027', link: 'https://example.org/commission' }], notes: 'Rate 10%' })).status, 200);

  const SECRET = /15%|Paid in March|Bonus 2%|secret-pass|nieclogin|Rate 10%|example\.org\/commission|"p1"|"u1"/;
  const NO_LOGIN_SECRET = /15%|Paid in March|Bonus 2%|Rate 10%|example\.org\/commission/; // what even the Application Team never gets
  for (const [who, p] of [['asha', asha], ['chitwan', chitwan]]) {
    const list = await p('GET', '/api/direct');
    assert.strictEqual(list.status, 200, `${who} opens Partner Universities`);
    const one = await p('GET', `/api/direct/${uni.id}`);
    // The portal login is for Admin and the Application Team only (the owner, 14 Nov 2026).
    const seen = JSON.stringify(list.json) + JSON.stringify(one.json);
    if (who === 'asha') assert.ok(!NO_LOGIN_SECRET.test(seen) && one.json.applyPassword === 'secret-pass' && one.json.applyUser === 'nieclogin', 'the Application Team gets the login, still no commission or notes');
    else assert.ok(!SECRET.test(seen), `${who} gets no commission, notes or login`);
    assert.strictEqual(one.json.applyPortal, 'https://apply.example.org/', `${who} sees where to submit`);
    assert.strictEqual(one.json.contacts[0].name, 'Ann Example', `${who} sees the contacts`);
    assert.strictEqual((await p('POST', `/api/direct/${uni.id}`, { name: 'Changed' })).status, 403, `${who} cannot change it`);
    // The Application Team no longer opens the Partners pages (the owner, 21 Nov 2026); a branch still does.
    assert.strictEqual((await p('GET', '/partner-universities')).status, who === 'chitwan' ? 200 : 302);
    assert.strictEqual((await p('GET', '/message-templates')).status, 302, 'Message templates is gone: it leads home');
  }
  // A university, a Partner University or its short form (OIG, OIEG) is never listed on B2B Partners, not even as hidden (the owner, 20 Nov 2026).
  await admin('POST', '/api/direct', { name: 'Oxford International Education Group' });
  for (const n of ['OIG', 'OIEG', 'Leeds Beckett University', 'Made Up Partner']) await admin('POST', '/api/b2b/not-partner', { name: n });
  assert.deepStrictEqual((await admin('GET', '/api/b2b')).json.notPartners, ['Made Up Partner'], 'only a real partner name can be hidden');
  {
    const b = await asha('GET', '/api/b2b');
    assert.strictEqual(b.json.access, 'setup');
    const seenB = JSON.stringify(b.json) + JSON.stringify((await asha('GET', `/api/b2b/${partner.id}`)).json);
    assert.ok(!NO_LOGIN_SECRET.test(seenB) && /"applyPassword":"p1"/.test(seenB), 'the Application Team gets the B2B login, not the commission');
    assert.strictEqual((await asha('GET', '/api/agents')).status, 200);
  }
  // The Application Team sets B2B partners up (the owner, 15 Nov 2026): it sees the names on the sheet and adds one, but on a partner
  // it changes only the portal link (or email), its username and its password; the name, status, contacts, commission lists and notes
  // stay as Admin left them, the files stay closed, and only Admin removes a partner.
  assert.ok(Array.isArray((await asha('GET', '/api/b2b')).json.onSheet), 'the Application Team sees the names not set up yet');
  // Nothing is added by hand any more (the owner, 20 Nov 2026): the team hides a name that is not a partner, it never adds one.
  assert.strictEqual((await asha('POST', '/api/b2b', { name: 'Set Up By Team' })).status, 403, 'the Application Team does not add partners');
  const before = (await admin('GET', `/api/b2b/${partner.id}`)).json;
  const changed = await asha('POST', `/api/b2b/${partner.id}`, { name: 'Renamed by the team', status: 'Ended', city: 'Elsewhere', contacts: [{ name: 'New contact' }], commissions: [], notes: 'changed by the team', apply: 'https://portal.example.org/new', applyUser: 'team-user', applyPassword: 'team-pass' });
  assert.strictEqual(changed.status, 200);
  assert.ok(!NO_LOGIN_SECRET.test(JSON.stringify(changed.json)), 'the answer carries no commission either');
  const after = (await admin('GET', `/api/b2b/${partner.id}`)).json;
  assert.deepStrictEqual([after.applyPortal, after.applyUser, after.applyPassword], ['https://portal.example.org/new', 'team-user', 'team-pass'], 'the portal and its login change');
  assert.deepStrictEqual([after.name, after.status, after.city, after.contacts], [before.name, before.status, before.city, before.contacts], 'the details stay as Admin left them');
  assert.strictEqual(after.commissions[0].intake, 'Jan Intake 2027', 'the commission list is kept');
  assert.strictEqual(after.notes, before.notes, 'the notes are kept');
  assert.strictEqual((await asha('POST', `/api/b2b/${partner.id}/delete`, {})).status, 403, 'only Admin removes a partner');
  assert.strictEqual((await chitwan('POST', '/api/b2b/not-partner', { name: 'Someone' })).status, 403);
  assert.strictEqual((await asha('POST', '/api/b2b/not-partner', { name: 'Someone' })).status, 200, 'the Application Team marks Not a partner');
  // Set up all is gone (the owner, 20 Nov 2026: nothing is added by hand on the partner pages): the names on the sheet stay as they are.
  const sheetBefore = (await asha('GET', '/api/b2b')).json.onSheet;
  assert.notStrictEqual((await asha('POST', '/api/b2b/setup-all', {})).status, 200, 'there is no Set up all any more');
  assert.deepStrictEqual((await asha('GET', '/api/b2b')).json.onSheet, sheetBefore, 'nothing on the sheet was set up');
  assert.notStrictEqual((await admin('POST', '/api/agents/setup-all', {})).status, 200, 'nor for Agents');
  assert.strictEqual((await chitwan('GET', '/api/b2b')).status, 403, 'a branch has no B2B Partners');
  assert.strictEqual((await chitwan('GET', '/api/agents')).status, 403, 'a branch has no Agents');
  assert.strictEqual((await chitwan('GET', '/b2b-partners')).status, 302);
  // Partners: one menu entry; it opens the first of the three lists the account may see (the owner, 17 Nov 2026).
  assert.strictEqual((await chitwan('GET', '/partners')).location, '/partner-universities', 'a branch lands on Partner Universities');
  assert.strictEqual((await asha('GET', '/partners')).location, '/today', 'the Application Team has no Partners (the owner, 21 Nov 2026)');
  const mgr = (await chief('GET', `/api/direct/${uni.id}`)).json;
  assert.deepStrictEqual([mgr.slabs[0].commission, mgr.paymentTerms, mgr.applyPassword], ['15%', 'Paid in March', undefined], 'the Manager sees the commission, not the login');
  assert.strictEqual((await chief('GET', `/api/b2b/${partner.id}`)).json.commissions[0].intake, 'Jan Intake 2027');
  assert.strictEqual((await chief('POST', `/api/direct/${uni.id}`, { name: 'Changed' })).status, 403, 'the Manager only looks');
  assert.strictEqual((await admin('GET', `/api/direct/${uni.id}`)).json.applyPassword, 'secret-pass', 'Admin sees everything');

  // A partner address that is not one partner's id is "not found" (it used to answer with the whole list, and the page broke).
  assert.strictEqual((await admin('GET', '/api/agents/not-an-id')).status, 404);
  assert.strictEqual((await asha('GET', '/api/b2b/ag0000000000')).status, 404);
  // The visa target can be due before teaching starts (that is normal), so saving it is not refused.
  const sheetId = (await admin('GET', '/api/data')).json.sheets[0].id;
  assert.strictEqual((await admin('POST', `/api/planning/targets/${sheetId}`, { visas: 40, byDate: '2027-01-10', startDate: '2027-01-20' })).status, 200);

  // A branch gives its own student a task for the Application Team, or for Admin (no other team), and removes only its own tasks.
  const id = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Mina', 'LAST NAME': 'Example', 'CONTACT NUMBER': '9800000002', 'STUDENT SOURCE': 'Chitwan Branch' } })).json.id;
  const card = (await chitwan('GET', `/api/cards/${id}`)).json;
  assert.deepStrictEqual(card.assignTeams.map((x) => x.id), ['application', 'head']);
  assert.strictEqual((await chitwan('POST', `/api/cards/${id}/tasks`, { team: 'mock', text: 'x' })).status, 400, 'the Mock Team no longer exists');
  const given = await chitwan('POST', `/api/cards/${id}/tasks`, { team: 'application', text: 'Submit to Example University' });
  assert.strictEqual(given.status, 200);
  const taskId = given.json.card.tasks[0].id;
  assert.ok((await asha('GET', '/api/tasks')).json.tasks.some((x) => x.text === 'Submit to Example University'), 'the Application Team sees it on Today');
  assert.ok((await chitwan('GET', '/api/tasks')).json.tasks.some((x) => x.given && x.text === 'Submit to Example University'), 'the branch sees the task it gave');
  assert.strictEqual((await chitwan('POST', `/api/cards/${id}/tasks/${taskId}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 403, 'the team ticks it, not the branch');
  assert.strictEqual((await asha('POST', `/api/cards/${id}/tasks/${taskId}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200); // a tracking task closed with words only needs a next day
  assert.strictEqual((await asha('POST', `/api/cards/${id}/tasks/${taskId}/delete`, {})).status, 403);
  assert.strictEqual((await chitwan('POST', `/api/cards/${id}/tasks/${taskId}/delete`, {})).status, 200, 'the branch removes the task it gave');
});

// Only the Application Team and Admin see a portal login (the owner, 15 Nov 2026). The page is told only that a login exists, so it can
// say "you do not have access".
test('portal logins: only the Application Team sees them; the removed Mock Team counts for nothing', () => {
  const { seesLogins, shapeDirect, shapePartner } = require('../student-details/partner-access');
  const person = (departments, taskTeam = '') => ({ role: 'staff', departments, taskTeam });
  assert.strictEqual(seesLogins(person(['application'])), true, 'the Application Team');
  assert.strictEqual(seesLogins(person(['chitwan'])), false, 'a branch');
  assert.strictEqual(seesLogins(person(['mock'])), false, 'an account still holding the removed Mock Team');
  const uni = { name: 'Example University', applyPortal: 'https://apply.example.org', applyUser: 'u1', applyPassword: 'p1', slabs: ['UG 15%'], paymentTerms: 'March' };
  const seen = shapeDirect(uni, 'team', false);
  assert.deepStrictEqual([seen.applyUser, seen.applyPassword, seen.slabs, seen.paymentTerms, seen.loginHidden, seen.applyPortal], [undefined, undefined, undefined, undefined, true, 'https://apply.example.org']);
  const partner = shapePartner({ name: 'Example Partner', applyPortal: 'https://p.example.org', applyPassword: 'p2', commissions: [{ intake: 'x' }] }, 'team', false);
  assert.deepStrictEqual([partner.applyPassword, partner.commissions, partner.loginHidden], [undefined, undefined, true]);
  assert.strictEqual(shapeDirect({ name: 'No login', applyPortal: 'https://x.example.org' }, 'team', false).loginHidden, undefined, 'nothing to hide, nothing said');
});
