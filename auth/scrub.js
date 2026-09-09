// Offline phase C. No startup import, implicit DB path, or plaintext output.
const crypto = require('node:crypto');
const fs = require('node:fs');
const pw = require('./password');
const tombstone = value => /^disabled:[a-f0-9]{64}$/.test(value);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function snapshot(db) {
  return JSON.stringify({gyms: db.prepare('SELECT * FROM gyms ORDER BY id').all(),
    principals: db.prepare('SELECT * FROM auth_principals ORDER BY id').all()});
}
// Inspect every stored column, including blobs/JSON and deleted gyms. Reject
// unexpected copies rather than silently damaging unrelated business fields.
function scanPlaintext(db, secrets) {
  let matches = 0;
  for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    for (const row of db.prepare(`SELECT * FROM ${quote(name)}`).iterate()) {
      for (const value of Object.values(row)) {
        if (value === null) continue;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) matches++;
      }
    }
  }
  return matches;
}
function writeHandoff(filename, key, credentials) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('SCRUB: 32-byte handoff key required');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({version:1,iv:iv.toString('base64'),
      tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
    fs.fsyncSync(fd); // Must succeed before any credential writes.
  } finally { fs.closeSync(fd); }
}
function readHandoff(filename, key) {
  const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (envelope.version !== 1) throw new Error('SCRUB: unsupported handoff');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]));
}
async function scrubCredentials(db, {handoffPath, key, hash = pw.hashPassword, afterWrite = () => {}} = {}) {
  require('../db/migrations').assertCurrent(db);
  const before = snapshot(db);
  const gyms = db.prepare('SELECT id,slug,admin_code FROM gyms ORDER BY id').all();
  const principals = db.prepare('SELECT * FROM auth_principals').all();
  if (!principals.some(p => p.role === 'master' && !p.disabled_at && pw.parseHash(p.password_hash))) {
    throw new Error('SCRUB: valid active Master required for recovery');
  }
  for (const gym of gyms) {
    const p = principals.find(p => p.role === 'gym' && p.gym_id === gym.id);
    if (!p || !pw.parseHash(p.password_hash) || typeof gym.admin_code !== 'string' || !gym.admin_code.length) {
      throw new Error('SCRUB: finish additive auth migration before scrub');
    }
    if (tombstone(gym.admin_code) && await pw.verifyPassword(gym.admin_code,p.password_hash)) {
      throw new Error('SCRUB: tombstone authenticates; repair invalid principal offline');
    }
  }
  const legacy = gyms.filter(g => !tombstone(g.admin_code));
  if (!legacy.length) return {before:0,scrubbed:0,after:0,changed:false};
  const pending = [];
  for (const gym of legacy) {
    const password = crypto.randomBytes(32).toString('base64url');
    const passwordHash = await hash(password);
    if (!pw.parseHash(passwordHash) || !await pw.verifyPassword(password,passwordHash)) throw new Error('SCRUB: hash verification failed');
    pending.push({gymId:gym.id,slug:gym.slug,password,passwordHash,
      tombstone:'disabled:'+crypto.randomBytes(32).toString('hex')});
  }
  writeHandoff(handoffPath,key,pending.map(({gymId,slug,password,passwordHash}) => ({gymId,slug,password,passwordHash})));
  db.pragma('secure_delete = ON');
  db.transaction(() => {
    if (snapshot(db) !== before) throw new Error('SCRUB: concurrent credential change; retry offline');
    for (const [index,p] of pending.entries()) {
      const principal = principals.find(row => row.role === 'gym' && row.gym_id === p.gymId);
      db.prepare(`UPDATE auth_principals SET password_hash=?,must_rotate=1,
        password_version=password_version+1,session_version=session_version+1,
        password_changed_at=datetime('now') WHERE id=?`).run(p.passwordHash,principal.id);
      db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE principal_id=?').run(Date.now(),principal.id);
      db.prepare('UPDATE gyms SET admin_code=? WHERE id=?').run(p.tombstone,p.gymId);
      afterWrite(index+1); // Synchronous fault injection; throws roll back every gym.
    }
    if (scanPlaintext(db,[...legacy.map(g=>g.admin_code),...pending.map(p=>p.password)])) {
      throw new Error('SCRUB: plaintext remains in stored columns; transaction rolled back');
    }
  }).immediate();
  return {before:legacy.length,scrubbed:pending.length,after:0,changed:true};
}
module.exports = {scrubCredentials,scanPlaintext,readHandoff};
