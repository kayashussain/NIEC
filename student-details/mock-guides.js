// Mock interview guides (the owner, 20 Nov 2026), and how far each student has read.
//
//   A guide is either the one every student reads (key "core") or one university's own (keyed by its name, spelling ignored).
//   Each has a draft, which the Mock Team, the Manager and Admin edit, and a published copy, which only Admin makes ("Publish"):
//   a student reads the published copy only, so nothing reaches a student before Admin has read it. "To check" notes are the
//   team's own and are never shown to a student.
//   A guide has five phases, read in order: welcome, university, questions, marking, ready. A student's guide for a university is
//   the core guide with that university's own text added to each phase, and its questions added to the core questions.
//
// Kept in mock-guides.json in the data folder, written whole and atomically. The first drafts (mock-guides-seed.js) are written
// once, when there is no file yet: the core guide, and the universities among this installation's Partner Universities.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');
const SEED = require('./mock-guides-seed');

const PHASES = [
  { key: 'welcome', title: 'Welcome: the UK and your interview' },
  { key: 'university', title: 'Your university\'s interview' },
  { key: 'questions', title: 'Questions and strong answers' },
  { key: 'marking', title: 'How you are judged' },
  { key: 'ready', title: 'Mock interviews and the big day' },
];
const PHASE_KEYS = PHASES.map((p) => p.key);
const LIMITS = { body: 20000, title: 160, url: 500, videos: 12, links: 20, questions: 120, q: 400, tip: 1500, group: 60, summary: 500, confirm: 30, confirmLine: 600, guides: 300 };

