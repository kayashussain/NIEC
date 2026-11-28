// A password kept on disk as a sealed text instead of as it is typed (the owner, 28 Nov 2026: the partner portals' passwords were
// kept as plain text in the data files and in every daily backup). The key is the one the mailboxes' passwords already use
// (mail-key in the data folder, readable only by the server's user, copied before every new version by version-guard.js), so
// there is still one key to keep. AES-256-GCM: a sealed text that was changed does not open.
//
//   seal(plain)  -> "sealed:v1:<iv>.<tag>.<data>" (an empty text stays empty; a text already sealed is left as it is)
//   open(text)   -> the plain text, the same text when it was never sealed, or null when it cannot be opened (no key, another key,
//                   damaged). A caller keeps the sealed text then, so nothing is ever lost by being turned into an empty one.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIX = 'sealed:v1:';
const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function createSecretBox(dir, name = 'mail-key') {
  const keyFile = path.join(dir, name);
  const readKey = () => { try { const k = fs.readFileSync(keyFile); return k.length === 32 ? k : null; } catch (e) { return null; } };
  // A key is made only when one is needed to seal, and never over an existing file.
  function makeKey() {
    const k = readKey();
    if (k) return k;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const made = readKey();
    if (!made) throw new Error(`The key file ${name} could not be read.`);
    return made;
  }
  function seal(plain) {
    const text = String(plain == null ? '' : plain);
    if (!text || isSealed(text)) return text;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', makeKey(), iv);
    const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return PREFIX + [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }
  function open(text) {
    if (!isSealed(text)) return text == null ? '' : String(text);
    const key = readKey();
    if (!key) return null;
    try {
      const [iv, tag, data] = text.slice(PREFIX.length).split('.').map((s) => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    } catch (e) { return null; }
  }
  return { seal, open, isSealed };
}

module.exports = { createSecretBox, isSealed, PREFIX };
