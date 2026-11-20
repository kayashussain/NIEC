// The student's own portal and the mock interview guides (the owner, 20 Nov 2026).
//
//   A student's login opens only their own portal (/my-portal): hello by name, every university applied to with its decision and
//   deadline, a progress line (Applied, Offer, Mock interview, Payment, CAS, Visa), the mock interviews held so far with the team's
//   feedback (the sheet's Mock Schedule and Feedback columns), and the mock interview guide of each university, read phase by phase.
//   A student reads published guides only, and only for the universities they applied to (plus the guide every student reads).
//
//   The guides (/mock-guides) are written by the Mock Team, the Manager and Admin; only Admin publishes one to students.
//
// Nothing here sends an email: emails to students stay off until the owner says to start (the owner, 20 Nov 2026).

const { sendJSON, readJSONBody } = require('../shared/server-utils');
const Teams = require('../shared/teams');
const { PHASES } = require('./mock-guides');

const text = (v) => String(v ?? '').trim();
const ISO = /^\d{4}-\d{2}-\d{2}/;

// Who works on the guides: Admin, the Manager and the Mock Team. Only Admin publishes.
const guideAccess = (user) => {
  if (!user || Teams.isStudent(user)) return null;
  if (user.role === 'admin') return 'publish';
  if (user.role === 'manager' || (user.departments || []).includes('mock')) return 'edit';
  return null;
};

