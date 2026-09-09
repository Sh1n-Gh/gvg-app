const crypto = require('node:crypto');

function assertRuntime(api = crypto) {
  if (typeof api.argon2 !== 'function') throw new Error('AUTH_RUNTIME: Node.js 24 >=24.7.0 with Argon2 is required');
}
function validatePassword(password, { legacy = false } = {}) {
  if (typeof password !== 'string' || !password.length || !password.isWellFormed()
      || (!legacy && (Array.from(password).length < 12 || Buffer.byteLength(password) > 256))) {
    throw new Error('AUTH_PASSWORD_POLICY: invalid password length or encoding');
  }
}
function parseHash(value) {
  if (typeof value !== 'string') return null;
  const match = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(value);
  if (!match) return null;
  const salt = Buffer.from(match[1], 'base64');
  const tag = Buffer.from(match[2], 'base64');
  if (salt.toString('base64').replace(/=+$/, '') !== match[1]
      || tag.toString('base64').replace(/=+$/, '') !== match[2]) return null;
  return { salt, tag };
}
async function derive(password, salt) {
  assertRuntime();
  return new Promise((resolve, reject) => {
    crypto.argon2('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt,
      memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }, (err, tag) => {
      if (err) reject(new Error('AUTH_HASH: password processing failed'));
      else resolve(tag);
    });
  });
}
async function hashPassword(password, options) {
  validatePassword(password, options);
  const salt = crypto.randomBytes(16);
  const tag = await derive(password, salt);
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64').replace(/=+$/, '')}$${tag.toString('base64').replace(/=+$/, '')}`;
}
async function verifyPassword(password, hash) {
  const parsed = parseHash(hash);
  if (!parsed || typeof password !== 'string' || !password.isWellFormed()) return false;
  return crypto.timingSafeEqual(await derive(password, parsed.salt), parsed.tag);
}
// P03 has one allowlisted policy. Add explicitly supported old policies when upgrading.
function needsRehash(hash) { return !parseHash(hash); }
module.exports = { assertRuntime, validatePassword, parseHash, hashPassword, verifyPassword, needsRehash };
