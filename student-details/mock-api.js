// The student's own portal (the owner, 20 Nov 2026).
//
//   A student's login opens only their own portal (/my-portal): hello by name, every university applied to with its decision and
//   deadline, a progress line (Applied, Offer, Mock interview, Payment, CAS, Visa), the mock interviews held so far with the team's
//   feedback (the sheet's Mock Schedule and Feedback columns). The mock interview guides were taken out (the owner, 28 Nov 2026).
//
// Nothing here sends an email: emails to students stay off until the owner says to start (the owner, 20 Nov 2026).

const { sendJSON } = require('../shared/server-utils');
const Teams = require('../shared/teams');

const text = (v) => String(v ?? '').trim();
const ISO = /^\d{4}-\d{2}-\d{2}/;

function createMockApi({ portal, cards, facts, isoDate }) {
  const dateOf = (v) => { const d = isoDate ? isoDate(v) : ''; return d && ISO.test(d) ? d.slice(0, 10) : ''; };

  // The progress line: each step is done when the sheet has its date (or result).
  function progressOf(row, apps) {
    const has = (c) => text(row[c]);
    const mocks = [1, 2, 3, 4].some((n) => has(`MOCK SCHEDULE ${n}`));
    const preCas = has('PRE CAS INTERVIEW');
    const steps = [
      { key: 'applied', label: 'Applied', done: apps.some((a) => a.applied) || Boolean(dateOf(row['APPLICATION SUBMISSION DATE'])) },
      { key: 'offer', label: 'Offer', done: apps.some((a) => a.offer) || Boolean(dateOf(row['OFFER RECEIVED DATE'])) },
      { key: 'mock', label: 'Mock interview', done: /^pass/i.test(preCas), started: mocks },
      { key: 'payment', label: 'Payment', done: Boolean(dateOf(row['PAYMENT DATE']) || has('TUITION FEE DEPOSIT(1st Installment)')) },
      { key: 'cas', label: 'CAS', done: Boolean(dateOf(row['CAS RECEIVED DATE'])) },
      { key: 'visa', label: 'Visa', done: Boolean(dateOf(row['VISA RECEIVED DATE'])) || text(row[Teams.STATUS]) === 'Visa Issued' },
    ];
    // A later step done means the earlier ones are behind the student too.
    for (let i = steps.length - 2; i >= 0; i -= 1) if (steps[i + 1].done) steps[i].done = true;
    const at = steps.findIndex((s) => !s.done);
    return steps.map((s, i) => ({ key: s.key, label: s.label, state: s.done ? 'done' : i === at ? 'now' : 'next' }));
  }

  // The next deadline Universities knows for a university, or null.
  function deadlineOf(name) {
    try {
      const k = name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
      const hit = facts.list('').find((u) => u.name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '') === k);
      return hit && hit.next ? { intake: hit.next.intake, when: hit.next.when, days: hit.next.days } : null;
    } catch (e) { return null; }
  }

  function studentView(user) {
    const found = portal.rowIndex().get(text(user.studentRow));
    if (!found) return { linked: false, firstName: text(user.name).split(/\s+/)[0] || '' };
    const row = found.row;
    const card = cards.get(row._id);
    const apps = portal.applicationsOf(row, card || { options: [] }).filter((a) => a.applied || a.offer || a.refused || a.withdrawn);
    const main = text(row['UNIVERSITY NAME']).toLowerCase();
    const progress = progressOf(row, apps);
    // A deadline matters only before the CAS: a student who has it is past every application deadline.
    const pastDeadlines = progress.some((s) => s.key === 'cas' && s.state === 'done');
    const applications = apps.map((a) => {
      const decision = a.withdrawn ? 'Withdrawn' : a.refused ? 'Refused' : a.offer ? (a.offerType ? `${a.offerType} offer` : 'Offer') : 'Waiting for the decision';
      return {
        university: a.university, course: a.course, applied: a.applied, offer: a.offer, refused: a.refused, withdrawn: a.withdrawn, reason: a.refused || a.withdrawn ? a.reason || '' : '',
        decision, main: Boolean(main) && a.university.toLowerCase() === main,
        deadline: a.refused || a.withdrawn || pastDeadlines ? null : deadlineOf(a.university),
      };
    });
    const mocks = [1, 2, 3, 4].map((n) => ({ n, date: text(row[`MOCK SCHEDULE ${n}`]), feedback: text(row[`FEEDBACK ${n}`]) })).filter((m) => m.date || m.feedback);
    return {
      linked: true,
      firstName: text(row['FIRST NAME']) || text(user.name).split(/\s+/)[0] || '',
      intake: found.sheet && found.sheet.name ? found.sheet.name : '',
      progress,
      applications,
      mocks,
      preCas: text(row['PRE CAS INTERVIEW']),
    };
  }

  async function handle(req, res, urlPath) {
    const user = req.user;
    // ---- The student's own portal ----
    if (urlPath === '/api/my-portal' || urlPath.startsWith('/api/my-portal/')) {
      if (!Teams.isStudent(user)) { sendJSON(res, 403, { error: 'This is for a student\'s own login.' }); return true; }
      const me = studentView(user);
      if (urlPath === '/api/my-portal' && req.method === 'GET') { sendJSON(res, 200, me); return true; }
      sendJSON(res, 404, { error: 'Not found' });
      return true;
    }

    return false;
  }

  return { handle, studentView };
}

module.exports = { createMockApi };
