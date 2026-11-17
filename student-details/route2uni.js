// The Route2Uni partner portal in the Fact File (the owner, 17 Nov 2026): twice a week (Monday and Thursday, 2 a.m. office time) ISR
// logs into portal.route2unigroup.com with the consultancy's own account, reads every university (entry requirements, English
// rules and waivers, language test scores, fees, scholarships, intakes with their deadlines, documents, courses) and the
// Information Hub (university deadlines, notices, webinars), and keeps the latest reading in route2uni.json in the data folder
// (never in git). Each Fact File page then shows a "From Route2Uni" section with that university's figures as of the last check,
// and the Fact File lists what changed since the check before. Nothing typed into the Fact File by a person is ever changed.
//
// The portal's login is a setting on the server only: ROUTE2UNI_EMAIL and ROUTE2UNI_PASSWORD (never in code, git or a page). Only
// portal.route2unigroup.com is called, and only to read.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic, TIME_ZONE } = require('../shared/server-utils');

const BASE = 'https://portal.route2unigroup.com/api';
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lines = (v) => (Array.isArray(v) ? v : []).map(text).filter((x) => x && x !== '-');
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// "UNIVERSITY OF EAST LONDON" as "University of East London".
const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'at']);
const niceName = (s) => text(s).toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace(/\bBathspa\b/, 'Bath Spa');
// The same university under another name on the portal (the portal's name, squashed -> the Fact File's name, squashed).
const ALIASES = { 'regent college': 'regent college london', 'university of winchester': 'winchester university', 'ravensbourne university': 'university of ravensbourne', 'roehampton university': 'university of roehampton', 'bathspa university': 'bath spa university' };
const keyOf = (name) => { const k = squash(name); return ALIASES[k] || k; };

// One university as the Fact File shows it (only what helps the team and the students; no links that expire, no internal ids).
function shape(d) {
  const b = d.basicInfo || {};
  return {
    id: d.universityId,
    name: niceName(d.universityName || b.name),
    cities: (b.cities || []).map((c) => text(c.name)).filter(Boolean),
    website: /^https?:\/\//.test(text(b.websiteUrl)) ? text(b.websiteUrl) : '',
    intakes: (d.intakePeriods || []).map((i) => ({ name: text(i.intakeName), open: Boolean(i.active), deadline: String(i.deadlineInfo || '').replace(/\r/g, '').trim().replace(/^-$/, '') })),
    requirements: (d.entryRequirements || []).map((r) => ({ level: text(r.courseLevelName), gap: r.gapAccepted ? text(r.gapYearsAllowed) || 'Accepted' : 'Not accepted', criteria: lines(r.criteria) })),
    english: (d.englishProficiency || []).map((e) => ({ level: text(e.courseLevelName), waiver: Boolean(e.hasWaiver), criteria: lines(e.criteria) })).filter((e) => e.waiver || e.criteria.length),
    tests: (d.languageTests || []).map((t) => ({ test: text(t.languageTestName), level: text(t.courseLevelName), score: text(t.requiredScore) })).filter((t) => t.score && t.score !== '-'),
    fees: (d.feeStructures || []).map((f) => ({ level: text(f.courseLevelName), items: (f.tuitionRange || []).map((x) => ({ amount: Number(x.amount) || 0, text: text(x.description) })) })),
    scholarships: (d.scholarships || []).map((s) => ({ level: text(s.courseLevelName), amounts: lines(s.amounts) })).filter((s) => s.amounts.length),
    documents: { required: (d.requiredDocuments || []).map((x) => text(x.name)).filter(Boolean), optional: (d.optionalDocuments || []).map((x) => text(x.name)).filter(Boolean) },
    courses: (d.courses || []).map((c) => ({ name: text(c.name), level: text(c.courseLevelName), campus: text(c.cityName || c.campusLocation), intake: text(c.intakeName) })).filter((c) => c.name),
  };
}
// The Information Hub: deadlines, notices and webinars, as plain items (title, when, details).
const hubItem = (x) => ({
  id: x.id, title: text(x.title || x.name || x.subject || x.universityName || 'Item'), university: text(x.universityName || (x.university && x.university.name)),
  when: text(x.deadline || x.deadlineDate || x.date || x.startTime || x.startDate || x.scheduledAt || x.publishedAt || x.createdAt),
  details: text(x.description || x.content || x.message || x.details).slice(0, 1500), link: /^https?:\/\//.test(text(x.link || x.url || x.meetingLink)) ? text(x.link || x.url || x.meetingLink) : '',
});

