// One server per data folder. The workbook lives in memory and every save writes the whole file, so a second copy of the server on
// the same folder would silently overwrite the first one's saves. The first copy writes server.lock (its process number and a
// heartbeat); a second copy that finds a live one refuses to start and says why. A lock left by a copy that stopped or crashed
// (its process is gone, or the heartbeat is older than a minute) is taken over at once, so a restart never waits on it.

const fs = require('fs');
const path = require('path');

const BEAT_MS = 15 * 1000;
const STALE_MS = 60 * 1000;

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

function acquire(dir, { pid = process.pid, now = () => Date.now(), isAlive = alive } = {}) {
  const file = path.join(dir, 'server.lock');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mine = () => JSON.stringify({ pid, at: now() });
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      fs.writeFileSync(file, mine(), { flag: 'wx', mode: 0o600 }); // only one process can create it
      return { file, beat: () => { try { fs.writeFileSync(file, mine(), { mode: 0o600 }); } catch (e) { /* next beat */ } }, release: () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.pid === pid) fs.unlinkSync(file); } catch (e) { /* gone */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let other = null;
    try { other = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { other = null; } // unreadable: treated as left over
    const live = other && Number.isInteger(other.pid) && other.pid !== pid && isAlive(other.pid) && now() - Number(other.at) < STALE_MS;
    if (live) return { running: other.pid, error: `Another copy of Student Recruit 360 (process ${other.pid}) is already running on this data folder (${dir}). A second copy would overwrite its saves, so this one is not started. Stop the other copy first.` };
    try { fs.unlinkSync(file); } catch (e) { /* taken by someone else; try again */ }
  }
  return { error: `Could not take the lock ${file}.` };
}

module.exports = { acquire, BEAT_MS, STALE_MS };
