const { assertRuntime } = require('./password');
function validateConfig(db, env = process.env) {
  assertRuntime();
  if (env.NODE_ENV !== 'production') return;
  const keys = (env.SESSION_SECRETS || '').split(',').map(key => key.trim());
  if (keys.some(key => Buffer.byteLength(key) < 32)) {
    throw new Error('AUTH_CONFIG: SESSION_SECRETS requires signing keys of at least 32 bytes');
  }
  if (Buffer.byteLength(env.AUTH_RATE_LIMIT_SECRET || '') < 32
      || keys.includes(env.AUTH_RATE_LIMIT_SECRET)) {
    throw new Error('AUTH_CONFIG: AUTH_RATE_LIMIT_SECRET requires a distinct key of at least 32 bytes');
  }
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='auth_principals'").get();
  const master = exists && db.prepare("SELECT id FROM auth_principals WHERE role='master' AND disabled_at IS NULL").get();
  if (!master) {
    throw new Error('AUTH_CONFIG: active Master principal is required; provision offline');
  }
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.PUBLIC_ORIGIN) throw new Error();
  } catch { throw new Error('AUTH_CONFIG: PUBLIC_ORIGIN requires an exact HTTPS origin'); }
}
module.exports = { validateConfig };
