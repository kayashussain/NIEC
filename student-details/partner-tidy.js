// A one-time tidy-up of the partners, asked for by the owner on 15 Nov 2026. It runs once when the server starts (planning
// settings remember it, so a partner Admin later changes back is left alone) and every change is written in Activity.
//
//   Navitas and OIEG are direct universities: they are added to Partner Universities (a B2B card of the same name moves there,
//   with its portal, login, contacts and notes) and are no longer offered as B2B partners.
//   ARUC is part of Navitas: a student whose University Partner is ARUC becomes Navitas.
//   "Awarded" and "Awarded Edu" are one B2B partner, and so are "TOR" and "The Official Rep" (TOR is its short name): the
//   students are put under the name of the B2B card (or the first spelling, when there is no card yet), and the other spelling
//   is kept as a known other name of it, so it never shows as a partner of its own again. "The Official Representative" is the
//   same partner as TOR and The Official Rep (a second step, below, for installations where the first one already ran).
// Names are compared ignoring capitals, spaces and punctuation.

const { RENAMES, samePartner } = require('./partner-names');
const TIDY_ID = 'partners-2026-11-15';
const DIRECT = ['Navitas', 'OIEG'];
// [the name to use when there is no B2B card yet, every spelling of it]
const SAME = [
  ['Navitas', ['ARUC']],
  ['Awarded Edu', ['Awarded Edu', 'Awarded', 'AwardedEdu']],
  // TOR, The Official Rep and The Official Representative are one B2B partner (the owner, 15 Nov 2026); its card's name wins.
  ['The Official Representative', ['The Official Representative', 'Official Representative', 'The Official Rep', 'Official Rep', 'TOR']],
];
const COLUMN = 'UNIVERSITY PARTNER';

const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');

function tidyPartners({ getWorkbook, writeWorkbook, direct, b2b, planning, record = () => {} }) {
  const settings = planning.all().settings;
  if ((settings.tidied || []).includes(TIDY_ID)) return { skipped: true };
  const changes = [];

  // Only names this installation uses: a fresh installation (another consultancy) gets nothing added.
  const wb0 = getWorkbook();
  const used = new Set([
    ...(wb0 ? wb0.sheets.flatMap((sh) => sh.rows.map((r) => squash(r && r[COLUMN]))) : []),
    ...b2b.all().map((p) => squash(p.name)), ...(settings.notPartners || []).map(squash),
  ].filter(Boolean));

  // 1. Navitas and OIEG on Partner Universities, not on B2B Partners.
  for (const name of DIRECT) {
    if (!used.has(squash(name)) && !(name === 'Navitas' && used.has('aruc'))) continue;
    const card = b2b.all().find((p) => squash(p.name) === squash(name));
    let uni = direct.all().find((u) => squash(u.name) === squash(name));
    if (!uni) {
      const made = direct.create(card ? card.name : name, 'Vishnu tidy-up');
      if (made.error) continue;
      uni = made.university;
      if (card) {
        const moved = direct.update(uni.id, { ...uni, status: card.status, agreementStart: card.agreementStart, agreementEnd: card.agreementEnd, contacts: card.contacts,
          notes: [card.notes, card.city ? `City: ${card.city}` : ''].filter(Boolean).join('\n'),
          apply: card.applyPortal || card.applyEmail || '', applyUser: card.applyUser || '', applyPassword: card.applyPassword || '' }, 'Vishnu tidy-up');
        if (!moved.error) uni = moved.university;
      }
      changes.push(`${uni.name}: added to Partner Universities (a direct university)`);
    }
    if (card) {
      // A card with agreement files is kept (Ended) so no file is lost; otherwise it is removed.
      if ((card.agreements || []).length) { b2b.update(card.id, { ...card, status: 'Ended' }, 'Vishnu tidy-up'); changes.push(`${card.name}: B2B card marked Ended (it is a direct university now; its files are kept)`); }
      else { b2b.remove(card.id); changes.push(`${card.name}: removed from B2B Partners (it is a direct university now)`); }
    }
  }

  // 2. The spellings of one partner put together, on the sheet and as known other names.
  const aliases = { ...(settings.partnerAliases || {}) };
  const targetOf = new Map();
  for (const [fallback, spellings] of SAME) {
    const keys = new Set([squash(fallback), ...spellings.map(squash)]);
    if (![...keys].some((k) => used.has(k))) continue;
    const uni = direct.all().find((u) => keys.has(squash(u.name)));
    const card = b2b.all().find((p) => p.status !== 'Ended' && keys.has(squash(p.name)));
    const target = (uni && squash(fallback) === squash(uni.name) && uni.name) || (card && card.name) || fallback;
    keys.forEach((k) => { if (k !== squash(target)) targetOf.set(k, target); });
    spellings.forEach((sp) => { if (squash(sp) !== squash(target)) aliases[sp] = target; });
  }
  const wb = getWorkbook();
  if (wb) {
    const moved = {};
    const sheets = wb.sheets.map((sheet) => ({ ...sheet, rows: sheet.rows.map((row) => {
      const v = String((row && row[COLUMN]) || '').trim();
      const to = v && targetOf.get(squash(v));
      if (!to) return row;
      moved[`${v} → ${to}`] = (moved[`${v} → ${to}`] || 0) + 1;
      return { ...row, [COLUMN]: to };
    }) }));
    const lines = Object.entries(moved).map(([k, n]) => `University Partner ${k}: ${n} student${n === 1 ? '' : 's'}`);
    if (lines.length) { writeWorkbook({ ...wb, sheets, revision: (Number(wb.revision) || 0) + 1 }); changes.push(...lines); }
  }

  // 3. None of these names is hidden as "not a partner" any more: each is a partner, or another name of one.
  const all = new Set([...DIRECT, ...SAME.flatMap(([f, sp]) => [f, ...sp])].map(squash));
  const notPartners = (settings.notPartners || []).filter((n) => !all.has(squash(n)));
  if (notPartners.length !== (settings.notPartners || []).length) changes.push('Navitas, OIEG, ARUC, Awarded, Official Rep and TOR no longer hidden as not partners');
  planning.saveSettings({ notPartners, partnerAliases: aliases, tidied: [...(settings.tidied || []), TIDY_ID] });
  if (changes.length) record(changes);
  return { changes };
}

