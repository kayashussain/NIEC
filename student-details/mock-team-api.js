// The Mock Team's own pages (the owner, 22 Nov 2026): Bookings (mock-bookings.js), the student's booking page (/book/<name>, no
// login) and Interview guidelines (mock-guidelines.js).
//
//   Bookings          the Mock Team's own people manage their own link, slots and bookings; Admin sees every person's bookings and
//                     answers for anyone; the Manager looks. Nobody else.
//   The booking page  open to anyone with the link: it shows only free times, never a student or another booking. A student's own
//                     booking opens by the secret address in their email (/booking/<code>), with change and cancel.
//   Guidelines        Admin and the Mock Team upload and remove; every other team, the Manager and the branches read them on screen
//                     and download them (the owner, 27 Nov 2026); a student account has no way in.

const fs = require('fs');
const path = require('path');
const { sendJSON, send, readJSONBody, readRawBody, clientIp } = require('../shared/server-utils');
const Teams = require('../shared/teams');
const { logoFinder } = require('./uni-logos');
const { docxPreview } = require('./docx-preview');
const { calendarInvite, RESULTS } = require('./mock-bookings');
const { MAX_FILE_BYTES } = require('./direct');
const { isoDate } = require('./dashboard-stats');

const text = (v) => String(v ?? '').trim();
const STATUS = 'APPLICATION STATUS';
const nameOf = (row) => [row['FIRST NAME'], row['LAST NAME']].map(text).filter(Boolean).join(' ') || 'A student without a name';
const htmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const bookingsAccess = (user) => {
  if (!user || Teams.isStudent(user)) return null;
  if (Teams.isAdmin(user)) return 'all';
  if (Teams.isManager(user) && !(user.departments || []).includes('mock')) return 'view';
  return (user.departments || []).includes('mock') ? 'own' : (Teams.isManager(user) ? 'view' : null);
};
const guidelinesAccess = (user) => {
  if (!user || Teams.isStudent(user)) return null;
  return Teams.isAdmin(user) || (user.departments || []).includes('mock') ? 'edit' : 'view';
};

