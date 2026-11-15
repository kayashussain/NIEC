// A one-time tidy-up of the partners, asked for by the owner on 15 Nov 2026. It runs once when the server starts (planning
// settings remember it, so a partner Admin later changes back is left alone) and every change is written in Activity.
//
//   Navitas and OIEG are direct universities: they are added to Partner Universities (a B2B card of the same name moves there,
//   with its portal, login, contacts and notes) and are no longer offered as B2B partners.
//   ARUC is part of Navitas: a student whose University Partner is ARUC becomes Navitas.
//   "Awarded" and "Awarded Edu" are one B2B partner, and so are "TOR" and "The Official Rep" (TOR is its short name): the
//   students are put under the name of the B2B card (or the first spelling, when there is no card yet), and the other spelling
//   is kept as a known other name of it, so it never shows as a partner of its own again.
// Names are compared ignoring capitals, spaces and punctuation.

const TIDY_ID = 'partners-2026-11-15';
const DIRECT = ['Navitas', 'OIEG'];
// [the name to use when there is no B2B card yet, every spelling of it]
const SAME = [
  ['Navitas', ['ARUC']],
  ['Awarded Edu', ['Awarded Edu', 'Awarded', 'AwardedEdu']],
  ['The Official Rep', ['The Official Rep', 'Official Rep', 'TOR']],
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
      const made = direct.create(card ? card.name : name, 'ISR tidy-up');
      if (made.error) continue;
      uni = made.university;
      if (card) {
        const moved = direct.update(uni.id, { ...uni, status: card.status, agreementStart: card.agreementStart, agreementEnd: card.agreementEnd, contacts: card.contacts,
          notes: [card.notes, card.city ? `City: ${card.city}` : ''].filter(Boolean).join('\n'),
          apply: card.applyPortal || card.applyEmail || '', applyUser: card.applyUser || '', applyPassword: card.applyPassword || '' }, 'ISR tidy-up');
        if (!moved.error) uni = moved.university;
      }
      changes.push(`${uni.name}: added to Partner Universities (a direct university)`);
    }
    if (card) {
      // A card with agreement files is kept (Ended) so no file is lost; otherwise it is removed.
      if ((card.agreements || []).length) { b2b.update(card.id, { ...card, status: 'Ended' }, 'ISR tidy-up'); changes.push(`${card.name}: B2B card marked Ended (it is a direct university now; its files are kept)`); }
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

module.exports = { tidyPartners, TIDY_ID, squash };
