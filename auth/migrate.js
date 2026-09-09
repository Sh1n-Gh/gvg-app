const fs = require('node:fs');
const path = require('node:path');
const passwords = require('./password');

function applyAuthSchema(db) {
  const migrations = require('../db/migrations');
  if (process.env.NODE_ENV === 'production') migrations.assertCurrent(db);
  else migrations.migrate(db);
}
async function migrateCredentials(db, { env = process.env, backupPath, hash = passwords.hashPassword } = {}) {
  passwords.assertRuntime();
  const gyms = db.prepare('SELECT id, admin_code FROM gyms ORDER BY id').all();
  const codes = new Set();
  for (const gym of gyms) {
    passwords.validatePassword(gym.admin_code, { legacy: true });
    if (codes.has(gym.admin_code)) throw new Error('AUTH_MIGRATION: duplicate legacy credential');
    codes.add(gym.admin_code);
  }
  if (db.name !== ':memory:') {
    if (!backupPath) throw new Error('AUTH_MIGRATION: backup destination required');
    const target = path.join(fs.realpathSync(path.dirname(path.resolve(backupPath))), path.basename(backupPath));
    const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const publicRoot = canonical(fs.realpathSync(path.resolve(__dirname, '../public')));
    if (canonical(target) === publicRoot || canonical(target).startsWith(publicRoot + path.sep)
        || canonical(target) === canonical(path.resolve(db.name)) || fs.existsSync(target)) {
      throw new Error('AUTH_MIGRATION: backup destination must be new and outside web root');
    }
    // SQLite online backup API includes committed WAL data.
    await db.backup(target);
  }
  applyAuthSchema(db);
  const existing = db.prepare('SELECT id, role, gym_id, password_hash FROM auth_principals').all();
  if (existing.some(p => !passwords.parseHash(p.password_hash)
      || (p.role === 'gym' ? !gyms.some(g => g.id === p.gym_id) : p.role !== 'master' || p.gym_id !== null))) {
    throw new Error('AUTH_MIGRATION: invalid existing principal');
  }
  const pending = [];
  try {
    for (const gym of gyms) {
      if (existing.some(p => p.role === 'gym' && p.gym_id === gym.id)) continue;
      const passwordHash = await hash(gym.admin_code, { legacy: true });
      if (!await passwords.verifyPassword(gym.admin_code, passwordHash)) throw new Error();
      pending.push({ role: 'gym', gymId: gym.id, passwordHash });
    }
    if (!existing.some(p => p.role === 'master')) {
      const bootstrap = env.MASTER_ADMIN_BOOTSTRAP_PASSWORD || env.MASTER_ADMIN_CODE;
      if (!bootstrap) throw new Error();
      const passwordHash = await hash(bootstrap, { legacy: !env.MASTER_ADMIN_BOOTSTRAP_PASSWORD });
      if (!await passwords.verifyPassword(bootstrap, passwordHash)) throw new Error();
      pending.push({ role: 'master', gymId: null, passwordHash });
    }
    db.transaction(() => {
      // Hashing is async, so recheck source inside the write transaction.
      const current = db.prepare('SELECT id, admin_code FROM gyms ORDER BY id').all();
      if (JSON.stringify(current) !== JSON.stringify(gyms)) throw new Error();
      const insert = db.prepare('INSERT INTO auth_principals(role,gym_id,password_hash,must_rotate) VALUES (?,?,?,1)');
      for (const p of pending) insert.run(p.role, p.gymId, p.passwordHash);
      if (db.prepare('SELECT count(*) AS n FROM auth_principals').get().n !== gyms.length + 1) throw new Error();
    }).immediate();
  } catch {
    throw new Error('AUTH_MIGRATION: credential migration failed; legacy data retained; retry after correction');
  }
  return { migrated: pending.length, skipped: existing.length, failed: 0 };
}
module.exports = { applyAuthSchema, migrateCredentials };