function createMockTeamApi({ bookings, guidelines, portal, cards, facts, accounts, activity, mailer, company, siteUrlOf, configuredSite = () => '', now = () => new Date() }) {
  // ---- who the student is ----
  // The student with this email or phone, in the newest intake first (Mock Stage first), with the next mock not held yet (0 when all
  // four are held).
  const phoneKey = (v) => { const d = text(v).replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
  // The review of 22 Nov 2026: only by the email (a phone alone could be anyone's), and only a Mock Stage student of the newest intake,
  // the students the Mock Team has. Nothing about the student is ever shown on the open page; a student who already has all four mocks
  // is booked as not matched, so the page never tells whether someone is on the sheet.
  // Which mock slot a mock goes into (the deep review, 22 Nov 2026), the same way the task flow already does it: a slot whose day is
  // this mock's day and has no feedback; else the first slot with a day but no feedback (a mock planned from a task); else the first
  // empty slot. 0 when all four are held with their feedback.
  function slotFor(row, day = '') {
    const d = (n) => isoDate(row[`MOCK SCHEDULE ${n}`]);
    const fb = (n) => text(row[`FEEDBACK ${n}`]);
    return [1, 2, 3, 4].find((n) => day && d(n) === day && !fb(n))
      || [1, 2, 3, 4].find((n) => text(row[`MOCK SCHEDULE ${n}`]) && !fb(n))
      || [1, 2, 3, 4].find((n) => !text(row[`MOCK SCHEDULE ${n}`])) || 0;
  }
  // Anyone can type any email, so the email alone must not tie a booking to a student's card (it would take that student's next mock
  // number and drop them from the lists): the name typed on the booking page must also share a word with the name on the card. A student
  // who writes a different name is booked as not matched, and the Mock person picks the student in the window after the mock.
  const words = (v) => text(v).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z]+/).filter((w) => w.length >= 2);
  function nameFits(typed, row) {
    const card = new Set(words(`${row['FIRST NAME'] || ''} ${row['LAST NAME'] || ''}`));
    return words(typed).some((w) => card.has(w));
  }
  function matchStudent(email, _phone, name) {
    const e = text(email).toLowerCase();
    if (!e) return null;
    const wb = portal.rowIndex();
    const sheets = new Set([...wb.values()].map((x) => x.sheet));
    const intake = Teams.newestSheet([...sheets].filter((x) => !x.hidden));
    for (const { sheet, row } of wb.values()) {
      if (!row || !row._id || sheet !== intake || text(row[STATUS]) !== 'Mock Stage' || text(row.EMAIL).toLowerCase() !== e) continue;
      if (!nameFits(name, row)) return null;
      const n = slotFor(row);
      if (!n) return null;
      return { rowId: row._id, mock: n, university: text(row['UNIVERSITY NAME']), course: text(row['COURSE NAME']) };
    }
    return null;
  }

  // The address in the emails' links: the site's own address (SITE_URL, or the email settings), else the one the Mock Team person used
  // when they saved Setup (logged in), never the address an anonymous visitor's request names.
  const siteOf = (ownerId) => configuredSite() || text(bookings.person(ownerId).site);

  // ---- emails ----
  const office = () => accounts.emailConfig();
  async function mail(to, subject, html, plain, attachments = []) {
    const cfg = office();
    if (!cfg || !to) return 'not-sent';
    try {
      await mailer.sendMail({ ...cfg, fromName: company() || undefined }, { to, subject, html, text: plain, attachments, auto: true });
      return 'sent';
    } catch (e) {
      console.error('[bookings] email not sent:', e.message);
      return 'failed';
    }
  }
  const linkOf = (b, site) => `${String(site || b.siteUrl || '').replace(/\/+$/, '')}/booking/${b.token}`;
  function detailsBlock(b, p) {
    const rows = [
      ['When', `${bookings.niceDay(b.day)}, ${bookings.niceTime(b.time)} (${b.minutes} minutes, Nepal time)`],
      ['Where', 'Microsoft Teams, online'],
      ['With', p.shown || 'The Mock Team'],
      ...(b.university ? [['University', b.university]] : []),
      ...(b.course ? [['Course', b.course]] : []),
      ...(b.mock ? [['Mock', `Mock ${b.mock}`]] : []),
    ];
    return {
      html: `<table style="border-collapse:collapse;margin:14px 0;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:4px 18px 4px 0;color:#333">${htmlEsc(k)}</td><td style="padding:4px 0;color:#000;font-weight:600">${htmlEsc(v)}</td></tr>`).join('')}</table>`,
      text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    };
  }
  // A mock still to come is described with the student's university and course as they are now; the saved copy is kept when there is no row.
  const asNow = (b) => { const live = b.rowId && !b.answer ? portal.rowIndex().get(b.rowId) : null; return live ? { ...b, university: text(live.row['UNIVERSITY NAME']) || b.university, course: text(live.row['COURSE NAME']) || b.course } : b; };
  async function emailStudent(given, kind, site) {
    const b = asNow(given);
    const p = bookings.person(b.owner);
    const d = detailsBlock(b, p);
    const first = text(b.name).split(/\s+/)[0] || 'there';
    const heading = { booked: 'Your mock interview is booked.', dayBefore: 'A reminder: your mock interview is tomorrow.', hourBefore: 'A reminder: your mock interview starts in an hour.', cancelled: 'Your mock interview is cancelled.' }[kind];
    const subject = { booked: 'Your mock interview', dayBefore: 'Tomorrow: your mock interview', hourBefore: 'In one hour: your mock interview', cancelled: 'Your mock interview is cancelled' }[kind] + `: ${bookings.niceDay(b.day)}, ${bookings.niceTime(b.time)}`;
    const join = kind === 'cancelled' ? '' : `<p style="margin:18px 0"><a href="${htmlEsc(p.teams)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 26px;border-radius:980px;font-weight:600">Join the mock in Teams</a></p>`;
    const tips = kind === 'cancelled' ? '<p>You can book another time from the same link whenever you are ready.</p>'
      : '<p>Please join 5 minutes early from a quiet room, with your camera on. Keep your passport, offer letter and finance papers near you. It is practice for your University\'s credibility interview, so please treat it like the real one.</p>';
    const change = kind === 'cancelled' ? '' : `<p style="color:#333;font-size:14px">Need another time? <a href="${htmlEsc(linkOf(b, site))}">Change or cancel the booking</a>.</p>`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:16px;line-height:1.5;color:#000"><p>Dear ${htmlEsc(first)},</p><p>${heading}</p>${d.html}${join}${tips}${change}<p>${htmlEsc(p.shown || 'The Mock Team')}</p></div>`;
    const plain = `Dear ${first},\n\n${heading}\n\n${d.text}\n${kind === 'cancelled' ? '' : `\nJoin in Teams: ${p.teams}\n`}\n${kind === 'cancelled' ? '' : `Change or cancel: ${linkOf(b, site)}\n\n`}${p.shown || 'The Mock Team'}`;
    return mail(b.email, subject, html, plain);
  }
  async function emailOwner(given, cancelled = false) {
    const b = asNow(given);
    const p = bookings.person(b.owner);
    if (!p.email) return 'not-sent';
    const start = bookings.momentOf(b.day, b.time);
    const end = new Date(start.getTime() + b.minutes * 60000);
    const title = `Mock interview${b.mock ? ` ${b.mock}` : ''}: ${b.name}`;
    const description = [`Student: ${b.name}`, b.university && `University: ${b.university}`, b.course && `Course: ${b.course}`, `Email: ${b.email}`, b.phone && `Phone: ${b.phone}`, `Join in Teams: ${p.teams}`].filter(Boolean).join('\n');
    const ics = calendarInvite({ booking: { ...b, status: cancelled ? 'cancelled' : 'booked' }, start, end, title, description, location: p.teams, organizer: p.email });
    const d = detailsBlock(b, p);
    const head = cancelled ? `${b.name} cancelled the mock interview.` : `${b.name} booked a mock interview with you.`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:16px;line-height:1.5;color:#000"><p>${htmlEsc(head)}</p>${d.html}<p>${cancelled ? 'The time is free again on your booking link.' : 'The calendar invite is attached: open it to add the mock to your calendar.'}</p></div>`;
    return mail(p.email, `${cancelled ? 'Cancelled' : 'Booked'}: ${title}, ${bookings.niceDay(b.day)} ${bookings.niceTime(b.time)}`, html, `${head}\n\n${d.text}`, [{ name: 'mock-interview.ics', type: `text/calendar; charset=UTF-8; method=${cancelled ? 'CANCEL' : 'PUBLISH'}`, data: Buffer.from(ics, 'utf8') }]);
  }
  // The reminders, every few minutes (server.js).
  async function tick() {
    askAllFeedback();
    for (const { booking, kind } of bookings.dueReminders()) {
      bookings.markSent(booking.id, kind); // marked first: a reminder is never sent twice, even when the mailbox is slow
      // A send that failed (the mailbox was down for a moment) is tried again at the next round, three times at most (an address the mail
      // server always refuses must not be tried every five minutes for a day); "not set up" is not retried.
      const tries = Number((booking.sent || {})[`${kind}Tries`]) || 0;
      if ((await emailStudent(booking, kind)) === 'failed') bookings.markSent(booking.id, kind, tries + 1 >= 3, tries + 1);
    }
  }

  // Bookings still to be answered that matched nobody are tried again (the same careful rule: email and a name that fits).
  function relink() {
    bookings.all().bookings.filter((b) => !b.rowId && b.status === 'booked' && !b.answer).forEach((b) => {
      const m = matchStudent(b.email, b.phone, b.name);
      if (m) bookings.link(b.id, m);
    });
  }

  // ---- the lists of the Bookings page ----
  // A student's mocks that are booked and not answered are numbered by their date, not by the order they were booked in.
  function renumber(list) {
    const by = new Map();
    list.forEach((b) => { if (b.rowId && b.status === 'booked' && !b.answer && Number(b.mock)) { if (!by.has(b.rowId)) by.set(b.rowId, []); by.get(b.rowId).push(b); } });
    const out = new Map();
    by.forEach((arr) => {
      const nums = arr.map((b) => Number(b.mock)).sort((x, y) => x - y);
      arr.slice().sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`)).forEach((b, i) => out.set(b.id, nums[i]));
    });
    return out;
  }
  let numbers = new Map();
  function viewOf(b, withOwner) {
    const p = bookings.person(b.owner);
    // The university and course are read from the student's row as it is now (the copy taken at booking time only when there is no row), so
    // this list never names another university than the card does.
    const live = b.rowId ? portal.rowIndex().get(b.rowId) : null;
    const out = {
      id: b.id, day: b.day, time: b.time, minutes: b.minutes, dayLabel: bookings.niceDay(b.day), timeLabel: bookings.niceTime(b.time),
      name: b.name, email: b.email, phone: b.phone, rowId: b.rowId || '', mock: numbers.get(b.id) || b.mock || 0, university: (live && text(live.row['UNIVERSITY NAME'])) || b.university || '', course: (live && text(live.row['COURSE NAME'])) || b.course || '',
      teams: p.teams || '', status: b.status, answer: b.answer || null,
    };
    if (withOwner) out.owner = p.shown || '';
    return out;
  }
  function pageFor(user) {
    relink();
    const access = bookingsAccess(user);
    const data = bookings.all();
    numbers = renumber(data.bookings);
    const t = now().getTime();
    const mine = (b) => access !== 'own' || b.owner === user.id;
    const p = bookings.person(user.id);
    const visible = new Map(portal.visibleStudents(user).map(({ row, sheet }) => [row._id, { row, sheet }]));
    const upcoming = data.bookings.filter((b) => mine(b) && b.status === 'booked' && bookings.endOf(b) > t)
      .sort((a, b) => bookings.startOf(a) - bookings.startOf(b)).map((b) => viewOf(b, access !== 'own'));
    // The window after a mock: only the person's own mocks (Admin answers from a booking of their own too).
    const waiting = data.bookings.filter((b) => b.owner === user.id && b.status === 'booked' && !b.answer && bookings.startOf(b) <= t)
      .sort((a, b) => bookings.startOf(a) - bookings.startOf(b)).map((b) => viewOf(b, false))
      .map((v) => (v.rowId && (access === 'all' || visible.has(v.rowId) || portal.rowIndex().get(v.rowId)) ? v : { ...v, rowId: '' })); // the person's own booking keeps its student; a student gone from the sheet is asked for
    // The latest answer of each student, and who has a mock booked to come.
    const last = new Map();
    const comingFor = new Set();
    data.bookings.forEach((b) => {
      if (!b.rowId) return;
      if (b.answer && (!last.has(b.rowId) || last.get(b.rowId).answer.at < b.answer.at)) last.set(b.rowId, b);
      if (b.status === 'booked' && !b.answer && bookings.endOf(b) > t) comingFor.add(b.rowId);
    });
    const ready = []; const next = [];
    for (const [rowId, b] of last) {
      const found = visible.get(rowId);
      if (!found || text(found.row[STATUS]) !== 'Mock Stage') continue;
      const held = [1, 2, 3, 4].filter((n) => text(found.row[`MOCK SCHEDULE ${n}`])).length;
      const item = { rowId, name: nameOf(found.row), university: text(found.row['UNIVERSITY NAME']), course: text(found.row['COURSE NAME']), held };
      if (b.answer.joined && b.answer.result === 'ready') { if (!text(found.row['PRE CAS INTERVIEW'])) ready.push(item); }
      else if (!comingFor.has(rowId) && held < 4) next.push({ ...item, nextMock: [1, 2, 3, 4].find((n) => !text(found.row[`MOCK SCHEDULE ${n}`])) || 0, noShow: !b.answer.joined, bookingId: b.answer.joined ? '' : b.id });
    }
    // The students a booking that matched nobody can be given to (the Mock Stage students this account sees).
    const students = [...visible.values()].filter(({ row }) => text(row[STATUS]) === 'Mock Stage').map(({ row }) => ({ id: row._id, name: nameOf(row) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      access, me: { ...p, setUp: bookings.isSetUp(p), name: user.name }, mailReady: Boolean(office()),
      upcoming, waiting: access === 'view' ? [] : waiting.filter((v) => !v.rowId), /* a matched student's mock is answered in its Feedback task (the owner, 26 Nov 2026) */ ready: ready.sort((a, b) => a.name.localeCompare(b.name)), next: next.sort((a, b) => a.name.localeCompare(b.name)),
      students: access === 'view' ? [] : students,
    };
  }
  // The Mock Team's own lines on Today, Missing details (portal-api.js asks): mocks not answered yet.
  function unanswered(user) {
    const t = now().getTime();
    return bookings.all().bookings.filter((b) => b.owner === user.id && b.status === 'booked' && !b.answer && bookings.startOf(b) <= t);
  }
  // Each student's next booked mock that is not over yet (the Mock Team's Today shows it on the task: the owner, 23 Nov 2026).
  const nextBooked = () => {
    const t = now().getTime(); const out = new Map();
    const nums = renumber(bookings.all().bookings);
    bookings.all().bookings.filter((b) => b.rowId && b.status === 'booked' && !b.answer && bookings.endOf(b) > t)
      .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
      .forEach((b) => { if (!out.has(b.rowId)) out.set(b.rowId, { day: b.day, time: b.time, mock: Number(nums.get(b.id) || b.mock) || 0 }); });
    return out;
  };
  const comingRows = () => { const t = now().getTime(); return new Set(bookings.all().bookings.filter((b) => b.rowId && b.status === 'booked' && !b.answer && bookings.endOf(b) > t).map((b) => b.rowId)); };

  // Students with a mock booked and not answered yet, whether it is to come or has just ended: they are not 'to schedule'.
  const openRows = () => new Set(bookings.all().bookings.filter((b) => b.rowId && b.status === 'booked' && !b.answer).map((b) => b.rowId));

  // ---- the feedback task of a booked mock (the owner, 25 Nov 2026) ----
  // A student who books from the booking link gives the Mock Team a Feedback task for that day; a mock cancelled or moved takes it back.
  const feedbackWords = (b) => `Write the feedback of the mock on ${bookings.niceDay(b.day)}`;
  function askFeedback(b) {
    if (!b || !b.rowId || !cards.get(b.rowId)) return;
    const words = feedbackWords(b);
    if ((cards.get(b.rowId).tasks || []).some((x) => x.team === 'mock' && x.text === words)) return; // asked once: a task already done is never made again
    const made = cards.addTask(b.rowId, { team: 'mock', text: words, tag: 'mock-feedback', priority: 'high' }, 'Student Recruit 360 (automatic)');
    if (!made.error && b.day > cards.today()) cards.scheduleTask(b.rowId, made.task.id, { date: b.day, reason: 'On the day of the mock interview' }, 'Student Recruit 360 (automatic)', cards.today());
  }
  // The Feedback task answers the booking of that day (the owner, 26 Nov 2026): joined or not, so Bookings never asks it again.
  function answerFromTask(rowId, dayIso, { joined, feedback, by }) {
    const b = bookings.all().bookings.find((x) => x.rowId === rowId && x.status === 'booked' && !x.answer && x.day === dayIso);
    if (!b) return false;
    bookings.answer(b.id, { joined: Boolean(joined), feedback, result: '', by, rowId });
    return true;
  }
  // Every booked mock of a matched student has its Feedback task, also one booked before this was made.
  function askAllFeedback() {
    // Only mocks of the last 14 days (or the next day) of a student still at Mock Stage: old unanswered bookings never flood the team with tasks.
    const t = now().getTime();
    bookings.all().bookings.filter((b) => { if (!(b.rowId && b.status === 'booked' && !b.answer && bookings.startOf(b) <= t + 24 * 3600000 && bookings.startOf(b) >= t - 14 * 24 * 3600000)) return false; const f = portal.rowIndex().get(b.rowId); return Boolean(f) && text(f.row[STATUS]) === 'Mock Stage'; }).forEach((b) => { try { askFeedback(b); } catch (e) { /* tried again at the next round */ } });
  }
  // The mock of a student that is booked and not answered yet: the one that ended first (it is the one whose feedback is asked), else the next one to come.
  function bookingOf(rowId) {
    const t = now().getTime();
    const list = bookings.all().bookings.filter((x) => x.rowId === rowId && x.status === 'booked' && !x.answer).sort((a, b) => bookings.startOf(a) - bookings.startOf(b));
    const b = list.find((x) => bookings.startOf(x) <= t); // only a mock that has taken place: its feedback is what is asked
    return b ? { day: b.day, mock: Number(b.mock) || 0 } : null;
  }
  function dropFeedbackAsk(b) {
    if (!b || !b.rowId || !cards.get(b.rowId)) return;
    const words = feedbackWords(b);
    (cards.get(b.rowId).tasks || []).filter((x) => !x.done && x.team === 'mock' && x.text === words).forEach((x) => cards.removeTask(b.rowId, x.id, 'Student Recruit 360 (automatic)'));
  }

  // ---- the answer after a mock ----
  async function answer(req, b, body) {
    const joined = body.joined === true;
    if (body.joined !== true && body.joined !== false) return { status: 400, error: 'Say whether the student joined.' };
    if (bookings.startOf(b) > now().getTime()) return { status: 400, error: 'This mock has not started yet.' };
    if (!joined) {
      bookings.answer(b.id, { joined: false, by: req.user.name });
      activity.record(req, req.user, 'Edited student card', { app: 'Bookings', changes: [`${b.name}: did not join the mock on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}`] });
      return { status: 200, body: { ok: true } };
    }
    const feedback = String(body.feedback || '').trim();
    if (!feedback) return { status: 400, error: 'Write the feedback.' };
    if (!RESULTS.includes(body.result)) return { status: 400, error: 'Choose the result.' };
    const sees = (id) => Teams.isAdmin(req.user) || portal.visibleStudents(req.user).some(({ row }) => row._id === id);
    // A booking matched to a student this person cannot see (moved on, another intake) is given to the student chosen in the window.
    // The person's own booking keeps its student even when that student has since left their list (moved back, or on to Payment): the
    // interview happened, so it can be written. Only that booking's own student, never another one chosen from outside the list.
    const own = Boolean(b.rowId) && b.owner === req.user.id && Boolean(portal.rowIndex().get(b.rowId));
    const rowId = b.rowId && (sees(b.rowId) || own) ? b.rowId : text(body.rowId);
    const movedOn = own && rowId === b.rowId && !sees(rowId);
    if (!rowId) return { status: 400, error: 'Choose the student this mock was with.' };
    const found = portal.rowIndex().get(rowId);
    if (!found) return { status: 404, error: 'That student is no longer on the sheet.' };
    if (!sees(rowId) && !movedOn) return { status: 403, error: 'That student is not one of your students.' };
    // An interview already written for this day (from the Mock task) and not tied to another booking is this same interview: the booking is
    // tied to that mock, never written a second time as the next one. What was typed here is kept as a note on the card.
    const taken = new Set(bookings.all().bookings.filter((x) => x.id !== b.id && x.rowId === rowId && x.answer && x.answer.joined && Number(x.mock)).map((x) => Number(x.mock)));
    const written = b.day ? [1, 2, 3, 4].find((k) => !taken.has(k) && isoDate(found.row[`MOCK SCHEDULE ${k}`]) === b.day && text(found.row[`FEEDBACK ${k}`])) : 0;
    const n = written || slotFor(found.row, b.day); // else the slot of this mock's day, a planned mock without feedback, or the first empty one
    if (!n) return { status: 400, error: 'All four mocks are already recorded for this student. Correct them on the student card.' };
    if (written) {
      if (text(found.row[`FEEDBACK ${n}`]) !== feedback) cards.addNote(rowId, { kind: 'note', text: `Mock ${n}, more feedback from the booking: ${feedback}`.slice(0, 3900) }, req.user.name);
    } else {
      const cols = { [`MOCK SCHEDULE ${n}`]: b.day, [`FEEDBACK ${n}`]: feedback };
      const out = movedOn ? portal.writeHeldMock(req, rowId, cols) : portal.writeCardColumns(req, rowId, cols);
      if (out.error) return { status: out.status || 400, error: out.error };
    }
    bookings.answer(b.id, { joined: true, feedback, result: body.result, by: req.user.name, rowId, mock: n });
    // Only a student still at Mock Stage gets the next mock as a task: one who has left must not be given work, or be reached again through it.
    if (body.result === 'again' && n < 4 && !movedOn && text(found.row[STATUS]) === 'Mock Stage') {
      cards.addTask(rowId, { team: 'mock', text: `Mock ${n + 1} is next: Mock ${n} said the student needs another mock`, tag: 'mock', priority: 'high' }, 'Student Recruit 360 (automatic)');
    }
    activity.record(req, req.user, 'Edited student card', { app: 'Bookings', changes: [`${nameOf(found.row)}: Mock ${n} on ${bookings.niceDay(b.day)}, ${body.result === 'ready' ? 'ready for the final interview' : 'needs another mock'}`] });
    return { status: 200, body: { ok: true, mock: n } };
  }

  // ---- rate limit for the page without a login ----
  const tries = new Map(); // ip -> [times]
  // Only bookings, moves and cancels that went through are counted, 20 an hour from one address (the per-email limit stops the rest):
  // behind a second proxy many students may share one address, and a typing mistake must never lock them out.
  // The place is held at once, before the body is read (a burst of parallel requests used to all pass, because nothing was counted until
  // each one had been booked), and given back when the request does not go through (a typing mistake never uses up the hour).
  // Returns the function that gives the place back, or null when the address has used its 20.
  function hit(req, max = 20) {
    const ip = clientIp(req) || 'unknown';
    const t = Date.now();
    const list = (tries.get(ip) || []).filter((x) => t - x < 3600000);
    if (list.length >= max) { tries.set(ip, list); return null; }
    list.push(t);
    tries.set(ip, list);
    if (tries.size > 5000) tries.delete(tries.keys().next().value);
    return () => { const l = tries.get(ip) || []; const i = l.indexOf(t); if (i !== -1) l.splice(i, 1); };
  }
  async function bodyOf(req, res, max = 16 * 1024) {
    try { return (await readJSONBody(req, max)) || {}; } catch (e) { sendJSON(res, e.statusCode || 400, { error: e.message }); return null; }
  }
  const publicBooking = (b) => {
    const p = bookings.person(b.owner);
    return {
      status: b.status, day: b.day, time: b.time, dayLabel: bookings.niceDay(b.day), timeLabel: bookings.niceTime(b.time), minutes: b.minutes,
      name: b.name, with: p.shown || 'The Mock Team', teams: b.status === 'booked' ? p.teams : '', // nothing from the student's record
      canChange: bookings.changeable(b), slug: p.slug,
    };
  };

  // Every new booking and every move makes one booking row and sends one email, cancelled rows counted too: eight a day for one address.
  const tooManyToday = (mail, at) => Boolean(mail) && bookings.all().bookings.filter((x) => text(x.email).toLowerCase() === mail && Date.parse(x.at) > at - 86400000).length >= 8;

  // Answers before the login: the booking page and its data. Returns true when it answered.
  async function handlePublic(req, res, urlPath, serveStatic) {
    if (req.method === 'GET' && (/^\/book\/[A-Za-z0-9-]{3,40}\/?$/.test(urlPath) || /^\/booking\/[A-Za-z0-9_-]{20,40}$/.test(urlPath))) {
      req.url = '/book.html';
      serveStatic(req, res);
      return true;
    }
    if (req.method === 'GET' && ['/book-page.js', '/book.css'].includes(urlPath)) { serveStatic(req, res); return true; }
    let m = urlPath.match(/^\/api\/book\/([A-Za-z0-9-]{3,40})$/);
    if (m) {
      const owner = bookings.ownerBySlug(m[1].toLowerCase());
      if (!owner) { sendJSON(res, 404, { error: 'This booking link is not open. Please ask the consultancy for the right link.' }); return true; }
      const p = bookings.person(owner);
      if (req.method === 'GET') { sendJSON(res, 200, { with: p.shown || 'The Mock Team', company: company(), ...bookings.freeSlots(owner) }); return true; }
      if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
      const release = hit(req);
      if (!release) { sendJSON(res, 429, { error: 'Too many tries. Please wait a while and try again.' }); return true; }
      const body = await bodyOf(req, res);
      if (!body) { release(); return true; }
      // No more than 30 new bookings an hour for one person, from every address together: a real student never gets near it.
      if (bookings.all().bookings.filter((x) => x.owner === owner && Date.parse(x.at) > now().getTime() - 3600000).length >= 30) { release(); sendJSON(res, 429, { error: 'This booking page is very busy. Please try again in a little while.' }); return true; }
      // At most two bookings to come for one email address, so the page cannot fill a calendar or send many emails to one address.
      const mail = text(body.email).toLowerCase();
      const t0 = now().getTime();
      if (mail && bookings.all().bookings.filter((x) => x.status === 'booked' && x.email === mail && bookings.endOf(x) > t0).length >= 2) { release(); sendJSON(res, 400, { error: 'You already have two mock interviews booked. Change or cancel one from its email first.' }); return true; }
      // And a daily limit for one email address (see tooManyToday), so the page cannot be used to send somebody email after email.
      if (tooManyToday(mail, t0)) { release(); sendJSON(res, 400, { error: 'This email address has booked too many times today. Please try again tomorrow or contact the consultancy.' }); return true; }
      const made = bookings.book(owner, { day: body.day, time: body.time, name: body.name, email: body.email, phone: body.phone }, matchStudent, siteOf(owner));
      if (made.error) { release(); sendJSON(res, 400, { error: made.error }); return true; }
      const b = made.booking;
      try { askFeedback(b); } catch (e) { /* the booking stands without it */ }
      activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} booked a mock with ${p.shown || 'the Mock Team'} on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}${b.rowId ? '' : ' (not matched to a student yet)'}`] });
      // The page does not wait for a slow mailbox: after 2.5 seconds it answers while the email is still being sent ('pending').
      const sent = await Promise.race([emailStudent(b, 'booked', siteOf(owner)), new Promise((resolve) => { setTimeout(() => resolve('pending'), 2500); })]);
      emailOwner(b).catch(() => {});
      sendJSON(res, 200, { ok: true, token: b.token, emailed: sent === 'sent', booking: publicBooking(b) });
      return true;
    }
    m = urlPath.match(/^\/api\/booking\/([A-Za-z0-9_-]{20,40})(\/cancel|\/move|\/slots)?$/);
    if (m) {
      const b = bookings.byToken(m[1]);
      if (!b) { sendJSON(res, 404, { error: 'This booking could not be found.' }); return true; }
      if (req.method === 'GET' && !m[2]) { sendJSON(res, 200, { booking: publicBooking(b), company: company() }); return true; }
      if (req.method === 'GET' && m[2] === '/slots') { sendJSON(res, 200, bookings.changeable(b) ? bookings.freeSlots(b.owner, b.id) : { days: [], minutes: b.minutes }); return true; }
      if (req.method !== 'POST' || !m[2] || m[2] === '/slots') { send(res, 405, 'Method not allowed'); return true; }
      const release = hit(req);
      if (!release) { sendJSON(res, 429, { error: 'Too many tries. Please wait a while and try again.' }); return true; }
      if (!bookings.changeable(b)) { release(); sendJSON(res, 400, { error: b.status === 'booked' ? 'It is too close to the mock to change it now. Please contact the consultancy.' : 'This booking is already cancelled.' }); return true; }
      if (m[2] === '/cancel') {
        const out = bookings.cancel(b.id, `${b.name} (the student)`);
        if (out.error) { release(); sendJSON(res, 400, { error: out.error }); return true; }
        try { dropFeedbackAsk(b); } catch (e) { /* nothing to take back */ }
        activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} cancelled the mock on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}`] });
        emailStudent(out.booking, 'cancelled').catch(() => {});
        emailOwner(out.booking, true).catch(() => {});
        sendJSON(res, 200, { ok: true, booking: publicBooking(out.booking) });
        return true;
      }
      const body = await bodyOf(req, res);
      if (!body) { release(); return true; }
      // The booking is read again after the wait for the body: two moves sent together (a double click, two tabs) must not both go through.
      const now1 = bookings.byToken(m[1]);
      if (!now1 || !bookings.changeable(now1)) { release(); sendJSON(res, 400, { error: 'This booking was just changed. Please open your booking link again.' }); return true; }
      if (tooManyToday(text(b.email).toLowerCase(), now().getTime())) { release(); sendJSON(res, 400, { error: 'This email address has booked too many times today. Please try again tomorrow or contact the consultancy.' }); return true; }
      // Another time: the new time is booked first (with this booking's own slot free for it), then this one is cancelled.
      const made = bookings.book(b.owner, { day: body.day, time: body.time, name: b.name, email: b.email, phone: b.phone, except: b.id }, () => (b.rowId ? { rowId: b.rowId, mock: b.mock, university: b.university, course: b.course } : null), siteOf(b.owner));
      if (made.error) { release(); sendJSON(res, 400, { error: made.error }); return true; }
      bookings.cancel(b.id, `${b.name} (moved to another time)`);
      try { dropFeedbackAsk(b); askFeedback(made.booking); } catch (e) { /* the move stands */ }
      activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} moved the mock from ${bookings.niceDay(b.day)} ${bookings.niceTime(b.time)} to ${bookings.niceDay(made.booking.day)} ${bookings.niceTime(made.booking.time)}`] });
      emailStudent(made.booking, 'booked', siteOf(b.owner)).catch(() => {});
      emailOwner({ ...b, status: 'cancelled' }, true).catch(() => {}); // the old time leaves the person's calendar
      emailOwner(made.booking).catch(() => {});
      sendJSON(res, 200, { ok: true, token: made.booking.token, booking: publicBooking(made.booking) });
      return true;
    }
    return false;
  }

  // Answers the logged-in requests of Bookings and Interview guidelines. Returns true when it answered.
  async function handle(req, res, urlPath) {
    if (urlPath === '/api/bookings' || urlPath.startsWith('/api/bookings/')) {
      const access = bookingsAccess(req.user);
      if (!access) { sendJSON(res, 403, { error: 'Bookings is for the Mock Team.' }); return true; }
      if (urlPath === '/api/bookings' && req.method === 'GET') { sendJSON(res, 200, pageFor(req.user)); return true; }
      if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
      if (access === 'view') { sendJSON(res, 403, { error: 'Your account can only look at Bookings.' }); return true; }
      const body = await bodyOf(req, res, 64 * 1024);
      if (!body) return true;
      if (urlPath === '/api/bookings/setup') {
        const out = bookings.saveSetup(req.user.id, { ...body, site: siteUrlOf(req) }, `${String(req.user.name || '').split(/\s+/)[0]}, Mock Team`);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Changed settings', { app: 'Bookings', changes: [`Set up their booking link (/book/${out.person.slug}) and Teams meeting link`] });
        sendJSON(res, 200, pageFor(req.user));
        return true;
      }
      if (urlPath === '/api/bookings/slots') {
        const out = bookings.saveSlots(req.user.id, body);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Changed settings', { app: 'Bookings', changes: ['Changed their available slots and booking rules'] });
        sendJSON(res, 200, pageFor(req.user));
        return true;
      }
      const m = urlPath.match(/^\/api\/bookings\/([a-f0-9]{12})\/(answer|cancel|reopen)$/);
      if (!m) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      const b = bookings.get(m[1]);
      if (!b || (access === 'own' && b.owner !== req.user.id)) { sendJSON(res, 404, { error: 'No such booking.' }); return true; }
      if (m[2] === 'reopen') {
        const out = bookings.reopen(b.id);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Booked mock', { app: 'Bookings', changes: [`Took back the "did not join" answer for ${b.name} on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}`] });
        sendJSON(res, 200, pageFor(req.user));
        return true;
      }
      if (m[2] === 'cancel') {
        if (b.answer) { sendJSON(res, 400, { error: 'This mock is already answered, so it cannot be cancelled.' }); return true; }
        if (bookings.endOf(b) <= now().getTime()) { sendJSON(res, 400, { error: 'This mock is over. Answer it instead of cancelling it.' }); return true; }
        const out = bookings.cancel(b.id, req.user.name);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Booked mock', { app: 'Bookings', changes: [`Cancelled the mock with ${b.name} on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}`] });
        emailStudent(out.booking, 'cancelled').catch(() => {});
        emailOwner(out.booking, true).catch(() => {});
        sendJSON(res, 200, pageFor(req.user));
        return true;
      }
      if (b.status !== 'booked') { sendJSON(res, 400, { error: 'This booking was cancelled.' }); return true; }
      if (b.answer) { sendJSON(res, 400, { error: 'This mock is already answered. Correct it on the student card.' }); return true; }
      const out = await answer(req, b, body);
      if (out.error) { sendJSON(res, out.status, { error: out.error }); return true; }
      sendJSON(res, 200, pageFor(req.user));
      return true;
    }
    if (urlPath === '/api/guidelines' || urlPath.startsWith('/api/guidelines/')) {
      const access = guidelinesAccess(req.user);
      if (!access) { sendJSON(res, 403, { error: 'Interview guidelines is for the office teams.' }); return true; }
      if (urlPath === '/api/guidelines' && req.method === 'GET') {
        const files = guidelines.list();
        const count = new Map();
        files.forEach((f) => { const k = f.university.toLowerCase(); count.set(k, (count.get(k) || 0) + 1); });
        const universities = facts.list('');
        const logoOf = logoFinder(universities);
        const listed = universities.map((u) => ({ id: u.id, name: u.name, city: u.city || '', logo: logoOf(u.name), count: count.get(String(u.name).toLowerCase()) || 0 }));
        const names = new Set(listed.map((u) => u.name.toLowerCase()));
        // A file kept for a University no longer in Universities stays listed under its own name.
        [...new Set(files.map((f) => f.university))].filter((n) => !names.has(n.toLowerCase())).forEach((n) => listed.push({ id: '', name: n, city: '', logo: logoOf(n), count: count.get(n.toLowerCase()) || 0 }));
        listed.sort((a, b) => a.name.localeCompare(b.name));
        sendJSON(res, 200, { canUpload: access === 'edit', kinds: guidelines.KINDS, sources: guidelines.SOURCES, universities: listed,
          files: files.map((f) => ({ id: f.id, university: f.university, kind: f.kind, source: f.source, title: f.title, name: f.name, size: f.size, by: f.by, at: f.at, type: f.ext.slice(1).toUpperCase() })) });
        return true;
      }
      if (urlPath === '/api/guidelines' && req.method === 'POST') {
        if (access !== 'edit') { sendJSON(res, 403, { error: 'Your account can only download guidelines.' }); return true; }
        const q = new URL(req.url, 'http://x').searchParams;
        let bytes;
        try { bytes = await readRawBody(req, MAX_FILE_BYTES); } catch (e) { sendJSON(res, e.statusCode || 400, { error: e.statusCode === 413 ? 'That file is too large (the limit is 10 MB).' : e.message }); return true; }
        const known = new Set([...facts.list('').map((u) => String(u.name).toLowerCase()), ...guidelines.list().map((f) => String(f.university).toLowerCase())]);
        if (!known.has(String(q.get('university') || '').trim().toLowerCase())) { sendJSON(res, 400, { error: 'Choose a University from the list.' }); return true; }
        const out = guidelines.add({ university: q.get('university'), universityId: q.get('universityId'), kind: q.get('kind'), source: q.get('source'), title: q.get('title'), name: q.get('name'), bytes, by: req.user.name });
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        activity.record(req, req.user, 'Uploaded guideline', { app: 'Interview guidelines', changes: [`Uploaded ${out.file.title} (${out.file.kind}) for ${out.file.university}`] });
        sendJSON(res, 200, { ok: true, file: out.file });
        return true;
      }
      const m = urlPath.match(/^\/api\/guidelines\/([a-f0-9]{12})(\/delete)?$/);
      if (!m) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      if (req.method === 'GET' && !m[2]) {
        const f = guidelines.file(m[1]);
        if (!f) { sendJSON(res, 404, { error: 'No such file.' }); return true; }
        // ?view=1: read on screen (the owner, 27 Nov 2026). A PDF or a picture is shown by the browser itself; a Word document is read
        // here and sent as plain words (docx-preview.js); an old .doc file cannot be shown, so the page says to download it.
        if (new URL(req.url, 'http://x').searchParams.get('view') === '1') {
          const ext = path.extname(f.path).toLowerCase();
          if (ext === '.docx') {
            try { sendJSON(res, 200, { kind: 'word', ...docxPreview(fs.readFileSync(f.path)) }); } catch (e) { console.error('[guideline preview]', f.name, e.message); sendJSON(res, 200, { kind: 'none', reason: 'This Word document cannot be shown here. Download it to read it.' }); }
            return true;
          }
          if (ext === '.doc') { sendJSON(res, 200, { kind: 'none', reason: 'This is an old kind of Word file (.doc), which cannot be shown here. Download it to read it, or upload it again saved as .docx or PDF.' }); return true; }
          send(res, 200, fs.readFileSync(f.path), {
            'Content-Type': f.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            // The browser's own PDF reader needs no limit on what it loads; it may be framed by this site only.
            'Content-Security-Policy': ext === '.pdf' ? "frame-ancestors 'self'; base-uri 'none'; form-action 'none'" : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
            'Content-Disposition': `inline; filename="guideline${ext}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          });
          return true;
        }
        send(res, 200, fs.readFileSync(f.path), {
          'Content-Type': f.type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox; default-src 'none'",
          'Content-Disposition': `attachment; filename="guideline${path.extname(f.path)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        });
        return true;
      }
      if (req.method !== 'POST' || !m[2]) { send(res, 405, 'Method not allowed'); return true; }
      if (access !== 'edit') { sendJSON(res, 403, { error: 'Your account can only download guidelines.' }); return true; }
      const out = guidelines.remove(m[1]);
      if (out.error) { sendJSON(res, 404, { error: out.error }); return true; }
      activity.record(req, req.user, 'Uploaded guideline', { app: 'Interview guidelines', changes: [`Removed ${out.removed.title} from ${out.removed.university}`] });
      sendJSON(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  // One student's bookings for the card's Mock interviews box (the owner, 24 Nov 2026): the mock, its day and time, who takes it and,
  // once answered, whether the student joined and the result. Read only; nothing here can change a booking.
  // Numbered as the Bookings page numbers them (booked and not answered mocks by their date), so two bookings made before either was held
  // never both read "Mock 1" on the card while the Bookings page says Mock 1 and Mock 2.
  const forRow = (rowId) => { const all = bookings.all().bookings; const nums = renumber(all); return all.filter((b) => b.rowId === rowId && b.status !== 'cancelled')
    .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
    .map((b) => ({ mock: nums.get(b.id) || Number(b.mock) || 0, day: text(b.day), time: text(b.time), minutes: Number(b.minutes) || 0, by: text(bookings.person(b.owner).shown), answer: b.answer ? { joined: Boolean(b.answer.joined), result: text(b.answer.result), by: text(b.answer.by) } : null })); };
  return { handle, handlePublic, tick, matchStudent, pageFor, unanswered, comingRows, openRows, nextBooked, forRow, answerFromTask, askAllFeedback, bookingOf };
}

module.exports = { createMockTeamApi, bookingsAccess, guidelinesAccess };