const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const keyOf = (name) => squash(name).slice(0, 120);
// No em or en dashes anywhere (the owner): typed or pasted ones become a plain hyphen.
const line = (v, max) => String(v ?? '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max);
const block = (v, max) => String(v ?? '').replace(/[\u2013\u2014]/g, '-').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const webLink = (v) => { const u = line(v, LIMITS.url); return /^https:\/\/[^\s<>"']+$/i.test(u) ? u : ''; };

// The id of a YouTube video in any of its usual addresses, or ''.
function youtubeId(url) {
  const u = String(url || '');
  const m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function cleanPhase(p) {
  const x = p && typeof p === 'object' ? p : {};
  return {
    body: block(x.body, LIMITS.body),
    videos: (Array.isArray(x.videos) ? x.videos : []).map((v) => ({ title: line(v && v.title, LIMITS.title), url: webLink(v && v.url) })).filter((v) => youtubeId(v.url)).slice(0, LIMITS.videos),
    links: (Array.isArray(x.links) ? x.links : []).map((v) => ({ title: line(v && v.title, LIMITS.title), url: webLink(v && v.url) })).filter((v) => v.url).slice(0, LIMITS.links),
  };
}
function cleanContent(c) {
  const x = c && typeof c === 'object' ? c : {};
  const phases = {};
  PHASE_KEYS.forEach((k) => { phases[k] = cleanPhase(x.phases && x.phases[k]); });
  return {
    summary: line(x.summary, LIMITS.summary),
    phases,
    questions: (Array.isArray(x.questions) ? x.questions : []).map((q) => ({ group: line(q && q.group, LIMITS.group) || 'Other', q: line(q && q.q, LIMITS.q), tip: block(q && q.tip, LIMITS.tip) })).filter((q) => q.q).slice(0, LIMITS.questions),
  };
}
const cleanConfirm = (list) => (Array.isArray(list) ? list : String(list || '').split('\n')).map((l) => line(l, LIMITS.confirmLine)).filter(Boolean).slice(0, LIMITS.confirm);
const hasText = (c) => Boolean(c && (c.summary || c.questions.length || PHASE_KEYS.some((k) => c.phases[k].body || c.phases[k].videos.length || c.phases[k].links.length)));

function seedGuides(universityNames, at) {
  const guides = {};
  const stamp = { updatedAt: at, updatedBy: 'Claude (first draft)', published: null, publishedAt: '', publishedBy: '' };
  guides.core = { key: 'core', name: 'Every university', draft: cleanContent(SEED.CORE), confirm: [], ...stamp };
  const wanted = new Set(universityNames.map(keyOf));
  SEED.UNIVERSITIES.filter((u) => wanted.has(keyOf(u.name))).forEach((u) => {
    const key = keyOf(u.name);
    guides[key] = {
      key, name: u.name, confirm: cleanConfirm(u.confirm), ...stamp,
      draft: cleanContent({ summary: u.summary, questions: u.questions, phases: { university: u.university, marking: { body: u.marking } } }),
    };
  });
  return guides;
}

function cleanGuide(g, key) {
  if (!g || typeof g !== 'object') return null;
  const name = key === 'core' ? 'Every university' : line(g.name, LIMITS.title);
  if (!name) return null;
  return {
    key, name, draft: cleanContent(g.draft), published: g.published ? cleanContent(g.published) : null,
    confirm: cleanConfirm(g.confirm), updatedAt: line(g.updatedAt, 40), updatedBy: line(g.updatedBy, 120), publishedAt: line(g.publishedAt, 40), publishedBy: line(g.publishedBy, 120),
  };
}

// `universities()`: this installation's Partner University names, for the first drafts.
function createMockGuides(dir, { universities = () => [], now = () => new Date() } = {}) {
  const file = path.join(dir, 'mock-guides.json');
  let cache = null;
  function load() {
    let stat = null;
    try { stat = fs.statSync(file); } catch (e) { stat = null; }
    if (!stat) {
      const data = { guides: seedGuides(universities(), now().toISOString()), progress: {} };
      save(data);
      return data;
    }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const guides = {};
      Object.entries(raw.guides || {}).slice(0, LIMITS.guides).forEach(([k, g]) => { const key = k === 'core' ? 'core' : keyOf(k); const c = key && cleanGuide(g, key); if (c) guides[key] = c; });
      const progress = raw.progress && typeof raw.progress === 'object' && !Array.isArray(raw.progress) ? raw.progress : {};
      const data = { guides, progress };
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
      return data;
    } catch (e) { return cache ? cache.data : { guides: {}, progress: {} }; }
  }
  function save(data) { writeFileAtomic(file, JSON.stringify(data, null, 1)); cache = null; }

  const statusOf = (g) => (!g.published ? (hasText(g.draft) ? 'draft' : 'empty') : JSON.stringify(g.published) === JSON.stringify(g.draft) ? 'published' : 'changed');
  // The guide for a university's name: the same name, or one name the start of the other ("Northumbria University" and
  // "Northumbria University London (QA)"), never the core guide.
  function forName(name) {
    const k = keyOf(name);
    if (!k) return null;
    const all = Object.values(load().guides).filter((g) => g.key !== 'core');
    return all.find((g) => g.key === k) || all.find((g) => k.length >= 10 && g.key.length >= 10 && (g.key.startsWith(k) || k.startsWith(g.key))) || null;
  }

  return {
    PHASES,
    // For the daily backup and a restore: the guides and each student's reading progress, as stored.
    // (null when nothing is saved yet: reading must not create the starting guides before the Partner Universities exist.)
    all: () => { if (!fs.existsSync(file)) return null; const d = load(); return { guides: d.guides, progress: d.progress }; },
    restoreAll(data) {
      if (!data || typeof data !== 'object' || !data.guides || typeof data.guides !== 'object' || Array.isArray(data.guides)) return;
      const progress = data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress) ? data.progress : {};
      save({ guides: data.guides, progress }); // load() cleans every guide again when it is read
    },
    list: () => Object.values(load().guides).map((g) => ({ key: g.key, name: g.name, status: statusOf(g), summary: (g.published || g.draft).summary, updatedAt: g.updatedAt, updatedBy: g.updatedBy, publishedAt: g.publishedAt, publishedBy: g.publishedBy, toCheck: g.confirm.length }))
      .sort((a, b) => (a.key === 'core' ? -1 : b.key === 'core' ? 1 : a.name.localeCompare(b.name))),
    get: (key) => { const g = load().guides[key]; return g ? { ...g, status: statusOf(g) } : null; },
    forName,
    // A new, empty guide for a university. { guide } or { error }.
    create(name, by) {
      const n = line(name, LIMITS.title);
      const key = keyOf(n);
      if (!key) return { error: 'Choose a university.' };
      const data = load();
      if (data.guides[key] || forName(n)) return { error: 'That university already has a guide.' };
      if (Object.keys(data.guides).length >= LIMITS.guides) return { error: 'There are too many guides.' };
      data.guides[key] = { key, name: n, draft: cleanContent({}), published: null, confirm: [], updatedAt: now().toISOString(), updatedBy: line(by, 120), publishedAt: '', publishedBy: '' };
      save(data);
      return { guide: { ...data.guides[key], status: 'empty' } };
    },
    // Saves the draft (what a student sees does not change until it is published).
    saveDraft(key, input, by) {
      const data = load();
      const g = data.guides[key];
      if (!g) return { error: 'No such guide.' };
      data.guides[key] = { ...g, draft: cleanContent(input && input.draft), confirm: cleanConfirm(input && input.confirm), updatedAt: now().toISOString(), updatedBy: line(by, 120) };
      save(data);
      return { guide: { ...data.guides[key], status: statusOf(data.guides[key]) } };
    },
    publish(key, by) {
      const data = load();
      const g = data.guides[key];
      if (!g) return { error: 'No such guide.' };
      if (!hasText(g.draft)) return { error: 'The guide is empty: write it first.' };
      data.guides[key] = { ...g, published: JSON.parse(JSON.stringify(g.draft)), publishedAt: now().toISOString(), publishedBy: line(by, 120) };
      save(data);
      return { guide: { ...data.guides[key], status: 'published' } };
    },
    unpublish(key, by) {
      const data = load();
      const g = data.guides[key];
      if (!g) return { error: 'No such guide.' };
      data.guides[key] = { ...g, published: null, publishedAt: '', publishedBy: line(by, 120) };
      save(data);
      return { guide: { ...data.guides[key], status: statusOf(data.guides[key]) } };
    },
    // What a student reads for one university (or the core guide alone when `uniKey` is null): `which` is "published" (students)
    // or "draft" (the team's preview). null when there is nothing to read.
    view(uniKey, which = 'published') {
      const guides = load().guides;
      const pick = (g) => (g ? (which === 'draft' ? g.draft : g.published) : null);
      const core = pick(guides.core);
      const uni = uniKey ? guides[uniKey] : null;
      const own = pick(uni);
      if (!core && !own) return null;
      return {
        key: uni ? uni.key : 'core',
        name: uni ? uni.name : '',
        summary: own ? own.summary : '',
        ownGuide: Boolean(own),
        phases: PHASES.map((p) => {
          const a = core ? core.phases[p.key] : { body: '', videos: [], links: [] };
          const b = own ? own.phases[p.key] : { body: '', videos: [], links: [] };
          return { key: p.key, title: p.title, body: a.body, own: b.body, videos: [...b.videos, ...a.videos], links: [...b.links, ...a.links] };
        }),
        questions: [...(own ? own.questions.map((q) => ({ ...q, own: true })) : []), ...(core ? core.questions : [])],
      };
    },
    // The phases a student has finished in one guide: { phaseKey: date }.
    readOf: (rowId, key) => ({ ...(((load().progress || {})[rowId] || {})[key] || {}) }),
    markRead(rowId, key, phase) {
      if (!PHASE_KEYS.includes(phase)) return { error: 'No such phase.' };
      const data = load();
      const mine = data.progress[rowId] || (data.progress[rowId] = {});
      const read = mine[key] || (mine[key] = {});
      if (!read[phase]) { read[phase] = now().toISOString(); save(data); }
      return { read: { ...read } };
    },
  };
}

module.exports = { createMockGuides, PHASES, youtubeId, keyOf, cleanContent };
