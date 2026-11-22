// Mock interview bookings (the owner, 22 Nov 2026), the Mock Team's Bookings page, works like a booking link:
//
//   Each Mock Team person sets up once (Bookings, Setup): their own Microsoft Teams meeting link (made in Teams with any Microsoft
//   account, one made with Gmail is fine: no Microsoft 365 administrator is needed), their booking link's name, the name students see
//   and the email their calendar invites go to. Then, under Available slots, how long a mock lasts and their slots: weekly slots (as
//   many in a day as they like, copied from one day to others) and slots for one date only (or a day off on that date), and two
//   booking rules (how many days ahead a student may book, and how long before a mock it can still be booked, changed or cancelled).
//
//   A student opens the person's link (/book/<name>, no login), picks a day and a free slot and books. The student gets an email with
//   the Teams link (from the consultancy's own mailbox) and the person gets a calendar invite in their own email. Reminders go the day
//   before and an hour before. The student can change or cancel from the email until the booking rule's time before the mock.
//
//   ISR finds the student by email or phone. The mock's number (1 to 4) is the next one not yet held on the student's card.
//   When a mock's time is over, Bookings asks the person, every time it is opened until answered: did the student join? If yes, the
//   feedback and the result (Ready for the final interview, or Needs another mock) are required; the day and the feedback are written to
//   MOCK SCHEDULE n and FEEDBACK n on the student's card. "Needs another mock" gives the Mock Team a task for the next mock.
//
// Everything is kept in mock-bookings.json in the data folder (never in git), written whole and atomically, and copied into the daily
// backup. Times are office time (APP_TIMEZONE, Nepal by default).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic, snapshotDaily } = require('../shared/server-utils');

const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kathmandu';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const MINUTES = [15, 20, 30, 45, 60, 90];
const AHEAD = [1, 2, 7, 14, 30];
const NOTICE = [60, 120, 240, 1440]; // minutes
const RESULTS = ['ready', 'again'];
const MAX_SLOTS_A_DAY = 24;
const MAX_DATES = 120;
const MAX_BOOKINGS = 5000;

const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max = 2000) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url');
const isEmail = (v) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(String(v || ''));
const digits = (v) => String(v || '').replace(/\D/g, '');
const toMin = (hhmm) => { const m = HHMM.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Office time: the day (YYYY-MM-DD) and the minute of the day of a moment.
const PARTS = new Map();
function officeParts(date, timeZone = TIME_ZONE) {
  let f = PARTS.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); PARTS.set(timeZone, f); }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
