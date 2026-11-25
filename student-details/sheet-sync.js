// What the students sheet's application columns become for a student's University options (no writing, no files): used when the days
// are kept in step and by the check before saving, so what a team checks is what is written. Kept on its own so it is tested on its own.
const { isoDate } = require('./dashboard-stats');
const text = (v) => String(v ?? '').trim();
// A university's name as compared: no case, no spaces or signs, nothing in brackets.
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');

// What All Students' first application and first offer columns become for these University options (no writing): used when the days
// are kept in step, and by the check before saving, so what the team checks is what is written (the owner, 24 Nov 2026).
function syncChanges(row, opts) {
  if (!opts.some((o) => o.applied || o.offer)) return {};
  const uni = text(row['UNIVERSITY NAME']);
  const a0 = isoDate(row['APPLICATION SUBMISSION DATE']) || ''; const o0 = isoDate(row['OFFER RECEIVED DATE']) || '';
  if (uni && (a0 || o0) && !opts.some((o) => squash(o.university) === squash(uni))) opts = [...opts, { university: uni, course: text(row['COURSE NAME']), applied: a0, offer: o0 }];
  // A refused or withdrawn university no longer holds an offer: only standing offers count as the first offer.
  const first = (k) => opts.filter((o) => o[k] && !(k === 'offer' && (o.refused || o.withdrawn))).sort((x, y) => x[k].localeCompare(y[k]))[0] || null;
  const fa = first('applied'); const fo = first('offer');
  const changes = {};
  const sheetHolder = uni ? opts.find((o) => squash(o.university) === squash(uni)) : null;
  // An offer that the university then refused no longer stands: All Students' Offer received day goes (the application day stays), unless
  // another university still holds an offer, which then becomes the first offer below.
  if (!fo && o0 && uni) {
    const sheetOpt = opts.find((o) => squash(o.university) === squash(uni));
    if (sheetOpt && (sheetOpt.refused || sheetOpt.withdrawn) && !sheetOpt.offer) changes['OFFER RECEIVED DATE'] = '';
  }
  // The sheet shows the FIRST application and the FIRST offer: filled when empty, or replaced by an earlier one; a day a person typed that
  // is already the earliest is never overwritten by a later one.
  if (fa && (!a0 || fa.applied < a0)) changes['APPLICATION SUBMISSION DATE'] = fa.applied;
  if (fo && (!o0 || fo.offer < o0 || (sheetHolder && sheetHolder.refused))) changes['OFFER RECEIVED DATE'] = fo.offer;
  // All Students names the university that holds the offer: when the one it names was refused, withdrew or has no offer while another
  // university holds one, the university and course follow it (the sheet never shows one university's name with another's offer day).
  if (fo && uni && sheetHolder && (sheetHolder.refused || sheetHolder.withdrawn || !sheetHolder.offer) && squash(fo.university) !== squash(uni)) {
    changes['UNIVERSITY NAME'] = fo.university; if (fo.course) changes['COURSE NAME'] = fo.course;
  }
  // The university the sheet names refused the student (or the application was withdrawn), nobody holds an offer, and no other course of
  // that university is still live: the sheet follows the first live application elsewhere, so no team reads a refused university as
  // the student's. With no live application anywhere, what is written stays (nothing is erased).
  if (!fo && uni && sheetHolder) {
    const here = opts.filter((o) => squash(o.university) === squash(uni));
    // A course marked Not submitted is not live either, but at least one course there must have been refused or withdrawn.
  if (here.every((o) => o.refused || o.withdrawn || o.skipped) && here.some((o) => o.refused || o.withdrawn)) {
      const live = opts.filter((o) => o.applied && !o.refused && !o.withdrawn && !o.skipped && squash(o.university) !== squash(uni)).sort((x, y) => x.applied.localeCompare(y.applied))[0];
      if (live) {
      // Everything that belonged to the old university goes with it: its course, its partner and its offer day.
      const partner = String(live.partner || '').trim();
      changes['UNIVERSITY NAME'] = live.university;
      changes['COURSE NAME'] = live.course || '';
      changes['UNIVERSITY PARTNER'] = /^direct\b/i.test(partner) ? `Direct (${live.university})` : partner;
      if (o0) changes['OFFER RECEIVED DATE'] = '';
    }
    }
  }
  // The same university, another course: when the course the sheet names was refused or withdrawn and another course of that university
  // holds the offer, the course follows the offer.
  if (fo && uni && fo.course && squash(fo.university) === squash(uni)) {
    const named = opts.find((o) => squash(o.university) === squash(uni) && o.course && squash(o.course) === squash(row['COURSE NAME']));
    if (named && (named.refused || named.withdrawn)) changes['COURSE NAME'] = fo.course;
  }
  // An empty university or course on All Students takes the first offer's (else the first application's); a typed one stays.
  const pick = fo || fa;
  if (pick && !uni) { changes['UNIVERSITY NAME'] = pick.university; if (!text(row['COURSE NAME']) && pick.course) changes['COURSE NAME'] = pick.course; }
  Object.keys(changes).forEach((c) => { if (text(row[c]) === text(changes[c])) delete changes[c]; });
  return changes;
}

module.exports = { syncChanges, squash };
