// The page of every course, from the university's own website only (the owner, 17 Nov 2026: "we only look at the original university
// website"). Almost every university publishes a sitemap: its own list of every page, course pages included. For each university of
// Universities with a known website (university-websites.js), this reads that sitemap (from robots.txt, or /sitemap.xml, following a
// sitemap of sitemaps), keeps the course pages, and matches each course of Universities to the page whose address has the same
// words and the same degree (MSc, BA (Hons) ...). A course with no clear match is left without a link (the page's "Find the course
// page" button still looks it up one at a time). Links a person typed or found are never replaced.
//
// Every 4 days it takes the next universities in turn until at least 100
// courses have been checked, and goes on from there next time, so every course is reached in a few weeks and then checked again. A
// course checked and not found on the university's website is listed (missingFor), and Universities shows a warning beside it so a
// person adds the link by hand. The result of each university is kept in course-sitemaps.json in the data folder.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../shared/server-utils');
const { parseCourses } = require('./course-index');
const { hostsOf } = require('./university-websites');

const UA = 'Mozilla/5.0 (compatible; ISR-course-links/1.0; reads the public sitemap only)';
const COURSE_PATH = /\/(courses?|study|undergraduate|postgraduate|programmes?|subjects?|degrees?|ug|pg)\b/i;
const NOT_COURSE = /\/(news|events?|blog|staff|people|research-?projects?|stories|profiles?|jobs?|vacanc|search|tag|category|alumni|policies|about)\b/i;
const STOP = new Set(['the', 'of', 'and', 'in', 'for', 'with', 'a', 'an', 'to', 'at', 'on', 'hons', 'honours', 'year', 'years', 'full', 'time', 'part', 'campus', 'course', 'courses', 'degree',
  'london', 'manchester', 'birmingham', 'leeds', 'york', 'online', 'top', 'up', 'level', 'direct', 'entry', 'intake', 'september', 'january', 'may', 'study', 'undergraduate', 'postgraduate']);
const DEGREES = ['msc', 'ma', 'mba', 'llm', 'mres', 'meng', 'mph', 'mfa', 'march', 'pgcert', 'pgdip', 'phd', 'bsc', 'ba', 'beng', 'llb', 'bba', 'bn', 'fdsc', 'fda', 'hnd', 'mdes', 'msci', 'mpharm', 'mnurs'];
const tokens = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
// "BSc (Hons) Computer Science (London)" -> { degree: 'bsc', words: ['computer', 'science'] }.
function courseKey(name) {
  const clean = String(name || '').replace(/\((?:[^)]*\b(?:london|campus|manchester|birmingham|york|online|years?|months?|intake)[^)]*)\)/gi, ' ');
  const t = tokens(clean);
  const degree = t.find((w) => DEGREES.includes(w)) || '';
  return { degree, words: [...new Set(t.filter((w) => !DEGREES.includes(w) && !STOP.has(w) && w.length > 1))] };
}
function urlKey(url) {
  let p = '';
  try { p = decodeURIComponent(new URL(url).pathname.toLowerCase()); } catch (e) { return null; }
  const parts = p.split('/').filter(Boolean);
  const last = parts.slice(-2).join(' ');
  return { all: new Set(tokens(p)), last: new Set(tokens(last)), depth: parts.length, pg: /postgrad|\/pg\b|masters?/.test(p), ug: /undergrad|\/ug\b/.test(p) };
}
// The best page for a course among the course pages of its university, or ''.
function matchCourse(name, pages) {
  const k = courseKey(name);
  if (!k.words.length) return '';
  let best = ''; let bestScore = 0;
  const pgCourse = /^(msc|ma|mba|llm|mres|meng|mph|mfa|pgcert|pgdip|phd|mdes)$/.test(k.degree);
  pages.forEach((p) => {
    const u = p.key;
    if (!k.words.every((w) => u.all.has(w) || u.all.has(w.replace(/s$/, '')))) return; // every word of the course is in the address
    const extra = [...u.last].filter((w) => !k.words.includes(w) && !DEGREES.includes(w) && !STOP.has(w) && !/^\d+$/.test(w)).length;
    if (extra > 2) return; // a page about something longer ("computer science with artificial intelligence") is not this course
    let score = 100 - extra * 15;
    const degreeOnPage = DEGREES.find((d) => u.all.has(d));
    if (k.degree && degreeOnPage) { if (degreeOnPage !== k.degree && !(k.degree === 'ba' && degreeOnPage === 'bsc') && !(k.degree === 'bsc' && degreeOnPage === 'ba')) return; score += 20; }
    if (pgCourse && u.ug) return;
    if (!pgCourse && k.degree && u.pg) return;
    if ((pgCourse && u.pg) || (!pgCourse && u.ug)) score += 10;
    score -= Math.max(0, u.depth - 4) * 2;
    if (score > bestScore) { bestScore = score; best = p.url; }
  });
  return bestScore >= 70 ? best : '';
}

