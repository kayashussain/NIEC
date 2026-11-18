// Who can go where (the owner, 17 Nov 2026: finding a student's universities must not mean opening every Fact File page). Each
// university's rules, as written on the partner portal ("12th: GPA 2.8 or 60% or above", "Study gap: up to 10 years", "IELTS 6.0
// overall"), are read once into numbers (rulesFrom), and a student (level, GPA or percentage, study gap, English test and score) is
// checked against every university (check): Eligible, Check (close, or a rule that needs a person: a waiver, a gap not stated) or
// Not eligible, each with the reasons in plain words, so the team sees what the student would need (a higher IELTS, a shorter gap).
//
// The rules are read generously: where a university gives several routes (12th grade, foundation, diploma), the lowest bar counts,
// and a line about one subject (12th Maths or English) is not taken as the overall grade. A result is a guide for the team, not the
// university's decision: the Fact File page has the full wording.

const { levelOf } = require('./course-index');

const num = (s) => { if (String(s === null || s === undefined ? '' : s).trim() === '') return null; const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
// Our study levels from the portal's names ("International Year One", "Upper Tier UG Course (YORK Campus)", "Top-up").
function ourLevel(name) {
  const t = String(name || '').toLowerCase();
  if (/top[- ]?up|level 6/.test(t)) return 'Top-up (final year)';
  if (/nursing|midwif/.test(t)) return 'Undergraduate';
  if (/pre[- ]?master/.test(t)) return 'Pre-Masters';
  if (/year one|year 1|iy1|\biyo\b/.test(t)) return 'International Year 1';
  if (/foundation/.test(t)) return 'Foundation';
  if (/research|phd|doctor/.test(t)) return 'Masters by Research or PhD';
  if (/postgrad|\bpg\b|master|mba/.test(t)) return 'Postgraduate';
  if (/undergrad|\bug\b|bachelor/.test(t)) return 'Undergraduate';
  return levelOf(t) || '';
}
// The lowest overall grade asked for, as a GPA (out of 4) and as a percentage, from the lines of one level.
function gradeFrom(lines) {
  let gpa = null; let pct = null;
  (lines || []).forEach((raw) => {
    // A rule about one subject ("12th Math: 50%", "English 60%") is not the overall grade: only what comes before it counts.
    const cut = /\b(\d{2}(th)?\s+)?(math|maths|mathematics|english)\b/i.exec(String(raw));
    const line = cut ? String(raw).slice(0, cut.index) : String(raw);
    if (!line.trim()) return;
    for (const m of line.matchAll(/(\d(?:\.\d{1,2})?)\s*(?:c?gpa|out of 4)?/gi)) {
      const v = num(m[1]);
      if (v !== null && v >= 1.6 && v <= 4 && /\./.test(m[1]) && !/ielts|pte|toefl|duolingo|band/i.test(line)) gpa = gpa === null ? v : Math.min(gpa, v);
    }
    for (const m of line.matchAll(/(\d{2}(?:\.\d)?)\s*%/g)) { const v = num(m[1]); if (v !== null && v >= 35 && v <= 95) pct = pct === null ? v : Math.min(pct, v); }
    if (/first division/i.test(line)) pct = pct === null ? 60 : Math.min(pct, 60);
    if (/second division/i.test(line)) pct = pct === null ? 45 : Math.min(pct, 45);
  });
  return { gpa, pct };
}
// "10 Years", "3", "Up to 5 years": the study gap allowed in years; null when it is not said.
function gapFrom(accepted, text) {
  const m = /(\d{1,2})/.exec(String(text || ''));
  if (m) return num(m[1]);
  return accepted === false ? 0 : null;
}
const TESTS = { IELTS: /ielts/i, PTE: /\bpte\b/i, DUOLINGO: /duolingo|\bdet\b/i, TOEFL: /toefl/i, OET: /\boet\b/i, LANGUAGECERT: /languagecert|language cert/i, OXFORD: /oxford/i, SELT: /\bselt\b/i };
const testOf = (name) => Object.keys(TESTS).find((k) => TESTS[k].test(String(name || ''))) || '';
// The overall score asked for: the first number of the line ("6.0 overall (5.5 in each)" is 6.0).
// The lowest band (every part, component or element) a test asks for: "6.0 overall (5.5 in each component)" is 5.5, "no band less
// than 6.0" is 6.0, "59 overall (59 in each)" is 59; null when it is not said.
function bandOf(score) {
  const t = String(score || '');
  const m = /(\d{1,3}(?:\.\d)?)\s*(?:in|for)?\s*(?:each|every|all)\b|(?:no|without)\s+(?:band|element|component|skill|section|part|sub-?score)s?\s+(?:score\s+)?(?:less|lower|below)\s+than\s+(\d{1,3}(?:\.\d)?)|(?:minimum|min\.?|at least)\s+(\d{1,3}(?:\.\d)?)\s+(?:in|for)\s+(?:each|every|all)|(?:each|every|all)\s+(?:band|element|component|skill|section|part)s?\s*(?:of|at|:|-)?\s*(?:at least|minimum|min\.?)?\s*(\d{1,3}(?:\.\d)?)/i.exec(t);
  let v = m ? num(m[1] || m[2] || m[3] || m[4]) : null;
  // The parts named one by one ("Reading: 100, Speaking, Writing, Listening: 95"): the lowest of them.
  if (v === null && /reading|writing|speaking|listening/i.test(t)) {
    const parts = [...t.replace(/^[^(]*?\d{1,3}(?:\.\d)?/, '').matchAll(/(?:reading|writing|speaking|listening|literacy|comprehension|conversation|production)[^\d]{0,40}?(\d{1,3}(?:\.\d)?)/gi)].map((x) => num(x[1])).filter((x) => x !== null);
    if (parts.length) v = Math.min(...parts);
  }
  return v !== null && v >= 4 ? v : null;
}
// A CEFR level ("B2") is not a score; a number under 4 is not an overall score of any test.
const overallOf = (score) => { const t = String(score || ''); if (/^\s*[A-C][12]\b/i.test(t)) return null; const m = /(\d{1,3}(?:\.\d)?)/.exec(t); const v = m ? num(m[1]) : null; return v !== null && v >= 4 ? v : null; };

// The rules of one university, by level, from its requirements, English and tests (the Navitas toolkit, a page typed by hand).
function rulesFrom(r) {
  const levels = new Map();
  const at = (name) => {
    const key = ourLevel(name) || name;
    if (!levels.has(key)) levels.set(key, { level: key, names: new Set(), minGpa: null, minPercent: null, gap: null, gapText: '', tests: {}, bands: {}, waiver: false, waiverRules: [] });
    const L = levels.get(key); L.names.add(name); return L;
  };
  (r.requirements || []).forEach((q) => {
    const L = at(q.level);
    const g = gradeFrom(q.criteria);
    if (g.gpa !== null) L.minGpa = L.minGpa === null ? g.gpa : Math.min(L.minGpa, g.gpa);
    if (g.pct !== null) L.minPercent = L.minPercent === null ? g.pct : Math.min(L.minPercent, g.pct);
    const gap = gapFrom(q.gap !== 'Not accepted', q.gap === 'Not accepted' ? '' : q.gap);
    if (gap !== null) L.gap = L.gap === null ? gap : Math.max(L.gap, gap);
    L.gapText = q.gap;
  });
  (r.tests || []).forEach((t) => {
    const k = testOf(t.test); const v = overallOf(t.score); if (!k || v === null) return;
    const L = at(t.level);
    if (L.tests[k] === undefined || v < L.tests[k]) { L.tests[k] = v; const b = bandOf(t.score); if (b !== null && b <= v) L.bands[k] = b; else delete L.bands[k]; }
  });
  (r.english || []).forEach((e) => { const L = at(e.level); if (e.waiver) { L.waiver = true; L.waiverRules.push(...e.criteria); } });
  return [...levels.values()].map((L) => ({ ...L, names: [...L.names] }));
}

// The rules of a university typed by hand (no partner portal): from its table of entry requirements, English, fees (one row per
// course level), so the finder misses no university of the Fact File.
function rulesFromPage(u) {
  const lines = (t) => String(t || '').split('\n').map((x) => x.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
  return rulesFrom({
    requirements: (u.programs || []).map((p) => {
      const all = lines(p.academic);
      const gapLine = all.find((x) => /gap/i.test(x)) || '';
      const years = /(\d{1,2})\s*(?:years?|yrs?)/i.exec(gapLine);
      return { level: p.name, criteria: all.filter((x) => !/gap/i.test(x)), gap: years ? years[1] : (/not accepted|no gap/i.test(gapLine) ? 'Not accepted' : '') };
    }),
    tests: (u.programs || []).flatMap((p) => lines(p.english).map((x) => ({ level: p.name, test: testOf(x), score: x.replace(/^[^\d]*?(?=\d)/, '') })).filter((t) => t.test)),
    english: (u.programs || []).map((p) => ({ level: p.name, waiver: /waiver|\bmoi\b|medium of instruction/i.test(p.english || ''), criteria: lines(p.english).filter((x) => /waiver|\bmoi\b|medium/i.test(x)) })),
  });
}

// The student, from what was typed or from the student card: a grade as a GPA ("3.2") or a percentage ("72%", or a number above 4.5).
function studentFrom(input = {}) {
  const raw = String(input.grade || '').trim();
  const n = num((/(\d{1,3}(?:[.,]\d{1,2})?)/.exec(raw) || [])[1]);
  const isPct = /%/.test(raw) || (n !== null && n > 4.5);
  const testName = String(input.test || '');
  return {
    level: String(input.level || ''),
    gpa: n !== null && !isPct ? n : null,
    pct: n !== null && isPct ? n : null,
    gap: num(input.gap) === null ? null : num(input.gap),
    test: /moi|waiver/i.test(testName) ? 'WAIVER' : /not taken/i.test(testName) ? 'NONE' : testOf(testName),
    testLabel: testName,
    score: overallOf(input.score),
    band: overallOf(input.band),
    scoreText: String(input.score || '').trim(),
    subject: String(input.subject || '').trim(),
  };
}

// One university for one student: { status: 'yes' | 'check' | 'no', reasons: [{ ok: true|false|null, text }] } for the level, or
// null when the university has no rules for that level.
function checkLevel(rules, s) {
  const L = rules.find((x) => x.level === s.level);
  if (!L) return null;
  const reasons = [];
  const say = (ok, text) => reasons.push({ ok, text });
  // The grade: a GPA against a GPA, a percentage against a percentage; one against the other only as a rough guide.
  if (L.minGpa !== null || L.minPercent !== null) {
    if (s.gpa !== null && L.minGpa !== null) say(s.gpa >= L.minGpa, s.gpa >= L.minGpa ? `GPA ${s.gpa} meets ${L.minGpa}` : `Needs GPA ${L.minGpa} (has ${s.gpa})`);
    else if (s.pct !== null && L.minPercent !== null) say(s.pct >= L.minPercent, s.pct >= L.minPercent ? `${s.pct}% meets ${L.minPercent}%` : `Needs ${L.minPercent}% (has ${s.pct}%)`);
    else if (s.gpa !== null && L.minPercent !== null) {
      // Nepal's grading (NEB): B is 2.8 (60 to 70%), C+ 2.4 (50 to 60%), C 2.0 (40 to 50%): about 40% + 25 points a GPA point over 2.0.
      const about = Math.round(40 + (s.gpa - 2) * 25);
      say(about >= L.minPercent ? true : about >= L.minPercent - 4 ? null : false, about >= L.minPercent ? `GPA ${s.gpa} (about ${about}%) meets ${L.minPercent}%` : about >= L.minPercent - 4 ? `GPA ${s.gpa} is about ${about}%; asks for ${L.minPercent}%: check` : `Needs about ${L.minPercent}% (GPA ${s.gpa} is about ${about}%)`);
    } else if (s.pct !== null && L.minGpa !== null) {
      const about = Math.round((2 + (s.pct - 40) / 25) * 100) / 100;
      say(about >= L.minGpa ? true : about >= L.minGpa - 0.15 ? null : false, about >= L.minGpa ? `${s.pct}% (about GPA ${about}) meets GPA ${L.minGpa}` : about >= L.minGpa - 0.15 ? `${s.pct}% is about GPA ${about}; asks for ${L.minGpa}: check` : `Needs about GPA ${L.minGpa} (${s.pct}% is about ${about})`);
    } else say(null, `Asks for ${[L.minGpa !== null && `GPA ${L.minGpa}`, L.minPercent !== null && `${L.minPercent}%`].filter(Boolean).join(' or ')}`);
  }
  // The study gap.
  if (s.gap !== null) {
    if (L.gap === null) say(s.gap ? null : true, s.gap ? `A ${s.gap}-year gap: the gap rule is not stated, check` : 'No study gap');
    else if (L.gap === 0) say(s.gap === 0 ? true : null, s.gap === 0 ? 'No study gap' : `Study gap not accepted as written: check (${s.gap} years)`);
    else if (s.gap === 0) say(true, 'No study gap');
    else say(s.gap <= L.gap, s.gap <= L.gap ? `Gap of ${s.gap} year${s.gap === 1 ? '' : 's'} is within ${L.gap}` : `Gap of ${s.gap} years is over the ${L.gap} allowed`);
  }
  // English.
  if (s.test === 'WAIVER') say(L.waiver ? null : false, L.waiver ? `English waiver possible: ${L.waiverRules.slice(0, 2).join('; ') || 'check the rules'}` : 'No English waiver: a test is needed');
  else if (s.test && s.test !== 'NONE') {
    const need = L.tests[s.test];
    if (need === undefined) say(null, `${s.testLabel || s.test} is not listed: check`);
    else if (s.score === null) say(null, `${s.testLabel || s.test}: needs ${s.test === 'IELTS' && Number.isInteger(need) ? need.toFixed(1) : need} overall`);
    else {
      // "6.0" stays "6.0" (an IELTS band is written with its decimal).
      const shown = (v) => (s.test === 'IELTS' && Number.isInteger(v) ? v.toFixed(1) : String(v));
      say(s.score >= need, s.score >= need ? `${s.testLabel || s.test} ${shown(s.score)} overall meets ${shown(need)}` : `Needs ${s.testLabel || s.test} ${shown(need)} overall (has ${shown(s.score)})`);
      // The lowest band (the owner, 17 Nov 2026: "60 overall with a 57 is not eligible where 59 in each is asked").
      const min = (L.bands || {})[s.test];
      if (min !== undefined) {
        if (s.band === null) say(null, `Also needs ${shown(min)} in each part: enter the lowest band`);
        else say(s.band >= min, s.band >= min ? `Lowest band ${shown(s.band)} meets ${shown(min)} in each part` : `Needs ${shown(min)} in each part (lowest band is ${shown(s.band)})`);
      }
    }
  } else if (s.test === 'NONE') {
    const needs = Object.entries(L.tests).map(([k, v]) => `${k} ${v}`).slice(0, 3).join(', ');
    say(null, `No test yet${needs ? `: needs ${needs}` : ''}${L.waiver ? ', or a waiver' : ''}`);
  }
  const status = reasons.some((r) => r.ok === false) ? 'no' : reasons.some((r) => r.ok === null) ? 'check' : 'yes';
  return { status, reasons };
}

module.exports = { rulesFrom, rulesFromPage, studentFrom, checkLevel, ourLevel, gradeFrom, overallOf, bandOf, testOf };
