// The requests behind the portal pages around the sheet: the student card (notes, university options, messages), adding a
// student from the card form, the course search over the
// Universities, messages to a student, the B2B partners and the management records of the Dashboard.
//
// Who may see or change a student here is decided by the very same rules as on the sheet (shared/teams.js): Admin
// everything, the Manager every student but view only, a team its own students in the current intake. A student the
// sheet would not show an account is "not found" here too.
//
// server.js creates this once and passes every request it does not answer itself to handle(); true means answered.

const fs = require('fs');
const path = require('path');
const { sendJSON, send, readJSONBody, readRawBody: readRaw, localDate } = require('../shared/server-utils');
const { isoDate } = require('./dashboard-stats');
const Teams = require('../shared/teams');
const mailer = require('../shared/mailer');
const Fields = require('./card-fields');
const { eventLabel, eventFor } = require('./source-options');
const { ROW_ID } = require('./cards');
const { pointsInside } = require('./media-cache');
const Messages = require('./messages');
const { buildIndex, searchCourses, linkKey, parseCourses } = require('./course-index');
const { hostsOf, onHosts } = require('./university-websites');
const { EVENT_TYPES, MARKETING_TYPES, CHANNELS, channelOf, DECISION_STATUS, MARKET_KINDS, LISTS: PLANNING_LISTS } = require('./planning');
const { MAX_FILE_BYTES, STATUSES: PARTNER_STATUSES } = require('./direct');
const { partnerAccess, shapePartner, seesLogins } = require('./partner-access');

const text = (v) => String(v ?? '').trim();
const STATUS = Teams.STATUS;
const MAX_CELL_CHARS = 5000;
// The columns the Add student form may fill in (for Admin; a team is further held to what its own rules allow).
const NEW_STUDENT_COLUMNS = ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER', 'STUDENT SOURCE'];

