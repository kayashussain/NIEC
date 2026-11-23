// The Mock Team's own pages (the owner, 22 Nov 2026): Bookings (mock-bookings.js), the student's booking page (/book/<name>, no
// login) and Interview guidelines (mock-guidelines.js).
//
//   Bookings          the Mock Team's own people manage their own link, slots and bookings; Admin sees every person's bookings and
//                     answers for anyone; the Manager looks. Nobody else.
//   The booking page  open to anyone with the link: it shows only free times, never a student or another booking. A student's own
//                     booking opens by the secret address in their email (/booking/<code>), with change and cancel.
//   Guidelines        Admin and the Mock Team upload and remove; the Manager downloads; nobody else.

const fs = require('fs');
const path = require('path');
const { sendJSON, send, readJSONBody, readRawBody, clientIp } = require('../shared/server-utils');
const Teams = require('../shared/teams');
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
  if (Teams.isAdmin(user) || (user.departments || []).includes('mock')) return 'edit';
  return Teams.isManager(user) ? 'view' : null;
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
  function matchStudent(email) {
    const e = text(email).toLowerCase();
    if (!e) return null;
    const wb = portal.rowIndex();
    const sheets = new Set([...wb.values()].map((x) => x.sheet));
    const intake = Teams.newestSheet([...sheets].filter((x) => !x.hidden));
    for (const { sheet, row } of wb.values()) {
      if (!row || !row._id || sheet !== intake || text(row[STATUS]) !== 'Mock Stage' || text(row.EMAIL).toLowerCase() !== e) continue;
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
  async function emailStudent(b, kind, site) {
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
  async function emailOwner(b, cancelled = false) {
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
    for (const { booking, kind } of bookings.dueReminders()) {
      bookings.markSent(booking.id, kind); // marked first: a reminder is never sent twice, even when the mailbox is slow
      await emailStudent(booking, kind);
    }
  }

  // ---- the lists of the Bookings page ----
  function viewOf(b, withOwner) {
    const p = bookings.person(b.owner);
    const out = {
      id: b.id, day: b.day, time: b.time, minutes: b.minutes, dayLabel: bookings.niceDay(b.day), timeLabel: bookings.niceTime(b.time),
      name: b.name, email: b.email, phone: b.phone, rowId: b.rowId || '', mock: b.mock || 0, university: b.university || '', course: b.course || '',
      teams: p.teams || '', status: b.status, answer: b.answer || null,
    };
    if (withOwner) out.owner = p.shown || '';
    return out;
  }
  function pageFor(user) {
    const access = bookingsAccess(user);
    const data = bookings.all();
    const t = now().getTime();
    const mine = (b) => access !== 'own' || b.owner === user.id;
    const p = bookings.person(user.id);
    const visible = new Map(portal.visibleStudents(user).map(({ row, sheet }) => [row._id, { row, sheet }]));
    const upcoming = data.bookings.filter((b) => mine(b) && b.status === 'booked' && bookings.endOf(b) > t)
      .sort((a, b) => bookings.startOf(a) - bookings.startOf(b)).map((b) => viewOf(b, access !== 'own'));
    // The window after a mock: only the person's own mocks (Admin answers from a booking of their own too).
    const waiting = data.bookings.filter((b) => b.owner === user.id && b.status === 'booked' && !b.answer && bookings.startOf(b) <= t)
      .sort((a, b) => bookings.startOf(a) - bookings.startOf(b)).map((b) => viewOf(b, false))
      .map((v) => (v.rowId && (access === 'all' || visible.has(v.rowId)) ? v : { ...v, rowId: '' })); // not one of theirs: the window asks who it was
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
      else if (!comingFor.has(rowId) && held < 4) next.push({ ...item, nextMock: [1, 2, 3, 4].find((n) => !text(found.row[`MOCK SCHEDULE ${n}`])) || 0, noShow: !b.answer.joined });
    }
    // The students a booking that matched nobody can be given to (the Mock Stage students this account sees).
    const students = [...visible.values()].filter(({ row }) => text(row[STATUS]) === 'Mock Stage').map(({ row }) => ({ id: row._id, name: nameOf(row) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      access, me: { ...p, setUp: bookings.isSetUp(p), name: user.name }, mailReady: Boolean(office()),
      upcoming, waiting: access === 'view' ? [] : waiting, ready: ready.sort((a, b) => a.name.localeCompare(b.name)), next: next.sort((a, b) => a.name.localeCompare(b.name)),
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
    bookings.all().bookings.filter((b) => b.rowId && b.status === 'booked' && !b.answer && bookings.endOf(b) > t)
      .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
      .forEach((b) => { if (!out.has(b.rowId)) out.set(b.rowId, { day: b.day, time: b.time, mock: Number(b.mock) || 0 }); });
    return out;
  };
  const comingRows = () => { const t = now().getTime(); return new Set(bookings.all().bookings.filter((b) => b.rowId && b.status === 'booked' && !b.answer && bookings.endOf(b) > t).map((b) => b.rowId)); };

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
    const rowId = b.rowId && sees(b.rowId) ? b.rowId : text(body.rowId);
    if (!rowId) return { status: 400, error: 'Choose the student this mock was with.' };
    const found = portal.rowIndex().get(rowId);
    if (!found) return { status: 404, error: 'That student is no longer on the sheet.' };
    if (!sees(rowId)) return { status: 403, error: 'That student is not one of your students.' };
    const n = slotFor(found.row, b.day); // the slot of this mock's day, a planned mock without feedback, or the first empty one
    if (!n) return { status: 400, error: 'All four mocks are already recorded for this student. Correct them on the student card.' };
    const out = portal.writeCardColumns(req, rowId, { [`MOCK SCHEDULE ${n}`]: b.day, [`FEEDBACK ${n}`]: feedback });
    if (out.error) return { status: out.status || 400, error: out.error };
    bookings.answer(b.id, { joined: true, feedback, result: body.result, by: req.user.name, rowId, mock: n });
    if (body.result === 'again' && n < 4) {
      cards.addTask(rowId, { team: 'mock', text: `Mock ${n + 1} is next: Mock ${n} said the student needs another mock`, tag: 'mock', priority: 'high' }, 'ISR (automatic)');
    }
    activity.record(req, req.user, 'Edited student card', { app: 'Bookings', changes: [`${nameOf(found.row)}: Mock ${n} on ${bookings.niceDay(b.day)}, ${body.result === 'ready' ? 'ready for the final interview' : 'needs another mock'}`] });
    return { status: 200, body: { ok: true, mock: n } };
  }

  // ---- rate limit for the page without a login ----
  const tries = new Map(); // ip -> [times]
  // Only bookings, moves and cancels that went through are counted, 20 an hour from one address (the per-email limit stops the rest):
  // behind a second proxy many students may share one address, and a typing mistake must never lock them out.
  function tooMany(req, max = 20) {
    const ip = clientIp(req) || 'unknown';
    const t = Date.now();
    const list = (tries.get(ip) || []).filter((x) => t - x < 3600000);
    tries.set(ip, list);
    return list.length >= max;
  }
  function counted(req) {
    const ip = clientIp(req) || 'unknown';
    tries.set(ip, [...(tries.get(ip) || []), Date.now()]);
    if (tries.size > 5000) tries.delete(tries.keys().next().value);
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

  // Answers before the login: the booking page and its data. Returns true when it answered.
  async function handlePublic(req, res, urlPath, serveStatic) {
    if (req.method === 'GET' && (/^\/book\/[a-z0-9-]{3,40}$/.test(urlPath) || /^\/booking\/[A-Za-z0-9_-]{20,40}$/.test(urlPath))) {
      req.url = '/book.html';
      serveStatic(req, res);
      return true;
    }
    if (req.method === 'GET' && ['/book-page.js', '/book.css'].includes(urlPath)) { serveStatic(req, res); return true; }
    let m = urlPath.match(/^\/api\/book\/([a-z0-9-]{3,40})$/);
    if (m) {
      const owner = bookings.ownerBySlug(m[1]);
      if (!owner) { sendJSON(res, 404, { error: 'This booking link is not open. Please ask the consultancy for the right link.' }); return true; }
      const p = bookings.person(owner);
      if (req.method === 'GET') { sendJSON(res, 200, { with: p.shown || 'The Mock Team', company: company(), ...bookings.freeSlots(owner) }); return true; }
      if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
      if (tooMany(req)) { sendJSON(res, 429, { error: 'Too many tries. Please wait a while and try again.' }); return true; }
      const body = await bodyOf(req, res);
      if (!body) return true;
      // At most two bookings to come for one email address, so the page cannot fill a calendar or send many emails to one address.
      const mail = text(body.email).toLowerCase();
      const t0 = now().getTime();
      if (mail && bookings.all().bookings.filter((x) => x.status === 'booked' && x.email === mail && bookings.endOf(x) > t0).length >= 2) { sendJSON(res, 400, { error: 'You already have two mock interviews booked. Change or cancel one from its email first.' }); return true; }
      const made = bookings.book(owner, { day: body.day, time: body.time, name: body.name, email: body.email, phone: body.phone }, matchStudent, siteOf(owner));
      if (made.error) { sendJSON(res, 400, { error: made.error }); return true; }
      const b = made.booking;
      activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} booked a mock with ${p.shown || 'the Mock Team'} on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}${b.rowId ? '' : ' (not matched to a student yet)'}`] });
      counted(req);
      const sent = await emailStudent(b, 'booked', siteOf(owner));
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
      if (tooMany(req)) { sendJSON(res, 429, { error: 'Too many tries. Please wait a while and try again.' }); return true; }
      if (!bookings.changeable(b)) { sendJSON(res, 400, { error: b.status === 'booked' ? 'It is too close to the mock to change it now. Please contact the consultancy.' : 'This booking is already cancelled.' }); return true; }
      if (m[2] === '/cancel') {
        const out = bookings.cancel(b.id, `${b.name} (the student)`);
        if (out.error) { sendJSON(res, 400, { error: out.error }); return true; }
        counted(req);
        activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} cancelled the mock on ${bookings.niceDay(b.day)} at ${bookings.niceTime(b.time)}`] });
        emailStudent(out.booking, 'cancelled').catch(() => {});
        emailOwner(out.booking, true).catch(() => {});
        sendJSON(res, 200, { ok: true, booking: publicBooking(out.booking) });
        return true;
      }
      const body = await bodyOf(req, res);
      if (!body) return true;
      // Another time: the new time is booked first (with this booking's own slot free for it), then this one is cancelled.
      const made = bookings.book(b.owner, { day: body.day, time: body.time, name: b.name, email: b.email, phone: b.phone, except: b.id }, () => (b.rowId ? { rowId: b.rowId, mock: b.mock, university: b.university, course: b.course } : null), siteOf(b.owner));
      if (made.error) { sendJSON(res, 400, { error: made.error }); return true; }
      bookings.cancel(b.id, `${b.name} (moved to another time)`);
      activity.record(req, { id: 'student', label: `${b.name} (booking page)` }, 'Booked mock', { app: 'Bookings', changes: [`${b.name} moved the mock from ${bookings.niceDay(b.day)} ${bookings.niceTime(b.time)} to ${bookings.niceDay(made.booking.day)} ${bookings.niceTime(made.booking.time)}`] });
      counted(req);
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
      const m = urlPath.match(/^\/api\/bookings\/([a-f0-9]{12})\/(answer|cancel)$/);
      if (!m) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      const b = bookings.get(m[1]);
      if (!b || (access === 'own' && b.owner !== req.user.id)) { sendJSON(res, 404, { error: 'No such booking.' }); return true; }
      if (m[2] === 'cancel') {
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
      if (!access) { sendJSON(res, 403, { error: 'Interview guidelines is for the Mock Team.' }); return true; }
      if (urlPath === '/api/guidelines' && req.method === 'GET') {
        const files = guidelines.list();
        const count = new Map();
        files.forEach((f) => { const k = f.university.toLowerCase(); count.set(k, (count.get(k) || 0) + 1); });
        const listed = facts.list('').map((u) => ({ id: u.id, name: u.name, city: u.city || '', count: count.get(String(u.name).toLowerCase()) || 0 }));
        const names = new Set(listed.map((u) => u.name.toLowerCase()));
        // A file kept for a University no longer in Universities stays listed under its own name.
        [...new Set(files.map((f) => f.university))].filter((n) => !names.has(n.toLowerCase())).forEach((n) => listed.push({ id: '', name: n, city: '', count: count.get(n.toLowerCase()) || 0 }));
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

  return { handle, handlePublic, tick, matchStudent, pageFor, unanswered, comingRows, nextBooked };
}

module.exports = { createMockTeamApi, bookingsAccess, guidelinesAccess };
