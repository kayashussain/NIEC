// A university's logo by its name, taken from its page in Universities (the owner, 26 Nov 2026: "we have all the logos"). Used by
// Partner Universities and Interview guidelines. A pathway college with no logo of its own shows its university's. A name that
// matches nothing gets no logo (the page then shows its initials), so a logo is never guessed from one shared word.
const key = (n) => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const core = (n) => key(n).replace(/\b(university|of|the|and|at|for)\b/g, ' ').replace(/\s+/g, ' ').trim();
// The only extra words a college or a campus may add to its university's name.
const EXTRA = new Set(['isc', 'college', 'international', 'pathway', 'london', 'campus', 'progression', 'degree']);

// `list`: [{ name, logo }] as facts.list() gives it.
function logoFinder(list) {
  const withLogo = (list || []).filter((u) => u && u.logo);
  const byKey = new Map(withLogo.map((u) => [key(u.name), u.logo]));
  const cores = withLogo.map((u) => [core(u.name), u.logo]).filter(([c]) => c).sort((a, b) => b[0].length - a[0].length);
  return (name) => {
    if (byKey.has(key(name))) return byKey.get(key(name));
    const mine = core(name);
    if (!mine) return '';
    const found = cores.find(([c]) => {
      const padded = ` ${mine} `;
      return padded.includes(` ${c} `) && padded.replace(` ${c} `, ' ').trim().split(' ').filter(Boolean).every((w) => EXTRA.has(w));
    });
    return found ? found[1] : '';
  };
}

module.exports = { logoFinder };