// The second step (the owner, 15 Nov 2026): on an installation where the first step already ran, TOR and The Official Rep were put
// together under "The Official Rep", while the B2B card is "The Official Representative". Every spelling now goes under the card's
// name (the students, the known other names, the hidden list), once. A second card for the short spelling is removed (kept as
// Ended when it has files).
const TIDY_ID2 = 'partners-2026-11-15-b';
const REP = ['The Official Representative', 'Official Representative', 'The Official Rep', 'Official Rep', 'TOR'];
function tidyOfficialRep({ getWorkbook, writeWorkbook, b2b, planning, record = () => {} }) {
  const settings = planning.all().settings;
  if ((settings.tidied || []).includes(TIDY_ID2)) return { skipped: true };
  const keys = new Set(REP.map(squash));
  const cards = b2b.all().filter((p) => keys.has(squash(p.name)));
  const used = new Set([
    ...(getWorkbook() ? getWorkbook().sheets.flatMap((sh) => sh.rows.map((r) => squash(r && r[COLUMN]))) : []),
    ...cards.map((p) => squash(p.name)), ...(settings.notPartners || []).map(squash), ...Object.keys(settings.partnerAliases || {}).map(squash),
  ]);
  const changes = [];
  if ([...keys].some((k) => used.has(k))) {
    // The card with the long name wins; else any card of it; else the long name.
    const main = cards.find((p) => /representative/i.test(p.name) && p.status !== 'Ended') || cards.find((p) => p.status !== 'Ended') || null;
    const target = main ? main.name : 'The Official Representative';
    cards.filter((p) => p !== main && p.status !== 'Ended').forEach((p) => {
      if ((p.agreements || []).length) { b2b.update(p.id, { ...p, status: 'Ended' }, 'Vishnu tidy-up'); changes.push(`${p.name}: B2B card marked Ended (the same partner as ${target})`); }
      else { b2b.remove(p.id); changes.push(`${p.name}: B2B card removed (the same partner as ${target})`); }
    });
    const wb = getWorkbook();
    if (wb) {
      let n = 0;
      const sheets = wb.sheets.map((sh) => ({ ...sh, rows: sh.rows.map((row) => {
        const v = String((row && row[COLUMN]) || '').trim();
        if (!v || !keys.has(squash(v)) || v === target) return row;
        n += 1;
        return { ...row, [COLUMN]: target };
      }) }));
      if (n) { writeWorkbook({ ...wb, sheets, revision: (Number(wb.revision) || 0) + 1 }); changes.push(`University Partner → ${target}: ${n} student${n === 1 ? '' : 's'}`); }
    }
    const aliases = { ...(settings.partnerAliases || {}) };
    Object.keys(aliases).forEach((k) => { if (keys.has(squash(k)) || keys.has(squash(aliases[k]))) delete aliases[k]; });
    REP.forEach((sp) => { if (squash(sp) !== squash(target)) aliases[sp] = target; });
    const notPartners = (settings.notPartners || []).filter((x) => !keys.has(squash(x)));
    if (notPartners.length !== (settings.notPartners || []).length) changes.push(`${target}: no longer hidden`);
    planning.saveSettings({ partnerAliases: aliases, notPartners, tidied: [...(settings.tidied || []), TIDY_ID2] });
  } else {
    planning.saveSettings({ tidied: [...(settings.tidied || []), TIDY_ID2] });
  }
  if (changes.length) record(changes);
  return { changes };
}

