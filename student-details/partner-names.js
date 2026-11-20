// The full names of the B2B partners (the owner, 20 Nov 2026): "Real Dreams" is Real Dreams Educational Consultancy, and
// "Nisus Educational Consultancy" is Nissus International Education Foundation. The short and old spellings stay known as other
// names of the same partner, so a value saved before (on the sheet, a shortlist, a backup or the Apply through list) still means it.
// Only this consultancy's partners are named here; another installation never has these spellings, so nothing changes for it.

const RENAMES = [
  ['Real Dreams Educational Consultancy', ['Real Dreams', 'Real Dreams Education Consultancy', 'Real Dreams Edu', 'RealDreams']],
  ['Nissus International Education Foundation', ['Nisus Educational Consultancy', 'Nisus Education Consultancy', 'Nissus Educational Consultancy', 'Nissus Education Consultancy', 'Nisus International Education Foundation', 'Nisus', 'Nissus']],
];
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const BY_KEY = new Map();
RENAMES.forEach(([name, old]) => [name, ...old].forEach((n) => BY_KEY.set(squash(n), name)));

// The full name of a partner given any of its spellings; any other name is given back as it is.
const partnerName = (name) => BY_KEY.get(squash(name)) || name;
const samePartner = (a, b) => squash(partnerName(a)) === squash(partnerName(b));

module.exports = { RENAMES, partnerName, samePartner, squash };
