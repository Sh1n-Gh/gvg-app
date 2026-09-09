const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const webRoot = fs.realpathSync(path.join(__dirname, '..', 'public'));
const inside = (root, value) => { const rel = path.relative(root, value); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
function absolute(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('Explicit absolute path required');
  return path.normalize(value);
}
function privateDirectory(value) {
  const dir = fs.realpathSync(absolute(value));
  if (inside(webRoot, dir)) throw new Error('Destination must be outside public web root');
  if (!fs.statSync(dir).isDirectory()) throw new Error('Destination directory required');
  return dir;
}
function verify(db) {
  if (db.pragma('integrity_check').some(row => row.integrity_check !== 'ok')) throw new Error('Integrity check failed');
  if (db.pragma('foreign_key_check').length) throw new Error('Foreign key check failed');
}
async function snapshot(source, destination) {
  const sourcePath = fs.realpathSync(absolute(source));
  const target = path.join(privateDirectory(path.dirname(absolute(destination))), path.basename(destination));
  // Exclusive reservation also rejects existing files, hardlinks and dangling symlinks.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.lstatSync(target + suffix); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Restore/backup destination already exists');
  }
  const fd = fs.openSync(target, 'wx', 0o600);
  fs.closeSync(fd);
  let db;
  try {
    db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const started = Date.now();
    await db.backup(target, { progress: () => {
      if (Date.now() - started > 300000) throw new Error('Backup exceeded five minutes');
      return 100;
    } });
    db.close(); db = undefined;
    const restored = new Database(target, { fileMustExist: true });
    try { restored.pragma('journal_mode = DELETE'); verify(restored); } finally { restored.close(); }
    const sync = fs.openSync(target, 'r+');
    try { fs.fsyncSync(sync); } finally { fs.closeSync(sync); }
    return target;
  } catch (error) {
    if (db) db.close();
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(target + suffix, { force: true });
    throw error;
  }
}
const backupName = /^gvg-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.sqlite3$/;
async function backup({ source, directory, retentionDays = 7 }) {
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Retention must be 1..3650 days');
  const dir = privateDirectory(directory);
  const name = `gvg-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite3`;
  const pending = path.join(dir, name + '.partial');
  await snapshot(source, pending);
  const target = path.join(dir, name);
  // Publish without replacing any existing destination; partials are never retention candidates.
  try { fs.linkSync(pending, target); } finally { fs.rmSync(pending, { force: true }); }
  const cutoff = Date.now() - days * 86400000;
  const sourceReal = fs.realpathSync(source);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !backupName.test(entry.name) || entry.name === name) continue;
    const stamp = entry.name.slice(4, 28).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
    if (path.join(dir, entry.name) !== sourceReal && Date.parse(stamp) < cutoff) fs.unlinkSync(path.join(dir, entry.name));
  }
  return { ok: true, reference: name, path: target };
}
exports.backup = backup;
exports.restore = snapshot;
exports.verify = verify;
exports.beforeMigrate = ({ databasePath }) => backup({ source: databasePath, directory: process.env.BACKUP_DIR, retentionDays: process.env.BACKUP_RETENTION_DAYS || 7 });
