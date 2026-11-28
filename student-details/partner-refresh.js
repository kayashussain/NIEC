// The Thursday refresh (the owner, 20 Nov 2026): every Thursday from 2 a.m. office time, the courses, requirements and dates of the intake
// worked on (intake-window.js)
// for each university are read again from the partner it was read from, with the login saved on that partner's B2B card, so the team
// never types them:
//
//   Real Dreams   the Route2Uni portal (its login gives a token; each university's page is read as the portal itself reads it)
//   Adventus      the Adventus course search, as a student from Nepal, for the university's campuses and the quarters of the intake
//                 worked on; only courses starting in that intake are kept
//   Apply Board   not read: its sign-in asks a person to prove they are not a robot. Those pages keep what was read on 20 Nov 2026.
//
// What is kept: a university that now lists no course of the intake worked on keeps its last courses (a portal that answers empty for a moment
// never empties a page). A course that is no longer listed simply leaves the page: a student's shortlist and a task keep the course's
// name as they were given, so nothing breaks. The pictures, the about and anything else on the page stay as they are.
// Every run is written in Activity (how many universities were read, and anything that failed). PARTNER_REFRESH=off switches it off.

const { samePartner } = require('./partner-names');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic, localDate } = require('../shared/server-utils');

const TIME_ZONE = 'Asia/Kathmandu';
const FP = require('./fact-present');
const LEVELS = FP.LEVEL_ORDER.filter((l) => l !== 'Other courses');
const OTHER = 'Other courses';
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const tidy = (s) => String(s == null ? '' : s).replace(/[\u2013\u2014]/g, '-').replace(/ /g, ' ').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
const strip = (html) => tidy(String(html || '').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, ' ')).replace(/\n{2,}/g, '\n');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${Number(m[3])} ${MON[m[2] - 1]} ${m[1]}` : ''; };
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const month = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? `${FULL[m[2] - 1]} ${m[1]}` : ''; };
const money = (n, cur = 'GBP') => (n ? `${cur === 'GBP' ? '£' : `${cur} `}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })}` : '');
// The intakes kept: those of the intake worked on (intake-window.js: January, May or September, whichever comes next; it was January,
// February and March 2027, the owner, 20 Nov 2026). Worked out at each reading, so the refresh moves on to the next intake by itself.
const IntakeWindow = require('./intake-window');
const isJan = (s) => IntakeWindow.of().startsWith(s);
// Adventus filters its intakes by calendar quarter ("2027 Q1: Jan, Feb, Mar"): the quarters of the intake worked on.
const QUARTER_MONTHS = ['Jan, Feb, Mar', 'Apr, May, Jun', 'Jul, Aug, Sep', 'Oct, Nov, Dec'];
const adventusIntakes = (w = IntakeWindow.of()) => w.quarters.map((q) => ({ name: `${w.year} Q${q}: ${QUARTER_MONTHS[q - 1]}`, id: `intakes-${w.year}-Q${q}` }));
const mode = (list) => { const c = {}; list.filter(Boolean).forEach((x) => { c[x] = (c[x] || 0) + 1; }); return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [''])[0]; };
const range = (nums, cur) => { const v = nums.filter((x) => x > 0); if (!v.length) return ''; const lo = Math.min(...v); const hi = Math.max(...v); return lo === hi ? `${money(lo, cur)} a year` : `${money(lo, cur)} to ${money(hi, cur)} a year`; };
// The level of a course: the same reading as the page (fact-present.js), in the owner's order (20 Nov 2026).
const levelOf = (name, hint = '') => FP.levelOf(name, hint) || OTHER;
const order = (l) => { const i = LEVELS.indexOf(l); return i < 0 ? 99 : i; };
const finish = (levels, courses, deadlines) => {
  // One line per course: the same course at two campuses or two intakes is one course with both.
  const byName = new Map();
  courses.filter((c) => c.name).forEach((c) => {
    const k = c.name.toLowerCase();
    const was = byName.get(k);
    if (!was) { byName.set(k, { ...c }); return; }
    const join = (a, b) => [...new Set([...String(a || '').split(/,\s*/), ...String(b || '').split(/,\s*/)].filter(Boolean))].join(', ');
    was.campus = join(was.campus, c.campus);
    was.start = sortStarts(join(was.start, c.start));
    Object.keys(c).forEach((f) => { if (!was[f] && c[f]) was[f] = c[f]; });
  });
  const list = [...byName.values()].sort((x, y) => order(x.level) - order(y.level) || x.name.localeCompare(y.name));
  const lv = Object.values(levels).filter((x) => list.some((c) => c.level === x.level) || LEVELS.includes(x.level)).sort((x, y) => order(x.level) - order(y.level))
    .map((x) => ({ level: x.level, academic: x.academic || '', english: x.english || '', tuition: x.tuition || '', scholarship: x.scholarship || '', extra: x.extra || '' }));
  return { levels: lv, courses: list, deadlines: deadlines.slice(0, 12) };
};
const sortStarts = (s) => String(s || '').split(/,\s*/).filter(Boolean).sort((a, b) => FULL.indexOf(a.split(' ')[0]) - FULL.indexOf(b.split(' ')[0])).join(', ');

// ---- filling in from another partner (the owner, 20 Nov 2026) ----
// What a counsellor needs to decide must never be missing: where the partner a university is read from does not give an entry
// requirement, an English test, a fee or a scholarship, another partner that offers the same university fills the gap. The courses
// stay those of the first partner; only empty places are filled, nothing written is replaced.
const DEGREE = [[/bachelor of arts/g, 'ba'], [/bachelor of science/g, 'bsc'], [/bachelor of engineering/g, 'beng'], [/bachelor of laws/g, 'llb'], [/master of science/g, 'msc'], [/master of arts/g, 'ma'], [/master of business administration/g, 'mba'], [/master of laws/g, 'llm'], [/master of engineering/g, 'meng'], [/master of research/g, 'mres'], [/master of public health/g, 'mph']];
// "Bachelor of Arts (Honours) - Accounting and Finance (NN41)" and "BA (Hons) Accounting and Finance" are the same course.
function courseKey(name) {
  // Only brackets that carry no meaning go: "(Hons)", a partner's code such as "(NN41)" or "(CID921)". "(Extended)", "(Distance
  // Learning)", "(2 Term)" or "(Top-up)" make another course and stay.
  let t = String(name || '').replace(/\((?:hons|honours)\)/gi, ' ').replace(/\((?:[A-Z]{1,4}\d{2,4}|[A-Z0-9]{3,6})\)/g, ' ').toLowerCase().replace(/top\s*-?\s*up/g, ' top up ').replace(/[()]/g, ' ');
  DEGREE.forEach(([re, to]) => { t = t.replace(re, to); });
  return t.replace(/\bhonours\b|\bhons\b|&/g, ' ').replace(/\b(and|in|of)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}
const FIELDS_L = ['academic', 'english', 'tuition', 'scholarship', 'extra'];
// A deadline is the partner's own, so it is never taken from another partner.
const FIELDS_C = ['fee', 'duration', 'campus', 'scholarship', 'english', 'academic'];
function fillIn(base, extra) {
  if (!extra) return base;
  const levels = (base.levels || []).map((L) => ({ ...L }));
  const used = new Set(levels.map((L) => L.level));
  (extra.levels || []).forEach((E) => {
    const L = levels.find((x) => x.level === E.level);
    if (L) FIELDS_L.forEach((f) => { if (!String(L[f] || '').trim() && String(E[f] || '').trim()) L[f] = E[f]; });
    else if ((base.courses || []).some((c) => c.level === E.level) && !used.has(E.level)) levels.push({ ...E });
  });
  levels.sort((x, y) => order(x.level) - order(y.level));
  const index = new Map();
  (extra.courses || []).forEach((c) => { const k = courseKey(c.name); if (k && !index.has(k)) index.set(k, c); });
  const courses = (base.courses || []).map((c) => {
    const e = index.get(courseKey(c.name));
    if (!e) return c;
    const out = { ...c };
    FIELDS_C.forEach((f) => { if (!String(out[f] || '').trim() && String(e[f] || '').trim()) out[f] = e[f]; });
    return out;
  });
  const deadlines = (base.deadlines || []).length ? base.deadlines : (extra.deadlines || []);
  return { ...base, levels, courses, deadlines };
}

// ---- Route2Uni (Real Dreams): one university's page, as the portal gives it ----
const r2uLevel = (n) => ({ "Enhanced Extended Master's": 'Extended Masters', 'Doctor of Business Administration (DBA)': 'PhD', Nursing: 'Undergraduate' }[n] || (LEVELS.includes(n) ? n : levelOf(n)));
function fromRoute2Uni(u) {
  const per = {};
  const L = (n) => { const k = r2uLevel(n); per[k] = per[k] || { level: k }; return per[k]; };
  (u.entryRequirements || []).forEach((e) => { const x = L(e.courseLevelName); x.academic = tidy((e.criteria || []).join('\n')); if (e.gapYearsAllowed) x.extra = tidy(`Study gap: ${e.gapAccepted ? e.gapYearsAllowed : 'not accepted'}`); });
  (u.languageTests || []).forEach((t) => { const x = L(t.courseLevelName); x.english = tidy([x.english, `${t.languageTestName}: ${tidy(t.requiredScore)}`].filter(Boolean).join('\n')); });
  (u.englishProficiency || []).forEach((e) => { const x = L(e.courseLevelName); x.english = tidy([x.english, `Waiver: ${tidy((e.criteria || []).join('\n'))}`].filter(Boolean).join('\n')); });
  (u.feeStructures || []).forEach((f) => { const x = L(f.courseLevelName); x.tuition = tidy((f.tuitionRange || []).map((t) => `${tidy(t.description).replace(/:$/, '')} ${money(t.amount)}`).join('\n')); });
  (u.scholarships || []).forEach((s) => { const x = L(s.courseLevelName); x.scholarship = tidy((s.amounts || []).join(' ')); });
  const jan = (u.intakePeriods || []).find((i) => isJan(i.intakeName));
  const deadlines = jan && jan.deadlineInfo ? tidy(jan.deadlineInfo).split('\n').map((l) => l.replace(/^[•\-\s]+/, '').trim()).filter(Boolean) : [];
  const courses = (u.courses || []).filter((c) => isJan(c.intakeName)).map((c) => ({ name: tidy(c.name), level: r2uLevel(c.courseLevelName), start: tidy(c.intakeName), campus: tidy(c.cityName || c.campusLocation || '') }));
  return finish(per, courses, deadlines);
}

// ---- Adventus: the courses of the intake worked on at the university's campuses ----
const advEnglish = (reqs) => {
  const lang = (reqs || []).find((r) => r.type === 'language'); if (!lang) return '';
  return (lang.meta || []).map((m) => {
    const [k, v] = Object.entries(m)[0] || []; if (!v || !v.overall_score) return '';
    const name = { ielts_academic: 'IELTS', ielts_ukvi: 'IELTS UKVI', toefl: 'TOEFL', pte: 'PTE', duolingo: 'Duolingo' }[k] || String(k).toUpperCase();
    const c = v.language_score_conditions || v.score_conditions;
    // The lowest part: the condition when written, else the lowest of the four parts when each is given.
    const parts = ['reading', 'writing', 'speaking', 'listening'].map((x) => Number(v[x] && v[x].score)).filter((x) => x > 0);
    const low = c && c.score ? c.score : parts.length === 4 ? String(Math.min(...parts)) : '';
    return `${name}: ${v.overall_score.score} overall${low ? ` (no band below ${low})` : ''}`;
  }).filter(Boolean).join('\n');
};
const advAcademic = (reqs) => {
  const ed = (reqs || []).find((r) => r.type === 'education'); if (!ed) return '';
  return (ed.meta || []).map((m) => { const [k, v] = Object.entries(m)[0] || []; const g = v && v.grade_requirements && v.grade_requirements.grade; if (!g) return ''; return `${{ pg: "Bachelor's degree", ug: 'Grade 12', grade_12th: 'Grade 12', diploma: 'Diploma' }[k] || String(k).replace(/_/g, ' ')}: ${g}%`; }).filter(Boolean).join('\n');
};
function fromAdventus(list) {
  const rows = list.map((c) => ({ c, lvl: levelOf(c.course_name, c.studylevel_filter_group === 'Other' ? '' : c.studylevel_filter_group), ik: (c.intakes || []).find((i) => isJan(i.name)) || {}, iks: (c.intakes || []).filter((i) => isJan(i.name)) })).filter((x) => x.ik.name);
  const per = {};
  rows.forEach(({ c, lvl }) => { (per[lvl] = per[lvl] || { level: lvl, cs: [] }).cs.push(c); });
  Object.values(per).forEach((x) => {
    const cs = x.cs; delete x.cs;
    x.academic = mode(cs.map((c) => advAcademic(c.entry_requirement)));
    x.english = mode(cs.map((c) => advEnglish(c.entry_requirement)));
    x.tuition = range(cs.map((c) => c.cost_amount), cs[0].course_cost_currency || 'GBP');
    x.scholarship = mode(cs.map((c) => tidy(typeof c.scholarship === 'string' ? strip(c.scholarship) : '')));
    const dep = mode(cs.map((c) => (c.cas_amount_value ? money(c.cas_amount_value, c.cas_amount_currency || 'GBP') : '')));
    if (dep) x.extra = `Deposit for CAS: ${dep}`;
  });
  const close = mode(rows.map(({ ik }) => ik.application_close).filter(Boolean));
  const courses = rows.map(({ c, lvl, ik, iks }) => ({ name: tidy(c.course_name), level: lvl, start: sortStarts([...new Set(iks.map((i) => month(i.term_start) || tidy(String(i.name || '').replace(/ - .*$/, ''))))].join(', ')), deadline: day(ik.application_close), fee: c.cost_amount ? `${money(c.cost_amount, c.course_cost_currency)} a ${c.course_cost_unit || 'year'}` : '', duration: c.course_duration ? `${c.course_duration} ${c.course_duration_unit}` : '', campus: tidy((c.campuses || []).map((x) => x.name).join(', ')),
    scholarship: tidy(typeof c.scholarship === 'string' ? strip(c.scholarship) : ''), english: advEnglish(c.entry_requirement), academic: advAcademic(c.entry_requirement) }));
  return finish(per, courses, close ? [`Apply by ${day(close)} (most courses)`] : []);
}

// ---- signing in ----
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function route2uniSession(fetchImpl, user, pass) {
  const r = await fetchImpl('https://portal.route2unigroup.com/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, body: JSON.stringify({ email: user, password: pass }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('Route2Uni did not accept the login saved on the Real Dreams card.');
  const auth = `${j.type || 'Bearer'} ${j.token}`;
  return async (id) => {
    const res = await fetchImpl(`https://portal.route2unigroup.com/api/universities/${id}?activeIntake=true`, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Route2Uni answered ${res.status}`);
    return (await res.json()).data;
  };
}
// Adventus signs in with its own form; the session is kept in a small cookie jar (only the app.adventus.io cookies: the same login
// also clears older adventus.io ones, which must not clear the new session).
async function adventusSession(fetchImpl, user, pass) {
  const jar = {};
  const take = (res) => {
    // Node 19.7 and later list each cookie; older ones join them with commas (split where a new "name=" starts).
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : String(res.headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_.-]+=)/).filter(Boolean);
    list.forEach((c) => {
      const kv = c.split(';')[0]; const i = kv.indexOf('='); const k = kv.slice(0, i).trim();
      const dom = (/;\s*domain=([^;]+)/i.exec(c) || [])[1];
      if (dom && dom.trim().replace(/^\./, '') !== 'app.adventus.io') return;
      if (/max-age=0(;|$)/i.test(c) || /=deleted/i.test(kv)) delete jar[k]; else jar[k] = kv.slice(i + 1);
    });
  };
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  let r = await fetchImpl('https://app.adventus.io/admin/login', { headers: { 'User-Agent': UA } });
  take(r);
  const token = ((await r.text()).match(/name="_token"\s+value="([^"]+)"/) || [])[1];
  if (!token) throw new Error('Adventus sign-in page has changed.');
  r = await fetchImpl('https://app.adventus.io/admin/login', { method: 'POST', redirect: 'manual', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie(), Referer: 'https://app.adventus.io/admin/login', Origin: 'https://app.adventus.io' }, body: new URLSearchParams({ _token: token, email: user, password: pass }).toString() });
  take(r);
  if (!jar.laravel_session) throw new Error('Adventus did not accept the login saved on the Adventus card.');
  return async (institutions) => {
    const settings = { selected_nationality: 'Nepal', countryOfResidence: null, languageRequirements: null, levels: null, grading_system: null, grading_country_id: null, grading_system_id: null, institutions, cities: [], region: null, campuses: [], disciplines: [], durations: [], delivery: [], prerequisites: null, grade_match: null, education_levels: [], nationality: [], value: null, countries: [{ name: 'United Kingdom (Inc Channel Islands and Isle of Man)', id: 'countries-247', cca3: 'GBR' }], intakes: adventusIntakes() };
    const all = [];
    for (let page = 1; page <= 40; page += 1) {
      const res = await fetchImpl(`https://app.adventus.io/search/course/results?page=${page}`, { method: 'POST', headers: { 'User-Agent': UA, Cookie: cookie(), 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': decodeURIComponent(jar['XSRF-TOKEN'] || ''), Referer: 'https://app.adventus.io/course-search' }, body: JSON.stringify({ searchOptions: { pagination: 20, view: 'course', order: 'relevance', keywords: '', seedId: '', previousPage: '', region: null, nationality: 'Nepal', residence: null }, settings, gradeMatchValues: { grading_system_id: null, grading_score: null }, gradeMatchData: [] }) });
      take(res);
      if (!res.ok) throw new Error(`Adventus answered ${res.status}`);
      const R = ((await res.json()).data || {}).results;
      if (!R || !Array.isArray(R.data)) break;
      all.push(...R.data.map((d) => d._source));
      if (page >= (R.last_page || 1)) break;
    }
    return all;
  };
}

// Thursday from 2 a.m. office time, once that day; at most 8 days without a good reading; a failed try is not repeated within 3 hours.
function thursdayDue(runs, date = new Date()) {
  const lastGood = ((runs || []).find((r) => r.ok) || {}).at;
  const lastTry = ((runs || [])[0] || {}).at;
  if (lastTry && date.getTime() - Date.parse(lastTry) < 3 * 3600000) return false;
  if (!lastGood) return true;
  if (date.getTime() - Date.parse(lastGood) > 8 * 86400000) return true;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return p.weekday === 'Thu' && Number(p.hour) >= 2 && localDate(new Date(lastGood)) !== localDate(date);
}

function createPartnerRefresh({ dir, facts, b2b, record = () => {}, fetchImpl = (...a) => fetch(...a), enabled = true, now = () => new Date() }) {
  const file = path.join(dir, 'partner-refresh.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { runs: [] }; } };
  const write = (d) => writeFileAtomic(file, JSON.stringify(d, null, 1));
  // A card is found by any spelling of the partner (Real Dreams is Real Dreams Educational Consultancy, partner-names.js).
  const login = (name) => { const c = b2b.all().find((p) => samePartner(p.name, name)); return c && c.applyUser && c.applyPassword ? { user: c.applyUser, pass: c.applyPassword } : null; };
  let running = null;
  async function run(by = 'schedule') {
    if (running) return running;
    running = (async () => {
      const started = now().toISOString();
      const pages = facts.refreshable();
      const out = { read: 0, kept: 0, filled: 0, failed: [], skipped: [] };
      // One session per partner, opened the first time it is needed; a partner without a login or that refuses it is not asked again.
      const sessions = {};
      const OPEN = {
        'Real Dreams': (l) => route2uniSession(fetchImpl, l.user, l.pass),
        Adventus: (l) => adventusSession(fetchImpl, l.user, l.pass),
      };
      const READ = {
        'Real Dreams': async (sess, src) => (src.r2u ? fromRoute2Uni(await sess(src.r2u)) : null),
        Adventus: async (sess, src) => ((src.adv || []).length ? fromAdventus(await sess(src.adv)) : null),
      };
      const notes = new Set();
      async function readFrom(src) {
        if (!src || !READ[src.partner]) return null; // Apply Board cannot be read (its sign-in asks a person to prove they are not a robot)
        if (!(src.partner in sessions)) {
          const l = login(src.partner);
          if (!l) { sessions[src.partner] = null; notes.add(`${src.partner}: no login saved on its B2B card`); }
          else { try { sessions[src.partner] = await OPEN[src.partner](l); } catch (e) { sessions[src.partner] = null; out.failed.push(e.message); } }
        }
        if (!sessions[src.partner]) return null;
        return READ[src.partner](sessions[src.partner], src);
      }
      const filled = (x) => x.levels.reduce((n, L) => n + ['academic', 'english', 'tuition', 'scholarship'].filter((f) => String(L[f] || '').trim()).length, 0)
        + x.courses.reduce((n, c) => n + ['fee', 'duration', 'scholarship', 'english', 'academic'].filter((f) => String(c[f] || '').trim()).length, 0);
      for (const p of pages) {
        try {
          // The partner the page is read from first; when it has nothing (or cannot be read), the page keeps what it has.
          let fresh = null;
          try { fresh = await readFrom(p.source); } catch (e) { out.failed.push(`${p.name} (${p.source.partner}): ${e.message}`); }
          const usedPrimary = Boolean(fresh && fresh.courses.length);
          let page = usedPrimary ? fresh : { levels: p.levels || [], courses: p.courseList || [], deadlines: p.deadlines || [] };
          const before = filled(page);
          // Then every other partner that offers the same university fills what is still empty (and gives the courses when the page
          // has none at all).
          for (const src of p.others || []) {
            let extra = null;
            try { extra = await readFrom(src); } catch (e) { out.failed.push(`${p.name} (${src.partner}): ${e.message}`); }
            if (!extra) continue;
            page = page.courses.length ? fillIn(page, extra) : fillIn(extra, page);
          }
          const gained = filled(page) - before;
          if (!usedPrimary && gained <= 0) { if (p.courses) out.kept += 1; continue; }
          facts.refreshProfile(p.id, page);
          if (usedPrimary) out.read += 1;
          if (gained > 0 && (p.others || []).length) out.filled += 1;
        } catch (e) { out.failed.push(`${p.name}: ${e.message}`); }
      }
      out.skipped.push(...notes);
      const ab = pages.filter((p) => p.source.partner === 'Apply Board').length;
      if (ab) out.skipped.push(`Apply Board: ${ab} universities keep the courses read on 20 Nov 2026 (its sign-in asks a person to prove they are not a robot); their missing details come from the other partners`);
      const r2uPages = pages.filter((p) => p.source.partner === 'Real Dreams');
      const advPages = pages.filter((p) => p.source.partner === 'Adventus');
      const ok = out.read > 0 || out.filled > 0 || (!out.failed.length && !r2uPages.length && !advPages.length);
      const d = read();
      write({ runs: [{ at: now().toISOString(), started, by, ok, read: out.read, kept: out.kept, failed: out.failed.slice(0, 20) }, ...(d.runs || [])].slice(0, 20) });
      record([`Read again from the partners: ${out.read} universities updated${out.filled ? `, ${out.filled} with missing details filled in from another partner` : ''}${out.kept ? `, ${out.kept} kept as they were (nothing new listed now)` : ''}`, ...out.failed.slice(0, 10).map((x) => `Could not read: ${x}`), ...out.skipped]);
      console.log(`[partner refresh] ${out.read} updated, ${out.kept} kept, ${out.failed.length} failed`);
      return out;
    })().finally(() => { running = null; });
    return running;
  }
  const due = (date = now()) => enabled && !running && thursdayDue(read().runs, date);
  const tick = () => { if (due()) run('schedule').catch(() => {}); };
  return { run, due, tick, enabled: () => enabled, lastRun: () => (read().runs || [])[0] || null };
}

module.exports = { adventusIntakes, createPartnerRefresh, fromRoute2Uni, fromAdventus, thursdayDue, levelOf, fillIn, courseKey };
