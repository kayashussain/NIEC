// Apply through (the owner, 20 and 21 Nov 2026): which partner each UK university, and each international college, is applied through.
//
//   A university and its international college are two different places to apply and are never put together (University of
//   Greenwich is one entry, University of Greenwich International College (UGIC) another).
//   Every place is listed and Admin can move any of them to any B2B partner (the owner, 21 Nov 2026: a partner can lose its agreement
//   with a university). A place with a direct route (the consultancy's own agreement, Oxford International Education Group (OIEG) or
//   Navitas) remembers it (directPartner), so it can be moved to a B2B partner and back; `direct` is true while it goes that way.
//   Every change is written in Activity. Universities shows the chosen partner on the university's page, with its portal and login
//   under Apply now (Admin and the Application Team only).
//
// The starting list is apply-through-seed.json: the partners' UK lists read on 20 Nov 2026 (Real Dreams through Route2Uni, Adventus,
// Apply Board and the OIEG website) with the owner's choices that day. It is written into apply-through.json in the data folder on
// first use, only on an installation that works with those partners; another consultancy starts with an empty list. The file is
// written whole and atomically.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');
const { partnerName } = require('./partner-names');

const SEED = path.join(__dirname, 'apply-through-seed.json');
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Two or more partners and no direct route: the owner chooses.
const choosable = (e) => !e.direct && Array.isArray(e.options) && e.options.length > 1;
// Other names Universities uses for a place in the list.
// The pages whose name is written differently from the list (the owner, 20 Nov 2026: each page must show its partner).
const ALIASES = {
  uwebristol: 'University of the West of England', healthscienceuniversity: 'Health Sciences University', universityofroehampton: 'Roehampton University', ravensbourneuniversitylondon: 'Ravensbourne University', bathspa: 'Bath Spa University',
  universityofwestofscotland: 'University of the West of Scotland',
  universityofravensbourne: 'Ravensbourne University',
  winchesteruniversity: 'University of Winchester',
  internationalcollegeofdundeescotland: 'International College Dundee (ICD), University of Dundee',
  internationalcollegerobertgordonuniversity: 'International College at Robert Gordon University (ICRGU)',
  regentcollegelondon: 'Regent College',
  astonuniversityoncampus: 'Aston University ONCAMPUS Centre',
  londonsouthbankuniversityoncampus: 'London South Bank University ONCAMPUS Centre',
  universityofhulloncampus: 'University of Hull ONCAMPUS Centre',
};
// Places added to the starting list after it was first written (the owner, 20 Nov 2026: the three ISC pathways); an installation
// that already has its list gets them once, with the owner's choice.
const ADDED = ['london-metropolitan-university-isc-progression-degree-for-pathway', 'university-of-cumbria-isc-progression-degree-for-pathway', 'university-of-wolverhampton-isc-progression-degree-for-pathway'];

function clean(e) {
  if (!e || typeof e !== 'object') return null;
  // A partner's short or old spelling is read as its full name (partner-names.js).
  const options = [...new Set((Array.isArray(e.options) ? e.options : []).map((o) => tidy(partnerName(tidy(o, 120)), 120)).filter(Boolean))];
  const name = tidy(e.name, 160);
  const id = tidy(e.id, 160).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name || !id || !options.length) return null;
  // Every place can be moved to any partner (the owner, 21 Nov 2026: a partner can lose its agreement), so the partner chosen is kept
  // even when it is not one that lists the place. A place with a direct route (own agreement, OIEG, Navitas) remembers that route
  // (directPartner), so it can be moved to a B2B partner and back; `direct` is true while it goes through that route.
  const chosen = tidy(partnerName(tidy(e.partner, 120)), 120);
  const partner = chosen || options[0];
  const directPartner = tidy(partnerName(tidy(e.directPartner, 120)), 120) || (e.direct ? partner : '');
  return {
    id, name, type: e.type === 'college' ? 'college' : 'university', options, partner,
    ...(directPartner ? { directPartner } : {}),
    ...(directPartner && partner === directPartner ? { direct: true } : {}),
    ...(e.changedBy ? { changedBy: tidy(e.changedBy, 120), changedAt: tidy(e.changedAt, 40) } : {}),
  };
}

// `wanted()`: whether this installation works with the partners in the starting list (asked once, when there is no file yet).
function createApplyThrough(dir, { wanted = () => false } = {}) {
  const file = path.join(dir, 'apply-through.json');
  let cache = null;
  function read() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { stat = null; }
    if (!stat) {
      let entries = [];
      if (wanted()) { try { entries = JSON.parse(fs.readFileSync(SEED, 'utf8')).map(clean).filter(Boolean); } catch (e) { entries = []; } }
      save(entries);
      return entries;
    }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.entries;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = (Array.isArray(raw.entries) ? raw.entries : []).map(clean).filter(Boolean);
      // A list made from the starting list (it has entries) gets the places added to it since, once.
      const have = new Set(entries.map((e) => e.id));
      if (entries.length && ADDED.some((id) => !have.has(id))) {
        let seed = [];
        try { seed = JSON.parse(fs.readFileSync(SEED, 'utf8')).map(clean).filter(Boolean); } catch (e) { seed = []; }
        const more = seed.filter((e) => ADDED.includes(e.id) && !have.has(e.id));
        if (more.length) { save([...entries, ...more]); return [...entries, ...more]; }
      }
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, entries };
      return entries;
    } catch (e) { return cache ? cache.entries : []; }
  }
  function save(entries) {
    writeFileAtomic(file, JSON.stringify({ entries }, null, 1));
    cache = null;
  }
  return {
    all: () => read(),
    // For the daily backup: the list as saved, or null when none is saved yet. Unlike all() it never creates the file, so a backup
    // taken before the partners are set up cannot leave an empty list where the starting list belongs.
    stored: () => (fs.existsSync(file) ? read() : null),
    // A restore from a backup: the list as it was (every entry cleaned again).
    restoreAll(entries) { if (Array.isArray(entries)) save(entries.map(clean).filter(Boolean)); },
    // Every place, A to Z, universities first (the owner, 21 Nov 2026: all of them, each with its dropdown).
    choices: () => read().slice().sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'university' ? -1 : 1)),
    // The entry for a university's name as Universities writes it, or null. Universities are preferred to colleges.
    find(name) {
      const key = squash(ALIASES[squash(name)] || name);
      if (!key) return null;
      const all = read();
      const exact = all.filter((e) => squash(e.name) === key);
      return exact.find((e) => e.type === 'university') || exact[0] || null;
    },
    // Changes the partner of one place to one that lists it, one of `partners` (every B2B partner, given by the server), or its own
    // direct route. { entry, from } or { error }.
    choose(id, partner, by, partners = []) {
      const entries = read();
      const i = entries.findIndex((e) => e.id === id);
      if (i < 0) return { error: 'That university is not in the list.' };
      const e = entries[i];
      const to = tidy(partnerName(tidy(partner, 120)), 120);
      const allowed = new Set([...e.options, ...(e.directPartner ? [e.directPartner] : []), ...partners.map((x) => tidy(partnerName(tidy(x, 120)), 120))]);
      if (!to || !allowed.has(to)) return { error: `${to || 'That partner'} is not a partner here. Add it on B2B Partners first.` };
      const from = e.partner;
      const { direct, ...rest } = e;
      entries[i] = { ...rest, partner: to, ...(e.directPartner && to === e.directPartner ? { direct: true } : {}), changedBy: tidy(by, 120), changedAt: new Date().toISOString() };
      save(entries);
      return { entry: entries[i], from };
    },
  };
}

module.exports = { createApplyThrough, choosable, squash };