function createMockApi({ guides, portal, cards, facts, direct, activity, isoDate }) {
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
      const guide = guides.forName(a.university);
      const view = guide ? guides.view(guide.key, 'published') : null;
      const decision = a.withdrawn ? 'Withdrawn' : a.refused ? 'Refused' : a.offer ? (a.offerType ? `${a.offerType} offer` : 'Offer') : 'Waiting for the decision';
      return {
        university: a.university, course: a.course, applied: a.applied, offer: a.offer, refused: a.refused, withdrawn: a.withdrawn, reason: a.refused || a.withdrawn ? a.reason || '' : '',
        decision, main: Boolean(main) && a.university.toLowerCase() === main,
        deadline: a.refused || a.withdrawn || pastDeadlines ? null : deadlineOf(a.university),
        guide: guide && view && view.ownGuide ? guide.key : '',
      };
    });
    const mocks = [1, 2, 3, 4].map((n) => ({ n, date: text(row[`MOCK SCHEDULE ${n}`]), feedback: text(row[`FEEDBACK ${n}`]) })).filter((m) => m.date || m.feedback);
    const core = guides.view(null, 'published');
    return {
      linked: true,
      firstName: text(row['FIRST NAME']) || text(user.name).split(/\s+/)[0] || '',
      intake: found.sheet && found.sheet.name ? found.sheet.name : '',
      progress,
      applications,
      mocks,
      preCas: text(row['PRE CAS INTERVIEW']),
      coreGuide: Boolean(core),
      phases: PHASES,
    };
  }

  async function body(req, res, max = 256 * 1024) {
    try { return await readJSONBody(req, max); } catch (e) { sendJSON(res, 400, { error: 'That could not be read.' }); return null; }
  }

  async function handle(req, res, urlPath) {
    const user = req.user;
    // ---- The student's own portal ----
    if (urlPath === '/api/my-portal' || urlPath.startsWith('/api/my-portal/')) {
      if (!Teams.isStudent(user)) { sendJSON(res, 403, { error: 'This is for a student\'s own login.' }); return true; }
      const me = studentView(user);
      if (urlPath === '/api/my-portal' && req.method === 'GET') { sendJSON(res, 200, me); return true; }
      if (!me.linked) { sendJSON(res, 400, { error: 'Your login is not linked to your file yet. Please ask the office.' }); return true; }
      const rowId = text(user.studentRow);
      // The guide for one of the student's universities, or "core" (published only).
      const g = urlPath.match(/^\/api\/my-portal\/guide\/([a-z0-9]{1,120})$/);
      if (g && req.method === 'GET') {
        const key = g[1];
        if (key !== 'core' && !me.applications.some((a) => a.guide === key)) { sendJSON(res, 404, { error: 'No guide for that university yet.' }); return true; }
        const view = guides.view(key === 'core' ? null : key, 'published');
        if (!view) { sendJSON(res, 404, { error: 'Your guide is being prepared. Please check again soon.' }); return true; }
        sendJSON(res, 200, { ...view, read: guides.readOf(rowId, view.key) });
        return true;
      }
      if (urlPath === '/api/my-portal/read' && req.method === 'POST') {
        const b = await body(req, res, 4096);
        if (!b) return true;
        const key = text(b.guide);
        if (key !== 'core' && !me.applications.some((a) => a.guide === key)) { sendJSON(res, 404, { error: 'No such guide.' }); return true; }
        const out = guides.markRead(rowId, key, text(b.phase));
        if (out.error) { sendJSON(res, 400, out); return true; }
        sendJSON(res, 200, out);
        return true;
      }
      sendJSON(res, 404, { error: 'Not found' });
      return true;
    }

    // ---- The guides, for the team ----
    if (urlPath === '/api/mock-guides' || urlPath.startsWith('/api/mock-guides/')) {
      const level = guideAccess(user);
      if (!level) { sendJSON(res, 403, { error: 'The mock interview guides are for Admin, the Manager and the Mock Team.' }); return true; }
      const record = (what) => activity.record(req, user, 'Edited mock interview guide', { app: 'Mock interviews', changes: [what] });
      if (urlPath === '/api/mock-guides' && req.method === 'GET') {
        const have = guides.list();
        // The Partner Universities with no guide yet, to start one (OIEG and Navitas are groups of colleges, not one university).
        const free = (direct ? direct.all() : []).map((u) => u.name).filter((n) => !/^(navitas|oxford international)/i.test(n) && !guides.forName(n)).sort((a, b) => a.localeCompare(b));
        sendJSON(res, 200, { canPublish: level === 'publish', phases: PHASES, guides: have, universities: free });
        return true;
      }
      if (urlPath === '/api/mock-guides' && req.method === 'POST') {
        const b = await body(req, res, 4096);
        if (!b) return true;
        const out = guides.create(b.name, user.label || user.name);
        if (out.error) { sendJSON(res, 400, out); return true; }
        record(`Started a mock interview guide for ${out.guide.name}`);
        sendJSON(res, 200, out.guide);
        return true;
      }
      const m = urlPath.match(/^\/api\/mock-guides\/([a-z0-9]{1,120})(?:\/(publish|unpublish|preview))?$/);
      if (!m) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      const [, key, action] = m;
      const g = guides.get(key);
      if (!g) { sendJSON(res, 404, { error: 'No such guide.' }); return true; }
      if (!action && req.method === 'GET') { sendJSON(res, 200, g); return true; }
      // The guide as a student would read it: the draft (what the team is writing) or the published copy.
      if (action === 'preview' && req.method === 'GET') {
        const which = new URL(req.url, 'http://x').searchParams.get('which') === 'published' ? 'published' : 'draft';
        sendJSON(res, 200, guides.view(key === 'core' ? null : key, which) || { phases: [], questions: [] });
        return true;
      }
      if (req.method !== 'POST') { sendJSON(res, 405, { error: 'Method not allowed' }); return true; }
      if (!action) {
        const b = await body(req, res);
        if (!b) return true;
        const out = guides.saveDraft(key, b, user.label || user.name);
        if (out.error) { sendJSON(res, 400, out); return true; }
        record(`Saved the draft of the ${g.name} guide`);
        sendJSON(res, 200, out.guide);
        return true;
      }
      if (level !== 'publish') { sendJSON(res, 403, { error: 'Only Admin publishes a guide to students.' }); return true; }
      const out = action === 'publish' ? guides.publish(key, user.label || user.name) : guides.unpublish(key, user.label || user.name);
      if (out.error) { sendJSON(res, 400, out); return true; }
      record(action === 'publish' ? `Published the ${g.name} guide to students` : `Took the ${g.name} guide back from students`);
      sendJSON(res, 200, out.guide);
      return true;
    }
    return false;
  }

  return { handle, studentView };
}

module.exports = { createMockApi, guideAccess };
