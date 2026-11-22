// The one door to stored documents (step 1 of the database plan in SYSTEM-ROADMAP.md).
//
// A "document" is one named JSON value ("cards", "planning", ...). Code that keeps data asks this door to read, write, set aside a
// damaged one, and list the recovery copies, and never touches files itself, so the place the data lives can change (JSON files today,
// SQLite next) without any other code changing. Every backend must pass test/store-contract.test.js.
//
//   read(name)        { data, version } | null (nothing saved). Throws an error with .damaged = true when it exists but cannot be read.
//   version(name)     a cheap token that changes whenever the document changes ('' when there is none), for caches.
//   write(name, data) replaces the document whole or not at all, after the day's first copy (see snapshots). Returns the new version.
//   quarantine(name)  sets a damaged document aside (kept, never overwritten) so a fresh one can be written. Returns what it was kept as.
//   snapshots(name)   the recovery copies of that document, newest first: [{ id, read() }], read() returns the data or throws.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic, snapshotDaily, localDate } = require('../shared/server-utils');

const damaged = (message) => Object.assign(new Error(message), { damaged: true });
const safeName = (name) => { if (!/^[a-z][a-z0-9-]{0,40}$/.test(String(name))) throw new Error(`Not a document name: ${name}`); return name; };

// JSON files in the data folder: <name>.json, daily copies in backups/<name>-YYYY-MM-DD.json (exactly as before).
function createFileStore(dir, { now = () => new Date() } = {}) {
  const fileOf = (name) => path.join(dir, `${safeName(name)}.json`);
  const versionOf = (stat) => `${stat.mtimeMs}:${stat.size}`;
  return {
    kind: 'files',
    version(name) { try { return versionOf(fs.statSync(fileOf(name))); } catch (e) { return ''; } },
    read(name) {
      let text; let stat;
      try { stat = fs.statSync(fileOf(name)); text = fs.readFileSync(fileOf(name), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      try { return { data: JSON.parse(text), version: versionOf(stat) }; } catch (e) { throw damaged(`${name} could not be read: ${e.message}`); }
    },
    write(name, data) {
      const file = fileOf(name);
      const text = JSON.stringify(data);
      if (text === undefined) throw new Error('Nothing to save.');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      snapshotDaily(file, dir, name, now());
      writeFileAtomic(file, text);
      return versionOf(fs.statSync(file));
    },
    quarantine(name) {
      const kept = path.join(dir, `${safeName(name)}.damaged-${now().toISOString().replace(/[:.]/g, '-')}.json`);
      try { fs.renameSync(fileOf(name), kept); return path.basename(kept); } catch (e) { return ''; }
    },
    snapshots(name) {
      let list = [];
      const re = new RegExp(`^${safeName(name)}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
      try { list = fs.readdirSync(path.join(dir, 'backups')).filter((f) => re.test(f)).sort().reverse(); } catch (e) { list = []; }
      return list.map((f) => ({ id: re.exec(f)[1], read() { try { return JSON.parse(fs.readFileSync(path.join(dir, 'backups', f), 'utf8')); } catch (e) { throw damaged(`${f} could not be read`); } } }));
    },
  };
}

// One SQLite file (node:sqlite, built into Node 22.5 and later). The same behaviour in a database: each save is one transaction, with the
// day's first copy kept in the same file (60 days). Not used by the server yet: the live server stays on files until the owner has seen
// the real data match (SYSTEM-ROADMAP.md).
function createSqliteStore(file, { now = () => new Date(), keepDays = 60 } = {}) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, json TEXT NOT NULL, version INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS snapshots (name TEXT NOT NULL, day TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (name, day));
           CREATE TABLE IF NOT EXISTS damaged (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL);`);
  const get = db.prepare('SELECT json, version FROM docs WHERE name = ?');
  const put = db.prepare('INSERT INTO docs (name, json, version) VALUES (?, ?, 1) ON CONFLICT(name) DO UPDATE SET json = excluded.json, version = docs.version + 1');
  const snapHas = db.prepare('SELECT 1 FROM snapshots WHERE name = ? AND day = ?');
  const snapPut = db.prepare('INSERT INTO snapshots (name, day, json) VALUES (?, ?, ?)');
  const snapOld = db.prepare('DELETE FROM snapshots WHERE name = ? AND day < ?');
  const snapList = db.prepare('SELECT day, json FROM snapshots WHERE name = ? ORDER BY day DESC');
  const move = db.prepare('INSERT INTO damaged (name, at, json) SELECT name, ?, json FROM docs WHERE name = ?');
  const drop = db.prepare('DELETE FROM docs WHERE name = ?');
  const day = () => localDate(now()); // the office's calendar day, as the file backend keeps it
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  return {
    kind: 'sqlite',
    close: () => db.close(),
    version(name) { const r = get.get(safeName(name)); return r ? String(r.version) : ''; },
    read(name) {
      const r = get.get(safeName(name));
      if (!r) return null;
      try { return { data: JSON.parse(r.json), version: String(r.version) }; } catch (e) { throw damaged(`${name} could not be read: ${e.message}`); }
    },
    write(name, data) {
      safeName(name);
      const text = JSON.stringify(data);
      if (text === undefined) throw new Error('Nothing to save.');
      return tx(() => {
        const before = get.get(name); const d = day();
        if (before && !snapHas.get(name, d)) { snapPut.run(name, d, before.json); snapOld.run(name, localDate(new Date(now().getTime() - keepDays * 86400000))); }
        put.run(name, text);
        return String(get.get(name).version);
      });
    },
    quarantine(name) { safeName(name); return tx(() => { const at = now().toISOString(); move.run(at, name); drop.run(name); return `${name}.damaged-${at.replace(/[:.]/g, '-')}`; }); },
    snapshots(name) { return snapList.all(safeName(name)).map((r) => ({ id: r.day, read() { try { return JSON.parse(r.json); } catch (e) { throw damaged(`${name} copy of ${r.day} could not be read`); } } })); },
  };
}

module.exports = { createFileStore, createSqliteStore };