// What changed for one university between two readings, in plain lines.
function diff(a, b) {
  const out = [];
  const money = (n) => `£${Number(n).toLocaleString('en-GB')}`;
  const feeKey = (lvl, it) => `${lvl}|${it.text.toLowerCase()}`;
  const feesA = new Map(); (a.fees || []).forEach((f) => f.items.forEach((it) => feesA.set(feeKey(f.level, it), it.amount)));
  (b.fees || []).forEach((f) => f.items.forEach((it) => {
    const was = feesA.get(feeKey(f.level, it));
    if (was === undefined) out.push(`New fee, ${f.level}${it.text ? ` (${it.text})` : ''}: ${money(it.amount)}`);
    else if (was !== it.amount) out.push(`Fee changed, ${f.level}${it.text ? ` (${it.text})` : ''}: ${money(was)} → ${money(it.amount)}`);
  }));
  const sch = (x) => (x.scholarships || []).map((s) => `${s.level}: ${s.amounts.join('; ')}`);
  const sA = new Set(sch(a)); sch(b).filter((s) => !sA.has(s)).forEach((s) => out.push(`Scholarship: ${s}`));
  const intA = new Map((a.intakes || []).map((i) => [i.name, i]));
  (b.intakes || []).forEach((i) => {
    const was = intA.get(i.name);
    if (!was) out.push(`New intake: ${i.name}${i.open ? ' (open)' : ''}`);
    else if (was.deadline !== i.deadline && i.deadline) out.push(`Deadline, ${i.name}: ${i.deadline.split('\n')[0].slice(0, 160)}`);
    else if (was.open !== i.open) out.push(`${i.name} is now ${i.open ? 'open' : 'closed'}`);
  });
  const testA = new Map((a.tests || []).map((t) => [`${t.test}|${t.level}`, t.score]));
  (b.tests || []).forEach((t) => { const was = testA.get(`${t.test}|${t.level}`); if (was !== undefined && was !== t.score) out.push(`${t.test}, ${t.level}: ${was} → ${t.score}`); });
  const cA = new Set((a.courses || []).map((c) => `${c.name}|${c.intake}`.toLowerCase()));
  const cB = new Set((b.courses || []).map((c) => `${c.name}|${c.intake}`.toLowerCase()));
  const added = (b.courses || []).filter((c) => !cA.has(`${c.name}|${c.intake}`.toLowerCase()));
  const gone = (a.courses || []).filter((c) => !cB.has(`${c.name}|${c.intake}`.toLowerCase()));
  if (added.length) out.push(`${added.length} new course${added.length === 1 ? '' : 's'}: ${added.slice(0, 5).map((c) => c.name).join('; ')}${added.length > 5 ? ' ...' : ''}`);
  if (gone.length) out.push(`${gone.length} course${gone.length === 1 ? '' : 's'} no longer listed: ${gone.slice(0, 5).map((c) => c.name).join('; ')}${gone.length > 5 ? ' ...' : ''}`);
  return out;
}