// The third step (the owner, 20 Nov 2026), once:
//   "Leeds Beckett University" is a university, not a B2B partner: its B2B card is removed (kept as Ended when it has files).
//   OIEG ("OIG") is a direct university, not a B2B partner: it is no longer in the hidden list of B2B Partners.
//   Nisus Educational Consultancy is a new B2B partner (University of Wolverhampton is applied through it): its card is added, on an
//   installation that works with Real Dreams, Adventus or Apply Board only, so another consultancy gets nothing added.
// Partners are no longer added by hand on the partner pages (the owner, 20 Nov 2026), so a new partner the owner asks for is added here.
const TIDY_ID3 = 'partners-2026-11-20';
const NOT_B2B = ['Leeds Beckett University'];
const NEW_B2B = ['Nissus International Education Foundation']; // first added as "Nisus Educational Consultancy"; renamed by the fourth step
function tidyNov20({ b2b, planning, record = () => {} }) {
  const settings = planning.all().settings;
  if ((settings.tidied || []).includes(TIDY_ID3)) return { skipped: true };
  const changes = [];
  const gone = new Set(NOT_B2B.map(squash));
  b2b.all().filter((p) => gone.has(squash(p.name)) && p.status !== 'Ended').forEach((p) => {
    if ((p.agreements || []).length) { b2b.update(p.id, { ...p, status: 'Ended' }, 'Vishnu tidy-up'); changes.push(`${p.name}: B2B card marked Ended (it is a university, not a B2B partner; its files are kept)`); }
    else { b2b.remove(p.id); changes.push(`${p.name}: removed from B2B Partners (it is a university, not a B2B partner)`); }
  });
  const isOieg = (n) => /^(oig|oieg|oiegroup|oxfordinternational)/.test(squash(n));
  const notPartners = (settings.notPartners || []).filter((n) => !isOieg(n));
  if (notPartners.length !== (settings.notPartners || []).length) changes.push('OIEG is no longer in the hidden list of B2B Partners (it is a direct university)');
  if (b2b.all().some((p) => /^(realdreams|realdreamseducationalconsultancy|adventus|applyboard)$/.test(squash(p.name)))) {
    NEW_B2B.forEach((name) => {
      if (b2b.all().some((p) => samePartner(p.name, name))) return;
      const made = b2b.create(name, 'Vishnu tidy-up');
      if (!made.error) changes.push(`${name}: added to B2B Partners`);
    });
  }
  planning.saveSettings({ notPartners, tidied: [...(settings.tidied || []), TIDY_ID3] });
  if (changes.length) record(changes);
  return { changes };
}