// The real moment of an office day and time (for the calendar invite and the reminders).
function momentOf(day, hhmm, timeZone = TIME_ZONE) {
  const [y, mo, d] = day.split('-').map(Number);
  const min = toMin(hhmm);
  let guess = Date.UTC(y, mo - 1, d, Math.floor(min / 60), min % 60);
  for (let i = 0; i < 3; i += 1) {
    const p = officeParts(new Date(guess), timeZone);
    const [py, pm, pd] = p.day.split('-').map(Number);
    const diff = (Date.UTC(y, mo - 1, d) - Date.UTC(py, pm - 1, pd)) / 60000 + (min - p.minute);
    if (!diff) break;
    guess += diff * 60000;
  }
  return new Date(guess);
}
const addDays = (day, n) => { const t = new Date(day + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekday = (day) => new Date(day + 'T00:00:00Z').getUTCDay(); // 0 Sunday
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const niceDay = (day) => `${WEEKDAYS[weekday(day)]} ${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const niceTime = (hhmm) => { const m = toMin(hhmm); const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// A Teams meeting link: only a real https address on Microsoft Teams (so a link can never run a script or lead elsewhere).
function cleanTeamsLink(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!(host === 'teams.microsoft.com' || host === 'teams.live.com' || host.endsWith('.teams.microsoft.com') || host === 'teams.microsoft.us')) return null;
  return u.toString().slice(0, 1000);
}
// A list of slots [["10:00","10:30"], ...]: real times, each ending after it starts, sorted, without overlaps, at most 24 a day.
function cleanWindows(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const w of list.slice(0, MAX_SLOTS_A_DAY)) {
    if (!Array.isArray(w) || w.length !== 2) return null;
    const a = toMin(String(w[0])); const b = toMin(String(w[1]));
    if (a === null || b === null || b <= a) return null;
    out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < out.length; i += 1) if (out[i][0] < out[i - 1][1]) return 'overlap';
  return out.map(([a, b]) => [toHHMM(a), toHHMM(b)]);
}

function blankPerson() {
  return { slug: '', shown: '', teams: '', email: '', minutes: 30, weekly: {}, dates: {}, ahead: 30, notice: 60 };
}

function createMockBookings(dir, { now = () => new Date(), timeZone = TIME_ZONE } = {}) {
  const file = path.join(dir, 'mock-bookings.json');
  let cache = null;
  function load() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return { people: {}, bookings: [] }; }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const data = { people: raw && raw.people && typeof raw.people === 'object' ? raw.people : {}, bookings: Array.isArray(raw && raw.bookings) ? raw.bookings : [] };
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
      return data;
    } catch (e) {
      // A damaged file is set aside (never written over), so nothing is lost; the page starts again empty.
      try { fs.copyFileSync(file, path.join(dir, `mock-bookings.damaged-${Date.now()}.json`)); } catch (x) { /* could not copy */ }
      return { people: {}, bookings: [] };
    }
  }
  function write(data) {
    snapshotDaily(file, dir, 'mock-bookings');
    writeFileAtomic(file, JSON.stringify(data));
    cache = null;
  }
  const nowParts = () => officeParts(now(), timeZone);
  const startOf = (b) => momentOf(b.day, b.time, timeZone).getTime();
  const endOf = (b) => startOf(b) + (Number(b.minutes) || 30) * 60000;
  const person = (id) => ({ ...blankPerson(), ...(load().people[id] || {}) });
  const isSetUp = (p) => Boolean(p && p.slug && p.teams);

  // The free slots of one person, day by day, from today to the booking rule's last day. `except`: a booking being changed (its own
  // slot is free for it).
  function freeSlots(ownerId, except = '') {
    const p = person(ownerId);
    const data = load();
    const n = nowParts();
    const nowMs = now().getTime();
    const taken = data.bookings.filter((b) => b.owner === ownerId && b.status === 'booked' && b.id !== except)
      .map((b) => ({ day: b.day, a: toMin(b.time), z: toMin(b.time) + (Number(b.minutes) || 30) }));
    const step = MINUTES.includes(Number(p.minutes)) ? Number(p.minutes) : 30;
    const days = [];
    for (let i = 0; i <= (AHEAD.includes(Number(p.ahead)) ? Number(p.ahead) : 30); i += 1) {
      const day = addDays(n.day, i);
      const windows = Object.prototype.hasOwnProperty.call(p.dates || {}, day) ? p.dates[day] : ((p.weekly || {})[String(weekday(day))] || []);
      const times = [];
      for (const [s, e] of windows) {
        for (let a = toMin(s); a + step <= toMin(e); a += step) {
          const t = toHHMM(a);
          if (momentOf(day, t, timeZone).getTime() - nowMs < (Number(p.notice) || 60) * 60000) continue; // too soon
          if (taken.some((x) => x.day === day && a < x.z && x.a < a + step)) continue;
          times.push(t);
        }
      }
      if (times.length) days.push({ day, label: niceDay(day), times: times.map((t) => ({ time: t, label: niceTime(t) })) });
    }
    return { minutes: step, days };
  }

  return {
    niceDay, niceTime, momentOf: (d, t) => momentOf(d, t, timeZone), officeNow: nowParts, startOf, endOf,
    person, isSetUp,
    all() { return load(); },
    restoreAll(data) { if (data && typeof data === 'object') write({ people: data.people || {}, bookings: Array.isArray(data.bookings) ? data.bookings : [] }); },
    ownerBySlug(slug) {
      const s = String(slug || '').toLowerCase();
      const hit = Object.entries(load().people).find(([, p]) => p && p.slug === s);
      return hit && isSetUp(hit[1]) ? hit[0] : '';
    },
    // Setup: the Teams link, the booking link's name, the name students see and the invite email.
    saveSetup(ownerId, input, fallbackName) {
      const data = load();
      const p = { ...blankPerson(), ...(data.people[ownerId] || {}) };
      const teams = cleanTeamsLink(input.teams);
      if (teams === null) return { error: 'Paste the Microsoft Teams meeting link as Teams gives it (it starts with https://teams.microsoft.com or https://teams.live.com).' };
      const slug = text(input.slug, 40).toLowerCase();
      if (!SLUG.test(slug)) return { error: 'The link name can have small letters, numbers and hyphens, 3 to 40 of them.' };
      if (Object.entries(data.people).some(([id, x]) => id !== ownerId && x && x.slug === slug)) return { error: 'That link name is taken. Choose another one.' };
      const email = text(input.email, 120).toLowerCase();
      if (email && !isEmail(email)) return { error: 'That email address does not look right.' };
      p.teams = teams;
      p.slug = slug;
      p.shown = text(input.shown, 80) || text(fallbackName, 80);
      p.email = email;
      p.updatedAt = now().toISOString();
      write({ ...data, people: { ...data.people, [ownerId]: p } });
      return { person: p };
    },
    // Available slots: how long a mock lasts, the weekly slots, the slots for one date and the booking rules.
    saveSlots(ownerId, input) {
      const data = load();
      const p = { ...blankPerson(), ...(data.people[ownerId] || {}) };
      const minutes = Number(input.minutes);
      if (!MINUTES.includes(minutes)) return { error: 'Choose how long each mock lasts.' };
      const weekly = {};
      for (let d = 0; d < 7; d += 1) {
        const w = cleanWindows((input.weekly || {})[String(d)] || []);
        if (w === null) return { error: `A slot on ${WEEKDAYS[d]} is not right: each slot needs a start and an end after it.` };
        if (w === 'overlap') return { error: `Two slots on ${WEEKDAYS[d]} overlap.` };
        if (w.length) weekly[String(d)] = w;
      }
      const dates = {};
      const today = nowParts().day;
      for (const [day, list] of Object.entries(input.dates || {}).slice(0, MAX_DATES)) {
        if (!DAY.test(day)) return { error: 'One of the dates is not a real date.' };
        if (day < today) continue; // a date that has passed is let go
        const w = cleanWindows(list || []);
        if (w === null) return { error: `A slot on ${niceDay(day)} is not right: each slot needs a start and an end after it.` };
        if (w === 'overlap') return { error: `Two slots on ${niceDay(day)} overlap.` };
        dates[day] = w; // an empty list is a day off
      }
      const ahead = Number(input.ahead);
      const notice = Number(input.notice);
      if (!AHEAD.includes(ahead) || !NOTICE.includes(notice)) return { error: 'Choose the booking rules.' };
      Object.assign(p, { minutes, weekly, dates, ahead, notice, updatedAt: now().toISOString() });
      write({ ...data, people: { ...data.people, [ownerId]: p } });
      return { person: p };
    },
    freeSlots,
    // A student books a slot. `match(email, phone)` finds the student ({ rowId, mock, university, course } or null; mock 0 when all
    // four mocks are held). Returns { booking } or { error }.
    book(ownerId, input, match, siteUrl) {
      const p = person(ownerId);
      if (!isSetUp(p)) return { error: 'This booking link is not open yet.' };
      const day = String(input.day || '');
      const time = String(input.time || '');
      const name = text(input.name, 80);
      const email = text(input.email, 120).toLowerCase();
      const phone = text(input.phone, 30);
      if (!name) return { error: 'Please write your name.' };
      if (!isEmail(email)) return { error: 'Please write your email address.' };
      if (phone && digits(phone).length < 7) return { error: 'That phone number does not look right.' };
      const free = freeSlots(ownerId, input.except || '');
      if (!DAY.test(day) || !free.days.some((d) => d.day === day && d.times.some((t) => t.time === time))) return { error: 'That time is no longer free. Please pick another one.' };
      const data = load();
      const found = match(email, phone) || null;
      if (found && found.mock === 0) return { error: 'All four mock interviews are already done. Please contact the consultancy.' };
      // Two bookings of the same student waiting at once: the second takes the next number.
      const waiting = found ? data.bookings.filter((b) => b.rowId === found.rowId && b.status === 'booked' && !b.answer && b.id !== input.except).map((b) => b.mock) : [];
      let mock = found ? found.mock : 0;
      while (found && waiting.includes(mock) && mock < 4) mock += 1;
      const start = momentOf(day, time, timeZone).getTime();
      const left = start - now().getTime();
      const b = {
        id: newId(), token: newToken(), owner: ownerId, day, time, minutes: free.minutes, name, email, phone,
        rowId: found ? found.rowId : '', mock: found ? mock : 0, university: found ? text(found.university, 160) : '', course: found ? text(found.course, 240) : '',
        status: 'booked', at: now().toISOString(), siteUrl: text(siteUrl, 200), answer: null,
        sent: { dayBefore: left < 24 * 3600000, hourBefore: left < 3600000 },
      };
      const bookings = [...data.bookings.filter((x) => x.status === 'booked' || Date.parse(x.at) > now().getTime() - 400 * 86400000), b].slice(-MAX_BOOKINGS);
      write({ ...data, bookings });
      return { booking: b, person: p };
    },
    byToken(token) {
      const t = String(token || '');
      if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) return null;
      return load().bookings.find((b) => b.token === t) || null;
    },
    get(id) { return load().bookings.find((b) => b.id === id) || null; },
    // Whether a booking can still be changed or cancelled by the student (the booking rule's time before the mock).
    changeable(b) {
      const p = person(b.owner);
      return b.status === 'booked' && startOf(b) - now().getTime() >= (Number(p.notice) || 60) * 60000;
    },
    cancel(id, byWho) {
      const data = load();
      const i = data.bookings.findIndex((b) => b.id === id);
      if (i === -1) return { error: 'No such booking.' };
      if (data.bookings[i].status !== 'booked') return { error: 'This booking is already cancelled.' };
      const bookings = [...data.bookings];
      bookings[i] = { ...bookings[i], status: 'cancelled', cancelledAt: now().toISOString(), cancelledBy: text(byWho, 80) };
      write({ ...data, bookings });
      return { booking: bookings[i] };
    },
    // The answer after a mock. { joined, feedback, result, by, mock, rowId }.
    answer(id, a) {
      const data = load();
      const i = data.bookings.findIndex((b) => b.id === id);
      if (i === -1) return { error: 'No such booking.' };
      const bookings = [...data.bookings];
      bookings[i] = { ...bookings[i], ...(a.rowId ? { rowId: a.rowId } : {}), ...(a.mock ? { mock: a.mock } : {}), answer: { joined: Boolean(a.joined), feedback: a.joined ? longText(a.feedback) : '', result: a.joined ? a.result : '', at: now().toISOString(), by: text(a.by, 80) } };
      write({ ...data, bookings });
      return { booking: bookings[i] };
    },
    markSent(id, key) {
      const data = load();
      const i = data.bookings.findIndex((b) => b.id === id);
      if (i === -1) return;
      const bookings = [...data.bookings];
      bookings[i] = { ...bookings[i], sent: { ...(bookings[i].sent || {}), [key]: true } };
      write({ ...data, bookings });
    },
    // Reminders that are due now: [{ booking, kind: 'dayBefore' | 'hourBefore' }].
    dueReminders() {
      const t = now().getTime();
      const out = [];
      for (const b of load().bookings) {
        if (b.status !== 'booked') continue;
        const left = startOf(b) - t;
        if (left <= 0) continue;
        const sent = b.sent || {};
        if (!sent.hourBefore && left <= 3600000) out.push({ booking: b, kind: 'hourBefore' });
        else if (!sent.dayBefore && left <= 24 * 3600000 && left > 3600000) out.push({ booking: b, kind: 'dayBefore' });
      }
      return out;
    },
  };
}

// The calendar invite (an .ics file) for the Mock Team person's own calendar.
function calendarInvite({ booking, start, end, title, description, location, organizer }) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); } out.push(rest); return out.join('\r\n'); };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ISR//Mock interviews//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${booking.id}@isr`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    fold(`SUMMARY:${esc(title)}`), fold(`DESCRIPTION:${esc(description)}`), fold(`LOCATION:${esc(location)}`),
    ...(organizer ? [fold(`ORGANIZER:mailto:${organizer}`)] : []),
    booking.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

module.exports = { createMockBookings, calendarInvite, cleanTeamsLink, cleanWindows, officeParts, MINUTES, AHEAD, NOTICE, RESULTS, niceDay, niceTime };
