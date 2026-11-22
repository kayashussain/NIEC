// Who may look at Partner Universities, B2B Partners and Agents, and how much of each they see (the owner, 14 Nov 2026):
//
//   Admin                     everything, and the only one who changes anything.
//   Manager                   every detail with the commission (slabs, payment terms, commission lists, agreement files), to look at.
//   Application and Mock Team Partner Universities, B2B Partners and Agents without the commission: no slabs, payment terms,
//                             commission lists, agreement files or notes.
//   B2B Partners, set up      the Application Team also sets B2B partners up (the owner, 15 Nov 2026): it sees the whole list with the
//                             names on the sheet that are not set up yet and presses Not a partner (nothing is added by hand any
//                             more, the owner, 20 Nov 2026);
//                             on a partner it changes only how to submit: the portal link (or email), its username and its password.
//                             Everything else (name, status, agreement, contacts, commission lists, notes, removing) stays Admin's.
//   Portal logins             the username and password of a portal are for Admin and the Application Team only (the owner,
//                             14 Nov 2026): the Application Team submits the applications; everyone else sees the portal link only.
//                             A person who is also in the Mock Team counts as Application Team here only when the Application Team
//                             is their own team (Users, "Their own team"): the Mock Team never sees a portal password, even when
//                             given the Application Team's students too (the owner, 15 Nov 2026). Where a login was held back the
//                             page is told only that there is one (`loginHidden`), to say "you do not have access" when asked.
//   A branch                  Partner Universities the same way (without the commission). No B2B Partners or Agents.
//   Follow-up Team            none of these pages.
//
// The server strips what an account may not see before anything is sent, so it is never in the page, not even hidden.
const Teams = require('../shared/teams');

// Works as the Application Team for the partner pages: in the Application Team, and not in the Mock Team unless the Application Team
// is their own team. A Mock Team person given the Application Team's students as extra access does not see logins or set partners up.
function appTeam(user) {
  const w = Teams.who(user);
  if (!w.departments.includes('application')) return false;
  if (!w.departments.includes('mock')) return true;
  return Boolean(user && user.taskTeam === 'application');
}

// Apply through (the owner, 20 Nov 2026): Admin chooses the partner; the Application Team (and the Mock Team's own people) look.
function partnerAccess(user) {
  const w = Teams.who(user);
  if (w.role === 'admin') return { direct: 'full', b2b: 'full', agents: 'full', applyThrough: 'full' };
  const manager = w.role === 'manager';
  const appMock = w.departments.some((d) => d === 'application' || d === 'mock');
  const branch = w.departments.some((d) => Teams.DEPARTMENTS[d] && Teams.DEPARTMENTS[d].source);
  const team = appMock ? 'team' : null;
  const application = appTeam(user);
  return {
    direct: manager ? 'commission' : (appMock || branch ? 'team' : null),
    b2b: manager ? 'commission' : application ? 'setup' : team,
    agents: manager ? 'commission' : team,
    // The Mock Team's own people have Universities as the Application Team has it (the owner, 22 Nov 2026): Apply now shows where to
    // apply (the partner, the portal link, the contacts), never a portal login (seesLogins stays the Application Team's).
    applyThrough: application || Teams.ownTeamMock(user) ? 'view' : null,
  };
}

const omit = (o, keys) => { const out = { ...o }; keys.forEach((k) => { delete out[k]; }); return out; };
const LOGIN = ['applyUser', 'applyPassword', 'applyLogin'];
// Who sees the username and password of a portal: Admin and the Application Team.
const seesLogins = (user) => Teams.who(user).role === 'admin' || appTeam(user);
const hasLogin = (o) => Boolean(o && (o.applyUser || o.applyPassword || o.applyLogin));
// A Partner University as an account may see it (one from the list, or the whole record). `login`: the portal login is kept.
function shapeDirect(u, level, login = false) {
  if (!u || level === 'full') return u;
  const hide = login ? [] : LOGIN;
  const held = !login && hasLogin(u) ? { loginHidden: true } : {};
  if (level === 'commission') return { ...omit(u, hide), ...held };
  return { ...omit(u, [...hide, 'slabs', 'slabCount', 'paymentTerms', 'agreements', 'agreementCount', 'notes']), ...held };
}
// A B2B partner or an agent as an account may see it.
function shapePartner(p, level, login = false) {
  if (!p || level === 'full') return p;
  const hide = login ? [] : LOGIN;
  const held = !login && hasLogin(p) ? { loginHidden: true } : {};
  if (level === 'commission') return { ...omit(p, hide), ...held };
  return { ...omit(p, [...hide, 'commissions', 'commissionCount', 'agreements', 'agreementCount', 'notes']), ...held };
}

module.exports = { partnerAccess, shapeDirect, shapePartner, seesLogins, appTeam };