// The fourth step (the owner, 20 Nov 2026), once: the partners' full names (partner-names.js). "Real Dreams" becomes Real Dreams
// Educational Consultancy and "Nisus Educational Consultancy" becomes Nissus International Education Foundation: the B2B card, the
// University Partner column on the sheet and the partner on each student's shortlist. The old spellings stay known as other names, so
// nothing saved before loses its meaning, and they never show as a partner of their own.
const TIDY_ID4 = 'partners-2026-11-20-names';
function tidyNames({ getWorkbook, writeWorkbook, b2b, cards, planning, record = () => {} }) {
  const settings = planning.all().settings;
  if ((settings.tidied || []).includes(TIDY_ID4)) return { skipped: true };
  const changes = [];
  RENAMES.forEach(([target, old]) => {
    const olds = new Set(old.map(squash));
    const isOld = (v) => olds.has(squash(v)) && String(v).trim() !== target;
    // The card: renamed; a second card of the same partner (both spellings saved) is ended or removed, as in the second step.
    const mine = b2b.all().filter((p) => samePartner(p.name, target));
    const main = mine.find((p) => p.name === target && p.status !== 'Ended') || mine.find((p) => p.status !== 'Ended') || null;
    if (main && main.name !== target) {
      const out = b2b.update(main.id, { ...main, name: target }, 'Vishnu tidy-up');
      if (!out || !out.error) changes.push(`${main.name}: B2B card renamed to ${target}`);
    }
    mine.filter((p) => p !== main && p.status !== 'Ended').forEach((p) => {
      if ((p.agreements || []).length) { b2b.update(p.id, { ...p, status: 'Ended' }, 'Vishnu tidy-up'); changes.push(`${p.name}: B2B card marked Ended (the same partner as ${target})`); }
      else { b2b.remove(p.id); changes.push(`${p.name}: B2B card removed (the same partner as ${target})`); }
    });
    // The sheet.
    const wb = getWorkbook();
    if (wb) {
      let n = 0;
      const sheets = wb.sheets.map((sh) => ({ ...sh, rows: sh.rows.map((row) => {
        if (!row || !isOld(row[COLUMN])) return row;
        n += 1;
        return { ...row, [COLUMN]: target };
      }) }));
      if (n) { writeWorkbook({ ...wb, sheets, revision: (Number(wb.revision) || 0) + 1 }); changes.push(`University Partner → ${target}: ${n} student${n === 1 ? '' : 's'}`); }
    }
    // The shortlists.
    if (cards) {
      let n = 0;
      Object.entries(cards.all() || {}).forEach(([rowId, card]) => (card.options || []).forEach((o) => {
        if (o.partner && isOld(o.partner) && !cards.updateOption(rowId, o.id, { partner: target }, 'Vishnu tidy-up').error) n += 1;
      }));
      if (n) changes.push(`Shortlists → ${target}: ${n} course${n === 1 ? '' : 's'}`);
    }
    // The other names, and the hidden list.
    const now = planning.all().settings;
    const aliases = { ...(now.partnerAliases || {}) };
    Object.keys(aliases).forEach((k) => { if (olds.has(squash(aliases[k]))) aliases[k] = target; });
    old.forEach((sp) => { if (squash(sp) !== squash(target)) aliases[sp] = target; });
    const notPartners = (now.notPartners || []).filter((x) => !olds.has(squash(x)) && squash(x) !== squash(target));
    planning.saveSettings({ partnerAliases: aliases, notPartners });
  });
  planning.saveSettings({ tidied: [...(planning.all().settings.tidied || []), TIDY_ID4] });
  if (changes.length) record(changes);
  return { changes };
}

module.exports = { tidyPartners, tidyOfficialRep, tidyNov20, tidyNames, TIDY_ID, TIDY_ID2, TIDY_ID3, TIDY_ID4, squash };
