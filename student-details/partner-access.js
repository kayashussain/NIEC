// Who may look at Partner Universities, B2B Partners, Agents and Message templates, and how much of each they see (the owner, 14 Nov 2026):
//
//   Admin                     everything, and the only one who changes anything.
//   Manager                   every detail with the commission (slabs, payment terms, commission lists, agreement files), to look at.
//   Application and Mock Team Partner Universities, B2B Partners and Agents without the commission: no slabs, payment terms,
//                             commission lists, agreement files or notes.
//   B2B Partners, set up      the Application Team also sets B2B partners up (the owner, 15 Nov 2026): it sees the whole list with the
//                             names on the sheet that are not set up yet, presses Set up or Not a partner and adds a new partner;
//                             on a partner it changes only how to submit: the portal link (or email), its username and its password.
//                             Everything else (name, status, agreement, contacts, commission lists, notes, removing) stays Admin's.
//   Portal logins             the username and password of a portal are for Admin and the Application Team only (the owner,
//                             14 Nov 2026): the Application Team submits the applications; everyone else sees the portal link only.
//   A branch                  Partner Universities the same way (without the commission). No B2B Partners or Agents.
//   Follow-up Team            none of these pages.
//   Message templates         Admin changes them; the Manager, the Application and Mock Teams and the branches read them.
//
// The server strips what an account may not see before anything is sent, so it is never in the page, not even hidden.
const Teams = require('../shared/teams');

function partnerAccess(user) {
  const w = Teams.who(user);
  if (w.role === 'admin') return { direct: 'full', b2b: 'full', agents: 'full', templates: 'edit' };
  const manager = w.role === 'manager';
  const appMock = w.departments.some((d) => d === 'application' || d === 'mock');
  const branch = w.departments.some((d) => Teams.DEPARTMENTS[d] && Teams.DEPARTMENTS[d].source);
  const team = appMock ? 'team' : null;
  const application = w.departments.includes('application');
  return {
    direct: manager ? 'commission' : (appMock || branch ? 'team' : null),
    b2b: manager ? 'commission' : application ? 'setup' : team,
    agents: manager ? 'commission' : team,
    templates: manager || appMock || branch ? 'view' : null,
  };
}

const omit = (o, keys) => { const out = { ...o }; keys.forEach((k) => { delete out[k]; }); return out; };
const LOGIN = ['applyUser', 'applyPassword', 'applyLogin'];
// Who sees the username and password of a portal: Admin and the Application Team.
const seesLogins = (user) => { const w = Teams.who(user); return w.role === 'admin' || w.departments.includes('application'); };
// A Partner University as an account may see it (one from the list, or the whole record). `login`: the portal login is kept.
function shapeDirect(u, level, login = false) {
  if (!u || level === 'full') return u;
  const hide = login ? [] : LOGIN;
  if (level === 'commission') return omit(u, hide);
  return omit(u, [...hide, 'slabs', 'slabCount', 'paymentTerms', 'agreements', 'agreementCount', 'notes']);
}
// A B2B partner or an agent as an account may see it.
function shapePartner(p, level, login = false) {
  if (!p || level === 'full') return p;
  const hide = login ? [] : LOGIN;
  if (level === 'commission') return omit(p, hide);
  return omit(p, [...hide, 'commissions', 'commissionCount', 'agreements', 'agreementCount', 'notes']);
}

module.exports = { partnerAccess, shapeDirect, shapePartner, seesLogins };
