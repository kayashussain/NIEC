// Opens an off-site backup copy: node scripts/decrypt-backup.js <file.json.gz.enc> [out.json.gz]
// The passphrase is read from NIEC_OFFSITE_PASSPHRASE. The result is the same compressed backup (.json.gz) the server keeps in
// daily-backups/: copy it back into that folder to restore from it on the server, or run scripts/local-live.js on it to look at the data
// on this computer.
const fs = require('fs');
const { decrypt } = require('../student-details/offsite');
const [, , file, out] = process.argv;
if (!file || !process.env.NIEC_OFFSITE_PASSPHRASE) { console.error('Usage: NIEC_OFFSITE_PASSPHRASE=... node scripts/decrypt-backup.js <file.enc> [out]'); process.exit(1); }
try {
  const target = out || file.replace(/\.enc$/, '');
  fs.writeFileSync(target, decrypt(fs.readFileSync(file), process.env.NIEC_OFFSITE_PASSPHRASE), { mode: 0o600 });
  console.log('Opened:', target);
} catch (e) { console.error(e.message); process.exit(1); }
