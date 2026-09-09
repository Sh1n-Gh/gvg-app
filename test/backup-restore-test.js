const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { backup, restore, beforeMigrate } = require('../scripts/sqlite-backup');
const { migrateProduction } = require('../db/migrations');
const { createDb } = require('../db');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('live WAL: committed data restored, uncommitted excluded, source preserved', async t => {
  const dir = fixture(t), source = path.join(dir, 'source.db');
  const writer = createDb(source);
  try {
    writer.pragma('wal_autocheckpoint = 0');
    writer.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT)');
    writer.prepare('INSERT INTO probe VALUES (?,?)').run(1, 'committed');
    assert.ok(fs.statSync(source + '-wal').size > 0);
    writer.exec('BEGIN');
    writer.prepare('INSERT INTO probe VALUES (?,?)').run(2, 'uncommitted');
    const receipt = await backup({ source, directory: dir });
    const target = await restore(receipt.path, path.join(dir, 'restored.db'));
    const db = new Database(target);
    try {
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.prepare('SELECT * FROM probe').all(), [{ id: 1, value: 'committed' }]);
      assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, require('../db/migrations').catalog.length);
      db.prepare('INSERT INTO probe VALUES (?,?)').run(3, 'restore write');
    } finally { db.close(); }
    writer.exec('ROLLBACK');
    assert.equal(writer.prepare('SELECT count(*) n FROM probe').get().n, 1);
    assert.ok(!fs.existsSync(receipt.path + '-wal'));
  } finally { writer.close(); }
});
test('refuse overwrite, sidecars, public directory, aliases, missing source and invalid retention', async t => {
  const dir = fixture(t), source = path.join(dir, 'source.db');
  createDb(source).close();
  const before = fs.readFileSync(source);
  await assert.rejects(restore(source, source), /exists/);
  const alias = path.join(dir, 'alias.db'); fs.linkSync(source, alias);
  await assert.rejects(restore(source, alias), /exists/);
  const target = path.join(dir, 'target.db'); fs.writeFileSync(target + '-wal', 'sentinel');
  await assert.rejects(restore(source, target), /exists/);
  await assert.rejects(backup({ source, directory: path.resolve('public') }), /web root/);
  const junction = path.join(dir, 'public-alias'); fs.symlinkSync(path.resolve('public'), junction, 'junction');
  await assert.rejects(backup({ source, directory: junction }), /web root/);
  await assert.rejects(backup({ source, directory: dir, retentionDays: 0 }), /Retention/);
  await assert.rejects(backup({ source: path.join(dir, 'missing.db'), directory: dir }));
  assert.deepEqual(fs.readFileSync(source), before);
});
test('retention deletes only expired generated names after success; failed backup preserves them', async t => {
  const dir = fixture(t), source = path.join(dir, 'source.db'); createDb(source).close();
  const old = path.join(dir, 'gvg-2000-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.sqlite3');
  fs.writeFileSync(old, 'old');
  const unrelated = path.join(dir, 'manual.sqlite3'); fs.writeFileSync(unrelated, 'keep');
  const corrupt = path.join(dir, 'corrupt.db'); fs.writeFileSync(corrupt, 'not sqlite');
  await assert.rejects(backup({ source: corrupt, directory: dir }));
  assert.ok(fs.existsSync(old));
  const receipt = await backup({ source, directory: dir, retentionDays: 7 });
  assert.ok(!fs.existsSync(old)); assert.ok(fs.existsSync(unrelated)); assert.ok(fs.existsSync(receipt.path));
  assert.ok(!fs.readdirSync(dir).some(name => name.endsWith('.partial')));
  await assert.rejects(restore(corrupt, path.join(dir, 'bad-restore.db')));
  assert.ok(!fs.existsSync(path.join(dir, 'bad-restore.db')));
});
test('real P16 provider gates migration and creates restorable pre-migration snapshot', async t => {
  const dir = fixture(t), source = path.join(dir, 'source.db');
  const db = new Database(source);
  const previous = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  try {
    await migrateProduction(db, { beforeMigrate });
    const ref = db.prepare('SELECT backup_ref FROM schema_migrations LIMIT 1').get().backup_ref;
    const restored = await restore(path.join(dir, ref), path.join(dir, 'pre-migration.db'));
    const check = new Database(restored);
    try { assert.equal(check.prepare('SELECT count(*) n FROM sqlite_schema').get().n, 0); } finally { check.close(); }
  } finally { db.close(); if (previous === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = previous; }
});
test('CLI backup/restore succeeds with explicit fixture paths and rejects repeated restore', t => {
  const dir = fixture(t), source = path.join(dir, 'source.db'); createDb(source).close();
  const env = { ...process.env, DB_PATH: source, BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '7' };
  const run = operation => spawnSync(process.execPath, ['scripts/backup-db.js', operation], { env, encoding: 'utf8' });
  const saved = run('backup'); assert.equal(saved.status, 0, saved.stderr);
  env.BACKUP_FILE = JSON.parse(saved.stdout).path; env.RESTORE_DB_PATH = path.join(dir, 'restored.db');
  assert.equal(run('restore').status, 0); assert.equal(run('restore').status, 1);
});
