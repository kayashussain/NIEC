// Off-site backup: every daily, manual and before-restore copy in daily-backups/ is also sent, encrypted, to a bucket outside this server,
// so losing the server's disk never loses the data. Works with any S3-compatible store (Amazon S3, Cloudflare R2, Backblaze B2, Wasabi).
//
// Switched on by these settings on the server only (never in git, code or tests, CLAUDE.md Rule 3):
//   NIEC_OFFSITE_ENDPOINT    e.g. https://s3.eu-west-2.amazonaws.com or https://<account>.r2.cloudflarestorage.com
//   NIEC_OFFSITE_BUCKET      the bucket name
//   NIEC_OFFSITE_REGION      e.g. eu-west-2 (R2: auto)
//   NIEC_OFFSITE_ACCESS_KEY  and NIEC_OFFSITE_SECRET_KEY   a key that may only write to that bucket
//   NIEC_OFFSITE_PASSPHRASE  the secret that encrypts every file (AES-256-GCM) before it leaves the server. Keep a copy of it somewhere
//                            safe and apart from the server: without it a backup cannot be opened, by anyone.
//   NIEC_OFFSITE_PREFIX      optional folder name inside the bucket (default "sr360-backups")
// Without a passphrase nothing is ever sent: student data does not go off the server unencrypted.
//
// Which files were sent is remembered in offsite-state.json, so a failed send is tried again at the next check and a sent file is not
// sent twice. Open a copy again with: node scripts/decrypt-backup.js <file> (needs the same passphrase).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { writeFileAtomic } = require('../shared/server-utils');

const MAGIC = Buffer.from('SR36');

function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(passphrase), salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
function decrypt(blob, passphrase) {
  if (!Buffer.isBuffer(blob) || blob.length < 48 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('This is not a Student Recruit 360 backup file.');
  const salt = blob.subarray(4, 20); const iv = blob.subarray(20, 32); const tag = blob.subarray(32, 48);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(String(passphrase), salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(blob.subarray(48)), d.final()]); } catch (e) { throw new Error('Wrong passphrase, or the file is damaged.'); }
}

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// An S3 "PUT object" signed with AWS Signature Version 4 (path style: <endpoint>/<bucket>/<key>).
function put({ endpoint, bucket, region, accessKey, secretKey }, key, body, { now = new Date(), timeoutMs = 120000 } = {}) {
  const url = new URL(endpoint);
  const objectPath = `/${enc(bucket)}/${key.split('/').map(enc).join('/')}`;
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); const day = stamp.slice(0, 8);
  const payload = sha(body);
  const headers = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp, 'content-length': String(body.length), 'content-type': 'application/octet-stream' };
  const names = Object.keys(headers).sort();
  const canonical = ['PUT', objectPath, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha(canonical)].join('\n');
  const signing = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', signing).update(toSign).digest('hex')}`;
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: objectPath, method: 'PUT', headers: { ...headers, authorization: auth }, timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (d) => { if (text.length < 500) text += d; });
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`The bucket answered ${res.statusCode}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`))));
    });
    req.on('timeout', () => req.destroy(new Error('The bucket did not answer in time.')));
    req.on('error', reject);
    req.end(body);
  });
}

function settingsFrom(env = process.env) {
  const s = { endpoint: env.NIEC_OFFSITE_ENDPOINT, bucket: env.NIEC_OFFSITE_BUCKET, region: env.NIEC_OFFSITE_REGION || 'auto', accessKey: env.NIEC_OFFSITE_ACCESS_KEY, secretKey: env.NIEC_OFFSITE_SECRET_KEY, passphrase: env.NIEC_OFFSITE_PASSPHRASE, prefix: (env.NIEC_OFFSITE_PREFIX || 'sr360-backups').replace(/^\/+|\/+$/g, '') };
  return s.endpoint && s.bucket && s.accessKey && s.secretKey && s.passphrase ? s : null;
}