function createRoute2Uni({ dir, email = '', password = '', fetchImpl = (...a) => fetch(...a), now = () => new Date(), pause = 350 } = {}) {
  const file = path.join(dir, 'route2uni.json');
  let cache = null;
  let running = null;
  const read = () => { if (cache) return cache; try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cache = { universities: [], hub: { deadlines: [], notices: [], webinars: [] }, changes: [], runs: [] }; } return cache; };
  const write = (d) => { cache = d; fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileAtomic(file, JSON.stringify(d)); };
  const configured = () => Boolean(email && password);

  async function call(p, token, init) {
    const r = await fetchImpl(BASE + p, { ...init, headers: { Accept: 'application/json', ...(init && init.headers), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, redirect: 'error' });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(r.status === 401 || r.status === 403 ? 'Route2Uni refused the login. Check ROUTE2UNI_EMAIL and ROUTE2UNI_PASSWORD on the server.' : `Route2Uni answered ${r.status} for ${p.split('?')[0]}.`); e.status = r.status; throw e; }
    return j && j.data !== undefined ? j.data : j;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const page = async (p, token) => { try { const d = await call(p, token); return (d && d.content) || (Array.isArray(d) ? d : []); } catch (e) { return []; } };

  // One full reading. Resolves { ok, universities, changed } or { error }.
  async function run(by = 'schedule') {
    if (!configured()) return { error: 'The Route2Uni login is not set on the server (ROUTE2UNI_EMAIL and ROUTE2UNI_PASSWORD).' };
    if (running) return running;
    running = (async () => {
      const started = now().toISOString();
      const old = read();
      try {
        const login = await call('/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const token = login && login.token;
        if (!token) throw new Error('Route2Uni did not log in.');
        const list = await call('/universities/pageable?page=0&size=200', token);
        const ids = ((list && list.content) || []).map((u) => u.id).filter(Boolean);
        const universities = [];
        for (const id of ids) {
          try { universities.push(shape(await call(`/universities/${id}`, token))); } catch (e) { const was = (old.universities || []).find((u) => u.id === id); if (was) universities.push(was); }
          await wait(pause); // gently: one university at a time
        }
        const hub = {
          deadlines: (await page('/university-deadlines?page=0&size=100', token)).map(hubItem),
          notices: (await page('/notices?page=0&size=100', token)).map(hubItem),
          webinars: (await page('/webinars?page=0&size=100', token)).map(hubItem),
        };
        // What changed since the reading before (none the first time: everything is new then).
        const stamp = now().toISOString();
        const changes = [];
        if ((old.universities || []).length) {
          const before = new Map(old.universities.map((u) => [u.id, u]));
          universities.forEach((u) => { const was = before.get(u.id); if (!was) changes.push({ at: stamp, university: u.name, lines: ['New on Route2Uni'] }); else { const l = diff(was, u); if (l.length) changes.push({ at: stamp, university: u.name, lines: l }); } });
          old.universities.filter((u) => !universities.some((x) => x.id === u.id)).forEach((u) => changes.push({ at: stamp, university: u.name, lines: ['No longer on Route2Uni'] }));
          const seen = new Set([...(old.hub.deadlines || []), ...(old.hub.notices || []), ...(old.hub.webinars || [])].map((x) => x.id));
          [['deadlines', 'Deadline'], ['notices', 'Notice'], ['webinars', 'Webinar']].forEach(([k, label]) => hub[k].filter((x) => !seen.has(x.id)).forEach((x) => changes.push({ at: stamp, university: x.university || 'Information Hub', lines: [`${label}: ${x.title}${x.when ? ` (${x.when.slice(0, 40)})` : ''}`] })));
        }
        const runs = [{ at: stamp, started, by, ok: true, universities: universities.length, changed: changes.length }, ...(old.runs || [])].slice(0, 20);
        write({ fetchedAt: stamp, universities, hub, changes: [...changes, ...(old.changes || [])].slice(0, 300), runs });
        return { ok: true, universities: universities.length, changed: changes.length };
      } catch (e) {
        const d = read();
        write({ ...d, runs: [{ at: now().toISOString(), started, by, ok: false, error: e.message }, ...(d.runs || [])].slice(0, 20) });
        return { error: e.message };
      } finally { running = null; }
    })();
    return running;
  }

  // Twice a week: on a Monday or a Thursday from 2 a.m. office time, once that day; and never more than 4 days without a reading.
  const dayOf = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
  const isSlotDay = (date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
    return ['Mon', 'Thu'].includes(p.weekday) && Number(p.hour) >= 2;
  };
  function due(date = now()) {
    if (!configured() || running) return false;
    const runs = read().runs || [];
    const lastGood = (runs.find((r) => r.ok) || {}).at;
    const lastTry = (runs[0] || {}).at;
    if (lastTry && date.getTime() - Date.parse(lastTry) < 3 * 3600000) return false; // a failed try is not repeated within 3 hours
    if (!lastGood) return true;
    if (date.getTime() - Date.parse(lastGood) > 4 * 86400000) return true;
    return isSlotDay(date) && dayOf(new Date(lastGood)) !== dayOf(date);
  }
  const tick = () => { if (due()) run('schedule').catch(() => {}); };

  return {
    configured, run, due, tick, isRunning: () => Boolean(running),
    // The reading of one Fact File university, by its name (or null).
    forName(name) { const k = keyOf(name); const d = read(); const u = (d.universities || []).find((x) => keyOf(x.name) === k); return u ? { ...u, fetchedAt: d.fetchedAt } : null; },
    // For the Fact File page: when it was read, what changed lately, the Information Hub, the intakes' deadlines, and the portal's
    // universities that have no Fact File page yet (`factNames`: the Fact File's names).
    summary(factNames = []) {
      const d = read();
      const known = new Set(factNames.map(keyOf));
      return {
        configured: configured(), running: Boolean(running), fetchedAt: d.fetchedAt || '', lastRun: (d.runs || [])[0] || null,
        changes: (d.changes || []).slice(0, 60), hub: d.hub || { deadlines: [], notices: [], webinars: [] },
        deadlines: (d.universities || []).flatMap((u) => u.intakes.filter((i) => i.open && i.deadline).map((i) => ({ university: u.name, intake: i.name, deadline: i.deadline }))),
        missing: (d.universities || []).filter((u) => !known.has(keyOf(u.name))).map((u) => ({ id: u.id, name: u.name, cities: u.cities, courses: u.courses.length })),
        universities: (d.universities || []).length,
      };
    },
    byId: (id) => (read().universities || []).find((u) => String(u.id) === String(id)) || null,
  };
}

module.exports = { createRoute2Uni, shape, diff, keyOf, niceName };
