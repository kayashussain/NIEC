// The student cards: everything NIEC knows about a student that is not a column of the sheet. Where the student
// came from exactly, what the student has studied (for Universities assistant), notes, the university options prepared
// for them and the record of the messages sent to them.
//
// A card belongs to one student and is found by the student's row id (the `_id` every row of the sheet has, which
// stays the same when the student is edited, moved to another stage or deferred to the next intake). The sheet itself
// is not touched: it keeps exactly the columns it has.
//
// Kept in cards.json in the data folder (never in git, never served), written whole and atomically. The first save
// of each day first copies the file as it was into backups/cards-YYYY-MM-DD.json (the latest 60 are kept), and the
// 6 p.m. backup holds the cards too. The words of each sent message are kept apart in message-log.jsonl, so the cards
// file stays small.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic, snapshotDaily, localDate } = require('../shared/server-utils');
const Fields = require('./card-fields');

const LIMITS = { tasks: 200, comments: 200, notes: 500, noteText: 4000, options: 40, messages: 400, short: 300, text: 2000, cards: 50000 };
// A row id: letters, digits, _ and -, at most 64. Names every plain object already has (toString, constructor, __proto__ ...)
// are never ids: a row called "toString" would make cards[id] find a built-in function and break pages for everyone.
const ID_SHAPE = /^[\w-]{1,64}$/;
const ROW_ID = { test: (id) => ID_SHAPE.test(String(id)) && !(String(id) in Object.prototype) && String(id) !== '__proto__' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const newId = () => crypto.randomBytes(6).toString('hex');
const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\r\n?/g, '\n').slice(0, max).trim() : '');
// A real calendar day as YYYY-MM-DD, else ''.
function isoDay(v) {
  const s = str(v, 10);
  if (!ISO_DAY.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : '';
}

const LISTS = {
  STUDY_LEVELS: [...Fields.STUDY_LEVELS, ...Object.keys(Fields.OLDER_STUDY_LEVELS)], QUALIFICATIONS: Fields.QUALIFICATIONS,
  ENGLISH_TESTS: Fields.ENGLISH_TESTS, LOST_REASONS: Fields.LOST_REASONS, DISTRICTS: Fields.DISTRICTS, NATIONALITIES: Fields.NATIONALITIES, SOURCE_WAYS: Fields.SOURCE_WAYS,
  GENDERS: Fields.GENDERS,
};

// The details of a card as they are kept, whatever was sent: only the known ones, as text, within limits, and a
// dropdown only ever holds one of its choices. `old` keeps what is not being changed.
function cleanProfile(input, old = {}) {
  const out = {};
  Fields.PROFILE_FIELDS.forEach((f) => {
    const given = input && Object.prototype.hasOwnProperty.call(input, f.key);
    let v = given ? input[f.key] : old[f.key];
    if (f.type === 'date') v = isoDay(v);
    // A choice kept in another spelling ("MOI or waiver" before the owner's "MOI or Waiver", 17 Nov 2026) keeps its meaning.
    else if (f.list) { v = str(v, 80); v = LISTS[f.list].find((c) => c.toLowerCase() === v.toLowerCase()) || ''; } else v = str(v, f.max || LIMITS.short);
    if (v) out[f.key] = v;
  });
  return out;
}

// One university option prepared for a student: what the email shows for it.
function cleanOption(input, old = {}) {
  const pick = (k, max) => (input && Object.prototype.hasOwnProperty.call(input, k) ? str(input[k], max) : (old[k] || ''));
  const link = pick('link', 500);
  return {
    id: old.id || newId(),
    universityId: /^[a-f0-9]{12}$/.test(input && input.universityId) ? input.universityId : (old.universityId || ''),
    university: pick('university', 160),
    course: pick('course', 240),
    level: pick('level', 80),
    intake: pick('intake', 80),
    fee: pick('fee', 400),
    deposit: pick('deposit', 400),
    scholarship: pick('scholarship', 400),
    // Only a real web address is kept as the link (never "javascript:" or anything else a page could run).
    link: /^https?:\/\/[^\s<>"']+$/i.test(link) ? link : '',
    note: pick('note', 400),
    // The day an application to it was submitted (set when an Application task is finished with this university).
    applied: (() => { const v = pick('applied', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    // The day it gave an offer (and whether Conditional or Unconditional), refused, or the student withdrew (set from an
    // Application task, after the team has checked and confirmed it).
    offer: (() => { const v = pick('offer', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    offerType: (() => { const v = pick('offerType', 20); return ['Conditional', 'Unconditional'].includes(v) ? v : ''; })(),
    refused: (() => { const v = pick('refused', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    withdrawn: (() => { const v = pick('withdrawn', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    // Assigned to the Application Team but not submitted (the day it was decided; the owner, 17 Nov 2026), for example not eligible.
    skipped: (() => { const v = pick('skipped', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    // Why it was refused, withdrawn or not submitted, in a few words (typed on the student card by the Application Team, the owner, 17 Nov 2026).
    reason: pick('reason', 300),
    // Sent to the Application Team from the shortlist (the day), and its place in the order it was sent in (1, 2, 3 ...).
    sent: (() => { const v = pick('sent', 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; })(),
    // The Apply task made for this course when it was sent to the team (one task per course, the owner, 18 Nov 2026).
    taskId: pick('taskId', 40),
    rank: (() => { const v = pick('rank', 3); return /^\d{1,2}$/.test(v) ? v : ''; })(),
    // Through which partner the application goes: "Direct" or a B2B partner's name (asked when it is sent to the Application Team).
    partner: pick('partner', 120),
    // Chosen by the student themselves on Universities (their own login, the owner, 17 Nov 2026).
    byStudent: input && Object.prototype.hasOwnProperty.call(input, 'byStudent') ? input.byStudent === true : Boolean(old.byStudent),
    addedAt: old.addedAt, addedBy: old.addedBy,
  };
}

function cleanFollow(f) {
  const x = f && typeof f === 'object' && !Array.isArray(f) ? f : {};
  const out = {};
  if (Fields.FOLLOW_TAGS.some((t) => t.key === x.tag)) out.tag = x.tag;
  if (x.next && /^\d{4}-\d{2}-\d{2}$/.test(String(x.next.date))) out.next = { date: x.next.date, by: str(x.next.by, 80), at: str(x.next.at, 40) };
  const from = str(x.from, 80); if (from) out.from = from;
  if (['converted', 'withdrawn'].includes(x.via)) { out.via = x.via; out.viaBy = str(x.viaBy, 80); out.viaAt = str(x.viaAt, 40); }
  return out;
}

const emptyCard = () => ({ profile: {}, notes: [], options: [], messages: [], tasks: [] });

// A card read from the file, made whole: an older or hand-edited file never breaks a page.
function normalize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    profile: cleanProfile(c.profile, {}),
    notes: (Array.isArray(c.notes) ? c.notes : []).filter((n) => n && n.id && n.text).slice(-LIMITS.notes),
    options: (Array.isArray(c.options) ? c.options : []).filter((o) => o && o.id && (o.university || o.course)).slice(0, LIMITS.options),
    messages: (Array.isArray(c.messages) ? c.messages : []).filter((m) => m && m.id).slice(-LIMITS.messages),
    // Tasks given to a team about this student: { id, team, text, by, at, done, doneBy, doneAt, comments: [{ id, by, at, text }] }
    // (older tasks may also have `due`, the date they were once given with, no longer shown). A task handed on has `route`: the teams
    // it was with before, oldest first, and a comment with `handoff: { from, to }` for each hand-on.
    tasks: (Array.isArray(c.tasks) ? c.tasks : []).filter((t) => t && t.id && t.team && t.text).slice(-LIMITS.tasks),
    // The medical test booked from a Medical task (the owner, 15 Nov 2026): { date, place, by, at }. Nothing changes by itself on that
    // day (the owner, 16 Nov 2026): the team is given "confirm the report is received" for that day and answers it. null when none.
    medical: c.medical && /^\d{4}-\d{2}-\d{2}$/.test(String(c.medical.date)) ? { date: c.medical.date, place: str(c.medical.place, 200), by: str(c.medical.by, 80), at: str(c.medical.at, 40), done: Boolean(c.medical.done) } : null,
    // The follow-up list (the owner, 21 Nov 2026), all optional so every card already saved keeps working:
    //   tag   Interested, Decision Making or Cold (one at a time)
    //   next  the next follow-up day chosen with the last note: { date, by, at }
    //   from  the intake a deferred student came back from ("Jan 2027"), shown beside the name in the new intake
    //   via   'converted' (the Follow-up Team sent the student on) or 'withdrawn' (the team withdrew them): the team keeps seeing them
    follow: cleanFollow(c.follow),
    // The last line Vishnu itself wrote in the sheet's Remarks (finishing a task), so a later one replaces it but never a person's remark.
    autoRemark: str(c.autoRemark, 300),
    // The details someone checked and said are correct (the owner, 16 Nov 2026), so they leave "Details to check": { key: ISO time }.
    // A key holds the values it was about, so a later change is checked again.
    checked: Object.fromEntries(Object.entries(c.checked && typeof c.checked === 'object' && !Array.isArray(c.checked) ? c.checked : {}).filter(([k]) => typeof k === 'string' && k.length <= 200).slice(0, 100).map(([k, v]) => [k, str(v, 40)])),
    createdAt: str(c.createdAt, 40), createdBy: str(c.createdBy, 80), updatedAt: str(c.updatedAt, 40), updatedBy: str(c.updatedBy, 80),
  };
}

function createCards(dir, { now = () => new Date() } = {}) {
  const file = path.join(dir, 'cards.json');
  const logFile = path.join(dir, 'message-log.jsonl');
  let cache = null; // { mtimeMs, size, data }

  // The newest daily copy that still reads, when cards.json itself is damaged.
  function recover() {
    let copies = [];
    try {
      copies = fs.readdirSync(path.join(dir, 'backups')).filter((f) => /^cards-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    } catch (e) { /* none */ }
    for (const name of copies) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'backups', name), 'utf8'));
        if (data && data.cards && typeof data.cards === 'object') return data;
      } catch (e) { /* try the one before */ }
    }
    return null;
  }

  // Many changes in one go (a stage moved for hundreds of students in one save): kept in memory and written once at the end, so the
  // server is never held up writing the whole file once per student (see batch below).
  let batchDepth = 0; let held = null;
  function load() {
    if (held) return held;
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return { cards: {} }; } // no card saved yet
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.cards && typeof data.cards === 'object' && !Array.isArray(data.cards)) {
        // Every card is made whole once, when the file is read, so nothing that reads a card has to guard against an older shape.
        const cards = {};
        Object.keys(data.cards).forEach((id) => { if (ROW_ID.test(id)) cards[id] = normalize(data.cards[id]); });
        cache = { mtimeMs: stat.mtimeMs, size: stat.size, data: { ...data, cards } };
        return cache.data;
      }
    } catch (e) { /* unreadable: set aside below */ }
    // A damaged file is kept next to the data (never overwritten), and the cards carry on from the newest daily copy.
    try { fs.renameSync(file, path.join(dir, `cards.damaged-${now().toISOString().replace(/[:.]/g, '-')}.json`)); } catch (e) { /* ignore */ }
    const recovered = recover() || { cards: {} };
    console.error('[cards] cards.json could not be read; carried on from', recovered.cards && Object.keys(recovered.cards).length ? 'the newest daily copy' : 'an empty list');
    try { if (recovered.cards && Object.keys(recovered.cards).length) { write(recovered); return cache.data; } } catch (e) { /* kept in memory below */ }
    return recovered;
  }

  function write(data) {
    if (batchDepth > 0) { held = data; return; }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    snapshotDaily(file, dir, 'cards');
    writeFileAtomic(file, JSON.stringify(data));
    const stat = fs.statSync(file);
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
  }

  // Changes one card and saves. `change(card)` returns what to answer, or { error }.
  function update(rowId, by, change) {
    if (!ROW_ID.test(String(rowId || ''))) return { error: 'No such student.' };
    const data = load();
    const existing = Object.prototype.hasOwnProperty.call(data.cards, rowId);
    if (!existing && Object.keys(data.cards).length >= LIMITS.cards) return { error: 'The card list is full.' };
    const card = normalize(existing ? data.cards[rowId] : emptyCard());
    const stamp = now().toISOString();
    if (!existing) { card.createdAt = stamp; card.createdBy = by || ''; }
    const result = change(card, stamp) || {};
    if (result.error) return result;
    card.updatedAt = stamp;
    card.updatedBy = by || '';
    write({ ...data, cards: { ...data.cards, [rowId]: card } }); // a copy: a failed write must not leave the change in memory
    return { ...result, card };
  }

  // When each person last read each task (its comments), for the red dots: { "<username>": { "<task id>": "<ISO time>" } }. Kept in
  // task-seen.json beside the cards, apart from them, so reading a task never changes a student's card.
  const seenFile = path.join(dir, 'task-seen.json');
  // Read again whenever the file changed (as the cards are), so a second server process, or a save from another process, is never
  // missed: a "Mark all as read" in one process is seen by every process (the owner, 21 Nov 2026: the bell stayed at 10).
  let seenCache = null; let seenStamp = '';
  const seenAll = () => {
    let st = null;
    try { st = fs.statSync(seenFile); } catch (e) { /* not saved yet */ }
    const stamp = st ? `${st.mtimeMs}:${st.size}` : 'none';
    if (seenCache && stamp === seenStamp) return seenCache;
    try { const d = st ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : {}; seenCache = d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch (e) { seenCache = seenCache || {}; }
    seenStamp = stamp;
    return seenCache;
  };

  return {
    // The phone, email and name a list gave for many students at once, in one save: { rowId: "phone|email|name" }. Kept on the card
    // (which stays when its row is deleted from the sheet), so a list uploaded later never brings back a student removed on purpose.
    // Forgets the cards of students removed on purpose (an event's list taken back to be uploaded again), in one save.
    forget(rowIds) {
      const data = load();
      const next = { ...data.cards };
      let gone = 0;
      [].concat(rowIds || []).forEach((id) => { if (Object.prototype.hasOwnProperty.call(next, id)) { delete next[id]; gone += 1; } });
      if (gone) write({ ...data, cards: next });
      return { gone };
    },
    rememberLeads(entries) {
      const data = load();
      const next = { ...data.cards };
      let changed = 0;
      Object.entries(entries || {}).forEach(([rowId, value]) => {
        if (!ROW_ID.test(rowId)) return;
        const v = str(value, 300);
        const card = normalize(next[rowId] || emptyCard());
        if (!v || card.profile.leadContact === v) return;
        card.profile = cleanProfile({ leadContact: v }, card.profile);
        next[rowId] = card;
        changed += 1;
      });
      if (changed) write({ ...data, cards: next });
      return { changed };
    },
    hasSeen(username) { return Object.prototype.hasOwnProperty.call(seenAll(), String(username || '')); },
    // When `username` last read each task: { taskId: ISO time }.
    seenBy(username) { return { ...(seenAll()[String(username || '')] || {}) }; },
    // `username` has read these tasks now.
    markSeen(username, taskIds) {
      const key = String(username || '');
      if (!key) return;
      const all = { ...seenAll() };
      const mine = { ...(all[key] || {}) };
      const stamp = now().toISOString();
      [].concat(taskIds).filter((t) => /^[a-f0-9]{12}$/.test(String(t))).forEach((t) => { mine[t] = stamp; });
      // Only the newest 2,000 reads a person made are kept.
      all[key] = Object.fromEntries(Object.entries(mine).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 2000));
      seenCache = all;
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileAtomic(seenFile, JSON.stringify(all));
        const st = fs.statSync(seenFile); seenStamp = `${st.mtimeMs}:${st.size}`;
      } catch (e) { /* kept in memory until the next save */ }
    },
    // The card of a student (an empty one when nothing has been saved for them yet).
    get(rowId) {
      const data = load();
      return Object.prototype.hasOwnProperty.call(data.cards, rowId) ? data.cards[rowId] : normalize(emptyCard());
    },
    // Runs fn with every card change kept in memory, then writes the file once (also when fn throws, so nothing done is lost).
    batch(fn) {
      batchDepth += 1;
      try { return fn(); } finally {
        batchDepth -= 1;
        if (batchDepth === 0 && held) { const d = held; held = null; write(d); }
      }
    },
    has(rowId) { return Object.prototype.hasOwnProperty.call(load().cards, rowId); },
    // Every card, keyed by row id (for the Dashboard and the backup). Not a copy: do not change it.
    all() { return load().cards; },

    // A detail checked and found correct (see `checked`).
    setChecked(rowId, key, by) {
      const k = str(key, 200);
      if (!k) return { error: 'Nothing to mark.' };
      return update(rowId, by, (card, stamp) => { card.checked = Object.fromEntries([...Object.entries(card.checked || {}), [k, stamp]].slice(-100)); });
    },
    // What finishing a task wrote (columns, University options, the medical booking, a reminder), kept on the task so reopening it
    // can put everything back: see finishTask in portal-api.js. null clears it.
    setTaskWrote(rowId, taskId, wrote, by) {
      return update(rowId, by, (card) => {
        const task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        if (wrote) task.wrote = wrote; else delete task.wrote;
        return null;
      });
    },
    setAutoRemark(rowId, remark, by) { return update(rowId, by, (card) => { card.autoRemark = str(remark, 300); }); },
    // The medical test booked (a date and where), or none (null): see `medical` on the card.
    setMedical(rowId, input, by) {
      return update(rowId, by, (card, stamp) => {
        card.medical = input && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date)) ? { date: input.date, place: str(input.place, 200), by: by || '', at: stamp, done: Boolean(input.done) } : null;
      });
    },
    setProfile(rowId, input, by) {
      return update(rowId, by, (card) => { card.profile = cleanProfile(input, card.profile); });
    },

    // Changes the kind of every task whose kind is `from` (stored, or shown by guessing for an older task saved without one) to `to`,
    // in one write. Returns how many changed. Used once at start-up (the owner, 21 Nov 2026: Documents tasks become Application).
    retagTasks(from, to, shownTag) {
      if (!Fields.TASK_TAG_IDS.includes(to)) return { changed: 0 };
      const data = load();
      const next = { ...data.cards };
      let changed = 0;
      Object.entries(next).forEach(([rowId, card]) => {
        let touched = false;
        const tasks = (card.tasks || []).map((t) => {
          const now = t.tag || (shownTag ? shownTag(t, rowId) : '');
          if (now !== from) return t;
          touched = true; changed += 1;
          return { ...t, tag: to };
        });
        if (touched) next[rowId] = { ...card, tasks };
      });
      if (changed) write({ ...data, cards: next });
      return { changed };
    },
    // A task for a team about this student (Admin and the Manager give them; the team marks it complete or not complete).
    addTask(rowId, input, by) {
      const text = str(input && input.text, LIMITS.text);
      const team = str(input && input.team, 40);
      if (!team) return { error: 'Choose the team.' };
      if (!text) return { error: 'Write what the team should do.' };
      // No date to do it by (the owner, 14 Nov 2026): a task says which team and what to do; the team and whoever gave it talk it
      // through in the task's comments. Older tasks keep the date they were given with; it is simply not shown.
      let task;
      const out = update(rowId, by, (card, stamp) => {
        // The tag chosen when the task was given (Application, Mock interview, NOC, Medical, Other; Offer request by Vishnu), if any.
        const tag = Fields.TASK_TAG_IDS.includes(input && input.tag) ? input.tag : '';
        // How important it is: Priority unless Super priority or Medium was chosen.
        const priority = Fields.TASK_PRIORITY_IDS.includes(input && input.priority) ? input.priority : 'high';
        // An application task carries what to apply for (the owner, 20 Nov 2026): university, intake, level, location and course, so the
        // Application Team sees it at a glance and ticks it with one choice.
        const a = input && input.app && typeof input.app === 'object' ? input.app : null;
        const app = a && str(a.university, 160) && str(a.course, 300) ? { university: str(a.university, 160), universityId: str(a.universityId, 20), intake: str(a.intake, 60), level: str(a.level, 60), location: str(a.location, 120), course: str(a.course, 300) } : null;
        // An Offer request carries the application it chases (the owner, 21 Nov 2026), so it never has to be read back from its words
        // (a university with brackets in its name, or words edited later, broke that).
        const f = input && input.offerFor && typeof input.offerFor === 'object' ? input.offerFor : null;
        const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
        const offerFor = f && str(f.university, 160) ? { university: str(f.university, 160), course: str(f.course, 300), intake: str(f.intake, 80), applied: day(f.applied) } : null;
        task = { id: newId(), team, text, ...(tag ? { tag } : {}), ...(app ? { app } : {}), ...(offerFor ? { offerFor } : {}), priority, by: by || '', at: stamp, done: false, doneBy: '', doneAt: '', comments: [] };
        card.tasks = [...card.tasks, task].slice(-LIMITS.tasks);
      });
      return out.error ? out : { ...out, task };
    },
    // The words of a task, changed after it was given (the owner, 15 Nov 2026), so a task never has to be removed and given again. The
    // team sees it marked "Edited" and gets a notification.
    editTask(rowId, taskId, input, by) {
      const text = str(input && input.text, LIMITS.text);
      if (!text) return { error: 'Write what the team should do.' };
      let task;
      const out = update(rowId, by, (card, stamp) => {
        task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        if (task.text === text) return null;
        Object.assign(task, { text, editedAt: stamp, editedBy: by || '' });
        return null;
      });
      return out.error ? out : { ...out, task };
    },
    // A task moved to another day by the team or whoever gave it (the owner, 15 Nov 2026: "the student says not today, in 3 days"):
    // it waits under Later until that day, then is back under Today by itself. `date`: YYYY-MM-DD, or '' for today. The move is
    // written in the task's updates with its reason, so everyone sees why.
    scheduleTask(rowId, taskId, input, by, today) {
      const date = String((input && input.date) || '');
      if (date && !isoDay(date)) return { error: 'Choose the day.' };
      if (date && today && date < today) return { error: 'Choose today or a later day.' };
      if (date && today && Date.parse(date) - Date.parse(today) > 366 * 86400000) return { error: 'Choose a day within a year.' };
      const reason = str(input && input.reason, LIMITS.text);
      let task;
      const out = update(rowId, by, (card, stamp) => {
        task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        const to = date && (!today || date > today) ? date : '';
        if (to) task.doOn = to; else delete task.doOn;
        task.comments = [...(Array.isArray(task.comments) ? task.comments : []), { id: newId(), by: by || '', at: stamp, text: reason, schedule: { to: to || today || '' } }].slice(-LIMITS.comments);
        return null;
      });
      return out.error ? out : { ...out, task };
    },
    // What a task is about and how important it is, changed after it was given. `change`: { tag, priority }, either or both.
    tagTask(rowId, taskId, change, by) {
      const c = typeof change === 'string' ? { tag: change } : (change || {});
      if (c.tag !== undefined && !Fields.TASK_TAG_IDS.includes(c.tag)) return { error: 'Choose what the task is about.' };
      if (c.priority !== undefined && !Fields.TASK_PRIORITY_IDS.includes(c.priority)) return { error: 'Choose how important the task is.' };
      if (c.tag === undefined && c.priority === undefined) return { error: 'Nothing to change.' };
      let task;
      const out = update(rowId, by, (card) => {
        task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        if (c.tag !== undefined) task.tag = c.tag;
        if (c.priority !== undefined) task.priority = c.priority;
        return null;
      });
      return out.error ? out : { ...out, task };
    },
    setTask(rowId, taskId, done, by) {
      let task;
      const out = update(rowId, by, (card, stamp) => {
        task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        Object.assign(task, done ? { done: true, doneBy: by || '', doneAt: stamp } : { done: false, doneBy: '', doneAt: '' });
        return null;
      });
      return out.error ? out : { ...out, task };
    },
    // A comment on a task: the team writes how it went, what it needs or what is in the way, and whoever gave the task answers.
    commentTask(rowId, taskId, input, by) {
      const text = str(input, LIMITS.text);
      if (!text) return { error: 'Write the update first.' };
      let comment;
      const out = update(rowId, by, (card, stamp) => {
        const task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        comment = { id: newId(), by: by || '', at: stamp, text };
        task.comments = [...(Array.isArray(task.comments) ? task.comments : []), comment].slice(-LIMITS.comments);
        return null;
      });
      return out.error ? out : { ...out, comment };
    },
    // A task handed on to another team, in the same task (the owner, 14 Nov 2026): one thread from start to end. The team it was
    // with is kept in `route` (so it still sees the task and can comment), the hand-on is written in the comments with its reason, and
    // the task opens again for the new team.
    handTask(rowId, taskId, input, by) {
      const team = str(input && input.team, 40);
      const reason = str(input && input.reason, LIMITS.text);
      if (!team) return { error: 'Choose the team.' };
      if (!reason) return { error: 'Add the reason and next step.' };
      let task;
      const out = update(rowId, by, (card, stamp) => {
        task = card.tasks.find((t) => t.id === taskId);
        if (!task) return { error: 'No such task.' };
        if (task.team === team) return { error: 'The task is already with that team.' };
        const from = task.team;
        task.route = [...(Array.isArray(task.route) ? task.route : []).filter((x) => x !== team), from].slice(-10);
        task.team = team;
        Object.assign(task, { done: false, doneBy: '', doneAt: '' });
        task.comments = [...(Array.isArray(task.comments) ? task.comments : []), { id: newId(), by: by || '', at: stamp, text: reason, handoff: { from, to: team } }].slice(-LIMITS.comments);
        return null;
      });
      return out.error ? out : { ...out, task };
    },
    removeTask(rowId, taskId, by) {
      const out = update(rowId, by, (card) => {
        if (!card.tasks.some((t) => t.id === taskId)) return { error: 'No such task.' };
        card.tasks = card.tasks.filter((t) => t.id !== taskId);
        return null;
      });
      return out;
    },

    addNote(rowId, input, by) {
      const text = str(input && input.text, LIMITS.noteText);
      if (!text) return { error: 'Please write the note first.' };
      const kind = Fields.NOTE_KINDS.some((k) => k.key === (input && input.kind)) ? input.kind : 'note';
      let note;
      const out = update(rowId, by, (card, stamp) => {
        note = { id: newId(), at: stamp, by: by || '', kind, text };
        card.notes.push(note);
        card.notes = card.notes.slice(-LIMITS.notes);
      });
      return out.error ? out : { ...out, note };
    },

    // The follow-up details of a student (see cleanFollow): `patch` sets the keys it names; a key set to null is cleared.
    setFollow(rowId, patch, by) {
      return update(rowId, by, (card) => {
        const next = { ...(card.follow || {}) };
        Object.entries(patch || {}).forEach(([k, v]) => { if (v === null) delete next[k]; else next[k] = v; });
        card.follow = cleanFollow(next);
      });
    },

    // A note can be removed by the person who wrote it, or by Admin (`force`).
    removeNote(rowId, noteId, by, force = false) {
      return update(rowId, by, (card) => {
        const note = card.notes.find((n) => n.id === noteId);
        if (!note) return { error: 'No such note.' };
        if (!force && note.by !== by) return { error: 'Only the person who wrote a note, or Admin, can remove it.' };
        card.notes = card.notes.filter((n) => n.id !== noteId);
        return { removed: note };
      });
    },

    addOption(rowId, input, by) {
      let option;
      const out = update(rowId, by, (card, stamp) => {
        if (card.options.length >= LIMITS.options) return { error: `A student can have up to ${LIMITS.options} options.` };
        option = { ...cleanOption(input), addedAt: stamp, addedBy: by || '' };
        if (!option.university && !option.course) return { error: 'Choose a university or a course first.' };
        // The same course at the same university is listed once.
        const same = (o) => o.university.toLowerCase() === option.university.toLowerCase() && o.course.toLowerCase() === option.course.toLowerCase() && o.intake.toLowerCase() === option.intake.toLowerCase();
        if (card.options.some(same)) return { error: 'That course is already in the list for this student.', duplicate: true };
        card.options.push(option);
        return {};
      });
      return out.error ? out : { ...out, option };
    },
    updateOption(rowId, optionId, input, by) {
      return update(rowId, by, (card) => {
        const i = card.options.findIndex((o) => o.id === optionId);
        if (i === -1) return { error: 'No such option.' };
        card.options[i] = cleanOption(input, card.options[i]);
        return {};
      });
    },
    removeOption(rowId, optionId, by) {
      return update(rowId, by, (card) => {
        if (!card.options.some((o) => o.id === optionId)) return { error: 'No such option.' };
        card.options = card.options.filter((o) => o.id !== optionId);
        return {};
      });
    },

    // The record of a message: who sent what, when, how and whether it went. The words are kept in the log file.
    logMessage(rowId, entry, by) {
      let message;
      const out = update(rowId, by, (card, stamp) => {
        message = {
          id: newId(), at: stamp, by: by || '', channel: entry.channel === 'whatsapp' ? 'whatsapp' : 'email',
          template: str(entry.template, 80), subject: str(entry.subject, 300), to: str(entry.to, 254),
          status: ['sent', 'failed', 'preview', 'opened'].includes(entry.status) ? entry.status : 'sent',
          ...(Array.isArray(entry.attachments) && entry.attachments.length ? { attachments: entry.attachments.slice(0, 10).map((n) => str(n, 120)) } : {}),
          ...(entry.error ? { error: str(entry.error, 300) } : {}),
          ...(entry.options ? { options: Math.max(0, Math.min(LIMITS.options, Number(entry.options) || 0)) } : {}),
        };
        card.messages.push(message);
        card.messages = card.messages.slice(-LIMITS.messages);
      });
      if (out.error) return out;
      try {
        fs.appendFileSync(logFile, JSON.stringify({ id: message.id, rowId, at: message.at, text: String(entry.text || '').slice(0, 20000) }) + '\n', { mode: 0o600 });
      } catch (e) { console.error('[cards] message log:', e.message); }
      return { ...out, message };
    },
    // The words of one sent message, or null.
    messageText(rowId, messageId) {
      let text;
      try { text = fs.readFileSync(logFile, 'utf8'); } catch (e) { return null; }
      const needle = `"id":"${messageId}"`;
      const line = text.split('\n').find((l) => l.includes(needle));
      if (!line) return null;
      try { const e = JSON.parse(line); return e.rowId === rowId ? e.text : null; } catch (e) { return null; }
    },

    // Puts back every card from a backup (each one checked like any save).
    restoreAll(cards) {
      if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return { error: 'The backup has no student cards in it.' };
      const restored = {};
      Object.keys(cards).filter((id) => ROW_ID.test(id)).slice(0, LIMITS.cards).forEach((id) => { restored[id] = normalize(cards[id]); });
      write({ ...load(), cards: restored });
      return { count: Object.keys(restored).length };
    },
    today: () => localDate(now()),
  };
}

module.exports = { createCards, cleanProfile, cleanOption, normalize, isoDay, LIMITS, ROW_ID };
