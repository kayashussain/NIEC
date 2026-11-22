// Interview guidelines (the owner, 22 Nov 2026): the files a University (or a student who was given them) shares about its interviews,
// kept by University. Every University in Universities is listed by itself; the Mock Team uploads a file to one (its kind: credibility
// interview guidelines, UKVI interview guidelines, interview questions or other; where it came from: the University or a student; a
// title), and anyone who may open the page downloads it. Admin and the Mock Team upload and remove; the Manager looks.
//
// The list is mock-guidelines.json and the files are in guideline-files/ in the data folder (never in git), each stored under its own
// id (never under the name typed). The list is copied into the daily backup; the files stay on the server, as agreement files do.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic, snapshotDaily } = require('../shared/server-utils');
const { FILE_TYPES, MAX_FILE_BYTES, looksLike } = require('./direct');

const KINDS = ['Credibility interview guidelines', 'UKVI interview guidelines', 'Interview questions', 'Other'];
const SOURCES = ['From the University', 'From a student'];
const MAX_FILES = 2000;
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fileName = (v) => String(v || '').replace(/[\\/\u0000-\u001f‎‏‪-‮⁦-⁩]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
const newId = () => crypto.randomBytes(6).toString('hex');

function createMockGuidelines(dir, { now = () => new Date() } = {}) {
  const file = path.join(dir, 'mock-guidelines.json');
  const folder = path.join(dir, 'guideline-files');
  let cache = null;
  function load() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return { files: [] }; }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const data = { files: Array.isArray(raw && raw.files) ? raw.files : [] };
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
      return data;
    } catch (e) {
      try { fs.copyFileSync(file, path.join(dir, `mock-guidelines.damaged-${Date.now()}.json`)); } catch (x) { /* could not copy */ }
      return { files: [] };
    }
  }
  function write(data) {
    snapshotDaily(file, dir, 'mock-guidelines');
    writeFileAtomic(file, JSON.stringify(data));
    cache = null;
  }
  // Only files whose bytes are really on disk are listed.
  const present = (f) => f && f.ext && fs.existsSync(path.join(folder, f.id + f.ext));
  return {
    KINDS, SOURCES,
    all() { return load(); },
    list() { return load().files.filter(present); },
    restoreAll(data) { if (data && Array.isArray(data.files)) write({ files: data.files }); },
    add({ university, universityId, kind, source, title, name, bytes, by }) {
      const uni = text(university, 160);
      if (!uni) return { error: 'Choose the University first.' };
      if (!KINDS.includes(kind)) return { error: 'Choose the kind of guideline.' };
      if (!SOURCES.includes(source)) return { error: 'Choose where it came from.' };
      const shown = fileName(name);
      const ext = path.extname(shown).toLowerCase();
      if (!shown || !Object.prototype.hasOwnProperty.call(FILE_TYPES, ext)) return { error: 'Please upload a PDF, Word document (.doc, .docx) or a picture (.png, .jpg).' };
      if (!bytes || !bytes.length) return { error: 'That file is empty.' };
      if (bytes.length > MAX_FILE_BYTES) return { error: 'That file is too large (the limit is 10 MB).' };
      if (!looksLike(ext, bytes)) return { error: `That file is not really a ${ext.slice(1).toUpperCase()} file. Please upload the original.` };
      const data = load();
      if (data.files.length >= MAX_FILES) return { error: 'The most guideline files allowed are already kept. Remove an old one first.' };
      const entry = {
        id: newId(), university: uni, universityId: /^[a-f0-9]{12}$/.test(String(universityId || '')) ? universityId : '',
        kind, source, title: text(title, 160) || shown.replace(/\.[^.]+$/, ''), name: shown, ext, size: bytes.length,
        by: text(by, 80), at: now().toISOString(),
      };
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileAtomic(path.join(folder, entry.id + ext), bytes);
      write({ files: [...data.files, entry] });
      return { file: entry };
    },
    file(id) {
      const entry = load().files.find((f) => f.id === id);
      if (!present(entry)) return null;
      return { path: path.join(folder, entry.id + entry.ext), name: entry.name, type: FILE_TYPES[entry.ext], entry };
    },
    remove(id) {
      const data = load();
      const entry = data.files.find((f) => f.id === id);
      if (!entry) return { error: 'No such file.' };
      try { fs.rmSync(path.join(folder, entry.id + entry.ext), { force: true }); } catch (e) { /* already gone */ }
      write({ files: data.files.filter((f) => f.id !== id) });
      return { removed: entry };
    },
  };
}

module.exports = { createMockGuidelines, KINDS, SOURCES };