function createPortalApi({
  getWorkbook, writeWorkbook, recordChanges, teamSave, cellValueError = () => null, applyThrough = null, cards, messages, courseLinks, sourceOptions, courseLinker = null, courseWatch = () => null, facts, direct, b2b, agents, planning, accounts, activity, rates = null,
  insights = null, calculated = [], userMail = null, push = null, courseSitemaps = null, officeMailSettings = () => ({}), safetyCopy = () => null,
}) {
  // ---- where to send a student's application: the portal link and email saved on Partner Universities ----
  // Names compared ignoring case, spaces, punctuation and a part in brackets ("Ulster University (QA)" is "Ulster University").
  const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
  // The course of a university, matched exactly, brackets included ("BSc Nursing (Adult)" is not "BSc Nursing (Child)"); a loose match
  // (squash) only when it names exactly one course there, so an older course written a little differently is still found.
  const courseKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9()]+/g, '');
  function pickCourse(list, university, course) {
    const here = (list || []).filter((x) => squash(x.university) === squash(university));
    if (!course) return here[0] || null;
    const exact = here.find((x) => x.course && courseKey(x.course) === courseKey(course));
    if (exact) return exact;
    const loose = here.filter((x) => !x.course || squash(x.course) === squash(course));
    return loose.length === 1 ? loose[0] : null;
  }

  // ---- finding a student, and who may see or change them ----
  let indexed = { wb: null, map: new Map() };
  function rowIndex() {
    const wb = getWorkbook();
    if (!wb) return new Map();
    if (indexed.wb !== wb) {
      const map = new Map();
      wb.sheets.forEach((sheet) => sheet.rows.forEach((row) => { if (row && row._id && !map.has(row._id)) map.set(row._id, { sheet, row }); }));
      indexed = { wb, map };
    }
    return indexed.map;
  }
  // The student already on the sheet with this email or phone number (any intake), or null.
  // A phone number compared by its last 10 digits, so "+977 980-1234567" and "9801234567" are the same student. '' when too short to compare.
  const phoneKey = (v) => { const d = text(v).replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
  // Two names that clearly belong to different people: their first names differ (neither is the start of the other). Brothers and
  // sisters often share the family phone, so a phone that matches with such a name is checked by a person, never merged on its own.
  const firstOf = (name) => String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/)[0] || '';
  const otherPerson = (a, b) => { const x = firstOf(a); const y = firstOf(b); return Boolean(x && y && !x.startsWith(y) && !y.startsWith(x)); };
  function existingStudent(email, phone) {
    const em = text(email).toLowerCase(); const ph = phoneKey(phone);
    if (!em && !ph) return null;
    // The same email is always the same student, so it is looked for first; a phone match (maybe a brother or sister) comes second.
    let byPhone = null;
    for (const { row } of rowIndex().values()) {
      if (em && text(row.EMAIL).toLowerCase() === em) return row;
      if (!byPhone && ph && phoneKey(row['CONTACT NUMBER']) === ph) byPhone = row;
    }
    return byPhone;
  }
  const currentIntake = () => { const wb = getWorkbook(); return wb ? Teams.newestSheet(wb.sheets.filter((s) => !s.hidden)) : null; };
  // The teams a person belongs to (department keys); a task given to one of them can be seen and marked by that person.
  const teamsOf = (user) => (Array.isArray(user && user.departments) ? user.departments : []);
  // Tasks go to a team, or to the head of the consultancy (Admin): the Manager, every team and every branch can give Admin a task too
  // (the owner, 14 Nov 2026). Admin is named by their own name and the title of the office signature, for example
  // "SK Kayas Hussain (Head of Recruitment)".
  const HEAD = 'head';
  const headLabel = () => {
    const admins = accounts && accounts.people ? accounts.people().filter((x) => x.access === 'Admin') : [];
    const sig = (messages && messages.signature && messages.signature()) || {};
    return `${(admins[0] && admins[0].name) || text(sig.name) || 'Admin'} (${text(sig.title) || 'Head of Recruitment'})`;
  };
  // Who gets a team's tasks, by name (the owner, 15 Nov 2026), so whoever gives a task sees exactly who will have it: everyone in the
  // team whose own team it is, or who is in that team and has no own team chosen.
  const membersOf = (id) => {
    const list = accounts && accounts.people ? accounts.people() : [];
    if (id === HEAD) return list.filter((p) => p.access === 'Admin').map((p) => p.name);
    const inTeam = list.filter((p) => p.role !== 'admin' && (p.departments || []).includes(id));
    const own = inTeam.filter((p) => !p.taskTeam || !(p.departments || []).includes(p.taskTeam) || p.taskTeam === id);
    return (own.length ? own : inTeam).map((p) => p.name);
  };
  // A team nobody (working) belongs to: a task given or handed to it would reach no one's Today. Only known when the accounts are there.
  const nobodyIn = (id) => Boolean(accounts && accounts.people) && membersOf(id).length === 0;
  const TASK_TEAMS = () => [...Object.entries(Teams.DEPARTMENTS).map(([id, d]) => ({ id, label: d.label, members: membersOf(id) })), { id: HEAD, label: headLabel(), members: membersOf(HEAD) }];
  const teamLabel = (id) => (id === HEAD ? headLabel() : Teams.DEPARTMENTS[id] ? Teams.DEPARTMENTS[id].label : id);
  // A view-only account (a Manager with no team) only looks: it never gives, changes, retags or removes a task.
  const canAssign = (user) => Teams.isAdmin(user) || (Teams.isManager(user) && !Teams.isReadOnly(user));
  // Who sees every team's tasks (Today's board, the counts, Mark as read): Admin and every Manager, the view-only one too (looking is
  // allowed; only giving, changing and removing a task needs canAssign).
  const seesAllTasks = (user) => Teams.isAdmin(user) || Teams.isManager(user);
  // A branch gives tasks too, about its own students, to the Application Team (the owner, 14 Nov 2026). Whoever gave
  // a task removes it; Admin and the Manager remove any.
  const isBranchUser = (user) => teamsOf(user).some((d) => Teams.DEPARTMENTS[d] && Teams.DEPARTMENTS[d].source);
  const BRANCH_TASK_TEAMS = ['application'];
  const assignTeamsFor = (user) => {
    if (Teams.isAdmin(user)) return TASK_TEAMS().filter((t) => t.id !== HEAD);
    if (Teams.isReadOnly(user)) return [];
    if (Teams.isManager(user)) return TASK_TEAMS();
    // A branch gives the Application Team tasks about its students, and Admin.
    if (isBranchUser(user)) return TASK_TEAMS().filter((t) => t.id === HEAD || BRANCH_TASK_TEAMS.includes(t.id));
    // A team gives tasks to every other team, every branch and Admin, never to its own team (the owner, 15 Nov 2026). "Its own team"
    // is the team whose tasks come to the person (taskTeamsOf).
    const own = taskTeamsOf(user);
    return TASK_TEAMS().filter((t) => !own.includes(t.id));
  };
  // Where a person may reassign a task to: Admin and the Manager anywhere; everyone else where they may give a task (the same rule).
  const handTeamsFor = (user) => (Teams.isAdmin(user) || Teams.isManager(user) ? TASK_TEAMS() : assignTeamsFor(user));
  // A task is for this person (their team's, or Admin's own); they gave it; and what is new on it for them (the red dots): the comments
  // the others wrote since they last read it (or since their own last comment), and a task given to them in the last 3 days not read yet.
  // The teams whose tasks this person gets: their own team (Users, "Their own team"), else every team they are in (the owner,
  // 15 Nov 2026). A team that nobody has as their own team is not left without anyone: everyone in it gets its tasks.
  const ownedTeams = () => {
    const owned = new Set();
    (accounts && accounts.people ? accounts.people() : []).forEach((p) => {
      if (p.role === 'admin') return;
      const ds = p.departments || [];
      if (p.taskTeam && ds.includes(p.taskTeam)) owned.add(p.taskTeam); else ds.forEach((d) => owned.add(d));
    });
    return owned;
  };
  const taskTeamsOf = (user) => {
    const all = teamsOf(user);
    if (!(user && user.taskTeam && all.includes(user.taskTeam))) return all;
    const owned = ownedTeams();
    return [user.taskTeam, ...all.filter((d) => d !== user.taskTeam && !owned.has(d))];
  };
  const forMe = (user, t) => taskTeamsOf(user).includes(t.team) || (t.team === HEAD && Teams.isAdmin(user));
  const gaveIt = (user, t) => Boolean(user && t.by && t.by === user.name);
  // A team the task was with before it was handed on: it still sees the task and can comment (the owner, 14 Nov 2026).
  const hadIt = (user, t) => (Array.isArray(t.route) ? t.route : []).some((x) => taskTeamsOf(user).includes(x) || (x === HEAD && Teams.isAdmin(user)));
  // Who may hand a task on: the team it is with, whoever gave it, and Admin and the Manager.
  const mayHand = (user, t) => !Teams.isReadOnly(user) && (canAssign(user) || forMe(user, t) || gaveIt(user, t));
  // Everything that happened on a task for this person, for the Notifications on Today (the owner, 15 Nov 2026): the task given to them,
  // each update and reassignment by the others, a change by whoever gave it, and the task done (for whoever gave it). Kept for 30
  // days whether read or not, so a notification never disappears once read; `isNew` marks what came since they last read the task.
  // The red dots count the new ones. Newest first.
  const HISTORY_DAYS = 30;
  function historyOf(user, t, seen) {
    if (!forMe(user, t) && !gaveIt(user, t) && !hadIt(user, t)) return [];
    const comments = Array.isArray(t.comments) ? t.comments : [];
    const ownLast = comments.filter((c) => c.by === user.name).map((c) => c.at).sort().pop() || '';
    const since = [seen[t.id] || '', ownLast].sort().pop();
    const out = comments.filter((c) => c.by !== user.name)
      .map((c) => ({ kind: c.handoff ? 'reassigned' : c.schedule ? 'scheduled' : 'update', by: c.by || 'Someone', at: c.at, text: String(c.text || '').slice(0, 160), ...(c.schedule ? { to: c.schedule.to || '' } : {}), isNew: String(c.at) > since }));
    if (forMe(user, t) && t.by !== user.name) out.push({ kind: 'task', by: t.by || 'Someone', at: t.at, text: '', isNew: !t.done && !seen[t.id] && Date.now() - Date.parse(t.at) < 3 * 86400000 });
    if (t.editedAt && t.editedBy !== user.name && forMe(user, t)) out.push({ kind: 'edited', by: t.editedBy || 'Someone', at: t.editedAt, text: '', isNew: Boolean(seen[t.id]) && String(t.editedAt) > since });
    // (New only in its first week, so tasks done long ago do not all arrive as new at once.)
    if (t.done && t.doneAt && t.doneBy && t.doneBy !== user.name && gaveIt(user, t)) out.push({ kind: 'done', by: t.doneBy, at: t.doneAt, text: '', isNew: String(t.doneAt) > since && Date.now() - Date.parse(t.doneAt) < 7 * 86400000 });
    const from = Date.now() - HISTORY_DAYS * 86400000;
    return out.filter((n) => n.isNew || Date.parse(n.at) >= from).sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }
  const newsOf = (user, t, seen) => historyOf(user, t, seen).filter((n) => n.isNew).map(({ isNew, ...n }) => n);
  const unreadOf = (user, t, seen) => newsOf(user, t, seen).length;
  const hasTaskFor = (user, rowId) => { const mine = teamsOf(user); if (!mine.length) return false; const c = cards.has(rowId) ? cards.get(rowId) : null; const recent = Date.now() - 7 * 86400000; return Boolean(c && (c.tasks || []).some((t) => (mine.includes(t.team) || (Array.isArray(t.route) && t.route.some((x) => mine.includes(x)))) && (!t.done || Date.parse(t.doneAt) > recent))); };
  // The Application Team also completes the details of Mock Stage students of the current intake (the owner, 21 Nov 2026): Missing
  // details lists them and Fix it opens their card, where the team changes what it may change (its own columns, the profile, the
  // universities). All Students still lists only Application Stage students for the team (Teams.viewFor is unchanged).
  const APP_REACH = ['Application Stage', 'Mock Stage'];
  const appReach = (user, found) => Boolean(found) && teamsOf(user).includes('application') && !Teams.isReadOnly(user) && !Teams.isManager(user)
    && APP_REACH.includes(text(found.row[STATUS])) && (() => { const intake = currentIntake(); return Boolean(intake) && found.sheet.id === intake.id; })();
  function canSee(user, found) {
    if (!found) return false;
    if (Teams.isAdmin(user) || Teams.isManager(user)) return true;
    if (appReach(user, found)) return true;
    // A team given a task about a student sees that student while the task is open and for 7 days after it is done (to undo a
    // mistaken tick), wherever the student is.
    if (hasTaskFor(user, found.row._id)) return true;
    const intake = currentIntake();
    return Boolean(intake) && found.sheet.id === intake.id && Teams.seesRow(user, found.row);
  }
  function canChange(user, found) {
    if (!found) return false;
    if (Teams.isAdmin(user)) return true;
    if (Teams.isReadOnly(user)) return false;
    if (appReach(user, found)) return true;
    const intake = currentIntake();
    return Boolean(intake) && found.sheet.id === intake.id && Teams.seesRow(user, found.row) && Teams.canColor(user, found.row);
  }
  const nameOf = (row) => [text(row['FIRST NAME']), text(row['LAST NAME'])].filter(Boolean).join(' ');
  const isStudent = (row) => text(row['FIRST NAME']) !== '' || text(row['LAST NAME']) !== '';
  const brief = (sheet, row) => ({
    id: row._id, sheetId: sheet.id, intake: sheet.name, name: nameOf(row) || 'Student with no name yet', stage: text(row[STATUS]),
    university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']), email: text(row.EMAIL), phone: text(row['CONTACT NUMBER']),
    source: text(row['STUDENT SOURCE']),
  });
  // Every student this account sees, as the sheet would send them.
  function visibleStudents(user) {
    const wb = getWorkbook();
    if (!wb) return [];
    const out = [];
    Teams.viewFor(user, wb).sheets.forEach((sheet) => sheet.rows.forEach((row) => { if (row && row._id && isStudent(row)) out.push({ sheet, row }); }));
    return out;
  }

  const by = (req) => req.user.name;
  const note = (req, changes, action = 'Edited student card', app = 'Student card') => activity.record(req, req.user, action, { app, changes });
  async function bodyOf(req, res, max = 256 * 1024) {
    try { return await readJSONBody(req, max); } catch (e) { sendJSON(res, e.statusCode || 400, { error: e.message }); return null; }
  }
  const adminOnly = (req, res, what) => {
    if (Teams.isAdmin(req.user)) return true;
    sendJSON(res, 403, { error: `${what} is for Admin only.` });
    return false;
  };
  const managers = (req, res, what) => {
    if (Teams.isAdmin(req.user) || Teams.isManager(req.user)) return true;
    sendJSON(res, 403, { error: `${what} is for Admin and the Manager.` });
    return false;
  };

  // ---- the lists the card's dropdowns are filled from ----
  function cardLists(user) {
    const plan = planning.all();
    // The events Admin recorded on the Dashboard are offered too, with their day, as "Name, 21 Nov 2026".
    const newest = [...plan.events].sort((a, b) => b.date.localeCompare(a.date));
    const planned = newest.map((e) => eventLabel(e.name, e.date));
    const options = sourceOptions.all(planned);
    // The social media campaigns (newest first), offered when a Social Media student came from an advert, so they are counted in its
    // cost. The platforms stay a short list of their own (the owner, 14 Nov 2026).
    const campaigns = newest.filter((e) => channelOf(e) === 'Social media').map((e) => eventLabel(e.name, e.date));
    return {
      sourceOptions: options, campaigns,
      // The intake a non-Admin account's new students go into (Admin adds to the sheet on screen).
      currentIntakeName: (() => { const c = currentIntake(); return c ? c.name : ''; })(),
      sourceLabels: Fields.SOURCE_DETAIL_LABEL, sourceCanAdd: Fields.SOURCE_CAN_ADD,
      // Only the names: the terms agreed with a partner stay on the Admin-only page.
      partners: [...new Set([...agents.list().filter((p) => p.status !== 'Ended').map((p) => p.name), ...sheetAgents().map((p) => p.name)])],
      intakes: (() => { const wb = getWorkbook(); return wb ? Teams.viewFor(user, wb).sheets.map((s) => ({ id: s.id, name: s.name })) : []; })(),
      stages: Teams.ALL_STATUSES,
      departments: Teams.addableDepartments(user).map((d) => ({ id: d, label: Teams.DEPARTMENTS[d].label, start: Teams.DEPARTMENTS[d].start, source: Teams.DEPARTMENTS[d].source || '' })),
    };
  }

  // ---- messages ----
  // The office signature (the picture the owner supplied) goes at the end of Admin's emails (a team member's end with their own): inline in the email that is sent, and as a
  // data address in the preview (the preview window has no login, so it cannot fetch a picture from the server).
  let signaturePicture = null;
  // A consultancy's own picture in the data folder wins; the file shipped here is only the first installation's starting picture.
  for (const dir of [process.env.STUDENT_DETAILS_DATA_DIR, __dirname]) {
    if (signaturePicture || !dir) continue;
    try { signaturePicture = require('fs').readFileSync(require('path').join(dir, 'email-signature.png')); } catch (e) { signaturePicture = null; }
  }
  // `pic` is the picture of whoever sends: { data, type } (the office one for Admin, a team member's own one), or null.
  const officePicture = () => (signaturePicture ? { data: signaturePicture, type: 'image/png' } : null);
  const inlinePictures = (pic) => (pic ? [{ cid: 'niec-signature', type: pic.type, data: pic.data }] : []);
  const signatureSrc = (preview, pic) => (pic ? (preview ? `data:${pic.type};base64,${pic.data.toString('base64')}` : 'cid:niec-signature') : '');
  // The mailbox a person sends from: their own (Your setup for sending) or, for Admin only, the office mailbox. A team member who has
  // not set up their own mailbox cannot email (the owner, 14 Nov 2026). `personal` marks a person's own mailbox.
  function mailFor(user) {
    const own = userMail && user ? userMail.config(user.id) : null;
    const office = accounts.emailConfig();
    if (own) return { ...own, siteUrl: (office && office.siteUrl) || officeMailSettings().siteUrl || '', personal: true };
    return Teams.isAdmin(user) ? office : null;
  }
  // What a page is told about the sender's mailbox.
  const mailInfo = (user) => { const cfg = mailFor(user); return { ready: Boolean(cfg), from: cfg ? cfg.from : '', own: !Teams.isAdmin(user) }; };
  // A team member's email ends with the signature picture they uploaded (the owner, 14 Nov 2026); until they upload one,
  // with their own name, team and address as text. The office picture carries Admin's name, so it is only for Admin.
  function signatureFor(user, cfg) {
    const sig = messages.signature();
    // Admin sending from the office mailbox signs with the office picture. Everyone else signs as themselves, also before their own
    // mailbox is set up (the owner, 15 Nov 2026: a team member's preview ended with Admin's signature picture and name).
    // Admin's own uploaded picture comes first (any Admin, any consultancy); the office picture is only the starting one.
    if (Teams.isAdmin(user)) return { sig, picture: (userMail && userMail.picture(user.id)) || officePicture() };
    const own = userMail ? userMail.picture(user.id) : null;
    const team = teamsOf(user).map((d) => (Teams.DEPARTMENTS[d] ? Teams.DEPARTMENTS[d].label : '')).filter(Boolean).join(', ');
    const box = userMail ? userMail.info(user.id) : {};
    return { sig: { ...sig, name: user.name, title: team, email: cfg ? cfg.from : '', ...(box.phone ? { phone: box.phone, whatsapp: box.phone } : {}) }, picture: own };
  }
  // Who gets a copy of every email, always (the owner, 17 Nov 2026: no switch): the sender's own mailbox (Outlook, Gmail or whichever
  // they use, so the sent email is found there with the student's reply) and, for a team member, the office mailbox too.
  const copiesFor = (cfg) => { const office = accounts.emailConfig(); return [...new Set([cfg.from, ...(cfg.personal && office ? [office.from] : [])])]; };
  function messageContext(req, found, card, optionIds) {
    const picked = Array.isArray(optionIds) && optionIds.length ? card.options.filter((o) => optionIds.includes(o.id)) : card.options;
    return {
      values: Messages.valuesFor({ row: found.row, sheetName: found.sheet.name, card, sender: req.user.name, company: messages.signature().company, short: messages.signature().short }),
      options: picked.map(withFacts),
      ...Messages.documentLists(card),
    };
  }
  // ---- what a shortlisted course carries by itself (the owner, 17 Nov 2026: "I don't want to fill any details") ----
  // The tuition fee, scholarship and deposit of the course's level and the course's own page, from Universities; nobody types them.
  const FactPresent = require('./fact-present');
  function factsForOption(o) {
    const uni = o.universityId ? facts.all().find((u) => u.id === o.universityId) : null;
    if (!uni) return {};
    const group = FactPresent.levelGroup(o.level || '');
    const programs = uni.programs || [];
    const row = programs.find((p) => FactPresent.levelGroup(p.name) === group) || (programs.length === 1 ? programs[0] : null);
    const first = (k) => String((row && row[k]) || '').split('\n').map((l) => l.replace(/^[-*\u2022]\s+/, '').trim()).filter(Boolean)[0] || '';
    const links = courseLinks.all(facts.all());
    const link = links[linkKey(uni.id, o.course)] || links[linkKey(uni.id, String(o.course || '').replace(/\s*\([^)]*\)\s*$/, '').trim())] || '';
    return { fee: first('tuition'), scholarship: first('scholarship'), deposit: first('deposit'), link };
  }
  // An option as it is shown and emailed: what was saved on it, else what Universities says now.
  function withFacts(o) {
    const f = factsForOption(o);
    return { ...o, fee: o.fee || f.fee || '', scholarship: o.scholarship || f.scholarship || '', deposit: o.deposit || f.deposit || '', link: o.link || f.link || '' };
  }

  // ---- through which partner an application goes (the owner, 17 Nov 2026: always asked before the Application Team gets it) ----
  // The choices: Direct (the university itself, when it is on Partner Universities as Direct) and every B2B partner still working
  // with NIEC. The one used most for this university on the sheet (University Partner column) is suggested first.
  function applicationPartners(universityNames) {
    const directOnes = (direct ? direct.all() : []).filter((u) => u.status !== 'Ended');
    const b2bNames = [...new Set((b2b ? b2b.list() : []).filter((p) => p.status !== 'Ended').map((p) => p.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const used = new Map(); // squashed university -> Map(partner -> count)
    const wb = getWorkbook();
    if (wb) wb.sheets.forEach((sheet) => sheet.rows.forEach((row) => {
      const uni = squash(row['UNIVERSITY NAME']);
      const partner = Fields.plainPartner(row['UNIVERSITY PARTNER']);
      if (!uni || !partner) return;
      const name = partnerNamed(partner);
      if (!used.has(uni)) used.set(uni, new Map());
      used.get(uni).set(name, (used.get(uni).get(name) || 0) + 1);
    }));
    const out = {};
    (universityNames || []).forEach((uniName) => {
      const k = squash(uniName);
      const d = directOnes.find((u) => squash(u.name) === k || (k.length > 6 && (squash(u.name).includes(k) || k.includes(squash(u.name)))));
      const directHere = Boolean(d && d.type !== 'Through a B2B partner');
      const counts = [...((used.get(k) || new Map()).entries())].sort((a, b) => b[1] - a[1]);
      const isUni = (n) => squash(n) === k || /universit|college/i.test(n);
      let suggested = '';
      // The partner Admin set for this place on Apply through comes first (the owner, 22 Nov 2026: "the partner has already been
      // selected in our system"): Assign shows it already chosen; Change partner changes it for this student only.
      const at = applyThrough && applyThrough.find ? applyThrough.find(uniName) : null;
      // How the owner names each route (22 Nov 2026): a direct agreement with no one in between (West London, Bangor, Middlesex) is
      // "Direct"; a college or university through Navitas or OIEG goes through that name; the QA universities through "QA Higher
      // Education"; a B2B partner through its own name. The value is what the course and University Partner keep.
      const routeOf = (name) => {
        const n = text(name);
        if (!n) return '';
        if (/\(qa\)\s*$/i.test(n) || /^qa\b/i.test(n)) return 'QA Higher Education';
        const uniKey = squash(at ? at.name : uniName);
        if (squash(n) === uniKey || squash(n) === squash(uniName) || (/universit|college/i.test(n) && (uniKey.includes(squash(n)) || squash(n).includes(uniKey)))) return 'Direct';
        return n;
      };
      if (at && at.partner) suggested = routeOf(at.partner);
      else if (d && d.type === 'Through a B2B partner' && d.via) suggested = d.via;
      else if (counts.length) suggested = isUni(counts[0][0]) ? 'Direct' : counts[0][0];
      else if (directHere) suggested = 'Direct';
      // `choices`: the partners Apply through has for this place (Change partner offers only these, the owner, 22 Nov 2026); null when
      // the place is not on Apply through (every route is then offered, as before).
      const choices = at ? [...new Set([at.partner, ...(at.options || [])].map(routeOf).filter(Boolean))] : null;
      out[uniName] = { direct: directHere, suggested, choices, used: counts.map(([n]) => (isUni(n) ? 'Direct' : n)).filter((n, i, a) => a.indexOf(n) === i) };
    });
    return { b2b: b2bNames, universities: out };
  }

  // The newest sends of each account, so a slip of the finger (or a script) cannot send hundreds of emails.
  const sends = new Map(); // account id -> [times]
  const recentPushes = new Map(); // "<user> <wa|call> <number> <text>" -> { at, code, json }: one notification per click, never two
  function tooManySends(userId) {
    const now = Date.now();
    const recent = (sends.get(userId) || []).filter((t) => now - t < 10 * 60 * 1000);
    sends.set(userId, recent);
    if (recent.length >= 60) return true;
    recent.push(now);
    return false;
  }

  async function handleMessages(req, res, found, card, action) {
    const body = await bodyOf(req, res, action === 'send' ? 24 * 1024 * 1024 : 256 * 1024);
    if (!body) return true;
    const subject = typeof body.subject === 'string' ? body.subject : '';
    const emailBody = typeof body.body === 'string' ? body.body : 'Dear {first_name},\n\n';
    const whatsappBody = typeof body.whatsapp === 'string' ? body.whatsapp : 'Hello {first_name}, ';
    const wrongWord = Messages.badPlaceholder ? Messages.badPlaceholder(subject, emailBody, whatsappBody) : '';
    if (wrongWord) { sendJSON(res, 400, { error: wrongWord }); return true; }
    const ctx = messageContext(req, found, card, body.optionIds);
    const cfg = mailFor(req.user);
    const signed = signatureFor(req.user, cfg);
    const signature = signed.sig;
    const email = Messages.renderEmail({ subject, body: emailBody, signature, siteUrl: cfg ? cfg.siteUrl : '', signatureSrc: signatureSrc(action === 'preview', signed.picture), ...ctx });
    const whatsapp = Messages.renderWhatsApp({ body: whatsappBody, ...ctx });
    const ownTo = text(found.row.EMAIL).toLowerCase();
    const to = text(body.to) || ownTo;
    if (to !== ownTo && /^[^\s@]+@[^\s@]+$/.test(to) && !Teams.isAdmin(req.user)) { sendJSON(res, 403, { error: 'Only the student\'s own address can be used from your account.' }); return true; }
    const number = Fields.whatsappNumber(found.row['CONTACT NUMBER']);

    if (action === 'preview') {
      return sendJSON(res, 200, {
        subject: email.subject, text: email.text, html: email.html, missing: email.missing, to,
        whatsapp: { text: whatsapp.text, number, missing: whatsapp.missing },
        mail: mailInfo(req.user),
        options: ctx.options.length, source: { subject, body: emailBody, whatsapp: whatsappBody },
      });
    }
    // Sending.
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const usesOptions = /\{options_table\}/.test(channel === 'email' ? emailBody : whatsappBody);
    if (usesOptions && !ctx.options.length) return sendJSON(res, 400, { error: 'Add at least one university option to the card first.' });
    const who = nameOf(found.row) || 'a student';
    if (channel === 'whatsapp') {
      if (!number) return sendJSON(res, 400, { error: 'This student has no WhatsApp number on the sheet.' });
      if (!whatsapp.text) return sendJSON(res, 400, { error: 'The message is empty.' });
      const logged = cards.logMessage(found.row._id, { channel, template: 'Follow-up', subject: '', to: number, status: 'opened', text: whatsapp.text, options: usesOptions ? ctx.options.length : 0 }, by(req));
      if (logged.error) return sendJSON(res, 400, { error: logged.error });
      note(req, [`Opened WhatsApp for ${who} with the message "${'Follow-up'}"`], 'Sent message');
      return sendJSON(res, 200, { status: 'opened', message: logged.message, card: logged.card });
    }
    if (!email.subject || !emailBody.trim()) return sendJSON(res, 400, { error: 'The email needs a subject and a message.' });
    if (!mailer.isAddress(to)) return sendJSON(res, 400, { error: to ? 'That email address does not look right.' : 'This student has no email address on the sheet.' });
    if (tooManySends(req.user.id)) return sendJSON(res, 429, { error: 'Too many emails in a short time. Please wait a few minutes.' });
    // Files to send with this one email: decoded here, held in memory for the length of the send, never written to disk.
    const files = [];
    let total = 0;
    for (const f of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 8)) {
      const data = Buffer.from(String(f && f.data || ''), 'base64');
      total += data.length;
      if (!data.length) continue;
      files.push({ name: text(f.name).replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120) || 'attachment', type: text(f.type).slice(0, 80), data });
    }
    if (total > 15 * 1024 * 1024) return sendJSON(res, 413, { error: 'The files are too large to send together (the limit is 15 MB).' });
    const entry = { channel, template: 'Follow-up', subject: email.subject, to, text: email.text, options: usesOptions ? ctx.options.length : 0, attachments: files.map((f) => f.name) };
    if (usesOptions) {
      // A link typed on a card is only remembered for Universities when it is on that university's own website.
      const unis = facts.all();
      ctx.options.forEach((o) => { const u = unis.find((x) => x.id === o.universityId); if (u && hostsOf(u).length && onHosts(o.link, hostsOf(u))) courseLinks.remember(o.universityId, o.course, o.link); });
    }
    if (!cfg) {
      // Email is not set up on this server (always the case on a test computer): nothing leaves, and the card keeps the
      // message as a preview so the whole step can still be checked.
      const logged = cards.logMessage(found.row._id, { ...entry, status: 'preview' }, by(req));
      return sendJSON(res, 200, { status: 'not-configured', ownMailNeeded: !Teams.isAdmin(req.user), message: logged.message, card: logged.card });
    }
    try {
      await mailer.sendMail({ ...cfg, fromName: cfg.personal && !Teams.isAdmin(req.user) ? `${req.user.name}, ${signature.short || signature.company || Messages.COMPANY}` : (signature.company || Messages.COMPANY) }, {
        to, subject: email.subject, text: email.text, html: email.html, auto: false, bcc: copiesFor(cfg), attachments: files, inline: inlinePictures(signed.picture),
      });
    } catch (e) {
      const logged = cards.logMessage(found.row._id, { ...entry, status: 'failed', error: e.message }, by(req));
      note(req, [`An email to ${who} could not be sent: ${e.message}`], 'Sent message');
      return sendJSON(res, 502, { error: `The email could not be sent. ${e.message}`, status: 'failed', card: logged.card });
    }
    const logged = cards.logMessage(found.row._id, { ...entry, status: 'sent' }, by(req));
    note(req, [`Emailed "${email.subject}" to ${who} (${to})`], 'Sent message');
    return sendJSON(res, 200, { status: 'sent', message: logged.message, card: logged.card, from: cfg.from });
  }

  // Every change saved on the student card is written in the student's notes (the owner, 22 Nov 2026), for everyone: what changed, from
  // what to what, by whom (the note keeps the author and the time), so a value typed over is never lost. `pairs`: [label, before, after].
  // `undo`: the change was taken back with Undo.
  function noteCardChanges(req, rowId, pairs, undo = false) {
    const shown = (v) => { const t = text(v); return t ? `"${t.length > 160 ? t.slice(0, 157) + '...' : t}"` : '(empty)'; };
    const lines = pairs.filter(([, a, b]) => text(a) !== text(b)).map(([label, a, b]) => `${label}: ${shown(a)} \u2192 ${shown(b)}`);
    if (!lines.length) return;
    cards.addNote(rowId, { kind: 'note', text: `${undo ? 'Undone on the student card' : 'Changed on the student card'}: ${lines.join('; ')}.` }, by(req));
  }

  // The Student Source is a column of the sheet (hidden there: it is chosen on the card). Changed with the same rules as on the
  // sheet: Admin any time; a team only while it is blank on a student its own team added (shared/teams.js).
  function setSource(req, found, value) {
    if (value && !Fields.STORED_SOURCES.includes(value) && !Fields.isBranchValue(value)) return { error: 'That is not one of the sources.', status: 400 };
    // The Application Team never moves a student to a branch (Admin does; the branch would then find the student by it).
    if (value && Fields.isBranchValue(value) && !Teams.isAdmin(req.user) && Teams.ownTeamApplication(req.user)) return { error: 'Only Admin sets a branch as the source.', status: 403 };
    const done = setColumns(req, found, { 'STUDENT SOURCE': value });
    return done.error ? done : { source: value };
  }

  // Columns of the sheet that can be changed from the student card, and how each is kept.
  // A real calendar day as YYYY-MM-DD (or empty); anything else is refused (null).
  const realDay = (v) => {
    const t = text(v);
    if (t === '') return t;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
  };
  const phoneOk = (t) => t === '' || (/^\+?[\d\s()-]{6,25}$/.test(t) && t.replace(/\D/g, '').length >= 6);
  const CARD_EDITABLE = {
    'FIRST NAME': (v) => text(v).slice(0, 80), 'LAST NAME': (v) => text(v).slice(0, 80), EMAIL: (v) => text(v).toLowerCase().slice(0, 120),
    'CONTACT NUMBER': (v) => { const t = text(v).slice(0, 40); return phoneOk(t) ? t : null; }, 'UNIVERSITY NAME': (v) => text(v).slice(0, 160), 'COURSE NAME': (v) => text(v).slice(0, 240),
    'APPLICATION SUBMISSION DATE': (v) => realDay(v),
    'OFFER RECEIVED DATE': (v) => realDay(v),
    // The Application details card (the owner, 22 Nov 2026): every detail of the application is changed on the card, not the sheet.
    // Language test: Waiver, University Internal Test, Test Date (no day yet) or the test's day.
    'LANGUAGE TEST DATE': (v) => { const t = text(v); return ['', 'Waiver', 'University Internal Test', 'Test Date'].includes(t) ? t : realDay(t) || null; },
    'RECEIVING PARTNER': (v) => text(v).slice(0, 120), 'STUDENT ID': (v) => text(v).slice(0, 60), 'NOC NUMBER': (v) => text(v).slice(0, 60),
    NOC: (v) => (['', 'Pending', 'Submitted', 'Received'].includes(text(v)) ? text(v) : null),
    'MEDICAL REPORT': (v) => (['', 'Pending', 'Booked', 'Received'].includes(text(v)) ? text(v) : null),
  };
  // What each card save replaced, kept for 10 minutes in memory only, so Undo can put back an older value the checks would refuse.
  const replacedOn = new Map(); // rowId -> { col: { value, at } }
  const remember = (rowId, before) => {
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(replacedOn.get(rowId) || {}).filter(([, x]) => now - x.at < 600000));
    Object.entries(before).forEach(([col, value]) => { kept[col] = { value: text(value), at: now }; });
    replacedOn.set(rowId, kept);
    if (replacedOn.size > 2000) replacedOn.delete(replacedOn.keys().next().value);
  };
  const wasReplaced = (rowId, col, value) => { const x = (replacedOn.get(rowId) || {})[col]; return Boolean(x) && Date.now() - x.at < 600000 && x.value === text(value); };
  // University partner is never typed on the card: it follows the university on the sheet, from that university's application on
  // the card (the partner chosen when it was sent to the Application Team). A direct application is "Direct (<university>)"
  // (the owner, 22 Nov 2026). Nothing changes when the card has no partner for that university.
  const DIRECT_RE = /^direct\b/i;
  function withPartner(rowId, changes, nowPartner) {
    if (!('UNIVERSITY NAME' in changes)) return changes;
    const uni = text(changes['UNIVERSITY NAME']);
    if (!uni) return changes;
    // "Direct (<another university>)" written by Vishnu before no longer fits: it is cleared when no partner is known for the new one.
    const stale = DIRECT_RE.test(text(nowPartner)) && squash(Fields.plainPartner(nowPartner)) !== squash(uni);
    const course = 'COURSE NAME' in changes ? text(changes['COURSE NAME']) : '';
    const opts = ((cards.get(rowId) || {}).options || []).filter((o) => squash(o.university) === squash(uni) && text(o.partner));
    const o = (course && pickCourse(opts, uni, course)) || opts[0];
    if (!o) return stale ? { ...changes, 'UNIVERSITY PARTNER': '' } : changes;
    return { ...changes, 'UNIVERSITY PARTNER': DIRECT_RE.test(text(o.partner)) ? `Direct (${uni})` : text(o.partner) };
  }
  // ---- finishing a task: asked, checked by the team, then written (the owner, 16 Nov 2026) ----
  // Nothing is filled in by itself any more. When a team marks a task done, the "Mark as done?" window shows what Vishnu already knows
  // about the student (every application with its days, the sheet's dates) and asks what happened, with no answer chosen in advance
  // and no day filled in. The answers are then shown back as the exact list of what will change ("Offer received: (empty) → 16 Nov
  // 2026", "Stage: CAS Stage → CAS Issued", what stays as it is and why, and anything that does not add up), and only when the team
  // presses "Yes, this is correct" is anything written: the sheet, a note on the student, University options, a reminder. The server
  // refuses to write answers that were not confirmed (finish.confirmed). What was written is kept on the task, so reopening the task
  // can put it all back. Per tag:
  //   Application  one line per university with its course and what happened on the day chosen: Applied, Conditional offer,
  //                Unconditional offer, Refused or Withdrawn, as many universities as needed (each kept in University options with its
  //                days). The sheet takes an application or an offer only for its own university (or when it names none yet) and only
  //                where the column is empty; an offer is never before that university's application.
  //   NOC          Pending (the account is made, not submitted) or Submitted, the NOC number: into NOC and NOC Number.
  //   Medical      booked (Medical Report says Booked; the team is given "confirm the report" for that day), the report received, or
  //                not booked yet (a booking that fell through is cleared). Never Received by itself.
  //   Payment      paid on (a day) and how much: Payment Date when empty, the amount in the next empty Tuition Fee Deposit.
  //   Visa and CAS the step (CAS requested, CAS received, visa lodged, VFS attended, visa received, visa refused) and its day: into
  //                its column when empty, the stage moving on with it (CAS Issued, Visa Lodge, Visa Issued; Visa Rejected), never back.
  // Every answer is also one note on the student, in plain words.
  function writeColumnsFor(req, rowId, changes) {
    { const f = rowIndex().get(rowId); changes = withPartner(rowId, changes, f ? f.row['UNIVERSITY PARTNER'] : ''); }
    const wb = getWorkbook();
    const keys = Object.keys(changes);
    if (!wb || !keys.length) return;
    const next = { ...wb, revision: wb.revision + 1, sheets: wb.sheets.map((sh) => (sh.rows.some((r) => r._id === rowId) ? { ...sh, rows: sh.rows.map((r) => (r._id === rowId ? { ...r, ...changes } : r)) } : sh)) };
    writeWorkbook(next, req.user && req.user.id);
    recordChanges(req, wb, next);
  }
  // The application and offer days live per university on the card (the owner, 17 Nov 2026: a student applies to many). All
  // Students no longer shows the two columns; they stay in the file and Vishnu keeps them as the first application and the first offer,
  // so the Dashboard and Incentive count as before. A student with no day on the card keeps what the columns hold;
  // the columns' own university joins the card first, so nothing recorded before is lost.
  function syncApplicationDays(req, rowId) {
    const found = rowIndex().get(rowId);
    if (!found) return;
    const row = found.row;
    let opts = cards.get(rowId).options || [];
    if (!opts.some((o) => o.applied || o.offer)) return;
    const uni = text(row['UNIVERSITY NAME']);
    const a0 = isoDate(row['APPLICATION SUBMISSION DATE']) || ''; const o0 = isoDate(row['OFFER RECEIVED DATE']) || '';
    if (uni && (a0 || o0) && !opts.some((o) => squash(o.university) === squash(uni))) {
      cards.addOption(rowId, { university: uni, course: text(row['COURSE NAME']), applied: a0, offer: o0, note: 'From All Students', ...(text(row['UNIVERSITY PARTNER']) ? { partner: text(row['UNIVERSITY PARTNER']) } : {}) }, 'Vishnu'); // the partner too, so it is never lost
      opts = cards.get(rowId).options || [];
    }
    // A refused or withdrawn university no longer holds an offer: only standing offers count as the first offer.
    const first = (k) => opts.filter((o) => o[k] && !(k === 'offer' && (o.refused || o.withdrawn))).sort((x, y) => x[k].localeCompare(y[k]))[0] || null;
    const fa = first('applied'); const fo = first('offer');
    const changes = {};
    const sheetHolder = uni ? opts.find((o) => squash(o.university) === squash(uni)) : null;
    // An offer that the university then refused no longer stands: All Students' Offer received day goes (the application day stays), unless
    // another university still holds an offer, which then becomes the first offer below.
    if (!fo && o0 && uni) {
      const sheetOpt = opts.find((o) => squash(o.university) === squash(uni));
      if (sheetOpt && (sheetOpt.refused || sheetOpt.withdrawn) && !sheetOpt.offer) changes['OFFER RECEIVED DATE'] = '';
    }
    // The sheet shows the FIRST application and the FIRST offer: filled when empty, or replaced by an earlier one; a day a person typed that
    // is already the earliest is never overwritten by a later one.
    if (fa && (!a0 || fa.applied < a0)) changes['APPLICATION SUBMISSION DATE'] = fa.applied;
    if (fo && (!o0 || fo.offer < o0 || (sheetHolder && sheetHolder.refused))) changes['OFFER RECEIVED DATE'] = fo.offer;
    // All Students names the university that holds the offer: when the one it names was refused, withdrew or has no offer while another
    // university holds one, the university and course follow it (the sheet never shows one university's name with another's offer day).
    if (fo && uni && sheetHolder && (sheetHolder.refused || sheetHolder.withdrawn || !sheetHolder.offer) && squash(fo.university) !== squash(uni)) {
      changes['UNIVERSITY NAME'] = fo.university; if (fo.course) changes['COURSE NAME'] = fo.course;
    }
    // An empty university or course on All Students takes the first offer's (else the first application's); a typed one stays.
    const pick = fo || fa;
    if (pick && !uni) { changes['UNIVERSITY NAME'] = pick.university; if (!text(row['COURSE NAME']) && pick.course) changes['COURSE NAME'] = pick.course; }
    if (Object.keys(changes).length) writeColumnsFor(req, rowId, changes);
  }
  // One plain line for the timeline when an application's days change on the card ('' when nothing to say).
  function applicationNote(before, after) {
    if (!after) return '';
    const name = [after.university, after.course].filter(Boolean).join(', ');
    const lines = [];
    if (after.applied && after.applied !== before.applied) lines.push(`Application submitted to ${name} on ${niceDay(after.applied)}.`);
    if (after.offer && (after.offer !== before.offer || after.offerType !== before.offerType)) lines.push(`${after.offerType ? after.offerType + ' offer' : 'Offer'} received from ${after.university} on ${niceDay(after.offer)}.`);
    if (after.refused && after.refused !== before.refused) lines.push(`Refused by ${after.university} on ${niceDay(after.refused)}${after.reason ? `: ${after.reason}` : ''}.`);
    if (after.withdrawn && after.withdrawn !== before.withdrawn) lines.push(`Withdrawn from ${after.university} on ${niceDay(after.withdrawn)}${after.reason ? `: ${after.reason}` : ''}.`);
    if (after.skipped && after.skipped !== before.skipped) lines.push(`Not submitted to ${name}${after.reason ? `: ${after.reason}` : ''}.`);
    if (!lines.length && after.reason && after.reason !== before.reason) lines.push(`${after.university}: ${after.reason}.`);
    return lines.join(' ').replace(/\.\./g, '.');
  }
  const NICE_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); // made once: it is slow to make
  const niceDay = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? iso : NICE_DAY.format(d); };
  const sentence = (t) => { const x = text(t).trim(); return x ? (/[.!?]$/.test(x) ? x : x + '.') : ''; };
  // A sheet value as people read it: a date as "16 Nov 2026", anything else as it is, "(empty)" for nothing.
  const shown = (v) => { const t = text(v); if (!t) return '(empty)'; const d = isoDate(t); return d && /^\d{4}-\d{2}-\d{2}$/.test(t) ? niceDay(d) : t; };
  const APP_WHAT = { submitted: 'Applied', conditional: 'Conditional offer', unconditional: 'Unconditional offer', offer: 'Offer', refused: 'Refused', withdrawn: 'Withdrawn', notsubmitted: 'Not submitted' };
  const OFFERS = ['conditional', 'unconditional', 'offer'];
  // Every application Vishnu knows for a student: University options with a day, and the sheet's own university when it has a date.
  function applicationsOf(row, card) {
    const out = (card.options || []).filter((o) => o.applied || o.offer || o.refused || o.withdrawn || o.skipped)
      .map((o) => ({ id: o.id, university: o.university, course: o.course, applied: o.applied || '', offer: o.offer || '', offerType: o.offerType || '', refused: o.refused || '', withdrawn: o.withdrawn || '', skipped: o.skipped || '', reason: o.reason || '' }));
    const uni = text(row['UNIVERSITY NAME']);
    const applied = isoDate(row['APPLICATION SUBMISSION DATE']) || '';
    const offer = isoDate(row['OFFER RECEIVED DATE']) || '';
    // All Students' application and offer days belong to its university only for a student recorded before the days were kept per
    // university (no university has its own day yet). Afterwards they are only the first application and offer of any university, and
    // never move to whichever university is named there (the owner, 21 Nov 2026: changing the Priority University moved the day).
    const legacy = !out.some((a) => a.applied || a.offer);
    if (uni) {
      const same = out.find((a) => squash(a.university) === squash(uni));
      if (same) { same.onSheet = true; if (legacy && !same.applied && applied) same.applied = applied; if (legacy && !same.offer && offer) same.offer = offer; }
      else if (legacy && (applied || offer)) out.unshift({ id: '', university: uni, course: text(row['COURSE NAME']), applied, offer, offerType: '', refused: '', withdrawn: '', onSheet: true });
    }
    return out;
  }
  // What the "Mark as done?" window shows before asking: the task's tag, the student's applications and the sheet's values it touches.
  const FINISH_COLUMNS = ['APPLICATION STATUS', 'UNIVERSITY NAME', 'COURSE NAME', 'APPLICATION SUBMISSION DATE', 'OFFER RECEIVED DATE', 'NOC', 'NOC NUMBER',
    'MOCK SCHEDULE 1', 'MOCK SCHEDULE 2', 'MOCK SCHEDULE 3', 'MOCK SCHEDULE 4', 'FEEDBACK 1', 'FEEDBACK 2', 'FEEDBACK 3', 'FEEDBACK 4', 'PRE CAS INTERVIEW',
    'MEDICAL REPORT', 'PAYMENT DATE', 'TUITION FEE DEPOSIT(1st Installment)', 'TUITION FEE DEPOSIT(2nd Installment)', 'TUITION FEE DEPOSIT(3rd Installment)',
    'CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE'];
  // What must be said when a task is marked done (the owner, 17 Nov 2026: only what the system needs to track the student, so no
  // student is left without a next step, and nothing more):
  //   1. What happened. A task that records something (an application, a payment, a visa step ...) says it by its answer;
  //      one that records nothing (Documents, Other, or "Nothing to record") needs a few words of what was done.
  //   2. What next. When the student is still on the way (any stage but Visa Issued, Withdrawn, Hold, Defer or Visa Rejected) and this
  //      was their last open task, the team picks the day someone gets back to the student (a task for the same team, waiting for that
  //      day) or says no follow-up is needed. A task that already makes its own next task (a medical booked) does
  //      not ask.
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const MIN_NOTE = 8; // characters: "Called." is not enough, "Sent the checklist." is
  // The next step as chosen: null (not needed), { day, text }, or { error }.
  function nextStepOf(f, task) {
    const v = text(f && f.next);
    if (v === 'none') return null;
    const d = realDay(v);
    if (!d) return { error: 'Choose the day to follow up next, or "Not needed".' };
    const today = cards.today();
    if (d < today) return { error: 'The follow-up day is in the past. Choose today or a later day.' };
    if (d > addDays(today, 366)) return { error: 'Choose a follow-up day within the next year.' };
    return { day: d, text: text(f.nextText).slice(0, 300) || `Follow up with the student (after: ${task.text.slice(0, 80)})` };
  }
  function addNextStep(req, rowId, task, step) {
    const made = cards.addTask(rowId, { team: task.team, text: step.text, tag: Fields.taskTag(task, ''), priority: 'high' }, by(req));
    if (made.error) return '';
    if (step.day > cards.today()) cards.scheduleTask(rowId, made.task.id, { date: step.day, reason: 'The follow-up day chosen when the last task was done' }, by(req), cards.today());
    return made.task.id;
  }
  // The courses given to the Application Team that have no answer yet.
  const assignedOf = (card) => (card.options || []).filter((o) => o.sent && !o.applied && !o.offer && !o.refused && !o.withdrawn && !o.skipped);
  // The course an Apply task was made for (one task per course), and the university and course an Offer request names.
  const courseOf = (card, task) => (card.options || []).find((o) => o.taskId === task.id) || null;
  // An Offer request made from 21 Nov 2026 carries the application it chases (offerFor); an older one is read from its words.
  const offerOf = (task) => {
    if (task && task.offerFor && task.offerFor.university) return { university: task.offerFor.university, course: task.offerFor.course || '' };
    const m = /^Offer request: .*? from (.+?)(?: \((.+)\))?\?$/.exec(text(task && task.text)); return m ? { university: m[1], course: m[2] || '' } : null;
  };
  // What Today shows about a task's application (the owner, 21 Nov 2026): the course it was made for, or the one an Offer request
  // chases. Never All Students' university (that names the first offer, which may be another university): a task with no course of its
  // own shows none.
  function courseShown(card, task, tag) {
    const pick = (o) => (o && o.university ? { university: o.university, course: o.course || '', level: o.level || '', intake: o.intake || '', ...(o.applied ? { applied: o.applied } : {}) } : null);
    if (tag === 'offer') {
      const o = offerOf(task); if (!o) return null;
      const opt = pickCourse(card.options, o.university, o.course) || {};
      const kept = task.offerFor || {};
      return pick({ ...o, level: opt.level || '', intake: kept.intake || opt.intake || '', applied: opt.applied || kept.applied || '' });
    }
    return pick(task.app) || pick(courseOf(card, task));
  }
  // How to reach the student from a task: the WhatsApp number (as typed, and as WhatsApp wants it, '' when it is not a number), the email
  // when it is one, and the Student Source. The Application Team already sees and edits these on the sheet.
  function contactOf(row) {
    const phone = text(row['CONTACT NUMBER']).slice(0, 60);
    const email = text(row.EMAIL).trim();
    return { phone, wa: Fields.whatsappNumber(phone), email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email.slice(0, 120) : '', emailText: email.slice(0, 120), source: text(row['STUDENT SOURCE']).slice(0, 80) };
  }
  function finishState(found, task, user = null) {
    const row = found.row;
    const card = cards.get(row._id);
    const kind = Fields.taskTag(task, text(row[STATUS]));
    const own = courseOf(card, task);
    // The Offer request shows only the university, the course, the intake and the day applied (the owner, 21 Nov 2026).
    const offerFor = kind === 'offer' ? (() => {
      const o = offerOf(task); if (!o) return null;
      const same = (x) => squash(x.university) === squash(o.university);
      const opt = pickCourse(card.options, o.university, o.course) || (card.options || []).find(same);
      const app = pickCourse(applicationsOf(row, card), o.university, o.course) || applicationsOf(row, card).find(same);
      const kept = task.offerFor || {};
      return { ...o, intake: kept.intake || (opt && opt.intake) || found.sheet.name || '', applied: (app && app.applied) || (opt && opt.applied) || kept.applied || '' };
    })() : null;
    const unis = [...new Set([...applicationsOf(row, card).map((a) => a.university), ...(card.options || []).map((o) => o.university), ...(facts ? facts.all() : []).map((u) => u.name), ...(direct ? direct.all() : []).map((u) => u.name)].filter(Boolean))].slice(0, 400);
    return {
      kind, today: cards.today(), applications: applicationsOf(row, card), universities: unis,
      // The student's other applications and offers are listed only for Admin and the Manager (the owner, 21 Nov 2026): a team finishing a
      // task records what that task is about, and is not shown what the student holds elsewhere.
      showSoFar: Boolean(user && (Teams.isAdmin(user) || Teams.isManager(user))),
      // The courses given to the Application Team and not answered yet: the "Mark as done?" window starts with one line for each.
      // Only for an Apply task of before 18 Nov 2026 (one task for several courses): any other Application task (a Documents task moved to
      // Application, a task typed by hand) starts with no university line, so nothing is recorded as applied by mistake.
      assigned: kind === 'offer' || own || task.app || !/^apply\b/i.test(text(task.text)) ? [] : assignedOf(card).sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99)).map((o) => ({ university: o.university, course: o.course })),
      sheet: Object.fromEntries(FINISH_COLUMNS.map((c) => [c, text(row[c])])),
      labels: Object.fromEntries(FINISH_COLUMNS.map((c) => [c, Fields.columnLabel(c)])),
      medical: card.medical,
      // A task for one course, and an Offer request, have simple windows with no follow-up question: the Offer request is made by itself.
      courseTask: own ? { id: own.id, university: own.university, course: own.course, partner: own.partner || '', answered: !assignedOf(card).some((a) => a.id === own.id) } : null,
      offerTask: offerFor,
      stage: text(row[STATUS]), minNote: MIN_NOTE, // (no follow-up question when a task is done: the owner, 18 Nov 2026)
    };
  }
  // Works out what finishing `task` with the answers `f` changes, without writing anything. Returns { error } or
  // { kind, columns, kept, warnings, options, note, medical, remind }: `kept` says what stays as it is and why, `warnings` what does not
  // add up (shown to the team before it confirms).
  function finishPlan(found, task, f, user = null) {
    const row = found.row;
    // Admin may record anything; a team is held to the order of the student's journey (the owner, 18 Nov 2026).
    const strict = !(user && Teams.isAdmin(user));
    const JOURNEY_ORDER = ['Inquiry', 'Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'];
    const stageNow = text(row[STATUS]);
    const stageAt = JOURNEY_ORDER.indexOf(stageNow);
    const card = cards.get(row._id);
    const kind = Fields.taskTag(task, text(row[STATUS]));
    const today = cards.today();
    const note = text(f && f.note).slice(0, 2000);
    const day = (v) => { const d = realDay(v); return d === null ? null : d; };
    const plan = { kind, columns: {}, kept: [], warnings: [], options: [], note: '', medical: undefined, remind: null, offerRequests: [] };
    if (!f || typeof f !== 'object') return plan;
    const label = (c) => Fields.columnLabel(c);
    // A column is filled only when empty; a different value already there stays, and the team is told.
    const fill = (col, value, why) => {
      const now = text(row[col]);
      if (!now) { if (!(col in plan.columns)) plan.columns[col] = value; return true; }
      if (now !== value && (isoDate(now) || now) !== value) plan.kept.push(`${label(col)} already says ${shown(now)}${why ? ` ${why}` : ''}: it stays as it is.`);
      return false;
    };
    // Application (the owner, 16 Nov 2026): one line per university, each with what happened; as many as needed.
    const legacy = f.app && f.app !== 'record' && f.app !== 'none' ? f.app : (f.submitted ? 'submitted' : '');
    if (strict && (kind === 'application' || kind === 'offer') && ['Withdrawn', 'Visa Rejected', 'Visa Issued'].includes(stageNow) && f.app !== 'none' && (f.app || f.unis || f.submitted)) return { error: `This student is ${stageNow}: applications and offers are not recorded now. Admin or the Follow-up Team moves the student back first.` };
    const hasApp = (kind === 'application' || kind === 'offer') && f.app !== 'none' && (legacy || f.app === 'record' || Array.isArray(f.unis));
    if (hasApp) {
      let list = (Array.isArray(f.unis) ? f.unis : (f.university ? [{ university: f.university, course: f.course }] : []))
        .map((u) => ({ university: text(u && u.university).replace(/\s+/g, ' ').slice(0, 160), course: text(u && u.course).replace(/\s+/g, ' ').slice(0, 240), what: APP_WHAT[u && u.what] ? u.what : legacy, date: text(u && u.date).slice(0, 10) }))
        .filter((u) => u.university).slice(0, 20);
      // "Submitted" with no university named: the sheet's own university (an older way of answering).
      if (!list.length && legacy === 'submitted') list = [{ university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']), what: 'submitted' }];
      if (!list.length && legacy) return { error: 'Name the university.' };
      if (list.some((u) => !APP_WHAT[u.what])) return { error: `Choose what happened with ${list.find((u) => !APP_WHAT[u.what]).university}.` };
      // Needed to track the student (the owner, 18 Nov 2026): every course given to the team gets an answer, the course is named, and a
      // refusal, a withdrawal or "not submitted" says why. Otherwise a course is lost between "given" and "applied".
      // A line answers a given course when the university and the course are the same (a course in brackets counts: "BSc Nursing (Adult)"
      // is not "BSc Nursing (Child)"); with no course typed it answers only when exactly one course was given at that university.
      const ownCourse = courseOf(card, task); // a task made for one course answers for that course only
      const assignedAll = ownCourse ? assignedOf(card).filter((a) => a.id === ownCourse.id) : assignedOf(card);
      const strictKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9()]+/g, '');
      const matchAssigned = (u) => {
        const cands = assignedAll.filter((a) => squash(a.university) === squash(u.university));
        if (!cands.length) return null;
        if (u.course) return cands.find((a) => strictKey(a.course) === strictKey(u.course)) || null;
        return cands.length === 1 ? cands[0] : 'ambiguous';
      };
      const vague = kind === 'application' ? list.find((u) => matchAssigned(u) === 'ambiguous') : null;
      if (vague) return { error: `Write the course for ${vague.university}: more than one course was given to the team there.` };
      const unanswered = kind === 'application' ? assignedAll.filter((a) => !list.some((u) => matchAssigned(u) === a)) : [];
      if (unanswered.length) return { error: `${unanswered.map((a) => a.university + (a.course ? ` (${a.course})` : '')).join(', ')} ${unanswered.length > 1 ? 'were' : 'was'} given to the team and ${unanswered.length > 1 ? 'have' : 'has'} no answer yet. For each, choose Applied, an offer, Refused, Withdrawn or Not submitted (and say why).` };
      const needsWhy = list.find((u) => ['notsubmitted', 'refused', 'withdrawn'].includes(u.what) && text(note).length < MIN_NOTE);
      if (needsWhy) return { error: `Say why in the note: ${needsWhy.university} was ${APP_WHAT[needsWhy.what].toLowerCase()}.` };
      const noCourse = list.find((u) => ['submitted', ...OFFERS].includes(u.what) && !u.course && !(applicationsOf(row, card).find((a) => squash(a.university) === squash(u.university)) || {}).course && !(squash(u.university) === squash(text(row['UNIVERSITY NAME'])) && text(row['COURSE NAME'])));
      if (noCourse) return { error: `Write the course for ${noCourse.university}.` };
      if (list.length) {
        // Each line has its own day (an application to one university today, the offer of another received weeks ago); the day for all is
        // the fallback for a line without one.
        const d0 = day(f.date);
        const lineDay = (u) => day(u.date) || d0 || (['notsubmitted', 'withdrawn'].includes(u.what) ? today : null);
        const noDay = list.find((u) => !lineDay(u));
        if (noDay) return { error: `Choose the day for ${noDay.university || 'each line'}.` };
        if (list.some((u) => lineDay(u) > today)) return { error: 'Choose a day that has come.' };
        const known = applicationsOf(row, card);
        const sheetUni = text(row['UNIVERSITY NAME']);
        const sheetApplied = (card.options || []).some((o) => o.applied || o.offer) ? '' : isoDate(row['APPLICATION SUBMISSION DATE']) || ''; // a legacy student only (see applicationsOf)
        const isSheet = (u) => !u.university || !sheetUni || squash(u.university) === squash(sheetUni);
        const priorOf = (u) => known.find((a) => squash(a.university) === squash(u.university) && (!u.course || !a.course || squash(a.course) === squash(u.course)))
          || (u.university ? null : known.find((a) => a.onSheet));
        const groups = {};
        for (const u of list) {
          const d = lineDay(u);
          u.d = d;
          const prior = priorOf(u) || {};
          const name = u.university || sheetUni || 'the university';
          const opt = { university: u.university || sheetUni, course: u.course || prior.course || '' };
          const given = matchAssigned(u); // the course given to the team that this line answers
          if (given && given !== 'ambiguous') { opt.optionId = given.id; if (!opt.course) opt.course = given.course || ''; }
          if (u.what === 'submitted') {
            if (prior.applied && prior.applied !== d) plan.kept.push(`${name} is already recorded as applied on ${niceDay(prior.applied)}: that day stays.`);
            if (prior.offer && prior.offer < d) return { error: `${name} gave an offer on ${niceDay(prior.offer)}: the application was before that. Check the day.` };
            if (!prior.applied) opt.applied = d;
            if (isSheet(u)) {
              if (!text(row['APPLICATION SUBMISSION DATE'])) {
                const offerDay = isoDate(row['OFFER RECEIVED DATE']);
                if (offerDay && offerDay < d) return { error: `All Students shows an offer on ${niceDay(offerDay)}: the application was before that. Check the day.` };
              }
              fill('APPLICATION SUBMISSION DATE', d, 'for the first application');
              if (u.university && !sheetUni && !('UNIVERSITY NAME' in plan.columns)) { plan.columns['UNIVERSITY NAME'] = u.university; if (u.course && !text(row['COURSE NAME'])) plan.columns['COURSE NAME'] = u.course; }
            }
          } else if (OFFERS.includes(u.what)) {
            const appliedDay = prior.applied || (isSheet(u) ? sheetApplied : '');
            if (appliedDay && d < appliedDay) return { error: `The application to ${name} was on ${niceDay(appliedDay)}: the offer came after that. Check the day.` };
            if (!appliedDay) plan.warnings.push(`No application to ${name} is recorded. Check the name of the university (choose it from the list), or record the application first.`);
            if (prior.refused) plan.warnings.push(`${name} is recorded as refused on ${niceDay(prior.refused)}.`);
            if (prior.offer && prior.offer !== d && (!prior.offerType || prior.offerType === (u.what === 'conditional' ? 'Conditional' : 'Unconditional'))) plan.kept.push(`${name} is already recorded with an offer on ${niceDay(prior.offer)}: that day stays.`);
            if (!prior.offer || (prior.offerType === 'Conditional' && u.what === 'unconditional')) opt.offer = d;
            if (u.what !== 'offer') opt.offerType = u.what === 'conditional' ? 'Conditional' : 'Unconditional';
            if (isSheet(u)) {
              fill('OFFER RECEIVED DATE', d, 'for the first offer');
              if (u.university && !sheetUni && !('UNIVERSITY NAME' in plan.columns)) { plan.columns['UNIVERSITY NAME'] = u.university; if (u.course && !text(row['COURSE NAME'])) plan.columns['COURSE NAME'] = u.course; }
            } else fill('OFFER RECEIVED DATE', d, 'for the first offer'); // the first offer from any university (the owner, 17 Nov 2026)
          } else if (u.what === 'refused') {
            if (prior.refused && prior.refused !== d) plan.kept.push(`${name} is already recorded as refused on ${niceDay(prior.refused)}: that day stays.`);
            if (!prior.refused) opt.refused = d;
            if (prior.offer) plan.warnings.push(`${name} is recorded with an offer on ${niceDay(prior.offer)}. If that offer no longer stands, correct Offer received on the student card.`);
            if (!prior.applied && !(isSheet(u) && sheetApplied)) plan.warnings.push(`No application to ${name} is recorded. Check the name of the university.`);
          } else if (u.what === 'withdrawn') {
            if (!prior.withdrawn) opt.withdrawn = d;
          } else if (u.what === 'notsubmitted') {
            // Assigned but not submitted (the owner, 17 Nov 2026: for example the student is not eligible there); the note says why.
            if (prior.applied) return { error: `${name} is recorded as applied on ${niceDay(prior.applied)}: it cannot be "Not submitted".` };
            opt.skipped = d; if (text(note)) opt.reason = text(note).slice(0, 300);
          }
          if (opt.optionId) { // the given course itself carries the answer and the day, even when All Students already shows the same day
            if (u.what === 'submitted') opt.applied = d;
            else if (OFFERS.includes(u.what)) { opt.offer = d; if (u.what !== 'offer') opt.offerType = u.what === 'conditional' ? 'Conditional' : 'Unconditional'; }
            else if (u.what === 'refused') opt.refused = d;
            else if (u.what === 'withdrawn') opt.withdrawn = d;
          }
          // An application submitted starts its own task: "Offer request", asking whether the university has answered (the owner, 18 Nov 2026).
          if (u.what === 'submitted' && !prior.offer) plan.offerRequests.push({ university: opt.university, course: opt.course, intake: (given && given !== 'ambiguous' && given.intake) || prior.intake || '', applied: prior.applied || d });
          plan.options.push(opt);
          (groups[u.what] = groups[u.what] || []).push({ name, course: u.course });
        }
        // The sheet's own first application joins University options too, once another one is recorded, so every application shows.
        if (groups.submitted && sheetUni && sheetApplied && !(card.options || []).some((o) => squash(o.university) === squash(sheetUni)) && !list.some(isSheet)) {
          const sheetOffer = isoDate(row['OFFER RECEIVED DATE']) || '';
          plan.options.unshift({ university: sheetUni, course: text(row['COURSE NAME']), applied: sheetApplied, ...(sheetOffer ? { offer: sheetOffer } : {}) });
          plan.kept.push(`Application submitted on All Students stays ${niceDay(sheetApplied)} (${sheetUni}, the first application).`);
        }
        const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
        // "A, B and C (BSc Adult Nursing)" when every course is the same; else each with its own.
        const names = (xs) => {
          const one = xs.length > 1 && xs[0].course && xs.every((x) => squash(x.course) === squash(xs[0].course));
          const n = join(xs.map((x) => x.name + (!one && x.course ? ` (${x.course})` : '')));
          return one ? `${n} (${xs[0].course})` : n;
        };
        const parts = [groups.submitted && `applied to ${names(groups.submitted)}`, groups.conditional && `conditional offer from ${names(groups.conditional)}`,
          groups.unconditional && `unconditional offer from ${names(groups.unconditional)}`, groups.offer && `offer from ${names(groups.offer)}`,
          groups.refused && `refused by ${names(groups.refused)}`, groups.withdrawn && `withdrawn from ${names(groups.withdrawn)}`, groups.notsubmitted && `not submitted to ${names(groups.notsubmitted)}`].filter(Boolean);
        const days = [...new Set(list.map((u) => u.d))];
        if (days.length === 1) plan.note = `On ${niceDay(days[0])}: ${join(parts)}. ${sentence(note)}`.trim();
        else { // lines on different days: each says its own day
          const one = (u) => `${{ submitted: 'applied to', conditional: 'conditional offer from', unconditional: 'unconditional offer from', offer: 'offer from', refused: 'refused by', withdrawn: 'withdrawn from', notsubmitted: 'not submitted to' }[u.what]} ${u.university || sheetUni}${u.course ? ` (${u.course})` : ''} on ${niceDay(u.d)}`;
          plan.note = `${list.map(one).join('; ')}. ${sentence(note)}`.replace(/^./, (c) => c.toUpperCase()).trim();
        }
      }
    } else if (kind === 'noc' && f.noc) {
      // The NOC is Pending or Received (the owner, 18 Nov 2026); no day. An older "Submitted" counts as Received.
      const status = ['Received', 'Submitted'].includes(f.noc) ? 'Received' : f.noc === 'Pending' ? 'Pending' : '';
      if (!status) return { error: 'Choose Pending or Received for the NOC.' };
      const number = text(f.nocNumber).slice(0, 60);
      // Received asks for the NOC number, the NOC account's login number (the owner, 21 Nov 2026), unless All Students already has it.
      if (status === 'Received' && !number && !text(row['NOC NUMBER'])) return { error: 'Write the NOC number.' };
      // A NOC already Received never goes back to Pending.
      const was = text(row.NOC);
      const gotIt = status === 'Received' || was === 'Submitted' || was === 'Received';
      if (status === 'Pending' && (was === 'Submitted' || was === 'Received')) plan.kept.push(`NOC already says ${was}: it never goes back to Pending.`);
      else plan.columns.NOC = status;
      const oldNo = text(row['NOC NUMBER']);
      if (number) plan.columns['NOC NUMBER'] = number;
      plan.note = `NOC ${gotIt ? 'received' : 'pending'}${number ? `, NOC number ${number}` : ''}${number && oldNo && oldNo !== number ? ` (was ${oldNo})` : ''}. ${sentence(note)}`.trim();
    } else if (kind === 'medical' && f.medical && f.medical !== 'none') {
      const place = text(f.place).slice(0, 200);
      // The report check Vishnu gives on the day of the test (the owner's team, 18 Nov 2026: "I finish it and it comes back"): "Booked"
      // for the same day it is already booked for is the same as "not received yet", so no second identical task is ever made.
      const sameBooking = (d) => Boolean(d) && Fields.isReportCheck(task) && (text(task.text).startsWith(`Medical test of ${niceDay(d)}`) || (card.medical && card.medical.date === d));
      if (f.medical === 'waiting') {
        plan.note = `Medical report not received yet${place ? ` (${place})` : ''}. ${sentence(note)}`.trim();
      } else if (f.medical === 'booked' && sameBooking(day(f.date))) {
        plan.note = `Medical test still booked for ${niceDay(day(f.date))}${place ? ` at ${place}` : ''}: report not received yet. ${sentence(note)}`.trim();
        plan.warnings.push('The medical test is already booked for this day, so no new "is the report received?" task is made.');
      } else if (f.medical === 'booked') {
        const d = day(f.date);
        if (!d) return { error: 'Choose the day the medical test is booked for.' };
        // Booked, and on that day the team is asked to confirm the report (the owner, 16 Nov 2026: never Received by itself).
        if (text(row['MEDICAL REPORT']) === 'Received') plan.warnings.push('Medical Report already says Received.');
        plan.columns['MEDICAL REPORT'] = 'Booked';
        plan.medical = { date: d, place, done: false };
        plan.remind = { day: d, text: `Medical test of ${niceDay(d)}${place ? ` at ${place}` : ''}: is the report received?`, tag: 'medical' };
        plan.note = `Medical test booked for ${niceDay(d)}${place ? ` at ${place}` : ''}. ${sentence(note)}`.trim();
      } else if (f.medical === 'received') {
        plan.columns['MEDICAL REPORT'] = 'Received';
        plan.medical = null;
        plan.note = `Medical report received${place ? ` (${place})` : ''}. ${sentence(note)}`.trim();
      } else if (f.medical === 'pending') {
        // Pending: not booked yet (the Medical Report column as All Students shows it); a report already Received stays.
        if (text(row['MEDICAL REPORT']) === 'Received') plan.kept.push('Medical Report already says Received: it never goes back to Pending.');
        else plan.columns['MEDICAL REPORT'] = 'Pending';
        if (card.medical && text(row['MEDICAL REPORT']) !== 'Received') plan.medical = null;
        plan.note = `Medical report pending. ${sentence(note)}`.trim();
      } else if (f.medical === 'notBooked') {
        if (text(row['MEDICAL REPORT']) === 'Booked') plan.columns['MEDICAL REPORT'] = '';
        if (card.medical) plan.medical = null;
        plan.note = `Medical test not booked yet: to be booked again. ${sentence(note)}`.trim();
      } else return { error: 'Choose what happened.' };
    } else if (kind === 'payment' && f.paid) {
      const d = day(f.date);
      if (!d) return { error: 'Choose the day it was paid.' };
      if (d > today) return { error: 'A payment cannot be made on a day still to come.' };
      const amount = /^\d+(\.\d{1,2})?$/.test(text(f.amount).replace(/[,\s]/g, '')) ? text(f.amount).replace(/[,\s]/g, '').slice(0, 14) : '';
      if (!(Number(amount) > 0)) return { error: 'Write the amount paid, in numbers, for example 5000.' };
      const offer = isoDate(row['OFFER RECEIVED DATE']);
      if (strict && !offer && !applicationsOf(row, card).some((a) => a.offer && !a.refused && !a.withdrawn)) return { error: 'A payment is recorded once an offer is recorded: the deposit is for a university that gave an offer. Record the offer first.' };
      if (!offer) plan.warnings.push('No offer is recorded on All Students.');
      else if (d < offer) plan.warnings.push(`The offer on All Students is from ${niceDay(offer)}, after this payment.`);
      fill('PAYMENT DATE', d, 'for the first payment');
      const slot = ['1st', '2nd', '3rd'].map((k) => `TUITION FEE DEPOSIT(${k} Installment)`).find((c) => !text(row[c]));
      if (amount && slot) plan.columns[slot] = amount;
      if (amount && !slot) plan.warnings.push('All three deposit columns are already used: the amount is kept in the note only.');
      plan.note = `Payment made on ${niceDay(d)}${amount ? `: ${Number(amount).toLocaleString('en-GB')}` : ''}. ${sentence(note)}`.trim();
    } else if (kind === 'visa' && f.step) {
      // Visa and CAS: the step reached, its day, and the stage moved on with it (never back). The steps come in this order, so a day
      // before an earlier step's day is refused, and a step whose earlier one is not recorded is pointed out.
      const STEPS = { casRequested: ['CAS REQUESTED DATE', 'CAS requested', 'CAS Stage'], casReceived: ['CAS RECEIVED DATE', 'CAS received', 'CAS Issued'], lodged: ['VISA LODGE DATE', 'Visa lodged', 'Visa Lodge'], vfs: ['VFS ATTENDED DATE', 'VFS attended', ''], visa: ['VISA RECEIVED DATE', 'Visa received', 'Visa Issued'], refused: ['', 'Visa refused', 'Visa Rejected'] };
      const st = STEPS[f.step];
      if (!st) return { error: 'Choose the step.' };
      if (strict && stageAt < 0 && f.step !== 'refused') return { error: `This student is ${stageNow}: visa steps are not recorded now.` };
      if (strict && stageAt >= 0 && stageAt < 3) return { error: `Visa and CAS steps start at Payment Stage: this student is at ${stageNow}.` };
      if (f.step === 'refused' && note.length < MIN_NOTE) return { error: 'Say why the visa was refused (the reason in the refusal letter).' };
      const d = day(f.date);
      if (!d) return { error: 'Choose the day.' };
      if (d > today) return { error: 'Choose a day that has come.' };
      const order = ['CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE'];
      const mine = st[0] ? order.indexOf(st[0]) : order.length;
      for (const c of order.slice(0, mine)) {
        const v = isoDate(row[c]);
        if (v && v > d) return { error: `${label(c)} is ${niceDay(v)}: ${st[1].toLowerCase()} comes after that. Check the day.` };
      }
      if (['lodged', 'vfs', 'visa'].includes(f.step) && !isoDate(row['CAS RECEIVED DATE'])) plan.warnings.push('No CAS received date is recorded on All Students.');
      if (f.step === 'visa' && !isoDate(row['VISA LODGE DATE'])) plan.warnings.push('No visa lodge date is recorded on All Students.');
      if (st[0]) fill(st[0], d, '');
      const ORDER = ['Inquiry', 'Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'];
      const now = text(row[STATUS]);
      // A refusal moves any stage before Visa Issued to Visa Rejected; the other steps only move forward.
      const moved = f.step === 'refused' ? (ORDER.includes(now) && now !== 'Visa Issued' ? 'Visa Rejected' : '') : st[2] && ORDER.includes(now) && ORDER.indexOf(st[2]) > ORDER.indexOf(now) ? st[2] : '';
      if (strict && moved && moved !== 'Visa Rejected' && stageAt >= 0 && JOURNEY_ORDER.indexOf(moved) - stageAt > 1) return { error: `The student is at ${stageNow}: ${st[1].toLowerCase()} comes after ${JOURNEY_ORDER[stageAt + 1]}. Record the step before it first.` };
      if (moved) plan.columns[STATUS] = moved;
      if (moved && moved !== 'Visa Rejected' && ORDER.indexOf(moved) - ORDER.indexOf(now) > 2) plan.warnings.push(`The student is at ${now}: this moves them straight to ${moved}, skipping ${ORDER.slice(ORDER.indexOf(now) + 1, ORDER.indexOf(moved)).join(', ')}. Check the steps in between were done.`);
      plan.note = `${st[1]} on ${niceDay(d)}.${moved ? ` Stage moved to ${moved}.` : ''} ${sentence(note)}`.trim();
    }
    if (!plan.note && note) plan.note = note;
    // Nothing changes on the sheet when it already says the same.
    Object.keys(plan.columns).forEach((c) => { if (text(row[c]) === plan.columns[c]) delete plan.columns[c]; });
    // University options: only the days that are new.
    plan.options = plan.options.filter((o) => ['applied', 'offer', 'refused', 'withdrawn', 'skipped', 'offerType'].some((k) => o[k]));
    return plan;
  }
  // The plan in the words the team checks before confirming.
  function planWords(found, plan) {
    const row = found.row;
    const optLine = (o) => {
      const bits = [o.applied && `applied ${niceDay(o.applied)}`, o.offer && `${o.offerType ? o.offerType.toLowerCase() + ' offer' : 'offer'} ${niceDay(o.offer)}`, !o.offer && o.offerType && `${o.offerType.toLowerCase()} offer`, o.refused && `refused ${niceDay(o.refused)}`, o.withdrawn && `withdrawn ${niceDay(o.withdrawn)}`].filter(Boolean);
      return `${o.university}${o.course ? ` (${o.course})` : ''}: ${bits.join(', ')}`;
    };
    return {
      changes: Object.entries(plan.columns).map(([c, v]) => ({ column: c, label: Fields.columnLabel(c), from: shown(row[c]), to: v === '' ? '(empty)' : shown(v) })),
      options: plan.options.map(optLine),
      kept: plan.kept, warnings: plan.warnings, note: plan.note,
      offerTasks: (plan.offerRequests || []).map((r) => offerRequestText(r)),
      remind: plan.remind ? `${plan.remind.text}${plan.remind.day > cards.today() ? `, on ${niceDay(plan.remind.day)}` : ''}` : '',
      remarks: plan.note && (!text(row.REMARKS) || text(row.REMARKS) === text(cards.get(row._id).autoRemark)),
    };
  }
  // The separate task made when an application is submitted: the Application Team asks the university for the offer letter and records the
  // answer (an offer, a refusal) by finishing it, as any application task.
  const offerRequestText = (r) => `Offer request: has the student received the offer letter from ${r.university}${r.course ? ` (${r.course})` : ''}?`;
  // Writes a confirmed plan and keeps on the task what it wrote, so reopening the task can put it back.
  function applyPlan(req, found, task, plan) {
    const rowId = found.row._id;
    const card = cards.get(rowId);
    const wrote = { at: new Date().toISOString(), columns: {}, options: [], remind: '', note: '', ...(plan.medical !== undefined ? { medical: card.medical || null } : {}) };
    // The sheet's Remarks shows the latest progress (the owner, 15 Nov 2026), only when it is empty or still holds Vishnu's own last
    // line: a remark a person typed is never overwritten.
    if (plan.note) {
      // The day once: a note that already starts with it ("On 21 Nov 2026: ...") is not given it a second time.
      const remark = (/^On \d{1,2} \w+ \d{4}/.test(plan.note) ? plan.note : `${niceDay(cards.today())}: ${plan.note}`).slice(0, 300);
      const now = text(found.row.REMARKS);
      if (!now || now === text(card.autoRemark)) { plan.columns.REMARKS = remark; cards.setAutoRemark(rowId, remark); }
    }
    Object.entries(plan.columns).forEach(([c, v]) => { wrote.columns[c] = [text(found.row[c]), v]; });
    writeColumnsFor(req, rowId, plan.columns);
    if (plan.note) { const n = cards.addNote(rowId, { kind: 'note', text: plan.note }, by(req)); if (n.card) wrote.note = (n.card.notes[n.card.notes.length - 1] || {}).id || ''; }
    if (plan.medical !== undefined) cards.setMedical(rowId, plan.medical, by(req));
    // Every university is kept in the student's University options with the day it was applied to, gave an offer, refused or withdrew.
    plan.options.forEach((o) => {
      const opts = cards.get(rowId).options || [];
      const same = (o.optionId && opts.find((x) => x.id === o.optionId)) || pickCourse(opts, o.university, o.course);
      const dates = Object.fromEntries(['applied', 'offer', 'offerType', 'refused', 'withdrawn', 'skipped', 'reason'].filter((k) => o[k]).map((k) => [k, o[k]]));
      if (o.refused || o.withdrawn) { dates.offer = ''; dates.offerType = ''; } // a refused or withdrawn offer no longer stands
      if (same) {
        if (!wrote.options.some((w) => w.id === same.id)) wrote.options.push({ id: same.id, before: Object.fromEntries(['applied', 'offer', 'offerType', 'refused', 'withdrawn', 'skipped', 'reason', 'course'].map((k) => [k, same[k] || ''])) });
        cards.updateOption(rowId, same.id, { ...dates, ...(o.course && !same.course ? { course: o.course } : {}) }, by(req));
      } else {
        const made = cards.addOption(rowId, { university: o.university, course: o.course, ...dates }, by(req));
        if (made.option) wrote.options.push({ id: made.option.id, before: null, keys: Object.keys(dates) });
      }
    });
    // Never a second open task with the same words for the same team (a task finished twice, or two people finishing together).
    const twin = plan.remind && (cards.get(rowId).tasks || []).some((x) => !x.done && x.id !== task.id && x.team === task.team && courseKey(x.text) === courseKey(plan.remind.text));
    if (plan.remind && !twin) {
      const team = task.team;
      const made = cards.addTask(rowId, { team, text: plan.remind.text, tag: plan.remind.tag, priority: 'high' }, by(req));
      if (!made.error) { wrote.remind = made.task.id; if (plan.remind.day > cards.today()) cards.scheduleTask(rowId, made.task.id, { date: plan.remind.day, reason: plan.remind.tag === 'medical' ? 'On the day of the medical test' : 'On the day of the mock interview' }, by(req), cards.today()); }
    }
    // One "Offer request" task for each application submitted now, never a second open one for the same university and course.
    wrote.offerRequests = [];
    (plan.offerRequests || []).forEach((r) => {
      const words = offerRequestText(r);
      // Compared with the brackets kept: "Coventry University (MSc A)" and "(MSc B)" are two applications, two Offer requests (the owner,
      // 22 Nov 2026: every application gets its Offer request).
      const open = (cards.get(rowId).tasks || []).some((x) => !x.done && courseKey(x.text) === courseKey(words));
      if (open) return;
      const made = cards.addTask(rowId, { team: task.team === HEAD ? 'application' : task.team, text: words, tag: 'offer', offerFor: r }, by(req));
      if (!made.error) wrote.offerRequests.push(made.task.id);
    });
    if (wrote.options.length) syncApplicationDays(req, rowId);
    if (Object.keys(wrote.columns).length || wrote.options.length || plan.medical !== undefined || wrote.remind || wrote.offerRequests.length) cards.setTaskWrote(rowId, task.id, wrote, by(req));
    return wrote;
  }
  // Reopening a finished task can put back what it wrote (the owner, 16 Nov 2026: a wrong answer is corrected in one step). A column
  // someone has changed since is left as it is and named.
  function undoPlan(req, found, task) {
    const rowId = found.row._id;
    const w = task.wrote;
    if (!w) return { undone: [], left: [] };
    const back = {}; const undone = []; const left = [];
    const STEP_ORDER = ['CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE'];
    Object.entries(w.columns || {}).forEach(([c, [from, to]]) => {
      const laterStep = STEP_ORDER.includes(c) && STEP_ORDER.slice(STEP_ORDER.indexOf(c) + 1).some((k) => text(found.row[k]));
      if (laterStep) { left.push(`${Fields.columnLabel(c)} stays: a later step is already recorded`); return; }
      if (text(found.row[c]) === text(to)) { back[c] = from; if (c !== 'REMARKS') undone.push(`${Fields.columnLabel(c)}: back to ${shown(from)}`); }
      else if (c !== 'REMARKS') left.push(`${Fields.columnLabel(c)} was changed since (${shown(found.row[c])}): left as it is`);
    });
    if (back.REMARKS !== undefined) cards.setAutoRemark(rowId, back.REMARKS);
    writeColumnsFor(req, rowId, back);
    const opts = cards.get(rowId).options || [];
    (w.options || []).forEach((o) => {
      const now = opts.find((x) => x.id === o.id);
      if (!now) return;
      if (o.before === null) {
        // Taken out only when nothing else was recorded on it since; otherwise only what this task wrote is put back.
        const later = ['applied', 'offer', 'refused', 'withdrawn', 'skipped'].some((k) => now[k] && !(o.keys || []).includes(k));
        if (later) { cards.updateOption(rowId, o.id, Object.fromEntries((o.keys || []).map((k) => [k, ''])), by(req)); undone.push(`${now.university}: what this task wrote is taken off; the later answers on it are kept`); }
        else { cards.removeOption(rowId, o.id, by(req)); undone.push(`${now.university}: taken out of University options`); }
      }
      else { cards.updateOption(rowId, o.id, o.before, by(req)); undone.push(`${now.university}: University options as before`); }
    });
    (w.offerRequests || []).forEach((tid) => { const r = (cards.get(rowId).tasks || []).find((x) => x.id === tid); if (r && !r.done) { cards.removeTask(rowId, tid, by(req)); undone.push(`The task "${r.text.slice(0, 60)}" removed`); } });
    if (w.remind) { const r = (cards.get(rowId).tasks || []).find((x) => x.id === w.remind); if (r && !r.done) { cards.removeTask(rowId, w.remind, by(req)); undone.push(`The task "${r.text.slice(0, 60)}" removed`); } }
    if ('medical' in w) cards.setMedical(rowId, w.medical, by(req));
    cards.setTaskWrote(rowId, task.id, null, by(req));
    return { undone, left };
  }
  // ---- details that do not add up (the owner, 16 Nov 2026) ----
  // Every student is checked for dates out of order and for what Vishnu used to fill in by itself, so the wrong ones can be found and
  // corrected: an offer with no application, an offer before its application, a payment with no offer, the visa steps out of order,
  // a Medical Report marked Received by itself, and offers recorded from a task before answers were checked. A detail someone has
  // checked and said is correct leaves the list until it changes. Each item: { key, text }.
  function checksOf(row, card) {
    const d = (c) => isoDate(row[c]) || '';
    const out = [];
    const add = (key, words) => { if (!(card.checked || {})[key]) out.push({ key, text: words }); };
    const applied = d('APPLICATION SUBMISSION DATE'); const offer = d('OFFER RECEIVED DATE');
    if (offer && !applied) add(`offer-no-app:${offer}`, `Offer received ${niceDay(offer)}, but no application date is recorded.`);
    if (offer && applied && offer < applied) add(`offer-before-app:${offer}:${applied}`, `Offer received ${niceDay(offer)} is before the application (${niceDay(applied)}).`);
    const uni = text(row['UNIVERSITY NAME']);
    const sameOpt = uni ? (card.options || []).find((o) => squash(o.university) === squash(uni)) : null;
    if (offer && sameOpt && (sameOpt.refused || sameOpt.withdrawn)) add(`offer-refused:${offer}:${sameOpt.refused || sameOpt.withdrawn}`, `Offer received ${niceDay(offer)}, but ${uni} is recorded as ${sameOpt.refused ? 'refused' : 'withdrawn'}.`);
    const ended = text(row[STATUS]);
    const openTasks = (card.tasks || []).filter((t) => !t.done).length;
    if (['Withdrawn', 'Visa Issued', 'Visa Rejected'].includes(ended) && openTasks) add(`ended-tasks:${ended}:${openTasks}`, `${openTasks} task${openTasks === 1 ? ' is' : 's are'} still open on a student who is ${ended}: finish or remove ${openTasks === 1 ? 'it' : 'them'}.`);
    const paid = d('PAYMENT DATE');
    if (paid && !offer) add(`pay-no-offer:${paid}`, `Payment made ${niceDay(paid)}, but no offer is recorded.`);
    const steps = [['APPLICATION SUBMISSION DATE', 'Application'], ['OFFER RECEIVED DATE', 'Offer'], ['CAS REQUESTED DATE', 'CAS requested'], ['CAS RECEIVED DATE', 'CAS received'], ['VISA LODGE DATE', 'Visa lodged'], ['VISA RECEIVED DATE', 'Visa received']];
    for (let i = 1; i < steps.length; i += 1) {
      const b = d(steps[i][0]); if (!b) continue;
      const earlier = steps.slice(0, i).map(([c, n]) => [d(c), n]).filter(([v]) => v && v > b).pop();
      if (earlier && i > 1) add(`order:${steps[i][0]}:${b}:${earlier[0]}`, `${steps[i][1]} ${niceDay(b)} is before ${earlier[1].toLowerCase()} (${niceDay(earlier[0])}).`);
    }
    if (d('VISA RECEIVED DATE') && !d('VISA LODGE DATE')) add(`visa-no-lodge:${d('VISA RECEIVED DATE')}`, 'Visa received, but no visa lodge date is recorded.');
    // What Vishnu used to fill in by itself or from unchecked answers, before 16 Nov 2026.
    const notes = card.notes || [];
    if (text(row['MEDICAL REPORT']) === 'Received' && notes.some((n) => ['Vishnu (automatic)', 'ISR (automatic)'].includes(n.by) && /* notes written before the rename say ISR */ /^Medical report received: the test was on/.test(n.text))) add('auto-medical', 'Medical Report was marked Received by itself on the test day. Confirm the report really came.');
    const fromTask = offer && notes.some((n) => n.at < '2026-11-17' && n.text.startsWith(`Offer received on ${niceDay(offer)}`));
    if (fromTask) add(`task-offer:${offer}`, `Offer received ${niceDay(offer)} was recorded from a task before answers were checked. Confirm the offer really came.`);
    return out;
  }
  // Changes columns of one student with the rules of the sheet: Admin any time; a team only the columns it may edit on a student it sees.
  function setColumns(req, found, changes) {
    const wb = getWorkbook();
    for (const col of Object.keys(changes)) {
      if (col !== 'STUDENT SOURCE' && col !== 'UNIVERSITY PARTNER' && !CARD_EDITABLE[col]) return { error: 'That detail cannot be changed here.', status: 400 }; // University partner: only by itself (withPartner)
      if (!Teams.canEdit(req.user, col, found.row)) return { error: col === 'STUDENT SOURCE' ? "This student's source cannot be changed from your account." : `${col} cannot be changed from your account.`, status: 403 };
    }
    const apply = (rows) => rows.map((r) => (r._id === found.row._id ? { ...r, ...changes } : r));
    if (Teams.isAdmin(req.user)) {
      const next = { ...wb, revision: wb.revision + 1, sheets: wb.sheets.map((sh) => (sh.id !== found.sheet.id ? sh : { ...sh, rows: apply(sh.rows) })) };
      writeWorkbook(next, req.user && req.user.id);
      recordChanges(req, wb, next);
      return { ok: true };
    }
    const view = Teams.viewFor(req.user, wb);
    // A student the Application Team completes on the card but does not have on its sheet (a Mock Stage student of the current intake,
    // see appReach): written here, with the same column checks as above. Through teamSave it would find no row and change nothing.
    const onItsSheet = view.sheets.some((sh) => sh.id === found.sheet.id && sh.rows.some((r) => r._id === found.row._id));
    if (!onItsSheet) {
      if (!appReach(req.user, found)) return { error: 'This student cannot be changed from your account.', status: 403 };
      // The same checks as every save of the sheet (the column exists, a Source from the list, a branch only by a branch, the size).
      const bad = cellValueError(Object.entries(changes).map(([col, value]) => ({ col, value })), found.sheet, req.user);
      if (bad) return { error: bad, status: 400 };
      const next = { ...wb, revision: wb.revision + 1, sheets: wb.sheets.map((sh) => (sh.id !== found.sheet.id ? sh : { ...sh, rows: apply(sh.rows) })) };
      writeWorkbook(next, req.user && req.user.id);
      recordChanges(req, wb, next);
      return { ok: true };
    }
    const out = teamSave(req, { baseRevision: wb.revision, sheets: view.sheets.map((sh) => (sh.id !== found.sheet.id ? sh : { ...sh, rows: apply(sh.rows) })) });
    return out.status === 200 ? { ok: true } : { error: out.body.error === 'conflict' ? 'The sheet changed at the same moment. Please try again.' : out.body.error, status: out.status };
  }


  // The write door for Claude (advisor-write.js; off unless the server sets NIEC_ADVISOR_WRITE_TOKEN and NIEC_ADVISOR_WRITE_AS, the owner,
  // 22 Nov 2026). It changes a few plain details of ONE student, through setColumns, so the same account rules and the same value checks as
  // on the student card apply, and it writes the same note on the card. It never does anything else. `apply: false` only shows the change.
  // `expect`: the values as the preview saw them; if the student changed since, nothing is written.
  const ADVISOR_COLUMNS = ['FIRST NAME', 'LAST NAME', 'STUDENT ID', 'NOC NUMBER'];
  function advisorChange(req, { id, changes, expect = null, apply = false }) {
    const found = typeof id === 'string' && id ? rowIndex().get(id) : null;
    if (!found) return { error: 'No student with that id.' };
    const cols = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.keys(changes) : [];
    if (!cols.length) return { error: `Give the details to change. This door can change: ${ADVISOR_COLUMNS.join(', ')}.` };
    const clean = {};
    for (const col of cols) {
      if (!ADVISOR_COLUMNS.includes(col)) return { error: `${col} cannot be changed through this door. It can change: ${ADVISOR_COLUMNS.join(', ')}.` };
      const v = CARD_EDITABLE[col](changes[col]);
      if (v === null) return { error: `${col}: that value is not allowed.` };
      if (!Teams.canEdit(req.user, col, found.row)) return { error: `${col} cannot be changed from the account this door uses.` };
      clean[col] = v;
    }
    const before = Object.fromEntries(cols.map((c) => [c, text(found.row[c])]));
    if (expect && cols.some((c) => text(expect[c]) !== before[c])) return { error: 'The student changed after the preview. Preview again.' };
    const diff = cols.filter((c) => clean[c] !== before[c]).map((c) => ({ column: c, before: before[c], after: clean[c] }));
    if (!diff.length) return { error: 'Nothing would change: the student already has these values.' };
    const student = `${text(found.row['FIRST NAME'])} ${text(found.row['LAST NAME'])}`.trim();
    if (!apply) return { id, student, changes: diff, before };
    const done = setColumns(req, found, Object.fromEntries(diff.map((d) => [d.column, d.after])));
    if (done.error) return { error: done.error };
    noteCardChanges(req, id, diff.map((d) => [Fields.columnLabel(d.column), d.before, d.after]));
    return { id, student, changed: diff };
  }



  // ---- Today: what needs a person's attention now, for the students this account sees ----
  // The home screen of each kind of account (Teams.kindOf): the same facts, but each team sees the work that is its own, in its own words.
  const WORKSPACES = {
    admin: { title: 'Everything at a glance', tagline: 'Here is what needs attention across the whole consultancy today.', sections: ['check', 'apply', 'passport', 'noSource', 'offers', 'cas'], tiles: ['active', 'applied', 'visas'] },
    manager: { title: 'The consultancy at a glance', tagline: 'The numbers and the students waiting, to look at. Open the Dashboard for the full picture.', sections: ['check', 'apply', 'passport', 'noSource', 'offers', 'cas'], tiles: ['active', 'applied', 'visas'] },
    application: { title: 'Application Team', tagline: 'Applications to submit, to chase and to complete.', sections: ['check', 'apply', 'passport', 'noUni', 'noOffer', 'offers'], tiles: ['toSubmit', 'waitingOffer', 'applied'] },
    branch: { title: 'Your branch', tagline: 'Your branch students: what to submit and who is close to a visa.', sections: ['apply', 'offers', 'cas'], tiles: ['active', 'applied', 'visas'] },
    team: { title: 'Your teams', tagline: 'The work of all your teams in one place.', sections: ['apply', 'offers'], tiles: ['active', 'applied', 'visas'] },
  };
  const TILE_LABEL = {
    active: 'Students in progress', applied: 'Applied', visas: 'Visas (every intake)', toSubmit: 'Applications to submit', waitingOffer: 'Waiting for an offer',
  };
  // The workspace of a person (Today's title and lists, their dashboard): their own team when one is chosen (Users, "Their own
  // team"), so a person in the Application Team with a branch's access too has the Application Team's Today and dashboard.
  const homeKind = (user) => (user && user.taskTeam && teamsOf(user).includes(user.taskTeam) && !Teams.isManager(user) ? Teams.kindOf({ ...user, departments: [user.taskTeam] }) : Teams.kindOf(user));
  // `perList`: how many students each list carries (Today shows 6; the team's Dashboard opens them all with "+N more").
  function todayFor(user, { perList = 6 } = {}) {
    const all = cards.all();
    const today = cards.today();
    const dayNo = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
    const now = dayNo(today);
    const kind = homeKind(user);
    // A person in several teams: the lists of those teams only (the owner, 15 Nov 2026), not a mix that fits none of them.
    const own = kind === 'team' ? teamsOf(user).map((d) => WORKSPACES[d]).filter(Boolean) : [];
    const space = own.length > 1
      ? { ...WORKSPACES.team, title: own.map((w) => w.title).join(' and '), sections: [...new Set(own.flatMap((w) => w.sections))], tiles: [...new Set(own.flatMap((w) => w.tiles.slice(0, 2)))].slice(0, 3) }
      : (WORKSPACES[kind] || WORKSPACES.team);
    const sections = [
      { key: 'apply', title: 'Applications to submit', hint: 'At Application Stage, not submitted yet', stage: 'Application Stage', rows: [] },
      { key: 'noSource', title: 'Student source not recorded', hint: 'Add where they came from, so the Dashboard counts them', stage: '', rows: [] },
      { key: 'passport', title: 'Passport details missing', hint: 'Date of birth, passport number or address not added', stage: '', rows: [] },
      { key: 'noUni', title: 'Applications without a university or course', hint: 'At Application Stage: choose where to apply first', stage: 'Application Stage', rows: [] },
      { key: 'noOffer', title: 'Applications waiting for an offer', hint: 'Submitted over 10 days ago, no offer yet: chase the university', stage: '', rows: [] },
      { key: 'offers', title: 'Offers waiting for the deposit', hint: 'Offer received, payment not made', stage: '', rows: [] },
      { key: 'cas', title: 'CAS received, visa not lodged', hint: 'The next step is the visa application', stage: '', rows: [] },
      { key: 'check', title: 'Details to check', hint: 'Dates that do not add up, or filled in before answers were checked: open the card to correct or confirm', stage: '', rows: [] },
    ];
    const by = Object.fromEntries(sections.map((x) => [x.key, x]));
    const totals = { active: 0, applied: 0, visas: 0, atMock: 0, deferred: 0, inquiries: 0 };
    // Missing details (the owner, 21 Nov 2026), the Application Team's own list on Today: every student it can correct whose application,
    // passport or medical details are missing or do not add up, one plain line each, all of them (never cut short). A line leaves by itself
    // once the detail is right.
    const missing = kind === 'application' ? new Map() : null;
    const missOne = (row, sheet, line, extra = {}) => {
      const m = missing.get(row._id) || { id: row._id, name: nameOf(row), stage: text(row[STATUS]), intake: sheet.name, lines: [] };
      if (!m.lines.some((x) => x.text === line)) m.lines.push({ text: line, ...extra });
      missing.set(row._id, m);
    };
    function missingOf(row, sheet, card, stage, wrong) {
      const opts = card.options || [];
      // Dates on each university the student applied to (a wrong day there stays even when All Students is corrected).
      let onOptions = 0;
      opts.forEach((o) => {
        if (o.offer && o.applied && o.offer < o.applied) { onOptions += 1; missOne(row, sheet, `Offer from ${o.university} (${niceDay(o.offer)}) is before its application (${niceDay(o.applied)}).`); }
        else if (o.offer && !o.applied) { onOptions += 1; missOne(row, sheet, `Offer from ${o.university} on ${niceDay(o.offer)}, but no application date for it.`); }
      });
      // All Students' own dates (the system's checks); the ones only to be confirmed are not listed here, they cannot be fixed.
      wrong.filter((c) => /^offer-(no-app|before-app|refused):/.test(c.key)).forEach((c) => { if (!onOptions || /^offer-refused:/.test(c.key)) missOne(row, sheet, c.text); });
      // At Application Stage with nowhere to apply: only when no course was given to the team either (an Apply task is that choice).
      if (stage === 'Application Stage' && (!text(row['UNIVERSITY NAME']) || !text(row['COURSE NAME'])) && !opts.some((o) => Fields.WITH_TEAM(o) || o.applied)) missOne(row, sheet, !text(row['UNIVERSITY NAME']) ? 'No university or course chosen yet.' : 'No course chosen yet.');
      if (stage && stage !== 'Inquiry') {
        const pp = card.profile || {};
        // The Profile and Application details are the Application Team's to complete (the owner, 22 Nov 2026). Each detail counts as
        // missing only from the step where it exists: University partner once applied, Student ID, NOC and NOC number once an offer is
        // received, Medical report once the Pre-CAS interview is passed, the medical booking day once the report says Booked.
        const applied = Boolean(text(row['APPLICATION SUBMISSION DATE']) || opts.some((o) => o.applied));
        const offered = Boolean(text(row['OFFER RECEIVED DATE']) || opts.some((o) => o.offer && !o.refused && !o.withdrawn));
        const lang = text(row['LANGUAGE TEST DATE']);
        const gone = [
          ['email', row.EMAIL], ['WhatsApp number', row['CONTACT NUMBER']], ['date of birth', pp.dob], ['passport number', pp.passportNo], ['address', pp.address],
          ['Student source', row['STUDENT SOURCE']], ['receiving partner', row['RECEIVING PARTNER']],
          [lang === 'Test Date' ? 'language test date' : 'language test', lang === 'Test Date' ? '' : lang],
          ...(applied ? [['university partner', row['UNIVERSITY PARTNER']]] : []),
          ...(offered ? [['Student ID', row['STUDENT ID']], ['NOC', row.NOC], ['NOC number', row['NOC NUMBER']]] : []),
          ...(text(row['PRE CAS INTERVIEW']) === 'Passed' ? [['medical report', row['MEDICAL REPORT']]] : []),
          ...(text(row['MEDICAL REPORT']) === 'Booked' ? [['medical booking date', card.medical && card.medical.date]] : []),
        ].filter(([, v]) => !text(v)).map(([k]) => k);
        if (gone.length) missOne(row, sheet, `No ${gone.length > 1 ? `${gone.slice(0, -1).join(', ')} or ${gone[gone.length - 1]}` : gone[0]}.`);
      }
    }
    const dateOf = (v) => isoDate(v);
    for (const { sheet, row } of visibleStudents(user)) {
      const stage = text(row[STATUS]);
      const card = all[row._id] || { notes: [], messages: [] };
      const last = (contactsOf(card).pop() || {}).at;
      const lastDay = last ? dayNo(localDate(new Date(last))) : null;
      const add = (key, detail, waited) => by[key].rows.push({ id: row._id, name: nameOf(row), stage, intake: sheet.name, detail, waited });
      // Details that do not add up, at any stage (see checksOf).
      const wrong = checksOf(row, card);
      if (wrong.length) add('check', wrong.map((c) => c.text).join(' '), wrong.length);
      if (stage === 'Defer') {
        totals.deferred += 1;
        continue;
      }
      if (['Withdrawn', 'Hold', 'Visa Rejected'].includes(stage)) continue;
      const visa = stage === 'Visa Issued' || text(row['VISA RECEIVED DATE']);
      if (visa) { totals.visas += 1; continue; }
      totals.active += 1;
      if (text(row['APPLICATION SUBMISSION DATE'])) totals.applied += 1;
      const created = dateOf(row['APPLICATION SUBMISSION DATE']);
      if (stage === 'Inquiry') totals.inquiries += 1;
      if (stage === 'Mock Stage') totals.atMock += 1;
      if (stage === 'Application Stage' && !created) add('apply', text(row['UNIVERSITY NAME']) || 'No university chosen yet', 0);
      // Where the student came from feeds every source figure of the Dashboard: a student without it is asked for (the owner, 14 Nov 2026).
      if (!text(row['STUDENT SOURCE'])) add('noSource', 'No source', 0);
      // The passport details are needed from Application Stage on (the owner, 14 Nov 2026): say which are missing.
      if (stage && stage !== 'Inquiry') {
        const pp = card.profile || {};
        const gone = [['date of birth', pp.dob], ['passport number', pp.passportNo], ['address', pp.address]].filter(([, v]) => !text(v)).map(([k]) => k);
        if (gone.length) add('passport', `No ${gone.join(', ')}`, gone.length);
      }
      if (stage === 'Application Stage' && (!text(row['UNIVERSITY NAME']) || !text(row['COURSE NAME']))) add('noUni', !text(row['UNIVERSITY NAME']) ? 'No university chosen' : 'No course chosen', 0);
      if (created && !dateOf(row['OFFER RECEIVED DATE']) && now - dayNo(created) > 10 && ['Application Stage', 'Mock Stage'].includes(stage)) add('noOffer', `Submitted ${now - dayNo(created)} days ago`, now - dayNo(created));
      const offer = dateOf(row['OFFER RECEIVED DATE']);
      if (offer && !text(row['PAYMENT DATE'])) add('offers', `Offer received ${Math.max(0, now - dayNo(offer))} days ago`, Math.max(0, now - dayNo(offer)));
      const cas = dateOf(row['CAS RECEIVED DATE']);
      if (cas && !text(row['VISA LODGE DATE'])) add('cas', `CAS received ${Math.max(0, now - dayNo(cas))} days ago`, Math.max(0, now - dayNo(cas)));
    }
    // Missing details covers every student the team can fix: Application Stage and Mock Stage of the current intake (see appReach).
    if (missing && kind === 'application') {
      for (const found of rowIndex().values()) {
        if (!appReach(user, found) || !isStudent(found.row)) continue; // a row with no name is not a student
        const c = all[found.row._id] || { notes: [], options: [], tasks: [] };
        missingOf(found.row, found.sheet, c, text(found.row[STATUS]), checksOf(found.row, c));
      }
    }
    // The medical step is the team's too, after Application Stage: a Medical task of this person whose test day has passed and whose report
    // is not recorded. It is fixed by finishing that task (it records the report), so the line points at the task.
    if (missing && kind === 'application') {
      for (const { sheet, row } of rowIndex().values()) {
        const c = all[row._id];
        if (!c || !c.medical || c.medical.done || !(c.medical.date < today) || text(row['MEDICAL REPORT']) === 'Received') continue;
        const t = (c.tasks || []).find((x) => !x.done && forMe(user, x) && Fields.taskTag(x, text(row[STATUS])) === 'medical');
        if (t) missOne(row, sheet, `The medical test was on ${niceDay(c.medical.date)}, the report is not recorded.`, { taskId: t.id });
      }
    }
    const counts = { toSubmit: by.apply.rows.length, waitingOffer: by.noOffer.rows.length };
    const value = { ...totals, ...counts };
    return {
      today, name: user.name, totals, kind, title: space.title, tagline: space.tagline,
      tiles: space.tiles.map((k) => ({ key: k, label: TILE_LABEL[k], value: value[k] })),
      missing: missing ? [...missing.values()].sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name)) : null,
      // How many different students wait in these lists: a student in two lists (no passport details and not applied yet) counts once.
      waiting: new Set(space.sections.flatMap((k) => by[k].rows.map((r) => r.id))).size,
      sections: space.sections.map((k) => by[k]).map((x) => ({ key: x.key, title: x.title, hint: x.hint, stage: x.stage, count: x.rows.length, students: x.rows.sort((a, b) => b.waited - a.waited).slice(0, x.key === 'check' ? 100 : perList) })),
    };
  }

  // ---- My dashboard: each team's own page of how its work is going (Admin and the Manager have the full Dashboard) ----
  // The figures of the Application Team count the whole current intake (a student the team helped moves on to
  // the next stage and leaves its sheet, and the team should still see that it went on); names are only ever those of the students
  // the account sees on its sheet. A branch counts its own students.
  // "This week" is the last 7 days, compared with the 7 days before, so a team sees its own rhythm without any ranking of people.
  const MY_DASH = {
    application: {
      title: 'Application Team', lead: 'How the applications are moving.',
      kpis: ['toSubmit', 'submitted', 'waitingOffer', 'offers'],
      week: [['APPLICATION SUBMISSION DATE', 'Applications submitted'], ['OFFER RECEIVED DATE', 'Offers received']],
      stages: ['Application Stage', 'Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'],
    },
    branch: {
      title: 'Your branch', lead: 'Your branch students, from the first inquiry to the visa.',
      kpis: ['active', 'submitted', 'offers', 'visas'],
      week: [['INQUIRY', 'New inquiries'], ['APPLICATION SUBMISSION DATE', 'Applications submitted'], ['OFFER RECEIVED DATE', 'Offers received'], ['VISA RECEIVED DATE', 'Visas received']],
      stages: Teams.ALL_STATUSES,
    },
    team: {
      title: 'Your teams', lead: 'The work of all your teams together.',
      kpis: ['active', 'submitted', 'offers', 'visas'],
      week: [['APPLICATION SUBMISSION DATE', 'Applications submitted'], ['OFFER RECEIVED DATE', 'Offers received'], ['CONTACT', 'Students contacted']],
      stages: Teams.ALL_STATUSES,
    },
  };
  const MY_KPI = {
    toSubmit: ['Applications to submit', 'At Application Stage, not submitted yet'], submitted: ['Applied', 'In this intake'],
    waitingOffer: ['Waiting for an offer', 'Submitted over 10 days ago'], offers: ['Offers', 'In this intake'],
    active: ['Students in progress', 'Not left, no visa yet'], visas: ['Visas', 'In this intake'],
  };
  // A person in several teams (and no own team chosen) sees only what their teams do, put together: each team's own figures, the
  // week and the stages of those teams, never every stage of the consultancy (the owner, 15 Nov 2026).
  const teamsPlan = (user) => {
    const plans = teamsOf(user).map((d) => MY_DASH[d]).filter(Boolean);
    if (plans.length < 2) return MY_DASH.team;
    const uniq = (list, key = (x) => x) => list.filter((x, i) => list.findIndex((y) => key(y) === key(x)) === i);
    const each = Math.max(2, Math.floor(4 / plans.length));
    return {
      title: plans.map((p) => p.title).join(' and '), lead: 'The work of your teams, together.',
      kpis: uniq(plans.flatMap((p) => p.kpis.slice(0, each))).slice(0, 6),
      week: uniq(plans.flatMap((p) => p.week), (w) => w[0]).slice(0, 4),
      stages: Teams.ALL_STATUSES.filter((st) => plans.some((p) => p.stages.includes(st))),
    };
  };
  function myDashboard(user) {
    const kind = homeKind(user);
    const plan = kind === 'team' ? teamsPlan(user) : (MY_DASH[kind] || MY_DASH.team);
    const today = cards.today();
    const dayNo = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
    const now = dayNo(today);
    const all = cards.all();
    const t = todayFor(user, { perList: 200 });
    const counts = Object.fromEntries(t.sections.map((x) => [x.key, x.count]));
    const students = visibleStudents(user);
    const v = { ...t.totals, toSubmit: counts.apply || 0, waitingOffer: counts.noOffer || 0, submitted: 0, offers: 0, visas: 0, contactedWeek: 0 };
    // Per day of the last 14: how many of each "done" thing happened.
    const weekNow = {}; const weekBefore = {};
    const bump = (key, iso) => {
      if (!iso) return;
      const ago = now - dayNo(iso);
      if (ago >= 0 && ago < 7) weekNow[key] = (weekNow[key] || 0) + 1;
      else if (ago >= 7 && ago < 14) weekBefore[key] = (weekBefore[key] || 0) + 1;
    };
    const stageCount = new Map(plan.stages.map((st) => [st, 0]));
    const wins = []; const upcoming = [];
    const seen = new Set(students.map((x) => x.row._id));
    const intakeSheet = currentIntake();
    const scope = ['application', 'team'].includes(kind) && intakeSheet
      ? intakeSheet.rows.filter((r) => r && r._id && isStudent(r)).map((row) => ({ sheet: intakeSheet, row })) : students;
    for (const { sheet, row } of scope) {
      const mineToName = seen.has(row._id);
      const stage = text(row[STATUS]);
      const card = all[row._id] || { notes: [], messages: [], profile: {} };
      if (stageCount.has(stage)) stageCount.set(stage, stageCount.get(stage) + 1);
      if (isoDate(row['APPLICATION SUBMISSION DATE'])) v.submitted += 1;
      if (isoDate(row['OFFER RECEIVED DATE'])) v.offers += 1;
      if (stage === 'Visa Issued' || isoDate(row['VISA RECEIVED DATE'])) v.visas += 1;
      ['APPLICATION SUBMISSION DATE', 'OFFER RECEIVED DATE', 'PAYMENT DATE', 'VISA RECEIVED DATE', 'CAS RECEIVED DATE'].forEach((c) => bump(c, isoDate(row[c])));
      const lt = isoDate(row['LANGUAGE TEST DATE']);
      if (mineToName && lt && dayNo(lt) - now >= 0 && dayNo(lt) - now <= 7) upcoming.push({ id: row._id, name: nameOf(row), date: lt, what: 'English test', stage });
      bump('INQUIRY', isoDate(card.profile && card.profile.inquiryDate));
      const lastAt = (contactsOf(card).pop() || {}).at;
      const lastTouch = lastAt ? localDate(new Date(lastAt)) : '';
      bump('CONTACT', lastTouch);
      if (lastTouch && now - dayNo(lastTouch) < 7) v.contactedWeek += 1;
      // The good news of the last 30 days, newest first.
      [['VISA RECEIVED DATE', 'Visa received'], ['CAS RECEIVED DATE', 'CAS received'], ['OFFER RECEIVED DATE', 'Offer received'], ['PAYMENT DATE', 'Deposit paid']].some(([c, what]) => {
        const d = isoDate(row[c]);
        if (mineToName && d && now - dayNo(d) >= 0 && now - dayNo(d) < 30) { wins.push({ id: row._id, name: nameOf(row), date: d, what, intake: sheet.name }); return true; }
        return false;
      });
    }
    // The tasks of this person's teams.
    const mine = taskTeamsOf(user);
    let open = 0; let doneWeek = 0;
    for (const { row } of rowIndex().values()) {
      const c = all[row._id];
      (c && c.tasks ? c.tasks : []).forEach((x) => {
        if (!mine.includes(x.team)) return;
        if (!x.done) open += 1; else if (x.doneAt && now - dayNo(localDate(new Date(x.doneAt))) < 7) doneWeek += 1;
      });
    }
    const intake = intakeSheet;
    return {
      kind, title: plan.title, lead: plan.lead, name: user.name, today, intake: intake ? intake.name : '',
      kpis: plan.kpis.map((k) => ({ key: k, label: MY_KPI[k][0], note: MY_KPI[k][1], value: v[k] || 0 })),
      week: plan.week.map(([key, label]) => ({ key, label, now: weekNow[key] || 0, before: weekBefore[key] || 0 })),
      stages: [...stageCount.entries()].map(([stage, count]) => ({ stage, count })),
      stagesNote: scope === students ? 'Your students, by stage.' : 'Everyone in this intake, by stage (the numbers only).',
      tasks: { open, doneWeek },
      // What waits for the team now, the same lists as Needs attention on Today (the owner, 15 Nov 2026: the dashboard of a team
      // should show only what is theirs to do).
      todo: t.sections.filter((x) => x.count).map((x) => ({ key: x.key, title: x.title, hint: x.hint, count: x.count, students: x.students.slice(0, 200).map((r) => ({ id: r.id, name: r.name, detail: r.detail })) })), // the first 3 shown, "+N more" opens the rest
      upcoming: upcoming.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
      wins: wins.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    };
  }

  // ---- events and marketing: what was run to find students, and what each brought ----
  // The tag on a student ("where exactly") names the event or the marketing; it matches an activity by its name (with or without the date).
  const eventOf = (detail) => {
    const d = text(detail).toLowerCase();
    if (!d) return null;
    return eventFor(planning.all().events, detail);
  };
  // Where a student stands in the follow-up (the owner, 17 Nov 2026: "which event has converted, and has the student been followed up";
  // 21 Nov 2026: no automatic days, the team always chooses the next follow-up date). Worked out from what is already recorded, the
  // same on the follow-up list, Events and marketing and Today:
  //   visa      a visa (Visa Issued, or a visa received date)
  //   applied   past Inquiry and still going (or an application submitted): converted
  //   inactive  Withdrawn, Hold, Defer or Visa Rejected
  //   new       at Inquiry, nobody has spoken to the student yet (calls with no answer do not count)
  //   due       at Inquiry, and the next follow-up date has come, or none was set with the last contact, or a call since went unanswered
  //   ok        at Inquiry, spoken to, and the next follow-up date is still ahead
  // `triedToday`: a call today went unanswered (the list puts the student at the bottom for the rest of the day); `tries`: the
  // unanswered calls since the last contact.
  const INACTIVE_STAGES = ['Withdrawn', 'Hold', 'Defer', 'Visa Rejected'];
  function followOf(row, card, todayNo) {
    const stage = text(row[STATUS]);
    const touches = contactsOf(card);
    const last = touches.length ? touches[touches.length - 1] : null;
    const dayOfIso = (at) => Math.floor(Date.parse(localDate(new Date(at)) + 'T00:00:00Z') / 86400000);
    const lastDay = last ? dayOfIso(last.at) : null;
    const days = lastDay === null ? null : Math.max(0, todayNo - lastDay);
    const tries = ((card && card.notes) || []).filter((n) => n.kind === 'try' && (!last || String(n.at) > String(last.at)));
    const triedToday = tries.length > 0 && dayOfIso(tries[tries.length - 1].at) === todayNo;
    // The date counts only when it was set with (or after) the last contact: a later note written without one asks for a new date.
    const nx = card && card.follow && card.follow.next;
    const next = nx && (!last || String(nx.at) >= String(last.at)) ? nx : null;
    const nextDay = next ? Math.floor(Date.parse(next.date + 'T00:00:00Z') / 86400000) : null;
    let state;
    if (stage === 'Visa Issued' || text(row['VISA RECEIVED DATE'])) state = 'visa';
    else if (INACTIVE_STAGES.includes(stage)) state = 'inactive';
    else if ((stage && stage !== 'Inquiry') || text(row['APPLICATION SUBMISSION DATE'])) state = 'applied';
    else if (!last) state = 'new';
    else if (tries.length || nextDay === null || nextDay <= todayNo) state = 'due';
    else state = 'ok';
    return { state, stage, last, days, touches, tries: tries.length, triedToday, next };
  }
  const todayNumber = () => Math.floor(Date.parse(cards.today() + 'T00:00:00Z') / 86400000);

  function activities(user) {
    const wb = getWorkbook();
    const plan = planning.all();
    const all = cards.all();
    const list = plan.events.map((e) => ({ ...e, leads: 0, applied: 0, visas: 0, students: [], perIntake: {}, follow: { new: 0, due: 0, ok: 0, inactive: 0 } }));
    const todayNo = todayNumber();
    const byName = (detail) => eventFor(list, detail);
    // Students from social media not tagged with any campaign, so in no campaign's cost per inquiry. Those marked Organic (they came
    // by themselves, not from an advert) are left out: they belong to no campaign (the owner, 17 Nov 2026).
    let unlinkedSocial = 0;
    const unlinkedByIntake = {}; // the same, per intake (the id of its tab)
    if (wb) wb.sheets.forEach((sheet) => sheet.rows.forEach((row) => {
      if (!isStudent(row)) return;
      const card = all[row._id];
      const e = card && byName(card.profile.sourceDetail);
      if (!e) { if (text(row['STUDENT SOURCE']) === 'Social Media' && !(card && card.profile && card.profile.sourceWay === 'Organic')) { unlinkedSocial += 1; unlinkedByIntake[sheet.id] = (unlinkedByIntake[sheet.id] || 0) + 1; } return; }
      e.leads += 1;
      e.perIntake[sheet.id] = (e.perIntake[sheet.id] || 0) + 1;
      const stage = text(row[STATUS]);
      if (!['', 'Inquiry', 'Defer', 'Hold', 'Withdrawn'].includes(stage) || text(row['APPLICATION SUBMISSION DATE'])) e.applied += 1;
      if (stage === 'Visa Issued' || text(row['VISA RECEIVED DATE'])) e.visas += 1;
      const f = followOf(row, card, todayNo).state;
      if (f in e.follow) e.follow[f] += 1;
      if (e.students.length < 60) e.students.push({ id: row._id, name: nameOf(row), stage, intake: sheet.name });
    }));
    const day = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
    // The intake each event belongs to (the owner, 17 Nov 2026: Events and marketing intake by intake): the one Admin chose for it, else
    // the intake most of its students are in (the newer intake when two have as many), else none. Each event is under one intake only,
    // so its cost is never counted twice. A chosen intake that was since deleted counts as not chosen.
    const sheets = wb ? wb.sheets : [];
    const order = new Map(sheets.map((sh, i) => [sh.id, i]));
    const intakeOf = (e) => {
      if (e.intake && order.has(e.intake)) return { id: e.intake, how: 'chosen' };
      const best = Object.entries(e.perIntake).sort((x, y) => y[1] - x[1] || (order.get(y[0]) || 0) - (order.get(x[0]) || 0))[0];
      return best ? { id: best[0], how: 'students' } : { id: '', how: 'none' };
    };
    const nameOfSheet = (id) => (sheets.find((sh) => sh.id === id) || {}).name || '';
    const shaped = list.sort((a, b) => b.date.localeCompare(a.date)).map((e) => ({
      id: e.id, name: e.name, kind: e.kind || 'Event', type: e.type, channel: channelOf(e), place: e.place, date: e.date, endDate: e.endDate || '',
      days: e.date ? (e.endDate ? day(e.endDate) - day(e.date) + 1 : 1) : 0, note: e.note, cost: e.cost, costCurrency: e.costCurrency || 'NPR', costAmount: e.costAmount === undefined ? e.cost : e.costAmount, costRate: e.costRate || 0, leads: e.leads, applied: e.applied, visas: e.visas,
      costPerLead: e.cost > 0 && e.leads > 0 ? Math.round(e.cost / e.leads) : null, costPerVisa: e.cost > 0 && e.visas > 0 ? Math.round(e.cost / e.visas) : null,
      students: e.students, registered: e.registered, attended: e.attended, follow: e.follow,
      ...(() => { const i = intakeOf(e); return { intake: i.id, intakeName: nameOfSheet(i.id), intakeHow: i.how, chosenIntake: e.intake && order.has(e.intake) ? e.intake : '' }; })(),
      perIntake: Object.entries(e.perIntake).map(([id, n]) => ({ id, name: nameOfSheet(id), students: n })).sort((x, y) => y.students - x.students),
    }));
    return { list: shaped, unlinkedSocial, unlinkedByIntake };
  }

  // ---- one student's card ----
  async function handleCard(req, res, urlPath) {
    const m = /^\/api\/cards\/([\w-]{1,64})(?:\/(profile|notes|options|messages|source|sheet|tasks|checks)(?:\/([a-z0-9]{6,32}|preview|send))?(\/delete)?)?$/.exec(urlPath);
    if (!m) return false;
    const [, rowId, part, sub, del] = m;
    const found = rowIndex().get(rowId);
    if (!canSee(req.user, found)) { sendJSON(res, 404, { error: 'No such student, or the student is not in your list.' }); return true; }
    const editable = canChange(req.user, found);
    const card = cards.get(rowId);

    if (req.method === 'GET') {
      if (!part) {
        sendJSON(res, 200, {
          student: { ...brief(found.sheet, found.row), color: found.row._color || '', remarks: text(found.row.REMARKS), columns: found.sheet.columns, row: Object.fromEntries(found.sheet.columns.map((c) => [c, found.row[c] ?? ''])) },
          // Each option with its fee, scholarship, deposit and course page from Universities when the option has none of its own.
          card: { ...card, options: (card.options || []).map(withFacts) },
          checks: checksOf(found.row, card),
          can: { edit: editable, removeAnyNote: Teams.isAdmin(req.user), source: editable && Teams.canEdit(req.user, 'STUDENT SOURCE', found.row), cols: editable ? Object.keys(CARD_EDITABLE).filter((c) => Teams.canEdit(req.user, c, found.row)) : [], assign: assignTeamsFor(req.user).length > 0, removeAnyTask: canAssign(req.user), myTeams: taskTeamsOf(req.user), readOnly: Teams.isReadOnly(req.user) },
          taskTeams: TASK_TEAMS(),
          handTeams: handTeamsFor(req.user),
          assignTeams: assignTeamsFor(req.user),
          taskUnread: Object.fromEntries((card.tasks || []).map((t) => [t.id, unreadOf(req.user, t, cards.seenBy(req.user.username))]).filter(([, n]) => n > 0)),
          me: { name: req.user.name, role: req.user.role },
          event: (() => { const e = eventOf(card.profile.sourceDetail); return e ? { name: e.name, kind: e.kind || 'Event', type: e.type, place: e.place, date: e.date, endDate: e.endDate } : null; })(),
          mail: mailInfo(req.user),
          today: cards.today(),
        });
        return true;
      }
      if (part === 'messages' && sub && sub.length === 12) {
        const entry = card.messages.find((x) => x.id === sub);
        const words = entry ? cards.messageText(rowId, sub) : null;
        if (!entry) sendJSON(res, 404, { error: 'No such message.' });
        else sendJSON(res, 200, { message: entry, text: words || '' });
        return true;
      }
      send(res, 405, 'Method not allowed');
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
    // Tasks: Admin and the Manager give one to a team (and remove it); the team (or Admin and the Manager) marks it complete or not.
    if (part === 'tasks') {
      const body = await bodyOf(req, res);
      if (!body) return true;
      const who2 = nameOf(found.row) || 'a student';
      let out;
      if (!sub) {
        const allowedTeams = assignTeamsFor(req.user).map((t) => t.id);
        if (!allowedTeams.length) { sendJSON(res, 403, { error: 'Your account cannot give tasks.' }); return true; }
        if (!allowedTeams.includes(text(body.team))) { sendJSON(res, 400, { error: 'Choose the team.' }); return true; }
        if (nobodyIn(text(body.team))) { sendJSON(res, 400, { error: `Nobody has ${teamLabel(text(body.team))} yet, so the task would reach no one. Give it to another team, or add someone to this team on Users.` }); return true; }
        out = cards.addTask(rowId, body, by(req));
        if (!out.error) note(req, [`${who2}: gave ${teamLabel(out.task.team)} a task: ${out.task.text.slice(0, 120)}`], 'Gave a task');
      } else {
        const task = (card.tasks || []).find((t) => t.id === sub);
        if (!task) { sendJSON(res, 404, { error: 'No such task.' }); return true; }
        if (body.seen) {
          // The person has read the task and its comments: its red dot goes.
          if (!seesAllTasks(req.user) && !gaveIt(req.user, task) && !forMe(req.user, task) && !hadIt(req.user, task)) { sendJSON(res, 403, { error: 'This task is for another team.' }); return true; }
          cards.markSeen(req.user.username, [task.id]);
          sendJSON(res, 200, { ok: true });
          return true;
        }
        if (del) {
          if (!canAssign(req.user) && !gaveIt(req.user, task)) { sendJSON(res, 403, { error: 'Only Admin, the Manager or whoever gave the task removes it.' }); return true; }
          // A removed task that had work on it stays in the student's History as one note (the owner, 15 Nov 2026: what was given,
          // by whom and what was done is always kept on the student).
          const said = (task.comments || []).filter((c) => text(c.text)).map((c) => `${c.by || 'Someone'}: ${text(c.text)}`);
          if (said.length || task.done) {
            const words = `Task removed (given by ${task.by || 'someone'} to ${teamLabel(task.team)}${task.done ? ', it was done' : ''}): ${task.text}${said.length ? `\nUpdates: ${said.join(' | ')}` : ''}`;
            cards.addNote(rowId, { kind: 'note', text: words.slice(0, 3900) }, by(req));
          }
          out = cards.removeTask(rowId, sub, by(req));
          if (!out.error && (/^Apply (for|to) /.test(text(task.text)))) {
            // The courses that task carried (named in its list), still unanswered, go back to the Shortlist: nobody is left holding a course
            // with no task.
            const listed = (task.comments || []).map((c) => text(c.text)).join('\n');
            assignedOf(cards.get(rowId)).filter((o) => o.taskId === task.id || listed.includes([o.course, o.university].filter(Boolean).join(' at '))).forEach((o) => cards.updateOption(rowId, o.id, { sent: '', rank: '', taskId: '' }, by(req)));
          }
          if (!out.error) note(req, [`${who2}: removed the task for ${teamLabel(task.team)}`], 'Removed a task');
        } else if (body.handTo !== undefined) {
          if (!mayHand(req.user, task)) { sendJSON(res, 403, { error: 'Only the team the task is with, whoever gave it, Admin or the Manager can reassign it.' }); return true; }
          if (!TASK_TEAMS().some((t) => t.id === text(body.handTo))) { sendJSON(res, 400, { error: 'Choose the team.' }); return true; }
          if (!handTeamsFor(req.user).some((t) => t.id === text(body.handTo))) { sendJSON(res, 403, { error: 'Your account cannot give a task to that team.' }); return true; }
          if (nobodyIn(text(body.handTo))) { sendJSON(res, 400, { error: `Nobody has ${teamLabel(text(body.handTo))} yet, so the task would reach no one. Choose another team.` }); return true; }
          const from = task.team;
          out = cards.handTask(rowId, sub, { team: text(body.handTo), reason: body.reason }, by(req));
          if (!out.error) { cards.markSeen(req.user.username, [task.id]); note(req, [`${who2}: handed the task from ${teamLabel(from)} to ${teamLabel(out.task.team)}: ${String(body.reason).slice(0, 120)}`], 'Handed a task on'); }
        } else if (body.schedule !== undefined) {
          // Moved to another day: the team it is with, whoever gave it, Admin or the Manager.
          if (Teams.isReadOnly(req.user) || (!canAssign(req.user) && !gaveIt(req.user, task) && !forMe(req.user, task))) { sendJSON(res, 403, { error: 'This task is for another team.' }); return true; }
          if (task.done) { sendJSON(res, 400, { error: 'This task is done already.' }); return true; }
          out = cards.scheduleTask(rowId, sub, { date: text(body.schedule), reason: body.reason }, by(req), cards.today());
          if (!out.error) { cards.markSeen(req.user.username, [task.id]); note(req, [`${who2}: the task for ${teamLabel(task.team)} moved to ${out.task.doOn || 'today'}${text(body.reason) ? `: ${text(body.reason).slice(0, 120)}` : ''}`], 'Task'); }
        } else if (body.text !== undefined) {
          // The words of the task: whoever gave it, Admin or the Manager. The priority and the tag can come with it.
          if (!canAssign(req.user) && !gaveIt(req.user, task)) { sendJSON(res, 403, { error: 'Only whoever gave the task, Admin or the Manager can change it.' }); return true; }
          const before = task.text;
          out = cards.editTask(rowId, sub, { text: body.text }, by(req));
          if (!out.error && (body.tag !== undefined || body.priority !== undefined)) {
            const change = {};
            if (body.tag !== undefined) change.tag = text(body.tag);
            if (body.priority !== undefined) change.priority = text(body.priority);
            out = cards.tagTask(rowId, sub, change, by(req));
          }
          if (!out.error) note(req, [`${who2}: changed the task for ${teamLabel(task.team)}${before !== out.task.text ? ` from "${before.slice(0, 80)}" to "${out.task.text.slice(0, 80)}"` : ''}`], 'Task');
        } else if (body.tag !== undefined || body.priority !== undefined) {
          // What the task is about and how important it is: whoever gave it, Admin or the Manager. The team that has to do the task cannot
          // retag it: the tag decides which columns and stage finishing it writes (review fix, 18 Nov 2026).
          if (!canAssign(req.user) && !gaveIt(req.user, task)) { sendJSON(res, 403, { error: 'This task is for another team.' }); return true; }
          const change = {};
          if (body.tag !== undefined) change.tag = text(body.tag);
          if (body.priority !== undefined) change.priority = text(body.priority);
          out = cards.tagTask(rowId, sub, change, by(req));
          const label = (list, k) => (list.find(([id]) => id === k) || [])[1];
          if (!out.error) note(req, [`${who2}: the task for ${teamLabel(task.team)} is now ${[change.tag && label(Fields.TASK_TAGS, out.task.tag), change.priority && label(Fields.TASK_PRIORITIES, out.task.priority)].filter(Boolean).join(', ')}`], 'Task');
        } else if (body.comment !== undefined) {
          // The team, whoever gave the task (Admin, the Manager, or the branch that gave it) and the teams it was with talk it through here.
          if (!canAssign(req.user) && !gaveIt(req.user, task) && !forMe(req.user, task) && !hadIt(req.user, task)) { sendJSON(res, 403, { error: 'This task is for another team.' }); return true; }
          out = cards.commentTask(rowId, sub, body.comment, by(req));
          if (!out.error) cards.markSeen(req.user.username, [task.id]);
          if (!out.error) note(req, [`${who2}: commented on the task for ${teamLabel(task.team)}: ${String(body.comment).slice(0, 120)}`], 'Task comment');
        } else {
          // A view-only account (a Manager with no team) cannot finish a task: finishing writes the student's columns.
          if (Teams.isReadOnly(req.user) || (!canAssign(req.user) && !forMe(req.user, task))) { sendJSON(res, 403, { error: 'This task is for another team.' }); return true; }
          const f = body.finish && typeof body.finish === 'object' ? body.finish : null;
          // What the "Mark as done?" window shows before it asks (see finishState).
          if (body.finishState) { sendJSON(res, 200, { state: finishState(found, task, req.user) }); return true; }
          // Done needs what happened (an answer, or a few words).
          if (body.done && !task.done && !f) { sendJSON(res, 400, { error: 'Say what was done first.' }); return true; }
          const hasKeys = Boolean(f) && Object.keys(f).some((k) => !['note', 'confirmed', 'next', 'nextText', 'generic', 'waiting'].includes(k) && f[k] !== undefined && f[k] !== '');
          // An answer counts only when it records something: an extra word in the request is not an answer (the few words are then needed).
          const draft = hasKeys ? finishPlan(found, task, f, req.user) : null;
          const answered = Boolean(draft && (draft.error || Object.keys(draft.columns).length || draft.options.length || draft.remind || draft.medical !== undefined || (draft.note && draft.note !== text(f.note).slice(0, 2000))));
          let step = null;
          if (body.done && !task.done && f) {
            const plan0 = answered ? draft : null;
            if (plan0 && plan0.error) { sendJSON(res, 400, { error: plan0.error }); return true; }
            // "Nothing to record" is not an answer while courses given to the team are still unanswered.
            const ownC = courseOf(cards.get(found.row._id), task);
            const pendingAssigned = ownC ? assignedOf(cards.get(found.row._id)).filter((a) => a.id === ownC.id) : assignedOf(cards.get(found.row._id));
            // No word in the request skips this (an old "generic" or "waiting" flag once did): every course given to the team is answered.
            if (Fields.taskTag(task, text(found.row[STATUS])) === 'application' && pendingAssigned.length && !(plan0 && plan0.options.length)) {
              sendJSON(res, 400, { error: 'Courses were given to the team and have no answer yet: choose Applied, an offer, Refused, Withdrawn or Not submitted (and say why) for each.' }); return true;
            }
            // An answer to the task's question says what happened by itself; without one, a few words are needed.
            if (!answered && text(f.note).length < MIN_NOTE) { sendJSON(res, 400, { error: 'Write in a few words what was done, so the next person knows.' }); return true; }
            // No follow-up question is asked when a task is done (the owner, 18 Nov 2026: it is removed from every kind of task). A next day is
            // made only when one is given on purpose: the Offer request that is not answered yet ("ask the university again on ...").
            const wantsStep = f.waiting === true || (f.next !== undefined && f.next !== '' && f.next !== 'none');
            if (wantsStep && !(plan0 && plan0.remind) && f.medical !== 'booked') {
              step = nextStepOf(f, task);
              if (step && step.error) { sendJSON(res, 400, { error: step.error }); return true; }
              if (f.waiting === true && !step) { sendJSON(res, 400, { error: 'Choose the day to check for the offer letter again.' }); return true; }
            }
          }
          const stepWords = (p) => (step ? { ...p, remind: [p.remind, `${step.text}, ${step.day > cards.today() ? `on ${niceDay(step.day)}` : 'today'}`].filter(Boolean).join('; ') } : p);
          if (body.done && !task.done && answered) {
            // Answers are first shown back to the team (preview), and written only once the team confirms them (the owner, 16 Nov 2026).
            const plan = finishPlan(found, task, f, req.user);
            if (body.preview || f.confirmed !== true) { sendJSON(res, body.preview ? 200 : 400, body.preview ? { preview: stepWords(planWords(found, plan)) } : { error: 'Check what will be written and confirm it first.' }); return true; }
            applyPlan(req, found, task, plan);
            if (plan.note || Object.keys(plan.columns).length) note(req, [`${who2}: finished the task "${task.text.slice(0, 80)}"${Object.keys(plan.columns).length ? `; ${Object.entries(plan.columns).map(([c, v]) => `${c}: ${v || '(blank)'}`).join(', ')}` : ''}`], 'Task');
          } else if (body.done && !task.done && f) {
            // Only a note (no question to answer, or "Nothing to record").
            const words = text(f.note).slice(0, 2000);
            if (body.preview) { sendJSON(res, 200, { preview: stepWords(planWords(found, { columns: {}, kept: [], warnings: [], options: [], note: words, remind: null })) }); return true; }
            if (words) cards.addNote(rowId, { kind: 'note', text: words }, by(req));
          }
          if (step && !body.preview) { const made = addNextStep(req, rowId, task, step); if (made) note(req, [`${who2}: next follow-up for ${teamLabel(task.team)} on ${step.day}: ${step.text.slice(0, 80)}`], 'Task'); }
          // Reopened, putting back what finishing it wrote when asked (see undoPlan).
          let undone = null;
          if (!body.done && task.done && f && f.revert) {
            undone = undoPlan(req, found, task);
            if (undone.undone.length || undone.left.length) cards.addNote(rowId, { kind: 'note', text: `Task "${task.text.slice(0, 80)}" reopened and what it recorded was put back. ${[...undone.undone, ...undone.left].join('. ')}.`.slice(0, 3900) }, by(req));
          }
          out = cards.setTask(rowId, sub, Boolean(body.done), by(req));
          // Whoever marks a task done has read it: what was new on it is no longer new for them.
          if (!out.error && body.done) cards.markSeen(req.user.username, [sub]);
          if (!out.error && undone) out = { ...out, undone };
          if (!out.error) note(req, [`${who2}: marked the task for ${teamLabel(task.team)} as ${body.done ? 'complete' : 'not complete'}${undone && undone.undone.length ? `, and put back: ${undone.undone.join('; ')}` : ''}`], 'Task');
        }
      }
      if (out.error) sendJSON(res, 400, { error: out.error }); else sendJSON(res, 200, { ok: true, card: out.card, ...(out.undone ? { undone: out.undone.undone, left: out.undone.left } : {}) });
      return true;
    }
    if (!editable) { sendJSON(res, 403, { error: Teams.isReadOnly(req.user) ? 'Your account can only view students.' : 'Your team cannot change this student.' }); return true; }
    const who = nameOf(found.row) || 'a student';

    if (part === 'messages' && (sub === 'preview' || sub === 'send')) { await handleMessages(req, res, found, card, sub); return true; }
    const body = await bodyOf(req, res);
    if (!body) return true;
    let out;
    if (part === 'checks') {
      // A detail on "Details to check" someone has looked at and says is correct (see checksOf).
      const item = checksOf(found.row, card).find((c) => c.key === text(body.key));
      if (!item) out = { error: 'That detail is not on the list any more.' };
      else {
        out = cards.setChecked(rowId, item.key, by(req));
        if (!out.error) { cards.addNote(rowId, { kind: 'note', text: `Checked and correct: ${item.text}` }, by(req)); note(req, [`${who}: checked and correct: ${item.text}`]); out = { ...out, card: cards.get(rowId) }; }
      }
    } else if (part === 'profile') {
      // Edit profile (the student card, 21 Nov 2026) asks for "markSaved": the server then records who saved and when. Nobody types those.
      const input = { ...body };
      delete input.savedAt; delete input.savedBy;
      if (body.markSaved) { input.savedAt = new Date().toISOString(); input.savedBy = String(by(req) || '').slice(0, 80); }
      out = cards.setProfile(rowId, input, by(req));
      if (!out.error) {
        const changed = Fields.PROFILE_FIELDS.filter((f) => f.key !== 'savedAt' && f.key !== 'savedBy' && (card.profile[f.key] || '') !== (out.card.profile[f.key] || ''))
          .map((f) => `${who} › ${f.label}: "${card.profile[f.key] || '(blank)'}" → "${out.card.profile[f.key] || '(blank)'}"`);
        if (changed.length) note(req, changed);
        // And in the student's own notes (the owner, 22 Nov 2026).
        noteCardChanges(req, rowId, Fields.PROFILE_FIELDS.filter((f) => !['savedAt', 'savedBy', 'leadContact', 'fromList'].includes(f.key)).map((f) => [f.label, card.profile[f.key], out.card.profile[f.key]]), body.undo === true);
      }
    } else if (part === 'notes' && sub && del) {
      out = cards.removeNote(rowId, sub, by(req), Teams.isAdmin(req.user));
      if (!out.error) note(req, [`${who}: removed a note`]);
    } else if (part === 'notes' && !sub) {
      // A note may carry the next follow-up date (Events and marketing asks for it).
      const next = text(body.next);
      if (next && (!realDay(next) || next <= cards.today())) { sendJSON(res, 400, { error: 'The next follow-up date is after today.' }); return true; } // a real day ("2099-99-99" is not)
      // The stage lines and "no answer" lines are written by Vishnu itself: a person's note is always a note.
      out = cards.addNote(rowId, { text: body.text, kind: ['stage', 'try'].includes(text(body.kind)) ? 'note' : body.kind }, by(req));
      if (!out.error && next) cards.setFollow(rowId, { next: { date: next, by: by(req), at: out.note.at } }, by(req));
      if (!out.error) note(req, [`${who}: added a note${next ? `, next follow-up ${niceDay(next)}` : ''}`]);
    } else if (part === 'sheet') {
      const changes = {};
      for (const [col, clean] of Object.entries(CARD_EDITABLE)) {
        if (body.fields && Object.prototype.hasOwnProperty.call(body.fields, col)) {
          let v = clean(body.fields[col]);
          // Undo puts back exactly what was there, also a value kept in an older form ("17/07/2026", an older NOC word), but only the
          // value this server itself replaced a moment ago (replacedOn): Undo is never a way round the checks.
          if (v === null && body.undo === true && wasReplaced(rowId, col, body.fields[col])) v = text(body.fields[col]);
          if (v === null) { sendJSON(res, 400, { error: col === 'CONTACT NUMBER' ? 'That phone number does not look right. Use digits, for example 9800000001.' : `${col} is not a real date.` }); return true; }
          if (v !== text(found.row[col])) changes[col] = v;
        }
      }
      // What the name would be after this save: a student keeps at least one of the two names.
      if (('FIRST NAME' in changes || 'LAST NAME' in changes) && !text('FIRST NAME' in changes ? changes['FIRST NAME'] : found.row['FIRST NAME']) && !text('LAST NAME' in changes ? changes['LAST NAME'] : found.row['LAST NAME'])) { sendJSON(res, 400, { error: 'A student needs a name.' }); return true; }
      const sub = 'APPLICATION SUBMISSION DATE' in changes ? changes['APPLICATION SUBMISSION DATE'] : realDay(found.row['APPLICATION SUBMISSION DATE']) || '';
      const off = 'OFFER RECEIVED DATE' in changes ? changes['OFFER RECEIVED DATE'] : realDay(found.row['OFFER RECEIVED DATE']) || '';
      if (sub && off && off < sub && ('APPLICATION SUBMISSION DATE' in changes || 'OFFER RECEIVED DATE' in changes)) { sendJSON(res, 400, { error: 'The offer cannot be received before the application was submitted.' }); return true; }
      if (changes.EMAIL && !mailer.isAddress(changes.EMAIL)) { sendJSON(res, 400, { error: 'That email address does not look right.' }); return true; }
      // A new Priority University: the university named before keeps its own application and offer days, so they never move to the
      // new one (the owner, 21 Nov 2026).
      if ('UNIVERSITY NAME' in changes) {
        const oldUni = text(found.row['UNIVERSITY NAME']); const oldCourse = text(found.row['COURSE NAME']);
        const a0 = isoDate(found.row['APPLICATION SUBMISSION DATE']) || ''; const o0 = isoDate(found.row['OFFER RECEIVED DATE']) || '';
        if (oldUni && (a0 || o0) && squash(oldUni) !== squash(changes['UNIVERSITY NAME'])) {
          const opts = card.options || [];
          if (!opts.some((o) => o.applied || o.offer)) { // a legacy student: the days are the old university's
            const own = opts.find((o) => squash(o.university) === squash(oldUni) && (!oldCourse || !o.course || squash(o.course) === squash(oldCourse))) || opts.find((o) => squash(o.university) === squash(oldUni));
            if (!own) cards.addOption(rowId, { university: oldUni, course: oldCourse, applied: a0, offer: o0, note: 'From All Students', ...(text(found.row['UNIVERSITY PARTNER']) ? { partner: text(found.row['UNIVERSITY PARTNER']) } : {}) }, 'Vishnu');
            else cards.updateOption(rowId, own.id, { ...(a0 && !own.applied ? { applied: a0 } : {}), ...(o0 && !own.offer && !own.refused && !own.withdrawn ? { offer: o0 } : {}) }, 'Vishnu');
          }
        }
      }
      // The day the medical test is booked (the Application details card, the owner, 22 Nov 2026): kept with the card's medical booking.
      const medWas = (card.medical && card.medical.date) || '';
      let medNow = null;
      if (body.fields && Object.prototype.hasOwnProperty.call(body.fields, 'MEDICAL BOOKING DATE')) {
        const d = realDay(body.fields['MEDICAL BOOKING DATE']);
        if (d === null) { sendJSON(res, 400, { error: 'MEDICAL BOOKING DATE is not a real date.' }); return true; }
        if (d !== medWas) {
          if (!Teams.canEdit(req.user, 'MEDICAL REPORT', found.row)) { sendJSON(res, 403, { error: 'The medical booking cannot be changed from your account.' }); return true; }
          medNow = d;
        }
      }
      let changesOut = Object.keys(changes);
      const pairs = [];
      const replaced = {}; // what this save replaced, as the server had it: the card's Undo puts back exactly this
      if (changesOut.length) {
        const all = withPartner(rowId, changes, found.row['UNIVERSITY PARTNER']);
        // Undo of a new university puts its University partner back exactly as it was (also one typed by hand).
        if (body.undo === true && 'UNIVERSITY NAME' in all) { const x = (replacedOn.get(rowId) || {})['UNIVERSITY PARTNER']; if (x && Date.now() - x.at < 600000) all['UNIVERSITY PARTNER'] = x.value; }
        if (text(all['UNIVERSITY PARTNER']) === text(found.row['UNIVERSITY PARTNER'])) delete all['UNIVERSITY PARTNER'];
        const before = Object.fromEntries(Object.keys(all).map((col) => [col, text(found.row[col])]));
        const done = setColumns(req, found, all);
        if (done.error) { sendJSON(res, done.status, { error: done.error }); return true; }
        if (body.undo !== true) remember(rowId, before);
        Object.assign(replaced, before);
        changesOut = Object.keys(all);
        pairs.push(...changesOut.map((col) => [Fields.columnLabel(col), before[col], all[col]]));
      }
      if (medNow !== null) {
        cards.setMedical(rowId, medNow ? { ...(card.medical || {}), date: medNow } : null, by(req));
        pairs.push(['Medical booking date', medWas, medNow]);
        changesOut.push('MEDICAL BOOKING DATE');
        replaced['MEDICAL BOOKING DATE'] = medWas;
      }
      noteCardChanges(req, rowId, pairs, body.undo === true); // one note for the whole save
      sendJSON(res, 200, { ok: true, changed: changesOut, replaced });
      return true;
    } else if (part === 'source') {
      const was = text(found.row['STUDENT SOURCE']);
      const done = setSource(req, found, text(body.source).slice(0, 60));
      if (done.error) { sendJSON(res, done.status, { error: done.error }); return true; }
      noteCardChanges(req, rowId, [['Student Source', was, done.source]], body.undo === true);
      sendJSON(res, 200, { ok: true, source: done.source, card });
      return true;
    } else if (part === 'options' && sub === 'send') {
      // The shortlist to the Application Team in one go (the owner, 17 Nov 2026): the courses chosen, in the order given (1, 2, 3 ...),
      // as one task, each option marked with the day it was sent and its place in the order.
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(text).filter(Boolean).slice(0, 30);
      const chosen = ids.map((oid) => (card.options || []).find((o) => o.id === oid)).filter(Boolean);
      if (!chosen.length) { sendJSON(res, 400, { error: 'Choose at least one course first.' }); return true; }
      // A course already with the Application Team and not answered yet is never given a second time (a double press or two open pages
      // made two Apply tasks, and the first lost its course).
      const already = chosen.filter((o) => assignedOf(card).some((a) => a.id === o.id) && (card.tasks || []).some((t) => t.id === o.taskId && !t.done));
      if (already.length) { sendJSON(res, 400, { error: `${already.map((o) => o.university || o.course).join(', ')} ${already.length === 1 ? 'is' : 'are'} already with the Application Team.` }); return true; }
      // Through which partner each one goes (Direct or a B2B partner): asked every time, nothing goes to the team without it.
      const partners = body.partners && typeof body.partners === 'object' ? body.partners : {};
      const via = (o) => text(partners[o.id] || o.partner).replace(/\s+/g, ' ').slice(0, 120);
      const without = chosen.filter((o) => !via(o));
      if (without.length) { sendJSON(res, 400, { error: `Choose the partner for ${without.map((o) => o.university || o.course).join(', ')} first.` }); return true; }
      const through = (o) => (/^direct$/i.test(via(o)) ? 'direct' : `through ${via(o)}`);
      // One Apply task for each course (the owner, 18 Nov 2026): the team ticks each university on its own, with its own day, and each task
      // is linked to its course.
      const words = text(body.note).slice(0, 1500);
      const today = localDate();
      const made = [];
      for (const [n, o] of chosen.entries()) {
        const label = `${o.university}${o.course ? ` (${o.course})` : ''}`;
        // The task carries what to apply for (university, course, level, intake), so Today shows it and Mark as done asks for that one course.
        const t = cards.addTask(rowId, { team: 'application', text: `Apply to ${label} for ${who}`, tag: 'application', priority: 'high', app: { university: o.university, universityId: o.universityId || '', course: o.course || '', level: o.level || '', intake: o.intake || '' } }, by(req));
        if (t.error) { sendJSON(res, 400, { error: t.error }); return true; }
        cards.commentTask(rowId, t.task.id, [`${n + 1}. ${[o.course, o.university].filter(Boolean).join(' at ')}${o.intake ? ` (${o.intake})` : ''}, ${through(o)}`, words].filter(Boolean).join('\n\n'), by(req));
        // A course that was answered before and is given again starts with no answer, so it is asked about again.
        cards.updateOption(rowId, o.id, { sent: today, rank: String(n + 1), partner: via(o), taskId: t.task.id, skipped: '', refused: '', withdrawn: '', reason: '' }, by(req));
        made.push(t.task.id);
      }
      activity.record(req, req.user, 'Task', { app: 'Student card', changes: [`Sent ${chosen.length} course${chosen.length === 1 ? '' : 's'} of ${who} to the Application Team (one task for each)`] });
      // Courses assigned to the Application Team move an inquiry (or a deferred student) to Application Stage by themselves (the owner,
      // 21 Nov 2026), so the Application Team has the student in its list at once. The timeline says so (stage-log.js), and a student
      // the Follow-up Team sent on stays in its list, view only.
      const stageNow = text((rowIndex().get(rowId) || found).row[STATUS]);
      if (['Inquiry', 'Defer', ''].includes(stageNow)) {
        try { writeColumnsFor(req, rowId, { [STATUS]: 'Application Stage' }); } catch (e) { console.error('[assign stage]', e); }
      }
      sendJSON(res, 200, { ok: true, card: cards.get(rowId) });
      return true;
    } else if (part === 'options' && sub && del) {
      const gone = (card.options || []).find((o) => o.id === sub);
      if (gone && (gone.applied || gone.offer) && !Teams.isAdmin(req.user)) { sendJSON(res, 400, { error: 'This university has an application or offer recorded: change it with Update (for example refused or withdrawn) instead of removing it.' }); return true; }
      if (gone && assignedOf(card).some((a) => a.id === sub) && !Teams.isAdmin(req.user)) { sendJSON(res, 400, { error: 'This course was given to the team and has no answer yet: answer it (applied, offer, refused, withdrawn or not submitted) instead of removing it.' }); return true; }
      out = cards.removeOption(rowId, sub, by(req));
      if (!out.error && gone) note(req, [`${who}: removed the option ${[gone.university, gone.course].filter(Boolean).join(', ')}`]);
    } else if (part === 'options' && sub) {
      const before = (card.options || []).find((o) => o.id === sub) || null;
      // A refusal, a withdrawal or "not submitted" says why, and a course given to the team is not taken back by the team (needed to track
      // the student, the owner, 18 Nov 2026).
      if (before) {
        const newly = ['refused', 'withdrawn', 'skipped'].find((k) => text(body[k]) && !before[k]);
        if (newly && text(body.reason || before.reason).length < MIN_NOTE) { sendJSON(res, 400, { error: 'Say why, in a few words, for a refusal, a withdrawal or a course not submitted.' }); return true; }
        if (before.sent && body.sent !== undefined && !text(body.sent) && assignedOf(card).some((a) => a.id === sub) && !Teams.isAdmin(req.user)) { sendJSON(res, 400, { error: 'This course was given to the team and has no answer yet: answer it instead of taking it back.' }); return true; }
      }
      out = cards.updateOption(rowId, sub, body, by(req));
      if (!out.error && before) {
        const after = (cards.get(rowId).options || []).find((o) => o.id === sub) || {};
        const changed = Object.keys(after).filter((k) => !['updatedAt', 'updatedBy', 'at', 'by'].includes(k) && JSON.stringify(after[k] ?? '') !== JSON.stringify(before[k] ?? ''));
        if (changed.length) note(req, [`${who}: changed the option ${[before.university, before.course].filter(Boolean).join(', ')} (${changed.join(', ')})`]);
      }
      // What the Application Team records on the card (the day submitted, the answer) is also a note, so the student's timeline shows
      // every step day by day (the owner, 17 Nov 2026).
      if (!out.error && before) { const after = (cards.get(rowId).options || []).find((o) => o.id === sub); const line = applicationNote(before, after); if (line) cards.addNote(rowId, { kind: 'note', text: line }, by(req)); out = { ...out, card: cards.get(rowId) }; }
    } else if (part === 'options') {
      // The fee, scholarship, deposit and course page come from Universities by themselves (nobody types them).
      const auto = factsForOption({ universityId: text(body.universityId), course: text(body.course), level: text(body.level) });
      out = cards.addOption(rowId, { ...body, fee: text(body.fee) || auto.fee || '', scholarship: text(body.scholarship) || auto.scholarship || '', deposit: text(body.deposit) || auto.deposit || '', link: text(body.link) || auto.link || '' }, by(req));
      if (!out.error) note(req, [`${who}: added the option ${[out.option.university, out.option.course].filter(Boolean).join(', ')}`]);
      if (!out.error) { const line = applicationNote({}, out.option); if (line) cards.addNote(rowId, { kind: 'note', text: line }, by(req)); }
    } else {
      send(res, 404, 'Not found');
      return true;
    }
    if (!out.error && part === 'options') syncApplicationDays(req, rowId);
    if (out.error) sendJSON(res, out.duplicate ? 409 : 400, { error: out.error });
    else sendJSON(res, 200, { ok: true, card: part === 'options' ? cards.get(rowId) : out.card, ...(out.note ? { note: out.note } : {}), ...(out.option ? { option: out.option } : {}) });
    return true;
  }

  // ---- adding a student from the card form ----
  // The student goes on the sheet exactly as if the row had been typed there: Admin chooses the intake and the stage; a
  // team's student goes to the current intake at the team's own stage, with only what the team may fill in (teamSave
  // checks it with the same rules as a save from the sheet). The card details are kept with the new student.
  // Adds one student (the sheet row and the card) with the rules of the sheet. Returns { status, json }.
  function addStudent(req, body) {
    const wb = getWorkbook();
    if (!wb) { return { status: 500, json: { error: 'Could not read the data file' } }; }
    if (Teams.isReadOnly(req.user)) { return { status: 403, json: { error: 'Your account can only view students.' } }; }
    const given = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const fields = {};
    NEW_STUDENT_COLUMNS.forEach((col) => {
      const v = typeof given[col] === 'string' ? given[col].replace(/\s+/g, ' ').trim().slice(0, col === 'REMARKS' ? MAX_CELL_CHARS : 300) : '';
      if (v) fields[col] = col === 'EMAIL' ? v.toLowerCase() : v;
    });
    if (!fields['FIRST NAME'] && !fields['LAST NAME']) { return { status: 400, json: { error: "Please enter the student's name." } }; }
    if (fields.EMAIL && !mailer.isAddress(fields.EMAIL)) { return { status: 400, json: { error: 'That email address does not look right.' } }; }
    if (fields['CONTACT NUMBER'] && !phoneOk(fields['CONTACT NUMBER'])) { return { status: 400, json: { error: 'That phone number does not look right. Use digits, for example 9800000001 or +977 9800000001.' } }; }
    {
      let dup = existingStudent(fields.EMAIL, fields['CONTACT NUMBER']);
      // Added with a name only (no email, no usable phone): the same full name already on the sheet is checked by a person, never merged.
      let sameName = false;
      if (!dup && !fields.EMAIL && !phoneKey(fields['CONTACT NUMBER'])) {
        const key = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const want = key(nameOf(fields));
        if (want) for (const { row } of rowIndex().values()) { if (key(nameOf(row)) === want) { dup = row; sameName = true; break; } }
      }
      // Only the same phone, and a clearly different first name: maybe a brother or sister on the family phone. Once the person says
      // it is someone else ("Add anyway"), they are added. The same email is always the same student.
      const sameEmail = Boolean(dup && fields.EMAIL && text(dup.EMAIL).toLowerCase() === fields.EMAIL);
      const maybeOther = Boolean(dup && (sameName || (!sameEmail && otherPerson([fields['FIRST NAME'], fields['LAST NAME']].join(' '), nameOf(dup)))));
      if (dup && !(body.allowDuplicate && maybeOther)) {
        // The student is already in Vishnu: nobody is added twice. Someone who may see that student is told who it is, and can fill in
        // what is missing on them instead (see /api/students/merge).
        const found = rowIndex().get(dup._id);
        const seen = found && canSee(req.user, found);
        return { status: 409, json: {
          error: sameName ? `${(seen && nameOf(dup)) || 'A student'} with this exact name is already in Vishnu. If this is a different person, add them anyway.` : maybeOther ? `${(seen && nameOf(dup)) || 'A student'} is already in Vishnu with this phone number, under another name. If this is a different person, add them anyway.` : `${(seen && nameOf(dup)) || 'A student'} is already in Vishnu with this email or phone number, so nobody was added.`,
          duplicate: seen ? { id: dup._id, name: nameOf(dup), intake: found.sheet.name, stage: text(dup[STATUS]), source: text(dup['STUDENT SOURCE']), canFill: canChange(req.user, found), maybeOther, sameName } : (maybeOther ? { maybeOther, sameName } : null),
        } };
      }
    }
    const rowId = 'row-' + Date.now().toString(36) + require('crypto').randomBytes(4).toString('hex');
    let sheet;
    if (Teams.isAdmin(req.user)) {
      // The sheet the person is on: the student goes into that intake.
      sheet = wb.sheets.find((s) => s.id === body.sheetId) || currentIntake() || wb.sheets[0];
      const stage = Teams.ALL_STATUSES.includes(text(body.stage)) ? text(body.stage) : 'Inquiry';
      const row = { _id: rowId };
      sheet.columns.forEach((c) => { row[c] = ''; });
      Object.keys(fields).forEach((c) => { if (sheet.columns.includes(c)) row[c] = fields[c]; });
      if (sheet.columns.includes(STATUS)) row[STATUS] = stage;
      const next = { ...wb, revision: wb.revision + 1, sheets: wb.sheets.map((s) => (s.id === sheet.id ? { ...s, rows: [...s.rows, row] } : s)) };
      try { writeWorkbook(next, req.user && req.user.id); } catch (e) { console.error('[new student]', e); return { status: 500, json: { error: 'save failed' } }; }
      recordChanges(req, wb, next);
    } else {
      const depts = Teams.addableDepartments(req.user);
      const dept = depts.includes(body.dept) ? body.dept : (depts.length === 1 ? depts[0] : null);
      if (!dept) { return { status: 400, json: { error: 'Choose which team the new student is for.' } }; }
      const view = Teams.viewFor(req.user, wb);
      sheet = currentIntake();
      const mine = view.sheets.find((s) => sheet && s.id === sheet.id);
      if (!mine) { return { status: 409, json: { error: 'There is no current intake to add the student to.' } }; }
      // Only what this team may fill in on a student it adds; anything else typed in the form is left out, not refused.
      const stub = { _id: rowId, [STATUS]: Teams.DEPARTMENTS[dept].start, _addedByTeam: dept };
      const row = { ...stub };
      Object.keys(fields).forEach((c) => { if (mine.columns.includes(c) && Teams.canEdit(req.user, c, stub)) row[c] = fields[c]; });
      const out = teamSave(req, { baseRevision: wb.revision, sheets: view.sheets.map((s) => (s.id === mine.id ? { ...s, rows: [...s.rows, row] } : s)) }, { checked: true });
      if (out.status !== 200) { return { status: out.status, json: out.body.error === 'conflict' ? { error: 'The sheet changed at the same moment. Please try again.' } : out.body }; }
    }
    // The card: where the student came from and the rest of what the form asked.
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
    // The first inquiry day is the day the student is added, unless the list it came from says when they enquired. A lead list can
    // also say the level of study the student asked about.
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(text(profile.inquiryDate)) && text(profile.inquiryDate) <= cards.today() ? text(profile.inquiryDate) : cards.today();
    const saved = cards.setProfile(rowId, { sourceDetail: profile.sourceDetail, sourceRemarks: profile.sourceRemarks || '', inquiryDate: asked, ...(asked === text(profile.inquiryDate) && /^\d{1,2}:\d{2} (am|pm)$/.test(text(profile.inquiryTime)) ? { inquiryTime: text(profile.inquiryTime) } : {}), ...(Fields.STUDY_LEVELS.includes(profile.studyLevel) ? { studyLevel: profile.studyLevel } : {}), ...(Fields.DISTRICTS.includes(profile.livesIn) ? { livesIn: profile.livesIn } : {}), ...(/^[a-f0-9]{12}$/.test(text(profile.fromList)) ? { fromList: text(profile.fromList) } : {}),
      // From the passport, and how a Social Media student came (cleanProfile keeps only what is valid).
      ...Object.fromEntries(['dob', 'passportNo', 'address', 'nationality', 'sourcePlatform', 'sourceWay'].filter((k) => text(profile[k]) && !(k === 'dob' && text(profile[k]) > cards.today())).map((k) => [k, text(profile[k])])) }, by(req));
    if (!saved.error && text(body.note)) cards.addNote(rowId, { text: body.note, kind: 'note' }, by(req));
    return { status: 200, json: { ok: true, id: rowId, sheetId: sheet.id, revision: getWorkbook().revision } };
  }

  // A student already in Vishnu, with what was typed for them again (Add student found them by email or phone): only what is blank on
  // them is filled in, never what is already there (the email an application went out with stays). The source is tagged if none was
  // recorded. Anything that differs (another email or phone) is kept in a note on the card, so nothing is lost and nothing is replaced.
  async function handleMerge(req, res) {
    const body = await bodyOf(req, res);
    if (!body) return true;
    const found = rowIndex().get(text(body.id));
    if (!found || !canSee(req.user, found)) { sendJSON(res, 404, { error: 'No such student.' }); return true; }
    if (!canChange(req.user, found)) { sendJSON(res, 403, { error: 'Your account cannot change this student.' }); return true; }
    const given = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const row = found.row;
    const fill = {}; const differs = [];
    ['FIRST NAME', 'LAST NAME', 'EMAIL', 'CONTACT NUMBER'].forEach((col) => {
      const v = text(given[col]).slice(0, 240); if (!v) return;
      const now = text(row[col]);
      const label = Fields.columnLabel ? Fields.columnLabel(col) : col;
      if (!now) {
        // Blank on the sheet: filled in when this account may edit it; otherwise kept in the note, never thrown away.
        if (Teams.canEdit(req.user, col, row) && CARD_EDITABLE[col] && CARD_EDITABLE[col](v) !== null) fill[col] = CARD_EDITABLE[col](v);
        else differs.push(`${label}: ${v}`);
      } else if (now.toLowerCase() !== v.toLowerCase() && !(col === 'CONTACT NUMBER' && phoneKey(now) === phoneKey(v))) differs.push(`${label}: ${v}`);
    });
    // Only one of the real sources is kept (as on the card's own source box); anything else is left out.
    const rawSource = text(given['STUDENT SOURCE']);
    const source = rawSource && (Fields.STORED_SOURCES.includes(rawSource) || Fields.isBranchValue(rawSource)) ? rawSource : '';
    const sourceSet = Boolean(source && !text(row['STUDENT SOURCE']) && Teams.canEdit(req.user, 'STUDENT SOURCE', row));
    if (source && !sourceSet && text(row['STUDENT SOURCE']) && text(row['STUDENT SOURCE']) !== source) differs.push(`Student source: ${source}`);
    if (sourceSet) fill['STUDENT SOURCE'] = source;
    if (Object.keys(fill).length) { const out = setColumns(req, found, fill); if (out.error) { sendJSON(res, out.status || 400, { error: out.error }); return true; } }
    const card = cards.get(row._id);
    const given2 = body.profile && typeof body.profile === 'object' ? body.profile : {};
    // Only the keys the form has, and the where-from details only when the source on the sheet is the one just set (or already the same one).
    const SOURCE_KEYS = ['sourceDetail', 'sourceRemarks', 'sourcePlatform', 'sourceWay'];
    const sourceAgrees = sourceSet || (source && text(row['STUDENT SOURCE']) === source);
    const blanks = {};
    ['dob', 'passportNo', 'address', 'nationality', ...SOURCE_KEYS].forEach((k) => {
      const v = text(given2[k]); if (!v) return;
      if (SOURCE_KEYS.includes(k)) { if (sourceAgrees && !text(card.profile[k])) blanks[k] = v; return; }
      if (!text(card.profile[k])) blanks[k] = v;
      else if (text(card.profile[k]).toLowerCase() !== v.toLowerCase()) differs.push(`${k === 'dob' ? 'Date of birth' : k === 'passportNo' ? 'Passport number' : k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`);
    });
    if (Object.keys(blanks).length) cards.setProfile(row._id, blanks, by(req));
    const lines = [differs.length ? `Added again by ${req.user.name}, with different details (the ones above are kept): ${differs.join('; ')}.` : '', text(body.note)].filter(Boolean);
    if (lines.length) cards.addNote(row._id, { kind: 'note', text: lines.join(' ').slice(0, 4000) }, by(req));
    note(req, [`${nameOf(row) || 'a student'}: added again, filled in ${Object.keys(fill).length + Object.keys(blanks).length} missing detail(s) instead of a duplicate`], 'Filled in a student');
    sendJSON(res, 200, { ok: true, id: row._id, filled: [...Object.keys(fill), ...Object.keys(blanks)], differs });
    return true;
  }

  async function handleNewStudent(req, res) {
    const body = await bodyOf(req, res);
    if (!body) return true;
    // The Add student form (strict) also needs a WhatsApp number and where the student came from (a branch account is tagged with its branch).
    if (body.strict === true) {
      const given = body.fields && typeof body.fields === 'object' ? body.fields : {};
      const branchOnly = !Teams.isAdmin(req.user) && Teams.addableDepartments(req.user).length > 0 && Teams.addableDepartments(req.user).every((d) => Teams.DEPARTMENTS[d].source);
      if (!text(given['CONTACT NUMBER'])) { sendJSON(res, 400, { error: "Please enter the student's WhatsApp number." }); return true; }
      if (!branchOnly && !text(given['STUDENT SOURCE'])) { sendJSON(res, 400, { error: 'Choose where the student came from.' }); return true; }
    }
    const out = addStudent(req, body);
    sendJSON(res, out.status, out.json);
    return true;
  }

  // Many students at once, all with the same stage, source and event or marketing tag: one line each (name, email, phone).
  async function handleBulkStudents(req, res) {
    if (Teams.isReadOnly(req.user)) { sendJSON(res, 403, { error: 'Your account can only view students.' }); return true; }
    const body = await bodyOf(req, res, 1024 * 1024);
    if (!body) return true;
    const lines = (Array.isArray(body.rows) ? body.rows : []).filter((r) => r && typeof r === 'object').slice(0, 200);
    if (!lines.length) { sendJSON(res, 400, { error: 'Add at least one student.' }); return true; }
    const results = [];
    const existing = new Set();
    for (const { row } of visibleStudents(req.user)) {
      const em = text(row.EMAIL).toLowerCase(); const ph = phoneKey(row['CONTACT NUMBER']);
      if (em) existing.add('e:' + em);
      if (ph) existing.add('p:' + ph);
    }
    for (const r of lines) {
      const em = text(r.email).toLowerCase(); const ph = phoneKey(r.phone);
      if (existingStudent(r.email, r.phone) || (em && existing.has('e:' + em)) || (ph && existing.has('p:' + ph))) { results.push({ ok: false, name: [r.first, r.last].filter(Boolean).join(' '), error: 'Already on the sheet (same email or phone), not added again.' }); continue; }
      const fields = { 'FIRST NAME': text(r.first), 'LAST NAME': text(r.last), EMAIL: text(r.email), 'CONTACT NUMBER': text(r.phone), 'STUDENT SOURCE': text(body.source) };
      const out = addStudent(req, { fields, profile: { sourceDetail: text(body.sourceDetail), sourceRemarks: text(body.sourceRemarks), sourcePlatform: text(body.sourcePlatform), sourceWay: text(body.sourceWay) }, stage: body.stage, sheetId: body.sheetId, dept: body.dept });
      if (out.status === 200) { if (em) existing.add('e:' + em); if (ph) existing.add('p:' + ph); } // only a line that was added blocks a later copy of it
      results.push(out.status === 200 ? { ok: true, id: out.json.id, name: [r.first, r.last].filter(Boolean).join(' ') } : { ok: false, name: [r.first, r.last].filter(Boolean).join(' '), error: out.json.error || 'Could not add.' });
    }
    note(req, [`Added ${results.filter((x) => x.ok).length} students at once${text(body.sourceDetail) ? ` (${text(body.sourceDetail)})` : ''}`], 'Added students');
    sendJSON(res, 200, { results });
    return true;
  }

  // ---- the students of an event or a campaign, uploaded by Admin from its list (Excel or CSV) ----
  // The list Admin uploads is the truth of who came from it, whatever was picked when the student was added. Each line is:
  //   new: added to the chosen intake at Inquiry, Student Source "Events", tagged with the event;
  //   link: already on the sheet (same phone or email, any intake) and in no event yet: tagged with this event, the earlier source is
  //         kept in the remarks and a note says so on the card (the team may have added the student before the campaign was entered);
  //   update: already in Vishnu, and the list knows more (an inquiry day or time, an email, comments ...): what is new is added (newsFor);
  //   already: already tagged with this event and nothing new (uploading the same list twice changes nothing);
  //   other: already tagged with another event, nothing new: left as it is and listed, so Admin decides on the card (never moved);
  //   problem: no name, or neither a phone nor an email (a student who cannot be matched later is not added).
  // { preview: true } only sorts the lines; without it the new and link lines are carried out.
  const digitsOf = (v) => text(v).replace(/\D/g, '');
  // What a line of a list adds to a student already in Vishnu (the owner, 14 Nov 2026: the more we know, the better, and an updated list
  // must never be stopped because the student is already there). Only what is new is taken, and nothing on the sheet is replaced:
  //   a blank email or phone is filled in; a different one is kept in a note (an application may have gone out with the old one);
  //   the first inquiry day is the earliest one known, so an earlier day from the list replaces a later one (a student added before
  //   the list had its days got the day they were added);
  //   a blank study level is filled in;
  //   every other column of the list (the time of the inquiry, comments, the intake asked for ...) goes into a note, only the parts the
  //   card's notes do not already say.
  function newsFor(x, row, card) {
    const p = (card && card.profile) || {};
    const fill = {}; const profile = {}; const differs = []; const says = [];
    if (x.email) { const now = text(row.EMAIL).toLowerCase(); if (!now && mailer.isAddress(x.email)) { fill.EMAIL = x.email; says.push('email'); } else if (now && now !== x.email) differs.push(`email ${x.email}`); }
    if (x.phone) { const now = text(row['CONTACT NUMBER']); if (!now && phoneOk(x.phone)) { fill['CONTACT NUMBER'] = x.phone; says.push('phone'); } else if (now && phoneKey(now) !== phoneKey(x.phone)) differs.push(`phone ${x.phone}`); }
    if (x.inquiryDate && x.inquiryDate <= cards.today() && (!p.inquiryDate || x.inquiryDate < p.inquiryDate)) { profile.inquiryDate = x.inquiryDate; profile.inquiryTime = x.inquiryTime || ''; says.push(x.inquiryTime ? 'inquiry day and time' : 'inquiry day'); }
    else if (x.inquiryTime && x.inquiryDate && x.inquiryDate === p.inquiryDate && !p.inquiryTime) { profile.inquiryTime = x.inquiryTime; says.push('inquiry time'); }
    if (x.level && !p.studyLevel) { profile.studyLevel = x.level; says.push('study level'); }
    if (x.livesIn && !p.livesIn && Fields.DISTRICTS.includes(x.livesIn)) profile.livesIn = x.livesIn;
    // An earlier list's note that copied every column (the inquiry number, the time, an inbox link; before 14 Nov 2026) is tidied away:
    // what it said that matters is on the card itself now. It is not counted as known, so nothing worth keeping is lost.
    const untidy = ((card && card.notes) || []).filter((n) => /^From the updated list of /.test(String(n.text || '')));
    const known = ((card && card.notes) || []).filter((n) => !untidy.includes(n)).map((n) => String(n.text || '').toLowerCase()).join(' \n ');
    const fresh = text(x.extra).split(/\.\s+/).map((part) => part.replace(/\.$/, '').trim()).filter((part) => part && !/^enquired /i.test(part) && !known.includes(part.toLowerCase()));
    if (fresh.length) says.push('more details in a note');
    if (untidy.length) says.push('a tidier note in place of the earlier list\'s');
    if (differs.length) says.push('a different ' + differs.map((d) => d.split(' ')[0]).join(' and '));
    return { fill, profile, differs, extra: fresh.join('. '), says, untidy: untidy.map((n) => n.id) };
  }
  // Puts what newsFor found on the student: the sheet, the card, and one note saying what came from which list.
  function applyNews(req, x, news, ev, intro) {
    const found = rowIndex().get(x.id);
    if (!found) return { error: 'not found' };
    if (Object.keys(news.fill).length) { const r = setColumns(req, found, news.fill); if (r.error) return r; }
    if (Object.keys(news.profile).length) cards.setProfile(x.id, news.profile, by(req));
    (news.untidy || []).forEach((noteId) => cards.removeNote(x.id, noteId, by(req), true));
    const words = [intro, news.differs.length ? `The list also gave ${news.differs.join(' and ')} (the ones on the sheet are kept).` : '', news.extra ? `${news.extra}.` : ''].filter(Boolean).join(' ');
    if (words && (intro || news.differs.length || news.extra)) cards.addNote(x.id, { kind: 'note', text: words }, by(req));
    return {};
  }
  function eventImport(req, ev, body) {
    const plan = planning.all();
    const label = eventLabel(ev.name, ev.date);
    const all = cards.all();
    // Every student in Vishnu by phone (its last 10 digits) and by email, all of them (two students can share one by mistake).
    const byPhone = new Map(); const byEmail = new Map();
    const put = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    for (const { sheet, row } of rowIndex().values()) {
      if (!isStudent(row)) continue;
      const d = digitsOf(row['CONTACT NUMBER']); const em = text(row.EMAIL).toLowerCase();
      if (d.length >= 7) put(byPhone, d.slice(-10), { sheet, row });
      if (em) put(byEmail, em, { sheet, row });
    }
    // Students who came from a list and were later removed from the sheet (deleted there on purpose, or by mistake): their card stays,
    // with the phone and email the list gave (leadContact). They are never brought back by a list on their own.
    const removed = new Map();
    Object.entries(all).forEach(([rowId, card]) => {
      const lc = card && card.profile && card.profile.leadContact;
      if (!lc || rowIndex().has(rowId)) return;
      const [ph, em, nm] = String(lc).split('|');
      const info = { id: rowId, name: nm || 'a student', tag: card.profile.sourceDetail || '' };
      if (ph) removed.set('p' + ph, info);
      if (em) removed.set('e' + em, info);
    });
    const seen = new Map(); // a phone or email already met in this file -> its line
    const out = [];
    const pending = [];
    const lines = (Array.isArray(body.rows) ? body.rows : []).filter((r) => r && typeof r === 'object').slice(0, 1000);
    // The intake a lead asked for ("January 2027") is the intake tab with that month and year ("Jan Intake 2027"), if this account has
    // one; otherwise (or "Later in 2027") the intake chosen on the page.
    const wbNow = getWorkbook();
    const tabs = wbNow ? Teams.viewFor(req.user, wbNow).sheets : [];
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const intakeFor = (asked) => {
      const a = text(asked).toLowerCase();
      const mon = MONTHS.find((m) => new RegExp(`\\b${m}`).test(a));
      const year = (a.match(/\b20\d\d\b/) || [])[0];
      if (!mon || !year) return null;
      return tabs.find((sh) => { const n = sh.name.toLowerCase(); return new RegExp(`\\b${mon}`).test(n) && n.includes(year); }) || null;
    };
    const chosen = tabs.find((sh) => sh.id === body.sheetId);
    for (const r of lines) {
      // Names as people write them in a form are tidied: stray symbols at the start or end go, and each word gets a capital.
      const tidy = (v) => text(v).replace(/^[^\p{L}]+|[^\p{L}.']+$/gu, '').replace(/\s+/g, ' ').replace(/(^|[\s'-])(\p{Ll})/gu, (m0, sp, ch) => sp + ch.toUpperCase()).slice(0, 80);
      const first = tidy(r.first); const last = tidy(r.last);
      const email = text(r.email).toLowerCase().slice(0, 120);
      // A Nepal number is kept as people dial it here (98XXXXXXXX); a number from another country keeps its country code.
      const rawPhone = text(r.phone).replace(/[^\d+]/g, '');
      const phone = (/^\+?977(9\d{9})$/.test(rawPhone) ? rawPhone.replace(/^\+?977/, '') : rawPhone).slice(0, 40);
      const name = [first, last].filter(Boolean).join(' ');
      const d = digitsOf(phone).slice(-10);
      const asked = intakeFor(r.intake);
      const extra = { livesIn: Fields.districtOf(r.place), level: Fields.STUDY_LEVELS.includes(r.level) ? r.level : '', inquiryDate: /^\d{4}-\d{2}-\d{2}$/.test(text(r.inquiryDate)) ? text(r.inquiryDate) : '', inquiryTime: /^\d{1,2}:\d{2} (am|pm)$/.test(text(r.inquiryTime)) ? text(r.inquiryTime) : '', extra: text(r.extra).slice(0, 600), sheetId: asked ? asked.id : '', intakeName: (asked || chosen || {}).name || '' };
      const line = { name, first, last, email, phone, ...extra };
      if (!name) { out.push({ ...line, action: 'problem', note: 'No name' }); continue; }
      if (d.length < 7 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.push({ ...line, action: 'problem', note: 'No phone or email to match the student by' }); continue; }
      if (d.length < 7) line.phone = ''; // too short to be a phone number: matched by the email only
      // The same person twice in one file (an updated export often repeats a lead): the lines are joined, so no detail of either is lost.
      const earlier = (d.length >= 7 && seen.get('p' + d)) || (email && seen.get('e' + email)) || null;
      if (earlier) {
        if (!earlier.email && email) earlier.email = email;
        if (!earlier.phone && phone) earlier.phone = phone;
        if (line.inquiryDate && (!earlier.inquiryDate || line.inquiryDate < earlier.inquiryDate)) { earlier.inquiryDate = line.inquiryDate; earlier.inquiryTime = line.inquiryTime; }
        if (!earlier.inquiryTime && line.inquiryTime && line.inquiryDate === earlier.inquiryDate) earlier.inquiryTime = line.inquiryTime;
        if (!earlier.level && line.level) earlier.level = line.level;
        if (!earlier.livesIn && line.livesIn) earlier.livesIn = line.livesIn;
        const parts = new Set(text(earlier.extra).split(/\.\s+/).filter(Boolean));
        text(line.extra).split(/\.\s+/).filter(Boolean).forEach((x) => parts.add(x));
        earlier.extra = [...parts].join('. ').slice(0, 1200);
        out.push({ ...line, action: 'joined', note: `The same person as an earlier line (${earlier.name}): its details are taken together with that line` });
        continue;
      }
      if (d.length >= 7) seen.set('p' + d, line);
      if (email) seen.set('e' + email, line);
      pending.push(line);
    }
    // Each person once, with everything the file says about them.
    for (const line of pending) {
      const d = digitsOf(line.phone).slice(-10); const email = line.email;
      const ids = new Map();
      ((email && byEmail.get(email)) || []).forEach((m) => ids.set(m.row._id, { ...m, how: 'email' }));
      ((d.length >= 7 && byPhone.get(d)) || []).forEach((m) => { if (!ids.has(m.row._id)) ids.set(m.row._id, { ...m, how: 'phone' }); });
      const matches = [...ids.values()];
      // More than one student in Vishnu fits (the phone is one student's, the email another's, or two students share a number): a person
      // must decide, so nothing is changed on any of them.
      if (matches.length > 1) {
        out.push({ ...line, id: matches[0].row._id, action: 'check', note: `Fits ${matches.length} students in Vishnu: ${matches.map((m) => `${nameOf(m.row) || 'no name'} (${m.how}, ${m.sheet.name})`).join(', ')}. Nothing changed: check them on their cards.` });
        continue;
      }
      if (!matches.length) {
        const gone = (d.length >= 7 && removed.get('p' + d)) || (email && removed.get('e' + email)) || null;
        if (gone) { out.push({ ...line, action: 'removed', note: `${gone.name} came from a list before and was later removed from the sheet, so is not added again. Add them by hand if they should come back.` }); continue; }
        out.push({ ...line, action: 'new', note: `Will be added at Inquiry${line.intakeName ? `, ${line.intakeName}` : ''}` });
        continue;
      }
      const found = matches[0];
      if (found.how === 'phone' && otherPerson(line.name || [line.first, line.last].join(' '), nameOf(found.row))) {
        out.push({ ...line, id: found.row._id, action: 'check', note: `Same phone as ${nameOf(found.row)} (${found.sheet.name}, ${text(found.row[STATUS]) || 'no stage'}), another name: maybe a brother or sister. Not linked or added: add them by hand if they are someone else.` });
        continue;
      }
      const card = all[found.row._id];
      const tagged = card && eventFor(plan.events, card.profile.sourceDetail);
      const stage = text(found.row[STATUS]);
      const at = { id: found.row._id, intake: found.sheet.name, stage, name: nameOf(found.row) };
      // A student who was cancelled, withdrawn or put on hold keeps that stage: a list only adds details, it never moves a student.
      const where = `${at.intake}, ${stage || 'no stage'}${['Withdrawn', 'Hold', 'Defer', 'Visa Rejected'].includes(stage) ? ', the stage stays as it is' : ''}`;
      const news = newsFor(line, found.row, card);
      const adds = news.says.length ? ` Will add: ${news.says.join(', ')}.` : '';
      if (tagged && tagged.id === ev.id) out.push({ ...line, ...at, news, action: adds ? 'update' : 'already', note: adds ? `Already linked to this event (${where}).${adds}` : `Already linked to this event (${where}), nothing new` });
      else if (tagged) out.push({ ...line, ...at, news, action: adds ? 'update' : 'other', note: `Already linked to ${tagged.name} (${where}): left in that event (change it on the student card if needed).${adds}` });
      else {
        const before = [text(found.row['STUDENT SOURCE']), card && card.profile.sourceDetail].filter(Boolean).join(': ');
        out.push({ ...line, ...at, before, news, action: 'link', note: `Already on the sheet (${where})${before ? `, source was "${before}"` : ''}: will be linked to this event.${adds}` });
      }
    }
    const count = (a) => out.filter((x) => x.action === a).length;
    // The students already tagged with this event who are not on this list (an updated list that dropped a few, the owner, 14 Nov
    // 2026): never removed, only shown, so Admin can check them on their cards.
    const onList = new Set(out.filter((x) => x.action !== 'check').map((x) => x.id).filter(Boolean));
    const missing = [];
    for (const { sheet, row } of rowIndex().values()) {
      const card = all[row._id];
      const e = card && eventFor(plan.events, card.profile.sourceDetail);
      if (e && e.id === ev.id && !onList.has(row._id)) missing.push({ id: row._id, name: nameOf(row), intake: sheet.name, stage: text(row[STATUS]) });
    }
    missing.sort((a, b) => a.name.localeCompare(b.name));
    const counts = () => ({ new: count('new'), link: count('link'), update: count('update'), already: count('already'), other: count('other'), check: count('check'), joined: count('joined'), removed: count('removed'), problem: count('problem'), missing: missing.length });
    const shown = () => out.map(({ news, ...x }) => x);
    if (body.preview) return { status: 200, json: { preview: true, label, rows: shown(), missing, counts: counts() } };
    // Carry out: add the new ones, tag the ones already on the sheet. A campaign on social media (a Facebook advert, for example) is a
    // Social Media source, so its students are found under Social Media too; any other event or campaign is an Events source.
    const source = channelOf(ev) === 'Social media' ? 'Social Media' : 'Events';
    let added = 0; let linked = 0; let updated = 0; const failed = [];
    for (const x of out) {
      if (x.action === 'new') {
        const r = addStudent(req, { fields: { 'FIRST NAME': x.first, 'LAST NAME': x.last, EMAIL: x.email, 'CONTACT NUMBER': x.phone, 'STUDENT SOURCE': source }, profile: { sourceDetail: label, studyLevel: x.level, inquiryDate: x.inquiryDate, inquiryTime: x.inquiryDate ? x.inquiryTime : '', livesIn: x.livesIn, fromList: ev.id }, stage: 'Inquiry', sheetId: x.sheetId || body.sheetId, note: `Inquiry from ${ev.name}, from its inquiry list.${x.extra ? ` ${x.extra}.` : ''}` });
        if (r.status === 200) { added += 1; x.id = r.json.id; } else failed.push(`${x.name}: ${r.json.error || 'could not be added'}`);
      } else if (x.action === 'link') {
        const found = rowIndex().get(x.id);
        const src = setColumns(req, found, { 'STUDENT SOURCE': source });
        if (src.error) { failed.push(`${x.name}: ${src.error}`); continue; }
        const card = cards.get(x.id);
        cards.setProfile(x.id, { sourceDetail: label, sourceRemarks: [card.profile.sourceRemarks, x.before ? `Previous source: ${x.before}` : ''].filter(Boolean).join(' | ').slice(0, 160) }, by(req));
        const r = applyNews(req, x, x.news, ev, `Linked to ${ev.name} from its inquiry list.${x.before ? ` Previous source: ${x.before}.` : ''}`);
        if (r.error) { failed.push(`${x.name}: ${r.error}`); continue; }
        linked += 1;
      } else if (x.action === 'update') {
        const r = applyNews(req, x, x.news, ev, (x.news.extra || x.news.differs.length) ? `More from the list of ${ev.name}:` : '');
        if (r.error) { failed.push(`${x.name}: ${r.error}`); continue; }
        updated += 1;
      }
    }
    // Remember the phone and email the list gave for every student it names (and for every student already tagged with this event),
    // so a student later removed from the sheet is recognised by the next list instead of being added again.
    const remember = {};
    for (const { row } of rowIndex().values()) {
      const c = cards.has(row._id) ? cards.get(row._id) : null;
      const e = c && eventFor(plan.events, c.profile.sourceDetail);
      if (e && e.id === ev.id) remember[row._id] = [phoneKey(row['CONTACT NUMBER']), text(row.EMAIL).toLowerCase(), nameOf(row)].join('|');
    }
    out.forEach((x) => { if (x.id && ['new', 'link', 'update', 'already', 'other'].includes(x.action)) { const row = (rowIndex().get(x.id) || {}).row || {}; remember[x.id] = [phoneKey(x.phone) || phoneKey(row['CONTACT NUMBER']), x.email || text(row.EMAIL).toLowerCase(), x.name].join('|'); } });
    cards.rememberLeads(remember);
    note(req, [`${ev.name}: uploaded its list (${added} added at Inquiry, ${linked} already on the sheet tagged with it, ${updated} already there given the new details from the list, ${count('already')} already tagged with nothing new, ${count('other')} in another event left as they were, ${count('problem')} lines skipped)`], 'Uploaded event students');
    return { status: 200, json: { done: true, added, linked, updated, failed, rows: shown(), missing, counts: counts() } };
  }

  // Takes back the students an event's or campaign's list added, so a better list can be uploaded (the owner, 14 Nov 2026), without
  // deleting the event. Only what the list itself made goes, and only while nobody has worked on it:
  //   removed: added by this list (its own mark, or the list's first note "Inquiry from <event>, from its inquiry list"), still at
  //            Inquiry, with no university, no application date, no task, no university option, no message sent and no note from a
  //            person (the list's own notes do not count). Its row and its card go, so the next list adds it again as new.
  //   kept (worked on): added by this list, but someone has worked on the student since: never removed here; listed with the reason.
  //   kept (in Vishnu before): linked by the list but in Vishnu before it: stays as it is.
  // { preview: true } only lists them. Before anything is removed, a copy of everything is saved (Admin, Restore, a "manual" copy).
  const LIST_NOTE = /^([EI]nquiry from .*, from its [ei]nquiry list|More from the list of |From the updated list of |Linked to .* from its [ei]nquiry list|(Changed|Undone) on the student card: )/; // "Enquiry" in notes written before 14 Nov 2026
  // A note a card change writes by itself ("Changed on the student card: ...", the owner, 22 Nov 2026) is a record, not a contact either.
  // The contacts with a student: the team's notes and the messages that went out. The note an uploaded list writes by itself
  // ("Enquiry from <event>, from its enquiry list") and a message that failed or is only a preview are not a contact (the owner,
  // 17 Nov 2026: a list just uploaded showed every student as followed up). Events and marketing, Today and the dashboards all
  // use this one rule. [{ at, by, what: 'note' | 'WhatsApp' | 'email', text }], oldest first.
  function contactsOf(card) {
    return [
      ...((card && card.notes) || []).filter((n) => !LIST_NOTE.test(String(n.text || '')) && n.kind !== 'stage' && n.kind !== 'try').map((n) => ({ at: n.at, by: n.by, what: 'note', text: n.text })),
      ...((card && card.messages) || []).filter((m) => m.status !== 'failed' && m.status !== 'preview').map((m) => ({ at: m.at, by: m.by, what: m.channel === 'whatsapp' ? 'WhatsApp' : 'email', text: m.subject || '' })),
    ].filter((x) => x.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  function eventRemoval(req, ev, body) {
    const plan = planning.all();
    const all = cards.all();
    const remove = []; const worked = []; const before = [];
    for (const { sheet, row } of rowIndex().values()) {
      const card = all[row._id];
      const e = card && eventFor(plan.events, card.profile.sourceDetail);
      if (!e || e.id !== ev.id) continue;
      const who = { id: row._id, name: nameOf(row) || 'Student with no name', intake: sheet.name, stage: text(row[STATUS]) };
      const byList = card.profile.fromList === ev.id || (card.notes || []).some((n) => [`Enquiry from ${ev.name}, from its enquiry list`, `Inquiry from ${ev.name}, from its inquiry list`].some((x) => String(n.text || '').startsWith(x)));
      if (!byList) { before.push({ ...who, why: 'In Vishnu before the list: stays' }); continue; }
      const why = [];
      if (who.stage && who.stage !== 'Inquiry') why.push(`now at ${who.stage}`);
      if (text(row['UNIVERSITY NAME']) || isoDate(row['APPLICATION SUBMISSION DATE'])) why.push('has a university or an application');
      if ((card.tasks || []).length) why.push('has a task');
      if ((card.options || []).length) why.push('has university options');
      if ((card.messages || []).length) why.push('was sent a message');
      if ((card.notes || []).some((n) => !LIST_NOTE.test(String(n.text || '')))) why.push('has notes from the team');
      // Anything a person typed counts too (the review of 21 Nov 2026: a student given a course, a test date and a saved profile was
      // still listed for removal): a saved profile, remarks, a course, a test, an offer or a later step's date.
      if (card.profile && card.profile.savedAt) why.push('has a saved profile');
      const typed = ['REMARKS', 'COURSE NAME', 'LANGUAGE TEST DATE', 'OFFER RECEIVED DATE', 'PAYMENT DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VISA RECEIVED DATE'].filter((c) => text(row[c]));
      if (typed.length) why.push('has details typed in');
      if (card.checks && Object.values(card.checks).some(Boolean)) why.push('has documents ticked');
      if (why.length) worked.push({ ...who, why: `Worked on (${why.join(', ')}): stays` });
      else remove.push(who);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    const lists = { remove: remove.sort(byName), worked: worked.sort(byName), before: before.sort(byName) };
    if (body.preview) return { status: 200, json: { preview: true, ...lists } };
    if (!remove.length) return { status: 200, json: { done: true, removed: 0, ...lists } };
    let copy = null;
    try { copy = safetyCopy(); } catch (e) { return { status: 500, json: { error: 'A safety copy could not be saved first, so nothing was removed.' } }; }
    const wb = getWorkbook();
    const gone = new Set(remove.map((x) => x.id));
    const next = { ...wb, revision: wb.revision + 1, sheets: wb.sheets.map((sh) => (sh.rows.some((r) => gone.has(r._id)) ? { ...sh, rows: sh.rows.filter((r) => !gone.has(r._id)) } : sh)) };
    try { writeWorkbook(next, req.user && req.user.id); } catch (e) { console.error('[remove list]', e); return { status: 500, json: { error: 'save failed' } }; }
    recordChanges(req, wb, next);
    cards.forget([...gone]);
    note(req, [`${ev.name}: removed the ${gone.size} student${gone.size === 1 ? '' : 's'} its list had added (${worked.length} worked on and ${before.length} in Vishnu before were kept)${copy ? `; a copy was saved first (${copy})` : ''}`], 'Removed an event list');
    return { status: 200, json: { done: true, removed: gone.size, copy, ...lists } };
  }

  // Every student of one event, for its page on Events and marketing: who, the phone, the stage, the intake and the latest note, so the
  // team can work through the list (open the card, call, write the note) without looking through the intakes one by one.
  // The students of one event with where each stands in the follow-up (see followOf), the last contact and the remark, and who in
  // the team has followed them up, so the event page shows it all without opening each card.
  function eventStudents(user, ev) {
    const plan = planning.all();
    const all = cards.all();
    const todayNo = todayNumber();
    const out = [];
    const team = new Map(); // a person: the students they contacted, their notes and messages, their latest contact
    for (const { sheet, row } of visibleStudents(user)) {
      const card = all[row._id];
      const e = card && eventFor(plan.events, card.profile.sourceDetail);
      if (!e || e.id !== ev.id) continue;
      const f = followOf(row, card, todayNo);
      const lastNote = card.notes && card.notes.length ? card.notes[card.notes.length - 1] : null;
      const met = new Set();
      f.touches.forEach((x) => {
        const who = text(x.by).replace(/\s*\(the student\)$/, '');
        if (!who || who !== text(x.by)) return; // a note the student wrote is not a follow-up
        const t = team.get(who) || { name: who, students: 0, notes: 0, last: '' };
        t.notes += 1; if (!met.has(who)) { met.add(who); t.students += 1; }
        if (String(x.at) > t.last) t.last = String(x.at);
        team.set(who, t);
      });
      out.push({
        id: row._id, name: nameOf(row), phone: text(row['CONTACT NUMBER']), email: text(row.EMAIL), stage: f.stage, intake: sheet.name,
        visa: f.state === 'visa', follow: f.state, days: f.days, contacts: f.touches.length,
        lastContact: f.last ? { at: f.last.at, by: f.last.by, what: f.last.what, text: String(f.last.text || '').slice(0, 200) } : null,
        lastNote: lastNote ? { at: lastNote.at, by: lastNote.by, text: String(lastNote.text).slice(0, 200) } : null,
        remarks: text(row.REMARKS).slice(0, 200), lostReason: text(card.profile && card.profile.lostReason),
        canNote: canChange(user, rowIndex().get(row._id)),
      });
    }
    return { students: out.sort((a, b) => a.name.localeCompare(b.name)), team: [...team.values()].sort((a, b) => b.students - a.students || b.notes - a.notes) };
  }

  // Which event or campaign each student came from, for the Source filter of All Students: only the students the account
  // sees, and only the event's name and day (no cost).
  // A student's source as the Source filters show it: [the source ("Social Media", "Branch" ...), exactly which (the platform, the
  // event or campaign with its date, the branch, the agent)].
  function sourceOf(row, card, plan) {
    const stored = text(row['STUDENT SOURCE']);
    const group = Fields.sourceGroup(stored) || 'Not recorded';
    const e = card && eventFor(plan.events, card.profile.sourceDetail);
    const detail = group === 'Branch' ? Fields.branchName(stored) : e ? eventLabel(e.name, e.date) : text(card && card.profile.sourceDetail).slice(0, 120);
    return [group, detail];
  }
  // Where a source belongs on the "over time" chart: the paid and social reach, events, what came by itself, branches, agents.
  const TREND_GROUP = { 'Social Media': 'social', Events: 'events', Branch: 'branch', Agent: 'agent', 'B2B Partner': 'agent', 'Not recorded': 'unknown' };
  // A student brought by an event or a campaign counts under "Events and marketing", whatever the source says: the leads of a
  // Facebook ads campaign are marketing, not social media that came by itself (the owner, 14 Nov 2026). So is a paid advert.
  function trendBucket(row, card, plan) {
    const [group] = sourceOf(row, card, plan);
    const p = (card && card.profile) || {};
    if (eventFor(plan.events, p.sourceDetail) || p.sourceWay === 'Advert') return 'events';
    return TREND_GROUP[group] || 'organic';
  }
  function trendsFor(wb, intakeId) {
    const sheet = wb.sheets.find((x) => x.id === intakeId) || currentIntake() || wb.sheets[0];
    const plan = planning.all();
    const all = cards.all();
    const today = cards.today();
    const inquiries = []; const applications = []; const offers = []; const payments = []; const cas = []; const visas = [];
    // One record per student, so the source filter of the chart narrows every line, not just the inquiries (the owner, 14 Nov 2026):
    // [where they came from, inquiry day, application day, offer day, payment day, CAS day, visa day, which exactly] ('' when none).
    const students = [];
    let undated = 0;
    const lives = {}; const home = {}; let noPlace = 0; const abroad = {};
    const ages = { 'Under 20': 0, '20 to 22': 0, '23 to 25': 0, '26 to 29': 0, '30 and over': 0 }; let noAge = 0;
    // The age the student was when they applied (else when they first asked, else today): a student who applied at 18 stays 18 on
    // this intake's chart years later (the owner, 14 Nov 2026).
    const ageAt = (dob, on) => { const [y, m, d] = dob.split('-').map(Number); const [ty, tm, td] = on.split('-').map(Number); let a = ty - y; if (tm < m || (tm === m && td < d)) a -= 1; return a; };
    for (const row of (sheet ? sheet.rows : [])) {
      if (!isStudent(row)) continue;
      const card = all[row._id];
      const p = (card && card.profile) || {};
      const bucket = trendBucket(row, card, plan);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(p.inquiryDate || '') ? p.inquiryDate : '';
      if (day) inquiries.push([day, bucket]); else undated += 1;
      const applied = isoDate(row['APPLICATION SUBMISSION DATE']); if (applied) applications.push(applied);
      const offered = isoDate(row['OFFER RECEIVED DATE']); if (offered) offers.push(offered);
      const paid = isoDate(row['PAYMENT DATE']); if (paid) payments.push(paid);
      const casDay = isoDate(row['CAS RECEIVED DATE']); if (casDay) cas.push(casDay);
      const visaDay = isoDate(row['VISA RECEIVED DATE']); if (visaDay) visas.push(visaDay);
      // Which exactly (the event or campaign, the platform, the branch, the agent), for the second filter of the chart.
      const [, detail] = sourceOf(row, card, plan);
      students.push([bucket, day, applied || '', offered || '', paid || '', casDay || '', visaDay || '', detail || p.sourcePlatform || '']);
      // Where the student is from: the district of the address in the passport (the owner, 14 Nov 2026), else a home district kept
      // earlier; a student from outside Nepal is counted by nationality instead.
      if (p.nationality && p.nationality !== 'Nepali') abroad[p.nationality] = (abroad[p.nationality] || 0) + 1;
      else {
        const district = Fields.districtOf(p.address) || p.homeDistrict || '';
        if (district) home[district] = (home[district] || 0) + 1; else noPlace += 1;
      }
      if (p.livesIn) lives[p.livesIn] = (lives[p.livesIn] || 0) + 1;
      if (/^\d{4}-\d{2}-\d{2}$/.test(p.dob || '')) {
        const a = ageAt(p.dob, applied || day || today);
        const k = a < 20 ? 'Under 20' : a <= 22 ? '20 to 22' : a <= 25 ? '23 to 25' : a <= 29 ? '26 to 29' : '30 and over';
        if (a > 10 && a < 80) ages[k] += 1; else noAge += 1;
      } else noAge += 1;
    }
    const target = sheet ? plan.targets[sheet.id] || null : null;
    // Every intake side by side, oldest first, as a company's quarters: how the business grows from one intake to the next.
    const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const orderOf = (name) => { const t = String(name).toLowerCase(); const y = Number((t.match(/20\d\d/) || [0])[0]); const m = Object.keys(MONTH).find((k) => t.includes(k)); return y * 12 + (m ? MONTH[m] : 0); };
    const intakes = wb.sheets.map((sh) => {
      const v = { id: sh.id, name: sh.name, students: 0, applied: 0, offers: 0, paid: 0, visas: 0 };
      sh.rows.forEach((row) => {
        if (!isStudent(row)) return;
        v.students += 1;
        const st = text(row[STATUS]);
        if (isoDate(row['APPLICATION SUBMISSION DATE']) || ['Mock Stage', 'Payment Stage', 'CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'].includes(st)) v.applied += 1;
        if (isoDate(row['OFFER RECEIVED DATE'])) v.offers += 1;
        if (isoDate(row['PAYMENT DATE']) || ['CAS Stage', 'CAS Issued', 'Visa Lodge', 'Visa Issued'].includes(st)) v.paid += 1;
        if (st === 'Visa Issued' || isoDate(row['VISA RECEIVED DATE'])) v.visas += 1;
      });
      return v;
    }).filter((v) => v.students).sort((a, b) => orderOf(a.name) - orderOf(b.name));
    return {
      intake: sheet ? { id: sheet.id, name: sheet.name } : null, today, students, inquiries, undated, applications, offers, payments, cas, visas, intakes, abroad,
      events: (plan.events || []).filter((e) => e.date).map((e) => ({ name: e.name, date: e.date, endDate: e.endDate || '', channel: channelOf(e) })),
      teachingStarts: target && /^\d{4}-\d{2}-\d{2}$/.test(target.startDate || '') ? target.startDate : '',
      places: { lives, home, none: noPlace }, ages, noAge,
    };
  }
  function eventTags(user) {
    const plan = planning.all();
    const all = cards.all();
    const rows = {};
    const used = new Map();
    // Every student's source too, for the Source filter of All Students (the owner, 14 Nov 2026): the source (Social Media, Visitor,
    // a branch ...) and exactly which (the platform, the event or campaign, the branch, the agent), so any team can show, for example,
    // only the Visitor students or only the leads of one Facebook campaign, and call them.
    const sources = {};
    const groups = new Map();
    for (const { row } of visibleStudents(user)) {
      const card = all[row._id];
      const e = card && eventFor(plan.events, card.profile.sourceDetail);
      const [group, detail] = sourceOf(row, card, plan);
      sources[row._id] = [group, detail];
      const g = groups.get(group) || { group, count: 0, details: new Map() };
      g.count += 1;
      if (detail) g.details.set(detail, (g.details.get(detail) || 0) + 1);
      groups.set(group, g);
      if (!e) continue;
      const label = eventLabel(e.name, e.date);
      rows[row._id] = label;
      used.set(label, { label, name: e.name, date: e.date, count: (used.get(label) || { count: 0 }).count + 1 });
    }
    const ORDER = ['Social Media', 'Visitor', 'Reference', 'Language Classes', 'Events', 'Agent', 'Branch', 'B2B Partner'];
    const rank = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : g === 'Not recorded' ? 99 : 50);
    return {
      rows, events: [...used.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))), sources,
      groups: [...groups.values()].sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group))
        .map((g) => ({ group: g.group, count: g.count, details: [...g.details].map(([detail, count]) => ({ detail, count })).sort((a, b) => b.count - a.count || a.detail.localeCompare(b.detail)) })),
    };
  }

  // ---- lists across students ----
  function searchStudents(user, q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    const digits = String(q || '').replace(/\D/g, '');
    const out = [];
    for (const { sheet, row } of visibleStudents(user)) {
      const b = brief(sheet, row);
      const hay = `${b.name} ${b.email} ${b.university} ${b.course}`.toLowerCase();
      const phone = b.phone.replace(/\D/g, '');
      const hit = words.length ? (words.every((w) => hay.includes(w)) || (digits.length >= 5 && phone.includes(digits))) : true;
      if (hit) out.push(b);
      if (out.length >= 400) break;
    }
    // The newest intake first, then by name.
    const order = new Map((getWorkbook() ? getWorkbook().sheets : []).map((s, i) => [s.id, i]));
    out.sort((a, b) => (order.get(b.sheetId) - order.get(a.sheetId)) || a.name.localeCompare(b.name));
    return out.slice(0, 30);
  }

  // ---- every course of Universities, for the course search ----
  let courseCache = { facts: null, links: null, index: [] };
  function courseIndex() {
    const all = facts.all();
    const links = courseLinks.all(all);
    if (courseCache.facts !== all || courseCache.links !== links) courseCache = { facts: all, links, index: buildIndex(all, links) };
    return courseCache.index;
  }

  // ---- B2B partners and agents (Admin changes them, others look as partner-access.js allows): the list, one partner, its files ----
  // What each partner has brought: the students of a B2B partner (Student Source Agent, and the partner named on the card) and the
  // students applied for through a B2B platform (the sheet's University Partner column). Matched by name, ignoring capitals.
  // What each partner has brought, by intake: visas first (that is what pays), and the students. B2B partners are the businesses you send
  // applications to (the sheet's University Partner column); Agents are the ones that send students (Student Source "Agent", and the agent named
  // on the student card). Matched by name, ignoring capitals.
  // The partner a name in the University Partner column means: another spelling counts for the partner itself.
  const partnerNamed = (name) => {
    name = Fields.plainPartner(name);
    const aliases = planning.all().settings.partnerAliases || {};
    const hit = Object.keys(aliases).find((k) => squash(k) === squash(name));
    return hit ? aliases[hit] : name;
  };
  function partnerPerformance(kind) {
    const out = {};
    const wb = getWorkbook();
    if (!wb) return out;
    const all = cards.all();
    const bump = (raw, row, sheetName) => {
      const name = kind === 'agents' ? raw : partnerNamed(raw);
      const key = text(name).toLowerCase();
      if (!key) return;
      const e = out[key] || (out[key] = { students: 0, visas: 0, intakes: {} });
      const it = e.intakes[sheetName] || (e.intakes[sheetName] = { students: 0, visas: 0 });
      e.students += 1; it.students += 1;
      if (text(row[STATUS]) === 'Visa Issued' || text(row['VISA RECEIVED DATE'])) { e.visas += 1; it.visas += 1; }
    };
    wb.sheets.forEach((sheet) => sheet.rows.forEach((row) => {
      if (!isStudent(row)) return;
      const card = all[row._id];
      if (kind === 'agents') { const rp = text(row['RECEIVING PARTNER']); if (rp && !isOffice(rp)) bump(rp, row, sheet.name); else if (text(row['STUDENT SOURCE']) === 'Agent' && card && card.profile.sourceDetail) bump(card.profile.sourceDetail, row, sheet.name); } else if (text(row['UNIVERSITY PARTNER'])) bump(row['UNIVERSITY PARTNER'], row, sheet.name);
    }));
    return out;
  }
  // B2B Partners (the businesses you send applications to) and Agents (the businesses that send you their students): the same kind of record.
  // The B2B partners named in the University Partner column of the sheet that are not set up on B2B Partners yet: every name that is
  // not a university (Universities, Partner Universities, or a name with University or College in it) and that Admin did not mark as
  // not a partner. They are shown on B2B Partners and offered in the dropdown, so no partner on the sheet is missing.
  // The Receiving Partner column: the head office and the branches are NIEC itself; any other name is an agent.
  const OFFICES = ['Head Office', ...Fields.BRANCHES.map(Fields.branchValue)];
  const isOffice = (v) => { const k = squash(v); return k === squash('Head Office') || Fields.BRANCHES.some((b) => k === squash(b) || k === squash(Fields.branchValue(b))); };
  // The agents named in the Receiving Partner column that are not set up on Agents yet and not marked as not an agent.
  function sheetAgents() {
    const wb = getWorkbook();
    const known = new Set((agents ? agents.list() : []).map((p) => squash(p.name)));
    const hidden = new Set((planning.all().settings.notAgents || []).map(squash));
    const found = new Map();
    (wb ? wb.sheets : []).forEach((sh) => sh.rows.forEach((row) => {
      if (!isStudent(row)) return;
      const name = text(row['RECEIVING PARTNER']).replace(/\s+/g, ' ');
      const key = squash(name);
      if (!key || isOffice(name) || known.has(key) || hidden.has(key)) return;
      const f = found.get(key) || { name, students: 0 };
      f.students += 1; found.set(key, f);
    }));
    return [...found.values()].sort((x, y) => y.students - x.students || x.name.localeCompare(y.name));
  }
  // A university, a Partner University or the short form of one ("OIEG" or "OIG" for Oxford International Education Group) is
  // never a B2B partner: it is not listed on B2B Partners, not even as hidden (the owner, 20 Nov 2026).
  function universityNames() {
    const keys = new Set([...facts.all().map((u) => squash(u.name)), ...direct.all().map((u) => squash(u.name))].filter(Boolean));
    direct.all().forEach((u) => {
      const words = String(u.name || '').replace(/\(.*?\)/g, ' ').split(/[^A-Za-z]+/).filter((w) => w && !/^(of|the|and|for)$/i.test(w));
      const short = (list) => list.map((w) => w[0]).join('').toLowerCase();
      if (words.length > 1) { keys.add(short(words)); keys.add(short(words.filter((w) => !/^education(al)?$/i.test(w)))); }
    });
    keys.delete('');
    return keys;
  }
  const isUniversityName = (name, keys = universityNames()) => keys.has(squash(name)) || /universit|college/i.test(String(name || ''));
  // A university's old B2B card, kept as Ended only for its files, is not shown among the B2B partners either.
  const b2bCards = () => { const keys = universityNames(); return b2b.list().filter((p) => !(p.status === 'Ended' && isUniversityName(p.name, keys))); };
  const hiddenPartners = () => { const keys = universityNames(); return (planning.all().settings.notPartners || []).filter((n) => !isUniversityName(n, keys)); };
  function sheetPartners() {
    const wb = getWorkbook();
    const known = new Set((b2b ? b2b.list() : []).map((p) => squash(p.name)));
    const unis = universityNames();
    // Another name of a known partner ("TOR" for "The Official Rep") is not a partner of its own.
    const hidden = new Set([...(planning.all().settings.notPartners || []), ...Object.keys(planning.all().settings.partnerAliases || {})].map(squash));
    const found = new Map();
    (wb ? wb.sheets : []).forEach((sh) => sh.rows.forEach((row) => {
      if (!isStudent(row)) return;
      const name = Fields.plainPartner(row['UNIVERSITY PARTNER']).replace(/\s+/g, ' ');
      const key = squash(name);
      // "QA Higher Education" is a direct route (the QA universities), never a B2B partner of its own (the owner, 22 Nov 2026).
      if (!key || known.has(key) || hidden.has(key) || isUniversityName(name, unis) || key === 'qahighereducation') return;
      const f = found.get(key) || { name, students: 0 };
      f.students += 1; found.set(key, f);
    }));
    return [...found.values()].sort((x, y) => y.students - x.students || x.name.localeCompare(y.name));
  }
  async function handleB2b(req, res, urlPath) {
    if (urlPath === '/api/b2b/not-partner' && req.method === 'POST') {
      // Admin, and the Application Team, who sets B2B partners up too (the owner, 15 Nov 2026).
      if (partnerAccess(req.user).b2b !== 'setup' && !adminOnly(req, res, 'B2B Partners')) return true;
      const body = await bodyOf(req, res, 4096);
      if (!body) return true;
      const name = text(body.name).slice(0, 120);
      const now = planning.all().settings.notPartners || [];
      const next = body.undo ? now.filter((n) => squash(n) !== squash(name)) : [...now, name];
      planning.saveSettings({ notPartners: next });
      activity.record(req, req.user, 'Edited partners', { app: 'B2B Partners', changes: [body.undo ? `${name}: shown again as a B2B partner` : `${name}: marked as not a B2B partner`] });
      sendJSON(res, 200, { notPartners: hiddenPartners() });
      return true;
    } return handlePartnerStore(req, res, urlPath, { store: b2b, prefix: 'b2b', label: 'B2B Partners', kind: 'b2b' }); }
  async function handleAgents(req, res, urlPath) {
    if (urlPath === '/api/agents/not-partner' && req.method === 'POST') {
      if (!adminOnly(req, res, 'Agents')) return true;
      const body = await bodyOf(req, res, 4096);
      if (!body) return true;
      const name = text(body.name).slice(0, 120);
      const now = planning.all().settings.notAgents || [];
      planning.saveSettings({ notAgents: body.undo ? now.filter((n) => squash(n) !== squash(name)) : [...now, name] });
      activity.record(req, req.user, 'Edited partners', { app: 'Agents', changes: [body.undo ? `${name}: shown again as an agent` : `${name}: marked as not an agent`] });
      sendJSON(res, 200, { notPartners: planning.all().settings.notAgents });
      return true;
    }
    return handlePartnerStore(req, res, urlPath, { store: agents, prefix: 'agents', label: 'Agents', kind: 'agents' }); }
  async function handlePartnerStore(req, res, urlPath, { store: b2b, prefix, label, kind }) {
    // Admin changes the list; the Manager (with the commission) and the Application Team (without it) look at it.
    const level = partnerAccess(req.user)[kind];
    const reading = req.method === 'GET' && !/\/delete$/.test(urlPath);
    // 'setup' (the Application Team on B2B Partners): changes an existing partner's details, never its files, never removes it, and never
    // adds one (partners come from the students' sheet, nothing is added by hand: the owner, 20 Nov 2026).
    const settingUp = level === 'setup' && req.method === 'POST' && new RegExp(`^/api/${prefix}/[a-f0-9]{12}$`).test(urlPath);
    if (!level || (level !== 'full' && !reading && !settingUp)) { if (!adminOnly(req, res, level ? `Changing ${label}` : label)) return true; }
    const id = (urlPath.match(new RegExp(`^/api/${prefix}/([a-f0-9]{12})`)) || [])[1];
    const record = (line) => activity.record(req, req.user, 'Edited partners', { app: label, changes: [line] });
    const fileMatch = urlPath.match(new RegExp(`^/api/${prefix}/[a-f0-9]{12}/files(?:/([a-f0-9]{12})(/delete)?)?$`));
    if (fileMatch) {
      const fid = fileMatch[1];
      if (req.method === 'GET' && fid && !fileMatch[2]) {
        if (level === 'team' || level === 'setup') { sendJSON(res, 403, { error: 'The commission lists and agreement files are not open to your account.' }); return true; }
        const file = b2b.agreementFile(id, fid);
        if (!file) { sendJSON(res, 404, { error: 'No such file.' }); return true; }
        // ?open=1 shows a PDF or a picture in the browser (a commission list opens when it is clicked); anything else is downloaded.
        const inline = new URL(req.url, 'http://x').searchParams.get('open') === '1' && /^(application\/pdf|image\/(png|jpeg))$/.test(file.type);
        record(`${inline ? 'Opened' : 'Downloaded'} ${file.name}`);
        send(res, 200, fs.readFileSync(file.path), {
          'Content-Type': file.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': inline ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" : "sandbox; default-src 'none'",
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="agreement${path.extname(file.path)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        });
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
      if (!fid) {
        const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
        let bytes;
        try { bytes = await readRaw(req, MAX_FILE_BYTES); } catch (e) {
          sendJSON(res, e.statusCode || 400, { error: e.statusCode === 413 ? 'That file is too large (the limit is 10 MB).' : e.message });
          return true;
        }
        const added = b2b.addAgreement(id, name, bytes, req.user.label);
        if (added.error) { sendJSON(res, 400, { error: added.error }); return true; }
        record(`Uploaded the agreement ${added.agreement.name} for ${added.university.name}`);
        sendJSON(res, 200, added.university);
        return true;
      }
      const gone = b2b.removeAgreement(id, fid, req.user.label);
      if (gone.error) { sendJSON(res, 404, { error: gone.error }); return true; }
      record(`Removed the agreement ${gone.removed.name} from ${gone.university.name}`);
      sendJSON(res, 200, gone.university);
      return true;
    }
    if (req.method === 'GET') {
      if (!id && urlPath !== `/api/${prefix}`) { sendJSON(res, 404, { error: 'No such partner.' }); return true; }
      if (!id && level !== 'full') { sendJSON(res, 200, { access: level, partners: (kind === 'b2b' ? b2bCards() : b2b.list()).map((p) => shapePartner(p, level, seesLogins(req.user))), ...(level === 'setup' ? { onSheet: sheetPartners(), notPartners: hiddenPartners() } : {}), statuses: PARTNER_STATUSES, performance: partnerPerformance(kind), currentIntake: (currentIntake() || {}).name || '' }); return true; }
      if (!id) { sendJSON(res, 200, { access: level, partners: kind === 'b2b' ? b2bCards() : b2b.list(), ...(kind === 'b2b' ? { onSheet: sheetPartners(), notPartners: hiddenPartners() } : { onSheet: sheetAgents(), notPartners: planning.all().settings.notAgents || [] }), statuses: PARTNER_STATUSES, performance: partnerPerformance(kind), currentIntake: (currentIntake() || {}).name || '', intakes: (() => { const wb = getWorkbook(); return wb ? wb.sheets.filter((x) => !x.hidden || true).map((x) => x.name) : []; })() }); return true; }
      const one = shapePartner(b2b.get(id), level, seesLogins(req.user));
      if (one) sendJSON(res, 200, one); else sendJSON(res, 404, { error: 'No such partner.' });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
    const body = await bodyOf(req, res, 1024 * 1024);
    if (!body) return true;
    if (!id) {
      const made = b2b.create(body.name, req.user.label);
      if (made.error) { sendJSON(res, 400, { error: made.error }); return true; }
      record(`Added ${made.university.name} to ${label}`);
      sendJSON(res, 200, shapePartner(made.university, level, seesLogins(req.user)));
      return true;
    }
    if (urlPath.endsWith('/delete')) {
      const gone = b2b.remove(id);
      if (gone.error) { sendJSON(res, 404, { error: gone.error }); return true; }
      record(`Removed ${gone.removed.name} from ${label}`);
      sendJSON(res, 200, { ok: true });
      return true;
    }
    // The Application Team changes only how applications are submitted: the portal link (or email), its username and its password
    // (the owner, 15 Nov 2026). Everything else (name, status, city, agreement, contacts, commission, notes) stays as Admin left it.
    let input = body;
    if (level === 'setup') {
      const old = b2b.get(id);
      if (!old) { sendJSON(res, 404, { error: 'No such partner.' }); return true; }
      input = { ...old, apply: typeof body.apply === 'string' ? body.apply : (old.applyPortal || old.applyEmail || ''), applyUser: body.applyUser !== undefined ? body.applyUser : old.applyUser, applyPassword: body.applyPassword !== undefined ? body.applyPassword : old.applyPassword };
    }
    const saved = b2b.update(id, input, req.user.label);
    if (saved.error) { sendJSON(res, 400, { error: saved.error }); return true; }
    record(`Updated ${saved.university.name} in ${label}`);
    sendJSON(res, 200, shapePartner(saved.university, level, seesLogins(req.user)));
    return true;
  }

  // ---- the management records of the Dashboard ----
  async function handlePlanning(req, res, urlPath) {
    if (!managers(req, res, 'Planning')) return true;
    const admin = Teams.isAdmin(req.user);
    if (req.method === 'GET' && urlPath === '/api/planning') {
      const p = planning.all();
      // What a student with a visa is worth is an assumption about money: Admin only.
      const settings = admin ? p.settings : { maxCostPerLead: p.settings.maxCostPerLead };
      sendJSON(res, 200, { targets: p.targets, spend: p.spend, events: p.events, decisions: p.decisions, market: p.market, settings, canEdit: admin, lists: { EVENT_TYPES, DECISION_STATUS, MARKET_KINDS, sources: sourceChoices() } });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
    if (!adminOnly(req, res, 'Changing the planning records')) return true;
    const body = await bodyOf(req, res);
    if (!body) return true;
    const record = (line) => activity.record(req, req.user, 'Edited planning', { app: 'Dashboard', changes: [line] });
    let m = /^\/api\/planning\/targets\/([\w-]{1,80})$/.exec(urlPath);
    if (m) {
      const out = planning.setTarget(m[1], body, req.user.label);
      if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
      record(out.target ? `Set the target of an intake: ${out.target.visas} visas${out.target.byDate ? ` by ${out.target.byDate}` : ''}` : 'Removed the target of an intake');
      sendJSON(res, 200, { ok: true, target: out.target });
      return true;
    }
    if (urlPath === '/api/planning/settings') {
      const out = planning.saveSettings(body);
      record('Changed the planning assumptions');
      sendJSON(res, 200, { ok: true, settings: out.settings });
      return true;
    }
    m = /^\/api\/planning\/(spend|events|decisions|market)(?:\/([a-f0-9]{12})\/delete)?$/.exec(urlPath);
    if (!m || !PLANNING_LISTS[m[1]]) { send(res, 404, 'Not found'); return true; }
    const label = { spend: 'marketing spend', events: 'events', decisions: 'decision log', market: 'market notes' }[m[1]];
    if (m[2]) {
      const gone = planning.remove(m[1], m[2]);
      if (gone.error) { sendJSON(res, 404, { error: gone.error }); return true; }
      record(`Removed an entry from the ${label}`);
      sendJSON(res, 200, { ok: true });
      return true;
    }
    // The cost of an event or a campaign may be typed in dollars or pounds: it is kept in rupees at today's rate (the rate of the day
    // it was first saved stays while the amount and currency are not changed), with what was typed beside it.
    if (m[1] === 'events') {
      const cur = ['USD', 'GBP'].includes(body.costCurrency) ? body.costCurrency : 'NPR';
      const typed = String(body.costAmount ?? body.cost ?? '').replace(/[£$,\s]/g, '').replace(/^rs\.?/i, '');
      const amt = Number(typed);
      if (cur !== 'NPR' && typed && Number.isFinite(amt) && amt > 0) {
        const old = body.id ? (planning.all().events || []).find((e) => e.id === body.id) : null;
        let rate = old && old.costCurrency === cur && old.costAmount === Math.round(amt * 100) / 100 && old.costRate ? old.costRate : 0;
        if (!rate) {
          const r = rates ? await rates.toNpr(cur) : { ok: false, error: 'Exchange rates are not available here. Enter the cost in rupees.' };
          if (!r.ok) { sendJSON(res, 400, { error: r.error }); return true; }
          rate = r.rate;
        }
        Object.assign(body, { costCurrency: cur, costAmount: typed, costRate: rate, cost: String(Math.round(amt * rate)) });
      } else Object.assign(body, { costCurrency: 'NPR', costAmount: typed, costRate: 0, cost: typed });
      // The intake it was run for: an intake tab that exists, or blank. A save that does not send it (an older page) keeps the one set.
      const before = body.id ? (planning.all().events || []).find((e) => e.id === body.id) : null;
      if (body.intake === undefined) body.intake = (before && before.intake) || '';
      const wbI = getWorkbook();
      if (text(body.intake) && !(wbI && wbI.sheets.some((sh) => sh.id === text(body.intake)))) { sendJSON(res, 400, { error: 'That intake is no longer there. Choose another.' }); return true; }
    }
    const out = planning.save(m[1], body, req.user.label);
    if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
    record(`${body.id ? 'Changed' : 'Added'} an entry in the ${label}: ${out.entry.title || out.entry.name || out.entry.campaign || out.entry.source || out.entry.month}`);
    sendJSON(res, 200, { ok: true, entry: out.entry });
    return true;
  }
  // The Student Sources in use (the sheet's own list, plus anything typed in a sheet), for the spend table.
  function sourceChoices() {
    const set = new Set(Fields.STORED_SOURCES);
    const wb = getWorkbook();
    if (wb) wb.sheets.forEach((s) => s.rows.forEach((r) => { const v = text(r['STUDENT SOURCE']); if (v) set.add(v); }));
    return [...set].sort();
  }

  // ---- the words a message can use, and the office's email settings ----
  // There are no saved message templates any more (the owner, 17 Nov 2026). What is left: the {words} Follow-up offers, and Admin's
  // office settings (the consultancy's name), kept at the same address as before.
  async function handleTemplates(req, res, urlPath) {
    if (req.method === 'GET' && urlPath === '/api/templates') {
      sendJSON(res, 200, { fields: Messages.FIELDS, signature: messages.signature(), canEdit: Teams.isAdmin(req.user), mail: mailInfo(req.user) });
      return true;
    }
    if (req.method !== 'POST' || urlPath !== '/api/templates/signature') { send(res, 404, 'Not found'); return true; }
    if (!adminOnly(req, res, 'Changing the office email settings')) return true;
    const body = await bodyOf(req, res);
    if (!body) return true;
    const out = messages.saveSignature(body);
    activity.record(req, req.user, 'Edited templates', { app: 'Messages', changes: ['Changed the office email settings'] });
    sendJSON(res, 200, { ok: true, signature: out.signature });
    return true;
  }

  // One message to many students by email: how each one looks (preview), or each one sent from the sender's own mailbox with their
  // signature and logged on the student's card. Used by the Claude connector (advisor-mcp.js, only when NIEC_ADVISOR_SEND_AS names
  // the sender); the Follow-up page was removed (the owner, 22 Nov 2026).
  // `req` needs `user` and `headers` (for the activity record).
  const bulkSends = new Map();
  async function followUp(req, { ids, subject = '', emailBody = '', whatsappBody = '', preview = false }) {
    { const bad = Messages.badPlaceholder(subject, emailBody, whatsappBody); if (bad) return { error: bad }; }
    const cfg = mailFor(req.user);
    const signed = signatureFor(req.user, cfg);
    const signature = signed.sig;
    if (!preview && !text(subject) && !text(emailBody)) return { error: 'Write a subject and a message first.' };
    const items = [];
    const sendOut = [];
    for (const id of ids) {
      const found = rowIndex().get(id);
      if (!canSee(req.user, found) || !canChange(req.user, found)) { (preview ? items : sendOut).push(preview ? { id, error: 'Not in your list.' } : { id, name: '', status: 'skipped', error: 'Not in your list.' }); continue; }
      const card = cards.get(id);
      const ctx = messageContext(req, found, card, null);
      const email = Messages.renderEmail({ subject, body: emailBody, signature, siteUrl: cfg ? cfg.siteUrl : '', signatureSrc: signatureSrc(preview, signed.picture), ...ctx });
      const wa = Messages.renderWhatsApp({ body: whatsappBody, ...ctx });
      const to = text(found.row.EMAIL).toLowerCase();
      const number = Fields.whatsappNumber(found.row['CONTACT NUMBER']);
      const needsOptions = /\{options_table\}/.test(emailBody + whatsappBody) && !ctx.options.length;
      const item = { id, name: nameOf(found.row), to, subject: email.subject, text: email.text, missing: email.missing, whatsapp: { number, text: wa.text }, problem: needsOptions ? 'No university option on the card.' : (!mailer.isAddress(to) ? 'No email address.' : '') };
      if (preview) { items.push(item); continue; }
      if (item.problem) { sendOut.push({ id, name: item.name, status: 'skipped', error: item.problem }); continue; }
      if (!cfg) { sendOut.push({ id, name: item.name, status: 'not-configured' }); continue; }
      const recent = (bulkSends.get(req.user.id) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
      if (recent.length >= 300) { sendOut.push({ id, name: item.name, status: 'skipped', error: 'Too many emails in a short time.' }); continue; }
      const entry = { channel: 'email', template: 'Follow-up', subject: email.subject, to, text: email.text, options: needsOptions ? 0 : ctx.options.length, attachments: [] };
      try {
        await mailer.sendMail({ ...cfg, fromName: cfg.personal && !Teams.isAdmin(req.user) ? `${req.user.name}, ${signature.short || signature.company || Messages.COMPANY}` : (signature.company || Messages.COMPANY) }, { to, subject: email.subject, text: email.text, html: email.html, auto: false, bcc: copiesFor(cfg), inline: inlinePictures(signed.picture) });
        recent.push(Date.now()); bulkSends.set(req.user.id, recent);
        cards.logMessage(id, { ...entry, status: 'sent' }, by(req));
        sendOut.push({ id, name: item.name, status: 'sent' });
      } catch (e) {
        cards.logMessage(id, { ...entry, status: 'failed', error: e.message }, by(req));
        sendOut.push({ id, name: item.name, status: 'failed', error: e.message });
      }
    }
    return { items, sendOut, signed };
  }

  async function handle(req, res, urlPath) {
    if (!urlPath.startsWith('/api/')) return false;
    const query = () => new URL(req.url, 'http://x').searchParams;
    // Your setup for sending (Follow-up): a person's own mailbox for emailing students (see user-mail.js). Saved only after a test email to that address went out.
    if (urlPath === '/api/my-mail' && req.method === 'GET') {
      const office = officeMailSettings();
      sendJSON(res, 200, { ...(userMail ? userMail.info(req.user.id) : { set: false }), admin: Teams.isAdmin(req.user), officeReady: Boolean(accounts.emailConfig()), defaults: { host: office.host || '', port: office.port || 465, security: office.security || 'ssl' } });
      return true;
    }
    if (urlPath === '/api/my-mail' && req.method === 'POST') {
      if (!userMail) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      const body = await bodyOf(req, res, 8 * 1024);
      if (!body) return true;
      const made = userMail.clean(body, officeMailSettings(), mailer.isAddress);
      if (made.error) { sendJSON(res, 400, { error: made.error }); return true; }
      if (await pointsInside(made.box.host)) { sendJSON(res, 400, { error: 'That mail server name points to a private address. Use the mail server your email provider gives you.' }); return true; }
      if (tooManySends(req.user.id)) { sendJSON(res, 429, { error: 'Too many tries in a short time. Please wait a few minutes.' }); return true; }
      try {
        await mailer.sendMail({ ...made.box, fromName: req.user.name }, { to: made.box.from, subject: 'Vishnu: your email is set up', text: `Hello ${req.user.name},\n\nYour mailbox works with Vishnu. Emails you send to students from Vishnu now go from ${made.box.from}.\n`, auto: true });
      } catch (e) {
        activity.record(req, req.user, 'Test email failed', { app: 'My email', changes: [`Could not set up ${made.box.from}: ${mailer.friendlyError(e, made.box.host)}`] });
        sendJSON(res, 400, { error: `It did not work, so nothing was saved: ${mailer.friendlyError(e, made.box.host)}` });
        return true;
      }
      userMail.save(req.user.id, made.box);
      activity.record(req, req.user, 'Changed settings', { app: 'My email', changes: [`Set up their own mailbox ${made.box.from} for emailing students`] });
      sendJSON(res, 200, { ok: true, ...userMail.info(req.user.id) });
      return true;
    }
    // The person's own signature picture: shown on Follow-up, uploaded (PNG or JPG, at most 1 MB) and removed there.
    if (urlPath === '/api/my-mail/signature' && req.method === 'GET') {
      const pic = userMail ? userMail.picture(req.user.id) : null;
      if (!pic) { sendJSON(res, 404, { error: 'No signature picture yet.' }); return true; }
      send(res, 200, pic.data, { 'Content-Type': pic.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return true;
    }
    if (urlPath === '/api/my-mail/signature' && req.method === 'POST') {
      if (!userMail) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      let bytes;
      try { bytes = await readRaw(req, 1024 * 1024 + 1); } catch (e) { sendJSON(res, e.statusCode || 400, { error: e.statusCode === 413 ? 'That picture is too large (the limit is 1 MB).' : e.message }); return true; }
      const out = userMail.savePicture(req.user.id, bytes);
      if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
      activity.record(req, req.user, 'Email signature', { app: 'My email', changes: ['Uploaded their email signature picture'] });
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (urlPath === '/api/my-mail/signature/delete' && req.method === 'POST') {
      if (userMail) userMail.removePicture(req.user.id);
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (urlPath === '/api/my-mail/delete' && req.method === 'POST') {
      const gone = userMail ? userMail.remove(req.user.id) : false;
      if (gone) activity.record(req, req.user, 'Changed settings', { app: 'My email', changes: ['Removed their own mailbox'] });
      sendJSON(res, 200, { ok: true, set: false });
      return true;
    }
    // Their phone, connected once, so a click on WhatsApp opens the student's chat on it (see push.js and phone-link.js).
    if (urlPath === '/api/push' && req.method === 'GET') {
      if (!push) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      sendJSON(res, 200, { key: push.publicKey(), devices: push.devices(req.user.id) });
      return true;
    }
    // The one-time code the computer shows, for the phone's camera (see push.js pairCode and /pair in server.js).
    if (urlPath === '/api/push/pair-code' && req.method === 'POST') {
      if (!push) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      const made = push.pairCode(req.user);
      const host = String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '');
      const proto = (req.socket && req.socket.encrypted) || /^https/.test(String(req.headers['x-forwarded-proto'] || '')) ? 'https' : 'http';
      sendJSON(res, 200, { url: `${proto}://${host}/pair?t=${made.token}`, token: made.token, until: made.until });
      return true;
    }
    // How the code on the computer is doing: waiting, opened on the phone, done (and on which phone), or run out.
    if (urlPath === '/api/push/pair-status' && req.method === 'GET') {
      if (!push) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      sendJSON(res, 200, push.pairStatus(req.user.id, new URL(req.url, 'http://x').searchParams.get('t')));
      return true;
    }
    // Whether a WhatsApp or Call just sent has arrived on the phone, and whether it was tapped (the computer shows it).
    if (urlPath === '/api/push/receipt' && req.method === 'GET') {
      if (!push) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      sendJSON(res, 200, push.receipt(req.user.id, new URL(req.url, 'http://x').searchParams.get('m')));
      return true;
    }
    if (/^\/api\/push\/(connect|disconnect|whatsapp)$/.test(urlPath) && req.method === 'POST') {
      if (!push) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      const body = await bodyOf(req, res, 8 * 1024);
      if (!body) return true;
      if (urlPath === '/api/push/connect') {
        const out = push.connect(req.user.id, body.subscription, text(body.name), body.old);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Changed settings', { app: 'My phone', changes: [`Connected their phone (${out.device.name}) for WhatsApp`] });
        // The id and secret go to this phone only, so it can hand over a new push address by itself later (see push.js renew).
        sendJSON(res, 200, { ok: true, devices: push.devices(req.user.id), device: { id: out.device.id, secret: out.secret } });
        return true;
      }
      if (urlPath === '/api/push/disconnect') {
        const out = push.disconnect(req.user.id, text(body.id));
        if (out.removed) activity.record(req, req.user, 'Changed settings', { app: 'My phone', changes: ['Disconnected their phone'] });
        sendJSON(res, 200, { ok: true, devices: push.devices(req.user.id) });
        return true;
      }
      const site = `https://${String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '')}`;
      // What the computer is told when nothing reached a phone: which phone, and the one thing to do.
      const notReached = (out) => {
        const devs = push.devices(req.user.id);
        if (!devs.length) return [409, 'Your phone is no longer connected. Connect it again.'];
        if (devs.every((x) => x.lost)) { const n = devs.length === 1 ? `Your ${devs[0].name}` : 'Your phone'; return [409, `${n} is not answering. Open Vishnu on it once (from the Home Screen or Chrome) and it reconnects by itself.`]; }
        return [502, out && out.forgotten ? 'Your phone is no longer connected. Connect it again.' : 'Your phone could not be reached. Check that it is online.'];
      };
      const reply = (out) => {
        if (!out.sent) { const [code, error] = notReached(out); sendJSON(res, code, { error }); return; }
        sendJSON(res, 200, { ok: true, sent: out.sent, to: out.names, m: out.track ? out.m : '' });
      };
      if (body.test === true) {
        // A test, from the Connect my phone window.
        if (!push.devices(req.user.id).length) { sendJSON(res, 409, { error: 'Connect your phone first.' }); return true; }
        reply(await push.send(req.user.id, { title: 'Vishnu is connected', body: 'WhatsApp chats you open on the computer will come here.', url: '/today', tag: 'isr-test' }, site, 'isr-test'));
        return true;
      }
      // A student's chat, sent to the person's own phone: only a student this account may see, only that student's number.
      const found = rowIndex().get(text(body.id));
      if (!found || !canSee(req.user, found)) { sendJSON(res, 404, { error: 'No such student.' }); return true; }
      const number = Fields.whatsappNumber(found.row['CONTACT NUMBER']);
      if (!number) { sendJSON(res, 400, { error: 'This student has no WhatsApp number on the sheet.' }); return true; }
      if (!push.devices(req.user.id).length) { sendJSON(res, 409, { error: 'Connect your phone first.' }); return true; }
      const who = nameOf(found.row) || 'the student';
      const words = text(body.text).slice(0, 1500);
      const kind = body.call === true ? 'call' : 'wa';
      // Pressed twice (or three times) for the same student: the phone gets one notification, never two (the owner, 17 Nov 2026).
      // The same click within 15 seconds is answered with the first one's result, and nothing more is sent.
      const key = `${req.user.id} ${kind} ${number} ${words}`;
      const now = Date.now();
      for (const [k, v] of recentPushes) if (now - v.at > 15000) recentPushes.delete(k);
      const prior = recentPushes.get(key);
      if (prior) { sendJSON(res, prior.code, { ...prior.json, again: true, secondsAgo: Math.round((now - prior.at) / 1000) }); return true; }
      if (tooManySends(req.user.id)) { sendJSON(res, 429, { error: 'Too many in a short time. Please wait a few minutes.' }); return true; }
      // Held while it is being sent, so a second click during the send waits for the same answer instead of sending again.
      const entry = { at: now, code: 202, json: { ok: true, pending: true } };
      recentPushes.set(key, entry);
      // Call (the owner, 17 Nov 2026): the same way, and a tap on the notification rings the student from the phone.
      const message = kind === 'call'
        ? { title: `Call ${who}`, body: `Tap to call · +${number}`, url: `/wa?call=1&n=${number}&name=${encodeURIComponent(who)}`, tag: `call-${number}` }
        : { title: `WhatsApp ${who}`, body: `Tap to open the chat · +${number}`, url: `/wa?n=${number}&name=${encodeURIComponent(who)}${words ? `&text=${encodeURIComponent(words)}` : ''}`, tag: `wa-${number}` };
      const out = await push.send(req.user.id, message, site, `${kind}-${number}`);
      if (out.sent) { entry.code = 200; entry.json = { ok: true, sent: out.sent, to: out.names, m: out.track ? out.m : '' }; } else recentPushes.delete(key);
      reply(out);
      return true;
    }
    // Their own WhatsApp number (the owner, 17 Nov 2026: Follow-up asks for it), for the signature of their emails and to know which
    // WhatsApp the messages go from. Saved on its own, with or without a mailbox.
    if (urlPath === '/api/my-mail/phone' && req.method === 'POST') {
      if (!userMail) { sendJSON(res, 500, { error: 'Not available.' }); return true; }
      const body = await bodyOf(req, res, 4 * 1024);
      if (!body) return true;
      const out = userMail.savePhone(req.user.id, body.phone);
      if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
      activity.record(req, req.user, 'Changed settings', { app: 'My email', changes: [out.phone ? 'Saved their WhatsApp number' : 'Removed their WhatsApp number'] });
      sendJSON(res, 200, { ok: true, ...userMail.info(req.user.id) });
      return true;
    }
    if (urlPath === '/api/my-dashboard' && req.method === 'GET') {
      if (Teams.isAdmin(req.user) || (Teams.isManager(req.user) && Teams.isReadOnly(req.user))) { sendJSON(res, 403, { error: 'Admin and the Manager have the full Dashboard.' }); return true; }
      sendJSON(res, 200, myDashboard(req.user));
      return true;
    }
    if (urlPath === '/api/today' && req.method === 'GET') { sendJSON(res, 200, { ...todayFor(req.user), readOnly: Teams.isReadOnly(req.user) }); return true; }
    if (urlPath === '/api/activities' && req.method === 'GET') {
      if (!managers(req, res, 'Events and marketing')) return true;
      const { list, unlinkedSocial, unlinkedByIntake } = activities(req.user);
      // The intakes new students from an uploaded list can go into: the current one first.
      const wbNow = getWorkbook(); const cur = currentIntake();
      const intakes = wbNow ? Teams.viewFor(req.user, wbNow).sheets.map((sh) => ({ id: sh.id, name: sh.name })).sort((x, y) => (cur && x.id === cur.id ? -1 : cur && y.id === cur.id ? 1 : 0)) : [];
      sendJSON(res, 200, { activities: list, unlinkedSocial, unlinkedByIntake, intakes, currentIntake: cur ? cur.id : '', channels: CHANNELS, types: EVENT_TYPES, marketingTypes: MARKETING_TYPES, canEdit: Teams.isAdmin(req.user) });
      return true;
    }
    // The choices of the University Partner column: the Partner Universities and the B2B Partners (names only, no terms), for every
    // account that sees the sheet. A new partner is added on B2B Partners first, then it can be picked.
    // Partner Universities: how many students and visas each university has, in every intake (numbers only, no names), for the cards.
    // A student counts for a university by its University Name, or by its University Partner (Navitas, OIEG ...).
    if (urlPath === '/api/direct-stats' && req.method === 'GET') {
      if (!partnerAccess(req.user).direct) { sendJSON(res, 403, { error: 'Partner Universities are not open to your account.' }); return true; }
      const unis = direct.all().map((u) => ({ key: squash(u.name), id: u.id }));
      const out = Object.fromEntries(unis.map((u) => [u.id, { students: 0, visas: 0, applied: 0, offers: 0, thisIntake: 0 }]));
      const wb = getWorkbook();
      const cur = currentIntake();
      (wb ? wb.sheets : []).forEach((sh) => sh.rows.forEach((row) => {
        if (!isStudent(row)) return;
        const keys = new Set([squash(row['UNIVERSITY NAME']), squash(partnerNamed(row['UNIVERSITY PARTNER']))].filter(Boolean));
        const hit = unis.find((u) => keys.has(u.key));
        if (!hit) return;
        const e = out[hit.id];
        e.students += 1;
        if (cur && sh.id === cur.id) e.thisIntake += 1;
        if (text(row['APPLICATION SUBMISSION DATE'])) e.applied += 1;
        if (text(row['OFFER RECEIVED DATE'])) e.offers += 1;
        if (text(row[STATUS]) === 'Visa Issued' || text(row['VISA RECEIVED DATE'])) e.visas += 1;
      }));
      sendJSON(res, 200, { stats: out, currentIntake: cur ? cur.name : '' });
      return true;
    }
    if (urlPath === '/api/partner-choices' && req.method === 'GET') {
      const names = (store) => (store && store.list ? store.list().filter((x) => x.status !== 'Ended').map((x) => x.name).sort((x, y) => x.localeCompare(y)) : []);
      const partners = [...new Set([...names(b2b), ...sheetPartners().map((p) => p.name)])].sort((x, y) => x.localeCompare(y));
      const agentNames = [...new Set([...names(agents), ...sheetAgents().map((p) => p.name)])].sort((x, y) => x.localeCompare(y));
      sendJSON(res, 200, { universities: names(direct), partners, offices: OFFICES, agents: agentNames });
      return true;
    }
    // Tasks: a team member gets the tasks of their teams (and a branch the tasks it gave); Admin and the Manager get every task.
    // A person in two or more teams chooses their own team on Today (see accounts.js setOwnTeam).
    if (urlPath === '/api/my-team' && req.method === 'POST') {
      const body = await bodyOf(req, res, 1024);
      if (!body) return true;
      const out = accounts && accounts.setOwnTeam ? accounts.setOwnTeam(req, text(body.team)) : { error: 'Not available.' };
      if (out.error) sendJSON(res, 400, { error: out.error }); else sendJSON(res, 200, out);
      return true;
    }
    if (urlPath === '/api/tasks' && req.method === 'GET') {
      const all = cards.all();
      const everyone = seesAllTasks(req.user);
      const seen = cards.seenBy(req.user.username);
      const out = [];
      for (const { sheet, row } of rowIndex().values()) {
        const c = all[row._id];
        if (!c || !Array.isArray(c.tasks) || !c.tasks.length) continue;
        // Each task says whether it is for this person (`forMe`), whether they gave it (`given`, when it is not also theirs to do), who
        // gave it and to whom, and how much is new on it for them (`unread`).
        c.tasks.forEach((t) => {
          const mine = forMe(req.user, t);
          const had = !mine && hadIt(req.user, t);
          // A task handed on to another team leaves this team's Today (the owner, 20 Nov 2026): it is the other team's now, and comes back
          // only if it is handed back. It stays on the student card.
          if (!everyone && !mine && !gaveIt(req.user, t)) return;
          const tag = Fields.taskTag(t, text(row[STATUS]));
          out.push({ ...t, tag, priority: Fields.taskPriorityOf(t), forMe: mine, given: !mine && gaveIt(req.user, t), had, mayHand: mayHand(req.user, t), unread: unreadOf(req.user, t, seen), news: newsOf(req.user, t, seen), history: historyOf(req.user, t, seen), teamLabel: teamLabel(t.team), routeLabels: (t.route || []).map(teamLabel), studentId: row._id, student: nameOf(row) || 'Student', stage: text(row[STATUS]), intake: sheet.name, course: courseShown(c, t, tag), contact: contactOf(row) });
        });
      }
      // Open first, then the one with the newest word (a comment, or the task itself) first.
      const lastWord = (t) => { const c = Array.isArray(t.comments) && t.comments.length ? t.comments[t.comments.length - 1].at : ''; return String(c > t.at ? c : t.at); };
      out.sort((a, b) => (a.done - b.done) || lastWord(b).localeCompare(lastWord(a)));
      // Whose tasks come to this person, said on Today, so a person in two teams with no own team chosen sees why both teams' tasks come.
      const mineFrom = { teams: taskTeamsOf(req.user).map(teamLabel), allTeams: teamsOf(req.user).length, ownChosen: Boolean(req.user.taskTeam && teamsOf(req.user).includes(req.user.taskTeam)), choices: teamsOf(req.user).map((id) => ({ id, label: teamLabel(id) })) };
      // For Admin and the Manager: who is in two or more teams with no own team yet (they get every team's tasks and work list).
      const noOwnTeam = everyone && accounts && accounts.people ? accounts.people().filter((p) => p.role !== 'admin' && (p.departments || []).length > 1 && !p.taskTeam).map((p) => p.name) : [];
      // A long list is shortened by leaving out only finished tasks with nothing new on them (the oldest first): every open task and
      // every task with something new always comes, so Today's counts, the bell and the menu count always match and can be cleared.
      const keep = out.filter((t) => !t.done || t.unread > 0 || (t.news && t.news.length));
      const kept = new Set(keep);
      const rest = out.filter((t) => !kept.has(t)); // a Set: thousands of tasks stay fast
      const shown = keep.length >= 500 ? keep : [...keep, ...rest.slice(0, 500 - keep.length)];
      shown.sort((a, b) => (a.done - b.done) || lastWord(b).localeCompare(lastWord(a)));
      sendJSON(res, 200, { tasks: shown, today: cards.today(), mineFrom, noOwnTeam, canAssign: canAssign(req.user), seesAll: everyone, me: req.user.name, headLabel: headLabel(), isHead: Teams.isAdmin(req.user), teams: TASK_TEAMS(), handTeams: handTeamsFor(req.user) });
      return true;
    }
    // How much is new on the tasks for this person (the red dot on Today in the menu): new comments, and tasks just given to them.
    // Mark all as read on Today: one request for every task it lists (it once sent one request per task, hundreds at a time).
    if (urlPath === '/api/tasks/seen' && req.method === 'POST') {
      const body = await bodyOf(req, res, 256 * 1024);
      if (!body) return true;
      const want = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, 5000).map((x) => text(x)));
      const all = cards.all();
      const everyoneS = seesAllTasks(req.user);
      const ids = [];
      for (const { row } of rowIndex().values()) {
        const c = all[row._id];
        (c && Array.isArray(c.tasks) ? c.tasks : []).forEach((t) => { if (want.has(t.id) && (everyoneS || forMe(req.user, t) || gaveIt(req.user, t))) ids.push(t.id); });
      }
      if (ids.length) cards.markSeen(req.user.username, ids);
      sendJSON(res, 200, { ok: true, marked: ids.length });
      return true;
    }
    if (urlPath === '/api/tasks/unread' && req.method === 'GET') {
      const all = cards.all();
      const seen = cards.seenBy(req.user.username);
      let count = 0;
      for (const { row } of rowIndex().values()) {
        const c = all[row._id];
        // The same tasks Today lists (a task handed on to another team has left this team's Today), so the red count in the menu can
        // always be cleared on Today (the owner, 21 Nov 2026: the count stayed after Mark all as read).
        const everyoneU = seesAllTasks(req.user);
        (c && Array.isArray(c.tasks) ? c.tasks : []).forEach((t) => { if (everyoneU || forMe(req.user, t) || gaveIt(req.user, t)) count += unreadOf(req.user, t, seen); });
      }
      sendJSON(res, 200, { count });
      return true;
    }
    if (urlPath === '/api/event-tags' && req.method === 'GET') { sendJSON(res, 200, eventTags(req.user)); return true; }
    { const m = /^\/api\/activities\/([a-f0-9]{12})\/students\/remove$/.exec(urlPath);
      if (m && req.method === 'POST') {
        if (!Teams.isAdmin(req.user)) { sendJSON(res, 403, { error: 'Only Admin can remove the students of a list.' }); return true; }
        const ev = planning.all().events.find((e) => e.id === m[1]);
        if (!ev) { sendJSON(res, 404, { error: 'No such event or marketing.' }); return true; }
        const body = await bodyOf(req, res);
        if (!body) return true;
        const r = eventRemoval(req, ev, body);
        sendJSON(res, r.status, r.json);
        return true;
      } }
    { const m = /^\/api\/activities\/([a-f0-9]{12})\/students$/.exec(urlPath);
      if (m && req.method === 'GET') {
        if (!managers(req, res, 'Events and marketing')) return true;
        const ev = planning.all().events.find((e) => e.id === m[1]);
        if (!ev) { sendJSON(res, 404, { error: 'No such event or marketing.' }); return true; }
        sendJSON(res, 200, eventStudents(req.user, ev));
        return true;
      }
      if (m && req.method === 'POST') {
        if (!Teams.isAdmin(req.user)) { sendJSON(res, 403, { error: 'Only Admin can upload the students of an event.' }); return true; }
        const ev = planning.all().events.find((e) => e.id === m[1]);
        if (!ev) { sendJSON(res, 404, { error: 'No such event or marketing.' }); return true; }
        const body = await bodyOf(req, res, 2 * 1024 * 1024);
        if (!body) return true;
        const r = eventImport(req, ev, body);
        sendJSON(res, r.status, r.json);
        return true;
      } }
    if (urlPath === '/api/card-lists' && req.method === 'GET') { sendJSON(res, 200, cardLists(req.user)); return true; }
    if (urlPath === '/api/students/search' && req.method === 'GET') { sendJSON(res, 200, { students: searchStudents(req.user, (query().get('q') || '').slice(0, 100)) }); return true; }
    if (urlPath === '/api/students/new' && req.method === 'POST') return handleNewStudent(req, res);
    if (urlPath === '/api/students/merge' && req.method === 'POST') return handleMerge(req, res);
    if (urlPath === '/api/students/bulk' && req.method === 'POST') return handleBulkStudents(req, res);
    if (urlPath === '/api/students/check' && req.method === 'POST') {
      const body = await bodyOf(req, res, 256 * 1024);
      if (!body) return true;
      const list = (Array.isArray(body.rows) ? body.rows : []).slice(0, 200).map((r) => { const d = r && typeof r === 'object' ? existingStudent(r.email, r.phone) : null; return d ? { exists: true, name: Teams.isAdmin(req.user) ? [d['FIRST NAME'], d['LAST NAME']].filter(Boolean).join(' ') : ' ' } : { exists: false }; });
      sendJSON(res, 200, { results: list });
      return true;
    }
    // A missing platform, class or event (with its day) is added once and offered to everyone, so students are tagged the same way.
    if (urlPath === '/api/source-options' && req.method === 'POST') {
      if (Teams.isReadOnly(req.user)) { sendJSON(res, 403, { error: 'Your account can only view students.' }); return true; }
      const body = await bodyOf(req, res);
      if (!body) return true;
      const out = sourceOptions.add(text(body.source), body.name, body.date);
      if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
      if (!out.existed) note(req, [`Added "${out.value}" to the choices of ${text(body.source)}`], 'Edited student card', 'Student sources');
      sendJSON(res, 200, { ok: true, value: out.value, options: sourceOptions.all(planning.all().events.map((e) => eventLabel(e.name, e.date))) });
      return true;
    }
    if (urlPath.startsWith('/api/cards/')) return handleCard(req, res, urlPath);
    if (urlPath === '/api/courses' && req.method === 'GET') {
      const q = query();
      const index = courseIndex();
      const found = searchCourses(index, { q: (q.get('q') || '').slice(0, 100), level: q.get('level') || '', intake: (q.get('intake') || '').slice(0, 60), universityId: q.get('university') || '', limit: 80 });
      sendJSON(res, 200, { ...found, levels: Fields.STUDY_LEVELS, intakes: [...new Set(index.flatMap((o) => o.intake.split(',').map((s) => s.trim())).filter(Boolean))].sort() });
      return true;
    }
    if (urlPath === '/api/templates' || urlPath.startsWith('/api/templates/')) return handleTemplates(req, res, urlPath);
    if (urlPath === '/api/b2b' || urlPath.startsWith('/api/b2b/')) return handleB2b(req, res, urlPath);
    if (urlPath === '/api/agents' || urlPath.startsWith('/api/agents/')) return handleAgents(req, res, urlPath);
    if (urlPath === '/api/planning' || urlPath.startsWith('/api/planning/')) return handlePlanning(req, res, urlPath);
    // Where the applicants of an intake came from: the Receiving Partner of each applicant (Head Office, a branch or an agent), with
    // the applicants and visas of each. An applicant is a student past Inquiry (not Defer, Hold or Withdrawn) or with a submission
    // date. A student with no Receiving Partner is counted in the totals but not listed (nothing recorded is shown as a row).
    if (urlPath === '/api/applicants' && req.method === 'GET') {
      if (!managers(req, res, 'The Dashboard')) return true;
      const wb = getWorkbook();
      if (!wb) { sendJSON(res, 500, { error: 'Could not read the data file' }); return true; }
      const want = query().get('intake') || '';
      const sheet = wb.sheets.find((sh) => sh.id === want) || currentIntake() || wb.sheets[wb.sheets.length - 1];
      const allCards = cards.all();
      const events = planning.all().events;
      const directNames = new Set(direct.all().map((u) => squash(u.name)));
      const bump = (map, key, label, extra = {}) => { const g = map.get(key) || { label, students: 0, applicants: 0, visas: 0, people: [], ...extra }; map.set(key, g); return g; };
      // The students behind a figure (for the deepest level of the Dashboard's drill-down): at most 80 per group.
      const person = (row, stage, visa) => ({ id: row._id, name: nameOf(row), stage, university: text(row['UNIVERSITY NAME']), visa });
      const receiving = new Map(); const sources = new Map(); const partners = new Map(); const agentsMap = new Map();
      let applicants = 0;
      (sheet ? sheet.rows : []).forEach((row) => {
        if (!isStudent(row)) return;
        const stage = text(row[STATUS]);
        const applied = !['', 'Inquiry', 'Defer', 'Hold', 'Withdrawn'].includes(stage) || Boolean(text(row['APPLICATION SUBMISSION DATE']));
        const visa = stage === 'Visa Issued' || Boolean(text(row['VISA RECEIVED DATE']));
        const me = person(row, stage, visa);
        const add = (g) => { g.students += 1; if (applied) g.applicants += 1; if (visa) g.visas += 1; if (g.people.length < 80) g.people.push(me); };
        if (applied) applicants += 1;
        const card = allCards[row._id];
        // Where the student came from: the Student Source, and under it exactly which (the event, the platform, the agent ...).
        const src = text(row['STUDENT SOURCE']);
        if (src) {
          const group = Fields.isBranchValue(src) ? 'Branch' : src;
          const g = bump(sources, group, group, { details: new Map() }); add(g);
          let detail = Fields.isBranchValue(src) ? src : text(card && card.profile.sourceDetail);
          const ev = !Fields.isBranchValue(src) && detail ? eventFor(events, detail) : null;
          if (ev) detail = ev.name;
          if (detail) add(bump(g.details, squash(detail), detail));
        }
        // Where the application was received (Head Office, a branch, an agent).
        let from = text(row['RECEIVING PARTNER']);
        if (from && applied) {
          const k = squash(from);
          if (k === squash('Head Office')) from = 'Head Office';
          else { const b = Fields.BRANCHES.find((x) => k === squash(x) || k === squash(Fields.branchValue(x))); if (b) from = Fields.branchValue(b); }
          const kind = from === 'Head Office' ? 'office' : Fields.isBranchValue(from) ? 'branch' : 'agent';
          const g = bump(receiving, from, from, { kind }); g.students += 1; g.applicants += 1; if (visa) g.visas += 1; if (g.people.length < 80) g.people.push(me);
        }
        // The agent who sent the student: the Receiving Partner when it is not the head office or a branch, else the Agent source.
        const rp = text(row['RECEIVING PARTNER']);
        const agent = rp && !isOffice(rp) ? rp : (src === 'Agent' ? text(card && card.profile.sourceDetail) : '');
        if (agent) add(bump(agentsMap, squash(agent), agent));
        // Where the application was sent: a Partner University or a B2B partner (the University Partner column).
        const up = Fields.plainPartner(row['UNIVERSITY PARTNER']);
        if (up) {
          const k = squash(up); const pg = bump(partners, k, up, { kind: directNames.has(k) || /universit|college/i.test(up) ? 'university' : 'b2b', unis: new Map() }); add(pg);
          const uni = text(row['UNIVERSITY NAME']); if (uni) add(bump(pg.unis, squash(uni), uni));
        }
      });
      const list = (m) => [...m.values()].sort((x, y) => y.students - x.students || x.label.localeCompare(y.label));
      const order = { office: 0, branch: 1, agent: 2 };
      sendJSON(res, 200, {
        intake: sheet ? sheet.name : '', applicants,
        list: [...receiving.values()].sort((x, y) => order[x.kind] - order[y.kind] || y.applicants - x.applicants),
        sources: list(sources).map((g) => ({ ...g, details: list(g.details) })),
        partners: list(partners).map((g) => ({ ...g, unis: list(g.unis) })), agents: list(agentsMap),
      });
      return true;
    }
    // The Dashboard's "over time" chart and map (the owner, 14 Nov 2026): every inquiry of the intake on the day the student really
    // enquired (from the lead list or the day they were added) with where they came from, every application and offer on its day, the
    // events and campaigns with their dates (to see why inquiries rose), where the students live, and their ages.
    if (urlPath === '/api/trends' && req.method === 'GET') {
      if (!managers(req, res, 'The Dashboard')) return true;
      const wb = getWorkbook();
      if (!wb) { sendJSON(res, 500, { error: 'Could not read the data file' }); return true; }
      sendJSON(res, 200, trendsFor(wb, query().get('intake') || ''));
      return true;
    }
    if (urlPath === '/api/insights' && req.method === 'GET') {
      if (!managers(req, res, 'The Dashboard')) return true;
      if (!getWorkbook()) { sendJSON(res, 500, { error: 'Could not read the data file' }); return true; }
      send(res, 200, insights(req.user, query().get('intake') || ''), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return true;
    }
    // The weekly check of the course pages: the warnings, and a person confirming one.
    if (urlPath === '/api/course-watch' && req.method === 'GET') {
      const w = courseWatch();
      sendJSON(res, 200, w ? { warnings: w.warnings(text(new URL(req.url, 'http://x').searchParams.get('university'))), summary: w.summary(), running: w.isRunning(), admin: Teams.isAdmin(req.user) } : { warnings: [], summary: {}, running: false });
      return true;
    }
    if (urlPath === '/api/course-watch/confirm' && req.method === 'POST') {
      if (!adminOnly(req, res, 'Confirming a course page warning')) return true;
      const body = await bodyOf(req, res, 4096);
      if (!body) return true;
      sendJSON(res, 200, { ok: Boolean(courseWatch() && courseWatch().confirm(text(body.key))) });
      return true;
    }
    if (urlPath === '/api/course-watch/run' && req.method === 'POST') {
      if (!adminOnly(req, res, 'Checking the course pages')) return true;
      const w = courseWatch();
      if (w && !w.isRunning()) w.run().catch(() => {});
      sendJSON(res, 200, { started: Boolean(w && !w.isRunning()) });
      return true;
    }
    // A student's own shortlist (the owner, 17 Nov 2026): a student with their own login reads Universities and presses "I am
    // interested" on a course; it goes into University options on their card (marked as chosen by the student) and the Application
    // Team gets one task to look at the shortlist and advise. Only for a student's login, only their own card.
    if (urlPath === '/api/shortlist' || /^\/api\/shortlist\/[a-z0-9-]{1,40}\/delete$/.test(urlPath)) {
      if (!Teams.isStudent(req.user)) { sendJSON(res, 403, { error: 'This is for a student\'s own login.' }); return true; }
      const found = rowIndex().get(text(req.user.studentRow));
      if (!found) { sendJSON(res, req.method === 'GET' ? 200 : 400, req.method === 'GET' ? { linked: false, items: [] } : { error: 'Your login is not linked to your file yet. Please ask the office.' }); return true; }
      const rowId = found.row._id;
      const mine = () => (cards.get(rowId).options || []).filter((o) => o.byStudent).map((o) => ({ id: o.id, university: o.university, universityId: o.universityId, course: o.course, intake: o.intake, at: o.addedAt }));
      const by = `${req.user.name} (the student)`;
      if (req.method === 'GET') { sendJSON(res, 200, { linked: true, name: text(found.row['FIRST NAME']), items: mine() }); return true; }
      if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
      const body = await bodyOf(req, res, 8 * 1024);
      if (!body) return true;
      if (urlPath.endsWith('/delete')) {
        const optId = urlPath.split('/')[3];
        const o = (cards.get(rowId).options || []).find((x) => x.id === optId);
        if (!o || !o.byStudent) { sendJSON(res, 404, { error: 'That course is not on your shortlist.' }); return true; }
        if (o.applied || o.offer) { sendJSON(res, 400, { error: 'We have already applied for this course. Please talk to the office.' }); return true; }
        cards.removeOption(rowId, optId, by);
        cards.addNote(rowId, { kind: 'note', text: `The student took ${o.course || 'a course'} at ${o.university} off their shortlist on Universities.` }, by);
        activity.record(req, req.user, 'Edited student card', { app: 'Universities', changes: [`${nameOf(found.row)} took ${o.course} at ${o.university} off their shortlist`] });
        sendJSON(res, 200, { ok: true, items: mine() });
        return true;
      }
      const uni = facts.all().find((u) => u.id === text(body.universityId));
      const course = text(body.course).slice(0, 240);
      if (!uni || !course) { sendJSON(res, 400, { error: 'Choose a course from Universities.' }); return true; }
      if (mine().length >= 10) { sendJSON(res, 400, { error: 'Your shortlist is full (10 courses). Take one off first.' }); return true; }
      const made = cards.addOption(rowId, { universityId: uni.id, university: uni.name, course, intake: text(body.intake).slice(0, 80), byStudent: true, note: 'Chosen by the student on Universities' }, by);
      if (made.error) { sendJSON(res, made.duplicate ? 409 : 400, { error: made.duplicate ? 'That course is already on your list.' : made.error }); return true; }
      cards.addNote(rowId, { kind: 'note', text: `The student chose ${course} at ${uni.name}${text(body.intake) ? ` (${text(body.intake)})` : ''} on Universities.` }, by);
      // One open task for the Application Team about the shortlist; a later choice is added to it as an update.
      const WORDS = 'chose courses on Universities: look at the shortlist';
      const open = (cards.get(rowId).tasks || []).find((x) => !x.done && x.team === 'application' && x.text.includes(WORDS));
      if (open) cards.commentTask(rowId, open.id, `Also chose ${course} at ${uni.name}.`, by);
      else cards.addTask(rowId, { team: 'application', text: `${nameOf(found.row) || 'The student'} ${WORDS} (University options) and advise`, tag: 'application', priority: 'high' }, by);
      activity.record(req, req.user, 'Edited student card', { app: 'Universities', changes: [`${nameOf(found.row)} chose ${course} at ${uni.name} on Universities`] });
      sendJSON(res, 200, { ok: true, items: mine() });
      return true;
    }
    // The page of a course on the university's website (course-finder.js), remembered once found.
    // The courses of one university as Universities lists them (the general list and each intake), each with the page of the course
    // when it is known, so a course in Universities opens its own page.
    if (urlPath === '/api/fact-courses' && req.method === 'GET') {
      const uid = text(new URL(req.url, 'http://x').searchParams.get('university'));
      const uni = facts.all().find((u) => u.id === uid);
      if (!uni) { sendJSON(res, 404, { error: 'No such university.' }); return true; }
      const links = courseLinks.all(facts.all());
      // A course checked on the university's website and not found there carries a warning, for a person to add the link by hand.
      const miss = courseSitemaps ? courseSitemaps.missingFor(uid) : null;
      const linkOf = (c) => links[linkKey(uid, c)] || links[linkKey(uid, c.replace(/\s*\([^)]*\)\s*$/, '').trim())] || '';
      const shape = (block) => parseCourses(block).map((c) => { const link = linkOf(c.course); return { course: c.course, group: c.group, link, notFound: !link && Boolean(miss && miss.courses.has(c.course.toLowerCase())) }; });
      sendJSON(res, 200, { id: uid, general: shape(uni.courses), intakes: Object.fromEntries((uni.intakes || []).map((i) => [i.name, shape(i.courses)])), canFind: !Teams.isReadOnly(req.user) });
      return true;
    }
    // The partners an application can go through, for the universities asked about (?u=Name&u=Name), with the one to suggest.
    if (urlPath === '/api/application-partners' && req.method === 'GET') {
      if (Teams.isReadOnly && Teams.isReadOnly(req.user)) { sendJSON(res, 403, { error: 'Your account can only look.' }); return true; }
      if (req.user.role === 'student') { sendJSON(res, 403, { error: 'Not for a student login.' }); return true; }
      const names = new URL(req.url, 'http://x').searchParams.getAll('u').map((x) => text(x).slice(0, 160)).filter(Boolean).slice(0, 30);
      sendJSON(res, 200, applicationPartners(names));
      return true;
    }
    if (urlPath === '/api/course-link' && req.method === 'POST') {
      if (Teams.isReadOnly && Teams.isReadOnly(req.user)) { sendJSON(res, 403, { error: 'Your account can only look.' }); return true; }
      const body = await bodyOf(req, res, 16 * 1024);
      if (!body) return true;
      const university = text(body.university).slice(0, 160);
      const course = text(body.course).slice(0, 240);
      if (!university || !course) { sendJSON(res, 400, { error: 'The university and the course are needed.' }); return true; }
      const known = courseLinks.all(facts.all())[linkKey(body.universityId, course)];
      if (known) { sendJSON(res, 200, { link: known, remembered: true }); return true; }
      const uni = facts.all().find((u) => u.id === body.universityId);
      const found = courseLinker ? await courseLinker.lookup({ university, course, hosts: uni ? hostsOf(uni) : [] }) : { link: '', error: 'Not available.' };
      if (found.link && (!uni || !hostsOf(uni).length || onHosts(found.link, hostsOf(uni)))) courseLinks.remember(body.universityId, course, found.link);
      sendJSON(res, 200, found);
      return true;
    }
    return false;
  }

  return { handle, rowIndex, applicationsOf, canSee, canChange, visibleStudents, courseIndex, brief, followUp, note, advisorChange };
}

module.exports = { createPortalApi, NEW_STUDENT_COLUMNS };