function createCourseSitemaps({ dir, facts, courseLinks, fetchImpl = (...a) => fetch(...a), pause = 400, now = () => new Date() }) {
  const file = path.join(dir, 'course-sitemaps.json');
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return { ...d, runs: Array.isArray(d && d.runs) ? d.runs : [], universities: d && d.universities && typeof d.universities === 'object' ? d.universities : {} }; } catch (e) { return { runs: [], universities: {} }; } };
  let running = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(url) {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const e = new Error(`${r.status}`); e.status = r.status; throw e; }
    return r.text();
  }
  // Every page address of a website's sitemaps (a sitemap of sitemaps followed, at most 40 files, only on the same website).
  async function pagesOf(host) {
    const seeds = [];
    try { (await get(`https://www.${host}/robots.txt`)).split('\n').forEach((l) => { const m = /^\s*sitemap:\s*(\S+)/i.exec(l); if (m) seeds.push(m[1]); }); } catch (e) { /* no robots.txt */ }
    seeds.push(`https://www.${host}/sitemap.xml`, `https://${host}/sitemap.xml`);
    const onSite = (u) => { try { const h = new URL(u).hostname.toLowerCase(); return h === host || h.endsWith('.' + host); } catch (e) { return false; } };
    const queue = [...new Set(seeds.filter(onSite))];
    const seen = new Set(); const pages = new Set(); let lastError = '';
    while (queue.length && seen.size < 40) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      let xml = '';
      try { xml = await get(u); } catch (e) { lastError = e.status ? `the website answered ${e.status}` : 'the website could not be reached'; continue; }
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
      const isIndex = /<sitemapindex/i.test(xml);
      locs.forEach((l) => {
        if (!onSite(l)) return;
        if (isIndex || /\.xml(\?|$)/i.test(l)) { if (!seen.has(l) && (!/news|event|blog|image|video|people|staff/i.test(l) || /course|study|program/i.test(l))) queue.push(l); } else pages.add(l);
      });
      await wait(pause);
    }
    return { pages: [...pages], error: pages.size ? '' : lastError || 'no sitemap found' };
  }

  async function run({ atLeast = 100 } = {}) {
    if (running) return running;
    running = (async () => {
      const state = read();
      const all = facts.all().filter((u) => hostsOf(u).length && (u.courses || (u.intakes || []).some((i) => i.courses)));
      if (!all.length) return { linked: 0, checked: 0 };
      let at = Number(state.cursor) || 0;
      let linked = 0; let checked = 0; let done = 0;
      while (checked < atLeast && done < all.length) {
        const u = all[at % all.length];
        at += 1; done += 1;
        const hosts = hostsOf(u);
        const courses = [...new Set([...parseCourses(u.courses), ...(u.intakes || []).flatMap((i) => parseCourses(i.courses))].map((c) => c.course))];
        let site = { pages: [], error: '' };
        for (const h of hosts) { site = await pagesOf(h); if (site.pages.length) break; }
        const pages = site.pages.filter((p) => COURSE_PATH.test(p) && !NOT_COURSE.test(p)).map((url) => ({ url, key: urlKey(url) })).filter((p) => p.key);
        const known = courseLinks.all(facts.all());
        const add = []; const missing = []; let found = 0;
        courses.forEach((c) => {
          const bare = c.replace(/\s*\([^)]*\)\s*$/, '').trim(); // "MBA (London)" is also looked up as "MBA"
          if (known[`${u.id}|${c.toLowerCase()}`] || known[`${u.id}|${bare.toLowerCase()}`]) return;
          const link = pages.length ? matchCourse(c, pages) : '';
          if (!link) { missing.push(c); return; }
          found += 1;
          [c, bare].forEach((name) => add.push([u.id, name, link]));
        });
        courseLinks.rememberMany(add);
        linked += found;
        checked += courses.length;
        state.universities[u.id] = { name: u.name, at: now().toISOString(), pages: pages.length, courses: courses.length, linked: found, missing: missing.slice(0, 1500), error: site.error };
      }
      state.cursor = at % all.length;
      state.runs = [{ at: now().toISOString(), linked, checked }, ...(state.runs || [])].slice(0, 10);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(file, JSON.stringify(state, null, 1));
      return { linked, checked };
    })().finally(() => { running = null; });
    return running;
  }
  // The courses of a university checked and not found on its website (for the warning beside each), and why when none was read.
  const missingFor = (universityId) => { const u = read().universities[universityId]; return u ? { courses: new Set((u.missing || []).map((c) => c.toLowerCase())), error: u.error || '', at: u.at } : null; };
  const lastRun = () => (read().runs || [])[0] || null;
  const due = () => { const l = lastRun(); return !running && (!l || Date.now() - Date.parse(l.at) > 4 * 86400000); };
  return { run, due, lastRun, missingFor, status: () => read(), isRunning: () => Boolean(running) };
}

module.exports = { createCourseSitemaps, matchCourse, courseKey, urlKey };
