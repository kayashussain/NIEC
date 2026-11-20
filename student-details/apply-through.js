// Apply through (the owner, 20 Nov 2026): which partner each UK university, and each international college, is applied through.
//
//   A university and its international college are two different places to apply and are never put together (University of
//   Greenwich is one entry, University of Greenwich International College (UGIC) another).
//   A direct route always wins and is not a choice: the consultancy's own agreement, Oxford International Education Group (OIEG)
//   and Navitas. Such an entry has `direct: true` and only that one partner.
//   Where only one partner offers a place there is nothing to choose either.
//   The Apply through page lists only the places two or more B2B partners offer, with no direct route; Admin chooses the partner
//   there, and every change is written in Activity. The Application Team sees the list and the Fact File shows the chosen partner on
//   the university's page (Admin and the Application Team only).
//
// The starting list is apply-through-seed.json: the partners' UK lists read on 20 Nov 2026 (Real Dreams through Route2Uni, Adventus,
// Apply Board and the OIEG website) with the owner's choices that day. It is written into apply-through.json in the data folder on
// first use, only on an installation that works with those partners; another consultancy starts with an empty list. The file is
// written whole and atomically.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');

const SEED = path.join(__dirname, 'apply-through-seed.json');
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Two or more partners and no direct route: the owner chooses.
const choosable = (e) => !e.direct && Array.isArray(e.options) && e.options.length > 1;
// Other names the Fact File uses for a place in the list.
const ALIASES = { uwebristol: 'University of the West of England', healthscienceuniversity: 'Health Sciences University', universityofroehampton: 'Roehampton University', ravensbourneuniversitylondon: 'Ravensbourne University', bathspa: 'Bath Spa University' };

function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const options = (Array.isArray(e.options) ? e.options : []).map((o) => tidy(o, 120)).filter(Boolean);
  const name = tidy(e.name, 160);
  const id = tidy(e.id, 160).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name || !id || !options.length) return null;
  const partner = options.includes(tidy(e.partner, 120)) ? tidy(e.partner, 120) : options[0];
  return {
    id, name, type: e.type === 'college' ? 'college' : 'university', options, partner,
    ...(e.direct ? { direct: true } : {}),
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
    // The places the owner chooses for, A to Z, universities first.
    choices: () => read().filter(choosable).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'university' ? -1 : 1)),
    // The entry for a university's name as the Fact File writes it, or null. Universities are preferred to colleges.
    find(name) {
      const key = squash(ALIASES[squash(name)] || name);
      if (!key) return null;
      const all = read();
      const exact = all.filter((e) => squash(e.name) === key);
      return exact.find((e) => e.type === 'university') || exact[0] || null;
    },
    // Changes the partner of one place. { entry, from } or { error }.
    choose(id, partner, by) {
      const entries = read();
      const i = entries.findIndex((e) => e.id === id);
      if (i < 0) return { error: 'That university is not in the list.' };
      const e = entries[i];
      if (!choosable(e)) return { error: `${e.name} has no choice: ${e.direct ? 'it is applied through a direct route' : 'only one partner offers it'}.` };
      const to = tidy(partner, 120);
      if (!e.options.includes(to)) return { error: `${to || 'That partner'} does not offer ${e.name}.` };
      const from = e.partner;
      entries[i] = { ...e, partner: to, changedBy: tidy(by, 120), changedAt: new Date().toISOString() };
      save(entries);
      return { entry: entries[i], from };
    },
  };
}

module.exports = { createApplyThrough, choosable, squash };