// `settings`: from settingsFrom (null = switched off). `record(text)`: where a failure is written (Activity).
function createOffsite(dir, settings, { record = () => {}, now = () => new Date(), lookMs = 60 * 1000, retryMs = 5 * 60 * 1000 } = {}) {
  const folder = path.join(dir, 'daily-backups');
  const stateFile = path.join(dir, 'offsite-state.json');
  const readState = () => { try { const d = JSON.parse(fs.readFileSync(stateFile, 'utf8')); return d && typeof d === 'object' ? { sent: d.sent || {}, lastOk: d.lastOk || '', lastError: d.lastError || '', lastErrorAt: d.lastErrorAt || '' } : { sent: {}, lastOk: '', lastError: '', lastErrorAt: '' }; } catch (e) { return { sent: {}, lastOk: '', lastError: '', lastErrorAt: '' }; } };
  let running = false; let failing = false;
  let lookedAt = 0; let failedAt = 0;

  // Sends every copy not sent yet, oldest first. Never throws: a failure is remembered and tried again at the next check.
  async function sync() {
    if (!settings || running) return { sent: 0 };
    running = true;
    let sent = 0;
    try {
      let names = [];
      try { names = fs.readdirSync(folder).filter((f) => /^niec-.+\.json\.gz$/.test(f)).sort(); } catch (e) { names = []; }
      for (const name of names) {
        const state = readState();
        const stat = fs.statSync(path.join(folder, name));
        if (state.sent[name] === stat.size) continue; // sent as this size already (a copy made again under the same name is sent again)
        try {
          const blob = encrypt(fs.readFileSync(path.join(folder, name)), settings.passphrase);
          await put(settings, `${settings.prefix}/${name}.enc`, blob, { now: now() });
          state.sent[name] = stat.size; state.lastOk = now().toISOString(); state.lastError = '';
          writeFileAtomic(stateFile, JSON.stringify(state)); sent += 1; failing = false;
        } catch (e) {
          state.lastError = String(e.message || e).slice(0, 300); state.lastErrorAt = now().toISOString();
          try { writeFileAtomic(stateFile, JSON.stringify(state)); } catch (e2) { /* the next check tries again */ }
          failedAt = now().getTime();
          if (!failing) { failing = true; record(`The off-site backup of ${name} failed: ${state.lastError}. It is tried again every few minutes.`); } // said once, not every try
          break;
        }
      }
    } finally { running = false; }
    return { sent };
  }

  // The check made at every request of the portal (server.js dailyBackup): it looks at most once a minute, and after a failure waits
  // five minutes before trying again, as the Activity line says (review, 28 Nov 2026: a failing bucket was tried at every page load).
  // "Back up now" and the first check after a start call sync() directly.
  function tick() {
    if (!settings || running) return Promise.resolve({ sent: 0 });
    const t = now().getTime();
    if (t - lookedAt < lookMs || (failedAt && t - failedAt < retryMs)) return Promise.resolve({ sent: 0 });
    lookedAt = t;
    return sync();
  }

  // Admin's test (Activity, Restore data): one small encrypted file is written to the bucket, then every copy not sent yet is sent.
  // { ok, sent, error } in words a person reads; nothing about the keys.
  async function check() {
    if (!settings) return { ok: false, error: 'The off-site backup is not switched on: the settings are not on the server yet.' };
    try {
      await put(settings, `${settings.prefix}/sr360-check.enc`, encrypt(Buffer.from(`Student Recruit 360 off-site check ${now().toISOString()}`), settings.passphrase), { now: now() });
    } catch (e) { return { ok: false, error: `The bucket did not take the test file: ${String(e.message || e).slice(0, 200)}` }; }
    const out = await sync();
    const st = status();
    return st.lastError && st.waiting ? { ok: false, sent: out.sent, error: `The test file was written, but a backup was not: ${st.lastError}` } : { ok: true, sent: out.sent, waiting: st.waiting };
  }

  function status() {
    const st = readState(); let waiting = 0;
    try { waiting = fs.readdirSync(folder).filter((f) => /^niec-.+\.json\.gz$/.test(f) && st.sent[f] !== fs.statSync(path.join(folder, f)).size).length; } catch (e) { waiting = 0; }
    return { enabled: Boolean(settings), lastOk: st.lastOk, lastError: st.lastError, lastErrorAt: st.lastErrorAt, waiting, bucket: settings ? settings.bucket : '' };
  }
  return { sync, tick, check, status, enabled: () => Boolean(settings) };
}

module.exports = { createOffsite, settingsFrom, encrypt, decrypt, put };
