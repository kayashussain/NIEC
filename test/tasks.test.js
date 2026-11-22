// Tasks: Admin or the Manager gives a team a task about a student; only that team (or Admin and the Manager) marks it complete or
// not; the team sees the student while the task is open, other teams do not; every team gives other teams and Admin tasks too.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('tasks: given by Admin, seen and ticked by that team only, listed for Admin with who did it', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niec-tasks-'));
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
  const login = async (username, departments) => {
    const made = (await admin('POST', '/api/users', { username, name: username, email: '', departments })).json;
    const p = person(); await p('POST', '/api/login', { username, password: made.temporaryPassword }); await p('POST', '/api/login/new-password', { password: 'Team-Strong-2026' }); return p;
  };
  const mock = await login('bikram', ['chitwan']);
  // A view-only Manager (no team) sees every task but changes none (the council review of 21 Nov 2026: their Today went empty).
  const viewMade = (await admin('POST', '/api/users', { username: 'viewer', name: 'Viewer', email: '', role: 'manager', departments: [] })).json;
  const viewer = person(); await viewer('POST', '/api/login', { username: 'viewer', password: viewMade.temporaryPassword }); await viewer('POST', '/api/login/new-password', { password: 'Team-Strong-2026' });
  const app = await login('asha', ['application']);
  const id = (await admin('POST', '/api/students/new', { stage: 'Inquiry', fields: { 'FIRST NAME': 'Sita', 'LAST NAME': 'Rai', 'CONTACT NUMBER': '9800000001' } })).json.id;
  assert.strictEqual((await mock('GET', `/api/cards/${id}`)).status, 404, 'the mock team does not see an Inquiry student');
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks`, { team: 'chitwan', text: 'x' })).status, 404, 'a team cannot give tasks');
  assert.strictEqual((await admin('POST', `/api/cards/${id}/tasks`, { team: 'nobody', text: 'x' })).status, 400);
  const given = await admin('POST', `/api/cards/${id}/tasks`, { team: 'chitwan', text: 'Book the mock interview', due: '2026-11-20' });
  assert.strictEqual(given.status, 200);
  const taskId = given.json.card.tasks[0].id;
  assert.strictEqual(given.json.card.tasks[0].due, undefined, 'a task has no date to do it by (the owner, 14 Nov 2026)');
  assert.strictEqual((await mock('GET', `/api/cards/${id}`)).status, 200, 'the mock team sees the student while the task is open');
  assert.strictEqual((await app('GET', `/api/cards/${id}`)).status, 404, 'another team does not');
  const mine = (await mock('GET', '/api/tasks')).json.tasks;
  assert.deepStrictEqual(mine.map((x) => x.text), ['Book the mock interview']);
  assert.strictEqual((await app('GET', '/api/tasks')).json.tasks.length, 0);
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks/${taskId}/delete`, {})).status, 403, 'a team cannot remove a task');
  // The team and whoever gave the task talk it through in its comments, with or without ticking it; another team cannot.
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks/${taskId}`, { comment: 'Please send the student email.' })).status, 200);
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks/${taskId}`, { comment: '   ' })).status, 400, 'an empty comment is refused');
  assert.strictEqual((await app('POST', `/api/cards/${id}/tasks/${taskId}`, { comment: 'x' })).status, 404, 'another team cannot see the student');
  const answered = await admin('POST', `/api/cards/${id}/tasks/${taskId}`, { comment: 'Sent it to your inbox.' });
  assert.deepStrictEqual(answered.json.card.tasks[0].comments.map((c) => [c.by, c.text]), [['bikram', 'Please send the student email.'], ['Owner', 'Sent it to your inbox.']]);
  assert.strictEqual(answered.json.card.tasks[0].done, false, 'a comment does not tick the task');
  assert.strictEqual((await mock('GET', '/api/tasks')).json.tasks[0].comments.length, 2, 'the team sees the conversation on Today');
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks/${taskId}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200);
  const all = (await admin('GET', '/api/tasks')).json.tasks;
  const finished = all.find((x) => x.id === taskId); // (a Mock task asks no follow-up day)
  assert.deepStrictEqual([finished.done, finished.doneBy, finished.teamLabel], [true, 'bikram', 'Chitwan Branch']);
  assert.strictEqual((await mock('POST', `/api/cards/${id}/tasks/${taskId}`, { done: false })).status, 200, 'marked not complete again');
  assert.strictEqual((await admin('POST', `/api/cards/${id}/tasks/${taskId}/delete`, {})).status, 200);
  assert.strictEqual((await admin('GET', `/api/cards/${id}`)).json.card.tasks.filter((x) => x.id === taskId).length, 0, 'the deleted task is gone (its follow-up task stays)');

  // A branch has its own dashboard; Admin keeps the full one.
  assert.strictEqual((await mock('GET', '/dashboard')).location, '/my-dashboard', 'a branch goes to its own dashboard');
  assert.strictEqual((await admin('GET', '/my-dashboard')).location, '/dashboard', 'Admin keeps the full Dashboard');
  assert.strictEqual((await admin('GET', '/api/my-dashboard')).status, 403);
  await admin('POST', `/api/cards/${id}/tasks`, { team: 'chitwan', text: 'Another one' });
  const dash = (await mock('GET', '/api/my-dashboard')).json;
  assert.strictEqual(dash.kind, 'branch');
  assert.strictEqual(dash.kpis.length, 4);
  assert.deepStrictEqual([dash.tasks.open, dash.tasks.late], [1, undefined], 'the team sees its open tasks (no follow-up task is made by itself; no "late": tasks have no dates)');
  // A team gives Admin a task too (the owner, 14 Nov 2026): Admin is named with the signature's title, sees it under "For you" with
  // a red dot, and the dot goes once Admin reads it. A comment from the other side makes a new dot, for whoever gave the task too.
  const sita = (await admin('POST', '/api/students/new', { stage: 'Application Stage', fields: { 'FIRST NAME': 'Gita', 'LAST NAME': 'Rai', 'CONTACT NUMBER': '9800000011' } })).json.id;
  const appCard = (await app('GET', `/api/cards/${sita}`)).json;
  // Every team gives every other team and Admin a task (the owner, 15 Nov 2026). Never to its own team: the Application Team gives the
  // branches and Admin (the Mock and Follow-up Teams were removed, the owner, 22 Nov 2026).
  assert.deepStrictEqual(appCard.assignTeams.map((x) => x.id), ['chitwan', 'pokhara', 'palpa', 'butwal', 'head'], 'a team gives tasks to the other teams, the branches and Admin');
  assert.deepStrictEqual(appCard.handTeams.map((x) => x.id), appCard.assignTeams.map((x) => x.id), 'and reassigns to the same');
  assert.strictEqual((await app('POST', `/api/cards/${sita}/tasks`, { team: 'application', text: 'x' })).status, 400, 'not to its own team');
  assert.match(appCard.assignTeams.find((x) => x.id === 'head').label, /^Owner \(Head of Recruitment\)$/);
  assert.strictEqual((await app('POST', `/api/cards/${sita}/tasks`, { team: 'nobody', text: 'x' })).status, 400, 'not to a team that does not exist');
  const toHead = await app('POST', `/api/cards/${sita}/tasks`, { team: 'head', text: 'Approve the scholarship letter' });
  assert.strictEqual(toHead.status, 200);
  const headTask = toHead.json.card.tasks.find((x) => x.team === 'head');
  const forOwner = (await admin('GET', '/api/tasks')).json.tasks.find((x) => x.id === headTask.id);
  assert.deepStrictEqual([forOwner.forMe, forOwner.unread, forOwner.by], [true, 1, 'asha'], 'Admin sees the new task for them, marked new');
  assert.strictEqual((await admin('GET', '/api/tasks/unread')).json.count, 1);
  assert.strictEqual((await admin('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { seen: true })).status, 200);
  assert.strictEqual((await admin('GET', '/api/tasks/unread')).json.count, 0, 'read: the dot goes');
  await admin('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { comment: 'Done, it is in your inbox.' });
  assert.strictEqual((await app('GET', '/api/tasks/unread')).json.count, 1, 'the team that gave it sees the answer as new');
  {
    const seen = (await viewer('GET', '/api/tasks')).json;
    assert.ok(seen.tasks.some((x) => x.id === headTask.id), 'the view-only Manager sees the task');
    assert.deepStrictEqual([seen.seesAll, seen.canAssign], [true, false]);
    assert.strictEqual((await viewer('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { text: 'changed by a viewer' })).status, 403, 'but cannot change it');
  }
  // Mark all as read on Today is one request, and it only marks tasks this person may see.
  assert.strictEqual((await mock('POST', '/api/tasks/seen', { ids: [headTask.id] })).json.marked, 0, 'another team marks nothing');
  assert.strictEqual((await app('GET', '/api/tasks/unread')).json.count, 1);
  assert.strictEqual((await app('POST', '/api/tasks/seen', { ids: [headTask.id] })).json.marked, 1);
  assert.strictEqual((await app('GET', '/api/tasks/unread')).json.count, 0, 'all read at once');
  assert.strictEqual((await admin('GET', '/api/tasks/unread')).json.count, 0, 'their own comment is not new to Admin');
  assert.strictEqual((await mock('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { comment: 'x' })).status, 404, 'another team cannot see the student');
  assert.strictEqual((await app('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 403, 'only Admin ticks a task given to Admin');
  assert.strictEqual((await admin('POST', `/api/cards/${sita}/tasks/${headTask.id}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200);
  assert.strictEqual((await app('POST', `/api/cards/${sita}/tasks/${headTask.id}/delete`, {})).status, 200, 'whoever gave a task removes it');
  const app2 = (await app('GET', '/api/my-dashboard')).json;
  assert.strictEqual(app2.stages.find((x) => x.stage === 'Application Stage').count, 1, 'Gita, added above at Application Stage');
  assert.ok([...app2.wins, ...app2.upcoming].every((x) => x.name !== 'Sita Rai'), 'no student the team cannot see is named');
  // A task handed on to another team in the same task (the owner, 14 Nov 2026): one thread, the hand-on with its reason in the
  // comments, the route kept; the team it was with still sees it and comments; another team cannot hand it on.
  const relay = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Ram', 'LAST NAME': 'Thapa', 'CONTACT NUMBER': '9800000021' } })).json.id;
  const given2 = (await admin('POST', `/api/cards/${relay}/tasks`, { team: 'chitwan', text: 'Run the mock interview' })).json.card.tasks[0];
  // The Application Team may open a Mock Stage student's card (Missing details, the owner, 21 Nov 2026) but not another team's task.
  assert.strictEqual((await app('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'application', reason: 'x' })).status, 403, 'a team that never had it cannot hand it on');
  assert.strictEqual((await mock('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'application', reason: '' })).status, 400, 'a reason is needed');
  assert.strictEqual((await mock('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'nobody', reason: 'x' })).status, 400);
  const handed = await mock('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'application', reason: 'Mock passed, please send the CAS request' });
  assert.strictEqual(handed.status, 200);
  const moved = handed.json.card.tasks.find((x) => x.id === given2.id);
  assert.deepStrictEqual([moved.team, moved.route, moved.done], ['application', ['chitwan'], false]);
  assert.deepStrictEqual(moved.comments[moved.comments.length - 1].handoff, { from: 'chitwan', to: 'application' });
  const forApp = (await app('GET', '/api/tasks')).json.tasks.find((x) => x.id === given2.id);
  assert.deepStrictEqual([forApp.forMe, forApp.unread > 0, forApp.routeLabels], [true, true, ['Chitwan Branch']], 'the new team has it, marked new');
  // Once handed on it leaves the team's Today (the owner, 20 Nov 2026); the team can still comment on it from the student card.
  assert.ok(!(await mock('GET', '/api/tasks')).json.tasks.some((x) => x.id === given2.id), 'a task handed on leaves the Today of the team that handed it on');
  assert.strictEqual((await mock('POST', `/api/cards/${relay}/tasks/${given2.id}`, { comment: 'Feedback is on the card' })).status, 200, 'and comments');
  assert.strictEqual((await mock('POST', `/api/cards/${relay}/tasks/${given2.id}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 403, 'only the team it is with ticks it');
  assert.strictEqual((await app('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'application', reason: 'x' })).status, 403, 'not to the team it is already with (its own team)');
  assert.strictEqual((await app('POST', `/api/cards/${relay}/tasks/${given2.id}`, { handTo: 'head', reason: 'Needs your approval' })).status, 200, 'on to Admin');
  assert.deepStrictEqual((await admin('GET', '/api/tasks')).json.tasks.find((x) => x.id === given2.id).route, ['chitwan', 'application']);

  // A person in both the Application and the Chitwan Branch (to follow every student) gets only the tasks of the team chosen under "Gets
  // the tasks of" (the owner, 15 Nov 2026); they still see and work on the students of both teams.
  const both = await login('maya', ['application', 'chitwan']);
  const mockStudent = (await admin('POST', '/api/students/new', { stage: 'Mock Stage', fields: { 'FIRST NAME': 'Hari', 'LAST NAME': 'KC', 'CONTACT NUMBER': '9800000031' } })).json.id;
  const appTask = (await admin('POST', `/api/cards/${mockStudent}/tasks`, { team: 'application', text: 'Check the offer letter' })).json.card.tasks[0];
  const mockTask = (await admin('POST', `/api/cards/${mockStudent}/tasks`, { team: 'chitwan', text: 'Run the second mock' })).json.card.tasks.find((x) => x.text === 'Run the second mock');
  const seenBy = async () => (await both('GET', '/api/tasks')).json.tasks.filter((x) => x.forMe && x.studentId === mockStudent).map((x) => x.text).sort();
  assert.deepStrictEqual(await seenBy(), ['Check the offer letter', 'Run the second mock'], 'with nothing chosen, the tasks of both teams');
  const mayaId = (await admin('GET', '/api/users')).json.find((u) => u.username === 'maya').id;
  assert.strictEqual((await admin('POST', `/api/users/${mayaId}`, { action: 'update-person', departments: ['application', 'chitwan'], taskTeam: 'application' })).status, 200);
  assert.deepStrictEqual(await seenBy(), ['Check the offer letter'], 'only the Application Team\'s tasks once chosen');
  assert.strictEqual((await both('GET', '/api/my-dashboard')).json.kind, 'application', 'their dashboard and Today are their own team\'s');
  assert.strictEqual((await admin('GET', '/api/users')).json.find((u) => u.username === 'maya').roleLabel, 'Application Team', 'the account menu names their own team');
  assert.strictEqual((await both('GET', `/api/cards/${mockStudent}`)).status, 200, 'the Mock Stage student is still open to them');
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${mockTask.id}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 403, 'and the Chitwan Branch\'s task is not theirs to tick');

  // Notifications: what exactly is new on each task, for whoever it is for.
  await admin('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { comment: 'The offer is in the portal' });
  const note = (await both('GET', '/api/tasks')).json.tasks.find((x) => x.id === appTask.id).news;
  assert.deepStrictEqual(note.map((n) => [n.kind, n.by, n.text]), [['update', 'Owner', 'The offer is in the portal'], ['task', 'Owner', '']]);
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { seen: true })).status, 200);
  assert.deepStrictEqual((await both('GET', '/api/tasks')).json.tasks.find((x) => x.id === appTask.id).news, [], 'read: nothing new');
  // The task is edited by whoever gave it (here Admin), never by the team; the team is told it changed.
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { text: 'Changed by the team' })).status, 403, 'the team does not edit the task');
  const edited = await admin('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { text: 'Check the offer letter and the conditions', priority: 'super' });
  assert.strictEqual(edited.status, 200);
  const after = edited.json.card.tasks.find((x) => x.id === appTask.id);
  assert.deepStrictEqual([after.text, after.priority, after.editedBy, Boolean(after.editedAt)], ['Check the offer letter and the conditions', 'super', 'Owner', true]);
  assert.strictEqual((await admin('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { text: '   ' })).status, 400, 'a task cannot be emptied');
  assert.deepStrictEqual((await both('GET', '/api/tasks')).json.tasks.find((x) => x.id === appTask.id).news.map((n) => [n.kind, n.by]), [['edited', 'Owner']], 'the team is told');
  // Notifications keep their history once read (the owner, 15 Nov 2026: they vanished once read), and whoever gave a task hears when it
  // is done.
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { seen: true })).status, 200);
  const kept = (await both('GET', '/api/tasks')).json.tasks.find((x) => x.id === appTask.id);
  assert.deepStrictEqual([kept.news.length, kept.history.map((n) => [n.kind, n.isNew])], [0, [['edited', false], ['update', false], ['task', false]]], 'read, and still listed');
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${appTask.id}`, { done: true, finish: { note: 'Done and checked.', next: 'none' } })).status, 200);
  const toGiver = (await admin('GET', '/api/tasks')).json.tasks.find((x) => x.id === appTask.id);
  assert.deepStrictEqual([toGiver.news[0].kind, toGiver.news[0].by], ['done', 'maya'], 'Admin is told the task is done');
  // Today and Later (the owner, 15 and 21 Nov 2026): the team moves a task to a later day with a reason; whoever gave it is told.
  const later = (await admin('POST', `/api/cards/${mockStudent}/tasks`, { team: 'application', text: 'Collect the bank statement' })).json.card.tasks.find((x) => x.text === 'Collect the bank statement');
  const today = (await both('GET', '/api/tasks')).json.today;
  const in3 = new Date(Date.parse(today + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual((await both('POST', `/api/cards/${mockStudent}/tasks/${later.id}`, { schedule: '2001-01-01' })).status, 400, 'not a day in the past');
  assert.strictEqual((await mock('POST', `/api/cards/${mockStudent}/tasks/${later.id}`, { schedule: in3 })).status, 403, 'not by another team');
  const moved2 = await both('POST', `/api/cards/${mockStudent}/tasks/${later.id}`, { schedule: in3, reason: 'The student comes on that day' });
  assert.strictEqual(moved2.status, 200);
  const m2 = moved2.json.card.tasks.find((x) => x.id === later.id);
  assert.deepStrictEqual([m2.doOn, m2.comments.slice(-1)[0].schedule.to, m2.comments.slice(-1)[0].text], [in3, in3, 'The student comes on that day']);
  const giverSees = (await admin('GET', '/api/tasks')).json.tasks.find((x) => x.id === later.id).news[0];
  assert.deepStrictEqual([giverSees.kind, giverSees.to], ['scheduled', in3], 'whoever gave it is told it was moved');
  const back = (await both('POST', `/api/cards/${mockStudent}/tasks/${later.id}`, { schedule: '' })).json.card.tasks.find((x) => x.id === later.id);
  assert.strictEqual(back.doOn, undefined, 'back to today');
  // Who gets a team's tasks is named, and Today says whose tasks come to the person.
  const appTeam = (await admin('GET', `/api/cards/${mockStudent}`)).json.taskTeams.find((x) => x.id === 'application');
  assert.ok(appTeam.members.includes('maya') && appTeam.members.includes('asha'), 'Goes to: the Application Team');
  assert.ok(!(await admin('GET', `/api/cards/${mockStudent}`)).json.taskTeams.find((x) => x.id === 'chitwan').members.includes('maya'), 'not the Chitwan Branch, which is only extra access for maya');
  const from = (await both('GET', '/api/tasks')).json.mineFrom;
  assert.deepStrictEqual([from.teams, from.allTeams, from.ownChosen], [['Application Team'], 2, true]);
  // A person in two teams with no own team chooses it themselves on Today; Admin is told who has not chosen yet.
  const self = await login('sovat', ['application', 'chitwan']);
  assert.deepStrictEqual((await admin('GET', '/api/tasks')).json.noOwnTeam, ['sovat'], 'Admin sees who has no own team');
  assert.deepStrictEqual((await self('GET', '/api/tasks')).json.mineFrom.choices.map((c) => c.id), ['application', 'chitwan']);
  assert.strictEqual((await self('POST', '/api/my-team', { team: 'followup' })).status, 400, 'only one of their own teams');
  assert.strictEqual((await self('POST', '/api/my-team', { team: 'chitwan' })).status, 200);
  assert.deepStrictEqual([(await self('GET', '/api/tasks')).json.mineFrom.ownChosen, (await self('GET', '/api/my-dashboard')).json.kind], [true, 'branch']);
  assert.deepStrictEqual((await admin('GET', '/api/tasks')).json.noOwnTeam, [], 'and the warning goes');
  assert.strictEqual((await admin('POST', '/api/my-team', { team: 'chitwan' })).status, 400, 'not for Admin');
  // A choice that is not one of their teams (or for a person in one team only) is not kept.
  assert.strictEqual((await admin('POST', `/api/users/${mayaId}`, { action: 'update-person', departments: ['application'], taskTeam: 'chitwan' })).status, 200);
  assert.strictEqual((await admin('GET', '/api/users')).json.find((u) => u.username === 'maya').taskTeam, '');
  // The Application Team gives a branch a task, with the tag chosen by hand (the owner, 15 Nov 2026).
  const toMock = await app('POST', `/api/cards/${sita}/tasks`, { team: 'chitwan', text: 'Run the first meeting', tag: 'other' });
  assert.strictEqual(toMock.status, 200, 'the Application Team gives a branch a task');
  const mockGot = (await mock('GET', '/api/tasks')).json.tasks.find((x) => x.text === 'Run the first meeting');
  assert.ok(mockGot && mockGot.forMe && mockGot.tag === 'other', 'and the branch has it, tagged as chosen');
  assert.ok(!(await mock('GET', `/api/cards/${sita}`)).json.assignTeams.some((x) => x.id === 'chitwan'), 'the branch does not give itself a task');
  assert.strictEqual((await mock('POST', `/api/cards/${sita}/tasks/${mockGot.id}`, { handTo: 'chitwan', reason: 'x' })).status, 403, 'a task is not reassigned to the team it is with');
  assert.strictEqual((await app('POST', `/api/cards/${sita}/tasks/${mockGot.id}`, { handTo: 'application', reason: 'Back to us' })).status, 403, 'nor by a team to itself');
  // A team or branch with nobody in it would get a task no one sees: it is refused until someone is in it.
  assert.strictEqual((await admin('POST', `/api/cards/${sita}/tasks/${mockGot.id}`, { handTo: 'pokhara', reason: 'The branch meets the student' })).status, 400, 'nobody is in the branch yet');
  await login('chitra', ['pokhara']);
  assert.strictEqual((await admin('POST', `/api/cards/${sita}/tasks/${mockGot.id}`, { handTo: 'pokhara', reason: 'The branch meets the student' })).status, 200, 'a branch can be given it');
  // A team that nobody has as their own team still has someone to do its tasks: everyone in it.
  const ravi = await login('ravi', ['application', 'palpa']);
  const raviId = (await admin('GET', '/api/users')).json.find((u) => u.username === 'ravi').id;
  assert.strictEqual((await admin('POST', `/api/users/${raviId}`, { action: 'update-person', departments: ['application', 'palpa'], taskTeam: 'application' })).status, 200);
  const fu = await admin('POST', `/api/cards/${sita}/tasks`, { team: 'palpa', text: 'Call the parents', tag: 'other' });
  assert.strictEqual(fu.status, 200);
  assert.ok(fu.json && (await admin('GET', `/api/cards/${sita}`)).json.taskTeams.find((x) => x.id === 'palpa').members.includes('ravi'), 'Goes to ravi, the only one in the Palpa Branch');
  assert.ok((await ravi('GET', '/api/tasks')).json.tasks.find((x) => x.text === 'Call the parents').forMe, 'and ravi gets it');
});
